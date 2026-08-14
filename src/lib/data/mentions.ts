import type { Assignee } from "@/lib/types";

/**
 * Mentions are stored as `@[Display Name](uid)` inside the comment body.
 *
 * The uid travels with the text, so a mention keeps pointing at the right
 * person after a rename, and notification fan-out needs no lookup against a
 * member list that may have changed since.
 */

const MENTION = /@\[([^\]]+)\]\(([^)]+)\)/g;

export interface MentionSpan {
  type: "text" | "mention";
  text: string;
  uid?: string;
}

/** Split a stored body into plain text and mention spans, for rendering. */
export function parseMentions(body: string): MentionSpan[] {
  const out: MentionSpan[] = [];
  let last = 0;
  for (const m of body.matchAll(MENTION)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ type: "text", text: body.slice(last, at) });
    out.push({ type: "mention", text: m[1], uid: m[2] });
    last = at + m[0].length;
  }
  if (last < body.length) out.push({ type: "text", text: body.slice(last) });
  return out;
}

/** uids mentioned in a body. Denormalised onto the entry so fan-out is a read. */
export function extractMentions(body: string): string[] {
  return [...new Set([...body.matchAll(MENTION)].map((m) => m[2]))];
}

/** The stored form for one mention. */
export function encodeMention(person: { id: string; name: string }): string {
  return `@[${person.name}](${person.id})`;
}

/** Body as a human reads it, used for notification excerpts and search. */
export function plainText(body: string): string {
  return body.replace(MENTION, "@$1");
}

/**
 * The active `@` token at a cursor position, if the caret sits inside one.
 * Returns the query typed so far and the range to replace on selection.
 * Bails when the token contains whitespace, so an email or a sentence
 * containing "@" does not open the picker.
 */
export function mentionQueryAt(
  value: string,
  caret: number
): { query: string; start: number; end: number } | null {
  const before = value.slice(0, caret);
  const at = before.lastIndexOf("@");
  if (at < 0) return null;
  // Must start the text or follow whitespace, otherwise it is part of a word.
  if (at > 0 && !/\s/.test(before[at - 1])) return null;
  const token = before.slice(at + 1);
  if (/\s/.test(token)) return null;
  // Already a completed mention.
  if (token.startsWith("[")) return null;
  return { query: token, start: at, end: caret };
}

/** People who match a mention query, ranked by prefix then substring. */
export function rankPeople<T extends Assignee>(people: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return people.slice(0, 8);
  return people
    .map((p) => {
      const n = p.name.toLowerCase();
      const score = n.startsWith(q) ? 0 : n.includes(q) ? 1 : -1;
      return { p, score };
    })
    .filter((x) => x.score >= 0)
    .sort((a, b) => a.score - b.score || a.p.name.localeCompare(b.p.name))
    .slice(0, 8)
    .map((x) => x.p);
}
