/**
 * Agent tools.
 *
 * Each tool reads or writes Firestore through the admin client, scoped to the
 * authenticated user, and accumulates sources, cards and steps on the
 * ToolContext for the UI.
 *
 * Three things here are load-bearing beyond the plumbing.
 *
 * Descriptions are part of the prompt. A tool description is the only
 * documentation the model gets, and a vague one produces a wrong call that costs
 * a whole extra round trip to discover. Every description below says what the
 * tool does, when to reach for it, when *not* to, and what its arguments mean —
 * including the cases where a different tool is the right answer. They are
 * written to be read by a model deciding under uncertainty, not by a developer
 * reading an API reference.
 *
 * Some tools ask rather than act. `ask_user` and `request_example` stop the
 * agent and hand a question back to the user, and `update_task` refuses to guess
 * when a title matches more than one thing. That is deliberate: guessing wrong
 * on "update the launch task" when three tasks match is worse than one extra
 * round trip, and it is the difference between an assistant and a liability.
 *
 * Retrieved text is data. Everything `search_knowledge` returns is wrapped and
 * labelled as untrusted before the model sees it, and anything carrying the
 * shape of an injected instruction is quarantined with a warning rather than
 * dropped — a document legitimately about prompt injection is not an attack, and
 * silently hiding content the user uploaded is its own kind of failure.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { adminDb } from "@/lib/firebase/admin";
import { agenticRetrieve, retrieveAndRerank } from "./retrieval";
import { settings } from "./config";
import { audit } from "./audit";
import { countNodes, createProposal, outline, type TaskNodeInput } from "./proposals";
import { scanForInjection, wrapUntrusted } from "@/lib/security/guardrails";
import type { AgentCard, RetrievedChunk, Task, TaskPriority, TaskStatus } from "@/lib/types";

export interface ProjectRef {
  id: string;
  name: string;
  ragNamespace: string;
  /** The workspace this project belongs to (projects span workspaces). */
  workspaceId: string;
  /** Access list, so a new task inherits the right members. */
  memberIds: string[];
}

/**
 * The agent stopped to ask something rather than act.
 *
 * Set by a tool, read by the agent once the loop finishes. A flag rather than a
 * thrown error because the loop turns a thrown error into a tool_result the
 * model is told to recover from, which would turn a deliberate question into
 * what looks like a bug.
 */
export interface Pending {
  kind: "clarify" | "example" | "approval";
  /** What to say if the model does not relay the question itself. */
  message: string;
  card: AgentCard;
}

export interface ToolContext {
  uid: string;
  userName: string;
  /** The workspace the user is viewing — only a default for new tasks. */
  currentWorkspaceId?: string;
  currentProjectId?: string;
  /** Every project the user can access, across ALL their workspaces. */
  projects: ProjectRef[];
  // Artifacts accumulated during a run, surfaced back to the UI.
  sources: RetrievedChunk[];
  cards: AgentCard[];
  steps: string[];
  /** Set by any tool that changed data. A reply produced by a write is never
   *  cached, and it invalidates every cached answer for this user. */
  wrote: boolean;
  pending: Pending | null;
  /** Examples this user has previously given, injected so the agent can match
   *  their format instead of asking for one again. */
  examples: Record<string, string>;
}

export function newToolContext(
  base: Pick<ToolContext, "uid" | "userName" | "projects"> &
    Partial<Pick<ToolContext, "currentWorkspaceId" | "currentProjectId" | "examples">>
): ToolContext {
  return {
    sources: [],
    cards: [],
    steps: [],
    wrote: false,
    pending: null,
    examples: {},
    ...base,
  };
}

export const EXAMPLES_COLLECTION = "agentExamples";

/* -------------------------------- tool schemas ------------------------------- */

