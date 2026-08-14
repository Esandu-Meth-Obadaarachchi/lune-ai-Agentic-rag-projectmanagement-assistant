"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Menu, PanelLeftOpen, Search } from "lucide-react";
import { useWorkspace } from "@/lib/data/WorkspaceContext";
import { Logo } from "@/components/ui/Logo";
import { Sidebar } from "./Sidebar";
import { CommandPalette, openCommandPalette } from "./CommandPalette";
import { NotificationBell } from "./NotificationBell";

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
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-bg lg:flex-row">
      {/* Mobile top bar */}
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3 pt-[env(safe-area-inset-top)] lg:hidden" style={{ height: "calc(3rem + env(safe-area-inset-top))" }}>
        <button
          onClick={() => setNavOpen(true)}
          className="grid h-8 w-8 place-items-center rounded-md text-text-muted hover:bg-surface-2 hover:text-text"
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5" />
        </button>
        <Logo size={20} />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-text">
          {currentWorkspace ? `${currentWorkspace.emoji} ${currentWorkspace.name}` : "Lune AI"}
        </span>
        {/* No keyboard on a phone, so the palette needs a visible way in. */}
        <NotificationBell />
        <button
          onClick={openCommandPalette}
          aria-label="Search"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-text-muted hover:bg-surface-2 hover:text-text"
        >
          <Search className="h-4 w-4" />
        </button>
      </header>

      {/* Backdrop for the mobile drawer */}
      {navOpen && (
        <div
          onClick={() => setNavOpen(false)}
          className="fixed inset-0 z-40 animate-fade-in bg-black/50 backdrop-blur-sm lg:hidden"
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
          className="fixed left-2 top-2 z-30 hidden h-8 w-8 place-items-center rounded-md border border-border bg-surface/80 text-text-muted backdrop-blur transition-colors hover:bg-surface-2 hover:text-text lg:grid"
        >
          <PanelLeftOpen className="h-4 w-4" />
        </button>
      )}

      <main className="min-w-0 flex-1 overflow-hidden">{children}</main>

      <CommandPalette />

      {seeding && (
        <div className="fixed inset-0 z-[200] grid place-items-center bg-bg/80 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-4 animate-fade-in">
            <Logo size={40} className="animate-pulse-dot" />
            <div className="text-center">
              <div className="text-sm font-medium text-text">Setting up Lune</div>
              <div className="mt-1 text-xs text-text-muted">
                Creating your workspaces and a few starter projects…
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
