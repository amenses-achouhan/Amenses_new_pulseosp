'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { Loader2, Check, Copy, Search, ChevronDown, ChevronUp } from 'lucide-react';

import API_BASE from '../../../../lib/api';
import { fetchWithTimeout } from '../../../../lib/fetchWithTimeout';

// --- Mini UI components ---

function IntegrationCard({ icon, title, description, badge, topActions, action }) {
  return (
    <div className="rounded-2xl border border-slate-200/80 dark:border-[#2F2F2F] bg-white dark:bg-[#202020] shadow-2xs overflow-hidden">
      <div className="p-6 sm:p-7">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-slate-100 dark:bg-[#191919] border border-slate-200/60 dark:border-[#2F2F2F] shadow-2xs">
              {icon}
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-bold text-slate-900 dark:text-[#E9E9E7] truncate">{title}</h3>
              <p className="text-sm text-slate-500 dark:text-[#9B9B9B] mt-0.5 truncate">{description}</p>
            </div>
          </div>
          <div className="shrink-0 flex items-center gap-3 self-end sm:self-auto">
            {badge}
            {topActions}
          </div>
        </div>
        {action && <div className="mt-6 border-t border-slate-100 dark:border-[#2F2F2F] pt-6">{action}</div>}
      </div>
    </div>
  );
}

function ConnectedBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
      <Check className="h-3.5 w-3.5" /> Connected
    </span>
  );
}

function DisableButton({ onClick, disabled, loading }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-2 rounded-lg border border-rose-300 bg-white px-4 py-2 text-sm font-medium text-rose-600 transition-colors hover:bg-rose-50 disabled:opacity-60"
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      Disable
    </button>
  );
}

// --- GitHub icon ---

function GitHubIcon() {
  return (
    <svg className="h-6 w-6 text-slate-700" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" />
    </svg>
  );
}

// --- Slack icon ---

function SlackIcon() {
  return (
    <svg className="h-6 w-6" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5.042 15.165a2.528 2.528 0 01-2.52 2.523A2.528 2.528 0 010 15.165a2.527 2.527 0 012.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 012.521-2.52 2.527 2.527 0 012.521 2.52v6.313A2.528 2.528 0 018.834 24a2.528 2.528 0 01-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 01-2.521-2.52A2.528 2.528 0 018.834 0a2.528 2.528 0 012.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 012.521 2.521 2.528 2.528 0 01-2.521 2.521H2.522A2.528 2.528 0 010 8.834a2.528 2.528 0 012.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 012.522-2.521A2.528 2.528 0 0124 8.834a2.528 2.528 0 01-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 01-2.523 2.521 2.527 2.527 0 01-2.52-2.521V2.522A2.527 2.527 0 0115.165 0a2.528 2.528 0 012.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 012.523 2.522A2.528 2.528 0 0115.165 24a2.527 2.527 0 01-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 01-2.52-2.523 2.526 2.526 0 012.52-2.52h6.313A2.527 2.527 0 0124 15.165a2.528 2.528 0 01-2.522 2.523h-6.313z" fill="#E01E5A" />
    </svg>
  );
}

// --- Jira icon ---

function JiraIcon() {
  return (
    <svg className="h-6 w-6" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M11.571 11.571L5.714 5.714 0 0h24L11.571 11.571z" fill="#2684FF" />
      <path d="M5.714 18.286L11.57 12.43 17.43 18.286 11.571 24z" fill="#2684FF" />
      <path d="M5.714 5.714L0 11.429l5.714 5.714L11.43 11.43z" fill="#2684FF" opacity=".7" />
    </svg>
  );
}

// --- GitHub Integration Panel ---

