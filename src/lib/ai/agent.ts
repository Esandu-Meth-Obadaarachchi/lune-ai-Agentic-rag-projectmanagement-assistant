/**
 * The agent — a Claude tool-use loop.
 *
 * Build the persona, hand the model the recent turns over a summary of the older
 * ones, let it call tools until it has an answer, then check that answer against
 * the sources it used.
 *
 * What this layer adds over a plain tool loop:
 *
 * Tiering       The router picks the model and the reasoning budget per turn, so
 *               a lookup does not pay for a planning turn's thinking.
 * Visible CoT   Reasoning blocks are collected off every assistant message in
 *               the loop and returned alongside the answer, so the UI can show
 *               the work rather than a spinner.
 * Cached prompt The stable half of the system prompt carries a cache breakpoint,
 *               so tools and persona are re-read at a fraction of the input
 *               price each turn instead of being paid for again.
 * Parallel      Several tool calls in one assistant message run concurrently and
 *               come back in one user message, which is both faster and what the
 *               API expects — splitting the results across messages teaches the
 *               model to stop making parallel calls.
 * Asking        A tool can hand a question or an approval request back to the
 *               user instead of acting. That is not an error path — it is how
 *               the agent avoids guessing — so it travels as a flag on the
 *               context rather than as a thrown error the loop would feed back
 *               to the model as a tool failure.
 *
 * The groundedness check stays where it was, but it now only runs when the
 * answer actually drew on documents, and it never blocks the reply.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { anthropic, cachedSystem, planParams, textOf, thinkingOf } from "./anthropic";
import { settings } from "./config";
import { recordUsage } from "./usage";
import { buildVolatile, STABLE_SYSTEM } from "./persona";
import { checkGrounded } from "./retrieval";
import { planFor, type ModelPlan } from "./router";
import { executeTool, TOOLS, type ToolContext } from "./tools";
import type { Memory } from "./memory";
import type { AgentCard, RetrievedChunk } from "@/lib/types";

/** Ceiling on tool-loop iterations. Headroom for a batch create_tasks without
 *  letting a confused turn spend money indefinitely. */
export const MAX_TOOL_ROUNDS = 6;

export interface AgentTurn {
  role: "user" | "assistant";
  content: string;
}

export interface AgentResult {
  answer: string;
  steps: string[];
  sources: RetrievedChunk[];
  cards: AgentCard[];
  reasoning: string[];
  tier: string;
  model: string;
  grounded: boolean | null;
}

export interface AgentMeta {
  workspaceName: string;
  projectName?: string;
  projectList: string;
}

export function dedupe(chunks: RetrievedChunk[]): RetrievedChunk[] {
  const seen = new Set<string>();
  return chunks.filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));
}

function summarizeArgs(input: Record<string, unknown>): string {
  return Object.entries(input)
    .map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join(", ");
}

/** The messages array for a turn: recent history, then this question. */
export function buildMessages(memory: Memory, message: string): Anthropic.MessageParam[] {
  return [
    ...memory.recent.map((turn) => ({ role: turn.role, content: turn.content })),
    { role: "user" as const, content: message },
  ];
}

export function buildSystem(ctx: ToolContext, meta: AgentMeta, memory: Memory) {
  return cachedSystem(
    STABLE_SYSTEM,
    buildVolatile({
      userName: ctx.userName,
      workspaceName: meta.workspaceName,
      projectName: meta.projectName,
      today: new Date().toISOString().slice(0, 10),
      projectList: meta.projectList,
      conversationSummary: memory.summary,
    })
  );
}

/**
 * Run every tool call in one assistant message, concurrently, and return the
 * results in the order the model asked for them.
 *
 * Order matters: the API pairs each result to its call by id, but keeping the
 * order also keeps the transcript readable when something goes wrong.
 */
export async function runToolCalls(
  toolUses: Anthropic.ToolUseBlock[],
  ctx: ToolContext
): Promise<Anthropic.ToolResultBlockParam[]> {
  return Promise.all(
    toolUses.map(async (block) => {
      const input = (block.input ?? {}) as Record<string, unknown>;
      ctx.steps.push(`${block.name}(${summarizeArgs(input)})`);
      try {
        const content = await executeTool(block.name, input, ctx);
        return { type: "tool_result" as const, tool_use_id: block.id, content };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        ctx.steps.push(`${block.name} failed: ${message}`);
        // Returned as an error result rather than thrown: the model can often
        // recover by calling a different tool, and dropping the result entirely
        // would leave the conversation in a shape the API rejects.
        return {
          type: "tool_result" as const,
          tool_use_id: block.id,
          content: `Tool error: ${message}`,
          is_error: true,
        };
      }
    })
  );
}

