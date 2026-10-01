/**
 * Per-user rate limiting.
 *
 * An agent turn can cost several model calls, a rerank and a handful of Pinecone
 * queries. A loop in a client, a stuck retry, or a shared account being hammered
 * turns that into a bill before anyone notices, so each user gets a budget.
 *
 * A fixed window over a counter rather than a sliding log or a token bucket: one
 * increment per request, no read-modify-write race, and the failure mode of a
 * fixed window — up to twice the limit across a boundary — is irrelevant at this
 * scale.
 *
 * With no durable cache tier the counter falls back to the in-process one, which
 * limits per instance rather than per user. That is weaker but still bounds a
 * runaway client, and it is the right trade against refusing traffic when the
 * cache is down.
 */
import { settings } from "@/lib/ai/config";
import { cacheIncr, cacheKey } from "@/lib/cache/store";

/** Thrown when a caller is over budget. The route turns it into a 429. */
export class RateLimited extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super(`Too many requests. Try again in ${retryAfterSeconds}s.`);
    this.name = "RateLimited";
  }
}

async function check(
  bucket: string,
  uid: string,
  limit: number,
  perSeconds: number
): Promise<void> {
  if (limit <= 0) return;
  const window = Math.floor(Date.now() / 1000 / perSeconds);
  const used = await cacheIncr(cacheKey("rate", bucket, uid, window), perSeconds + 5);
  if (used > limit) {
    const elapsed = Math.floor(Date.now() / 1000) % perSeconds;
    throw new RateLimited(Math.max(1, perSeconds - elapsed));
  }
}

export function checkChat(uid: string): Promise<void> {
  return check("chat", uid, settings.rateLimitChatPerMinute, 60);
}

export function checkIngest(uid: string): Promise<void> {
  return check("ingest", uid, settings.rateLimitIngestPerHour, 3600);
}
