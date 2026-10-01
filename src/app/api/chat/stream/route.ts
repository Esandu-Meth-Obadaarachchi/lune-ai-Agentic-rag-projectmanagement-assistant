import { requireUser } from "@/lib/firebase/admin";
import { streamAgent, sse } from "@/lib/ai/streaming";
import { withUsage } from "@/lib/ai/usage";
import { planFor } from "@/lib/ai/router";
import { beginTurn, finishTurn, lookupCached, prepareTurn } from "@/lib/ai/turn";
import { RateLimited } from "@/lib/security/limits";
import type { ChatTurn } from "@/lib/ai/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The same turn as `/api/chat`, delivered as it is produced.
 *
 * Nothing here is faster — the same tools run in the same order. What changes is
 * when the user sees the first word: routing lands immediately, each tool step
 * lands as it happens, and the answer arrives in pieces rather than all at once
 * at the end. On a tool-calling turn the step and card frames land well before
 * the first word of the answer could exist, because the answer cannot begin
 * until the tool has returned.
 *
 * What runs before the stream opens is deliberately minimal: auth, the rate
 * limit and input sanitising, because those three are the only failures that
 * have to be an HTTP status code rather than an `error` frame. Everything
 * expensive — the scope load, the conversation memory, the example library, the
 * cache lookup — happens *inside* the stream, after the first frames are
 * already on the wire. Measured against a warm dev server, moving that work
 * inside took the first frame from roughly 1.8s to immediate, which is the
 * entire point of streaming: the number the user feels is time-to-first-paint,
 * not total duration.
 *
 * The routing decision is made up front because it depends only on the message,
 * so `meta` can be the first thing sent.
 *
 * A cache hit still comes back over the stream rather than as plain JSON, so the
 * client has one code path and one place to render an answer.
 */
export async function POST(req: Request) {
  let user;
  try {
    user = await requireUser(req);
  } catch (r) {
    return r instanceof Response ? r : new Response("Unauthorized", { status: 401 });
  }

  let body: {
    message?: string;
    workspaceId?: string;
    projectId?: string;
    history?: ChatTurn[];
  };
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  if (!body.message) return new Response("message is required", { status: 400 });

  // Only the checks whose failure must be a status code run before the stream.
  let message: string;
  try {
    message = await beginTurn({ message: body.message }, user);
  } catch (err) {
    if (err instanceof RateLimited) {
      return new Response(err.message, {
        status: 429,
        headers: { "Retry-After": String(err.retryAfterSeconds) },
      });
    }
    if (err instanceof Response) return err;
    return new Response(err instanceof Error ? err.message : "Agent failed", { status: 500 });
  }

  const history = body.history ?? [];
  // Depends on the message alone, so it needs none of the work below and can go
  // out as the very first frame.
  const plan = planFor(message, { historyDepth: history.length });
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (frame: string) => controller.enqueue(encoder.encode(frame));
      try {
        send(sse("meta", { tier: plan.tier, model: plan.model, reason: plan.reason }));

        const turn = await prepareTurn({ ...body, message: body.message! }, user, message);
        const { cached, embedding } = await lookupCached(turn, user.uid);

        if (cached) {
          send(sse("token", { text: cached.answer }));
          for (const card of cached.cards) send(sse("card", card));
          send(
            sse("done", {
              answer: cached.answer,
              sources: cached.sources,
              cards: cached.cards,
              steps: [...cached.steps, `served from cache (${cached.ageSeconds}s old)`],
              reasoning: [],
              tier: "cached",
              model: "",
              grounded: null,
            })
          );
          return;
        }

        await withUsage({ uid: user.uid, email: user.email, name: user.name }, async () => {
          for await (const { frame, result } of streamAgent(
            turn.message,
            turn.memory,
            turn.ctx,
            turn.meta,
            plan,
            false // `meta` has already gone out above
          )) {
            send(frame);
            if (result) {
              // The bookkeeping runs after the last frame is on the wire, so it
              // never holds the stream open in front of the user.
              await finishTurn({
                turn,
                uid: user.uid,
                result,
                history,
                embedding: embedding ?? null,
              });
            }
          }
        });
      } catch (err) {
        send(sse("error", { message: err instanceof Error ? err.message : "Agent failed" }));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Tells proxies not to buffer the response, which would collect the whole
      // stream and defeat the point of streaming it.
      "X-Accel-Buffering": "no",
    },
  });
}
