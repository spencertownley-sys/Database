'use client';

/** The in-app notification centre: bell, unread badge, dropdown, mark-read. */

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { api, setWorkspaceId } from '@/lib/api';

export function NotificationBell(props: { workspaceId: string; workspaceSlug: string }) {
  setWorkspaceId(props.workspaceId);
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const queryKey = ['notifications', props.workspaceId];
  const { data } = useQuery({
    queryKey,
    queryFn: ({ signal }) => api.notifications.list({ limit: 15 }, signal),
    refetchInterval: 60_000,
  });

  const unread = data?.unreadCount ?? 0;
  const rows = data?.data ?? [];

  const markAllRead = async () => {
    await api.notifications.markRead({ all: true });
    void queryClient.invalidateQueries({ queryKey });
  };

  return (
    <div className="relative">
      <button
        type="button"
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-expanded={open}
        className="relative rounded p-1.5 hover:bg-[var(--color-muted)]"
        onClick={() => setOpen((v) => !v)}
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--color-danger)] px-1 text-[10px] font-semibold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          role="region"
          aria-label="Notifications"
          className="absolute right-0 top-8 z-50 w-80 rounded-[var(--radius-lg)] border bg-[var(--color-surface)] shadow-lg"
        >
          <div className="flex items-center justify-between border-b px-3 py-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
              Notifications
            </span>
            {unread > 0 && (
              <button
                type="button"
                className="text-xs underline underline-offset-2 hover:text-[var(--color-ink)]"
                onClick={() => void markAllRead()}
              >
                Mark all read
              </button>
            )}
          </div>
          <ul className="max-h-80 overflow-y-auto">
            {rows.length === 0 && (
              <li className="px-3 py-6 text-center text-xs text-[var(--color-ink-subtle)]">
                Nothing yet. Assignments, finished imports, and ready exports land here.
              </li>
            )}
            {rows.map((n) => {
              const inner = (
                <>
                  <p className={`text-sm ${n.readAt ? 'text-[var(--color-ink-muted)]' : 'font-medium'}`}>
                    {n.title}
                  </p>
                  {n.body && <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">{n.body}</p>}
                  <time className="mt-0.5 block text-[11px] text-[var(--color-ink-subtle)]" dateTime={n.createdAt}>
                    {new Date(n.createdAt).toLocaleString()}
                  </time>
                </>
              );
              return (
                <li key={n.id} className="border-b px-3 py-2 last:border-b-0">
                  {n.href ? (
                    <Link href={`/w/${props.workspaceSlug}${n.href}`} onClick={() => setOpen(false)}>
                      {inner}
                    </Link>
                  ) : (
                    inner
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