export const TOOLS: Anthropic.Tool[] = [
  {
    name: "search_knowledge",
    description:
      "Search the user's uploaded documents — specs, notes, reports, spreadsheets, meeting minutes, contracts — and return the passages that answer the question, with their document, section and page.\n" +
      "USE FOR: anything a document would know. Past decisions and why they were made, figures and dates, what a spec says, how something was set up, what a client agreed, definitions of internal terms and acronyms.\n" +
      "DO NOT USE FOR: tasks, assignees, due dates or project status — those live in list_tasks and summarize_project, and searching for them returns stale prose.\n" +
      "MODE: 'lookup' (default) for one specific fact or decision. 'explore' for open or comparative questions where several angles matter. 'summarize' when you need wide coverage across documents rather than one precise passage.\n" +
      "PROJECT: leave empty to search everything the user can see. Name a project only when the user named one, or the answer would be wrong from another project.\n" +
      "If the result is thin, search once more with the entities and identifiers rather than the phrasing before reporting that there is nothing.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to search for" },
        project: { type: "string", description: "Optional project name to scope the search to" },
        mode: {
          type: "string",
          enum: ["lookup", "explore", "summarize"],
          description:
            "How to search. 'lookup' (default) for a specific fact, figure, name or decision. 'explore' for open or comparative questions. 'summarize' for wide coverage of a topic.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "list_tasks",
    description:
      "List tasks the user can see, with project, status, priority, due date, ASSIGNEE and PARENT task. This is the only source of truth about work items — never answer about tasks from memory or from a document.\n" +
      "USE FOR: 'what's overdue', 'what's due today', 'what's on my plate', 'what's assigned to <person>', 'what are the subtasks of <task>', 'how is <project> going', and any check of whether something already exists before creating it.\n" +
      "ASSIGNEE: a person's name returns only their tasks. UNDER: a parent task's title returns that task's direct subtasks. FILTER: 'overdue', 'due_today' or 'all'. STATUS: 'todo', 'in_progress', 'blocked' or 'done'.\n" +
      "Combine filters rather than listing everything and reasoning over it. Call this before create_task when the user says 'add' and the task may already exist.",
    input_schema: {
      type: "object",
      properties: {
        project: { type: "string", description: "Optional project name to scope to" },
        assignee: {
          type: "string",
          description: "Optional person's name — only tasks assigned to them",
        },
        under: {
          type: "string",
          description: "Optional parent task title — return that task's direct subtasks",
        },
        status: { type: "string", enum: ["todo", "in_progress", "blocked", "done"] },
        filter: { type: "string", enum: ["overdue", "due_today", "all"] },
      },
    },
  },
  {
    name: "create_task",
    description:
      "Create exactly ONE task, or one subtask under a named parent.\n" +
      "USE FOR: a single, clearly described piece of work.\n" +
      "DO NOT USE FOR: several tasks, or any task that has subtasks — use create_tasks, which builds the whole tree in one call with correct parent links. Calling this in a loop produces orphaned tasks and wastes the turn.\n" +
      "Resolve relative dates to yyyy-mm-dd first. Default to the current project when the user does not name one. If the title is vague enough that the user would not recognise it in a list tomorrow, ask them with ask_user instead of guessing.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        project: { type: "string", description: "Project name; defaults to the current project" },
        status: { type: "string", enum: ["todo", "in_progress", "blocked", "done"] },
        priority: { type: "string", enum: ["low", "med", "high"] },
        due_date: { type: "string", description: "yyyy-mm-dd" },
        parent_title: {
          type: "string",
          description: "If this is a subtask, the parent task's title",
        },
      },
      required: ["title"],
    },
  },
  {
    name: "create_tasks",
    description:
      "Create MANY tasks, and nested subtasks, in one call. Pass the whole tree: each task may carry a `subtasks` array of the same shape, nested as deep as needed.\n" +
      "USE FOR: any request producing more than one task — a plan, a breakdown, a phase list, a checklist, 'add these five things'. Always prefer this over repeated create_task calls: it links parents to children exactly and costs one round trip instead of ten.\n" +
      "Resolve every relative date to yyyy-mm-dd before calling. Give each task a title someone could act on without reading the others.\n" +
      "Large trees may be held for the user's approval before anything is written. If the result says so, relay it and stop — do not create the tasks another way.",
    input_schema: {
      type: "object",
      properties: {
        tasks: {
          type: "array",
          description:
            "Top-level tasks; each may carry a nested `subtasks` array of the same shape",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              status: { type: "string", enum: ["todo", "in_progress", "blocked", "done"] },
              priority: { type: "string", enum: ["low", "med", "high"] },
              due_date: { type: "string", description: "yyyy-mm-dd" },
              subtasks: { type: "array", items: { type: "object" } },
            },
            required: ["title"],
          },
        },
        project: { type: "string", description: "Project name; defaults to the current project" },
      },
      required: ["tasks"],
    },
  },
  {
    name: "update_task",
    description:
      "Change an existing task: its status, priority, due date or title. Match it by title, or by close match.\n" +
      "USE FOR: 'mark X done', 'push Y to Friday', 'make Z high priority', 'rename'.\n" +
      "Set only the fields that change. Pass an empty string as the due date to clear it. Resolve relative dates first.\n" +
      "If more than one task matches the title, this returns the candidates instead of changing anything — put them to the user with ask_user rather than picking one.",
    input_schema: {
      type: "object",
      properties: {
        task_title: { type: "string", description: "Title (or close match) of the task to update" },
        set_status: { type: "string", enum: ["todo", "in_progress", "blocked", "done"] },
        set_priority: { type: "string", enum: ["low", "med", "high"] },
        set_due_date: { type: "string", description: "yyyy-mm-dd, or empty string to clear" },
        set_title: { type: "string" },
      },
      required: ["task_title"],
    },
  },
  {
    name: "summarize_project",
    description:
      "Everything needed to describe one project's state: its full task list with statuses and owners, plus the most relevant passages from its documents.\n" +
      "USE FOR: 'how is <project> going', 'summarise <project>', 'catch me up', \"what's left on <project>\", a status update or a standup for one project.\n" +
      "DO NOT USE FOR: a question about one specific fact — search_knowledge is narrower and faster. Do not call this for several projects in a row; ask the user which one they mean.",
    input_schema: {
      type: "object",
      properties: { project: { type: "string" } },
    },
  },
  {
    name: "ask_user",
    description:
      "Put one question back to the user and stop, instead of guessing.\n" +
      "USE WHEN: two or more projects or tasks match what they named; the request could reasonably mean two different things and the two lead to different work; a date, an assignee or a project is missing and the result depends on it; or you are about to act on an assumption they never stated.\n" +
      "DO NOT USE WHEN: a tool can answer it — call the tool. Or when the answer barely changes the outcome — pick the sensible default, act, and say which you picked.\n" +
      "Give two to four concrete options whenever the candidates are known: picking from a list is faster for the user than retyping. One question per turn, never a list.",
    input_schema: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description: "One short, specific question. Never a list of questions.",
        },
        options: {
          type: "array",
          items: { type: "string" },
          description:
            "Two to four concrete choices the user can pick from, when the ambiguity has known candidates (project names, matching task titles, dates). Leave empty for a genuinely open question.",
        },
        because: {
          type: "string",
          description: "One line on why you need this before acting, shown under the question.",
        },
      },
      required: ["question"],
    },
  },
  {
    name: "request_example",
    description:
      "Ask the user for an example to match before writing something whose format matters. Returns a stored example immediately if they have given you one before, so call it rather than assuming there is none.\n" +
      "USE BEFORE: writing a standup, a status report, a project brief, a spec, a template, a client email — anything that should look like their existing work and that they will reuse.\n" +
      "DO NOT USE FOR: answering a question, listing tasks, or one-off prose where format is not the point. Never ask twice for the same kind of thing in one conversation.\n" +
      "Say in one line what you would take from the example, and offer to proceed with your own format if they would rather not dig one out.",
    input_schema: {
      type: "object",
      properties: {
        of: {
          type: "string",
          description:
            "What you want an example of, in the user's words: 'a standup note', 'a project brief', 'a client email'. This is also the key it is stored under, so keep it short and reusable.",
        },
        why: {
          type: "string",
          description: "One line on what you would match from it — tone, length, structure.",
        },
      },
      required: ["of"],
    },
  },
  {
    name: "save_example",
    description:
      "Store an example the user has just given you, so you can match it again without asking a second time.\n" +
      "USE WHEN: the user pastes or points at a sample of something you asked for, or tells you 'write them like this one from now on'. Call it before you write the thing they asked for, then write it matching the example.\n" +
      "Use the same wording for `of` that you used in request_example, so the two line up. Save the example verbatim, not your summary of it.",
    input_schema: {
      type: "object",
      properties: {
        of: {
          type: "string",
          description: "What this is an example of. Reuse the exact wording you asked with.",
        },
        text: { type: "string", description: "The example itself, verbatim as the user gave it." },
      },
      required: ["of", "text"],
    },
  },
];

