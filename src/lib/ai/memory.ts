/**
 * Conversation memory: a short verbatim window over a rolling summary.
 *
 * The old agent sent the last five turns and dropped everything before them. Two
 * problems with that. A long conversation loses its own beginning — the project
 * being discussed, the constraint agreed ten turns ago, the format the user
 * asked for — and the model starts contradicting decisions it already made. And
 * five full turns of a task-heavy conversation is a lot of tokens to resend on
 * every request, each one re-read at full price.
 *
 * So memory is split by how it is used:
 *
 * Recent    The last three (question, answer) pairs, verbatim. Anaphora lives
 *           here — "make that one high priority", "no, the other project" — and
 *           it only resolves against exact wording.
 * Summary   Everything older, compressed into a running brief: what the
 *           conversation is about, what was decided, what was created or
 *           changed, and any standing preference the user expressed. Regenerated
 *           only when turns fall out of the window, and cached, so a normal turn
 *           pays nothing for it.
 *
 * The summary is built after the reply has been sent, never before it, so
 * maintaining memory never delays an answer.
 */
import { createHash } from "crypto";
import { settings } from "./config";
import { complete } from "./anthropic";
import { cacheGetJson, cacheKey, cacheSetJson } from "@/lib/cache/store";

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

const SUMMARY_PROMPT = `Below is the earlier part of a conversation between a user and their assistant.

Write a brief that lets the assistant continue without re-reading it. Cover only what still matters:
- What the conversation is about, and which projects, people or documents it concerns.
- Decisions made and conclusions reached.
- Tasks created, updated or discussed, by name.
- Any standing instruction or preference the user gave about how to answer.
- Anything left open or promised.

Under 200 words. Plain statements, no preamble, no bullet character noise. If nothing of substance happened, reply with exactly: NOTHING

<conversation>
{transcript}
</conversation>`;

/** What the agent is given about the conversation so far. */
export interface Memory {
  recent: ChatTurn[];
  summary: string;
  hasSummary: boolean;
}

type Pair = [ChatTurn, ChatTurn | null];

/** Group a flat turn list into (user, assistant) pairs, in order. */
function toPairs(history: ChatTurn[]): Pair[] {
  const pairs: Pair[] = [];
  let pending: ChatTurn | null = null;
  for (const turn of history) {
    if (turn.role === "user") {
      if (pending) pairs.push([pending, null]);
      pending = turn;
    } else if (pending) {
      pairs.push([pending, turn]);
      pending = null;
    }
  }
  if (pending) pairs.push([pending, null]);
  return pairs;
}

function transcriptOf(pairs: Pair[]): string {
  const lines: string[] = [];
  for (const [question, answer] of pairs) {
    lines.push(`User: ${question.content.trim()}`);
    if (answer) lines.push(`Assistant: ${answer.content.trim()}`);
  }
  return lines.join("\n\n");
}

/**
 * Keyed by the content being summarised, so the same prefix is summarised once.
 *
 * Turn count alone would not do: two conversations twelve turns deep are not the
 * same conversation, and a key that ignores content would serve one's summary to
 * the other.
 */
function summaryKey(uid: string, pairs: Pair[]): string {
  const d = createHash("sha256").update(transcriptOf(pairs)).digest("hex").slice(0, 20);
  return cacheKey("memsum", uid, d);
}

function flatten(pairs: Pair[]): ChatTurn[] {
  const turns: ChatTurn[] = [];
  for (const [question, answer] of pairs) {
    turns.push(question);
    if (answer) turns.push(answer);
  }
  return turns;
}

/**
 * Assemble memory for this turn. Reads the cached summary, never writes one.
 *
 * Writing here would put a model call in front of the user's answer. On the rare
 * turn where the summary has not been built yet, the agent runs on the recent
 * window alone and the summary is written afterwards, ready for the next turn.
 */
export async function buildMemory(uid: string, history: ChatTurn[]): Promise<Memory> {
  const pairs = toPairs(history);
  const window = settings.memoryRecentPairs;

  if (pairs.length <= window) {
    return { recent: flatten(pairs), summary: "", hasSummary: false };
  }

  const older = pairs.slice(0, -window);
  const recent = pairs.slice(-window);
  const summary = (await cacheGetJson<string>(summaryKey(uid, older))) ?? "";
  return { recent: flatten(recent), summary, hasSummary: Boolean(summary.trim()) };
}

/**
 * Build and cache the summary of everything outside the recent window.
 *
 * Called after the response is sent. Returns the summary text, or "" when the
 * conversation is still short enough not to need one.
 */
export async function refreshMemory(uid: string, history: ChatTurn[]): Promise<string> {
  const pairs = toPairs(history);
  if (pairs.length <= settings.memoryRecentPairs) return "";

  const older = pairs.slice(0, -settings.memoryRecentPairs);
  const key = summaryKey(uid, older);
  const existing = await cacheGetJson<string>(key);
  if (existing) return existing;

  let transcript = transcriptOf(older);
  if (transcript.length > settings.memoryMaxTranscriptChars) {
    // Keep the tail: the oldest turns are the least likely to still matter, and
    // this only bites on conversations far past a normal session.
    transcript = transcript.slice(-settings.memoryMaxTranscriptChars);
  }

  let summary = "";
  try {
    summary = (await complete(SUMMARY_PROMPT.replace("{transcript}", transcript), {
      maxTokens: 400,
    })).trim();
  } catch {
    // Memory is an optimisation, not a requirement.
    return "";
  }

  if (!summary || summary.toUpperCase().startsWith("NOTHING")) summary = "";
  await cacheSetJson(key, summary, settings.memorySummaryTtlSeconds);
  return summary;
}
