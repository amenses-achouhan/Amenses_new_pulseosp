'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { ArrowLeft, RefreshCw, Loader2, MessageSquare } from 'lucide-react';
import MessageItem from './components/MessageItem';

import API_BASE from '../../../../../lib/api';

const SYNC_BADGE = {
  NOT_SYNCED: { label: 'Not synced', className: 'bg-slate-100 text-slate-600' },
  SYNCING: { label: 'Syncing…', className: 'bg-amber-50 text-amber-700' },
  SYNCED: { label: 'Synced', className: 'bg-emerald-50 text-emerald-700' },
  SYNC_ERROR: { label: 'Sync error', className: 'bg-rose-50 text-rose-700' },
};

export default function ChannelPage() {
  const params = useParams();
  const workspaceId = params?.workspaceId;
  const conversationId = params?.conversationId;
  const { data: session } = useSession();
  const token =
    session?.accessToken ||
    (typeof window !== 'undefined' ? localStorage.getItem('pulseops_token') : null);

  const [conversation, setConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState('');
  const [threadOpen, setThreadOpen] = useState({});
  const [threadReplies, setThreadReplies] = useState({});
  const [threadLoading, setThreadLoading] = useState({});
  const streamRef = useRef(null);

  const authHeaders = useMemo(
    () => ({ Authorization: `Bearer ${token}`, 'x-organization-id': workspaceId }),
    [token, workspaceId]
  );

  const load = useCallback(async (opts = {}) => {
    setLoading(true);
    setError('');
    try {
      const urls = [
        `${API_BASE}/api/workspace/${workspaceId}/slack/conversations/${conversationId}`,
        `${API_BASE}/api/workspace/${workspaceId}/slack/conversations/${conversationId}/messages`,
      ];
      const [convRes, msgRes] = await Promise.all(urls.map((u) => fetch(u, { headers: authHeaders })));
      if (!convRes.ok || !msgRes.ok) throw new Error('Failed to load conversation.');
      const [conv, msgs] = await Promise.all([convRes.json(), msgRes.json()]);
      setConversation(conv);
      setMessages(msgs.messages);
      setNextCursor(msgs.nextCursor);
      // eslint-disable-next-line no-empty
    } catch (err) {
      setError(err.message || 'Could not load conversation.');
    } finally {
      setLoading(false);
      if (opts.isOlder === true) setLoadingOlder(false);
    }
  }, [workspaceId, conversationId, authHeaders]);

  const loadOlder = async () => {
    if (!nextCursor || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const res = await fetch(
        `${API_BASE}/api/workspace/${workspaceId}/slack/conversations/${conversationId}/messages?before=${encodeURIComponent(nextCursor)}`,
        { headers: authHeaders }
      );
      if (!res.ok) throw new Error('Failed to load older messages.');
      const data = await res.json();
      setMessages((prev) => [...prev, ...data.messages.filter(
        (m) => !prev.some((p) => p.slackMessageTs === m.slackMessageTs)
      )]);
      setNextCursor(data.nextCursor);
    } catch (err) {
      // Non-fatal: keep current list.
      console.error('[channel] loadOlder:', err.message);
    } finally {
      setLoadingOlder(false);
    }
  };

  const toggleThread = async (ts) => {
    const next = { ...threadOpen, [ts]: !threadOpen[ts] };
    setThreadOpen(next);
    if (next[ts] && !threadReplies[ts]) {
      setThreadLoading((prev) => ({ ...prev, [ts]: true }));
      try {
        const res = await fetch(
          `${API_BASE}/api/workspace/${workspaceId}/slack/conversations/${conversationId}/messages?threadTs=${encodeURIComponent(ts)}&limit=100`,
          { headers: authHeaders }
        );
        if (res.ok) {
          const data = await res.json();
          setThreadReplies((prev) => ({ ...prev, [ts]: data.messages }));
        }
      } catch (err) {
        console.error('[channel] thread load failed:', err.message);
      } finally {
        setThreadLoading((prev) => ({ ...prev, [ts]: false }));
      }
    }
  };

  const upsertMessage = (incoming) => {
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.slackMessageTs === incoming.slackMessageTs);
      if (idx === -1) return [incoming, ...prev];
      const copy = [...prev];
      copy[idx] = { ...copy[idx], ...incoming };
      return copy;
    });
  };

  // Live SSE stream — new/edit/delete messages + attachment completion.
  useEffect(() => {
    if (!token || !workspaceId || !conversationId || typeof window === 'undefined' || !window.EventSource) return;
    const es = new EventSource(
      `${API_BASE}/api/workspace/${workspaceId}/slack/conversations/${conversationId}/stream?access_token=${encodeURIComponent(token)}`,
      { withCredentials: false }
    );

    es.addEventListener('new_slack_message', (e) => {
      try {
        const payload = JSON.parse(e.data);
        if (payload.message && payload.message.slackMessageTs) upsertMessage(payload.message);
      } catch { /* ignore malformed frames */ }
    });

    es.addEventListener('slack_message_updated', (e) => {
      try {
        const payload = JSON.parse(e.data);
        if (payload.message) upsertMessage(payload.message);
      } catch { /* ignore */ }
    });

    es.addEventListener('slack_message_deleted', (e) => {
      try {
        const payload = JSON.parse(e.data);
        setMessages((prev) =>
          prev.map((m) =>
            m.slackMessageTs === payload.messageId
              ? { ...m, deletedAt: m.deletedAt || new Date().toISOString() }
              : m
          )
        );
      } catch { /* ignore */ }
    });

    es.addEventListener('slack_attachment_ready', (e) => {
      try {
        const payload = JSON.parse(e.data);
        const fileId = payload.attachment?.id;
        const msgId = payload.attachment?.messageId;
        if (!fileId || !msgId) return;
        setMessages((prev) =>
          prev.map((m) => {
            if (m.slackMessageTs !== msgId) return m;
            const atts = m.attachments || [];
            const exists = atts.some((a) => a.id === fileId);
            return exists ? m : { ...m, attachments: [...atts, payload.attachment] };
          })
        );
      } catch { /* ignore */ }
    });

    streamRef.current = es;
    return () => es.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, workspaceId, conversationId]);

  useEffect(() => {
    if (token && conversationId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, conversationId]);

  const usersMap = useMemo(() => {
    const map = {};
    for (const m of messages) {
      if (m.author?.id && m.author?.name) map[m.author.id] = m.author.name;
    }
    return map;
  }, [messages]);

  if (loading && !conversation) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-slate-300" />
      </div>
    );
  }

  const badge = SYNC_BADGE[conversation?.syncStatus] || SYNC_BADGE.NOT_SYNCED;

  return (
    <div className="mx-auto flex h-[calc(100vh-4rem)] max-w-4xl flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-6 py-4">
        <div className="flex items-center gap-3">
          <Link
            href={`/workspace/${workspaceId}`}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 shadow-sm transition-colors hover:bg-slate-50 hover:text-slate-800"
            aria-label="Back to workspace"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="flex items-center gap-2 text-lg font-bold tracking-tight text-slate-900">
              <MessageSquare className="h-4 w-4 text-slate-400" />
              {conversation ? `# ${conversation.name || conversation.id}` : 'Conversation'}
            </h1>
            {conversation?.messageCount !== undefined && (
              <p className="text-xs text-slate-500">
                {conversation.messageCount} {conversation.messageCount === 1 ? 'message' : 'messages'}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {conversation && (
            <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${badge.className}`}>
              {badge.label}
            </span>
          )}
          <button
            type="button"
            onClick={() => load()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="mx-6 mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      <div className="flex-1 overflow-y-auto py-4">
        {!loading && messages.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <MessageSquare className="h-10 w-10 text-slate-200" />
            <p className="mt-3 text-sm font-medium text-slate-500">No messages yet.</p>
            <p className="mt-1 text-sm text-slate-400">
              {conversation?.syncStatus === 'SYNCED'
                ? 'This conversation has no accessible messages.'
                : 'Messages may still be syncing. Try Refresh in a moment.'}
            </p>
          </div>
        )}

        {messages.map((m) => (
          <MessageItem
            key={`${m.slackMessageTs}-${m.parentMessageId || ''}`}
            message={m}
            usersMap={usersMap}
            workspaceId={workspaceId}
            conversationId={conversationId}
            threadOpen={!!threadOpen[m.slackMessageTs]}
            onToggleThread={() => toggleThread(m.slackMessageTs)}
            replies={threadReplies[m.slackMessageTs] || []}
            repliesLoading={!!threadLoading[m.slackMessageTs]}
          />
        ))}

        {nextCursor && (
          <div className="flex justify-center py-4">
            <button
              type="button"
              onClick={loadOlder}
              disabled={loadingOlder}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 shadow-sm transition-colors hover:bg-slate-50 disabled:opacity-60"
            >
              {loadingOlder ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Load older messages
            </button>
          </div>
        )}
      </div>
    </div>
  );
}