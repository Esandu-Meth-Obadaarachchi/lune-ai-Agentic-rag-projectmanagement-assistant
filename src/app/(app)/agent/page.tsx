"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, ChevronDown, ListTodo, MessagesSquare, Plus, Sparkles, Sun } from "lucide-react";
import { useAuth } from "@/lib/auth/AuthContext";
import { useWorkspace } from "@/lib/data/WorkspaceContext";
import {
  addChatMessage,
  createChat,
  deleteChat,
  loadChatMessages,
  touchChat,
  watchAllTasks,
  watchChats,
} from "@/lib/data/firestore";
import { computeDigest } from "@/lib/data/standup";
import { postJSON } from "@/lib/api";
import { MAX_CHAT_INPUT_CHARS } from "@/lib/constants";
import type { Chat, ChatMessage, Task } from "@/lib/types";
import { StandupCard } from "@/components/agent/StandupCard";
import { AgentMessage } from "@/components/agent/AgentMessage";
import { ChatSidebar } from "@/components/agent/ChatSidebar";
import { cn } from "@/lib/utils";

const CHIPS = [
  { label: "What's overdue", icon: ListTodo },
  { label: "Plan my day", icon: Sun },
  { label: "Create a task", icon: Plus },
];

export default function AgentPage() {
  const { user } = useAuth();
  const router = useRouter();
  const { currentWorkspace, currentProject, projects, selectProject } = useWorkspace();

  const [allTasks, setAllTasks] = useState<Task[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chats, setChats] = useState<Chat[]>([]);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [chatListOpen, setChatListOpen] = useState(false);
  const [standupOpen, setStandupOpen] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Standup starts collapsed on small screens so the composer and messages get
  // the room; expanded on desktop where there's space.
  useEffect(() => {
    setStandupOpen(window.innerWidth >= 1024);
  }, []);

  // Grow the composer with the text, up to a cap, then let it scroll.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [input]);

  useEffect(() => {
    if (!user) return;
    return watchAllTasks(user.uid, setAllTasks);
  }, [user]);

  // Live list of ALL this user's saved chats — global across workspaces, so the
  // conversation stays open when the user switches workspace.
  useEffect(() => {
    if (!user) return;
    return watchChats(user.uid, setChats);
  }, [user]);

  const wsTasks = useMemo(
    () => (currentWorkspace ? allTasks.filter((t) => t.workspaceId === currentWorkspace.id) : allTasks),
    [allTasks, currentWorkspace]
  );
  const digest = useMemo(() => computeDigest(wsTasks), [wsTasks]);
  const projectName = (id: string) => projects.find((p) => p.id === id)?.name;
  const needAttention = digest.overdue.length + digest.dueToday.length + digest.blocked.length;

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const openTask = (t: Task) => {
    selectProject(t.projectId);
    router.push(`/?task=${t.id}`);
  };

  const openChat = async (id: string) => {
    if (!user) return;
    setCurrentChatId(id);
    try {
      setMessages(await loadChatMessages(user.uid, id));
    } catch (e) {
      console.error("load chat failed", e);
      setMessages([]);
    }
  };

  const startNewChat = () => {
    setCurrentChatId(null);
    setMessages([]);
  };

  const removeChat = async (id: string) => {
    if (!user) return;
    try {
      await deleteChat(user.uid, id);
    } catch (e) {
      console.error("delete chat failed", e);
    }
    if (id === currentChatId) startNewChat();
  };

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || sending || !currentWorkspace || !user) return;
    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: "user", content, createdAt: Date.now() };
    const pending: ChatMessage = { id: crypto.randomUUID(), role: "assistant", content: "", pending: true, createdAt: Date.now() };
    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    setMessages((prev) => [...prev, userMsg, pending]);
    setInput("");
    setSending(true);

    // Ensure a saved chat exists — create it on the first message, titled from it.
    let chatId = currentChatId;
    try {
      if (!chatId) {
        chatId = await createChat(user.uid, currentWorkspace.id, content);
        setCurrentChatId(chatId);
      }
      await addChatMessage(chatId, user.uid, userMsg);
    } catch (e) {
      console.error("persist user message failed", e);
    }

    try {
      const res = await postJSON<{ answer: string; steps: string[]; sources: unknown[]; cards: unknown[] }>(
        "/api/chat",
        { message: content, workspaceId: currentWorkspace.id, projectId: currentProject?.id, history }
      );
      const answered: ChatMessage = {
        id: pending.id,
        role: "assistant",
        content: res.answer || "…",
        steps: res.steps,
        sources: res.sources as never,
        cards: res.cards as never,
        createdAt: Date.now(),
      };
      setMessages((prev) => prev.map((m) => (m.id === pending.id ? { ...answered, pending: false } : m)));
      if (chatId) {
        try {
          await addChatMessage(chatId, user.uid, answered);
          await touchChat(chatId);
        } catch (e) {
          console.error("persist assistant message failed", e);
        }
      }
    } catch (e) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === pending.id
            ? {
                ...m,
                pending: false,
                content:
                  "⚠️ Something went wrong reaching the agent.\n\n> " +
                  (e instanceof Error ? e.message : String(e)) +
                  "\n\nIf this keeps happening, check the API keys are set, or try a smaller request.",
              }
            : m
        )
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex h-full">
      <ChatSidebar
        chats={chats}
        currentChatId={currentChatId}
        onSelect={openChat}
        onNew={startNewChat}
        onDelete={removeChat}
        open={chatListOpen}
        onClose={() => setChatListOpen(false)}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b border-hairline/[0.08] px-3 py-3 sm:px-4">
          <button
            onClick={() => setChatListOpen(true)}
            aria-label="Chat history"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-text-muted hover:bg-hairline/[0.06] hover:text-text lg:hidden"
          >
            <MessagesSquare className="h-5 w-5" />
          </button>
          <h1 className="text-[15px] font-semibold tracking-tight">Agent</h1>
          <span className="min-w-0 truncate text-2xs text-text-faint">· {currentWorkspace?.name}</span>
        </header>

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-2xl px-3 py-4 sm:px-4 sm:py-5">
            {standupOpen ? (
              <div>
                <div className="mb-1 flex justify-end">
                  <button
                    onClick={() => setStandupOpen(false)}
                    className="text-2xs text-text-faint transition-colors hover:text-text-muted"
                  >
                    Hide standup
                  </button>
                </div>
                <StandupCard
                  digest={digest}
                  userName={user?.displayName ?? "there"}
                  projectName={projectName}
                  onOpen={openTask}
                />
              </div>
            ) : (
              <button
                onClick={() => setStandupOpen(true)}
                className="flex w-full items-center gap-2 rounded-lg border border-hairline/[0.08] bg-surface-2 px-3 py-2 text-sm text-text-muted transition-colors hover:border-hairline/20 hover:text-text"
              >
                <Sparkles className="h-3.5 w-3.5 text-accent" />
                Today&apos;s standup
                {needAttention > 0 && (
                  <span className="text-2xs text-text-faint">· {needAttention} need attention</span>
                )}
                <ChevronDown className="ml-auto h-3.5 w-3.5" />
              </button>
            )}

            {messages.length === 0 ? (
              <div className="mt-6 text-center text-sm text-text-muted">
                Ask about any project, or tell me to create and update tasks.
              </div>
            ) : (
              <div className="mt-6 space-y-5">
                {messages.map((m) => (
                  <AgentMessage key={m.id} message={m} onReply={send} />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Composer */}
        <div className="border-t border-hairline/[0.08] px-3 py-3 sm:px-4">
          <div className="mx-auto max-w-2xl">
            <div className="mb-2 flex flex-wrap gap-1.5">
              {CHIPS.map((c) => (
                <button
                  key={c.label}
                  onClick={() => (c.label === "Create a task" ? setInput("Create a task: ") : send(c.label))}
                  className="inline-flex items-center gap-1.5 rounded-full border border-hairline/[0.08] bg-surface-2 px-2.5 py-1 text-2xs text-text-muted transition-colors hover:border-hairline/20 hover:text-text"
                >
                  <c.icon className="h-3 w-3" />
                  {c.label}
                </button>
              ))}
            </div>
            <div className="flex items-end gap-2 rounded-xl border border-hairline/[0.08] bg-surface-2 p-1.5 focus-within:border-accent/50">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send(input);
                  }
                }}
                rows={1}
                maxLength={MAX_CHAT_INPUT_CHARS}
                placeholder="Ask the brain anything…"
                className="max-h-60 min-h-[24px] flex-1 resize-none overflow-y-auto bg-transparent px-2 py-1.5 text-sm leading-relaxed text-text outline-none placeholder:text-text-faint"
              />
              <button
                onClick={() => send(input)}
                disabled={!input.trim() || sending}
                className={cn(
                  "grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent text-accent-fg transition-all hover:bg-accent-hover disabled:opacity-40",
                  "active:translate-y-px"
                )}
              >
                <ArrowUp className="h-4 w-4" strokeWidth={2.5} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
