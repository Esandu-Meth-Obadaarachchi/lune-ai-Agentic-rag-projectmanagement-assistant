/**
 * Streaming the agent turn.
 *
 * Every other change in this pipeline cut real time off a request. This one cuts
 * the time the user spends looking at nothing, which is the number they actually
 * feel. Nothing here is faster — the same tools run in the same order — the
 * difference is that the turn reports itself as it happens.
 *
 * What comes down the wire, in order:
 *
 *   meta      the tier and model, as soon as routing is decided
 *   step      each action as it happens, rather than all of them at the end
 *   thinking  reasoning deltas, so the user can watch it work on a hard turn
 *   token     answer text deltas
 *   reset     a tool round started; what has been shown was narration, not answer
 *   card      a task list, a source list, an approval request
 *   replace   the assembled answer changed after the fact (a redaction)
 *   done      the final answer with sources, cards, steps and the grounded verdict
 *   error     something failed; the client shows what it has and stops
 *
 * One detail is easy to get wrong and only shows up against a real stream: a
 * turn that calls a tool produces more than one assistant message. The model
 * often narrates before it acts — "I'll check what tasks are overdue" — and that
 * preamble is a different message from the answer that follows the tool result.
 * Accumulating every delta across the whole loop glues them together, which is
 * how "...across all your workspaces.One task is overdue" happens. The
 * non-streaming path never has this problem because it reads only the final
 * message. Here, a tool round emits `reset` and clears the buffer, so the client
 * shows the narration while it is useful and the stored answer is the final
 * message alone.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { anthropic, planParams, textOf } from "./anthropic";
import { settings } from "./config";
import { recordUsage } from "./usage";
import { planFor, type ModelPlan } from "./router";
import { TOOLS, type ToolContext } from "./tools";
import {
  type AgentMeta,
  type AgentResult,
  buildMessages,
  buildSystem,
  dedupe,
  MAX_TOOL_ROUNDS,
  runToolCalls,
  verifyGrounding,
} from "./agent";
import type { Memory } from "./memory";
import { redactSecrets } from "@/lib/security/guardrails";

/** One server-sent event. The blank line terminates the frame. */
export function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export type Frame = { frame: string; result?: AgentResult };

/**
 * Run the turn, yielding SSE frames as they are produced. The final frame
 * carries the assembled result so the caller can cache it and update memory.
 */
