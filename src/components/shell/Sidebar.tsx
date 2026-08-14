"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import {
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
  PanelLeftClose,
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
import { createPage, createProject, createTask, deleteProjectDeep } from "@/lib/data/firestore";
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

  const realProjects = projects.filter((p) => !p.isInbox);
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
        "flex w-[248px] shrink-0 flex-col border-r border-border bg-surface/40",
        // Mobile: fixed slide-in drawer with an opaque background.
        "fixed inset-y-0 left-0 z-50 h-[100dvh] -translate-x-full transition-transform duration-300 ease-out max-lg:bg-bg",
        // Desktop: static column, always visible unless collapsed.
        "lg:static lg:z-auto lg:h-full lg:translate-x-0 lg:transition-none",
        navOpen && "translate-x-0 shadow-2xl",
        collapsed && "lg:hidden"
      )}
    >
      <div className="flex items-center gap-1 p-3">
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
            className="hidden h-7 w-7 shrink-0 place-items-center rounded-md text-text-faint transition-colors hover:bg-surface-2 hover:text-text lg:grid"
          >
            <PanelLeftClose className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="space-y-1 px-3">
        <Link
          href="/today"
          className={cn(
            "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] transition-colors",
            pathname === "/today"
              ? "bg-surface-2 text-text"
              : "text-text-muted hover:bg-surface-2 hover:text-text"
          )}
        >
          <CalendarCheck2 className="h-4 w-4" />
          Today
        </Link>
        <Link
          href="/overview"
          className={cn(
            "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] transition-colors",
            pathname === "/overview"
              ? "bg-surface-2 text-text"
              : "text-text-muted hover:bg-surface-2 hover:text-text"
          )}
        >
          <LayoutGrid className="h-4 w-4" />
          Overview
        </Link>
        <Link
          href="/workspaces"
          className={cn(
            "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] transition-colors",
            pathname === "/workspaces"
              ? "bg-surface-2 text-text"
              : "text-text-muted hover:bg-surface-2 hover:text-text"
          )}
        >
          <Boxes className="h-4 w-4" />
          All workspaces
        </Link>
        <Link
          href="/my-tasks"
          className={cn(
            "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] transition-colors",
            pathname === "/my-tasks"
              ? "bg-surface-2 text-text"
              : "text-text-muted hover:bg-surface-2 hover:text-text"
          )}
        >
          <ListChecks className="h-4 w-4" />
          All my tasks
        </Link>
        <Link
          href="/agent"
          className={cn(
            "flex items-center gap-2.5 rounded-lg border px-2.5 py-2 text-[13px] font-medium transition-all",
            pathname === "/agent"
              ? "border-accent/40 bg-accent/10 text-accent shadow-glow"
              : "border-border bg-surface-2 text-text hover:border-accent/30 hover:text-accent"
          )}
        >
          <Sparkles className="h-4 w-4" />
          Ask the brain
        </Link>

        {/* Opens the command palette. The ⌘K cap used to sit on "Ask the
            brain" and was bound to nothing at all. */}
        <button
          onClick={openCommandPalette}
          className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] text-text-muted transition-colors hover:bg-surface-2 hover:text-text"
        >
          <Search className="h-4 w-4" />
          Search
          <kbd className="mono ml-auto rounded border border-border bg-surface px-1.5 py-0.5 text-2xs text-text-faint">
            ⌘K
          </kbd>
        </button>
      </div>

      {/* Quick capture -> workspace Inbox (add a task without picking a project) */}
      <div className="mt-2 px-3">
        <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 transition-colors focus-within:border-accent/40">
          <Inbox className="h-3.5 w-3.5 shrink-0 text-text-faint" />
          <input
            value={capture}
            onChange={(e) => setCapture(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && quickCapture()}
            placeholder="Capture a task…"
            className="min-w-0 flex-1 bg-transparent text-[13px] text-text outline-none placeholder:text-text-faint"
          />
        </div>
      </div>

      {/* Inbox (pinned) */}
      {inboxProject && (
        <div className="mt-3 px-3">
          <button
            onClick={() => openProject(inboxProject.id)}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors",
              inboxProject.id === currentProject?.id && pathname === "/"
                ? "bg-surface-2 text-text"
                : "text-text-muted hover:bg-surface-2 hover:text-text"
            )}
          >
            <Inbox className="h-4 w-4 shrink-0" />
            <span className="flex-1 truncate">Inbox</span>
            {inboxOpenCount > 0 && (
              <span className="mono text-2xs text-text-faint">{inboxOpenCount}</span>
            )}
          </button>
        </div>
      )}

      {/* Projects */}
      <div className="mt-3 flex min-h-0 flex-1 flex-col px-3">
        <div className="mb-1.5 flex items-center justify-between px-1">
          <span className="text-2xs font-semibold uppercase tracking-wider text-text-faint">
            Projects
          </span>
          <button
            onClick={() => setNewProj(true)}
            className="grid h-5 w-5 place-items-center rounded text-text-faint hover:bg-surface-2 hover:text-text"
            title="New project"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
        <nav className="min-h-0 flex-1 space-y-0.5 overflow-y-auto pb-2">
          {realProjects.map((p) => {
            const active = p.id === currentProject?.id && pathname === "/";
            return (
              <div
                key={p.id}
                className={cn(
                  "group flex items-center rounded-md pr-1 transition-colors",
                  active ? "bg-surface-2 text-text" : "text-text-muted hover:bg-surface-2 hover:text-text"
                )}
              >
                <button
                  onClick={() => openProject(p.id)}
                  className="flex min-w-0 flex-1 items-center gap-2.5 px-2 py-1.5 text-left text-[13px]"
                >
                  <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: p.color }} />
                  <span className="flex-1 truncate">{p.name}</span>
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setProjToDelete(p);
                  }}
                  title="Delete project"
                  className="grid h-6 w-6 shrink-0 place-items-center rounded text-text-faint opacity-0 transition-opacity hover:bg-danger/10 hover:text-danger group-hover:opacity-100"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
          {realProjects.length === 0 && (
            <button
              onClick={() => setNewProj(true)}
              className="flex w-full items-center gap-2 rounded-md border border-dashed border-border px-2 py-2 text-[13px] text-text-faint hover:border-border-strong hover:text-text-muted"
            >
              <Plus className="h-3.5 w-3.5" /> Create your first project
            </button>
          )}
        </nav>
      </div>

      {/* Pages (workspace-level docs) */}
      <div className="px-3 pb-1">
        <div className="mb-1.5 flex items-center justify-between px-1">
          <Link
            href="/pages"
            className={cn(
              "text-2xs font-semibold uppercase tracking-wider transition-colors",
              pathname.startsWith("/pages") ? "text-text" : "text-text-faint hover:text-text-muted"
            )}
          >
            Pages
          </Link>
          <button
            onClick={newWorkspacePage}
            className="grid h-5 w-5 place-items-center rounded text-text-faint hover:bg-surface-2 hover:text-text"
            title="New page"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="max-h-[22vh] space-y-0.5 overflow-y-auto">
          {wsPages.map((p) => (
            <button
              key={p.id}
              onClick={() => {
                router.push(`/pages/${p.id}`);
                onNavClose?.();
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-text-muted transition-colors hover:bg-surface-2 hover:text-text"
            >
              <span className="shrink-0 text-sm leading-none">{p.icon || "📄"}</span>
              <span className="flex-1 truncate">{p.title || "Untitled"}</span>
            </button>
          ))}
          {wsPages.length === 0 && (
            <button
              onClick={newWorkspacePage}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-text-faint hover:text-text-muted"
            >
              <FileText className="h-3.5 w-3.5" /> New page
            </button>
          )}
        </div>
      </div>

      {/* Secondary nav */}
      <div className="space-y-0.5 px-3 pb-2">
        <NavLink href="/knowledge" active={pathname === "/knowledge"} icon={<BookOpen className="h-4 w-4" />}>
          Knowledge base
        </NavLink>
      </div>

      {/* User footer */}
      <div className="border-t border-border p-2">
        <Dropdown
          width={216}
          align="left"
          trigger={() => (
            <div className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-surface-2">
              <Avatar name={user?.displayName} src={user?.photoURL} size={28} />
              <div className="min-w-0 flex-1 text-left">
                <div className="truncate text-[13px] font-medium text-text">
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
                  <div className="my-1 h-px bg-border" />
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
              <div className="my-1 h-px bg-border" />
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

      <Modal open={!!projToDelete} onClose={() => setProjToDelete(null)} title="Delete project">
        <p className="text-[13px] leading-relaxed text-text-muted">
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

function NavLink({
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
    <Link
      href={href}
      className={cn(
        "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] transition-colors",
        active ? "bg-surface-2 text-text" : "text-text-muted hover:bg-surface-2 hover:text-text"
      )}
    >
      {icon}
      {children}
    </Link>
  );
}
