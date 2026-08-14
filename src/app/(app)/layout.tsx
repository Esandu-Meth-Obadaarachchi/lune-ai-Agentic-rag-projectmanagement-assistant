"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth/AuthContext";
import { WorkspaceProvider } from "@/lib/data/WorkspaceContext";
import { ToastProvider } from "@/lib/ui/ToastContext";
import { AppFrame } from "@/components/shell/AppFrame";
import { Logo } from "@/components/ui/Logo";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [user, loading, router]);

  if (loading || !user) {
    return (
      <div className="grid h-screen place-items-center bg-bg">
        <Logo size={36} className="animate-pulse-dot" />
      </div>
    );
  }

  return (
    <ToastProvider>
      <WorkspaceProvider>
        <AppFrame>{children}</AppFrame>
      </WorkspaceProvider>
    </ToastProvider>
  );
}
