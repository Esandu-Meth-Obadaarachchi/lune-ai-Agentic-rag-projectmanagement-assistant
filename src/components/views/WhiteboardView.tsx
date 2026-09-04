"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import "@excalidraw/excalidraw/index.css";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { BinaryFiles } from "@excalidraw/excalidraw/types";
import { useWorkspace } from "@/lib/data/WorkspaceContext";
import { saveWhiteboard, watchWhiteboard } from "@/lib/data/firestore";
import { useTheme } from "@/lib/theme/ThemeContext";
import { Logo } from "@/components/ui/Logo";

// Excalidraw touches `window`, so it must never render on the server.
const Excalidraw = dynamic(async () => (await import("@excalidraw/excalidraw")).Excalidraw, {
  ssr: false,
  loading: () => (
    <div className="grid h-full place-items-center">
      <Logo size={30} className="animate-pulse-dot" />
    </div>
  ),
});

type Scene = { elements: readonly ExcalidrawElement[]; files: BinaryFiles };

export function WhiteboardView() {
  const { currentProject, currentWorkspace } = useWorkspace();
  const { theme } = useTheme();
  const projectId = currentProject?.id;

  const [initial, setInitial] = useState<Scene | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const lastSaved = useRef<string>("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load the scene once. We take a last-write-wins snapshot rather than live
  // co-editing so a background update never yanks the canvas out from under you.
  useEffect(() => {
    if (!projectId) return;
    setLoaded(false);
    setInitial(null);
    let done = false;
    const unsub = watchWhiteboard(projectId, (scene) => {
      if (done) return;
      done = true;
      lastSaved.current = scene ?? "";
      try {
        const parsed = scene ? (JSON.parse(scene) as Scene) : null;
        setInitial(parsed && parsed.elements ? parsed : { elements: [], files: {} });
      } catch {
        setInitial({ elements: [], files: {} });
      }
      setLoaded(true);
    });
    return () => {
      unsub();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [projectId]);

  const onChange = (elements: readonly ExcalidrawElement[], _app: unknown, files: BinaryFiles) => {
    if (!projectId || !currentWorkspace) return;
    // Drop deleted elements so the scene doesn't grow forever.
    const live = elements.filter((el) => !el.isDeleted);
    const scene = JSON.stringify({ elements: live, files });
    if (scene === lastSaved.current) return;
    setStatus("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        await saveWhiteboard(projectId, currentWorkspace.memberIds, scene);
        lastSaved.current = scene;
        setStatus("saved");
      } catch (e) {
        console.error("saveWhiteboard failed (scene may exceed 1MB)", e);
        setStatus("idle");
      }
    }, 800);
  };

  if (!currentProject) return null;

  return (
    <div className="relative h-full w-full">
      {loaded && initial ? (
        <Excalidraw
          initialData={{ elements: initial.elements, files: initial.files, scrollToContent: true }}
          onChange={onChange}
          theme={theme === "light" ? "light" : "dark"}
        />
      ) : (
        <div className="grid h-full place-items-center">
          <Logo size={30} className="animate-pulse-dot" />
        </div>
      )}
      {status !== "idle" && (
        <div className="pointer-events-none absolute bottom-3 right-3 z-10 rounded-md border border-hairline/[0.08] bg-surface/90 px-2 py-1 text-2xs text-text-faint backdrop-blur">
          {status === "saving" ? "Saving…" : "Saved"}
        </div>
      )}
    </div>
  );
}
