'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import {
  Loader2,
  RefreshCw,
  MessagesSquare,
  MessageSquare,
  X,
} from 'lucide-react';

import API_BASE from '../../../../lib/api';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Slack message `ts` is a float string of epoch seconds ("1620000000.0001"). */
function parseTs(ts) {
  const secs = parseFloat(String(ts));
  return Number.isFinite(secs) ? new Date(secs * 1000) : null;
}

function formatClock(ts) {
  const d = parseTs(ts);
  if (!d) return '';
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function formatDay(ts) {
  const d = parseTs(ts);
  if (!d) return '';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

function initials(name) {
  const parts = String(name || '?')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return '?';
  return (
    parts[0][0] +
    (parts.length > 1 && parts[parts.length - 1][0] ? parts[parts.length - 1][0] : '')
  ).toUpperCase();
}

const AVATAR_COLORS = [
  'bg-indigo-500',
  'bg-violet-500',
  'bg-emerald-500',
  'bg-sky-500',
  'bg-rose-500',
  'bg-amber-500',
  'bg-teal-500',
  'bg-cyan-500',
];

function colorFor(name) {
  let h = 0;
  const s = String(name || '?');
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

/**
 * Render Slack message text with clickable links. Kept minimal — does not try
 * to fully parse Slack mrkdwn; it makes URLs clickable and preserves newlines.
 */
function renderText(text) {
  const urlRe = /(https?:\/\/[^\s<]+)/g;
  const parts = String(text || '').split(urlRe);
  return parts.map((part, idx) =>
    urlRe.test(part) ? (
      <a
        key={idx}
        href={part}
        target="_blank"
        rel="noopener noreferrer"
        className="break-all text-indigo-600 underline decoration-indigo-300 underline-offset-2 hover:text-indigo-700"
      >
        {part}
      </a>
    ) : (
      <span key={idx}>{part}</span>
    )
  );
}

// ---------------------------------------------------------------------------
// Slack icon (matches the Integrations page)
// ---------------------------------------------------------------------------

function SlackIcon({ className }) {
  return (
    <svg className={className || 'h-4 w-4'} viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M5.042 15.165a2.528 2.528 0 01-2.52 2.523A2.528 2.528 0 010 15.165a2.527 2.527 0 012.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 012.521-2.52 2.527 2.527 0 012.521 2.52v6.313A2.528 2.528 0 018.834 24a2.528 2.528 0 01-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 01-2.521-2.52A2.528 2.528 0 018.834 0a2.528 2.528 0 012.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 012.521 2.521 2.528 2.528 0 01-2.521 2.521H2.522A2.528 2.528 0 010 8.834a2.528 2.528 0 012.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 012.522-2.521A2.528 2.528 0 0124 8.834a2.528 2.528 0 01-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 01-2.523 2.521 2.527 2.527 0 01-2.52-2.521V2.522A2.527 2.527 0 0115.165 0a2.528 2.528 0 012.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 012.523 2.522A2.528 2.528 0 0115.165 24a2.527 2.527 0 01-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 01-2.52-2.523 2.526 2.526 0 012.52-2.52h6.313A2.527 2.527 0 0124 15.165a2.528 2.528 0 01-2.522 2.523h-6.313z"
        fill="#E01E5A"
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Avatar
// ---------------------------------------------------------------------------

function Avatar({ name, url }) {
  if (url) {
    return (
      <img
        src={url}
        alt={name}
        className="mt-0.5 h-9 w-9 shrink-0 rounded-full object-cover"
      />
    );
  }
  return (
    <span
      className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white ${colorFor(name)}`}
      title={name}
    >
      {initials(name)}
    </span>
  );
}


// ---------------------------------------------------------------------------
// Slack uploaded-file card + inline preview
// ---------------------------------------------------------------------------

const FILE_STYLE = 'flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600';
const DOWNLOAD_STYLE = 'ml-auto shrink-0 text-indigo-600 hover:underline';

const IMAGE_RE = /image\//i;
const PDF_RE = /^application\/pdf\b/i;
const IMAGE_TYPES = /^(png|jpe?g|gif|webp|bmp|tiff?|heic|svg)$/i;
const PDF_TYPES = /^pdf$/i;
// Plain-text/markdown files are previewable too (rendered as raw text in a
// bounded, scrollable box — no Markdown dependency).
const TEXT_MIME = /^text\//i;
const TEXT_TYPES = /^(markdown|text|md|txt|log|json|xml|csv)$/i;

function isImageFile(file) {
  return IMAGE_RE.test(file.mimetype || '') || IMAGE_TYPES.test(file.filetype || '');
}
function isPdfFile(file) {
  return PDF_RE.test(file.mimetype || '') || PDF_TYPES.test(file.filetype || '');
}
function isTextFile(file) {
  return TEXT_MIME.test(file.mimetype || '') || TEXT_TYPES.test(file.filetype || '');
}

const FILE_ICON_BY_EXT = {
  pdf: '📕',
  doc: '📘',
  docx: '📘',
  xls: '📗',
  xlsx: '📗',
  ppt: '📙',
  pptx: '📙',
  zip: '📦',
  gz: '📦',
  'tar.gz': '📦',
  rar: '📦',
  csv: '📊',
  txt: '📄',
  md: '📄',
  json: '📄',
  xml: '📄',
  '7z': '📦',
};
const FILE_LABEL_BY_EXT = {
  pdf: 'PDF',
  doc: 'Word',
  docx: 'Word',
  xls: 'Excel',
  xlsx: 'Excel',
  ppt: 'PowerPoint',
  pptx: 'PowerPoint',
  zip: 'ZIP',
  gz: 'ZIP',
  rar: 'ZIP',
  csv: 'CSV',
  txt: 'Text',
  log: 'Log',
  md: 'Markdown',
  markdown: 'Markdown',
  text: 'Text',
  json: 'JSON',
  xml: 'XML',
};

/** One decision point for how a Slack file should render. */
function getFileType(file) {
  if (isImageFile(file)) return 'image';
  if (isPdfFile(file)) return 'pdf';
  if (isTextFile(file)) return 'text';
  return 'other';
}

function fileTypeLabel(file) {
  const type = getFileType(file);
  if (type === 'image') return 'Image';
  if (type === 'pdf') return 'PDF';
  if (type === 'text') {
    const ft = String(file.filetype || '').toLowerCase();
    const mn = String(file.mimetype || '').toLowerCase();
    const nm = String(file.name || '').toLowerCase();
    // Markdown files come through Slack as text/plain with filetype "markdown"
    // (or a .md/.markdown name). Label them as Markdown, not PLAIN.
    if (
      ft === 'markdown' ||
      /\.md$/.test(nm) ||
      /\.markdown$/.test(nm) ||
      mn === 'text/markdown'
    ) {
      return 'Markdown';
    }
    return 'Text';
  }
  // other: prefer the filetype/name lookup, then the mimetype subtype.
  const ext = String(file.filetype || file.name || '').toLowerCase();
  const label = FILE_LABEL_BY_EXT[ext];
  if (label) return label;
  if (file.mimetype && String(file.mimetype).includes('/')) {
    return String(file.mimetype).split('/')[1].toUpperCase();
  }
  return (file.filetype || 'File').toUpperCase();
}

function fileIcon(file) {
  const ext = String(file.filetype || file.name || '').toLowerCase();
  if (isImageFile(file)) return '🖼️';
  if (isPdfFile(file)) return FILE_ICON_BY_EXT.pdf;
  return FILE_ICON_BY_EXT[ext] || '📎';
}

function SlackFileAttachment({ file, token, workspaceId }) {
  const [blobSrc, setBlobSrc] = useState(null);
  const [previewText, setPreviewText] = useState(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const type = getFileType(file);
  const canPreview = type === 'image' || type === 'pdf' || type === 'text';
  const fileId = file.id;
  const proxyUrl = fileId ? `${API_BASE}/api/communication/files/${encodeURIComponent(fileId)}` : null;

  // Always fetch the actual file bytes THROUGH the PulseOps backend proxy using
  // the real Slack file id. The browser never authenticates against Slack's
  // private file URLs directly.
  useEffect(() => {
    if (!canPreview || !proxyUrl || !token || !workspaceId) return undefined;
    let objectUrl = null;
    let cancelled = false;
    setPreviewFailed(false);
    (async () => {
      try {
        const r = await fetch(proxyUrl, {
          headers: {
            Authorization: `Bearer ${token}`,
            'x-organization-id': workspaceId,
          },
        });
        if (!r.ok) {
          if (!cancelled) setPreviewFailed(true);
          return;
        }
        if (type === 'text') {
          const text = await r.text();
          if (cancelled) return;
          if (text && text.length > 0) setPreviewText(text);
          else setPreviewFailed(true);
        } else {
          const blob = await r.blob();
          if (cancelled || !blob || blob.size === 0) {
            if (!cancelled) setPreviewFailed(true);
            return;
          }
          objectUrl = URL.createObjectURL(blob);
          if (!cancelled) setBlobSrc(objectUrl);
        }
      } catch (err) {
        // Fall back to the plain file card if the preview can't be fetched.
        if (!cancelled) setPreviewFailed(true);
        console.warn('[communication] file preview failed:', err);
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [type, canPreview, proxyUrl, token, workspaceId]);

  const downloadHref = file.url_private_download || file.url_private;
  const name = file.name || file.title || 'Untitled';

  return (
    <div className={FILE_STYLE}>
      <span aria-hidden="true">{fileIcon(file)}</span>
      <span className="truncate font-medium text-slate-700">{name}</span>
      <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-slate-400">
        {fileTypeLabel(file)}
      </span>
      {downloadHref && (
        <a
          href={downloadHref}
          target="_blank"
          rel="noopener noreferrer"
          className={DOWNLOAD_STYLE}
        >
          Download
        </a>
      )}

      {canPreview && (blobSrc || previewText) && (
        <div className="basis-full mt-2 w-full">
          {type === 'image' && blobSrc ? (
            <a href={blobSrc} target="_blank" rel="noopener noreferrer" title="Open full size">
              <img
                src={blobSrc}
                alt={name}
                className="max-h-72 w-auto max-w-full rounded-md border border-slate-200"
              />
            </a>
          ) : type === 'pdf' && blobSrc ? (
            <iframe
              src={blobSrc}
              title={name}
              className="h-72 w-full rounded-md border border-slate-200"
            />
          ) : type === 'text' && previewText ? (
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border border-slate-200 bg-white p-3 font-mono text-xs leading-relaxed text-slate-700">
              {previewText.slice(0, 20000)}
              {previewText.length > 20000 ? '\n… (truncated)' : ''}
            </pre>
          ) : null}
        </div>
      )}

      {canPreview && previewFailed && (
        <div className="basis-full mt-1 text-[11px] text-slate-400">
          Preview unavailable
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single message row
// ---------------------------------------------------------------------------

function MessageRow({ message, onOpenThread, token, workspaceId }) {
  const hasThread = Number(message.replyCount) > 0;
  return (
    <div className="group flex gap-3.5 px-5 py-4 transition-colors hover:bg-slate-50/80">
      <Avatar name={message.userName} url={message.userAvatar} />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
          <span className="text-sm font-semibold text-slate-900">{message.userName}</span>
          <span className="text-xs text-slate-400">
            {formatDay(message.ts)} · {formatClock(message.ts)}
          </span>
        </div>

        <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-700">
          {renderText(message.text)}
        </p>

        {(message.files?.length > 0 || message.attachments?.length > 0) && (
          <div className="mt-2 space-y-1.5">
            {message.attachments?.map((att, i) => (
              <div
                key={i}
                className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600"
              >
                <SlackIcon />
                <span className="truncate">{att.title || att.text || 'Attachment'}</span>
                {att.title_link && (
                  <a
                    href={att.title_link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-auto shrink-0 text-indigo-600 hover:underline"
                  >
                    Open
                  </a>
                )}
              </div>
            ))}
            {message.files?.map((file, i) => (
              <SlackFileAttachment
                key={file.id || `f-${i}`}
                file={file}
                token={token}
                workspaceId={workspaceId}
              />
            ))}
          </div>
        )}


        {(message.reactions?.length > 0 || hasThread) && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {message.reactions?.map((r, i) => (
              <span
                key={`${r.name}-${i}`}
                className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-600"
                title={`${r.users?.length || 0} reaction(s)`}
              >
                <span aria-hidden="true">:{r.name}:</span>
                <span className="font-medium text-slate-700">{r.count}</span>
              </span>
            ))}
            {hasThread && (
              <button
                type="button"
                onClick={() => onOpenThread(message)}
                className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-indigo-600 transition-colors hover:border-indigo-200 hover:bg-indigo-50"
              >
                <MessageSquare className="h-3 w-3" />
                {message.replyCount} {message.replyCount === 1 ? 'reply' : 'replies'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Thread drawer (side panel) — keeps replies separate from the main timeline.
// ---------------------------------------------------------------------------

function ThreadDrawer({ channelName, thread, messages, loading, error, onClose, token, workspaceId }) {
  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-900/40 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Message thread"
      onClick={onClose}
    >
      <div
        className="flex h-full w-full max-w-md flex-col bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-slate-900">Thread</h3>
            <p className="truncate text-xs text-slate-500">
              {thread.userName} · {channelName && `${channelName} · `}
              {formatDay(thread.ts)} {formatClock(thread.ts)}
            </p>
          </div>
          <button
            type="button"
            aria-label="Close thread"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-slate-300" />
            </div>
          ) : error ? (
            <p className="px-5 py-8 text-center text-sm text-rose-600">{error}</p>
          ) : messages.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-slate-500">No replies yet.</p>
          ) : (
            <div className="py-2">
              {messages.map((m) => (
                <MessageRow key={m.id} message={m} onOpenThread={() => {}} token={token} workspaceId={workspaceId} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function CommunicationPage({ params }) {
  const { workspaceId } = params;
  const { data: session } = useSession();
  const token =
    session?.accessToken ||
    (typeof window !== 'undefined' ? localStorage.getItem('pulseops_token') : null);

  const [data, setData] = useState(null); // { connected, channelUnavailable, teamName, channelName, workspaceName, messages }
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(null);

  const [thread, setThread] = useState(null); // the top-level message being viewed
  const [threadMessages, setThreadMessages] = useState([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [threadError, setThreadError] = useState(null);

  const loadMessages = useCallback(
    async (opts = {}) => {
      const { silent } = opts;
      if (!token || !workspaceId) return;
      if (!silent) setLoading(true);
      setLoadError(null);
      try {
        const res = await fetch(`${API_BASE}/api/communication/messages`, {
          headers: { Authorization: `Bearer ${token}`, 'x-organization-id': workspaceId },
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(body?.error || `Failed to load messages (${res.status}).`);
        }
        setData(body);
      } catch (err) {
        setLoadError(err.message || 'Unable to load messages.');
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [token, workspaceId]
  );


  // Initial load + near-real-time polling (the codebase uses polling rather
  // than a websocket layer, so we reuse that pattern here).
  useEffect(() => {
    if (token && workspaceId) loadMessages();
  }, [token, workspaceId, loadMessages]);

  useEffect(() => {
    if (!token || !workspaceId) return undefined;
    const id = setInterval(() => {
      loadMessages({ silent: true }).catch(() => {});
    }, 20000);
    return () => clearInterval(id);
  }, [token, workspaceId, loadMessages]);

  const openThread = async (message) => {
    setThread(message);
    setThreadMessages([]);
    setThreadError(null);
    if (!message?.ts) return;
    setThreadLoading(true);
    try {
      const res = await fetch(
        `${API_BASE}/api/communication/messages/${encodeURIComponent(message.ts)}/thread`,
        { headers: { Authorization: `Bearer ${token}`, 'x-organization-id': workspaceId } }
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || 'Could not load thread.');
      setThreadMessages(Array.isArray(body?.messages) ? body.messages : []);
    } catch (err) {
      setThreadError(err.message || 'Could not load thread.');
    } finally {
      setThreadLoading(false);
    }
  };

  const refresh = async () => {
    setRefreshing(true);
    try {
      await loadMessages();
    } finally {
      setRefreshing(false);
    }
  };


  const connected = Boolean(data?.connected);
  const messages = (Array.isArray(data?.messages) ? data.messages : []).filter((m) => !m.bot);
  const channelLabel = data?.channelName ? `#${data.channelName.replace(/^#/, '')}` : null;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Communication</h1>
          <p className="mt-1 text-sm text-slate-500">
            Stay updated with conversations from your connected tools.
          </p>

          {data && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {connected ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
                  <SlackIcon className="h-3 w-3" />
                  {data.teamName || 'Slack'}
                  {channelLabel ? ` · ${channelLabel}` : ''}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-3 py-1 text-xs font-medium text-rose-700 ring-1 ring-inset ring-rose-600/20">
                  <SlackIcon className="h-3 w-3" /> Slack · Not connected
                </span>
              )}
              {data.workspaceName && (
                <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600 ring-1 ring-inset ring-slate-200">
                  Workspace: {data.workspaceName}
                </span>
              )}
            </div>
          )}
        </div>

        {connected && (
          <button
            type="button"
            onClick={refresh}
            disabled={refreshing}
            className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        )}
      </div>

      {/* Body */}
      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-center gap-3 px-6 py-20 text-sm text-slate-500">
            <Loader2 className="h-5 w-5 animate-spin text-slate-300" />
            Loading conversations…
          </div>
        </div>
      ) : loadError ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-10 text-center">
          <h2 className="text-base font-semibold text-rose-800">Unable to load messages</h2>
          <p className="mt-1 text-sm text-rose-700">We couldn&apos;t retrieve messages from Slack.</p>
          <button
            type="button"
            onClick={refresh}
            className="mt-5 inline-flex items-center gap-2 rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-rose-700"
          >
            Try again
          </button>
        </div>
      ) : !data ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500 shadow-sm">
          Loading…
        </div>
      ) : !connected ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center shadow-sm">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100">
            <SlackIcon className="h-6 w-6" />
          </div>
          <h2 className="mt-4 text-base font-semibold text-slate-900">Slack isn&apos;t connected</h2>
          <p className="mt-1 text-sm text-slate-500">
            Connect Slack to view communication from your team.
          </p>
          <Link
            href={`/workspace/${workspaceId}/integrations`}
            className="mt-6 inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-slate-700"
          >
            Connect Slack
          </Link>
        </div>
      ) : data.channelUnavailable ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center shadow-sm">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100">
            <SlackIcon className="h-6 w-6" />
          </div>
          <h2 className="mt-4 text-base font-semibold text-slate-900">Channel unavailable</h2>
          <p className="mt-1 text-sm text-slate-500">
            The connected Slack channel could not be accessed.
          </p>
          <Link
            href={`/workspace/${workspaceId}/integrations`}
            className="mt-6 inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-slate-700"
          >
            Reconnect Slack
          </Link>
        </div>
      ) : messages.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white px-6 py-16 text-center shadow-sm">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100">
            <MessagesSquare className="h-6 w-6 text-slate-500" />
          </div>
          <h2 className="mt-4 text-base font-semibold text-slate-900">No messages yet</h2>
          <p className="mt-1 text-sm text-slate-500">
            Messages from this connected channel will appear here.
          </p>
        </div>
      ) : (


        <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-2xs">
          <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/50 px-5 py-3.5">
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-md bg-rose-50 text-rose-600">
                <SlackIcon className="h-3.5 w-3.5" />
              </div>
              <span className="text-xs font-bold uppercase tracking-wider text-slate-700">
                {data.teamName || 'Slack'} {channelLabel ? `· ${channelLabel}` : ''}
              </span>
            </div>
            <span className="text-[11px] font-semibold text-slate-400">
              {messages.length} {messages.length === 1 ? 'message' : 'messages'}
            </span>
          </div>
          <div className="divide-y divide-slate-100/80">
            {messages.map((m, idx) => {
              const currentDay = formatDay(m.ts);
              const prevDay = idx > 0 ? formatDay(messages[idx - 1].ts) : null;
              const showDateDivider = currentDay && currentDay !== prevDay;

              return (
                <div key={m.id || m.ts}>
                  {showDateDivider && (
                    <div className="relative my-2 flex items-center justify-center px-4">
                      <div className="absolute inset-0 flex items-center px-4" aria-hidden="true">
                        <div className="w-full border-t border-slate-200/70" />
                      </div>
                      <div className="relative rounded-full border border-slate-200/80 bg-slate-50 px-3 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-500 shadow-2xs">
                        {currentDay}
                      </div>
                    </div>
                  )}
                  <MessageRow
                    message={m}
                    onOpenThread={openThread}
                    token={token}
                    workspaceId={workspaceId}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {thread && (
        <ThreadDrawer
          channelName={channelLabel}
          thread={thread}
          messages={threadMessages}
          loading={threadLoading}
          error={threadError}
          onClose={() => setThread(null)}
          token={token}
          workspaceId={workspaceId}
        />
      )}
    </div>
  );
}

