# Second Brain — Claude Code Working Guide

Read this first in any session. It is the map of the codebase and the rules for changing it.

## What this is

Shipped as **Lune AI — Your Personal Workspace** (product name; the codebase/package is still `second-brain`). An AI-native project + knowledge manager. Notion-meets-Linear feel: dense, dark, keyboard-friendly. Pillars on one backend:

1. **Execution** — Workspace -> Project -> Task -> Subtask (recursive). Nine per-project tabs: Tree, Board (Kanban), List, Calendar, Map (React Flow mind map), Draw (Excalidraw whiteboard), Docs (project pages), **Members** (Kanban grouped by assignee, drag to reassign) and **Team** (per-project member roles/skills + AI task assignment). List/Board only ever show top-level tasks with subtasks nested underneath. The Board supports **per-project custom statuses** on top of the four built-ins.
2. **Knowledge** — per-project RAG. Upload docs; they are parsed *with structure* (headings, tables, pages, OCR for scans), chunked on that structure, contextualised, embedded (Voyage) and stored in Pinecone. See `docs/RAG.md`.
3. **Agent** — a Claude tool-calling agent ("the brain") that reads and writes tasks and searches knowledge. Conversations are saved to Firestore (chat history sidebar). Plus a daily standup.
4. **Today** (`/today`) — every task due on the focused day across *all* workspaces, plus a per-user day planner (notebook) synced to Firestore. A day picker (prev/next + back-to-today) drives the task list, stats, export and the notebook together; overdue only shows when the focused day is today. Tasks assigned to the current user float to the top of each group.
5. **Pages** — Notion-style block documents (BlockNote) at workspace or project level, nestable into a page tree.
6. **Sharing + team** — invite teammates by email with owner/admin/member/viewer roles, scoped to the whole workspace or specific projects. Admins set each member's role/skills per project (Team tab) and can turn a brief or doc into an assigned task list with AI (`/api/assign`). See `docs/COLLABORATION.md`.

Full product intent is in `second-brain-app-spec.md` and `second-brain-design-brief.md` at the repo root (source material — not code).

## Stack

| Layer | Choice | Notes |
|---|---|---|
| Framework | Next.js 14.2 (App Router) + TypeScript | `src/` dir, `@/*` path alias |
| Styling | Tailwind CSS 3.4, CSS-variable tokens | dark default, light fallback |
| Auth | Firebase Auth (Google) | client SDK; server verifies ID tokens |
| Database | Cloud Firestore | real-time `onSnapshot`, per-workspace isolation. **Client init forces long-polling** (`initializeFirestore` + `experimentalForceLongPolling` in `lib/firebase/client.ts`) to dodge a WebChannel watch-stream assertion crash |
| Agent + generation | Anthropic Claude, **tiered per turn** | `CLAUDE_MODEL` (default `claude-haiku-4-5`) for fast/reasoned, `CLAUDE_DEEP_MODEL` (`claude-sonnet-5-5`) for planning turns. Tool-use loop, server-only. Retrieval helpers always run on the fast model |
| Document parsing | `unpdf` (layout PDF), `mammoth` (docx), `xlsx`, `jszip` (pptx), `pdf-lib` (page extraction for OCR) | all pure JS — no native deps, serverless-safe |
| Cache | in-process LRU → Upstash REST → Firestore | answers (exact + semantic), query embeddings, chunk vectors, rate limits. `GET /api/ready` says which tier is live |
| Embeddings | Voyage AI (`voyage-3.5`, 1024-dim) | Claude has no embedding model |
| Vector store | Pinecone | one index, namespace per project |
| Drag + drop | @dnd-kit | Kanban + Calendar |
| Mind map | reactflow (v11) | Map view — auto-laid-out task tree |
| Whiteboard | @excalidraw/excalidraw | Draw view — one scene per project, saved to Firestore |
| Pages editor | BlockNote (`@blocknote/*` v0.31, React-18 compatible) | Notion-style block editor; loaded via `ssr:false` dynamic import |
| Hosting | Netlify (`@netlify/plugin-nextjs`) | manual deploys, no CI/CD yet |

`reactStrictMode` is **off** in `next.config.js` on purpose — StrictMode's dev double-mount rapidly re-subscribes Firestore listeners and trips the same WebChannel assertion.

Model + RAG rationale: `docs/RAG.md` (full pipeline + diagram) and `docs/AGENTIC_RAG.md` (retrieval loop, agent loop, tuning). Guardrails and threat model: `docs/SECURITY.md`. Data model: `docs/DATA_MODEL.md`. Team roles, AI assignment, Members board + custom statuses: `docs/COLLABORATION.md`. Visual system: `docs/DESIGN_SYSTEM.md`. Architecture: `docs/ARCHITECTURE.md`. Setup: `docs/SETUP.md`. Google Calendar sync: `docs/CALENDAR.md`. Deployment: `docs/DEPLOYMENT.md`. Roadmap + phase status: `docs/ROADMAP.md`. Recent changes: `docs/CHANGELOG.md`.

