# Changelog

## RAG v2 — structure-aware ingestion, hybrid retrieval, tiered generation, guardrails

A rebuild of the retrieval and generation pipeline. Full detail in `docs/RAG.md`,
`docs/AGENTIC_RAG.md` and `docs/SECURITY.md`; the short version of what changed and why.

**Ingestion.** Documents are parsed *with structure* instead of being flattened to a
string: the PDF parser reconstructs headings from typography, tables from column
positions and page numbers from the layout, strips running headers, and sends pages
with no text layer to Claude as a PDF document block for transcription (no
rasterising, no native dependency, several pages per call). New format support for
`.xlsx`, `.pptx` (including speaker notes), `.doc`, images, and source code split on
top-level definitions. Chunking now respects sections, keeps tables and code atomic,
repeats a table's header across splits, carries a heading breadcrumb into the
embedded text, sizes in tokens, folds fragments and drops duplicates. Every chunk
gets a generated sentence situating it in its document (contextual retrieval), paid
for once at ingest behind a cached prompt prefix.

**Indexing is now idempotent.** Vector ids are `{docId}#{index}` rather than random
UUIDs, so re-uploading a file replaces it instead of silently doubling it in the
index. A shrinking document leaves no stale tail: the old vectors are deleted by
prefix, and the ids beyond the new chunk count are deleted by name afterwards
(Pinecone's list API lags the write path, so the prefix delete alone can miss what
it was meant to remove).

**Retrieval.** Optional hybrid search (dense + learned lexical) fused with reciprocal
rank fusion, cross-encoder rerank, MMR with a per-document cap, and four tuned
profiles the agent selects itself. The rewrite-then-grade loop is replaced by a
confidence gate on the reranker's own score: **zero LLM calls on the common path,
at most two on the recovery path, against a guaranteed two before.** Hybrid is off
by default because it needs a dotproduct index; everything runs dense-only until
that is created, so no reindex is required to deploy this.

**Generation.** Per-turn model tiering (fast / reasoned / deep), a system prompt
split at a prompt-cache breakpoint, conversation memory as a short verbatim window
over a rolling summary, parallel tool execution, and SSE streaming at
`/api/chat/stream`. Three new tools let the agent ask rather than guess: `ask_user`
(with option buttons), `request_example` and `save_example`.

**Caching.** Answer cache (exact + semantic), query-embedding cache and chunk-vector
cache, over a three-tier store: in-process LRU → Upstash REST → Firestore. Scoped
per user and per project set, versioned so any write invalidates it immediately.

**Guardrails.** Retrieved passages reach the model wrapped as untrusted data and
injection-shaped passages are quarantined with a visible warning rather than dropped;
nothing retrieved can write; bulk task creation above a threshold is held for
explicit approval (and approval runs the stored plan with no model in the loop);
`update_task` refuses an ambiguous match instead of editing the wrong task; answers
are groundedness-checked and scanned for credentials; every write is audited; per-user
rate limits on chat and ingest. Known gaps are listed in `docs/SECURITY.md`.

**Also:** `GET /api/ready` reports what the deployment actually wired up, the
Anthropic SDK is upgraded to 0.129 (adaptive thinking), and `scripts/rag-check/`
holds four verification scripts — two offline, two live and self-cleaning.

**Deploy note:** run `firebase deploy --only firestore:rules` — four new server-only
collections 403 until the rules are live.


Notable changes, newest first. Product name: **Lune AI**.

## 2026-07-16 — Docs deep-dive

- Rewrote `docs/RAG.md` and `docs/AGENTIC_RAG.md` as full teaching guides: the ingestion pipeline (parse/chunk/embed/upsert), embeddings and the vector store, the bi-encoder vs cross-encoder two-stage retrieval, the agentic loop, the agent tool loop, the cost model, security/isolation, observability, design choices and every fix — the what, how and why. Refreshed `docs/ARCHITECTURE.md`.

## 2026-07-16 — All my tasks

### Added
- **"All my tasks"** — a new sidebar item (under All workspaces) and `/my-tasks` page showing every task assigned to you across every project and workspace, in the same **List / Board / Tree / Calendar** views used inside a project. The view components now take an optional `tasks` prop (defaulting to the current project) so they render any task set; creation affordances are hidden in the cross-project view. Still membership-gated — only tasks you can see appear.

