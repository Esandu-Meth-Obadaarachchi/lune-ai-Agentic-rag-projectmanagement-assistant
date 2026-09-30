import { NextResponse } from "next/server";
import { requireUser } from "@/lib/firebase/admin";
import { runAgent } from "@/lib/ai/agent";
import { withUsage } from "@/lib/ai/usage";
import { settings } from "@/lib/ai/config";
import { finishTurn, lookupCached, prepareTurn } from "@/lib/ai/turn";
import { redactSecrets } from "@/lib/security/guardrails";
import { RateLimited } from "@/lib/security/limits";
import type { ChatTurn } from "@/lib/ai/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Agent chat.
 *
 * Verify the ID token -> answer cache -> load everything the user can access
 * across ALL their workspaces -> run the agent -> return the answer, the steps
 * taken, the sources cited and the UI cards.
 *
 * The cache sits in front of the agent and the bookkeeping sits behind it; both
 * are explained in `lib/ai/turn.ts`. The response shape is a superset of the
 * previous one, so the existing UI keeps working and can adopt the new fields
 * (`reasoning`, `tier`, `grounded`) when it is ready.
 */
export async function POST(req: Request) {
  let user;
  try {
    user = await requireUser(req);
  } catch (r) {
    return r instanceof Response ? r : NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await req.json()) as {
      message?: string;
      workspaceId?: string;
      projectId?: string;
      history?: ChatTurn[];
    };
    if (!body.message) {
      return NextResponse.json({ error: "message is required" }, { status: 400 });
    }

    const turn = await prepareTurn({ ...body, message: body.message }, user);
    const { cached, embedding } = await lookupCached(turn, user.uid);

    if (cached) {
      return NextResponse.json({
        answer: cached.answer,
        steps: [...cached.steps, `served from cache (${cached.ageSeconds}s old)`],
        sources: cached.sources,
        cards: cached.cards,
        reasoning: [],
        tier: "cached",
        model: "",
        grounded: null,
      });
    }

    // Attribute every Claude call in this request (agent loop + retrieval
    // helpers) to the signed-in user, so the admin dashboard totals their spend.
    const result = await withUsage({ uid: user.uid, email: user.email, name: user.name }, () =>
      runAgent(turn.message, turn.memory, turn.ctx, turn.meta)
    );

    // A knowledge base of specs and config notes will eventually hold a key, and
    // repeating one into a chat transcript spreads it further than the document.
    if (settings.redactSecretsInAnswers) {
      const { text, found } = redactSecrets(result.answer);
      if (found.length) {
        result.answer = text;
        result.steps.push(`redacted from the answer: ${found.join(", ")}`);
      }
    }

    await finishTurn({
      turn,
      uid: user.uid,
      result,
      history: body.history ?? [],
      embedding,
    });

    return NextResponse.json({
      answer: result.answer,
      steps: result.steps,
      sources: result.sources,
      cards: result.cards,
      reasoning: settings.exposeReasoning ? result.reasoning : [],
      tier: result.tier,
      model: result.model,
      grounded: result.grounded,
    });
  } catch (err) {
    if (err instanceof RateLimited) {
      return NextResponse.json(
        { error: err.message },
        { status: 429, headers: { "Retry-After": String(err.retryAfterSeconds) } }
      );
    }
    if (err instanceof Response) return err;
    console.error("chat error", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Agent failed" },
      { status: 500 }
    );
  }
}
