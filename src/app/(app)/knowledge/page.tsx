"use client";

import { useRef, useState } from "react";
import { CheckCircle2, FileText, Loader2, Upload, XCircle } from "lucide-react";
import { useWorkspace } from "@/lib/data/WorkspaceContext";
import { authedFetch } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Field, inputClass } from "@/components/ui/Modal";
import { cn } from "@/lib/utils";

interface Upload {
  id: string;
  name: string;
  status: "uploading" | "done" | "error";
  chunks?: number;
  error?: string;
}

export default function KnowledgePage() {
  const { projects, currentProject } = useWorkspace();
  const [projectId, setProjectId] = useState(currentProject?.id ?? "");
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [pasteTitle, setPasteTitle] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [pasting, setPasting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const activeProject = projectId || currentProject?.id || projects[0]?.id || "";

  const ingest = async (form: FormData, name: string) => {
    const id = crypto.randomUUID();
    setUploads((u) => [{ id, name, status: "uploading" }, ...u]);
    try {
      const res = await authedFetch("/api/ingest", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed");
      setUploads((u) => u.map((x) => (x.id === id ? { ...x, status: "done", chunks: json.chunksStored } : x)));
    } catch (e) {
      setUploads((u) =>
        u.map((x) => (x.id === id ? { ...x, status: "error", error: e instanceof Error ? e.message : "Failed" } : x))
      );
    }
  };

  const handleFiles = (files: FileList | File[]) => {
    if (!activeProject) return;
    Array.from(files).forEach((file) => {
      const form = new FormData();
      form.append("file", file);
      form.append("projectId", activeProject);
      void ingest(form, file.name);
    });
  };

  const submitPaste = async () => {
    if (!pasteText.trim() || !activeProject) return;
    setPasting(true);
    const form = new FormData();
    form.append("text", pasteText);
    form.append("title", pasteTitle.trim() || "Pasted note");
    form.append("projectId", activeProject);
    await ingest(form, pasteTitle.trim() || "Pasted note");
    setPasteText("");
    setPasteTitle("");
    setPasting(false);
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <header className="border-b border-hairline/[0.08] px-4 py-3">
        <h1 className="text-[15px] font-semibold tracking-tight">Knowledge base</h1>
        <p className="mt-0.5 text-xs text-text-muted">
          Upload documents so the agent can answer questions and link them to your tasks.
        </p>
      </header>

      <div className="mx-auto w-full max-w-2xl px-4 py-5">
        <Field label="Add to project">
          <select
            value={activeProject}
            onChange={(e) => setProjectId(e.target.value)}
            className={inputClass}
          >
            {projects.length === 0 && <option value="">No projects yet</option>}
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>

        {/* dropzone */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            handleFiles(e.dataTransfer.files);
          }}
          onClick={() => fileRef.current?.click()}
          className={cn(
            "mt-1 grid cursor-pointer place-items-center rounded-xl border border-dashed px-6 py-10 text-center transition-colors",
            dragOver ? "border-accent bg-accent/[0.06]" : "border-hairline/[0.08] hover:border-hairline/20 hover:bg-hairline/[0.06]"
          )}
        >
          <input
            ref={fileRef}
            type="file"
            multiple
            hidden
            accept=".pdf,.docx,.txt,.md,.csv,.json,.ts,.tsx,.js,.py,.java,.sql,.yaml,.yml"
            onChange={(e) => e.target.files && handleFiles(e.target.files)}
          />
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-surface-2 text-accent">
            <Upload className="h-5 w-5" />
          </div>
          <div className="mt-3 text-sm font-medium text-text">Drop files or click to upload</div>
          <div className="mt-1 text-xs text-text-muted">PDF, DOCX, Markdown, code, CSV, JSON</div>
        </div>

        {/* paste note */}
        <div className="mt-5">
          <div className="mb-2 text-2xs font-medium uppercase tracking-wide text-text-faint">
            Or paste a note / meeting transcript
          </div>
          <input
            className={inputClass}
            placeholder="Title (optional)"
            value={pasteTitle}
            onChange={(e) => setPasteTitle(e.target.value)}
          />
          <textarea
            className={cn(inputClass, "mt-2 min-h-[96px] resize-y")}
            placeholder="Paste text here…"
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
          />
          <div className="mt-2 flex justify-end">
            <Button variant="primary" size="sm" onClick={submitPaste} disabled={!pasteText.trim() || pasting}>
              {pasting ? "Indexing…" : "Add to knowledge base"}
            </Button>
          </div>
        </div>

        {/* results */}
        {uploads.length > 0 && (
          <div className="mt-6">
            <div className="mb-2 text-2xs font-medium uppercase tracking-wide text-text-faint">This session</div>
            <div className="space-y-1.5">
              {uploads.map((u) => (
                <div key={u.id} className="flex items-center gap-2.5 rounded-lg border border-hairline/[0.08] bg-surface px-3 py-2">
                  <FileText className="h-4 w-4 shrink-0 text-text-muted" />
                  <span className="min-w-0 flex-1 truncate text-sm text-text">{u.name}</span>
                  {u.status === "uploading" && <Loader2 className="h-4 w-4 animate-spin text-text-muted" />}
                  {u.status === "done" && (
                    <span className="flex items-center gap-1 text-2xs text-ok">
                      <CheckCircle2 className="h-3.5 w-3.5" /> {u.chunks} chunks
                    </span>
                  )}
                  {u.status === "error" && (
                    <span className="flex items-center gap-1 text-2xs text-danger" title={u.error}>
                      <XCircle className="h-3.5 w-3.5" /> {u.error?.slice(0, 40)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
