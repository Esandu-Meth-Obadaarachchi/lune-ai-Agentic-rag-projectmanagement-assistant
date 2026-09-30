/**
 * Write audit log.
 *
 * Every change the agent makes to a user's data is recorded: who, what, when,
 * and enough of the arguments to tell what happened. Not for compliance theatre
 * — for the question that actually gets asked, which is "why is this task marked
 * done, I never touched it". Without a log the only answer is a shrug.
 *
 * Writes are best-effort and never block or fail the action they describe. A
 * missing audit line is a gap in the record; a failed task update because the
 * audit write failed is a broken product.
 */
import { adminDb } from "@/lib/firebase/admin";

export const AUDIT_COLLECTION = "agentAudit";

export function audit(
  uid: string,
  action: string,
  detail: Record<string, unknown> = {},
  source: "agent" | "approval" = "agent"
): void {
  // Deliberately not awaited: the log must never take the write with it, and it
  // must never sit between the user and their answer.
  void adminDb()
    .collection(AUDIT_COLLECTION)
    .add({ uid, action, detail, source, at: Date.now() })
    .catch(() => {
      /* a gap in the record is survivable */
    });
}
