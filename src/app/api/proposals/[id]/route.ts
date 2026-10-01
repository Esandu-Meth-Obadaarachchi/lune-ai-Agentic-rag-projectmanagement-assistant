import { NextResponse } from "next/server";
import { requireUser } from "@/lib/firebase/admin";
import { loadProject, loadWorkspace } from "@/lib/ai/server";
import { createAssignedTasks } from "@/lib/ai/assignment";
import { audit } from "@/lib/ai/audit";
import { isOpen, loadProposal, setProposalStatus } from "@/lib/ai/proposals";
import { createTaskTree } from "@/lib/ai/tools";
import { bumpDataVersion } from "@/lib/cache/semantic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Approve or cancel a held plan — the other half of the approval gate.
 *
 * The agent stored the exact tree it wanted to create; this executes it, or
 * throws it away. No model runs here: approving calls the same `createTaskTree`
 * the agent would have called, on the payload the user was shown, so approval
 * costs nothing in tokens, returns in the time of the writes, and cannot produce
 * a different plan from the one on screen.
 *
 * Authorisation is ownership plus membership: the proposal only loads for the
 * user it was created for, and the project is re-checked at approval time,
 * because access can be revoked between proposing and approving.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  let user;
  try {
    user = await requireUser(req);
  } catch (r) {
    return r instanceof Response ? r : NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { action } = (await req.json().catch(() => ({}))) as { action?: string };
    const proposal = await loadProposal(user.uid, params.id);

    if (action === "cancel") {
      if (proposal.status === "approved") {
        return NextResponse.json({ error: "That plan was already approved." }, { status: 409 });
      }
      await setProposalStatus(proposal.id, "cancelled");
      audit(user.uid, "cancel_proposal", { proposal: proposal.id }, "approval");
      return NextResponse.json({
        status: "cancelled",
        created: 0,
        message: "Discarded. Nothing was created.",
        tasks: [],
      });
    }

    if (proposal.status === "approved") {
      // A double-click or a retried request. Approving twice would create the
      // whole tree a second time, so this is idempotent by status.
      return NextResponse.json({
        status: "approved",
        created: 0,
        message: "Already approved.",
        tasks: [],
      });
    }
    if (!isOpen(proposal)) {
      return NextResponse.json(
        {
          error:
            "That plan is no longer open — it was cancelled or it expired. Ask again to rebuild it.",
        },
        { status: 409 }
      );
    }

    // Re-check access now, not only when the plan was proposed.
    const project = await loadProject(user.uid, proposal.projectId);

    if (proposal.kind === "assign_tasks") {
      // Assigning work needs the same role as proposing it, re-checked now.
      const { ws } = await loadWorkspace(user.uid, project.workspaceId);
      const role = ws.members.find((m) => m.uid === user.uid)?.role;
      if (role !== "owner" && role !== "admin") {
        return NextResponse.json({ error: "Only an admin or owner can assign work." }, { status: 403 });
      }
      await setProposalStatus(proposal.id, "approved");
      const { count, summary } = await createAssignedTasks({
        uid: user.uid,
        userName: user.name ?? "You",
        project,
        workspaceMemberIds: ws.memberIds,
        assignments: proposal.payload.assignments ?? [],
      });
      audit(user.uid, "approve_proposal", { proposal: proposal.id, count }, "approval");
      void bumpDataVersion(user.uid);
      return NextResponse.json({
        status: "approved",
        created: count,
        message: `Created and assigned ${count} task${count === 1 ? "" : "s"} in ${project.name}.`,
        tasks: summary,
      });
    }

    // Marked approved before the writes: a crash halfway through leaves a
    // partial tree the user can see and finish, which is recoverable. Marking
    // after would leave the plan open and let a retry duplicate everything.
    await setProposalStatus(proposal.id, "approved");
    const { count, summary } = await createTaskTree({
      uid: user.uid,
      userName: user.name ?? "You",
      target: {
        id: project.id,
        name: project.name ?? proposal.projectName,
        ragNamespace: project.ragNamespace,
        workspaceId: project.workspaceId,
        memberIds: project.memberIds ?? [],
      },
      nodes: proposal.payload.tasks ?? [],
    });

    audit(user.uid, "approve_proposal", { proposal: proposal.id, count }, "approval");
    // The tasks the user can see have changed, so every cached answer for them
    // is now potentially wrong.
    void bumpDataVersion(user.uid);

    return NextResponse.json({
      status: "approved",
      created: count,
      message: `Created ${count} task${count === 1 ? "" : "s"} in ${project.name}.`,
      tasks: summary,
    });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error("proposal error", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Proposal failed" },
      { status: 500 }
    );
  }
}