function GitHubPanel({ workspaceId, token }) {
  const [connecting, setConnecting] = useState(false);
  const [repos, setRepos] = useState([]);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [selectedRepos, setSelectedRepos] = useState([]);
  const [syncing, setSyncing] = useState(false);
  const [syncSuccess, setSyncSuccess] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [connectError, setConnectError] = useState('');
  const [disabling, setDisabling] = useState(false);
  const [search, setSearch] = useState('');

  const [showManageRepos, setShowManageRepos] = useState(false);

  const loadStatus = async () => {
    try {
      const res = await fetchWithTimeout(`${API_BASE}/api/integrations/github/status`, {
        headers: { Authorization: `Bearer ${token}`, 'x-organization-id': workspaceId },
      });
      if (res.ok) {
        const data = await res.json();
        if (data.connected) {
          setIsConnected(true);
          loadRepos();
        }
      }
    } catch {
      // Ignore network errors for status check to prevent red alerts
    }
  };

  useEffect(() => {
    if (!token) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('connected') === 'github') {
      setIsConnected(true);
      loadRepos();
      window.history.replaceState({}, '', window.location.pathname);
    } else {
      loadStatus();
    }
  }, [token]);

  const loadRepos = async () => {
    setLoadingRepos(true);
    setConnectError('');
    try {
      const res = await fetchWithTimeout(`${API_BASE}/api/integrations/github/repositories`, {
        headers: { Authorization: `Bearer ${token}`, 'x-organization-id': workspaceId },
      });
      if (res.ok) {
        const data = await res.json();
        setRepos(data);
      } else {
        const data = await res.json();
        setConnectError(data?.error || 'Failed to load repositories.');
      }
    } catch {
      setConnectError('Could not load repositories from GitHub.');
    } finally {
      setLoadingRepos(false);
    }
  };

  const handleConnect = async () => {
    setConnecting(true);
    setConnectError('');
    try {
      const res = await fetchWithTimeout(`${API_BASE}/api/integrations/github/connect`, {
        headers: { Authorization: `Bearer ${token}`, 'x-organization-id': workspaceId },
      });
      const data = await res.json();
      if (data.url) {
        // The server already sets the correct redirect_uri via getGithubCallbackUrl()
        // (resolves to BACKEND_API_URL / ngrok URL). Do NOT override with localhost.
        const urlObj = new URL(data.url);
        urlObj.searchParams.set('prompt', 'select_account');
        window.location.href = urlObj.toString();
      } else {
        setConnectError(data.error || 'Could not initiate GitHub connection.');
        setConnecting(false);
      }
    } catch {
      setConnectError('Could not reach the server.');
      setConnecting(false);
    }
  };

  const handleDisable = async () => {
    setDisabling(true);
    setConnectError('');
    try {
      const res = await fetchWithTimeout(`${API_BASE}/api/integrations/github/disable`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'x-organization-id': workspaceId },
      });
      if (res.ok) {
        setIsConnected(false);
        setRepos([]);
        setSelectedRepos([]);
        setSyncSuccess(null);
        setShowManageRepos(false);
      } else {
        const data = await res.json().catch(() => ({}));
        setConnectError(data?.error || 'Could not disable GitHub.');
      }
    } catch {
      setConnectError('Could not reach the server.');
    } finally {
      setDisabling(false);
    }
  };

  const toggleRepo = (id) =>
    setSelectedRepos((prev) => (prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id]));

  const handleSync = async () => {
    if (selectedRepos.length === 0) return;
    const importedIds = [...selectedRepos];
    setSyncing(true);
    try {
      const res = await fetchWithTimeout(`${API_BASE}/api/integrations/track-repositories`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'x-organization-id': workspaceId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ repositoryIds: importedIds }),
      });
      if (res.ok) {
        setRepos((prev) => prev.filter((repo) => !importedIds.includes(repo.id)));
        setSelectedRepos([]);
        const noun = importedIds.length === 1 ? 'repository' : 'repositories';
        setSyncSuccess(`Synced ${importedIds.length} ${noun} successfully.`);
      }
    } catch {
      /* swallow */
    } finally {
      setSyncing(false);
    }
  };

  const filteredRepos = repos.filter((repo) =>
    (repo.full_name || repo.name || '')
      .toLowerCase()
      .includes(search.trim().toLowerCase())
  );

  return (
    <IntegrationCard
      icon={<GitHubIcon />}
      title="GitHub"
      description="Sync repositories and track pull requests automatically."
      badge={isConnected ? <ConnectedBadge /> : undefined}
      topActions={
        isConnected ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowManageRepos(!showManageRepos)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 transition-colors"
            >
              {showManageRepos ? <ChevronUp className="h-3.5 w-3.5 text-slate-400" /> : <ChevronDown className="h-3.5 w-3.5 text-slate-400" />}
              <span>{showManageRepos ? 'Hide Repositories' : 'Manage Repositories'}</span>
            </button>
            <DisableButton onClick={handleDisable} disabled={disabling} loading={disabling} />
          </div>
        ) : undefined
      }
      action={
        !isConnected ? (
          <div className="space-y-3">
            {connectError && (
              <p className="text-sm text-rose-600">{connectError}</p>
            )}
            <button
              onClick={handleConnect}
              disabled={connecting}
              className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white shadow-2xs transition-colors hover:bg-slate-800 disabled:opacity-60"
            >
              {connecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitHubIcon />}
              Connect GitHub
            </button>
          </div>
        ) : showManageRepos ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-slate-900">Select repositories to track</h4>
              <button
                onClick={loadRepos}
                className="text-xs text-indigo-600 hover:underline"
              >
                Refresh list
              </button>
            </div>
            {connectError && <p className="text-sm text-rose-600">{connectError}</p>}
            {loadingRepos ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin text-slate-300" />
              </div>
            ) : (
              <>
                {syncSuccess && (
                  <div className="rounded-xl bg-emerald-50 border border-emerald-100 p-3.5 text-xs font-medium text-emerald-800">
                    ✓ {syncSuccess}
                  </div>
                )}
                <div className="space-y-3">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                    <input
                      type="text"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search repositories..."
                      className="w-full rounded-xl border border-slate-200/80 bg-white pl-9 pr-3 py-2 text-sm text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                    />
                  </div>
                  <div className="rounded-xl border border-slate-200/80 divide-y divide-slate-100 overflow-hidden max-h-48 overflow-y-auto bg-white">
                    {filteredRepos.length === 0 && (
                      <p className="p-4 text-sm text-slate-400">No repositories found.</p>
                    )}
                    {filteredRepos.map((repo) => (
                      <label
                        key={repo.id}
                        className="flex cursor-pointer items-center gap-4 px-4 py-3 hover:bg-slate-50 transition-colors"
                      >
                        <input
                          type="checkbox"
                          checked={selectedRepos.includes(repo.id)}
                          onChange={() => toggleRepo(repo.id)}
                          className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-900 truncate flex items-center gap-2">
                            {repo.full_name || repo.name}
                            {repo.private && (
                              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">Private</span>
                            )}
                          </p>
                          <p className="text-xs text-slate-500 mt-0.5">
                            Updated {repo.updated_at ? new Date(repo.updated_at).toLocaleDateString() : '—'}
                          </p>
                        </div>
                      </label>
                    ))}
                  </div>
                  <div className="flex items-center justify-end">
                    <button
                      onClick={handleSync}
                      disabled={selectedRepos.length === 0 || syncing}
                      className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-2xs transition-colors hover:bg-indigo-700 disabled:opacity-60"
                    >
                      {syncing && <Loader2 className="h-4 w-4 animate-spin" />}
                      Import Selected ({selectedRepos.length})
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        ) : null
      }
    />
  );
}

