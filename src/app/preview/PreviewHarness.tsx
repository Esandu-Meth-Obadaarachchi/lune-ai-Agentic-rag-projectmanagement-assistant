"use client";

import { useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import { AuthCtx } from "@/lib/auth/AuthContext";
import { WorkspaceCtx, type WorkspaceState } from "@/lib/data/WorkspaceContext";
import { ToastProvider } from "@/lib/ui/ToastContext";
import { AppFrame } from "@/components/shell/AppFrame";
import ProjectViewPage from "@/app/(app)/page";
import TodayPage from "@/app/(app)/today/page";
import OverviewPage from "@/app/(app)/overview/page";
import MyTasksPage from "@/app/(app)/my-tasks/page";
import KnowledgePage from "@/app/(app)/knowledge/page";
import WorkspacesPage from "@/app/(app)/workspaces/page";
import AgentPage from "@/app/(app)/agent/page";
import { projects, tasks, workspaces } from "./fixtures";

const fakeUser = {
  uid: "u1",
  displayName: "Esandu Obadaarachchi",
  email: "eobadaarachchi@gmail.com",
  photoURL: null,
} as unknown as User;

export function PreviewHarness() {
  // The shell reads localStorage and renders portals on mount, so paint only
  // after hydration rather than fighting a server pass that cannot match.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const [wsId, setWsId] = useState("w1");
  const [projId, setProjId] = useState("p1");

  const workspace = useMemo(() => workspaces.find((w) => w.id === wsId) ?? null, [wsId]);
  const project = useMemo(() => projects.find((p) => p.id === projId) ?? null, [projId]);

  const ws: WorkspaceState = useMemo(
    () => ({
      workspaces,
      projects: projects.filter((p) => p.workspaceId === wsId),
      allProjects: projects,
      tasks: tasks.filter((t) => t.projectId === projId),
      workspaceTasks: tasks.filter((t) => t.workspaceId === wsId),
      allTasks: tasks,
      pages: [],
      currentWorkspace: workspace,
      currentProject: project,
      inboxProject: projects.find((p) => p.isInbox && p.workspaceId === wsId) ?? null,
      loading: false,
      seeding: false,
      tasksLoading: false,
      selectWorkspace: setWsId,
      selectProject: setProjId,
      openWorkspaceProject: (w: string, p: string) => {
        setWsId(w);
        setProjId(p);
      },
    }),
    [projId, wsId, workspace, project]
  );

  if (!mounted) return null;

  return (
    <AuthCtx.Provider
      value={{
        user: fakeUser,
        loading: false,
        configured: true,
        signIn: async () => {},
        signOutUser: async () => {},
      }}
    >
      <WorkspaceCtx.Provider value={ws}>
        <ToastProvider>
          <AppFrame>
            <Screen />
          </AppFrame>
        </ToastProvider>
      </WorkspaceCtx.Provider>
    </AuthCtx.Provider>
  );
}

/** `?screen=today|overview|my-tasks|knowledge|workspaces` picks the surface to
 *  review; the project view is the default. */
function Screen() {
  const which =
    typeof window === "undefined"
      ? "project"
      : new URLSearchParams(window.location.search).get("screen") ?? "project";
  switch (which) {
    case "today":
      return <TodayPage />;
    case "overview":
      return <OverviewPage />;
    case "my-tasks":
      return <MyTasksPage />;
    case "knowledge":
      return <KnowledgePage />;
    case "workspaces":
      return <WorkspacesPage />;
    case "agent":
      return <AgentPage />;
    default:
      return <ProjectViewPage />;
  }
}
