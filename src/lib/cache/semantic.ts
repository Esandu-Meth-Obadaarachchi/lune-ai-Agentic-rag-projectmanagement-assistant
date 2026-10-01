/**
 * Answer caching: exact first, then semantic, with correctness guards.
 *
 * Most of what an assistant is asked in a working week is a repeat. "What's
 * overdue", "what did we decide about the rectifier interval", "summarise
 * PowerZenith" — the same question in slightly different words, days apart.
 * Serving those from cache turns a multi-second agent run into a lookup, and it
 * costs nothing in tokens.
 *
 * The danger with caching an agent is not staleness, it is wrongness: returning
 * a task list that changed thirty seconds ago, or replaying an answer produced
 * under different permissions. Four guards handle that.
 *
 * Scope       The key includes a hash of exactly which projects the caller can
 *             see. Two users asking the same question never share an entry.
 * Versioning  Every write bumps a per-user data version that is part of the key,
 *             so creating a task invalidates that user's cached answers at once
 *             rather than waiting out a TTL.
 * Intent      Replies produced by a tool that wrote something are never cached,
 *             and questions about now get a short TTL.
 * Similarity  A semantic hit needs cosine similarity above a deliberately high
 *             threshold. Near-misses are worse than misses: "what is due today"
 *             and "what was due today" are 0.94 apart and mean different things.
 *
 * The semantic check reuses the query embedding retrieval needs anyway, so a
 * miss has cost nothing.
 */
import { createHash } from "crypto";
import { settings } from "@/lib/ai/config";
import { cacheGetInt, cacheGetJson, cacheIncr, cacheKey, cacheSetJson } from "./store";
import type { AgentCard, RetrievedChunk } from "@/lib/types";

/** Phrasing that makes an answer true only for the next few minutes. */
const TIME_SENSITIVE =
  /\b(today|tonight|now|currently|overdue|this week|this morning|right now|latest|so far)\b/i;

/** Collapse the differences that should not produce a separate entry. */
export function normalise(question: string): string {
  return question.trim().toLowerCase().replace(/\s+/g, " ").replace(/[?.!\s]+$/, "");
}

export function scopeHash(projectIds: string[]): string {
  return createHash("sha256")
    .update([...projectIds].sort().join("|"))
    .digest("hex")
    .slice(0, 12);
}

export function isTimeSensitive(question: string): boolean {
  return TIME_SENSITIVE.test(question);
}

export interface CachedAnswer {
  answer: string;
  steps: string[];
  sources: RetrievedChunk[];
  cards: AgentCard[];
  question: string;
  ageSeconds: number;
}

interface StoredAnswer {
  answer: string;
  steps: string[];
  sources: RetrievedChunk[];
  cards: AgentCard[];
  question: string;
  at: number;
}

interface IndexEntry {
  /** the entry key */
  k: string;
  /** the question's embedding, rounded to keep the index small */
  e: number[];
}

// ----------------------------- the data version ----------------------------- //

function versionKey(uid: string): string {
  return cacheKey("dataver", uid);
}

export function dataVersion(uid: string): Promise<number> {
  return cacheGetInt(versionKey(uid));
}

/** Called after any write. Every cached answer for this user is now unreachable. */
export function bumpDataVersion(uid: string): Promise<number> {
  return cacheIncr(versionKey(uid), settings.cacheVersionTtlSeconds);
}

// -------------------------------- exact cache -------------------------------- //

function entryKey(uid: string, scope: string, version: number, question: string): string {
  const d = createHash("sha256").update(normalise(question)).digest("hex").slice(0, 20);
  return cacheKey("qa", uid, scope, version, d);
}

function indexKey(uid: string, scope: string, version: number): string {
  return cacheKey("qaindex", uid, scope, version);
}

export async function lookupExact(
  uid: string,
  scope: string,
  question: string
): Promise<CachedAnswer | null> {
  if (!settings.answerCacheEnabled) return null;
  const version = await dataVersion(uid);
  return toAnswer(await cacheGetJson<StoredAnswer>(entryKey(uid, scope, version, question)));
}

// ------------------------------- semantic cache ------------------------------ //

/**
 * The nearest cached question above the similarity threshold, if any.
 *
 * The index is a small list of (embedding, key) for this user and scope at this
 * data version, bounded by `answerCacheIndexSize`, so the whole comparison is a
 * few thousand multiplications against an in-memory array.
 */
export async function lookupSemantic(
  uid: string,
  scope: string,
  question: string,
  embedding: number[]
): Promise<CachedAnswer | null> {
  if (!settings.answerCacheEnabled || !settings.semanticCacheEnabled) return null;
  const version = await dataVersion(uid);
  const index = (await cacheGetJson<IndexEntry[]>(indexKey(uid, scope, version))) ?? [];
  if (index.length === 0) return null;

  const queryNorm = Math.hypot(...embedding) || 1;
  let bestScore = -1;
  let bestKey = "";
  for (const entry of index) {
    let dot = 0;
    let norm = 0;
    for (let i = 0; i < entry.e.length && i < embedding.length; i++) {
      dot += entry.e[i] * embedding[i];
      norm += entry.e[i] * entry.e[i];
    }
    const score = dot / ((Math.sqrt(norm) || 1) * queryNorm);
    if (score > bestScore) {
      bestScore = score;
      bestKey = entry.k;
    }
  }
  if (bestScore < settings.semanticCacheThreshold) return null;
  return toAnswer(await cacheGetJson<StoredAnswer>(bestKey));
}

/** Cache one answer, and index its embedding for semantic lookup. */
export async function storeAnswer(
  uid: string,
  scope: string,
  question: string,
  payload: {
    answer: string;
    steps: string[];
    sources: RetrievedChunk[];
    cards: AgentCard[];
    embedding?: number[] | null;
  }
): Promise<void> {
  if (!settings.answerCacheEnabled || !payload.answer.trim()) return;

  const ttl = isTimeSensitive(question)
    ? settings.answerCacheVolatileTtlSeconds
    : settings.answerCacheTtlSeconds;
  const version = await dataVersion(uid);
  const key = entryKey(uid, scope, version, question);

  await cacheSetJson(
    key,
    {
      answer: payload.answer,
      steps: payload.steps,
      sources: payload.sources,
      cards: payload.cards,
      question,
      at: Date.now(),
    } satisfies StoredAnswer,
    ttl
  );

  if (!payload.embedding || !settings.semanticCacheEnabled) return;
  const iKey = indexKey(uid, scope, version);
  const index = (await cacheGetJson<IndexEntry[]>(iKey)) ?? [];
  const next = index
    .filter((entry) => entry.k !== key)
    .concat({ k: key, e: payload.embedding.map((x) => Math.round(x * 1e5) / 1e5) });
  // Newest wins; the list is bounded so the index cannot grow without limit.
  await cacheSetJson(iKey, next.slice(-settings.answerCacheIndexSize), ttl);
}

function toAnswer(payload: StoredAnswer | null): CachedAnswer | null {
  if (!payload?.answer) return null;
  return {
    answer: payload.answer,
    steps: payload.steps ?? [],
    sources: payload.sources ?? [],
    cards: payload.cards ?? [],
    question: payload.question ?? "",
    ageSeconds: Math.max(0, Math.round((Date.now() - (payload.at ?? 0)) / 1000)),
  };
}