// --- Slack Integration Panel ---
// Phase 3: OAuth connect + status + test message + conversation sync + disable

function SlackPanel({ workspaceId, token }) {
  const [statusLoading, setStatusLoading] = useState(true);
  const [isConnected, setIsConnected] = useState(false);
  const [teamName, setTeamName] = useState('');
  const [channelName, setChannelName] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState('');
  const [disabling, setDisabling] = useState(false);
  const [disableError, setDisableError] = useState(null);
  const [status, setStatus] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [convLoading, setConvLoading] = useState(false);

  const headers = { Authorization: `Bearer ${token}`, 'x-organization-id': workspaceId };

  const loadStatus = async () => {
    if (!token) return;
    setStatusLoading(true);
    try {
      const res = await fetchWithTimeout(`${API_BASE}/api/integrations/slack/status`, { headers });
      if (res.ok) {
        const data = await res.json();
        setIsConnected(Boolean(data.connected));
        setTeamName(data.teamName || '');
        setChannelName(data.channelName || '');
        setStatus(data);
      }
    } catch {
      // Ignore network errors for status check
    } finally {
      setStatusLoading(false);
    }
  };

  const loadConversations = async () => {
    if (!token) return null;
    setConvLoading(true);
    try {
      const res = await fetchWithTimeout(`${API_BASE}/api/workspace/${workspaceId}/slack/conversations`, { headers });
      if (res.ok) {
        const data = await res.json();
        const all = [
          ...(data.publicChannels || []),
          ...(data.privateChannels || []),
          ...(data.groupDMs || []),
          ...(data.directMessages || []),
        ];
        setConversations(all);
        return all;
      }
    } catch {
      // keep existing list
    } finally {
      setConvLoading(false);
    }
    return null;
  };

  useEffect(() => {
    if (!token) {
      setStatusLoading(false);
      return;
    }
    const params = new URLSearchParams(window.location.search);
    if (params.get('connected') === 'slack') {
      window.history.replaceState({}, '', window.location.pathname);
    }
    loadStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (isConnected && token) {
      loadConversations();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, token]);

  const handleConnect = async () => {
    setConnecting(true);
    setConnectError('');
    try {
      const res = await fetchWithTimeout(`${API_BASE}/api/integrations/slack/authorize`, { headers });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        setConnectError(data.error || 'Could not initiate Slack connection.');
        setConnecting(false);
      }
    } catch {
      setConnectError('Could not reach the server.');
      setConnecting(false);
    }
  };

  const handleDisable = async () => {
    setDisabling(true);
    setDisableError(null);
    try {
      const res = await fetchWithTimeout(`${API_BASE}/api/integrations/slack/disable`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'x-organization-id': workspaceId },
      });
      if (res.ok) {
        setIsConnected(false);
        setTeamName('');
        setChannelName('');
        setConversations([]);
        setStatus(null);
      } else {
        const data = await res.json().catch(() => ({}));
        setDisableError(data?.error || 'Could not disable Slack.');
      }
    } catch {
      setDisableError('Could not reach the server.');
    } finally {
      setDisabling(false);
    }
  };

  const badge = isConnected
    ? status && status.scopesHealthy === false ? (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700 ring-1 ring-inset ring-amber-600/20">
        <Loader2 className="h-3 w-3" /> Scopes outdated
      </span>
    ) : (
      <ConnectedBadge />
    )
    : undefined;

  return (
    <IntegrationCard
      icon={<SlackIcon />}
      title="Slack"
      description="Mirror Slack conversations into PulseOps and keep them synchronized in real time."
      badge={badge}
      topActions={
        isConnected ? (
          <div className="flex items-center gap-2">
            {disableError && <p className="text-xs text-rose-600">{disableError}</p>}
            <DisableButton onClick={handleDisable} disabled={disabling} loading={disabling} />
          </div>
        ) : undefined
      }
      action={
        statusLoading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-6 w-6 animate-spin text-slate-300" />
          </div>
        ) : !isConnected ? (
          <div className="space-y-3">
            {connectError && (
              <p className="text-sm text-rose-600">{connectError}</p>
            )}

            <button
              onClick={handleConnect}
              disabled={connecting}
              className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white"
            >
              {connecting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <SlackIcon />
              )}
              Connect Slack
            </button>
          </div>
        ) : status?.authError ? (
          <p className="text-xs font-medium text-rose-600">
            Authorization warning: {status.authError}
          </p>
        ) : status?.scopesHealthy === false ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3.5">
            <p className="text-xs font-bold text-amber-800">
              Permissions need updating.
            </p>

            <p className="mt-0.5 text-xs text-amber-700">
              Missing: {status.missingScopes?.join(', ') || 'unknown'}.
              Reconnect Slack to grant scopes.
            </p>

            <button
              type="button"
              onClick={handleConnect}
              disabled={connecting}
              className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-amber-700 disabled:opacity-60"
            >
              {connecting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <SlackIcon />
              )}
              Reconnect Slack
            </button>
          </div>
        ) : null
      }
    />
  );
}
// --- Jira Integration Panel ---

