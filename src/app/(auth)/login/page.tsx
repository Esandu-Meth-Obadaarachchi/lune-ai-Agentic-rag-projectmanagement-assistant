"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRight,
  BookOpen,
  CalendarCheck2,
  CalendarDays,
  KanbanSquare,
  MessageSquareText,
  Network,
  PencilRuler,
  Sparkles,
  Users,
} from "lucide-react";
import { useAuth } from "@/lib/auth/AuthContext";
import { Logo } from "@/components/ui/Logo";
import { cn } from "@/lib/utils";

/* The rotating showcase — each drives a small live mock on the right. */
const SHOWCASE = [
  { id: "today", icon: CalendarCheck2, label: "Today", blurb: "Every task due today, pulled from all your workspaces, beside a per-day planner." },
  { id: "map", icon: Network, label: "Mind map", blurb: "See a project as a graph. Pan, zoom, and branch new tasks off any node." },
  { id: "draw", icon: PencilRuler, label: "Whiteboard", blurb: "An Excalidraw canvas per project for sketches, flows and quick thinking." },
  { id: "share", icon: Users, label: "Sharing", blurb: "Invite teammates by email and scope them to exactly the projects they need." },
  { id: "agent", icon: MessageSquareText, label: "The brain", blurb: "A Claude agent that reads your tasks and knowledge, and writes tasks back." },
] as const;

type ShowcaseId = (typeof SHOWCASE)[number]["id"];

const FEATURES = [
  { icon: KanbanSquare, title: "Four ways to work", body: "Tree, board, list and calendar over the same tasks. Nested subtasks, drag-to-reschedule, keyboard-fast." },
  { icon: CalendarCheck2, title: "A real Today view", body: "Due-today across every workspace, plus a notebook to plan the day. Synced to all your devices." },
  { icon: Network, title: "Mind-map any project", body: "Turn a task tree into an interactive graph. Add children straight from the map." },
  { icon: PencilRuler, title: "Whiteboard per project", body: "Full Excalidraw canvas, saved with the project. Sketch the thing before you build it." },
  { icon: BookOpen, title: "Knowledge that answers", body: "Upload docs per project. They're embedded and searchable, and the agent reasons over them." },
  { icon: MessageSquareText, title: "An agent for your work", body: "Ask about any project, create tasks by chatting. Grounded in your own data." },
  { icon: Users, title: "Share with precision", body: "Workspace-wide or project-scoped access, with owner / admin / member / viewer roles." },
  { icon: CalendarDays, title: "Google Calendar sync", body: "Two-way sync so tasks with a time land on your calendar and stay in step." },
];

