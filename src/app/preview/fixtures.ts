/**
 * Fixture data for the dev-only /preview harness. Not shipped: the route
 * returns 404 outside development. Content is drawn from the real workspaces so
 * the layout is judged against realistic strings rather than "Task 1 / Task 2".
 */
import type { Project, Task, Workspace, WorkspaceMember } from "@/lib/types";

const now = Date.now();
const day = 86_400_000;
const iso = (offset: number) => new Date(now + offset * day).toISOString().slice(0, 10);

export const members: WorkspaceMember[] = [
  { uid: "u1", name: "Esandu Obadaarachchi", email: "eobadaarachchi@gmail.com", role: "owner" },
  { uid: "u2", name: "Nuwan Perera", email: "nuwan@slt.lk", role: "admin" },
  { uid: "u3", name: "Hasini Silva", email: "hasini@slt.lk", role: "member" },
  { uid: "u4", name: "Kavindu Fernando", email: "kavindu@slt.lk", role: "member" },
];

export const workspaces: Workspace[] = [
  { id: "w1", name: "SLT Telecom", emoji: "📡", ownerId: "u1", memberIds: ["u1", "u2", "u3", "u4"], members, createdAt: now - 400 * day },
  { id: "w2", name: "Hotel ODON", emoji: "🏨", ownerId: "u1", memberIds: ["u1"], members: [members[0]], createdAt: now - 300 * day },
  { id: "w3", name: "University", emoji: "🎓", ownerId: "u1", memberIds: ["u1"], members: [members[0]], createdAt: now - 500 * day },
];

const proj = (id: string, name: string, color: string, extra: Partial<Project> = {}): Project => ({
  id, workspaceId: "w1", name, color,
  ragNamespace: `ns-${id}`, createdAt: now - 90 * day,
  memberIds: ["u1", "u2", "u3", "u4"],
  tags: ["frontend", "backend", "data", "urgent", "review"],
  ...extra,
});

export const projects: Project[] = [
  proj("inbox", "Inbox", "#9aa1b0", { isInbox: true }),
  proj("p1", "Solar Dashboard", "#f5c542", { description: "Unified monitoring for 19 SLT solar sites." }),
  proj("p2", "PowerProx Mobile", "#60a5fa"),
  proj("p3", "PowerZenith", "#4ade80"),
  proj("p4", "TalentGrid", "#c084fc"),
  proj("p5", "Fault Management", "#f87171", { archived: true }),
  // The other two businesses, so the portfolio board has something real to show.
  proj("h0", "Inbox", "#9aa1b0", { workspaceId: "w2", isInbox: true, memberIds: ["u1"] }),
  proj("h1", "Booking.com + AirBnB", "#f87171", { workspaceId: "w2", memberIds: ["u1"] }),
  proj("h2", "Hotel Odon App", "#60a5fa", { workspaceId: "w2", memberIds: ["u1"] }),
  proj("h3", "Hotel Marketing", "#f472b6", { workspaceId: "w2", memberIds: ["u1"] }),
  proj("h4", "Hotel Finances", "#4ade80", { workspaceId: "w2", memberIds: ["u1"] }),
  proj("u0", "Inbox", "#9aa1b0", { workspaceId: "w3", isInbox: true, memberIds: ["u1"] }),
  proj("u1p", "MA-CycleGAN thesis", "#c084fc", { workspaceId: "w3", memberIds: ["u1"] }),
  proj("u2p", "MLOps pipeline", "#f5c542", { workspaceId: "w3", memberIds: ["u1"] }),
  proj("u3p", "Coursera certs", "#22d3ee", { workspaceId: "w3", memberIds: ["u1"] }),
];

let order = 0;
const task = (t: Partial<Task> & { id: string; title: string }): Task => ({
  workspaceId: "w1", projectId: "p1", parentId: null,
  status: "todo", priority: "med", tags: [], dependencies: [], linkedDocs: [],
  memberIds: ["u1", "u2", "u3", "u4"],
  order: order++, createdAt: now - 20 * day, updatedAt: now - day, createdBy: "u1",
  ...t,
});

