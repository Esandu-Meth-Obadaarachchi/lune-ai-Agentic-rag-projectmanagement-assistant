"use client";

import { MessageSquare, Plus, Trash2 } from "lucide-react";
import type { Chat } from "@/lib/types";
import { cn } from "@/lib/utils";

interface Props {
  chats: Chat[];
  currentChatId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  /** Mobile drawer state. On lg+ the rail is always visible and these are ignored. */
  open?: boolean;
  onClose?: () => void;
}

/**
 * Past conversations plus a new-chat button. On desktop it is a static left rail;
 * on mobile it becomes an off-canvas drawer (same pattern as the app Sidebar) so
 * it never steals width from the chat.
 */
export function ChatSidebar({ chats, currentChatId, onSelect, onNew, onDelete, open = false, onClose }: Props) {
  return (
    <>
      {open && (
        <div
          onClick={onClose}
          className="fixed inset-0 z-40 animate-fade-in bg-black/50 backdrop-blur-sm lg:hidden"
        />
      )}
      <aside
        className={cn(
          "flex w-[248px] shrink-0 flex-col border-r border-hairline/[0.08] bg-surface/40",
          // Mobile: fixed slide-in drawer with an opaque background.
          "fixed inset-y-0 left-0 z-50 h-[100dvh] -translate-x-full transition-transform duration-300 ease-out max-lg:bg-bg",
          // Desktop: static rail, always visible.
          "lg:static lg:z-auto lg:h-full lg:translate-x-0 lg:transition-none",
          open && "translate-x-0 shadow-2xl"
        )}
      >
        <div className="p-2">
          <button
            onClick={() => {
              onNew();
              onClose?.();
            }}
            className="flex w-full items-center gap-2 rounded-md border border-hairline/[0.08] bg-surface-2 px-2.5 py-1.5 text-sm text-text-muted transition-colors hover:border-hairline/20 hover:text-text"
          >
            <Plus className="h-3.5 w-3.5" />
            New chat
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {chats.length === 0 ? (
            <p className="px-2 py-3 text-2xs text-text-faint">No saved chats yet.</p>
          ) : (
            <ul className="space-y-0.5">
              {chats.map((c) => (
                <li key={c.id} className="group relative">
                  <button
                    onClick={() => {
                      onSelect(c.id);
                      onClose?.();
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md py-1.5 pl-2.5 pr-8 text-left text-sm transition-colors",
                      c.id === currentChatId
                        ? "bg-surface-3 text-text"
                        : "text-text-muted hover:bg-hairline/[0.06] hover:text-text"
                    )}
                  >
                    <MessageSquare className="h-3.5 w-3.5 shrink-0 text-text-faint" />
                    <span className="min-w-0 flex-1 truncate">{c.title}</span>
                  </button>
                  <button
                    onClick={() => onDelete(c.id)}
                    aria-label="Delete chat"
                    className="absolute right-1 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-md text-text-faint opacity-0 transition-opacity hover:text-danger group-hover:opacity-100 max-lg:opacity-100"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </>
  );
}