/* --------------------------------- helpers --------------------------------- */

type TaskDoc = Task & { memberIds?: string[] };

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function resolveProject(ctx: ToolContext, name?: string): ProjectRef | undefined {
  if (!name) {
    return (
      ctx.projects.find((p) => p.id === ctx.currentProjectId) ??
      ctx.projects.find((p) => p.workspaceId === ctx.currentWorkspaceId) ??
      ctx.projects[0]
    );
  }
  const n = name.toLowerCase();
  return (
    ctx.projects.find((p) => p.name.toLowerCase() === n) ??
    ctx.projects.find((p) => p.name.toLowerCase().includes(n) || n.includes(p.name.toLowerCase()))
  );
}

/** Every task the user can access, across ALL their workspaces. The
 *  `memberIds array-contains` query is the same isolation gate the client uses,
 *  so this only ever returns tasks the user is a member of. */
async function fetchAccessibleTasks(uid: string): Promise<TaskDoc[]> {
  const snap = await adminDb().collection("tasks").where("memberIds", "array-contains", uid).get();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<TaskDoc, "id">) }));
}

function isOverdue(t: Task): boolean {
  return !!t.dueDate && t.status !== "done" && t.dueDate < today();
}
function isDueToday(t: Task): boolean {
  return t.dueDate === today() && t.status !== "done";
}

