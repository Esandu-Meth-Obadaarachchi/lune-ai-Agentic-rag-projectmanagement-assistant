"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { FileText, Plus } from "lucide-react";
import { useWorkspace } from "@/lib/data/WorkspaceContext";
import { createPage } from "@/lib/data/firestore";
import type { Page } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { Logo } from "@/components/ui/Logo";
import { relativeTime } from "@/lib/date";

export default function PagesIndex() {
  const { currentWorkspace, projects, pages } = useWorkspace();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  // Group top-level pages: workspace-level first, then per project.
  const groups = useMemo(() => {
    const tops = pages.filter((p) => !p.parentId);
    const workspace = tops.filter((p) => !p.projectId);
    const byProject = new Map<string, Page[]>();
    tops
      .filter((p) => p.projectId)
      .forEach((p) => {
        const arr = byProject.get(p.projectId!) ?? [];
        arr.push(p);
        byProject.set(p.projectId!, arr);
      });
    return { workspace, byProject };
  }, [pages]);

  const newWorkspacePage = async () => {
    if (!currentWorkspace) return;
    setBusy(true);
    try {
      const id = await createPage(currentWorkspace, { projectId: null });
      router.push(`/pages/${id}`);
    } finally {
      setBusy(false);
    }
  };

  if (!currentWorkspace) {
    return (
      <div className="grid h-full place-items-center">
        <Logo size={30} className="animate-pulse-dot" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <header className="flex items-center gap-3 border-b border-hairline/[0.08] px-5 py-4">
        <span className="grid h-9 w-9 place-items-center rounded-lg bg-surface-2 text-accent">
          <FileText className="h-[18px] w-[18px]" strokeWidth={1.75} />
        </span>
        <div className="min-w-0">
          <h1 className="truncate text-[17px] font-semibold tracking-tight">Pages</h1>
          <div className="text-xs text-text-muted">Docs, notes and wikis for {currentWorkspace.name}</div>
        </div>
        <div className="ml-auto">
          <Button variant="primary" size="sm" onClick={newWorkspacePage} disabled={busy}>
            <Plus className="h-3.5 w-3.5" /> New page
          </Button>
        </div>
      </header>

      <div className="mx-auto max-w-5xl space-y-7 px-5 py-6">
        <Section title="Workspace" pages={groups.workspace} onOpen={(id) => router.push(`/pages/${id}`)} />
        {projects
          .filter((pr) => !pr.isInbox)
          .map((pr) => {
            const list = groups.byProject.get(pr.id) ?? [];
            if (list.length === 0) return null;
            return (
              <Section
                key={pr.id}
                title={pr.name}
                dot={pr.color}
                pages={list}
                onOpen={(id) => router.push(`/pages/${id}`)}
              />
            );
          })}
        {pages.length === 0 && (
          <div className="card grid place-items-center gap-3 p-10 text-center">
            <FileText className="h-6 w-6 text-text-faint" />
            <div>
              <div className="text-sm font-medium text-text">No pages yet</div>
              <div className="mt-1 text-xs text-text-muted">
                Create a workspace wiki, meeting notes, specs — anything. Full block editor inside.
              </div>
            </div>
            <Button variant="primary" size="sm" onClick={newWorkspacePage} disabled={busy}>
              <Plus className="h-3.5 w-3.5" /> New page
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function Section({
  title,
  dot,
  pages,
  onOpen,
}: {
  title: string;
  dot?: string;
  pages: Page[];
  onOpen: (id: string) => void;
}) {
  if (pages.length === 0 && title !== "Workspace") return null;
  return (
    <section>
      <h2 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-text-faint">
        {dot ? <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: dot }} /> : null}
        {title}
      </h2>
      {pages.length === 0 ? (
        <div className="card p-4 text-sm text-text-muted">No pages here yet.</div>
      ) : (
        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {pages.map((p) => (
            <button
              key={p.id}
              onClick={() => onOpen(p.id)}
              className="card flex items-start gap-2.5 p-3.5 text-left transition-colors hover:border-hairline/20"
            >
              <span className="text-xl leading-none">{p.icon || "📄"}</span>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-text">{p.title || "Untitled"}</div>
                <div className="mt-0.5 text-2xs text-text-faint">edited {relativeTime(p.updatedAt)}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
