"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAuth } from "@/lib/auth/AuthContext";
import { projectStatuses, type StatusMeta } from "@/lib/constants";
import type { Page, Project, Task, Workspace } from "@/lib/types";
import {
  ensureInbox,
  seedNewUser,
  watchAllTasks,
  watchPages,
  watchProjects,
  watchTasks,
  watchWorkspaces,
} from "./firestore";

interface WorkspaceState {
  workspaces: Workspace[];
  projects: Project[];
  tasks: Task[];
  /** Every task in the current workspace across all its projects. */
  workspaceTasks: Task[];
  /** Every task the user can see across every workspace (powers Today). */
  allTasks: Task[];
  /** Pages (Notion docs) in the current workspace. */
  pages: Page[];
  currentWorkspace: Workspace | null;
  currentProject: Project | null;
  /** The current workspace's catch-all Inbox project. */
  inboxProject: Project | null;
  loading: boolean;
  seeding: boolean;
  tasksLoading: boolean;
  selectWorkspace: (id: string) => void;
  selectProject: (id: string) => void;
  /** Jump to a specific project in any workspace (used by the all-workspaces board). */
  openWorkspaceProject: (workspaceId: string, projectId: string) => void;
}

const Ctx = createContext<WorkspaceState | null>(null);

const LS_WS = "sb-current-ws";
const LS_PROJ = "sb-current-proj";

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();

  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [wsLoaded, setWsLoaded] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const seededRef = useRef(false);

  const [currentWorkspaceId, setCurrentWorkspaceId] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [allUserTasks, setAllUserTasks] = useState<Task[]>([]);
  const [pages, setPages] = useState<Page[]>([]);

  // 1. Watch workspaces; seed a new user exactly once.
  useEffect(() => {
    if (!user) {
      setWorkspaces([]);
      setWsLoaded(false);
      return;
    }
    const unsub = watchWorkspaces(user.uid, async (ws) => {
      setWorkspaces(ws);
      setWsLoaded(true);
      if (ws.length === 0 && !seededRef.current) {
        seededRef.current = true;
        setSeeding(true);
        try {
          await seedNewUser(user);
        } catch (e) {
          console.error("seed failed", e);
        } finally {
          setSeeding(false);
        }
      }
    });
    return () => unsub();
  }, [user]);

  // 2. Keep the selected workspace valid + remembered.
  useEffect(() => {
    if (!workspaces.length) {
      setCurrentWorkspaceId(null);
      return;
    }
    setCurrentWorkspaceId((cur) => {
      if (cur && workspaces.some((w) => w.id === cur)) return cur;
      const saved = typeof window !== "undefined" ? localStorage.getItem(LS_WS) : null;
      return saved && workspaces.some((w) => w.id === saved) ? saved : workspaces[0].id;
    });
  }, [workspaces]);

  // 3. Watch projects of the current workspace.
  useEffect(() => {
    if (!currentWorkspaceId || !user) {
      setProjects([]);
      return;
    }
    if (typeof window !== "undefined") localStorage.setItem(LS_WS, currentWorkspaceId);
    const unsub = watchProjects(user.uid, currentWorkspaceId, setProjects);
    return () => unsub();
  }, [currentWorkspaceId, user]);

  // A cross-workspace jump target, held until the new workspace's projects load.
  // Effect 4 consumes it. Never a state value: setting it must not itself
  // re-trigger the reconcile, and it has to survive a render where `projects`
  // still holds the previous workspace's list.
  const pendingProjectRef = useRef<string | null>(null);

  // 4. Keep the selected project valid within the current workspace.
  useEffect(() => {
    setCurrentProjectId((cur) => {
      // A pending cross-workspace target wins as soon as it is loadable.
      const pending = pendingProjectRef.current;
      if (pending) {
        if (!projects.some((p) => p.id === pending)) return cur;
        pendingProjectRef.current = null;
        return pending;
      }
      if (cur && projects.some((p) => p.id === cur)) return cur;
      const saved = typeof window !== "undefined" ? localStorage.getItem(LS_PROJ) : null;
      if (saved && projects.some((p) => p.id === saved)) return saved;
      // Prefer a real project over the Inbox as the default landing.
      return projects.find((p) => !p.isInbox)?.id ?? projects[0]?.id ?? null;
    });
  }, [projects]);

  // 5. Watch tasks of the current project.
  useEffect(() => {
    if (!currentProjectId || !user) {
      setTasks([]);
      setTasksLoading(false);
      return;
    }
    if (typeof window !== "undefined") localStorage.setItem(LS_PROJ, currentProjectId);
    setTasksLoading(true);
    const unsub = watchTasks(user.uid, currentProjectId, (t) => {
      setTasks(t);
      setTasksLoading(false);
    });
    return () => unsub();
  }, [currentProjectId]);

  // Claim any pending share invites for this user's email. New memberships then
  // stream in through watchWorkspaces (array-contains uid) automatically.
  const acceptedRef = useRef(false);
  useEffect(() => {
    if (!user || acceptedRef.current) return;
    acceptedRef.current = true;
    // Invites are NOT auto-claimed. The user accepts or declines each one
    // explicitly from the invite mailbox in the sidebar.
  }, [user]);

  // Watch every task the user can see; the calendar + overview use the
  // workspace-wide slice (all projects), not just the selected project.
  useEffect(() => {
    if (!user) {
      setAllUserTasks([]);
      return;
    }
    return watchAllTasks(user.uid, setAllUserTasks);
  }, [user]);

  // Watch the current workspace's pages (Notion docs).
  useEffect(() => {
    if (!user || !currentWorkspaceId) {
      setPages([]);
      return;
    }
    return watchPages(user.uid, currentWorkspaceId, setPages);
  }, [user, currentWorkspaceId]);

  const workspaceTasks = useMemo(
    () => allUserTasks.filter((t) => t.workspaceId === currentWorkspaceId),
    [allUserTasks, currentWorkspaceId]
  );

  // Ensure every workspace has exactly one Inbox. Runs once per workspace per
  // session and heals duplicates (see ensureInbox). We trigger a heal both when
  // no inbox is visible and when more than one is — the latter is the bug we saw
  // in the overview.
  const inboxEnsured = useRef<Set<string>>(new Set());
  useEffect(() => {
    const ws = workspaces.find((w) => w.id === currentWorkspaceId);
    if (!ws || !user || !projects.length) return;
    const inboxCount = projects.filter((p) => p.isInbox && p.workspaceId === ws.id).length;
    if (inboxCount === 1 || inboxEnsured.current.has(ws.id)) return;
    inboxEnsured.current.add(ws.id);
    ensureInbox(ws, user.uid).catch(() => inboxEnsured.current.delete(ws.id));
  }, [workspaces, projects, currentWorkspaceId, user]);

  const value = useMemo<WorkspaceState>(() => {
    const currentWorkspace = workspaces.find((w) => w.id === currentWorkspaceId) ?? null;
    // Canonical inbox = the oldest one; drop any duplicates from the visible list
    // so nothing downstream (overview, sidebar) ever renders two inboxes.
    const inboxProject =
      projects
        .filter((p) => p.isInbox)
        .sort((a, b) => a.createdAt - b.createdAt)[0] ?? null;
    const visibleProjects = projects.filter((p) => !p.isInbox || p.id === inboxProject?.id);
    const currentProject =
      visibleProjects.find((p) => p.id === currentProjectId) ??
      (currentProjectId === inboxProject?.id ? inboxProject : null);
    return {
      workspaces,
      projects: visibleProjects,
      tasks,
      workspaceTasks,
      allTasks: allUserTasks,
      pages,
      currentWorkspace,
      currentProject,
      inboxProject,
      loading: !wsLoaded,
      seeding,
      tasksLoading,
      selectWorkspace: (id) => {
        setCurrentWorkspaceId(id);
        setCurrentProjectId(null); // let effect 4 pick the first project of the new ws
      },
      selectProject: setCurrentProjectId,
      openWorkspaceProject: (workspaceId, projectId) => {
        if (typeof window !== "undefined") localStorage.setItem(LS_PROJ, projectId);
        // Same workspace => `projects` is already loaded and its identity will
        // not change, so effect 4 would never re-run. Select directly. Blanking
        // the id here instead left currentProject null until an unrelated
        // snapshot happened to land, which is why opening a task from Today
        // only worked some of the time.
        if (workspaceId === currentWorkspaceId) {
          setCurrentProjectId(projectId);
          return;
        }
        // Different workspace: hand the target to effect 4, which selects it
        // once the new workspace's projects arrive.
        pendingProjectRef.current = projectId;
        setCurrentProjectId(null);
        setCurrentWorkspaceId(workspaceId);
      },
    };
  }, [workspaces, projects, tasks, workspaceTasks, allUserTasks, pages, currentWorkspaceId, currentProjectId, wsLoaded, seeding, tasksLoading]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWorkspace(): WorkspaceState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useWorkspace must be used within WorkspaceProvider");
  return ctx;
}

/** The current project's status list (four built-ins + its custom statuses).
 *  Used by the status picker and views so custom statuses appear everywhere. */
export function useProjectStatuses(): StatusMeta[] {
  const { currentProject } = useWorkspace();
  return useMemo(() => projectStatuses(currentProject), [currentProject]);
}