function JiraPanel({ workspaceId, token }) {
  const [statusLoading, setStatusLoading] = useState(true);
  const [isConnected, setIsConnected] = useState(false);
  const [siteUrl, setSiteUrl] = useState('');
  const [cloudId, setCloudId] = useState('');
  const [lastSyncAt, setLastSyncAt] = useState(null);
  const [webhookRegistered, setWebhookRegistered] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState('');
  const [disabling, setDisabling] = useState(false);
  const [disableMsg, setDisableMsg] = useState(null);

  // Projects
  const [projects, setProjects] = useState([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [selectedProjectKey, setSelectedProjectKey] = useState('');
  const [projectsError, setProjectsError] = useState('');

  // Jira status (full status response — contains syncStates[])
  const [status, setStatus] = useState(null);

  // Sync
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);

  // Webhook
  const [webhookRegistering, setWebhookRegistering] = useState(false);
  const [webhookResult, setWebhookResult] = useState(null);
  const [webhookVerified, setWebhookVerified] = useState(false);

  const headers = { Authorization: `Bearer ${token}`, 'x-organization-id': workspaceId };
  const [webhookUrl, setWebhookUrl] = useState(
    process.env.NEXT_PUBLIC_API_URL
      ? `${process.env.NEXT_PUBLIC_API_URL.replace(/\/$/, '')}/api/webhooks/jira`
      : ''
  );

  const loadStatus = async () => {
    if (!token) return;
    setStatusLoading(true);
    try {
      const res = await fetchWithTimeout(`${API_BASE}/api/integrations/jira/status`, { headers });
      if (res.ok) {
        const data = await res.json();
        setIsConnected(Boolean(data.connected));
        setSiteUrl(data.siteUrl || '');
        setCloudId(data.cloudId || '');
        setLastSyncAt(data.lastSyncAt || null);
        setWebhookRegistered(Boolean(data.webhookRegistered));
        if (data.webhookUrl) setWebhookUrl(data.webhookUrl);
        // Store full status so syncStates polling works
        setStatus(data);
      }
    } catch {
      // Ignore network errors for status check
    } finally {
      setStatusLoading(false);
    }
  };

  const loadProjects = async () => {
    if (!token || !isConnected) return;
    setProjectsLoading(true);
    setProjectsError('');
    try {
      const res = await fetchWithTimeout(`${API_BASE}/api/integrations/jira/projects`, { headers });
      if (res.ok) {
        const data = await res.json();
        setProjects(data);
      } else {
        const data = await res.json().catch(() => ({}));
        setProjectsError(data.error || 'Failed to load projects.');
      }
    } catch {
      setProjectsError('Could not reach the server.');
    } finally {
      setProjectsLoading(false);
    }
  };

  useEffect(() => {
    if (!token) {
      setStatusLoading(false);
      return;
    }
    const params = new URLSearchParams(window.location.search);
    if (params.get('connected') === 'jira') {
      window.history.replaceState({}, '', window.location.pathname);
    }
    loadStatus();
  }, [token]);

  useEffect(() => {
    if (isConnected) {
      loadProjects();
    }
  }, [isConnected]);

  useEffect(() => {
    // Poll status every 3s while any project is syncing
    let intervalId;
    if (status?.syncStates?.some(s => s.status === 'syncing')) {
      intervalId = setInterval(() => {
        loadStatus();
      }, 3000);
    }
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  // When the polled status transitions from 'syncing' -> 'synced'/'error',
  // resolve the syncResult with the real persisted issuesSynced count.
  useEffect(() => {
    if (!syncing || !selectedProjectKey) return;
    const currentSyncState = status?.syncStates?.find(s => s.projectKey === selectedProjectKey);
    if (!currentSyncState) return;
    if (currentSyncState.status === 'synced') {
      const count = typeof currentSyncState.issuesSynced === 'number' ? currentSyncState.issuesSynced : 0;
      setSyncResult({ ok: true, message: `Synced ${count} issues from ${selectedProjectKey}.`, synced: count });
      setSyncing(false);
    } else if (currentSyncState.status === 'error') {
      setSyncResult({ ok: false, message: currentSyncState.lastError || 'Jira issue sync failed.' });
      setSyncing(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, syncing, selectedProjectKey]);

  const handleConnect = async () => {
    setConnecting(true);
    setConnectError('');
    try {
      const res = await fetchWithTimeout(`${API_BASE}/api/integrations/jira/auth`, { headers });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        setConnectError(data.error || 'Could not initiate Jira connection.');
        setConnecting(false);
      }
    } catch {
      setConnectError('Could not reach the server.');
      setConnecting(false);
    }
  };

  const handleDisable = async () => {
    setDisabling(true);
    setDisableMsg(null);
    try {
      const res = await fetchWithTimeout(`${API_BASE}/api/integrations/jira/disable`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'x-organization-id': workspaceId },
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setDisableMsg({
          ok: true,
          message: data?.message || 'Jira integration disabled.',
        });
        setIsConnected(false);
        setProjects([]);
        setSelectedProjectKey('');
      } else {
        setDisableMsg({ ok: false, message: data?.error || 'Could not disable Jira.' });
      }
    } catch {
      setDisableMsg({ ok: false, message: 'Could not reach the server.' });
    } finally {
      setDisabling(false);
    }
  };

  const handleSync = async () => {
    if (!selectedProjectKey) return;
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetchWithTimeout(`${API_BASE}/api/integrations/jira/sync`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectKey: selectedProjectKey }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        // Sync is async — the background worker writes to JiraSyncState.
        // Show "in progress" immediately; the polling useEffect below will
        // detect when status transitions to 'synced' and update the message.
        setSyncResult({ ok: null, message: `Syncing issues from ${data.projectKey || selectedProjectKey}…` });
        // Trigger an immediate status refresh so the polling useEffect activates
        loadStatus();
      } else {
        setSyncResult({ ok: false, message: data.error || 'Sync failed.' });
        setSyncing(false);
      }
    } catch {
      setSyncResult({ ok: false, message: 'Could not reach the server.' });
      setSyncing(false);
    }
    // Note: setSyncing(false) is intentionally NOT called on success here.
    // It will be called by the polling useEffect when the sync completes.
  };

  const handleRegisterWebhook = async () => {
    if (!selectedProjectKey) return;
    setWebhookRegistering(true);
    setWebhookResult(null);
    try {
      const res = await fetchWithTimeout(`${API_BASE}/api/integrations/jira/register-webhook`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectKey: selectedProjectKey }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        setWebhookResult({ ok: true, message: data.message || 'Webhook registered successfully.', webhookId: data.webhookId });
        setWebhookVerified(data.verified === true);
        setWebhookRegistered(true);
        if (data.webhookUrl) setWebhookUrl(data.webhookUrl);
        loadStatus();
      } else {
        setWebhookResult({ ok: false, message: data.error || 'Webhook registration failed.' });
      }
    } catch {
      setWebhookResult({ ok: false, message: 'Could not reach the server.' });
    } finally {
      setWebhookRegistering(false);
    }
  };

  const copyWebhookUrl = () => {
    navigator.clipboard.writeText(webhookUrl).then(() => { });
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '—';
    try {
      return new Date(dateStr).toLocaleString();
    } catch {
      return dateStr;
    }
  };

  const [showDetails, setShowDetails] = useState(false);

  const badge = isConnected
    ? (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
        <Check className="h-3 w-3" /> Connected
      </span>
    )
    : undefined;

  return (
    <IntegrationCard
      icon={<JiraIcon />}
      title="Jira"
      description="Sync Jira issues, track project progress, and receive real-time updates via webhooks."
      badge={badge}
      topActions={
        isConnected ? (
          <div className="flex items-center gap-2">
            {disableMsg && (
              <div
                role={disableMsg.ok ? 'status' : 'alert'}
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${disableMsg.ok
                  ? 'border-emerald-100 bg-emerald-50 text-emerald-800'
                  : 'border-rose-200 bg-rose-50 text-rose-700'
                  }`}
              >
                {disableMsg.message}
              </div>
            )}
            <DisableButton
              onClick={handleDisable}
              disabled={disabling || !token}
              loading={disabling}
            />
          </div>
        ) : undefined
      }
      action={
        !isConnected ? (
          <div className="space-y-3">
            {connectError && <p className="text-sm text-rose-600">{connectError}</p>}
            <button
              onClick={handleConnect}
              disabled={connecting}
              className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white shadow-2xs transition-colors hover:bg-slate-800 disabled:opacity-60"
            >
              {connecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <JiraIcon />}
              Connect Jira
            </button>

          </div>
        ) : showDetails ? (
            <>
              {/* Connected Info */}
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-slate-900">Site:</span>
                  <span className="truncate max-w-xs font-mono text-xs bg-white px-2 py-1 rounded border">{siteUrl}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-medium text-slate-900">Cloud ID:</span>
                  <span className="truncate max-w-xs font-mono text-xs bg-white px-2 py-1 rounded border">{cloudId}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-medium text-slate-900">Last Sync:</span>
                  <span>{formatDate(lastSyncAt)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-medium text-slate-900">Webhook:</span>
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${webhookRegistered ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                    {webhookRegistered ? 'Registered' : 'Not Registered'}
                  </span>
                </div>
              </div>

              {/* Projects Selection */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-slate-900">Select Project to Sync</h4>
                  <button
                    onClick={loadProjects}
                    disabled={projectsLoading}
                    className="text-xs text-indigo-600 hover:underline disabled:opacity-50"
                  >
                    {projectsLoading ? 'Loading...' : 'Refresh'}
                  </button>
                </div>
                {projectsError && <p className="text-sm text-rose-600">{projectsError}</p>}
                {projectsLoading ? (
                  <div className="flex justify-center py-4">
                    <Loader2 className="h-6 w-6 animate-spin text-slate-300" />
                  </div>
                ) : projects.length === 0 ? (
                  <p className="text-sm text-slate-500">No projects found or Jira not connected.</p>
                ) : (
                  <select
                    value={selectedProjectKey}
                    onChange={(e) => setSelectedProjectKey(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200"
                  >
                    <option value="">— Choose a project —</option>
                    {projects.map((p) => (
                      <option key={p.key} value={p.key}>
                        {p.key} — {p.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* Sync Section */}
              {selectedProjectKey && (
                <div className="space-y-3 rounded-lg border border-slate-200 p-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold text-slate-900">Sync Issues</h4>
                    {status?.syncStates?.find(s => s.projectKey === selectedProjectKey)?.status === 'syncing' && (
                      <span className="inline-flex items-center gap-1 text-xs text-amber-600 font-medium">
                        <Loader2 className="h-3 w-3 animate-spin" /> Syncing in background...
                      </span>
                    )}
                  </div>
                  {status?.syncStates?.find(s => s.projectKey === selectedProjectKey) && (() => {
                    const ss = status.syncStates.find(s => s.projectKey === selectedProjectKey);
                    const synced = typeof ss.issuesSynced === 'number' ? ss.issuesSynced : 0;
                    const failed = typeof ss.failedCount === 'number' ? ss.failedCount : 0;
                    return (
                      <div className="space-y-1 mb-2">
                        <div className="text-xs text-slate-500">
                          <span className="font-medium text-slate-700">{synced}</span> issues stored
                          {failed > 0 && (
                            <span className="text-rose-600 ml-1">· {failed} failed</span>
                          )}
                          {' · '}Status:{' '}
                          <span className={`font-medium capitalize ${
                            ss.status === 'synced' ? 'text-emerald-600'
                            : ss.status === 'error' ? 'text-rose-600'
                            : ss.status === 'syncing' ? 'text-amber-600'
                            : 'text-slate-700'
                          }`}>{ss.status}</span>
                        </div>
                        {/* Surface the real error — never leave user with just "Status: Error" */}
                        {ss.status === 'error' && ss.lastError && (
                          <p className="text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded px-2 py-1">
                            ⚠ {ss.lastError}
                          </p>
                        )}
                      </div>
                    );
                  })()}
                  {syncResult && (
                    <div
                      role={syncResult.ok === true ? 'status' : 'alert'}
                      className={`rounded-lg border px-4 py-2.5 text-xs font-medium ${
                        syncResult.ok === true
                          ? 'border-emerald-100 bg-emerald-50 text-emerald-700'
                          : syncResult.ok === null
                          ? 'border-amber-100 bg-amber-50 text-amber-700'
                          : 'border-rose-200 bg-rose-50 text-rose-700'
                      }`}
                    >
                      {syncResult.ok === true && `✓ ${syncResult.message}`}
                      {syncResult.ok === false && `⚠ ${syncResult.message}`}
                      {syncResult.ok === null && `⟳ ${syncResult.message}`}
                    </div>
                  )}
                  <button
                    onClick={handleSync}
                    disabled={syncing || !selectedProjectKey || status?.syncStates?.find(s => s.projectKey === selectedProjectKey)?.status === 'syncing'}
                    className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 disabled:opacity-60"
                  >
                    {(syncing || status?.syncStates?.find(s => s.projectKey === selectedProjectKey)?.status === 'syncing') ? <Loader2 className="h-4 w-4 animate-spin" /> : <Loader2 className="h-4 w-4" />}
                    {(syncing || status?.syncStates?.find(s => s.projectKey === selectedProjectKey)?.status === 'syncing') ? 'Syncing…' : 'Start Full Sync'}
                  </button>
                </div>
              )}

            {/* Webhook Registration */}
            {selectedProjectKey && (
              <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
                <h4 className="text-sm font-semibold text-slate-900">Webhook Registration</h4>
                <p className="text-xs text-slate-500">
                  Register a webhook in Jira to receive real-time updates when issues are created, updated, or deleted.
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 truncate rounded-lg bg-white px-3 py-2 text-xs text-slate-700 font-mono border border-slate-200">
                    {webhookUrl}
                  </code>
                  <button
                    onClick={copyWebhookUrl}
                    className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
                    title="Copy webhook URL"
                  >
                    <Copy className="h-3.5 w-3.5" /> Copy
                  </button>
                </div>
                {webhookResult && (
                  <div
                    role={webhookResult.ok ? 'status' : 'alert'}
                    className={`rounded-lg border px-4 py-2.5 text-xs font-medium ${webhookResult.ok ? 'border-emerald-100 bg-emerald-50 text-emerald-700' : 'border-rose-200 bg-rose-50 text-rose-700'}`}
                  >
                    {webhookResult.ok ? '✓ ' : '⚠ '}{webhookResult.message}
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleRegisterWebhook}
                    disabled={webhookRegistering || !selectedProjectKey || webhookRegistered}
                    className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-amber-700 disabled:opacity-60"
                  >
                    {webhookRegistering ? <Loader2 className="h-4 w-4 animate-spin" /> : <Loader2 className="h-4 w-4" />}
                    {webhookRegistering ? 'Registering…' : webhookRegistered ? 'Webhook Active' : 'Register Webhook'}
                  </button>
                  {webhookVerified && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                      <Check className="h-3 w-3" /> Verified
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-500">
                  Supported events: <code className="rounded bg-slate-100 px-1 py-0.5">jira:issue_created</code>, <code className="rounded bg-slate-100 px-1 py-0.5">jira:issue_updated</code>, <code className="rounded bg-slate-100 px-1 py-0.5">jira:issue_deleted</code>.
                </p>
              </div>
            )}


          </>
        ) : null
      }
    />
  );
}

// --- Page ---

export default function IntegrationsPage({ params }) {
  const { workspaceId } = params;
  const { data: session } = useSession();
  const token =
    session?.accessToken ||
    (typeof window !== 'undefined' ? localStorage.getItem('pulseops_token') : null);

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Integrations</h1>
        <p className="mt-1 text-sm text-slate-500">
          Connect third-party tools to automate your engineering workflow.
        </p>
      </div>

      <GitHubPanel workspaceId={workspaceId} token={token} />
      <SlackPanel workspaceId={workspaceId} token={token} />
      <JiraPanel workspaceId={workspaceId} token={token} />
    </div>
  );
}