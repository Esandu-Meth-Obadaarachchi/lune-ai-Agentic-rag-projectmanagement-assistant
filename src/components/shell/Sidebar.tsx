"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import {
  Archive,
  ArchiveRestore,
  BookOpen,
  CalendarCheck2,
  FileText,
  Hash,
  Boxes,
  Inbox,
  LayoutGrid,
  ListChecks,
  LogOut,
  Moon,
  MoreHorizontal,
  PanelLeftClose,
  Pencil,
  Plus,
  Search,
  ShieldAlert,
  Sparkles,
  Sun,
  Trash2,
} from "lucide-react";
import { useAuth } from "@/lib/auth/AuthContext";
import { isAdminEmail } from "@/lib/admin";
import { useWorkspace } from "@/lib/data/WorkspaceContext";
import { createPage, createProject, createTask, deleteProjectDeep, updateProject } from "@/lib/data/firestore";
import type { Project } from "@/lib/types";
import { useTheme } from "@/lib/theme/ThemeContext";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Dropdown, MenuItem } from "@/components/ui/Dropdown";
import { Field, Modal, inputClass } from "@/components/ui/Modal";
import { cn } from "@/lib/utils";
import { openCommandPalette } from "./CommandPalette";
import { InviteMailbox } from "./InviteMailbox";
import { NotificationBell } from "./NotificationBell";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

/* One row shape for every navigation target, so the active/hover language never
   drifts between sections. Active rows carry the gold rail — the light catching
   the row you are on. */
const rowBase =
  "group/row relative flex w-full items-center gap-2.5 rounded-md px-2.5 py-[7px] text-left text-sm transition-[color,background-color] duration-200 ease-smooth";
const rowIdle = "text-text-muted hover:bg-hairline/[0.045] hover:text-text";
const rowActive = "rail bg-hairline/[0.07] text-text font-medium";

