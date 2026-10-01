/**
 * Three-tier cache: an in-process LRU, then a durable shared tier.
 *
 * Why tiers. The in-process layer costs nothing — no serialisation, no socket —
 * and absorbs the repeats inside one warm instance: the query embedding used by
 * the semantic cache and then again by retrieval, the chunk vectors fetched
 * twice in one conversation. The durable tier is what makes a cache survive a
 * cold start and stay shared once the platform runs more than one instance,
 * which is the point at which a purely local cache quietly stops working.
 *
 * Why not just Redis. This app deploys as Next.js serverless functions on
 * Netlify, where a pooled TCP connection does not survive between invocations
 * and there is no Redis provisioned. So the durable tier is, in order of
 * preference:
 *
 *   Upstash REST   one HTTPS call per operation, no connection to keep alive.
 *                  The right shape for serverless, and the fastest option here.
 *   Firestore      already provisioned, already authenticated, already on the
 *                  critical path for this request. Slower than Redis and with
 *                  consistency guarantees the cache does not need, but a real
 *                  shared tier beats no shared tier, and entries carry their own
 *                  expiry so a stale read is impossible rather than merely
 *                  unlikely.
 *   nothing        local only. Correct, per-instance, lost on redeploy.
 *
 * Everything degrades rather than fails. A durable-tier error is swallowed and
 * the caller sees a miss, and a tier that fails is skipped for a cool-off rather
 * than retried on every request — an outage that turns each lookup into a
 * timeout makes the cache slower than not having one.
 *
 * Server-only.
 */
import { createHash } from "crypto";
import { adminDb } from "@/lib/firebase/admin";
import { settings } from "@/lib/ai/config";

/** Bumping this invalidates every key at once, for when a payload shape changes
 *  and a stale entry would be misread rather than merely stale. */
const SCHEMA = "v2";

const CACHE_COLLECTION = "agentCache";

export type CacheBackend = "local" | "upstash" | "firestore";

interface LocalEntry {
  expires: number;
  value: unknown;
}

/** A small TTL + LRU map, scoped to one instance. */
class LocalCache {
  private data = new Map<string, LocalEntry>();

  constructor(private max: number) {}

  get(key: string): unknown | undefined {
    const entry = this.data.get(key);
    if (!entry) return undefined;
    if (entry.expires < Date.now()) {
      this.data.delete(key);
      return undefined;
    }
    // Re-insert to mark it most recently used.
    this.data.delete(key);
    this.data.set(key, entry);
    return entry.value;
  }

  set(key: string, value: unknown, ttlSeconds: number): void {
    if (this.data.size >= this.max) {
      // Map preserves insertion order, so the first key is the coldest.
      const coldest = this.data.keys().next().value;
      if (coldest !== undefined) this.data.delete(coldest);
    }
    this.data.set(key, { expires: Date.now() + ttlSeconds * 1000, value });
  }

  delete(key: string): void {
    this.data.delete(key);
  }
}

const local = new LocalCache(settings.cacheLocalEntries);

/** When the durable tier failed last, and is therefore skipped. */
let downUntil = 0;
function trip(): void {
  downUntil = Date.now() + settings.cacheCooloffSeconds * 1000;
}
function durableAvailable(): boolean {
  return Date.now() >= downUntil;
}

export function cacheBackend(): CacheBackend {
  if (settings.upstashRestUrl && settings.upstashRestToken) return "upstash";
  if (settings.cacheFirestoreFallback) return "firestore";
  return "local";
}

/** Build a namespaced key. Every caller goes through this so one schema bump
 *  invalidates everything. */
export function cacheKey(...parts: (string | number)[]): string {
  return [SCHEMA, ...parts.map(String)].join(":");
}

/** Firestore document ids may not contain "/" and are length-capped, so a key
 *  becomes a digest. The readable prefix is kept for eyeballing the collection. */
function docId(key: string): string {
  return `${key.slice(0, 40).replace(/[^\w.-]/g, "_")}_${createHash("sha256")
    .update(key)
    .digest("hex")
    .slice(0, 24)}`;
}

// ------------------------------- Upstash REST ------------------------------- //

async function upstash(command: (string | number)[]): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), settings.cacheTimeoutMs);
  try {
    const res = await fetch(settings.upstashRestUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.upstashRestToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(command),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`upstash ${res.status}`);
    const json = (await res.json()) as { result?: unknown };
    return json.result ?? null;
  } finally {
    clearTimeout(timer);
  }
}

// -------------------------------- Firestore -------------------------------- //

async function firestoreGet(key: string): Promise<string | null> {
  const snap = await adminDb().collection(CACHE_COLLECTION).doc(docId(key)).get();
  if (!snap.exists) return null;
  const data = snap.data() as { v?: string; exp?: number } | undefined;
  // Expiry is enforced on read, not by a TTL policy, so a document that outlives
  // its usefulness can never be served. A TTL policy only reclaims the storage.
  if (!data?.v || (data.exp ?? 0) < Date.now()) return null;
  return data.v;
}

async function firestoreSet(key: string, value: string, ttlSeconds: number): Promise<void> {
  await adminDb()
    .collection(CACHE_COLLECTION)
    .doc(docId(key))
    .set({ v: value, exp: Date.now() + ttlSeconds * 1000, k: key.slice(0, 200) });
}

