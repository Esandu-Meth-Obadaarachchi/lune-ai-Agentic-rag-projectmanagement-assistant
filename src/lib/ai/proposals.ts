/**
 * Approval gate for large writes.
 *
 * An agent that creates eighteen tasks across four phases because it slightly
 * misread the request has done more damage than one that refuses to act.
 * Undoing it is manual, it is tedious, and the user has to work out which of the
 * eighteen were wanted. So above a threshold, the agent stops and shows its work
 * first.
 *
 * The design choice worth explaining is what the pause is made of. The obvious
 * approach is to suspend the agent loop and resume it when the user approves.
 * That means persisting the loop's state between two HTTP requests and
 * re-entering the model to finish the job — so approving costs a second
 * inference pass, and the plan the user approved is not guaranteed to be the
 * plan that runs.
 *
 * Instead the proposal *is* the plan. The tool writes the exact tree it would
 * have created into Firestore, and approval executes that tree with plain code.
 * No model runs on the approve path, so it costs nothing, returns in the time of
 * the writes, and what the user approved is precisely what happens. Cancelling
 * is a status change.
 *
 * Proposals expire, because an approval button left open for a day is a request
 * the user has forgotten the context of.
 */
import { randomUUID } from "crypto";
import { adminDb } from "@/lib/firebase/admin";
import { settings } from "./config";

export const PROPOSALS_COLLECTION = "agentProposals";

export interface TaskNodeInput {
  title?: string;
  status?: string;
  priority?: string;
  due_date?: string;
  subtasks?: TaskNodeInput[];
}

/** One task from an assigned brief: who, and why that person. */
export interface AssignedTask {
  title: string;
  notes: string;
  priority: string;
  assigneeUid: string | null;
  assigneeName: string | null;
  assigneePhoto?: string | null;
  reason: string;
}

export interface ProposalPayload {
  tasks: TaskNodeInput[];
  /** assign_tasks only: the flat, assigned list. */
  assignments?: AssignedTask[];
}

export interface Proposal {
  id: string;
  uid: string;
  /** create_tasks, or assign_tasks for a brief split across the team. */
  kind: string;
  payload: ProposalPayload;
  projectId: string;
  projectName: string;
  summary: string;
  status: "pending" | "approved" | "cancelled" | "expired";
  createdAt: number;
  expiresAt: number;
}

export function isOpen(proposal: Proposal): boolean {
  return proposal.status === "pending" && proposal.expiresAt > Date.now();
}

/** Total tasks in a nested tree, subtasks included. */
export function countNodes(nodes: TaskNodeInput[] | undefined): number {
  return (nodes ?? []).reduce((total, node) => total + 1 + countNodes(node.subtasks), 0);
}

/** A flat, indented preview of the tree, for the approval card. */
export function outline(nodes: TaskNodeInput[] | undefined, depth = 0, limit = 40): string[] {
  const lines: string[] = [];
  for (const node of nodes ?? []) {
    if (lines.length >= limit) break;
    const title = (node.title ?? "").trim();
    lines.push("  ".repeat(depth) + title + (node.due_date ? `  (${node.due_date})` : ""));
    lines.push(...outline(node.subtasks, depth + 1, limit - lines.length));
  }
  return lines;
}

export async function createProposal(input: {
  uid: string;
  kind: string;
  payload: ProposalPayload;
  projectId: string;
  projectName: string;
  summary: string;
}): Promise<Proposal> {
  const now = Date.now();
  const proposal: Proposal = {
    id: randomUUID(),
    ...input,
    status: "pending",
    createdAt: now,
    expiresAt: now + settings.proposalTtlSeconds * 1000,
  };
  const { id, ...doc } = proposal;
  await adminDb().collection(PROPOSALS_COLLECTION).doc(id).set(doc);
  return proposal;
}

/**
 * Load a proposal, enforcing ownership.
 *
 * The uid check is the whole authorisation model for the approve endpoint: a
 * proposal id is a capability to write tasks, so it only ever works for the
 * person it was created for.
 */
export async function loadProposal(uid: string, proposalId: string): Promise<Proposal> {
  const snap = await adminDb().collection(PROPOSALS_COLLECTION).doc(proposalId).get();
  if (!snap.exists) throw new Response("Proposal not found", { status: 404 });
  const data = snap.data() as Omit<Proposal, "id">;
  if (data.uid !== uid) throw new Response("Forbidden", { status: 403 });
  return { id: proposalId, ...data };
}

export async function setProposalStatus(
  proposalId: string,
  status: Proposal["status"]
): Promise<void> {
  await adminDb()
    .collection(PROPOSALS_COLLECTION)
    .doc(proposalId)
    .update({ status, decidedAt: Date.now() });
}
