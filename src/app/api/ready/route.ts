import { NextResponse } from "next/server";
import { settings } from "@/lib/ai/config";
import { cacheBackend } from "@/lib/cache/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Readiness: what this deployment is actually wired to.
 *
 * This is the answer to "the deploy went green, so why is nothing cached". A
 * service that silently fell back to the in-process cache tier, or booted
 * without a Pinecone key, or is running dense-only because hybrid was never
 * turned on, looks identical to a healthy one from the outside otherwise.
 *
 * Presence only, never values. Nothing here reveals a key, and it is safe behind
 * no auth because everything it reports is configuration the operator already
 * knows.
 */
export function GET() {
  return NextResponse.json({
    status: "ok",
    // "local" means the shared cache did not connect and every instance is
    // caching to itself — correct, but far less useful.
    cache: cacheBackend(),
    models: {
      agent: settings.claudeModel,
      fast: settings.claudeFastModel,
      deep: settings.deepModelEnabled ? settings.claudeDeepModel : null,
    },
    retrieval: {
      index: settings.pineconeIndexName,
      embedModel: settings.voyageEmbedModel,
      rerankModel: settings.voyageRerankModel,
      hybrid: settings.hybridSearchEnabled,
      contextualRetrieval: settings.contextualRetrievalEnabled,
      vision: settings.visionEnabled,
    },
    guardrails: {
      groundedness: settings.groundednessCheckEnabled,
      redaction: settings.redactSecretsInAnswers,
      approvalThreshold: settings.approvalTaskThreshold,
      chatPerMinute: settings.rateLimitChatPerMinute,
    },
    configured: {
      anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
      voyage: Boolean(process.env.VOYAGE_API_KEY),
      pinecone: Boolean(process.env.PINECONE_API_KEY),
      firebase: Boolean(process.env.FIREBASE_ADMIN_PRIVATE_KEY),
    },
  });
}
