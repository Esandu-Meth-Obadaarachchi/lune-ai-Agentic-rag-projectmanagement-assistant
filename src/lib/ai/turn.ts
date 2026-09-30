/**
 * Everything an agent turn needs, resolved once for both chat endpoints.
 *
 * The streaming and non-streaming routes differ only in how they deliver the
 * answer, so scope loading, sanitising, rate limiting, memory, the example
 * library and the post-turn bookkeeping live here rather than twice.
 *
 * Two things wrap the agent run.
 *
 * In front of it, the answer cache. An exact repeat is served without touching a
 * model at all; a reworded repeat is caught by the semantic layer, which reuses
 * the query embedding retrieval would have needed anyway, so a miss costs
 * nothing. Both are keyed on the caller and on exactly which projects they can
 * see, so a cached answer can never cross a permission boundary, and on a data
 * version that any write bumps, so a new task invalidates the user's cached
 * answers at once.
 *
 * Behind it, the bookkeeping. Storing the answer and rebuilding the conversation
 * summary both happen after the response has been handed to the client, because
 * neither should ever sit between the user and their answer.
 */
import { loadUserScope } from "./server";
import { buildMemory, refreshMemory, type ChatTurn, type Memory } from "./memory";
import { embedQuery } from "./voyage";
import { loadExamples, newToolContext, type ToolContext } from "./tools";
import type { AgentMeta, AgentResult } from "./agent";
import { settings } from "./config";
import * as semantic from "@/lib/cache/semantic";
import { checkChat } from "@/lib/security/limits";
import { sanitiseInput } from "@/lib/security/guardrails";
import { MAX_CHAT_INPUT_CHARS } from "@/lib/constants";

export interface Turn {
  message: string;
  ctx: ToolContext;
  meta: AgentMeta;
  memory: Memory;
  /** A hash of exactly which projects this caller can see. Part of every cache key. */
  scope: string;
}

export interface AuthedUser {
  uid: string;
  email?: string | null;
  name?: string | null;
}

/**
 * The cheap half of setup: rate limit and clean the message.
 *
 * Split out from the rest because both of its failures are HTTP status codes
 * (429, 400), which have to be decided before a streaming response begins. It
 * touches no network beyond the rate-limit counter, so the streaming route can
 * run it first, open the stream, and do the expensive half inside — which is
 * what lets the first frame land immediately instead of after a scope load.
 */
export async function beginTurn(body: { message: string }, user: AuthedUser): Promise<string> {
  await checkChat(user.uid);
  // Strips zero-width and bidirectional characters, which render as nothing on
  // screen while still reaching the model as text.
  const message = sanitiseInput(body.message, MAX_CHAT_INPUT_CHARS);
  if (!message) throw new Response("message is required", { status: 400 });
  return message;
}

/** The expensive half: scope, memory and the example library. */
export async function prepareTurn(
  body: { message: string; workspaceId?: string; projectId?: string; history?: ChatTurn[] },
  user: AuthedUser,
  prepared?: string
): Promise<Turn> {
  const message = prepared ?? (await beginTurn(body, user));

  // The agent's scope is everything the user can access, across ALL workspaces.
  // workspaceId/projectId are just the current view (defaults + prompt naming).
  const { workspaces, projects } = await loadUserScope(user.uid);
  const workspaceName = (id?: string) =>
    workspaces.find((w) => w.id === id)?.name ?? "Workspace";

  const ctx = newToolContext({
    uid: user.uid,
    userName: user.name ?? "You",
    currentWorkspaceId: body.workspaceId,
    currentProjectId: body.projectId,
    projects: projects.map((p) => ({
      id: p.id,
      name: p.name,
      ragNamespace: p.ragNamespace,
      workspaceId: p.workspaceId,
      memberIds: p.memberIds ?? [],
    })),
  });

  // Project list grouped by workspace, so the agent knows what spans where.
  const grouped = new Map<string, string[]>();
  for (const p of projects) {
    const key = workspaceName(p.workspaceId);
    grouped.set(key, [...(grouped.get(key) ?? []), p.name]);
  }
  const projectList = [...grouped.entries()]
    .map(([ws, names]) => `${ws}:\n${names.map((n) => `  - ${n}`).join("\n")}`)
    .join("\n");

  const meta: AgentMeta = {
    workspaceName: body.workspaceId ? workspaceName(body.workspaceId) : "your workspaces",
    projectName: projects.find((p) => p.id === body.projectId)?.name,
    projectList,
  };

  const memory = await buildMemory(user.uid, body.history ?? []);

  try {
    // The format library, so the agent matches how this user writes instead of
    // asking for an example it has already been given.
    ctx.examples = await loadExamples(user.uid);
  } catch {
    /* an empty library just means it will ask */
  }

  return {
    message,
    ctx,
    meta,
    memory,
    scope: semantic.scopeHash(projects.map((p) => p.id)),
  };
}

/**
 * Exact match first, then semantic. Returns the hit and the query embedding.
 *
 * The embedding is handed back because retrieval would have computed it anyway,
 * so a miss has cost nothing beyond the lookup itself.
 */
export async function lookupCached(
  turn: Turn,
  uid: string
): Promise<{ cached: semantic.CachedAnswer | null; embedding: number[] | null }> {
  let cached = await semantic.lookupExact(uid, turn.scope, turn.message);
  let embedding: number[] | null = null;
  if (!cached && settings.semanticCacheEnabled) {
    try {
      embedding = await embedQuery(turn.message);
      cached = await semantic.lookupSemantic(uid, turn.scope, turn.message, embedding);
    } catch {
      /* a cache miss is the correct fallback */
    }
  }
  return { cached, embedding };
}

/**
 * Post-turn bookkeeping. Awaited by the caller only after the response body has
 * been produced, never before it.
 */
export async function finishTurn(options: {
  turn: Turn;
  uid: string;
  result: AgentResult;
  history: ChatTurn[];
  embedding: number[] | null;
}): Promise<void> {
  const { turn, uid, result, history, embedding } = options;

  const fullHistory: ChatTurn[] = [
    ...history,
    { role: "user", content: turn.message },
    { role: "assistant", content: result.answer },
  ];

  const jobs: Promise<unknown>[] = [refreshMemory(uid, fullHistory)];

  if (turn.ctx.wrote) {
    // A write makes every cached answer for this user potentially wrong, and
    // this reply itself describes a change, so neither is kept.
    jobs.push(semantic.bumpDataVersion(uid));
  } else if (!turn.ctx.pending) {
    // A question or a held plan is not an answer worth replaying either.
    jobs.push(
      semantic.storeAnswer(uid, turn.scope, turn.message, {
        answer: result.answer,
        steps: result.steps,
        sources: result.sources,
        cards: result.cards,
        embedding,
      })
    );
  }

  await Promise.allSettled(jobs);
}
