/**
 * Choosing how hard to think, per turn.
 *
 * Running every turn on the strongest model with reasoning enabled is the easy
 * way to good answers and the fastest way to a slow, expensive assistant.
 * "What's overdue" needs one tool call and no reasoning at all; "break the
 * Ceylon Green Crest build into phases with dependencies and dates" needs both.
 * Charging the first the price of the second is the mistake this avoids.
 *
 * Three tiers:
 *
 *   fast      Haiku 4.5, no reasoning. Lookups, single tool calls, confirmations.
 *   reasoned  Haiku 4.5 with a thinking budget. Multi-step work, several tools,
 *             anything where the order of operations matters.
 *   deep      Sonnet with adaptive thinking. Planning, comparison, judgement
 *             calls — the turns where the reasoning is the deliverable.
 *
 * The classifier is deliberately a heuristic and not a model call. A model call
 * to decide how much model to use costs the latency it is meant to save, and it
 * would sit on the critical path of every single turn. Heuristics are free,
 * deterministic and testable, and the cost of getting one wrong is small in both
 * directions: an over-promoted lookup wastes a fraction of a cent, an
 * under-promoted plan produces a slightly flatter answer.
 *
 * The two thinking configurations differ because the models do. Haiku 4.5 takes
 * an explicit `budget_tokens`. The Sonnet tier rejects a budget outright and
 * takes adaptive thinking plus an effort level instead.
 */
import { settings } from "./config";

export type Tier = "fast" | "reasoned" | "deep";

/** Verbs and phrases that describe work with steps in it, rather than a question
 *  with an answer. These separate "tell me X" from "work out X". */
const PLANNING =
  // "break X into phases" and "split Y into steps" are the most common way a
  // planning request is phrased, and neither contains the word "plan", so
  // matching the verb-plus-"into" shape catches what a keyword list misses.
  /\b(plan|planning|breakdown|roadmap|schedule|sequence|strategy|design|architect|restructure|reorganise|reorganize|prioriti[sz]e|estimate|forecast|trade[- ]?off|approach)\b|\b(?:break|split|divide|carve)\b[^.\n]{0,40}\b(?:down|into)\b/i;
const ANALYTICAL =
  /\b(compare|contrast|versus|vs\.?|why|analyse|analyze|evaluate|assess|implications?|pros and cons|should (?:i|we)|recommend|decide|risk)\b/i;
/** Several things asked for at once, or several things to be created. */
const MULTI =
  /\b(and then|after that|also|as well as|each|every|all (?:of )?(?:the|my)|then\s+\w+\s+(?:it|them)|subtasks?|milestones?|phases?)\b/i;
const SUMMARY = /\b(summari[sz]e|summary|overview|brief me|catch me up|status of)\b/i;

/** A question this short with no planning language is a lookup, whatever else is
 *  in it. */
const TRIVIAL_WORDS = 8;

export interface ModelPlan {
  tier: Tier;
  model: string;
  maxTokens: number;
  /** How thinking is requested, which differs by model family. */
  thinking: "none" | "budget" | "adaptive";
  reason: string;
}

/**
 * Pick a tier for this turn.
 *
 * `historyDepth` and `hasSummary` matter because a turn arriving late in a long
 * conversation carries more context to hold together, and a bare "yes, do that"
 * can be the trigger for the largest action in the session.
 */
export function classify(
  message: string,
  options: { historyDepth?: number; hasSummary?: boolean } = {}
): Tier {
  const text = message.trim();
  const words = text.split(/\s+/).filter(Boolean).length;
  const { historyDepth = 0, hasSummary = false } = options;

  if (PLANNING.test(text) || ANALYTICAL.test(text)) return "deep";
  // Checked before the length short-circuit: "summarise PowerZenith" is two
  // words and still has to hold several tool results together.
  if (SUMMARY.test(text) || MULTI.test(text)) return "reasoned";
  if (words <= TRIVIAL_WORDS && !hasSummary) return "fast";
  if (words > 45 || historyDepth >= 6) return "reasoned";
  return "fast";
}

export function planFor(
  message: string,
  options: { historyDepth?: number; hasSummary?: boolean } = {}
): ModelPlan {
  const tier = classify(message, options);

  if (tier === "deep" && settings.deepModelEnabled) {
    return {
      tier: "deep",
      model: settings.claudeDeepModel,
      maxTokens: settings.deepMaxTokens,
      thinking: "adaptive",
      reason: "planning or judgement",
    };
  }

  if (tier === "deep" || tier === "reasoned") {
    return {
      tier: "reasoned",
      model: settings.claudeModel,
      // max_tokens has to leave room for the answer on top of the budget, or the
      // reply is truncated the moment reasoning runs long.
      maxTokens: settings.thinkingBudgetTokens + settings.answerMaxTokens,
      thinking: "budget",
      reason: tier === "reasoned" ? "multi-step request" : "planning, deep tier disabled",
    };
  }

  return {
    tier: "fast",
    model: settings.claudeModel,
    maxTokens: settings.answerMaxTokens,
    thinking: "none",
    reason: "direct lookup",
  };
}