/** The assignee name(s) on a task, tolerating the legacy single-assignee fields. */
function assigneeNames(t: TaskDoc): string[] {
  return [t.assigneeName, ...(t.assignees ?? []).map((a) => a.name)].filter(
    (n): n is string => !!n
  );
}

function compact(t: TaskDoc, projName?: string, parentTitle?: string | null, subtaskCount = 0) {
  return {
    id: t.id,
    title: t.title,
    status: t.status,
    priority: t.priority,
    due: t.dueDate ?? null,
    project: projName ?? null,
    assignee: assigneeNames(t).join(", ") || null,
    parent: parentTitle ?? null, // null => a top-level task
    subtasks: subtaskCount, // number of direct children
  };
}

interface TaskAuthor {
  uid: string;
  userName: string;
}

function baseTaskDoc(
  author: TaskAuthor,
  target: ProjectRef,
  fields: {
    title: string;
    parentId: string | null;
    status?: string;
    priority?: string;
    dueDate?: string | null;
    order: number;
  }
) {
  const now = Date.now();
  return {
    workspaceId: target.workspaceId,
    projectId: target.id,
    parentId: fields.parentId,
    title: fields.title,
    notes: "",
    status: (fields.status as TaskStatus) ?? "todo",
    priority: (fields.priority as TaskPriority) ?? "med",
    assignees: [{ id: author.uid, name: author.userName, avatar: null }],
    assigneeId: author.uid,
    assigneeName: author.userName,
    assigneeAvatar: null,
    dueDate: fields.dueDate || null,
    startDate: null,
    tags: [] as string[],
    dependencies: [] as string[],
    linkedDocs: [] as [],
    order: fields.order,
    createdAt: now,
    updatedAt: now,
    createdBy: author.uid,
    memberIds: target.memberIds,
  };
}

/**
 * Create a nested task tree. Returns the count and a flat summary.
 *
 * Exported and module-level rather than inlined into the tool, because the
 * approval endpoint runs exactly this function on exactly the stored payload.
 * Approving a plan and the agent creating one must not be two implementations
 * that can drift.
 *
 * The real parent id is threaded through the recursion rather than matched by
 * title, so identical subtask names under different parents still nest
 * correctly.
 */
export async function createTaskTree(options: {
  uid: string;
  userName: string;
  target: ProjectRef;
  nodes: TaskNodeInput[];
}): Promise<{ count: number; summary: Record<string, unknown>[] }> {
  const { uid, userName, target, nodes } = options;
  let order = Date.now();
  let count = 0;
  const summary: Record<string, unknown>[] = [];

  const createNode = async (
    node: TaskNodeInput,
    parentId: string | null,
    parentTitle: string | null
  ): Promise<void> => {
    const title = String(node?.title ?? "").trim();
    if (!title) return;
    const doc = baseTaskDoc(
      { uid, userName },
      target,
      {
        title,
        parentId,
        status: node.status,
        priority: node.priority,
        dueDate: node.due_date,
        order: order++,
      }
    );
    const ref = await adminDb().collection("tasks").add(doc);
    count++;
    summary.push({
      id: ref.id,
      title,
      status: doc.status,
      priority: doc.priority,
      due: doc.dueDate,
      project: target.name,
      parent: parentTitle,
    });
    for (const sub of node.subtasks ?? []) await createNode(sub, ref.id, title);
  };

  for (const root of nodes ?? []) await createNode(root, null, null);
  return { count, summary };
}