/** Verify the answer against its sources, and caveat it if it does not hold. */
export async function verifyGrounding(
  answer: string,
  sources: RetrievedChunk[],
  ctx: ToolContext
): Promise<{ answer: string; grounded: boolean | null }> {
  if (sources.length === 0 || !answer || !settings.groundednessCheckEnabled) {
    return { answer, grounded: null };
  }
  try {
    const grounded = await checkGrounded(answer, sources);
    ctx.steps.push(
      grounded
        ? `groundedness: passed (${sources.length} source(s))`
        : "groundedness: some claims unverified"
    );
    return {
      answer: grounded
        ? answer
        : `${answer}\n\n_Note: parts of this answer may not be fully backed by your documents._`,
      grounded,
    };
  } catch {
    // A failed check must never fail the reply.
    return { answer, grounded: null };
  }
}

export async function runAgent(
  message: string,
  memory: Memory,
  ctx: ToolContext,
  meta: AgentMeta,
  plan: ModelPlan = planFor(message, {
    historyDepth: memory.recent.length,
    hasSummary: memory.hasSummary,
  })
): Promise<AgentResult> {
  ctx.steps.push(`model: ${plan.model} (${plan.tier}, ${plan.reason})`);

  const system = buildSystem(ctx, meta, memory);
  const messages = buildMessages(memory, message);
  const reasoning: string[] = [];
  const client = anthropic();

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const resp = await client.messages.create({
      ...planParams(plan),
      system,
      tools: TOOLS,
      messages,
    });
    recordUsage(plan.model, resp.usage);

    // A multi-tool turn thinks more than once — before choosing a tool, and
    // again once results come back — and the second pass is usually the
    // interesting one, so every block is kept in order rather than only the last.
    const thought = thinkingOf(resp.content);
    if (thought) reasoning.push(thought);

    // Cut off mid-response, almost always a create_tasks call too big for the
    // turn's token budget. A truncated tool call cannot be executed, so stop and
    // say so plainly instead of returning an empty answer.
    if (resp.stop_reason === "max_tokens") {
      ctx.steps.push("response hit the length limit and was cut off");
      const partial = textOf(resp.content).trim();
      return {
        answer:
          (partial ? `${partial}\n\n` : "") +
          "My reply got cut off — that was too much to do in one message. Try a smaller batch (three or four items at a time) and I'll finish each. Anything already created is shown below.",
        steps: ctx.steps,
        sources: dedupe(ctx.sources),
        cards: ctx.cards,
        reasoning,
        tier: plan.tier,
        model: plan.model,
        grounded: null,
      };
    }

    const toolUses = resp.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );

    // No tool calls -> this is the final answer.
    if (toolUses.length === 0) {
      const sources = dedupe(ctx.sources);
      let answer = textOf(resp.content).trim();

      // A tool decided it needed the user before going further. The model is
      // told to relay the question as its whole reply and normally does; the
      // fallback covers the case where it answers around the question instead.
      if (ctx.pending) {
        ctx.cards.push(ctx.pending.card);
        ctx.steps.push(`waiting on the user: ${ctx.pending.kind}`);
        return {
          answer: answer || ctx.pending.message,
          steps: ctx.steps,
          sources,
          cards: ctx.cards,
          reasoning,
          tier: plan.tier,
          model: plan.model,
          grounded: null,
        };
      }

      const verified = await verifyGrounding(answer, sources, ctx);
      answer =
        verified.answer ||
        "I couldn't produce a response for that. Try rephrasing, or breaking it into a smaller request.";
      return {
        answer,
        steps: ctx.steps,
        sources,
        cards: ctx.cards,
        reasoning,
        tier: plan.tier,
        model: plan.model,
        grounded: verified.grounded,
      };
    }

    messages.push({ role: "assistant", content: resp.content });
    messages.push({ role: "user", content: await runToolCalls(toolUses, ctx) });

    // A tool asked for the user. Let the model write one more message to relay
    // the question, rather than continuing to act on an ambiguity.
    if (ctx.pending) {
      const relay = await client.messages.create({
        ...planParams({ ...plan, thinking: "none", maxTokens: 400 }),
        system,
        messages,
      });
      recordUsage(plan.model, relay.usage);
      ctx.cards.push(ctx.pending.card);
      ctx.steps.push(`waiting on the user: ${ctx.pending.kind}`);
      return {
        answer: textOf(relay.content).trim() || ctx.pending.message,
        steps: ctx.steps,
        sources: dedupe(ctx.sources),
        cards: ctx.cards,
        reasoning,
        tier: plan.tier,
        model: plan.model,
        grounded: null,
      };
    }
  }

  return {
    answer:
      'I ran out of steps before finishing that. It was a big request — try fewer items at a time, or reply "continue" and I\'ll carry on. Anything created so far is shown below.',
    steps: ctx.steps,
    sources: dedupe(ctx.sources),
    cards: ctx.cards,
    reasoning,
    tier: plan.tier,
    model: plan.model,
    grounded: null,
  };
}
