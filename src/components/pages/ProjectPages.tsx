"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { FileText, Plus } from "lucide-react";
import { useWorkspace } from "@/lib/data/WorkspaceContext";
import { createPage } from "@/lib/data/firestore";
import type { Project } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { relativeTime } from "@/lib/date";

/** The Docs tab of a project — its Notion-style pages. */
export function ProjectPages({ project }: { project: Project }) {
  const { currentWorkspace, pages } = useWorkspace();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const projectPages = useMemo(
    () => pages.filter((p) => p.projectId === project.id && !p.parentId),
    [pages, project.id]
  );

  const newPage = async () => {
    if (!currentWorkspace) return;
    setBusy(true);
    try {
      const id = await createPage(currentWorkspace, {
        projectId: project.id,
        memberIds: project.memberIds ?? currentWorkspace.memberIds,
      });
      router.push(`/pages/${id}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-5 py-6">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-text-faint">
          <FileText className="h-3.5 w-3.5" /> Docs
        </h2>
        <Button variant="outline" size="sm" onClick={newPage} disabled={busy}>
          <Plus className="h-3.5 w-3.5" /> New page
        </Button>
      </div>

      {projectPages.length === 0 ? (
        <div className="card grid place-items-center gap-3 p-10 text-center">
          <FileText className="h-6 w-6 text-text-faint" />
          <div>
            <div className="text-sm font-medium text-text">No docs in this project yet</div>
            <div className="mt-1 text-xs text-text-muted">
              Specs, meeting notes, research — write them here with a full block editor.
            </div>
          </div>
          <Button variant="primary" size="sm" onClick={newPage} disabled={busy}>
            <Plus className="h-3.5 w-3.5" /> New page
          </Button>
        </div>
      ) : (
        <div className="grid gap-2.5 sm:grid-cols-2">
          {projectPages.map((p) => (
            <button
              key={p.id}
              onClick={() => router.push(`/pages/${p.id}`)}
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
    </div>
  );
}
