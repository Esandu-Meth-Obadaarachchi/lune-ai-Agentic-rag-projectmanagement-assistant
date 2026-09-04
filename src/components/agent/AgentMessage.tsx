"use client";

import { useState } from "react";
import { ChevronRight, Terminal } from "lucide-react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatMessage } from "@/lib/types";
import { Logo } from "@/components/ui/Logo";
import { AgentCards } from "./cards";
import { cn } from "@/lib/utils";

export function AgentMessage({ message }: { message: ChatMessage }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-accent px-3.5 py-2 text-sm text-accent-fg">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-2.5">
      <div className="mt-0.5 shrink-0">
        <Logo size={26} />
      </div>
      <div className="min-w-0 flex-1">
        {message.steps && message.steps.length > 0 && <Steps steps={message.steps} />}
        {message.pending ? (
          <Typing />
        ) : (
          <div className="prose-agent text-sm leading-relaxed text-text">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD}>
              {message.content}
            </ReactMarkdown>
          </div>
        )}
        {message.cards && <AgentCards cards={message.cards} />}
      </div>
    </div>
  );
}

function Steps({ steps }: { steps: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-1.5">
      <button
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 text-2xs text-text-faint hover:text-text-muted"
      >
        <ChevronRight className={cn("h-3 w-3 transition-transform", open && "rotate-90")} />
        <Terminal className="h-3 w-3" /> {steps.length} action{steps.length === 1 ? "" : "s"}
      </button>
      {open && (
        <div className="mt-1 space-y-0.5 border-l border-hairline/[0.08] pl-2.5">
          {steps.map((s, i) => (
            <div key={i} className="mono text-2xs text-text-muted">
              {s}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Typing() {
  return (
    <div className="flex items-center gap-1 py-1">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1.5 w-1.5 rounded-full bg-text-faint animate-pulse-dot"
          style={{ animationDelay: `${i * 0.18}s` }}
        />
      ))}
    </div>
  );
}

const MD: Components = {
  p: ({ node, ...p }) => <p className="mb-2 last:mb-0" {...p} />,
  ul: ({ node, ...p }) => <ul className="mb-2 ml-4 list-disc space-y-1 last:mb-0" {...p} />,
  ol: ({ node, ...p }) => <ol className="mb-2 ml-4 list-decimal space-y-1 last:mb-0" {...p} />,
  li: ({ node, ...p }) => <li className="pl-0.5" {...p} />,
  strong: ({ node, ...p }) => <strong className="font-semibold text-text" {...p} />,
  a: ({ node, ...p }) => <a className="text-accent underline underline-offset-2" {...p} />,
  code: ({ node, ...p }) => (
    <code className="mono rounded bg-surface-2 px-1 py-0.5 text-[12px] text-text" {...p} />
  ),
  h1: ({ node, ...p }) => <h3 className="mb-1.5 mt-2 text-sm font-semibold" {...p} />,
  h2: ({ node, ...p }) => <h3 className="mb-1.5 mt-2 text-sm font-semibold" {...p} />,
  h3: ({ node, ...p }) => <h3 className="mb-1 mt-2 text-sm font-semibold" {...p} />,
};