## Live instance (provisioned + deployed)

- **Production:** https://luneai.site (Netlify site `esa-ai-personal-assistant`, team `eobadaarachchi`/"Shona"; the `*.netlify.app` subdomain still resolves). Deploy manually with `netlify deploy --build --prod`. Env vars live on the Netlify site (imported from `.env.local`, with the URL-based ones repointed to the prod domain). Set `CLAUDE_MODEL` there to change the generation model (default Haiku).
- **Firebase project:** `second-brain-fbf414` (owner `eobadaarachchi@gmail.com`), pinned in `.firebaserc`.
- **Auth:** Google sign-in enabled. Authorised domains include `localhost`, `esa-ai-personal-assistant.netlify.app` and `luneai.site`. On first login a signed-in user is seeded with a single **Test it out** sandbox workspace holding two demo projects.
- **Firestore:** `asia-south1`. **Rules must be redeployed after any change** (`firebase deploy --only firestore:rules`) — hosting on Netlify does not touch them. New collections (`dayPlans`, `whiteboards`, `pages`, `chats`, `chatMessages`, `usage`, and the server-only `agentProposals` / `agentExamples` / `agentAudit` / `agentCache`) will 403 until the rules are live.
- **Admin oversight (`/admin`):** owner-only Batcomputer dashboard — user list, workspace counts and per-user Claude spend. Gated to the emails in `lib/admin.ts` (`ADMIN_EMAILS`). Spend is tracked by `lib/ai/usage.ts`: every Claude call inside `/api/chat` and `/api/assign` runs in a `withUsage(user, …)` scope, and `recordUsage` folds token counts + USD cost into `usage/{uid}` (server-only collection). There is **no historical backfill** — figures accumulate from first deploy of the tracking. Pricing table in `usage.ts` (keyed by model; update if `CLAUDE_MODEL` changes tier).
- **Admin SDK:** service-account key set in `.env.local` + Netlify — powers `requireUser`, agent writes and all sharing writes.
- **AI keys:** `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`, `PINECONE_API_KEY` are configured. If ever blank, everything except `/api/chat`, `/api/ingest`, `/api/related`, `/api/assign` still works.

Setup for a fresh instance from scratch: `docs/SETUP.md`. Hosting details: `docs/DEPLOYMENT.md`.

## Directory map

```
src/
  app/
    layout.tsx                 Root: AuthProvider + ThemeProvider, theme-flash guard
    (auth)/login/page.tsx      Google sign-in + interactive marketing/landing content
    (app)/layout.tsx           Auth guard -> WorkspaceProvider -> AppFrame
    (app)/page.tsx             Project View (Tree/Board/List/Calendar/Map/Draw/Docs + task drawer)
    (app)/today/page.tsx       Today: due-today across all workspaces + day planner notebook
    (app)/overview/page.tsx    Per-workspace dashboard (project cards, status, attention, Share)
    (app)/workspaces/page.tsx  All-workspaces portfolio board
    (app)/pages/page.tsx       Pages index (docs grouped by workspace + project)
    (app)/pages/[id]/page.tsx  Single page -> <PageView> block editor
    (app)/agent/page.tsx       Standup + chat surface (with saved chat-history sidebar)
    (app)/knowledge/page.tsx   Document / note ingestion
    api/chat|ingest|related    Agent, RAG ingest, smart-linking (POST)
    api/chat/stream/route.ts   The same agent turn as SSE (meta/step/thinking/token/card/done)
    api/proposals/[id]/route.ts Approve or cancel a held plan (large writes). No model runs here
    api/ready/route.ts         What this deployment is actually wired to (cache tier, models, keys present)
    api/assign/route.ts        AI task assignment: brief -> workload-aware task proposals (admin only)
    api/members/route.ts       Sharing: list/invite/accept/update/remove (POST/GET).
                               NB named /api/members, NOT /api/share — ad-blockers block "share" URLs.
    api/calendar/*             Google Calendar OAuth + two-way sync
    api/admin/stats/route.ts   Owner-only telemetry: users + workspaces + Claude spend (GET, admin-gated)
    admin/page.tsx             Batcomputer oversight dashboard (outside the (app) shell; owner email only)
  components/
    ui/        Design-system primitives (Button, Avatar, Dropdown, Modal, chips, StatusControl...).
               Dropdown renders in a body portal (fixed, viewport-clamped, flips up).
    shell/     Sidebar (collapsible), WorkspaceSwitcher, AppFrame, ShareDialog
    task/      TaskRow, TaskCard, TaskDrawer, Pickers, TimeTracker
    views/     TreeView, KanbanBoard, ListView, CalendarView, DayDetail,
               MindMapView (React Flow), WhiteboardView (Excalidraw), MemberBoard (Kanban by assignee)
    pages/     PageView, BlockEditor (BlockNote, ssr:false), ProjectPages (Docs tab)
    project/   ProjectHeader (tabs + stats + export), PrintView, CalendarSync, TeamView (roles + AI assign)
    agent/     StandupCard, AgentMessage, ChatSidebar, cards
  lib/
    firebase/  client.ts (browser, long-polling), admin.ts (server, requireUser)
    auth/ theme/  AuthContext, ThemeContext
    data/      firestore.ts (tasks, projects, pages, dayPlans, whiteboards, chats, custom statuses, ensureInbox),
               WorkspaceContext (tasks, workspaceTasks, allTasks, pages, inboxProject, useProjectStatuses),
               useTaskActions, tree.ts, standup.ts
    share/     server.ts (admin-side membership: invites, roles, per-project scope, recompute)
    ai/        config, documents, parse + parsers/, vision, chunker, contextualize, ingest,
               voyage, sparse, pinecone, fusion, profiles, retrieval, router, anthropic,
               persona, memory, tools, agent, streaming, turn, proposals, audit, server
    cache/     store (3-tier), semantic (answer cache), vectors (embeddings + chunk vectors)
    security/  guardrails (injection, redaction, sanitising), limits (rate limiting)
    google/    calendar.ts, store.ts, sync.ts
    types.ts, constants.ts, date.ts, utils.ts, api.ts, export.ts
firestore.rules / firestore.indexes.json / firebase.json / netlify.toml
```