// ------------------------------- string values ------------------------------ //

/** Read a string, local tier first. Returns null on a miss or any failure. */
export async function cacheGet(key: string): Promise<string | null> {
  const hit = local.get(key);
  if (hit !== undefined) return hit as string;
  if (!durableAvailable()) return null;

  try {
    const backend = cacheBackend();
    let value: string | null = null;
    if (backend === "upstash") {
      const raw = await upstash(["GET", key]);
      value = typeof raw === "string" ? raw : null;
    } else if (backend === "firestore") {
      value = await firestoreGet(key);
    }
    if (value !== null) local.set(key, value, settings.cacheLocalTtlSeconds);
    return value;
  } catch {
    trip();
    return null;
  }
}

/** Write a string to both tiers. Never throws. */
export async function cacheSet(key: string, value: string, ttlSeconds: number): Promise<void> {
  local.set(key, value, Math.min(ttlSeconds, settings.cacheLocalTtlSeconds));
  if (!durableAvailable()) return;
  try {
    const backend = cacheBackend();
    if (backend === "upstash") {
      await upstash(["SET", key, value, "EX", ttlSeconds]);
    } else if (backend === "firestore") {
      await firestoreSet(key, value, ttlSeconds);
    }
  } catch {
    trip();
  }
}

export async function cacheDelete(key: string): Promise<void> {
  local.delete(key);
  if (!durableAvailable()) return;
  try {
    const backend = cacheBackend();
    if (backend === "upstash") await upstash(["DEL", key]);
    else if (backend === "firestore") {
      await adminDb().collection(CACHE_COLLECTION).doc(docId(key)).delete();
    }
  } catch {
    trip();
  }
}

// -------------------------------- JSON values ------------------------------- //

export async function cacheGetJson<T>(key: string): Promise<T | null> {
  const raw = await cacheGet(key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function cacheSetJson(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  try {
    await cacheSet(key, JSON.stringify(value), ttlSeconds);
  } catch {
    /* an unserialisable value is a caller bug, not a cache failure */
  }
}

// --------------------------------- counters --------------------------------- //

/**
 * Increment a counter with a TTL, returning the new value. Used for the per-user
 * data version and for rate limits.
 *
 * Upstash does this atomically. Firestore's `increment` is atomic too, but the
 * expiry has to be checked on read, so an expired window is reset in the same
 * transaction rather than by the store. Without either, the counter falls back
 * to the local tier, which limits per instance rather than per user — weaker,
 * but it still bounds a runaway client and it never refuses traffic.
 */
export async function cacheIncr(key: string, ttlSeconds: number): Promise<number> {
  if (durableAvailable()) {
    try {
      const backend = cacheBackend();
      if (backend === "upstash") {
        const value = Number(await upstash(["INCR", key]));
        if (value === 1) await upstash(["EXPIRE", key, ttlSeconds]);
        local.set(key, value, Math.min(ttlSeconds, settings.cacheLocalTtlSeconds));
        return value;
      }
      if (backend === "firestore") {
        const ref = adminDb().collection(CACHE_COLLECTION).doc(docId(key));
        const next = await adminDb().runTransaction(async (tx) => {
          const snap = await tx.get(ref);
          const data = snap.data() as { n?: number; exp?: number } | undefined;
          const live = snap.exists && (data?.exp ?? 0) >= Date.now();
          const value = (live ? data?.n ?? 0 : 0) + 1;
          tx.set(ref, {
            n: value,
            exp: live ? data?.exp : Date.now() + ttlSeconds * 1000,
            k: key.slice(0, 200),
          });
          return value;
        });
        local.set(key, next, Math.min(ttlSeconds, settings.cacheLocalTtlSeconds));
        return next;
      }
    } catch {
      trip();
    }
  }
  const value = Number(local.get(key) ?? 0) + 1;
  local.set(key, value, ttlSeconds);
  return value;
}

/** Read a counter. Zero when absent. */
export async function cacheGetInt(key: string): Promise<number> {
  const hit = local.get(key);
  if (typeof hit === "number") return hit;
  if (!durableAvailable()) return 0;
  try {
    const backend = cacheBackend();
    if (backend === "upstash") {
      const raw = await upstash(["GET", key]);
      return raw === null ? 0 : Number(raw) || 0;
    }
    if (backend === "firestore") {
      const snap = await adminDb().collection(CACHE_COLLECTION).doc(docId(key)).get();
      const data = snap.data() as { n?: number; exp?: number } | undefined;
      if (!snap.exists || (data?.exp ?? 0) < Date.now()) return 0;
      return data?.n ?? 0;
    }
  } catch {
    trip();
  }
  return 0;
}

// ------------------------------- packed vectors ----------------------------- //

/**
 * Vectors are stored packed as base64 float32 rather than as a JSON array. A
 * 1024-dimension vector is 4KB packed against roughly 20KB as decimal strings,
 * and that packing is what keeps a durable-tier round trip cheaper than the API
 * call it replaces.
 */
export function packVector(vector: number[]): string {
  return Buffer.from(new Float32Array(vector).buffer).toString("base64");
}

export function unpackVector(packed: string): number[] {
  const buffer = Buffer.from(packed, "base64");
  return Array.from(
    new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4)
  );
}
