'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { usePathname } from 'next/navigation';
import { Hash, Lock, Users, MessageSquare, RefreshCw } from 'lucide-react';

import API_BASE from '../../lib/api';
import { fetchWithTimeout } from '../../lib/fetchWithTimeout';

/**
 * Slack navigation section for the workspace sidebar.
 *
 * Loads accessible conversations from the PulseOps API (never hard-coded) and
 * groups them into Channels / Private / Group DMs / Direct messages. The
 * workspace-level SSE stream refreshes the section live when Slack sends
 * channel_rename / channel_archive / newly-discovered events.
 */
export default function SlackSidebarSection({ workspaceId }) {
  const { data: session } = useSession();
  const pathname = usePathname();
  const token = session?.accessToken || (typeof window !== 'undefined' && localStorage.getItem('pulseops_token'));

  const [groups, setGroups] = useState(null);
  const [connected, setConnected] = useState(false);

  const load = async () => {
    if (!token || !workspaceId) return;
    try {
      const res = await fetchWithTimeout(`${API_BASE}/api/workspace/${workspaceId}/slack/conversations`, {
        headers: { Authorization: `Bearer ${token}`, 'x-organization-id': workspaceId },
      }, 10000);
      if (!res.ok) {
        setConnected(false);
        setGroups(null);
        return;
      }
      const data = await res.json();
      setConnected(true);
      setGroups({
        publicChannels: data.publicChannels || [],
        privateChannels: data.privateChannels || [],
        groupDMs: data.groupDMs || [],
        directMessages: data.directMessages || [],
      });
    } catch {
      setConnected(false);
      setGroups(null);
    }
  };

  useEffect(() => {
    if (token && workspaceId) {
      load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, workspaceId]);

  // Live conversation metadata updates (rename/archive/discovery).
  useEffect(() => {
    if (!connected || typeof window === 'undefined' || !window.EventSource) return;
    const es = new EventSource(
      `${API_BASE}/api/workspace/${workspaceId}/slack/events?access_token=${encodeURIComponent(token)}`,
      { withCredentials: false }
    );
    es.addEventListener('slack_conversations_changed', load);
    es.addEventListener('error', () => {});
    return () => es.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, workspaceId, token]);

  if (!connected || !groups) return null;

  const base = `/workspace/${workspaceId}/channels`;
  const ConversationLink = ({ conversation }) => {
    const href = `${base}/${conversation.id}`;
    const active = pathname === href;
    const isDm = conversation.conversationType === 'DIRECT_MESSAGE';
    const isGroupDm = conversation.conversationType === 'GROUP_DM';
    return (
      <Link
        href={href}
        className={`flex items-center gap-2 rounded-xl px-3 py-2 text-[13px] font-medium transition-all ${
          active
            ? 'bg-indigo-50 text-indigo-700 font-bold'
            : 'text-slate-600 hover:bg-slate-100/70 hover:text-slate-900'
        }`}
      >
        {isDm ? (
          <MessageSquare className="h-3.5 w-3.5 shrink-0 text-slate-400" />
        ) : isGroupDm ? (
          <Users className="h-3.5 w-3.5 shrink-0 text-slate-400" />
        ) : conversation.isPrivate || conversation.conversationType === 'PRIVATE_CHANNEL' ? (
          <Lock className="h-3.5 w-3.5 shrink-0 text-slate-400" />
        ) : (
          <Hash className="h-3.5 w-3.5 shrink-0 text-slate-400" />
        )}
        <span className="truncate">
          {isDm || isGroupDm
            ? conversation.name || conversation.id
            : `# ${conversation.name || conversation.id}`}
        </span>
      </Link>
    );
  };

  const section = (label, list) => {
    if (!list || list.length === 0) return null;
    return (
      <div className="mt-3">
        <p className="px-3 text-[10px] font-bold uppercase tracking-wider text-slate-400">
          {label}
        </p>
        <div className="mt-1 space-y-0.5">
          {list.map((c) => (
            <ConversationLink key={c.id} conversation={c} />
          ))}
        </div>
      </div>
    );
  };

  const hasAnything =
    (groups.publicChannels?.length || 0) +
      (groups.privateChannels?.length || 0) +
      (groups.groupDMs?.length || 0) +
      (groups.directMessages?.length || 0) >
    0;

  if (!hasAnything) return null;

  return (
    <div className="mt-4 pt-3 border-t border-slate-100">
      <div className="flex items-center justify-between px-3">
        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Slack</p>
        <button
          type="button"
          onClick={load}
          className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          aria-label="Refresh Slack conversations"
        >
          <RefreshCw className="h-3 w-3" />
        </button>
      </div>
      {section('Channels', groups.publicChannels)}
      {section('Private', groups.privateChannels)}
      {section('Group Conversations', groups.groupDMs)}
      {section('Messages', groups.directMessages)}
    </div>
  );
}