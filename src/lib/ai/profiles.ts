/**
 * Retrieval profiles: one pipeline, different settings per job.
 *
 * "Find me the rectifier's serial number" and "summarise this project" are not
 * the same retrieval problem, and tuning one set of constants to serve both
 * means serving neither well. A lookup wants precision: a tight candidate set,
 * the lexical leg weighted up so an exact code wins, and MMR close to pure
 * relevance. A summary wants coverage: a wider net, more survivors, diversity
 * favoured over raw relevance, and a cap on how much of the answer any single
 * file may supply.
 *
 * The knobs, and what each one trades:
 *
 * candidates    How wide the net is before reranking. More recall, more rerank
 *               cost, no extra model calls.
 * keep          How many chunks reach the model. More context, more input
 *               tokens, and more chance of burying the answer.
 * mmrPool       How many the reranker keeps before MMR selects from them.
 *               Pooling above `keep` is what gives MMR anything to choose from.
 * lambda        1.0 is pure relevance, 0.0 is pure diversity.
 * denseWeight / Relative pull of the two legs in the RRF fusion.
 * sparseWeight
 * perDocCap     Ceiling on chunks from one document. 0 disables it.
 * grade         Whether a borderline result is worth an LLM grade.
 * rewrite       Whether a weak result is worth a rewrite and a second attempt.
 *               Off for the latency-sensitive paths.
 */

export interface RetrievalProfile {
  name: string;
  candidates: number;
  keep: number;
  mmrPool: number;
  lambda: number;
  denseWeight: number;
  sparseWeight: number;
  perDocCap: number;
  grade: boolean;
  rewrite: boolean;
}

const base: Omit<RetrievalProfile, "name"> = {
  candidates: 20,
  keep: 5,
  mmrPool: 10,
  lambda: 0.7,
  denseWeight: 1,
  sparseWeight: 1,
  perDocCap: 0,
  grade: true,
  rewrite: true,
};

/** A question with a specific answer. Precision first: the lexical leg is
 *  weighted up because these queries carry names, codes and figures, and MMR
 *  stays close to pure relevance so a diverse-but-wrong chunk cannot displace
 *  the right one. */
export const LOOKUP: RetrievalProfile = {
  ...base,
  name: "lookup",
  candidates: 20,
  keep: 5,
  mmrPool: 10,
  lambda: 0.82,
  sparseWeight: 1.2,
};

/** Coverage over precision. A summary built from five chunks of the same section
 *  is a summary of that section, not the project, so the net is wider, diversity
 *  is weighted heavily and no single document may supply more than three chunks. */
export const SUMMARIZE: RetrievalProfile = {
  ...base,
  name: "summarize",
  candidates: 45,
  keep: 12,
  mmrPool: 24,
  lambda: 0.45,
  sparseWeight: 0.7,
  perDocCap: 3,
  // Nothing to grade against: there is no single right answer to a summary.
  grade: false,
};

/** Smart linking on a task. Runs while the user is reading, so it skips the
 *  rewrite and the grade entirely and returns three chunks from three different
 *  documents. */
export const RELATED: RetrievalProfile = {
  ...base,
  name: "related",
  candidates: 15,
  keep: 3,
  mmrPool: 8,
  lambda: 0.5,
  perDocCap: 1,
  grade: false,
  rewrite: false,
};

/** Comparisons and open questions: widest net, diversity favoured, grading kept
 *  because a weak result here is worth a second angle. */
export const EXPLORE: RetrievalProfile = {
  ...base,
  name: "explore",
  candidates: 40,
  keep: 8,
  mmrPool: 18,
  lambda: 0.55,
  perDocCap: 3,
};

const PROFILES = new Map(
  [LOOKUP, SUMMARIZE, RELATED, EXPLORE].map((profile) => [profile.name, profile])
);

export function getProfile(name?: string | null): RetrievalProfile {
  return PROFILES.get((name ?? "").toLowerCase()) ?? LOOKUP;
}