export default function LandingPage() {
  const { user, loading, configured, signIn } = useAuth();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<ShowcaseId>("today");
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (!loading && user) router.replace("/");
  }, [user, loading, router]);

  // Auto-advance the showcase unless the user is hovering it.
  useEffect(() => {
    if (paused) return;
    const t = setInterval(() => {
      setActive((cur) => {
        const i = SHOWCASE.findIndex((s) => s.id === cur);
        return SHOWCASE[(i + 1) % SHOWCASE.length].id;
      });
    }, 3200);
    return () => clearInterval(t);
  }, [paused]);

  const handleSignIn = async () => {
    setError(null);
    setBusy(true);
    try {
      await signIn();
      router.replace("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign-in failed. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="moonlit relative min-h-[100dvh] overflow-hidden">
      {/* A second, warmer pool of light behind the hero, on the same axis as the
          ground wash. The grid below gives the glass something to refract. */}
      <div
        className="pointer-events-none fixed inset-0"
        style={{
          background:
            "radial-gradient(55rem 38rem at 74% -12%, rgb(var(--accent) / 0.1), transparent 58%), radial-gradient(45rem 38rem at 4% 108%, rgb(var(--progress) / 0.06), transparent 55%)",
        }}
      />
      <div
        className="pointer-events-none fixed inset-0 opacity-[0.35]"
        style={{
          backgroundImage:
            "linear-gradient(rgb(255 255 255 / 0.025) 1px, transparent 1px), linear-gradient(90deg, rgb(255 255 255 / 0.025) 1px, transparent 1px)",
          backgroundSize: "44px 44px",
          maskImage: "radial-gradient(circle at 50% 20%, black, transparent 75%)",
        }}
      />

      {/* Nav */}
      <header className="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2.5">
          <Logo size={26} />
          <span className="t-title text-base">Lune<span className="ml-1 font-medium text-text-faint">AI</span></span>
        </div>
        <button
          onClick={handleSignIn}
          disabled={busy || !configured}
          className="press glass inline-flex h-9 items-center gap-2 rounded-md px-3.5 text-sm font-medium text-text transition-all hover:border-accent/40 hover:text-accent disabled:opacity-50"
        >
          <GoogleGlyph size={15} /> Sign in
        </button>
      </header>

      {/* Hero */}
      <section className="relative z-10 mx-auto grid max-w-6xl gap-10 px-6 pb-10 pt-8 lg:grid-cols-[1fr_1fr] lg:items-center lg:pt-16">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="mb-5 inline-flex items-center gap-1.5 rounded-full border border-hairline/[0.08] bg-surface px-3 py-1 text-2xs font-medium text-text-muted">
            <Sparkles className="h-3.5 w-3.5 text-accent" /> Project manager + knowledge base + Claude agent
          </div>
          <h1 className="text-[2.5rem] font-semibold leading-[1.04] tracking-tight sm:text-[3.1rem]">
            Your work, thinking
            <span className="text-accent"> alongside you.</span>
          </h1>
          <p className="mt-5 max-w-md text-[15px] leading-relaxed text-text-muted">
            One home for every business you run. Plan the day, map a project,
            sketch on a whiteboard, share with your team, and ask an agent that
            actually knows your tasks and documents.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <button
              onClick={handleSignIn}
              disabled={busy || !configured}
              className="group inline-flex h-11 items-center gap-3 rounded-xl bg-white px-5 font-medium text-[#1f2430] shadow-e1 transition-all hover:brightness-95 active:translate-y-px disabled:opacity-50"
            >
              <GoogleGlyph />
              {busy ? "Opening Google…" : "Continue with Google"}
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </button>
            <a href="#features" className="text-sm font-medium text-text-muted hover:text-text">
              See everything it does →
            </a>
          </div>

          {error && (
            <p className="mt-4 max-w-md rounded-md border border-danger/25 bg-danger/10 px-3 py-2 text-xs text-danger">
              {error}
            </p>
          )}
          {!configured && (
            <div className="mt-5 max-w-md rounded-lg border border-warn/25 bg-warn/[0.07] p-3 text-xs text-text-muted">
              <div className="mb-1 font-medium text-warn">Firebase not configured</div>
              Copy <code className="mono text-text">.env.example</code> to{" "}
              <code className="mono text-text">.env.local</code> and add your Firebase web config,
              then restart the dev server.
            </div>
          )}
        </motion.div>

        {/* Interactive showcase */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
          className="glass-panel rounded-2xl p-3"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
        >
          <div className="mb-3 flex flex-wrap gap-1.5">
            {SHOWCASE.map((s) => (
              <button
                key={s.id}
                onClick={() => setActive(s.id)}
                className={cn(
                  "press inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-2xs font-medium transition-all duration-200",
                  active === s.id
                    ? "bg-accent/15 text-accent shadow-[inset_0_1px_0_rgb(var(--hairline)/0.08)]"
                    : "text-text-muted hover:bg-hairline/[0.06] hover:text-text"
                )}
              >
                <s.icon className="h-3.5 w-3.5" /> {s.label}
              </button>
            ))}
          </div>
          <div className="relative h-[300px] overflow-hidden rounded-xl border border-hairline/[0.06] bg-bg-deep/50">
            <AnimatePresence mode="wait">
              <motion.div
                key={active}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                className="absolute inset-0 p-4"
              >
                <Preview id={active} />
              </motion.div>
            </AnimatePresence>
          </div>
          <p className="mt-3 px-1 text-sm leading-snug text-text-muted">
            {SHOWCASE.find((s) => s.id === active)?.blurb}
          </p>
        </motion.div>
      </section>

      {/* Feature grid */}
      <section id="features" className="relative z-10 mx-auto max-w-6xl px-6 py-16">
        <div className="mb-8 text-center">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Everything, in one place</h2>
          <p className="mx-auto mt-2 max-w-md text-[14px] text-text-muted">
            Notion-meets-Linear, dense and keyboard-friendly, wired to your own Firebase and Pinecone.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f, i) => (
            <motion.div
              key={f.title}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-40px" }}
              transition={{ duration: 0.4, delay: (i % 4) * 0.05, ease: [0.22, 1, 0.36, 1] }}
              className="card lift p-4"
            >
              <div className="mb-3 grid h-9 w-9 place-items-center rounded-lg border border-hairline/[0.08] bg-surface-2 text-accent">
                <f.icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
              </div>
              <div className="text-[14px] font-medium text-text">{f.title}</div>
              <div className="mt-1 text-sm leading-snug text-text-muted">{f.body}</div>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Closing CTA */}
      <section className="relative z-10 mx-auto max-w-6xl px-6 pb-20">
        <div className="lit relative overflow-hidden rounded-2xl border border-hairline/[0.08] p-8 text-center shadow-e3 sm:p-12">
          <div
            className="pointer-events-none absolute inset-0 opacity-60"
            style={{ background: "radial-gradient(30rem 16rem at 50% -20%, rgb(245 197 24 / 0.14), transparent 70%)" }}
          />
          <div className="relative">
            <h2 className="text-2xl font-semibold tracking-tight sm:text-[2rem]">Begin with Lune</h2>
            <p className="mx-auto mt-2 max-w-sm text-[14px] text-text-muted">
              We create a private workspace on first sign-in. Your data stays in your own instances.
            </p>
            <button
              onClick={handleSignIn}
              disabled={busy || !configured}
              className="group mx-auto mt-6 inline-flex h-11 items-center gap-3 rounded-xl bg-white px-5 font-medium text-[#1f2430] shadow-e1 transition-all hover:brightness-95 active:translate-y-px disabled:opacity-50"
            >
              <GoogleGlyph />
              {busy ? "Opening Google…" : "Continue with Google"}
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </button>
          </div>
        </div>
        <p className="mt-8 text-center text-2xs text-text-faint">
          © {new Date().getFullYear()} Lune AI · Built by Esandu
        </p>
      </section>
    </div>
  );
}

/* ------------------------------ mock previews ------------------------------ */

function Preview({ id }: { id: ShowcaseId }) {
  if (id === "today") return <TodayPreview />;
  if (id === "map") return <MapPreview />;
  if (id === "draw") return <DrawPreview />;
  if (id === "share") return <SharePreview />;
  return <AgentPreview />;
}

const dot = (c: string) => <span className={cn("h-2 w-2 shrink-0 rounded-full", c)} />;

function Row({ color, label, meta }: { color: string; label: string; meta?: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-hairline/[0.08] bg-surface px-2.5 py-2">
      {dot(color)}
      <span className="min-w-0 flex-1 truncate text-[12px] text-text">{label}</span>
      {meta && <span className="text-[10px] text-text-faint">{meta}</span>}
    </div>
  );
}

function TodayPreview() {
  return (
    <div className="grid h-full grid-cols-2 gap-3">
      <div className="space-y-2">
        <div className="text-2xs font-semibold uppercase tracking-wider text-text-faint">Due today</div>
        <Row color="bg-danger" label="Ship monthly report" meta="09:00" />
        <Row color="bg-progress" label="Retrain anomaly model" meta="11:30" />
        <Row color="bg-todo" label="Follow up: Predictiv AI" meta="14:00" />
        <Row color="bg-todo" label="Prep Cresco application" />
      </div>
      <div className="rounded-lg border border-hairline/[0.08] bg-surface p-2.5">
        <div className="mb-1.5 text-2xs font-medium text-accent">Day planner</div>
        <div className="space-y-1.5">
          {["09:00  Deep work — solar", "11:30  ML retrain", "14:00  Calls", "16:00  Gradify build"].map((l) => (
            <div key={l} className="text-[11px] leading-relaxed text-text-muted">{l}</div>
          ))}
        </div>
      </div>
    </div>
  );
}

function MapPreview() {
  return (
    <div className="relative h-full">
      <svg className="absolute inset-0 h-full w-full" preserveAspectRatio="none">
        <line x1="18%" y1="50%" x2="52%" y2="24%" stroke="rgb(var(--border-strong))" strokeWidth="1.5" />
        <line x1="18%" y1="50%" x2="52%" y2="50%" stroke="rgb(var(--border-strong))" strokeWidth="1.5" />
        <line x1="18%" y1="50%" x2="52%" y2="76%" stroke="rgb(var(--border-strong))" strokeWidth="1.5" />
        <line x1="66%" y1="50%" x2="88%" y2="38%" stroke="rgb(var(--border-strong))" strokeWidth="1.5" />
        <line x1="66%" y1="50%" x2="88%" y2="64%" stroke="rgb(var(--border-strong))" strokeWidth="1.5" />
      </svg>
      <Node className="left-[4%] top-1/2 -translate-y-1/2 border-accent/40 bg-accent/10" label="Gradify" />
      <Node className="left-[40%] top-[24%] -translate-y-1/2" label="Auth + roles" />
      <Node className="left-[40%] top-1/2 -translate-y-1/2" label="Question bank" />
      <Node className="left-[40%] top-[76%] -translate-y-1/2" label="AI marking" />
      <Node className="left-[74%] top-[38%] -translate-y-1/2" label="Rubric prompt" />
      <Node className="left-[74%] top-[64%] -translate-y-1/2" label="Grader eval" />
    </div>
  );
}

function Node({ className, label }: { className?: string; label: string }) {
  return (
    <div className={cn("absolute rounded-lg border border-hairline/[0.08] bg-surface px-2 py-1 text-[10px] text-text shadow-e1", className)}>
      {label}
    </div>
  );
}

function DrawPreview() {
  return (
    <svg viewBox="0 0 300 260" className="h-full w-full">
      <rect x="24" y="30" width="86" height="52" rx="8" fill="none" stroke="rgb(var(--accent))" strokeWidth="2" />
      <text x="67" y="60" textAnchor="middle" fill="rgb(var(--text-muted))" fontSize="12">Upload</text>
      <path d="M110 56 L170 56" stroke="rgb(var(--text-faint))" strokeWidth="2" markerEnd="url(#a)" />
      <rect x="170" y="30" width="96" height="52" rx="8" fill="none" stroke="rgb(96 165 250)" strokeWidth="2" />
      <text x="218" y="60" textAnchor="middle" fill="rgb(var(--text-muted))" fontSize="12">Embed</text>
      <path d="M67 82 L67 150" stroke="rgb(var(--text-faint))" strokeWidth="2" markerEnd="url(#a)" />
      <circle cx="67" cy="182" r="30" fill="none" stroke="rgb(74 222 128)" strokeWidth="2" />
      <text x="67" y="186" textAnchor="middle" fill="rgb(var(--text-muted))" fontSize="11">Pinecone</text>
      <path d="M150 170 q 40 -30 90 10" stroke="rgb(var(--accent))" strokeWidth="2" fill="none" strokeLinecap="round" />
      <defs>
        <marker id="a" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
          <path d="M0 0 L6 3 L0 6 z" fill="rgb(var(--text-faint))" />
        </marker>
      </defs>
    </svg>
  );
}

function SharePreview() {
  const people = [
    { n: "Esandu", r: "Owner", c: "text-accent" },
    { n: "Haritha", r: "Admin", c: "text-text-muted" },
    { n: "Dev team", r: "Member · 2 projects", c: "text-text-muted" },
    { n: "Client", r: "Viewer · Pipeline", c: "text-text-muted" },
  ];
  return (
    <div className="space-y-2">
      <div className="text-2xs font-semibold uppercase tracking-wider text-text-faint">Members</div>
      {people.map((p) => (
        <div key={p.n} className="flex items-center gap-2.5 rounded-md border border-hairline/[0.08] bg-surface px-2.5 py-2">
          <span className="grid h-6 w-6 place-items-center rounded-full bg-surface-3 text-[10px] font-semibold text-text">
            {p.n[0]}
          </span>
          <span className="flex-1 text-[12px] text-text">{p.n}</span>
          <span className={cn("rounded border border-hairline/[0.08] bg-surface-2 px-1.5 py-0.5 text-[10px]", p.c)}>{p.r}</span>
        </div>
      ))}
    </div>
  );
}

function AgentPreview() {
  return (
    <div className="flex h-full flex-col justify-end gap-2.5">
      <div className="ml-auto max-w-[80%] rounded-2xl rounded-br-sm bg-accent/15 px-3 py-2 text-[12px] text-text">
        What&apos;s blocking the solar dashboard?
      </div>
      <div className="max-w-[85%] rounded-2xl rounded-bl-sm border border-hairline/[0.08] bg-surface px-3 py-2 text-[12px] text-text-muted">
        The Excel upload timeout is blocked and overdue. I&apos;ve flagged it urgent and drafted a subtask to profile large files.
      </div>
      <div className="flex items-center gap-1.5 text-[10px] text-text-faint">
        <Sparkles className="h-3 w-3 text-accent" /> read 6 tasks · 2 knowledge chunks
      </div>
    </div>
  );
}

function GoogleGlyph({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}
