"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AtSign, Bell, CheckCheck, MessageSquare, UserPlus } from "lucide-react";
import { useAuth } from "@/lib/auth/AuthContext";
import { useWorkspace } from "@/lib/data/WorkspaceContext";
import {
  markAllNotificationsRead,
  markNotificationRead,
  watchNotifications,
} from "@/lib/data/firestore";
import { relativeTime } from "@/lib/date";
import type { Notification, NotificationKind } from "@/lib/types";
import { Avatar } from "@/components/ui/Avatar";
import { Dropdown } from "@/components/ui/Dropdown";
import { cn } from "@/lib/utils";

const ICON: Record<NotificationKind, typeof Bell> = {
  assigned: UserPlus,
  mentioned: AtSign,
  comment: MessageSquare,
  due_soon: Bell,
};

const VERB: Record<NotificationKind, string> = {
  assigned: "assigned you",
  mentioned: "mentioned you on",
  comment: "commented on",
  due_soon: "is due soon:",
};

/**
 * Unread work aimed at you. One document per recipient, so the count is a plain
 * query and marking one read never touches anyone else's.
 */
export function NotificationBell() {
  const { user } = useAuth();
  const { openWorkspaceProject } = useWorkspace();
  const router = useRouter();
  const [items, setItems] = useState<Notification[]>([]);

  useEffect(() => {
    if (!user) return;
    return watchNotifications(user.uid, setItems);
  }, [user]);

  const unread = useMemo(() => items.filter((n) => !n.read).length, [items]);

  const open = (n: Notification) => {
    if (!n.read) void markNotificationRead(n.id);
    openWorkspaceProject(n.workspaceId, n.projectId);
    router.push(`/?task=${n.taskId}`);
  };

  return (
    <Dropdown
      align="right"
      width={320}
      trigger={() => (
        <span
          className="relative grid h-7 w-7 shrink-0 place-items-center rounded-md text-text-faint transition-colors hover:bg-surface-2 hover:text-text"
          title={unread ? `${unread} unread` : "Notifications"}
        >
          <Bell className="h-4 w-4" />
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-[16px] place-items-center rounded-full bg-accent px-1 text-[9px] font-semibold text-accent-fg">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </span>
      )}
    >
      {(close) => (
        <div className="flex max-h-[70vh] flex-col">
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <span className="text-[13px] font-medium text-text">Notifications</span>
            {unread > 0 && <span className="mono text-2xs text-accent">{unread}</span>}
            {unread > 0 && (
              <button
                onClick={() => void markAllNotificationsRead(items)}
                className="ml-auto inline-flex items-center gap-1 text-2xs text-text-muted hover:text-text"
              >
                <CheckCheck className="h-3 w-3" /> Mark all read
              </button>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {items.length === 0 ? (
              <div className="px-3 py-8 text-center text-2xs text-text-faint">
                Nothing yet. You will hear when someone assigns you work or mentions you.
              </div>
            ) : (
              items.slice(0, 40).map((n) => {
                const Icon = ICON[n.kind];
                return (
                  <button
                    key={n.id}
                    onClick={() => {
                      open(n);
                      close();
                    }}
                    className={cn(
                      "flex w-full items-start gap-2.5 border-b border-border/60 px-3 py-2.5 text-left transition-colors last:border-b-0 hover:bg-surface-2",
                      !n.read && "bg-accent/[0.05]"
                    )}
                  >
                    <span className="relative mt-0.5 shrink-0">
                      <Avatar name={n.actorName} src={n.actorPhoto} size={22} />
                      <span className="absolute -bottom-0.5 -right-0.5 grid h-3.5 w-3.5 place-items-center rounded-full border border-surface bg-surface-2 text-text-muted">
                        <Icon className="h-2 w-2" />
                      </span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] leading-snug text-text">
                        <span className="font-medium">{n.actorName}</span>{" "}
                        <span className="text-text-muted">{VERB[n.kind]}</span>{" "}
                        <span className="text-text">{n.taskTitle}</span>
                      </span>
                      {n.detail && (
                        <span className="mt-0.5 block truncate text-2xs text-text-muted">
                          {n.detail}
                        </span>
                      )}
                      <span className="mono mt-0.5 block text-2xs text-text-faint">
                        {relativeTime(n.createdAt)}
                      </span>
                    </span>
                    {!n.read && <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </Dropdown>
  );
}