export const tasks: Task[] = [
  task({ id: "t1", title: "Ship the kWh/kWp comparison chart", status: "in_progress", priority: "urgent", dueDate: iso(0), tags: ["frontend"], estimate: 5,
        assignees: [{ id: "u1", name: "Esandu Obadaarachchi" }], assigneeId: "u1", assigneeName: "Esandu Obadaarachchi" }),
  task({ id: "t1a", parentId: "t1", title: "Normalise output by installed capacity", status: "done", priority: "high", completedAt: now - day }),
  task({ id: "t1b", parentId: "t1", title: "Recharts axis + tooltip pass", status: "in_progress", priority: "med", dueDate: iso(0) }),
  task({ id: "t1c", parentId: "t1", title: "Handle sites with a missing capacity value", status: "todo", priority: "low" }),
  task({ id: "t2", title: "Excel upload pipeline rejects malformed sheets", status: "blocked", priority: "high", dueDate: iso(-2), tags: ["backend", "urgent"], estimate: 3,
        assignees: [{ id: "u2", name: "Nuwan Perera" }], assigneeId: "u2", assigneeName: "Nuwan Perera" }),
  task({ id: "t3", title: "Async SQLAlchemy migration for the readings table", status: "todo", priority: "high", dueDate: iso(2), tags: ["backend", "data"], estimate: 8,
        assignees: [{ id: "u3", name: "Hasini Silva" }], assigneeId: "u3", assigneeName: "Hasini Silva" }),
  task({ id: "t3a", parentId: "t3", title: "Backfill the 2025 readings", status: "todo", priority: "med" }),
  task({ id: "t4", title: "Site detail page: month-on-month yield", status: "todo", priority: "med", dueDate: iso(5), tags: ["frontend"], estimate: 5,
        assignees: [{ id: "u4", name: "Kavindu Fernando" }], assigneeId: "u4", assigneeName: "Kavindu Fernando" }),
  task({ id: "t5", title: "Write the BMPC 2026 submission summary", status: "todo", priority: "low", dueDate: iso(9), tags: ["review"] }),
  task({ id: "t6", title: "Alerting when a site drops below 60% expected yield", status: "todo", priority: "high", tags: ["backend"], estimate: 13 }),
  task({ id: "t7", title: "Retire the legacy per-site spreadsheets", status: "done", priority: "med", completedAt: now - 3 * day, tags: ["data"],
        assignees: [{ id: "u1", name: "Esandu Obadaarachchi" }], assigneeId: "u1", assigneeName: "Esandu Obadaarachchi" }),
  task({ id: "t8", title: "Postgres connection pooling under the nightly import", status: "done", priority: "high", completedAt: now - 6 * day, tags: ["backend"] }),

  // Hotel ODON
  task({ id: "h1a", workspaceId: "w2", projectId: "h1", title: "Reconcile October AirBnB payouts", status: "in_progress", priority: "high", dueDate: iso(1) }),
  task({ id: "h1b", workspaceId: "w2", projectId: "h1", title: "Fix the double-booking edge case on Booking.com", status: "blocked", priority: "urgent", dueDate: iso(-1) }),
  task({ id: "h1c", workspaceId: "w2", projectId: "h1", title: "Update the room photos for all 11 rooms", status: "todo", priority: "med" }),
  task({ id: "h1d", workspaceId: "w2", projectId: "h1", title: "Refresh the cancellation policy copy", status: "done", priority: "low", completedAt: now - 2 * day }),
  task({ id: "h2a", workspaceId: "w2", projectId: "h2", title: "Push the booking flow to TestFlight", status: "done", priority: "high", completedAt: now - 4 * day }),
  task({ id: "h2b", workspaceId: "w2", projectId: "h2", title: "MongoDB Atlas index on checkIn", status: "done", priority: "med", completedAt: now - 5 * day }),
  task({ id: "h3a", workspaceId: "w2", projectId: "h3", title: "December offer for the Colombo corporate list", status: "todo", priority: "high", dueDate: iso(4) }),
  task({ id: "h3b", workspaceId: "w2", projectId: "h3", title: "Instagram reel from the rooftop shoot", status: "in_progress", priority: "med" }),
  task({ id: "h4a", workspaceId: "w2", projectId: "h4", title: "Close out the September P&L", status: "todo", priority: "urgent", dueDate: iso(-3) }),
  task({ id: "h4b", workspaceId: "w2", projectId: "h4", title: "Chase the laundry supplier invoice", status: "todo", priority: "low" }),

  // University
  task({ id: "u1a", workspaceId: "w3", projectId: "u1p", title: "Write up the FOMAML ablation results", status: "in_progress", priority: "urgent", dueDate: iso(2) }),
  task({ id: "u1b", workspaceId: "w3", projectId: "u1p", title: "Rerun the CT-to-MRI baseline on Vast.ai", status: "blocked", priority: "high" }),
  task({ id: "u1c", workspaceId: "w3", projectId: "u1p", title: "Related work section", status: "done", priority: "med", completedAt: now - 8 * day }),
  task({ id: "u2a", workspaceId: "w3", projectId: "u2p", title: "Dockerise the model server", status: "todo", priority: "high", dueDate: iso(6) }),
  task({ id: "u2b", workspaceId: "w3", projectId: "u2p", title: "GitHub Actions pipeline for the Azure VM", status: "todo", priority: "med" }),
  task({ id: "u3a", workspaceId: "w3", projectId: "u3p", title: "Finish Neural Networks and Deep Learning", status: "in_progress", priority: "med", dueDate: iso(11) }),
];
