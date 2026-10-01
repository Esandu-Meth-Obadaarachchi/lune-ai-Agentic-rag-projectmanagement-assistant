import Anthropic from "@anthropic-ai/sdk";
import { wrapAnthropic } from "langsmith/wrappers/anthropic";
import { recordUsage } from "./usage";
import { settings } from "./config";
import type { ModelPlan } from "./router";

/**
 * The Claude client, and the two prompt-shaping helpers every caller needs.
 *
 * Which model. The agent's working model is `CLAUDE_MODEL` (Haiku 4.5 by
 * default — the cheapest tier, and enough for the overwhelming majority of
 * turns). The router escalates per turn; see `router.ts`.
 *
 * Reasoning. Thinking is configured per plan rather than globally, because the
 * two tiers take it differently: Haiku 4.5 takes an explicit token budget and
 * returns its raw reasoning, while the Sonnet tier takes adaptive thinking,
 * decides for itself whether a turn deserves it, and returns a summary — and
 * only if `display` asks for one, since the default there is to return the
 * thinking block empty, which would show the user a long pause and nothing else.
 *
 * Caching. Tools and the system prompt are rendered ahead of the conversation on
 * every request and are byte-identical between turns, so they are the natural
 * cache prefix. Marking the stable half of the system prompt with a cache
 * breakpoint means each turn re-reads it at a fraction of the input price
 * instead of paying for it again. Two rules make this work and both are easy to
 * break by accident: the volatile half — today's date, the project list, the
 * conversation summary — must come after the breakpoint, and the tool list must
 * not be rebuilt in a different order between turns.
 */
export const CLAUDE_MODEL = settings.claudeModel;
export const CLAUDE_FAST_MODEL = settings.claudeFastModel;

let client: Anthropic | null = null;

export function anthropic(): Anthropic {
  if (!client) {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set.");
    const raw = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    // LangSmith tracing. A no-op unless LANGSMITH_TRACING=true and
    // LANGSMITH_API_KEY are set, so it is always safe to wrap.
    client = wrapAnthropic(raw);
  }
  return client;
}

/**
 * A system prompt split at a cache breakpoint.
 *
 * Everything in `stable` is identical between turns and sits inside the cached
 * prefix. Everything in `volatile` — the date, the project list, the
 * conversation summary — comes after it, where a change costs nothing beyond its
 * own tokens. Putting a timestamp in `stable` would silently disable the cache
 * for every request, which is the classic way this feature stops working.
 */
export function cachedSystem(stable: string, volatile = ""): Anthropic.TextBlockParam[] {
  const blocks: Anthropic.TextBlockParam[] = [
    { type: "text", text: stable, cache_control: { type: "ephemeral" } },
  ];
  if (volatile.trim()) blocks.push({ type: "text", text: volatile });
  return blocks;
}

/** The request fields that carry a plan's model, budget and thinking config. */
export function planParams(plan: ModelPlan): {
  model: string;
  max_tokens: number;
  thinking?: Anthropic.ThinkingConfigParam;
  output_config?: { effort: "low" | "medium" | "high" };
} {
  const params: ReturnType<typeof planParams> = {
    model: plan.model,
    max_tokens: plan.maxTokens,
  };
  if (plan.thinking === "budget") {
    params.thinking = { type: "enabled", budget_tokens: settings.thinkingBudgetTokens };
  } else if (plan.thinking === "adaptive") {
    // `display` is set explicitly: the default on this tier is to return the
    // thinking block empty, so the UI would show a pause and no reasoning.
    params.thinking = { type: "adaptive", display: "summarized" };
    params.output_config = { effort: settings.deepEffort };
  }
  return params;
}

/** Flatten message content (a string, or a list of blocks) to its text. */
export function textOf(content: Anthropic.ContentBlock[] | string): string {
  if (typeof content === "string") return content;
  return content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

/**
 * Pull the reasoning out of a message.
 *
 * Redacted blocks carry encrypted bytes with no readable text and are skipped
 * rather than shown as noise.
 */
export function thinkingOf(content: Anthropic.ContentBlock[] | string): string {
  if (typeof content === "string") return "";
  return content
    .filter((b): b is Anthropic.ThinkingBlock => b.type === "thinking")
    .map((b) => b.thinking?.trim() ?? "")
    .filter(Boolean)
    .join("\n\n");
}

/**
 * One-shot completion on the fast model, no reasoning.
 *
 * Used by the retrieval helpers — query rewrite, grading, groundedness — and by
 * the memory summariser. These want a short string back as cheaply as possible,
 * so they never inherit the turn's tier.
 */
export async function complete(
  prompt: string,
  opts: { system?: string; maxTokens?: number; model?: string } = {}
): Promise<string> {
  const model = opts.model ?? CLAUDE_FAST_MODEL;
  const resp = await anthropic().messages.create({
    model,
    max_tokens: opts.maxTokens ?? 256,
    system: opts.system,
    messages: [{ role: "user", content: prompt }],
  });
  recordUsage(model, resp.usage);
  return textOf(resp.content).trim();
}