export async function* streamAgent(
  message: string,
  memory: Memory,
  ctx: ToolContext,
  meta: AgentMeta,
  plan: ModelPlan = planFor(message, {
    historyDepth: memory.recent.length,
    hasSummary: memory.hasSummary,
  })
): AsyncGenerator<Frame> {
  ctx.steps.push(`model: ${plan.model} (${plan.tier}, ${plan.reason})`);
  yield { frame: sse("meta", { tier: plan.tier, model: plan.model, reason: plan.reason }) };

  const system = buildSystem(ctx, meta, memory);
  const messages = buildMessages(memory, message);
  const client = anthropic();

  let answer = "";
  const reasoning: string[] = [];
  let sentSteps = 0;
  let sentCards = 0;
  let failed = "";

  /** Flush anything the tools appended to the context since the last check. */
  function* drain(): Generator<Frame> {
    while (sentSteps < ctx.steps.length) {
      yield { frame: sse("step", { text: ctx.steps[sentSteps++] }) };
    }
    while (sentCards < ctx.cards.length) {
      yield { frame: sse("card", ctx.cards[sentCards++]) };
    }
  }

  yield* drain();

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const stream = client.messages.stream({
        ...planParams(plan),
        system,
        tools: TOOLS,
        messages,
      });

      let roundText = "";
      for await (const event of stream) {
        if (event.type !== "content_block_delta") continue;
        if (event.delta.type === "text_delta") {
          roundText += event.delta.text;
          yield { frame: sse("token", { text: event.delta.text }) };
        } else if (event.delta.type === "thinking_delta") {
          yield { frame: sse("thinking", { text: event.delta.thinking }) };
        }
      }

      const resp = await stream.finalMessage();
      recordUsage(plan.model, resp.usage);

      const thought = resp.content
        .filter((b): b is Anthropic.ThinkingBlock => b.type === "thinking")
        .map((b) => b.thinking?.trim() ?? "")
        .filter(Boolean)
        .join("\n\n");
      if (thought) reasoning.push(thought);

      if (resp.stop_reason === "max_tokens") {
        ctx.steps.push("response hit the length limit and was cut off");
        answer =
          `${roundText.trim()}\n\n`.trim() +
          "\n\nMy reply got cut off — that was too much to do in one message. Try a smaller batch (three or four items at a time) and I'll finish each.";
        break;
      }

      const toolUses = resp.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
      );

      if (toolUses.length === 0) {
        answer = textOf(resp.content).trim();
        break;
      }

      // A tool ran, so the assistant text before it was narration rather than
      // the answer. Tell the client to drop it and start the answer fresh.
      if (roundText.trim()) yield { frame: sse("reset", {}) };

      messages.push({ role: "assistant", content: resp.content });
      const results = await runToolCalls(toolUses, ctx);
      messages.push({ role: "user", content: results });
      yield* drain();

      if (ctx.pending) {
        // The relay turn is short and needs no reasoning; it only puts the
        // tool's question into the user's language.
        const relay = client.messages.stream({
          ...planParams({ ...plan, thinking: "none", maxTokens: 400 }),
          system,
          messages,
        });
        let relayText = "";
        for await (const event of relay) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            relayText += event.delta.text;
            yield { frame: sse("token", { text: event.delta.text }) };
          }
        }
        recordUsage(plan.model, (await relay.finalMessage()).usage);
        answer = relayText.trim() || ctx.pending.message;
        break;
      }

      if (round === MAX_TOOL_ROUNDS - 1) {
        ctx.steps.push("hit the tool-round limit");
        answer =
          'I ran out of steps before finishing that. Try fewer items at a time, or reply "continue" and I\'ll carry on.';
      }
    }
  } catch (e) {
    failed = e instanceof Error ? e.message : String(e);
    yield { frame: sse("error", { message: failed }) };
  }

  const sources = dedupe(ctx.sources);
  let grounded: boolean | null = null;

  if (ctx.pending) {
    ctx.cards.push(ctx.pending.card);
    ctx.steps.push(`waiting on the user: ${ctx.pending.kind}`);
    answer = answer || ctx.pending.message;
  } else if (!failed) {
    const verified = await verifyGrounding(answer, sources, ctx);
    if (verified.answer !== answer) {
      // The caveat is appended after the answer has already streamed, so it goes
      // out as its own token frame rather than silently only in `done`.
      yield { frame: sse("token", { text: verified.answer.slice(answer.length) }) };
    }
    answer = verified.answer;
    grounded = verified.grounded;
  }

  if (settings.redactSecretsInAnswers) {
    const { text, found } = redactSecrets(answer);
    if (found.length) {
      // The unredacted text has already been streamed, so the client is told to
      // replace what it has rather than append to it.
      answer = text;
      ctx.steps.push(`redacted from the answer: ${found.join(", ")}`);
      yield { frame: sse("replace", { answer }) };
    }
  }

  yield* drain();

  const result: AgentResult = {
    answer: answer || "I couldn't produce a response for that. Try rephrasing.",
    steps: ctx.steps,
    sources,
    cards: ctx.cards,
    reasoning,
    tier: plan.tier,
    model: plan.model,
    grounded,
  };

  yield {
    frame: sse("done", {
      answer: result.answer,
      sources: result.sources,
      cards: result.cards,
      steps: result.steps,
      reasoning: settings.exposeReasoning ? result.reasoning : [],
      tier: result.tier,
      model: result.model,
      grounded: result.grounded,
    }),
    result,
  };
}
