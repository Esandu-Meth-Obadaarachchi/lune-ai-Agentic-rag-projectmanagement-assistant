/**
 * RAG settings, read once from the environment.
 *
 * Every tunable in the retrieval and generation path lives here rather than as a
 * constant next to the code that uses it. Two reasons: the numbers are the thing
 * you actually change when quality or cost moves the wrong way, and a value read
 * in three places must not be able to disagree with itself.
 *
 * Server-only. Nothing here may be imported from a client component — the keys
 * would be bundled into the browser.
 */

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  return raw === "1" || raw === "true" || raw === "yes";
}

function str(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}

export const settings = {
  // --- Anthropic: generation + the agent loop ---------------------------------
  /** The agent's working model. Haiku 4.5 is the cheapest tier and handles the
   *  overwhelming majority of turns. */
  claudeModel: str("CLAUDE_MODEL", "claude-haiku-4-5"),
  /** Rewrite, grade, groundedness, contextualisation, summarising. Always the
   *  cheapest model: these want a short string back, not judgement. */
  claudeFastModel: str("CLAUDE_FAST_MODEL", "claude-haiku-4-5"),
  /** The escalation tier for planning and judgement turns. Sonnet 5.5 takes
   *  adaptive thinking and decides per turn whether a question warrants it. */
  claudeDeepModel: str("CLAUDE_DEEP_MODEL", "claude-sonnet-5-5"),
  deepModelEnabled: bool("DEEP_MODEL_ENABLED", true),
  /** Effort on the deep tier. Depth knob on models where `budget_tokens` is gone. */
  deepEffort: str("CLAUDE_DEEP_EFFORT", "medium") as "low" | "medium" | "high",
  deepMaxTokens: num("DEEP_MAX_TOKENS", 8000),

  /** Ceiling on the answer itself. Output tokens are the expensive side, and
   *  every tool round re-sends the growing context, so this stays bounded. */
  answerMaxTokens: num("ANSWER_MAX_TOKENS", 1500),
  /** Reasoning budget on the middle tier. Haiku 4.5 still takes an explicit
   *  budget; max_tokens is set above it so a long chain cannot eat the answer. */
  thinkingBudgetTokens: num("THINKING_BUDGET_TOKENS", 2048),
  /** Visible chain of thought. Off means reasoning is still used, just not returned. */
  exposeReasoning: bool("EXPOSE_REASONING", true),
  groundednessCheckEnabled: bool("GROUNDEDNESS_CHECK_ENABLED", true),

  // --- Chunking: token budgets, not character windows -------------------------
  chunkTargetTokens: num("CHUNK_TARGET_TOKENS", 480),
  chunkMaxTokens: num("CHUNK_MAX_TOKENS", 800),
  chunkOverlapTokens: num("CHUNK_OVERLAP_TOKENS", 64),
  chunkMinTokens: num("CHUNK_MIN_TOKENS", 80),

  // --- Contextual retrieval: one generated sentence per chunk, at ingest ------
  contextualRetrievalEnabled: bool("CONTEXTUAL_RETRIEVAL_ENABLED", true),
  contextModel: str("CONTEXT_MODEL", "claude-haiku-4-5"),
  contextConcurrency: num("CONTEXT_CONCURRENCY", 8),
  /** Past these the document is indexed with breadcrumbs alone. The cap keeps a
   *  400-page upload from becoming thousands of cached-prefix calls. */
  contextMaxDocumentChars: num("CONTEXT_MAX_DOCUMENT_CHARS", 180_000),
  contextMaxChunks: num("CONTEXT_MAX_CHUNKS", 300),

  // --- Vision: OCR for scanned pages, captions for figures (ingest only) -----
  visionEnabled: bool("VISION_ENABLED", true),
  visionModel: str("VISION_MODEL", "claude-haiku-4-5"),
  /** Hard ceiling on paid vision calls per document. A 300-page scan would
   *  otherwise be a four-figure surprise; past the cap the rest is text-only. */
  visionMaxCallsPerDoc: num("VISION_MAX_CALLS_PER_DOC", 20),
  /** Pages sent to the model in one document block. Batching is why this is
   *  cheaper than the page-at-a-time approach: one prompt, several pages. */
  visionPagesPerCall: num("VISION_PAGES_PER_CALL", 4),
  visionConcurrency: num("VISION_CONCURRENCY", 4),

  // --- Voyage: embeddings + cross-encoder reranking ---------------------------
  voyageEmbedModel: str("VOYAGE_EMBED_MODEL", "voyage-3.5"),
  voyageRerankModel: str("VOYAGE_RERANK_MODEL", "rerank-2.5"),
  embedDim: num("EMBED_DIM", 1024),

  // --- Pinecone ---------------------------------------------------------------
  pineconeIndexName: str("PINECONE_INDEX_NAME", "second-brain"),
  /** Learned sparse model, served by the same API as the index. Set
   *  HYBRID_SEARCH_ENABLED=false (or use a cosine index) to run dense-only. */
  pineconeSparseModel: str("PINECONE_SPARSE_MODEL", "pinecone-sparse-english-v0"),
  /** Hybrid records need a dotproduct index. On a cosine index the sparse half
   *  is rejected, so this is the switch that keeps the old index working. */
  hybridSearchEnabled: bool("HYBRID_SEARCH_ENABLED", false),

  // --- Retrieval confidence gate ---------------------------------------------
  /** Voyage rerank scores sit in [0, 1]. Above the first, the reranker is sure
   *  enough that an LLM grade adds latency and nothing else. Below the second it
   *  is plainly weak. Only the band between them is worth a model call. */
  rerankConfidentScore: num("RERANK_CONFIDENT_SCORE", 0.5),
  rerankWeakScore: num("RERANK_WEAK_SCORE", 0.22),

  // --- Guardrails -------------------------------------------------------------
  rateLimitChatPerMinute: num("RATE_LIMIT_CHAT_PER_MINUTE", 20),
  rateLimitIngestPerHour: num("RATE_LIMIT_INGEST_PER_HOUR", 60),
  redactSecretsInAnswers: bool("REDACT_SECRETS_IN_ANSWERS", true),

  // --- Human in the loop ------------------------------------------------------
  /** Above this many tasks in one request the agent proposes instead of writing.
   *  Zero disables the gate entirely. */
  approvalTaskThreshold: num("APPROVAL_TASK_THRESHOLD", 5),
  proposalTtlSeconds: num("PROPOSAL_TTL_SECONDS", 3600),

  // --- Cache ------------------------------------------------------------------
  /** Upstash REST is the durable tier. It fits a serverless deployment where a
   *  pooled TCP connection does not survive between invocations. With it unset
   *  the durable tier falls back to Firestore, and failing that to in-process
   *  only — correct, but per-instance and lost on redeploy. */
  upstashRestUrl: process.env.UPSTASH_REDIS_REST_URL?.trim() || "",
  upstashRestToken: process.env.UPSTASH_REDIS_REST_TOKEN?.trim() || "",
  cacheFirestoreFallback: bool("CACHE_FIRESTORE_FALLBACK", true),
  cacheTimeoutMs: num("CACHE_TIMEOUT_MS", 1200),
  cacheCooloffSeconds: num("CACHE_COOLOFF_SECONDS", 30),
  cacheLocalEntries: num("CACHE_LOCAL_ENTRIES", 2000),
  cacheLocalTtlSeconds: num("CACHE_LOCAL_TTL_SECONDS", 120),

  answerCacheEnabled: bool("ANSWER_CACHE_ENABLED", true),
  answerCacheTtlSeconds: num("ANSWER_CACHE_TTL_SECONDS", 1800),
  /** "What is overdue" ages in seconds, so a time-sensitive question gets a
   *  much shorter life than a stable one. */
  answerCacheVolatileTtlSeconds: num("ANSWER_CACHE_VOLATILE_TTL_SECONDS", 120),
  answerCacheIndexSize: num("ANSWER_CACHE_INDEX_SIZE", 60),
  cacheVersionTtlSeconds: num("CACHE_VERSION_TTL_SECONDS", 604_800),
  semanticCacheEnabled: bool("SEMANTIC_CACHE_ENABLED", true),
  /** Deliberately high. "What is due today" and "what was due today" sit around
   *  0.94 apart and mean different things, so a near miss must be a miss. */
  semanticCacheThreshold: num("SEMANTIC_CACHE_THRESHOLD", 0.965),

  embeddingCacheTtlSeconds: num("EMBEDDING_CACHE_TTL_SECONDS", 604_800),
  vectorCacheTtlSeconds: num("VECTOR_CACHE_TTL_SECONDS", 86_400),

  // --- Conversation memory ----------------------------------------------------
  memoryRecentPairs: num("MEMORY_RECENT_PAIRS", 3),
  memorySummaryTtlSeconds: num("MEMORY_SUMMARY_TTL_SECONDS", 86_400),
  memoryMaxTranscriptChars: num("MEMORY_MAX_TRANSCRIPT_CHARS", 24_000),
} as const;

export type Settings = typeof settings;