## Non-negotiable rules

1. **Secrets stay server-side.** `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`, `PINECONE_API_KEY` and the Firebase Admin key are only ever read inside `src/app/api/**` or `src/lib/ai/**` / `src/lib/firebase/admin.ts`. Never import those into a client component. Only `NEXT_PUBLIC_*` Firebase values reach the browser.
2. **All task/project/workspace mutations go through the data layer.** Client code calls `useTaskActions()` or the functions in `src/lib/data/firestore.ts` — never `updateDoc` inline in a component. The agent (server) writes through `firebase-admin` in `src/lib/ai/tools.ts`.
3. **Per-workspace isolation is enforced by `memberIds`.** Every `workspaces`/`projects`/`tasks`/`pages`/`whiteboards`/`dayPlans` doc carries `memberIds`. `firestore.rules` gates every read/write on `request.auth.uid in memberIds`. When you add a doc type, add `memberIds` and a rule. Docs that may not exist yet (a fresh page/whiteboard/dayPlan) use `allow read: if (resource == null && signedIn()) || isMember(resource.data)` so the empty state loads instead of 403-ing.
4. **Sharing/membership writes go through the server.** All membership changes (invite, accept, role, scope, remove) run in `lib/share/server.ts` via `firebase-admin` and call `recomputeMembership`, which re-derives every project/task `memberIds` from `workspace.members[].scope`. Never edit `memberIds` from the client. `invites` is server-only (`allow read,write: if false`).
5. **Colours come from tokens.** Use the Tailwind semantic tokens (`bg`, `surface`, `accent`, `text-muted`, `danger`...). Do not hardcode hex in components. New colours go in `globals.css` + `tailwind.config.ts`.
6. **Keep the task views consistent.** Tree/List/Board/Calendar/Map render the same `Task` data; a field added to one editing surface should be honoured everywhere. List/Board show only top-level tasks (subtasks nest under their parent). Ordering: Tree and List float the current user's assigned tasks to the top of each group (done still sinks to the bottom, manual `order` breaks ties); Board and Map stay in pure manual order. See `docs/DATA_MODEL.md`.
7. **Never name a client-hit route with an ad-blockable word.** `/api/share` was silently killed by ad-blockers (`ERR_BLOCKED_BY_CLIENT`); it is now `/api/members`. Avoid `share`, `track`, `ad`, `analytics`, `collect` in public route paths.
8. **Never push straight to `main` on a real deployment.** Feature branch + PR. (Local dev on `main` is fine.) The auto-approver enforces this.

## How the agent works (important)

`POST /api/chat` (or `/api/chat/stream`) -> `requireUser` verifies the Firebase ID token -> rate limit + input sanitise -> **answer cache** (exact, then semantic) -> `loadUserScope` fetches **every workspace and project the user can access, across all their workspaces** (each gated by `memberIds`, so per-project scope still holds) -> the **router** picks a tier -> `runAgent` runs a Claude tool-use loop (`src/lib/ai/agent.ts`) with the tools in `src/lib/ai/tools.ts`:

- `search_knowledge` — hybrid retrieve (dense + optional lexical) -> RRF -> rerank -> MMR -> confidence gate, across every accessible project namespace. Takes a `mode` so the agent picks the retrieval profile itself
- `list_tasks`, `create_task`, `create_tasks`, `update_task` — read/write Firestore via admin, spanning all the user's workspaces
- `summarize_project` — tasks + the `summarize` retrieval profile
- `ask_user`, `request_example`, `save_example` — the agent asks instead of guessing; these set `ctx.pending`, they do not throw

The request's `workspaceId`/`projectId` are only the current view. Cost caps: `MAX_TOOL_ROUNDS` 6 in `agent.ts`, `ANSWER_MAX_TOKENS`, plus per-user rate limits. Memory is a 3-pair verbatim window over a **rolling summary** (`memory.ts`), rebuilt after the reply is sent. The system prompt is split at a **cache breakpoint** (`persona.ts`): the stable half must stay byte-identical between turns or prompt caching silently stops working for everyone. Tool executors accumulate `sources`, `cards` and `steps` on the `ToolContext`; these are returned to the UI and rendered by `components/agent/cards.tsx`.

Guardrails, in short: retrieved passages reach the model wrapped as untrusted data; injection-shaped passages are quarantined with a warning rather than dropped; nothing retrieved can write; writes above `APPROVAL_TASK_THRESHOLD` are held for approval; answers are groundedness-checked and scanned for credentials; every write is audited. Full detail and the known gaps: `docs/SECURITY.md`.

When you change the API/agent surface, read the `claude-api` skill for current model IDs and SDK shapes — do not guess. The two tiers configure thinking differently (Haiku takes `budget_tokens`; Sonnet 5.5 rejects it and takes adaptive thinking + effort).

Verify the pipeline with `scripts/rag-check/` — `offline.ts` and `parsers.ts` need no keys; `live.ts` and `shrink.ts` hit the real services in a throwaway Pinecone namespace and clean up after themselves.

## Working conventions

- Commit per subtask with a conventional-commit subject (`feat(scope): …`). Keep commits coherent and buildable.
- Run `npm run typecheck` before committing; `npm run build` before opening a PR.
- Match the surrounding style: comment density, naming, token usage. New components are `"use client"` only when they use hooks/state.
- Prefer editing an existing primitive over inventing a parallel one. Reuse `Dropdown`, `Modal`, `Button`, the pickers.

## Commands

```bash
npm run dev        # http://localhost:3000
npm run typecheck  # tsc --noEmit
npm run build      # production build (run before PRs)
npm run lint       # next lint
```

## Where to start for common tasks

| Task | Start in |
|---|---|
| A new task field | `lib/types.ts` -> `firestore.ts` + `useTaskActions` -> the task views + `TaskDrawer` |
| A new agent tool | `lib/ai/tools.ts` — add the schema to `TOOLS` **and** a case to `executeTool`. Write the description for a model deciding under uncertainty: what it does, when to use it, when *not* to |
| Retrieval quality | `lib/ai/profiles.ts` (per-job knobs) -> `retrieval.ts` (the loop) -> `fusion.ts`. Tuning table in `docs/AGENTIC_RAG.md` |
| A new document format | `lib/ai/parsers/` -> route it in `parse.ts`. Return a `ParsedDocument`, never a flat string |
| Guardrails / limits | `lib/security/` -> `docs/SECURITY.md` |
| A new project view/tab | `components/views/` (or `project/`) -> add a `ViewTab` in `project/ProjectHeader.tsx` + a branch in `app/(app)/page.tsx` |
| Task statuses / custom statuses | `constants.ts` (`projectStatuses`, `statusMeta`), `KanbanBoard`/`ListView`, `useProjectStatuses`. See `docs/COLLABORATION.md` |
| Team roles / AI assignment | `components/project/TeamView.tsx` + `api/assign/route.ts` (server, admin-gated) |
| Pages / block editor | `components/pages/` (PageView, BlockEditor, ProjectPages), `firestore.ts` page fns, `pages` rule |
| Sharing / roles | `lib/share/server.ts` + `api/members/route.ts` + `components/shell/ShareDialog.tsx` |
| Change the look | `src/app/globals.css` tokens + `tailwind.config.ts`, then `docs/DESIGN_SYSTEM.md` |
| A new doc type / collection | `lib/types.ts`, `firestore.ts`, add a rule in `firestore.rules`, then `firebase deploy --only firestore:rules` |
| Deploy | `netlify deploy --build --prod`; rules separately via Firebase CLI. See `docs/DEPLOYMENT.md` |

Also see `.claude/skills/` for the design-system, component-builder and firestore-patterns skills, and `.claude/agents/` for specialised subagents.
