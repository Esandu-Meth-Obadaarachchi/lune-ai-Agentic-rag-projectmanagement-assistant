"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Menu, PanelLeftOpen, Search } from "lucide-react";
import { useWorkspace } from "@/lib/data/WorkspaceContext";
import { Logo } from "@/components/ui/Logo";
import { cn } from "@/lib/utils";
import { Sidebar } from "./Sidebar";
import { CommandPalette, openCommandPalette } from "./CommandPalette";
import { NotificationBell } from "./NotificationBell";

/**
 * The frame. Two slabs floating on a moonlit ground: the glass sidebar on the
 * left, the content slab filling the rest. The gap between them and the inset
 * from the viewport edge are what make them read as floating rather than as
 * panes bolted to the window.
 */
export function AppFrame({ children }: { children: React.ReactNode }) {
  const { seeding, currentWorkspace } = useWorkspace();
  const [navOpen, setNavOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();

  // Restore the desktop collapse preference.
  useEffect(() => {
    setCollapsed(localStorage.getItem("sb-nav-collapsed") === "1");
  }, []);
  const toggleCollapse = () =>
    setCollapsed((c) => {
      const next = !c;
      localStorage.setItem("sb-nav-collapsed", next ? "1" : "0");
      return next;
    });

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  return (
    <div className="moonlit flex h-[100dvh] flex-col overflow-hidden lg:relative lg:block lg:p-3">
      {/* Mobile top bar */}
      <header
        className="relative z-10 flex shrink-0 items-center gap-2 border-b border-hairline/[0.07] px-3 pt-[env(safe-area-inset-top)] lg:hidden"
        style={{ height: "calc(3.25rem + env(safe-area-inset-top))" }}
      >
        <button
          onClick={() => setNavOpen(true)}
          className="press grid h-9 w-9 place-items-center rounded-md text-text-muted transition-colors hover:bg-hairline/[0.06] hover:text-text"
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5" />
        </button>
        <Logo size={20} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-text">
          {currentWorkspace ? `${currentWorkspace.emoji} ${currentWorkspace.name}` : "Lune AI"}
        </span>
        {/* No keyboard on a phone, so the palette needs a visible way in. */}
        <NotificationBell />
        <button
          onClick={openCommandPalette}
          aria-label="Search"
          className="press grid h-9 w-9 shrink-0 place-items-center rounded-md text-text-muted transition-colors hover:bg-hairline/[0.06] hover:text-text"
        >
          <Search className="h-4 w-4" />
        </button>
      </header>

      {/* Backdrop for the mobile drawer */}
      {navOpen && (
        <div
          onClick={() => setNavOpen(false)}
          className="fixed inset-0 z-40 animate-fade-in bg-bg-deep/70 backdrop-blur-sm lg:hidden"
        />
      )}

      <Sidebar
        navOpen={navOpen}
        onNavClose={() => setNavOpen(false)}
        collapsed={collapsed}
        onToggleCollapse={toggleCollapse}
      />

      {/* Reopen affordance when the desktop sidebar is collapsed. */}
      {collapsed && (
        <button
          onClick={toggleCollapse}
          aria-label="Open sidebar"
          title="Open sidebar"
          className="glass press absolute left-[18px] top-[18px] z-30 hidden h-9 w-9 place-items-center rounded-md text-text-muted shadow-e2 transition-colors hover:text-text lg:grid"
        >
          <PanelLeftOpen className="h-4 w-4" />
        </button>
      )}

      {/* The content slab. Opaque enough to read against, still lit from above. */}
      <main
        className={cn(
          "relative z-10 min-w-0 flex-1 overflow-hidden border-hairline/[0.08] bg-surface/85 transition-[padding] duration-[380ms] ease-smooth lg:h-full lg:rounded-2xl lg:border",
          "lg:bg-[radial-gradient(90%_60%_at_0%_0%,rgb(var(--lumen)/0.045),transparent_60%),radial-gradient(60%_50%_at_100%_0%,rgb(var(--progress)/0.03),transparent_55%),rgb(var(--surface)/0.85)]",
          "[.light_&]:border-border-strong [.light_&]:bg-surface [.light_&]:bg-none [.light_&]:shadow-[0_1px_2px_rgb(15_23_42/0.05),0_22px_50px_-20px_rgb(15_23_42/0.18)]",
          "lg:[box-shadow:inset_0_1px_0_rgb(var(--hairline)/0.07),0_2px_6px_rgb(0_0_0/0.4),0_30px_70px_-20px_rgb(0_0_0/0.7)]",
          // Collapsed keeps just enough lane for the reopen button.
          collapsed ? "lg:pl-[52px]" : "lg:pl-[266px]"
        )}
      >
        {children}
      </main>

      <CommandPalette />

      {seeding && (
        <div className="fixed inset-0 z-[200] grid place-items-center bg-bg/85 backdrop-blur-md">
          <div className="flex animate-fade-in flex-col items-center gap-5">
            <Logo size={44} className="animate-moon-drift" />
            <div className="text-center">
              <div className="t-heading text-[15px] text-text">Setting up Lune</div>
              <div className="mt-1.5 text-xs text-text-muted">
                Creating your workspaces and a few starter projects…
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