## 2026-07-16 — Reliable task trees + assignees/subtasks

### Added
- **`create_tasks` batch tool.** The agent can build a whole task tree — tasks with nested subtasks — in a single call, with exact parent-child links. This fixes the agent creating top-level tasks but stopping before the subtasks (it used to run out of tool rounds making one `create_task` call per node), and makes deep nesting (identical subtask names under many parents) reliable. Tool-round cap raised 4 → 6 for headroom.

### Fixed
- **Silent "…" on an over-long request.** When a batch was too big, the model's tool call exceeded the output-token cap (`stop_reason: max_tokens`) and the agent returned an empty answer that rendered as "…". It now detects truncation and says so, telling the user to split into smaller batches, and keeps whatever was already created. Tool-execution errors are surfaced in the action trace and marked `is_error`, and an empty answer falls back to a clear message instead of blank.

### Fixed
- **The agent could not answer "who is X's tasks" or "subtasks of Y".** `list_tasks` was dropping the assignee and parent-task fields, and had no filter for either. It now returns each task's assignee and parent, and accepts an `assignee` filter and an `under` filter (a parent task's title → its subtasks). The persona prompt tells the agent to use them. The `task_list` card shows the assignee, parent (↳) and subtask count.

### Also
- The Agent page is mobile-responsive (chat-list drawer, collapsible standup, roomy composer).

## 2026-07-15 — Cross-workspace agent + global chat history

### Changed
- **The agent now spans every workspace.** `/api/chat` loads `loadUserScope` (all workspaces + projects the user can access, gated by `memberIds`) instead of a single workspace. So "what are my tasks today / assigned to me" returns tasks from every workspace, and knowledge search reaches every accessible project's docs. The current `workspaceId`/`projectId` are now only the default for new tasks and the prompt's naming. Per-project isolation is unchanged — a scoped member still only sees their projects.
- **Chat history is global.** `watchChats(uid)` no longer filters by workspace, and the Agent page no longer resets the conversation when you switch workspace. Any past chat opens from any workspace.
- `create_task` writes into the target project's own workspace and `memberIds` (the agent can create in any accessible project, not only the current workspace).

## 2026-07-15 — Team, statuses, cheaper agent

Shipped to `main` and deployed to https://luneai.site.

### Added
- **AI task assignment + Team tab.** Per-project member roles/skills (`project.team`) set on a new **Team** tab. Admins turn a brief (PDF/DOCX/text) into an assigned task list via `/api/assign` — the AI splits the work and assigns by role, skills and current workload, shown as a preview to approve before anything is written. See `docs/COLLABORATION.md`.
- **Members board.** New **Members** tab: a Kanban with one column per teammate + Unassigned, live counts, and drag-to-reassign.
- **Custom task statuses.** Per-project status columns on top of the four built-ins. Add/delete on the Board with a colour; deleting one moves its tasks back to To Do. Shown in the Board, List and status picker.
- **Agent chat history.** Conversations save to Firestore (`chats` + `chatMessages`), with a sidebar to reopen and delete them. Only the last 5 turns are sent to the model.
- **Configurable model.** Generation model is now the `CLAUDE_MODEL` env var (default `claude-haiku-4-5`); set it to Opus/Sonnet for higher quality.

### Changed
- **Cheaper agent.** Output capped at `MAX_ANSWER_TOKENS` 1024, tool rounds at `MAX_TOOL_ROUNDS` 4; retrieval trimmed to `KEEP` 4 chunks / 500-char passages / `MAX_ATTEMPTS` 2; chat input capped at `MAX_CHAT_INPUT_CHARS` 2000 (composer + server).
- **Composer grows** with the prompt up to a cap, then scrolls.
- **First-run seed** is now a single **Test it out** sandbox workspace with two demo projects (was Office / Freelance / LeadX).

### Fixed
- **RAG per-project scope.** `loadWorkspace` now filters the agent's projects by per-project membership, not just workspace membership — a scoped member can no longer read another project's knowledge or tasks through the chatbot.
- **Chat history loaded blank.** `loadChatMessages`/`deleteChat` queried `chatMessages` by `chatId` only, which the rules reject ("rules are not filters"). They now query by `memberIds array-contains uid` and narrow to the chat in JS.

### Ops
- Firestore `chats`/`chatMessages` rules must be live for chat history — `firebase deploy --only firestore:rules`.
