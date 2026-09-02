'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Bell, GitBranch, MessageSquare, Ticket, BarChart, X, CheckCheck } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import API_BASE from '../../lib/api';
import { fetchWithTimeout } from '../../lib/fetchWithTimeout';

const SOURCE_ICON = {
  github:    GitBranch,
  jira:      Ticket,
  slack:     MessageSquare,
  analytics: BarChart,
};

const SOURCE_COLOUR = {
  github:    'text-slate-700 bg-slate-100',
  jira:      'text-blue-700 bg-blue-50',
  slack:     'text-purple-700 bg-purple-50',
  analytics: 'text-indigo-700 bg-indigo-50',
};

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function NotificationBell({ organizationId, role }) {
  const { data: session } = useSession();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const panelRef = useRef(null);

  // Resolve auth bearer
  let storedToken = null;
  try { storedToken = typeof window !== 'undefined' ? localStorage.getItem('pulseops_token') : null; } catch {}
  const bearer = session?.accessToken || storedToken;

  const authHeaders = bearer
    ? { Authorization: `Bearer ${bearer}`, 'x-organization-id': organizationId }
    : { 'x-organization-id': organizationId };

  // Viewers see an empty bell — no polling
  const isViewer = (role || '').toLowerCase() === 'viewer';

  // ---------------------------------------------------------------------------
  // Query: poll notifications every 15 s
  // ---------------------------------------------------------------------------
  const { data } = useQuery({
    queryKey: ['notifications', organizationId],
    queryFn: async () => {
      const res = await fetchWithTimeout(`${API_BASE}/api/notifications?limit=20`, { headers: authHeaders }, 10000);
      if (!res.ok) return { notifications: [], unreadCount: 0 };
      return res.json();
    },
    enabled: !!organizationId && !!bearer && !isViewer,
    refetchInterval: 15000,
    staleTime: 5000,
  });

  const notifications = data?.notifications || [];
  const unreadCount   = data?.unreadCount   || 0;

  // ---------------------------------------------------------------------------
  // Mutation: mark one read
  // ---------------------------------------------------------------------------
  const markOneMut = useMutation({
    mutationFn: async (id) => {
      await fetchWithTimeout(`${API_BASE}/api/notifications/${id}/read`, {
        method: 'POST',
        headers: authHeaders,
      }, 10000);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications', organizationId] }),
  });

  // ---------------------------------------------------------------------------
  // Mutation: mark all read
  // ---------------------------------------------------------------------------
  const markAllMut = useMutation({
    mutationFn: async () => {
      await fetchWithTimeout(`${API_BASE}/api/notifications/read-all`, {
        method: 'POST',
        headers: authHeaders,
      }, 10000);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications', organizationId] }),
  });

  // ---------------------------------------------------------------------------
  // Click a notification → mark read + navigate deep-link
  // ---------------------------------------------------------------------------
  const handleClick = useCallback((n) => {
    markOneMut.mutate(n._id);
    setOpen(false);
    if (n.link) router.push(n.link);
  }, [markOneMut, router]);

  // Close panel when clicking outside
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const badgeCount = Math.min(unreadCount, 99);

  return (
    <div ref={panelRef} className="relative">
      {/* Bell Button */}
      <button
        type="button"
        id="notification-bell-button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
        className="relative flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 dark:border-[#2F2F2F] bg-slate-50 dark:bg-[#191919] text-slate-600 dark:text-[#E9E9E7] shadow-2xs hover:bg-white dark:hover:bg-[#2A2A2A] hover:text-indigo-600 dark:hover:text-indigo-400 transition-all focus:outline-none focus:ring-2 focus:ring-indigo-500"
      >
        <Bell className="h-4 w-4" />
        {badgeCount > 0 && (
          <span
            className="absolute -top-1 -right-1 flex h-4.5 w-4.5 min-w-[18px] items-center justify-center rounded-full bg-rose-500 text-white text-[10px] font-extrabold leading-none px-1 shadow-sm"
            aria-hidden="true"
          >
            {badgeCount > 9 ? '9+' : badgeCount}
          </span>
        )}
      </button>

      {/* Notification Panel */}
      {open && (
        <div
          id="notification-panel"
          className="absolute right-0 mt-2 w-80 sm:w-96 rounded-2xl border border-slate-200/90 dark:border-[#2F2F2F] bg-white dark:bg-[#202020] shadow-xl z-50 overflow-hidden"
        >
          {/* Panel Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-[#2F2F2F] bg-slate-50/70 dark:bg-[#191919]">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-[#E9E9E7] flex items-center gap-1.5">
              <Bell className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" /> Notifications
              {unreadCount > 0 && (
                <span className="ml-1 rounded-full bg-rose-100 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 text-[10px] font-extrabold px-1.5 py-0.5">
                  {unreadCount} new
                </span>
              )}
            </span>
            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <button
                  id="mark-all-read-button"
                  type="button"
                  onClick={() => markAllMut.mutate()}
                  disabled={markAllMut.isPending}
                  className="flex items-center gap-1 text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 transition-colors disabled:opacity-50"
                  title="Mark all as read"
                >
                  <CheckCheck className="h-3.5 w-3.5" /> All read
                </button>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-slate-400 dark:text-[#6F6F6F] hover:text-slate-700 dark:hover:text-[#E9E9E7] transition-colors"
                aria-label="Close notifications"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Notification List */}
          <div className="max-h-80 overflow-y-auto divide-y divide-slate-100 dark:divide-[#2F2F2F]">
            {isViewer && (
              <div className="px-4 py-6 text-center text-sm text-slate-400 dark:text-[#9B9B9B]">
                No notifications for your role.
              </div>
            )}

            {!isViewer && notifications.length === 0 && (
              <div className="px-4 py-8 text-center">
                <Bell className="h-8 w-8 text-slate-200 dark:text-[#2F2F2F] mx-auto mb-2" />
                <p className="text-sm font-medium text-slate-500 dark:text-[#9B9B9B]">You&apos;re all caught up!</p>
                <p className="text-xs text-slate-400 dark:text-[#6F6F6F] mt-0.5">New GitHub, Jira &amp; Slack events will appear here.</p>
              </div>
            )}

            {!isViewer && notifications.map((n) => {
              const SourceIcon = SOURCE_ICON[n.source] || Bell;
              const iconCls = SOURCE_COLOUR[n.source] || 'text-slate-600 bg-slate-100';
              return (
                <button
                  key={n._id}
                  type="button"
                  id={`notification-item-${n._id}`}
                  onClick={() => handleClick(n)}
                  className={`w-full flex items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-indigo-50/50 ${
                    !n.read ? 'bg-indigo-50/30' : 'bg-white'
                  }`}
                >
                  {/* Source Icon */}
                  <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${iconCls}`}>
                    <SourceIcon className="h-3.5 w-3.5" />
                  </span>

                  {/* Text */}
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs leading-snug ${!n.read ? 'font-semibold text-slate-900' : 'font-medium text-slate-700'}`}>
                      {n.title}
                    </p>
                    {n.body && (
                      <p className="text-[11px] text-slate-500 mt-0.5 truncate">{n.body}</p>
                    )}
                    <p className="text-[10px] text-slate-400 mt-0.5">{timeAgo(n.createdAt)}</p>
                  </div>

                  {/* Unread dot */}
                  {!n.read && (
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-indigo-500" aria-label="Unread" />
                  )}
                </button>
              );
            })}
          </div>

          {/* Panel Footer */}
          {notifications.length > 0 && (
            <div className="px-4 py-2.5 border-t border-slate-100 text-center">
              <span className="text-[11px] text-slate-400 font-medium">Showing last 20 notifications</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