/** Load this user's stored format examples. Small, per-user, read once per turn. */
export async function loadExamples(uid: string): Promise<Record<string, string>> {
  const snap = await adminDb()
    .collection(EXAMPLES_COLLECTION)
    .where("uid", "==", uid)
    .limit(40)
    .get();
  const out: Record<string, string> = {};
  for (const doc of snap.docs) {
    const data = doc.data() as { of?: string; text?: string };
    if (data.of) out[data.of] = data.text ?? "";
  }
  return out;
}

/* -------------------------------- executor -------------------------------- */

export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext
): Promise<string> {
  const projName = (id: string) => ctx.projects.find((p) => p.id === id)?.name;

  switch (name) {
    case "search_knowledge": {
      const query = String(input.query ?? "");
      const target = input.project ? resolveProject(ctx, String(input.project)) : undefined;
      const namespaces = target ? [target.ragNamespace] : ctx.projects.map((p) => p.ragNamespace);
      // The retrieval profile is the agent's choice: a fact lookup wants
      // precision and a broad question wants coverage, and the model knows which
      // it is asking far better than a heuristic on the query string.
      const result = await agenticRetrieve(namespaces, query, String(input.mode ?? "lookup"));
      const chunks = result.chunks;
      ctx.sources.push(...chunks);
      ctx.steps.push(...result.trace);
      ctx.steps.push(
        `retrieved ${chunks.length} chunk(s) in ${result.attempts} attempt(s), graded ${result.grade}`
      );
      if (chunks.length === 0) return "No matching documents found in the knowledge base.";

      ctx.cards.push({ kind: "sources", data: chunks });

      const rendered: string[] = [];
      const flagged: string[] = [];
      for (const chunk of chunks) {
        const scan = scanForInjection(chunk.text);
        if (scan.flagged) flagged.push(`${chunk.source} (${scan.reasons.join(", ")})`);
        const header = [
          chunk.source,
          chunk.section || null,
          chunk.page ? `page ${chunk.page}` : null,
          chunk.project ?? null,
          `relevance ${chunk.score.toFixed(2)}`,
        ]
          .filter(Boolean)
          .join(" | ");
        rendered.push(
          wrapUntrusted(`${header}\n\n${chunk.text.slice(0, 900)}`, chunk.source, scan.flagged)
        );
      }
      if (flagged.length) {
        ctx.steps.push(`quarantined suspicious passage(s): ${flagged.join("; ")}`);
      }
      return rendered.join("\n\n");
    }

    case "list_tasks": {
      const all = await fetchAccessibleTasks(ctx.uid);
      const byId = new Map(all.map((t) => [t.id, t]));
      const childCount = new Map<string, number>();
      for (const t of all) {
        if (t.parentId) childCount.set(t.parentId, (childCount.get(t.parentId) ?? 0) + 1);
      }

      const target = input.project ? resolveProject(ctx, String(input.project)) : undefined;
      let rows = target ? all.filter((t) => t.projectId === target.id) : all;

      // "under": the subtasks of a specific parent task (matched by title).
      if (input.under) {
        const q = String(input.under).toLowerCase();
        const parent =
          rows.find((t) => t.title.toLowerCase() === q) ??
          rows.find((t) => t.title.toLowerCase().includes(q));
        if (!parent) return `No task found matching "${input.under}" to list subtasks of.`;
        rows = all.filter((t) => t.parentId === parent.id);
      }

      if (input.assignee) {
        const q = String(input.assignee).toLowerCase();
        rows = rows.filter((t) =>
          assigneeNames(t).some((n) => n.toLowerCase().includes(q) || q.includes(n.toLowerCase()))
        );
      }

      if (input.status) rows = rows.filter((t) => t.status === input.status);
      if (input.filter === "overdue") rows = rows.filter(isOverdue);
      if (input.filter === "due_today") rows = rows.filter(isDueToday);

      rows = rows
        .sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"))
        .slice(0, 40);

      const data = rows.map((t) =>
        compact(
          t,
          projName(t.projectId),
          t.parentId ? byId.get(t.parentId)?.title ?? null : null,
          childCount.get(t.id) ?? 0
        )
      );
      ctx.cards.push({ kind: "task_list", data });
      return JSON.stringify({ count: rows.length, tasks: data });
    }

    case "create_task": {
      const target = resolveProject(ctx, input.project ? String(input.project) : undefined);
      if (!target) return "No project available to create the task in.";

      let parentId: string | null = null;
      if (input.parent_title) {
        const all = await fetchAccessibleTasks(ctx.uid);
        const q = String(input.parent_title).toLowerCase();
        parentId =
          all.find((t) => t.projectId === target.id && t.title.toLowerCase().includes(q))?.id ??
          null;
      }

      const doc = baseTaskDoc({ uid: ctx.uid, userName: ctx.userName }, target, {
        title: String(input.title),
        parentId,
        status: input.status as string | undefined,
        priority: input.priority as string | undefined,
        dueDate: input.due_date as string | undefined,
        order: Date.now(),
      });
      const ref = await adminDb().collection("tasks").add(doc);
      ctx.wrote = true;
      audit(ctx.uid, "create_task", { project: target.name, title: doc.title });
      ctx.cards.push({ kind: "created_task", data: { id: ref.id, ...doc, project: target.name } });
      return `Created task "${doc.title}" in ${target.name}${doc.dueDate ? ` due ${doc.dueDate}` : ""}.`;
    }

    case "create_tasks": {
      const target = resolveProject(ctx, input.project ? String(input.project) : undefined);
      if (!target) return "No project available to create tasks in.";
      const nodes = Array.isArray(input.tasks) ? (input.tasks as TaskNodeInput[]) : [];
      if (nodes.length === 0) return "No tasks were provided to create.";

      const total = countNodes(nodes);
      const threshold = settings.approvalTaskThreshold;
      if (threshold && total > threshold) {
        // Big enough that getting it wrong costs the user real time to undo. The
        // plan is stored exactly as it would run, and shown for approval.
        const proposal = await createProposal({
          uid: ctx.uid,
          kind: "create_tasks",
          payload: { tasks: nodes },
          projectId: target.id,
          projectName: target.name,
          summary: `Create ${total} tasks in ${target.name}`,
        });
        ctx.pending = {
          kind: "approval",
          message: `That would create ${total} tasks in ${target.name}. Approve it below and I'll build the tree.`,
          card: {
            kind: "approval",
            data: {
              proposalId: proposal.id,
              action: "create_tasks",
              project: target.name,
              count: total,
              outline: outline(nodes),
            },
          },
        };
        ctx.steps.push(`held ${total} tasks for approval`);
        return (
          `This creates ${total} tasks, which is above the limit for acting without confirmation. ` +
          "NOTHING has been created. Tell the user what the plan covers in one or two lines and " +
          "that it is waiting for their approval below. Do not call any tool again for this request."
        );
      }

      const { count, summary } = await createTaskTree({
        uid: ctx.uid,
        userName: ctx.userName,
        target,
        nodes,
      });
      ctx.wrote = ctx.wrote || count > 0;
      ctx.cards.push({ kind: "task_list", data: summary });
      audit(ctx.uid, "create_tasks", { project: target.name, count });
      return `Created ${count} task${count === 1 ? "" : "s"} (with their subtasks) in ${target.name}.`;
    }

    case "update_task": {
      const all = await fetchAccessibleTasks(ctx.uid);
      const q = String(input.task_title ?? "").toLowerCase().trim();
      const exact = all.filter((t) => t.title.toLowerCase() === q);
      const partial = q ? all.filter((t) => t.title.toLowerCase().includes(q)) : [];
      const candidates = exact.length ? exact : partial;

      if (candidates.length === 0) return `No task found matching "${input.task_title}".`;
      if (candidates.length > 1) {
        // Refuse rather than pick. Editing the wrong task is silent, and the
        // user finds out later — the worst kind of error to make.
        ctx.steps.push(`"${input.task_title}" matched ${candidates.length} tasks`);
        return JSON.stringify({
          ambiguous: true,
          matched: candidates.length,
          candidates: candidates.slice(0, 5).map((t) => ({
            title: t.title,
            project: projName(t.projectId) ?? null,
            status: t.status,
            due: t.dueDate ?? null,
          })),
          next: "Call ask_user with these titles as options. Do not pick one yourself.",
        });
      }

      const match = candidates[0];
      const patch: Record<string, unknown> = { updatedAt: Date.now() };
      if (input.set_status) patch.status = input.set_status;
      if (input.set_priority) patch.priority = input.set_priority;
      if (input.set_title) patch.title = input.set_title;
      if (input.set_due_date !== undefined) patch.dueDate = input.set_due_date || null;

      await adminDb().collection("tasks").doc(match.id).update(patch);
      ctx.wrote = true;
      audit(ctx.uid, "update_task", { task: match.title, patch });
      ctx.cards.push({
        kind: "updated_task",
        data: { id: match.id, title: match.title, ...patch, project: projName(match.projectId) },
      });
      return `Updated "${match.title}".`;
    }

    case "summarize_project": {
      const target = resolveProject(ctx, input.project ? String(input.project) : undefined);
      if (!target) return "Project not found.";
      const all = await fetchAccessibleTasks(ctx.uid);
      const tasks = all
        .filter((t) => t.projectId === target.id)
        .map((t) => compact(t, target.name));
      let chunks: RetrievedChunk[] = [];
      try {
        chunks = await retrieveAndRerank(
          [target.ragNamespace],
          `${target.name} overview status scope goals`,
          undefined,
          "summarize"
        );
        ctx.sources.push(...chunks);
      } catch {
        /* the knowledge base may be empty */
      }
      return JSON.stringify({
        project: target.name,
        tasks,
        knowledge: chunks.map((c) => ({
          source: c.source,
          section: c.section || null,
          text: c.text.slice(0, 700),
        })),
      });
    }

    case "ask_user": {
      const question = String(input.question ?? "").trim();
      const options = Array.isArray(input.options) ? (input.options as string[]) : [];
      ctx.pending = {
        kind: "clarify",
        message: question,
        card: {
          kind: "clarify",
          data: { question, options, because: input.because ?? null },
        },
      };
      ctx.steps.push(`asked for clarification: ${question}`);
      return (
        "Stop here and put this question to the user as your entire reply, in their words, with " +
        "the options if there are any. Do not answer it yourself, do not guess, and do not call " +
        "another tool."
      );
    }

    case "request_example": {
      const of = String(input.of ?? "").trim();
      const stored = ctx.examples[of.toLowerCase()] ?? ctx.examples[of];
      if (stored) {
        ctx.steps.push(`reused a saved example of ${of}`);
        return `The user has already given you an example of ${of}. Match its structure, length and tone:\n\n${stored.slice(0, 2000)}`;
      }
      ctx.pending = {
        kind: "example",
        message: `Do you have an example of ${of} I should match? Paste one and I'll follow its format.`,
        card: { kind: "example_request", data: { of, why: input.why ?? null } },
      };
      ctx.steps.push(`asked for an example of ${of}`);
      return (
        `You have no example of ${of} to work from. Ask the user for one as your entire reply, ` +
        "say in one line what you would match from it, and offer to proceed with your own format " +
        "if they would rather not."
      );
    }

    case "save_example": {
      const of = String(input.of ?? "").trim().toLowerCase();
      const text = String(input.text ?? "");
      if (!of || !text.trim()) return "Nothing to save.";
      try {
        await adminDb()
          .collection(EXAMPLES_COLLECTION)
          .doc(`${ctx.uid}:${of}`)
          .set({ uid: ctx.uid, of, text: text.slice(0, 8000), updatedAt: Date.now() });
      } catch {
        // Never lose the user's turn over a write.
        ctx.steps.push("could not save the example");
        return "I could not save that, but I will use it for this reply.";
      }
      ctx.examples[of] = text;
      ctx.steps.push(`saved an example of ${of}`);
      return `Saved. Match this example's structure, length and tone whenever you write ${of} from now on.`;
    }

    default:
      return `Unknown tool: ${name}`;
  }
}