export function Sidebar({
  navOpen = false,
  onNavClose,
  collapsed = false,
  onToggleCollapse,
}: {
  navOpen?: boolean;
  onNavClose?: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const { user, signOutUser } = useAuth();
  const { theme, toggle } = useTheme();
  const { projects, pages, workspaceTasks, currentProject, currentWorkspace, inboxProject, selectProject } =
    useWorkspace();
  const pathname = usePathname();
  const router = useRouter();

  const [newProj, setNewProj] = useState(false);
  const [pName, setPName] = useState("");
  const [pDesc, setPDesc] = useState("");
  const [busy, setBusy] = useState(false);
  const [projToDelete, setProjToDelete] = useState<Project | null>(null);
  const [capture, setCapture] = useState("");

  const realProjects = projects.filter((p) => !p.isInbox && !p.archived);
  // `archived` has been on Project since the first release with nothing
  // reading it, so a finished project was either permanent clutter or deleted.
  const archivedProjects = projects.filter((p) => !p.isInbox && p.archived);
  const [showArchived, setShowArchived] = useState(false);
  const [renaming, setRenaming] = useState<Project | null>(null);
  const [renameTo, setRenameTo] = useState("");
  const inboxOpenCount = inboxProject
    ? workspaceTasks.filter((t) => t.projectId === inboxProject.id && t.status !== "done").length
    : 0;

  const quickCapture = async () => {
    const title = capture.trim();
    if (!title || !user || !currentWorkspace || !inboxProject) return;
    setCapture("");
    await createTask({
      workspaceId: currentWorkspace.id,
      projectId: inboxProject.id,
      title,
      memberIds: inboxProject.memberIds ?? currentWorkspace.memberIds,
      createdBy: user.uid,
      assignee: { id: user.uid, name: user.displayName ?? "You", avatar: user.photoURL },
    });
  };

  const confirmDeleteProject = async () => {
    if (!user || !projToDelete) return;
    setBusy(true);
    try {
      await deleteProjectDeep(user.uid, projToDelete.id);
      setProjToDelete(null);
    } finally {
      setBusy(false);
    }
  };

  const createProj = async () => {
    if (!currentWorkspace || !pName.trim()) return;
    setBusy(true);
    try {
      const id = await createProject(currentWorkspace, pName.trim(), { description: pDesc.trim() });
      selectProject(id);
      setNewProj(false);
      setPName("");
      setPDesc("");
      router.push("/");
    } finally {
      setBusy(false);
    }
  };

  const openProject = (id: string) => {
    selectProject(id);
    router.push("/");
    onNavClose?.();
  };

  const wsPages = pages.filter((p) => !p.projectId && !p.parentId);
  const newWorkspacePage = async () => {
    if (!currentWorkspace) return;
    const id = await createPage(currentWorkspace, { projectId: null });
    router.push(`/pages/${id}`);
    onNavClose?.();
  };

  return (
    <aside
      className={cn(
        // The floating glass slab. It hovers on the moonlit ground rather than
        // sitting in a bordered column.
        "glass-panel relative z-50 flex w-[254px] shrink-0 flex-col overflow-hidden rounded-2xl",
        // Mobile: a fixed drawer inset from the edges, sliding in from the left.
        "fixed inset-y-2.5 left-2.5 h-auto -translate-x-[110%] transition-transform duration-[380ms] ease-smooth",
        // Desktop: floats ABOVE the content slab, inset from it, so the page
        // scrolls beneath the glass and the blur has something to refract.
        "lg:absolute lg:inset-y-6 lg:left-6 lg:z-30 lg:h-auto lg:translate-x-0 lg:transition-none",
        navOpen && "translate-x-0",
        collapsed && "lg:hidden"
      )}
    >
      <div className="flex shrink-0 items-center gap-1 p-2.5">
        <div className="min-w-0 flex-1">
          <WorkspaceSwitcher />
        </div>
        <NotificationBell />
        <InviteMailbox />
        {onToggleCollapse && (
          <button
            onClick={onToggleCollapse}
            aria-label="Collapse sidebar"
            title="Collapse sidebar"
            className="press hidden h-7 w-7 shrink-0 place-items-center rounded-md text-text-faint transition-colors hover:bg-hairline/[0.06] hover:text-text lg:grid"
          >
            <PanelLeftClose className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Primary navigation */}
      <div className="shrink-0 space-y-px px-2.5">
        <NavRow href="/today" active={pathname === "/today"} icon={<CalendarCheck2 className="h-4 w-4" />}>
          Today
        </NavRow>
        <NavRow href="/overview" active={pathname === "/overview"} icon={<LayoutGrid className="h-4 w-4" />}>
          Overview
        </NavRow>
        <NavRow href="/workspaces" active={pathname === "/workspaces"} icon={<Boxes className="h-4 w-4" />}>
          All workspaces
        </NavRow>
        <NavRow href="/my-tasks" active={pathname === "/my-tasks"} icon={<ListChecks className="h-4 w-4" />}>
          All my tasks
        </NavRow>

        <button
          onClick={openCommandPalette}
          className={cn(rowBase, rowIdle, "press")}
        >
          <Search className="h-4 w-4" />
          Search
          <kbd className="mono ml-auto rounded border border-hairline/[0.08] bg-hairline/[0.04] px-1.5 py-0.5 text-2xs text-text-faint">
            ⌘K
          </kbd>
        </button>
      </div>

      {/* The agent. The one place gold is used as a surface rather than a rail,
          because it is the one thing here that is not navigation. */}
      <div className="mt-2 shrink-0 px-2.5">
        <Link
          href="/agent"
          className={cn(
            "press group relative flex items-center gap-2.5 overflow-hidden rounded-md px-2.5 py-2 text-sm font-medium transition-all duration-200 ease-smooth",
            pathname === "/agent"
              ? "bg-accent text-accent-fg shadow-glow"
              : "border border-accent/25 bg-accent/[0.07] text-accent hover:border-accent/40 hover:bg-accent/[0.12]"
          )}
        >
          <Sparkles className="h-4 w-4" />
          Ask the brain
        </Link>
      </div>

      {/* Quick capture -> workspace Inbox (add a task without picking a project) */}
      <div className="mt-2.5 shrink-0 px-2.5">
        <div className="flex items-center gap-2 rounded-md border border-hairline/[0.07] bg-hairline/[0.03] px-2.5 py-[7px] transition-colors focus-within:border-accent/45 focus-within:bg-hairline/[0.05]">
          <Inbox className="h-3.5 w-3.5 shrink-0 text-text-faint" />
          <input
            value={capture}
            onChange={(e) => setCapture(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && quickCapture()}
            placeholder="Capture a task…"
            className="min-w-0 flex-1 bg-transparent text-sm text-text outline-none placeholder:text-text-faint"
          />
        </div>
      </div>

      {/* Inbox (pinned) */}
      {inboxProject && (
        <div className="mt-2.5 shrink-0 px-2.5">
          <button
            onClick={() => openProject(inboxProject.id)}
            className={cn(
              rowBase,
              inboxProject.id === currentProject?.id && pathname === "/" ? rowActive : rowIdle
            )}
          >
            <Inbox className="h-4 w-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate">Inbox</span>
            {inboxOpenCount > 0 && (
              <span className="mono text-2xs text-text-faint">{inboxOpenCount}</span>
            )}
          </button>
        </div>
      )}

      {/* Projects */}
      <div className="mt-3 flex min-h-0 flex-1 flex-col px-2.5">
        <SectionLabel
          label="Projects"
          onAdd={() => setNewProj(true)}
          addTitle="New project"
        />
        <nav className="min-h-0 flex-1 space-y-px overflow-y-auto pb-2">
          {realProjects.map((p) => {
            const active = p.id === currentProject?.id && pathname === "/";
            return (
              <div
                key={p.id}
                className={cn(
                  "group flex items-center rounded-md pr-1 transition-colors duration-200",
                  active ? "rail bg-hairline/[0.07] text-text" : "text-text-muted hover:bg-hairline/[0.045] hover:text-text"
                )}
              >
                <button
                  onClick={() => openProject(p.id)}
                  className={cn(
                    "flex min-w-0 flex-1 items-center gap-2.5 px-2.5 py-[7px] text-left text-sm",
                    active && "font-medium"
                  )}
                >
                  <span
                    className="h-2 w-2 shrink-0 rounded-full ring-1 ring-inset ring-hairline/20"
                    style={{ background: p.color }}
                  />
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                </button>
                <Dropdown
                  align="right"
                  width={176}
                  trigger={() => (
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded text-text-faint opacity-100 transition-opacity hover:bg-hairline/[0.08] hover:text-text lg:opacity-0 lg:group-hover:opacity-100">
                      <MoreHorizontal className="h-3.5 w-3.5" />
                    </span>
                  )}
                >
                  {(close) => (
                    <div>
                      <MenuItem
                        icon={<Pencil className="h-4 w-4" />}
                        onClick={() => {
                          setRenaming(p);
                          setRenameTo(p.name);
                          close();
                        }}
                      >
                        Rename
                      </MenuItem>
                      <MenuItem
                        icon={<Archive className="h-4 w-4" />}
                        onClick={() => {
                          void updateProject(p.id, { archived: true });
                          close();
                        }}
                      >
                        Archive
                      </MenuItem>
                      <div className="my-1 h-px bg-hairline/[0.08]" />
                      <MenuItem
                        danger
                        icon={<Trash2 className="h-4 w-4" />}
                        onClick={() => {
                          setProjToDelete(p);
                          close();
                        }}
                      >
                        Delete
                      </MenuItem>
                    </div>
                  )}
                </Dropdown>
              </div>
            );
          })}
          {realProjects.length === 0 && archivedProjects.length === 0 && (
            <button
              onClick={() => setNewProj(true)}
              className="flex w-full items-center gap-2 rounded-md border border-dashed border-hairline/[0.12] px-2.5 py-2 text-sm text-text-faint transition-colors hover:border-accent/35 hover:text-text-muted"
            >
              <Plus className="h-3.5 w-3.5" /> Create your first project
            </button>
          )}

          {archivedProjects.length > 0 && (
            <div className="pt-1">
              <button
                onClick={() => setShowArchived((v) => !v)}
                className="flex w-full items-center gap-1.5 rounded-md px-2.5 py-1 text-2xs text-text-faint transition-colors hover:text-text-muted"
              >
                <Archive className="h-3 w-3" />
                Archived
                <span className="mono">{archivedProjects.length}</span>
              </button>
              {showArchived &&
                archivedProjects.map((p) => (
                  <div key={p.id} className="group flex items-center rounded-md pr-1 text-text-faint">
                    <button
                      onClick={() => openProject(p.id)}
                      className="flex min-w-0 flex-1 items-center gap-2.5 px-2.5 py-[7px] text-left text-sm"
                    >
                      <span
                        className="h-2 w-2 shrink-0 rounded-full opacity-50"
                        style={{ background: p.color }}
                      />
                      <span className="min-w-0 flex-1 truncate">{p.name}</span>
                    </button>
                    <button
                      onClick={() => void updateProject(p.id, { archived: false })}
                      title="Restore project"
                      className="grid h-6 w-6 shrink-0 place-items-center rounded text-text-faint hover:bg-hairline/[0.08] hover:text-text"
                    >
                      <ArchiveRestore className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
            </div>
          )}
        </nav>
      </div>

      {/* Pages (workspace-level docs) */}
      <div className="shrink-0 px-2.5 pb-1">
        <SectionLabel
          label="Pages"
          href="/pages"
          active={pathname.startsWith("/pages")}
          onAdd={newWorkspacePage}
          addTitle="New page"
        />
        <div className="max-h-[20vh] space-y-px overflow-y-auto">
          {wsPages.map((p) => (
            <button
              key={p.id}
              onClick={() => {
                router.push(`/pages/${p.id}`);
                onNavClose?.();
              }}
              className={cn(rowBase, rowIdle)}
            >
              <span className="shrink-0 text-sm leading-none">{p.icon || "📄"}</span>
              <span className="min-w-0 flex-1 truncate">{p.title || "Untitled"}</span>
            </button>
          ))}
          {wsPages.length === 0 && (
            <button onClick={newWorkspacePage} className={cn(rowBase, "text-text-faint hover:text-text-muted")}>
              <FileText className="h-3.5 w-3.5" /> New page
            </button>
          )}
        </div>
      </div>

      {/* Secondary nav */}
      <div className="shrink-0 space-y-px px-2.5 pb-2">
        <NavRow href="/knowledge" active={pathname === "/knowledge"} icon={<BookOpen className="h-4 w-4" />}>
          Knowledge base
        </NavRow>
      </div>

      {/* User footer */}
      <div className="shrink-0 border-t border-hairline/[0.07] p-2">
        <Dropdown
          width={216}
          align="left"
          trigger={() => (
            <div className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-hairline/[0.05]">
              <Avatar name={user?.displayName} src={user?.photoURL} size={28} />
              <div className="min-w-0 flex-1 text-left">
                <div className="truncate text-sm font-medium text-text">
                  {user?.displayName ?? "You"}
                </div>
                <div className="truncate text-2xs text-text-faint">{user?.email}</div>
              </div>
            </div>
          )}
        >
          {(close) => (
            <div>
              <MenuItem
                icon={theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                onClick={() => {
                  toggle();
                  close();
                }}
              >
                {theme === "dark" ? "Light mode" : "Dark mode"}
              </MenuItem>
              {isAdminEmail(user?.email) && (
                <>
                  <div className="my-1 h-px bg-hairline/[0.08]" />
                  <MenuItem
                    icon={<ShieldAlert className="h-4 w-4" />}
                    onClick={() => {
                      window.open("/admin", "_blank", "noopener");
                      close();
                    }}
                  >
                    Oversight terminal
                  </MenuItem>
                </>
              )}
              <div className="my-1 h-px bg-hairline/[0.08]" />
              <MenuItem danger icon={<LogOut className="h-4 w-4" />} onClick={() => signOutUser()}>
                Sign out
              </MenuItem>
            </div>
          )}
        </Dropdown>
      </div>

      <Modal open={newProj} onClose={() => setNewProj(false)} title="New project">
        <Field label="Name">
          <input
            className={inputClass}
            placeholder="e.g. Ceylon Green Crest"
            autoFocus
            value={pName}
            onChange={(e) => setPName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && createProj()}
          />
        </Field>
        <Field label="Description (optional)">
          <input
            className={inputClass}
            placeholder="What is this project about?"
            value={pDesc}
            onChange={(e) => setPDesc(e.target.value)}
          />
        </Field>
        <p className="mb-3 flex items-center gap-1.5 text-2xs text-text-faint">
          <Hash className="h-3 w-3" /> A private knowledge namespace is created for
          this project automatically.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setNewProj(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={createProj} disabled={!pName.trim() || busy}>
            {busy ? "Creating…" : "Create project"}
          </Button>
        </div>
      </Modal>

      <Modal open={!!renaming} onClose={() => setRenaming(null)} title="Rename project">
        <Field label="Name">
          <input
            className={inputClass}
            autoFocus
            value={renameTo}
            onChange={(e) => setRenameTo(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter" || !renameTo.trim() || !renaming) return;
              void updateProject(renaming.id, { name: renameTo.trim() });
              setRenaming(null);
            }}
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setRenaming(null)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!renameTo.trim()}
            onClick={() => {
              if (!renaming) return;
              void updateProject(renaming.id, { name: renameTo.trim() });
              setRenaming(null);
            }}
          >
            Rename
          </Button>
        </div>
      </Modal>

      <Modal open={!!projToDelete} onClose={() => setProjToDelete(null)} title="Delete project">
        <p className="text-sm leading-relaxed text-text-muted">
          Delete <span className="font-medium text-text">{projToDelete?.name}</span> and all of its
          tasks? This cannot be undone.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setProjToDelete(null)}>
            Cancel
          </Button>
          <Button variant="danger" onClick={confirmDeleteProject} disabled={busy}>
            {busy ? "Deleting…" : "Delete project"}
          </Button>
        </div>
      </Modal>
    </aside>
  );
}

/** A primary navigation row. */
function NavRow({
  href,
  active,
  icon,
  children,
}: {
  href: string;
  active: boolean;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Link href={href} className={cn(rowBase, active ? rowActive : rowIdle)}>
      {icon}
      {children}
    </Link>
  );
}

/** A section heading with an inline add button. */
function SectionLabel({
  label,
  href,
  active,
  onAdd,
  addTitle,
}: {
  label: string;
  href?: string;
  active?: boolean;
  onAdd: () => void;
  addTitle: string;
}) {
  const text = "text-2xs font-semibold uppercase tracking-[0.09em] transition-colors";
  return (
    <div className="mb-1 flex items-center justify-between px-2.5">
      {href ? (
        <Link href={href} className={cn(text, active ? "text-text" : "text-text-faint hover:text-text-muted")}>
          {label}
        </Link>
      ) : (
        <span className={cn(text, "text-text-faint")}>{label}</span>
      )}
      <button
        onClick={onAdd}
        className="press grid h-5 w-5 place-items-center rounded text-text-faint transition-colors hover:bg-hairline/[0.08] hover:text-text"
        title={addTitle}
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
