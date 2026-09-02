'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import {
  GitBranch,
  MessageSquare,
  Users,
  Shield,
  Activity,
  Zap,
  FolderKanban,
  FileText,
  BarChart,
  Puzzle,
  ArrowUpRight,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  ExternalLink,
  ListTodo,
  Ticket,
  Plus,
} from 'lucide-react';
import { fetchDashboard } from './analyticsApi';
import CreateWorkspaceModal from './CreateWorkspaceModal';

import API_BASE from '../../lib/api';
import { fetchWithTimeout } from '../../lib/fetchWithTimeout';
const ME_ENDPOINT = `${API_BASE}/api/auth/me`;
const REPOS_ENDPOINT = `${API_BASE}/api/repositories`;
// Slack conversations endpoint requires workspaceId in the URL path;
// built dynamically inside the fetch call below.
const MEMBERS_ENDPOINT = `${API_BASE}/api/organizations/members`;
const GITHUB_STATUS_ENDPOINT = `${API_BASE}/api/integrations/github/status`;
const SLACK_STATUS_ENDPOINT = `${API_BASE}/api/integrations/slack/status`;
const JIRA_STATUS_ENDPOINT = `${API_BASE}/api/integrations/jira/status`;

export default function WorkspaceDashboard() {
  const { data: session, status } = useSession();
  const activeOrganizationId = session?.user?.activeOrganizationId || null;
  const workspaceId = activeOrganizationId;

  // Real Data States
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState(null);
  const [repositories, setRepositories] = useState([]);
  const [slackChannels, setSlackChannels] = useState([]);
  const [members, setMembers] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);
  const [analyticsError, setAnalyticsError] = useState(null);
  const [showCreateModal, setShowCreateModal] = useState(false);

  // Real Integration Statuses
  const [githubStatus, setGithubStatus] = useState({ connected: false, loading: true });
  const [slackStatus, setSlackStatus] = useState({ connected: false, loading: true });
  const [jiraStatus, setJiraStatus] = useState({ connected: false, loading: true });

  // Fetch all real data in parallel
  useEffect(() => {
    let cancelled = false;
    const storedToken = typeof window !== 'undefined' ? localStorage.getItem('pulseops_token') : null;
    const bearer = session?.accessToken || storedToken;
    if (!bearer || !workspaceId) return undefined;

    setLoading(true);
    setAnalyticsLoading(true);

    const headers = {
      Authorization: `Bearer ${bearer.trim()}`,
      'x-organization-id': workspaceId,
    };

    // 1. Fetch User / Org Me Data
    fetchWithTimeout(ME_ENDPOINT, { headers }, 10000)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d) setMe(d);
      })
      .catch(() => {});

    // 2. Fetch Connected Repositories
    fetchWithTimeout(REPOS_ENDPOINT, { headers }, 10000)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled) {
          if (Array.isArray(d)) setRepositories(d);
          else if (Array.isArray(d?.repositories)) setRepositories(d.repositories);
          else setRepositories([]);
        }
      })
      .catch(() => {
        if (!cancelled) setRepositories([]);
      });

    // 3. Fetch Slack Conversations (channels)
    fetchWithTimeout(`${API_BASE}/api/workspace/${workspaceId}/slack/conversations`, { headers }, 10000)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled) {
          if (Array.isArray(d?.conversations)) setSlackChannels(d.conversations);
          else setSlackChannels([]);
        }
      })
      .catch(() => {
        if (!cancelled) setSlackChannels([]);
      });

    // 4. Fetch Members
    fetch(MEMBERS_ENDPOINT, { headers })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && Array.isArray(d?.members)) {
          setMembers(d.members);
        }
      })
      .catch(() => {
        if (!cancelled) setMembers([]);
      });

    // 5. Fetch Real Analytics
    fetchDashboard(workspaceId, 7, bearer)
      .then((data) => {
        if (!cancelled) {
          setAnalytics(data);
          setAnalyticsError(null);
          setAnalyticsLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setAnalytics(null);
          setAnalyticsError(err?.message || 'Failed to load analytics.');
          setAnalyticsLoading(false);
        }
      });

    // 6. Fetch Integration Health Statuses
    fetch(GITHUB_STATUS_ENDPOINT, { headers })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled) setGithubStatus({ connected: !!d?.connected, loading: false });
      })
      .catch(() => {
        if (!cancelled) setGithubStatus({ connected: false, loading: false });
      });

    fetch(SLACK_STATUS_ENDPOINT, { headers })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled) setSlackStatus({ connected: !!d?.connected, loading: false });
      })
      .catch(() => {
        if (!cancelled) setSlackStatus({ connected: false, loading: false });
      });

    fetch(JIRA_STATUS_ENDPOINT, { headers })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled) setJiraStatus({ connected: !!d?.connected, loading: false });
      })
      .catch(() => {
        if (!cancelled) setJiraStatus({ connected: false, loading: false });
      });

    setLoading(false);

    return () => {
      cancelled = true;
    };
  }, [workspaceId, session?.accessToken]);

  const activeOrgName = me?.activeOrganization?.name || 'PulseOps Workspace';
  const privateRepos = repositories.filter((r) => r.private).length;
  const publicRepos = repositories.filter((r) => !r.private).length;

  const totalEvents = analytics?.totals
    ? (analytics.totals.prsMerged || 0) +
      (analytics.totals.prsOpened || 0) +
      (analytics.totals.pushes || 0) +
      (analytics.totals.slackMessages || 0) +
      (analytics.totals.jiraCreated || 0)
    : 0;

  const hasActivity = totalEvents > 0;

  if (status === 'loading') {
    return (
      <div className="flex h-96 items-center justify-center">
        <div className="flex items-center gap-3 rounded-2xl border border-slate-200/80 dark:border-[var(--border)] bg-white dark:bg-[var(--surface)] p-6 shadow-sm">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-indigo-200 border-t-indigo-600" />
          <span className="text-sm font-semibold text-slate-700 dark:text-[var(--text-primary)]">Loading workspace data…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* ------------ WELCOME HEADER ------------ */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200/80 dark:border-[var(--border)] pb-5">
        <div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-[var(--text-primary)] tracking-tight">
            {activeOrgName}
          </h1>
          <p className="text-sm text-slate-500 dark:text-[var(--text-secondary)] mt-1">
            Real-time engineering activity, integration status, and team analytics.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowCreateModal(true)}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-900 dark:bg-[var(--text-primary)] hover:bg-slate-800 dark:hover:bg-[var(--text-primary)]/80 text-white dark:text-[var(--surface)] text-xs font-semibold transition-all shadow-sm"
          >
            <Plus className="w-4 h-4" />
            <span>Create Workspace</span>
          </button>
          <Link
            href={`/workspace/${workspaceId}/repositories`}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border border-slate-200 dark:border-[var(--border)] bg-white dark:bg-[var(--surface)] hover:bg-slate-50 dark:hover:bg-[var(--surface-subtle)] text-slate-700 dark:text-[var(--text-primary)] text-xs font-semibold transition-all shadow-2xs"
          >
            <GitBranch className="w-4 h-4 text-slate-700 dark:text-[var(--text-secondary)]" />
            <span>Connect Repo</span>
          </Link>
          <Link
            href={`/workspace/${workspaceId}/integrations`}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border border-slate-200 dark:border-[var(--border)] bg-white dark:bg-[var(--surface)] hover:bg-slate-50 dark:hover:bg-[var(--surface-subtle)] text-slate-700 dark:text-[var(--text-primary)] text-xs font-semibold transition-all shadow-2xs"
          >
            <Puzzle className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
            <span>Integrations</span>
          </Link>
        </div>
      </div>

      {/* ------------ 1. KEY METRICS ROW (PULLING FROM REAL DATA ONLY) ------------ */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Metric 1: Repositories */}
        <div className="bg-white dark:bg-[var(--surface)] border border-slate-200/80 dark:border-[var(--border)] rounded-2xl p-5 shadow-2xs space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-[var(--text-secondary)] font-semibold uppercase tracking-wider">
            <span>Repositories</span>
            <div className="p-2 rounded-lg bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400">
              <GitBranch className="w-4 h-4" />
            </div>
          </div>
          <div className="text-3xl font-extrabold text-slate-900 dark:text-[var(--text-primary)] tracking-tight">
            {repositories.length}
          </div>
          <p className="text-xs text-slate-500 dark:text-[var(--text-secondary)] truncate pt-1">
            {repositories.length > 0
              ? `${privateRepos} Private · ${publicRepos} Public`
              : 'No repositories connected'}
          </p>
        </div>

        {/* Metric 2: Communication Channels */}
        <div className="bg-white dark:bg-[var(--surface)] border border-slate-200/80 dark:border-[var(--border)] rounded-2xl p-5 shadow-2xs space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-[var(--text-secondary)] font-semibold uppercase tracking-wider">
            <span>Channels</span>
            <div className="p-2 rounded-lg bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400">
              <MessageSquare className="w-4 h-4" />
            </div>
          </div>
          <div className="text-3xl font-extrabold text-slate-900 dark:text-[var(--text-primary)] tracking-tight">
            {slackChannels.length}
          </div>
          <p className="text-xs text-slate-500 dark:text-[var(--text-secondary)] truncate pt-1">
            {slackChannels.length > 0 ? 'Slack integration active' : 'No channels connected'}
          </p>
        </div>

        {/* Metric 3: Team Roster */}
        <div className="bg-white dark:bg-[var(--surface)] border border-slate-200/80 dark:border-[var(--border)] rounded-2xl p-5 shadow-2xs space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-[var(--text-secondary)] font-semibold uppercase tracking-wider">
            <span>Team Members</span>
            <div className="p-2 rounded-lg bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400">
              <Users className="w-4 h-4" />
            </div>
          </div>
          <div className="text-3xl font-extrabold text-slate-900 dark:text-[var(--text-primary)] tracking-tight">
            {members.length || 1}
          </div>
          <p className="text-xs text-slate-500 dark:text-[var(--text-secondary)] truncate pt-1">
            {members.length > 0 ? `${members.length} active member(s)` : '1 Active Member'}
          </p>
        </div>

        {/* Metric 4: Org Health Score */}
        <div className="bg-white dark:bg-[var(--surface)] border border-slate-200/80 dark:border-[var(--border)] rounded-2xl p-5 shadow-2xs space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-[var(--text-secondary)] font-semibold uppercase tracking-wider">
            <span>Health Score</span>
            <div className="p-2 rounded-lg bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400">
              <Shield className="w-4 h-4" />
            </div>
          </div>
          <div className="text-3xl font-extrabold text-indigo-600 dark:text-indigo-400 tracking-tight">
            {analyticsLoading ? '…' : analytics?.healthScore ?? '—'}
          </div>
          <p className="text-xs text-slate-500 dark:text-[var(--text-secondary)] truncate pt-1">
            {analytics?.healthLabel ? `Status: ${analytics.healthLabel}` : '7-day evaluation period'}
          </p>
        </div>
      </section>

      {/* ------------ 2. MAIN 2-COLUMN MATRIX ------------ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* ------------ LEFT COLUMN (65% Width): Real Analytics & Events ------------ */}
        <div className="lg:col-span-2 space-y-6">
          {/* Panel 1: Activity Overview (Real Data / Honest Empty State) */}
          <div className="bg-white dark:bg-[var(--surface)] border border-slate-200/80 dark:border-[var(--border)] rounded-2xl p-5 shadow-2xs space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-[var(--border)] pb-3">
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-[var(--text-primary)]">Workspace Activity & Velocity</h2>
                <p className="text-xs text-slate-500 dark:text-[var(--text-secondary)]">
                  Aggregated telemetry across commits, PRs, and Slack messages.
                </p>
              </div>
              <span className="text-xs font-bold text-slate-600 dark:text-[var(--text-secondary)] bg-slate-100 dark:bg-[var(--surface-subtle)] px-2.5 py-1 rounded-full">
                Last 7 Days
              </span>
            </div>

            {analyticsLoading ? (
              <div className="py-12 text-center text-sm text-slate-400 dark:text-[var(--text-muted)]">
                <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-indigo-600 dark:text-indigo-400" />
                Computing workspace activity metrics…
              </div>
            ) : hasActivity ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <div className="p-3.5 rounded-xl border border-slate-200/70 dark:border-[var(--border-subtle)] bg-slate-50/50 dark:bg-[var(--surface-subtle)] space-y-1">
                    <span className="text-xs font-bold text-slate-500 dark:text-[var(--text-secondary)] uppercase tracking-wider">PRs Merged</span>
                    <p className="text-2xl font-extrabold text-slate-900 dark:text-[var(--text-primary)]">{analytics.totals.prsMerged || 0}</p>
                  </div>
                  <div className="p-3.5 rounded-xl border border-slate-200/70 dark:border-[var(--border-subtle)] bg-slate-50/50 dark:bg-[var(--surface-subtle)] space-y-1">
                    <span className="text-xs font-bold text-slate-500 dark:text-[var(--text-secondary)] uppercase tracking-wider">PRs Opened</span>
                    <p className="text-2xl font-extrabold text-slate-900 dark:text-[var(--text-primary)]">{analytics.totals.prsOpened || 0}</p>
                  </div>
                  <div className="p-3.5 rounded-xl border border-slate-200/70 dark:border-[var(--border-subtle)] bg-slate-50/50 dark:bg-[var(--surface-subtle)] space-y-1">
                    <span className="text-xs font-bold text-slate-500 dark:text-[var(--text-secondary)] uppercase tracking-wider">Pushes</span>
                    <p className="text-2xl font-extrabold text-slate-900 dark:text-[var(--text-primary)]">{analytics.totals.pushes || 0}</p>
                  </div>
                  <div className="p-3.5 rounded-xl border border-slate-200/70 dark:border-[var(--border-subtle)] bg-slate-50/50 dark:bg-[var(--surface-subtle)] space-y-1">
                    <span className="text-xs font-bold text-slate-500 dark:text-[var(--text-secondary)] uppercase tracking-wider">Slack Messages</span>
                    <p className="text-2xl font-extrabold text-slate-900 dark:text-[var(--text-primary)]">{analytics.totals.slackMessages || 0}</p>
                  </div>
                  <div className="p-3.5 rounded-xl border border-slate-200/70 dark:border-[var(--border-subtle)] bg-slate-50/50 dark:bg-[var(--surface-subtle)] space-y-1">
                    <span className="text-xs font-bold text-slate-500 dark:text-[var(--text-secondary)] uppercase tracking-wider">Active Devs</span>
                    <p className="text-2xl font-extrabold text-slate-900 dark:text-[var(--text-primary)]">{analytics.totals.activeDevelopers || 0}</p>
                  </div>
                  <div className="p-3.5 rounded-xl border border-slate-200/70 dark:border-[var(--border-subtle)] bg-slate-50/50 dark:bg-[var(--surface-subtle)] space-y-1">
                    <span className="text-xs font-bold text-slate-500 dark:text-[var(--text-secondary)] uppercase tracking-wider">Jira Issues</span>
                    <p className="text-2xl font-extrabold text-slate-900 dark:text-[var(--text-primary)]">{analytics.totals.jiraCreated || 0}</p>
                  </div>
                </div>
              </div>
            ) : (
              /* Honest Empty State when no activity is recorded */
              <div className="py-10 px-4 rounded-xl border border-dashed border-slate-200 dark:border-[var(--border)] bg-slate-50/60 dark:bg-[var(--surface-subtle)] text-center space-y-3">
                <div className="w-10 h-10 rounded-full bg-slate-200/80 dark:bg-slate-700 flex items-center justify-center mx-auto text-slate-500 dark:text-[var(--text-secondary)]">
                  <Activity className="w-5 h-5" />
                </div>
                <div className="max-w-md mx-auto space-y-1">
                  <h3 className="text-sm font-bold text-slate-800 dark:text-[var(--text-primary)]">No activity recorded yet</h3>
                  <p className="text-xs text-slate-500 dark:text-[var(--text-secondary)] leading-relaxed">
                    Connect GitHub repositories, Slack channels, or Jira to automatically capture commits, pull requests, and communication events.
                  </p>
                </div>
                <Link
                  href={`/workspace/${workspaceId}/integrations`}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold transition-colors"
                >
                  <Puzzle className="w-3.5 h-3.5" />
                  <span>Configure Integrations</span>
                </Link>
              </div>
            )}

            {/* Quick Navigation Shortcuts */}
            <div className="pt-3 border-t border-slate-100 dark:border-[var(--border-subtle)] flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs font-bold text-slate-500 dark:text-[var(--text-secondary)] uppercase tracking-wider">Quick Navigation</span>
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`/workspace/${workspaceId}/repositories`}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-[var(--border)] bg-slate-50 hover:bg-white dark:bg-[var(--surface-subtle)] dark:hover:bg-[var(--surface)] text-xs font-semibold text-slate-700 dark:text-[var(--text-primary)] transition-colors"
                >
                  Repositories
                </Link>
                <Link
                  href={`/workspace/${workspaceId}/communication`}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-[var(--border)] bg-slate-50 hover:bg-white dark:bg-[var(--surface-subtle)] dark:hover:bg-[var(--surface)] text-xs font-semibold text-slate-700 dark:text-[var(--text-primary)] transition-colors"
                >
                  Communication
                </Link>
                <Link
                  href={`/workspace/${workspaceId}/integrations`}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-[var(--border)] bg-slate-50 hover:bg-white dark:bg-[var(--surface-subtle)] dark:hover:bg-[var(--surface)] text-xs font-semibold text-slate-700 dark:text-[var(--text-primary)] transition-colors"
                >
                  Integrations
                </Link>
                <Link
                  href={`/workspace/${workspaceId}/settings`}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-[var(--border)] bg-slate-50 hover:bg-white dark:bg-[var(--surface-subtle)] dark:hover:bg-[var(--surface)] text-xs font-semibold text-slate-700 dark:text-[var(--text-primary)] transition-colors"
                >
                  Settings
                </Link>
              </div>
            </div>
          </div>

          {/* Panel 2: Recent Team Contributions / Activity Timeline */}
          <div className="bg-white dark:bg-[var(--surface)] border border-slate-200/80 dark:border-[var(--border)] rounded-2xl p-5 shadow-2xs space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-[var(--border)] pb-3">
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-[var(--text-primary)]">Recent Developer Activity</h2>
                <p className="text-xs text-slate-500 dark:text-[var(--text-secondary)]">Real contributor events from connected services.</p>
              </div>
              <Link
                href={`/workspace/${workspaceId}/developers`}
                className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 flex items-center gap-1"
              >
                <span>View all</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </Link>
            </div>

            {analytics?.team && analytics.team.length > 0 ? (
              <ul className="space-y-2.5">
                {analytics.team.map((member) => (
                  <li
                    key={member.actor}
                    className="flex items-center justify-between p-3 rounded-xl border border-slate-200/70 dark:border-[var(--border-subtle)] bg-slate-50/50 dark:bg-[var(--surface-subtle)] text-xs"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 text-white font-bold flex items-center justify-center uppercase">
                        {String(member.actor)[0]}
                      </div>
                      <div>
                        <p className="font-bold text-slate-800 dark:text-[var(--text-primary)] capitalize">{member.actor}</p>
                        <p className="text-slate-500 dark:text-[var(--text-secondary)] text-[11px]">
                          {member.prsMerged} merged PRs · {member.issuesCompleted || 0} issues done · {member.total} total events
                        </p>
                      </div>
                    </div>
                    <span
                      className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                        member.status === 'Healthy'
                          ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                          : member.status === 'At Risk'
                          ? 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                          : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                      }`}
                    >
                      {member.status}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="py-8 text-center text-xs text-slate-400 dark:text-[var(--text-muted)] italic bg-slate-50/50 dark:bg-[var(--surface-subtle)] rounded-xl border border-slate-200/60 dark:border-[var(--border)]">
                No recent team contributions recorded in this period.
              </div>
            )}
          </div>
        </div>

        {/* ------------ RIGHT COLUMN (35% Width): Real Integration Health & Context ------------ */}
        <div className="space-y-6">
          {/* Panel 1: Integration Health Status */}
          <div className="bg-white dark:bg-[var(--surface)] border border-slate-200/80 dark:border-[var(--border)] rounded-2xl p-5 shadow-2xs space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-[var(--border)] pb-3">
              <h3 className="text-sm font-bold text-slate-900 dark:text-[var(--text-primary)]">Integration Health</h3>
              <span className="text-[10px] font-bold tracking-wider uppercase text-slate-400 dark:text-[var(--text-muted)]">Live Status</span>
            </div>

            <div className="space-y-2.5">
              {/* GitHub */}
              <div className="flex items-center justify-between p-3 rounded-xl border border-slate-200/70 dark:border-[var(--border-subtle)] bg-slate-50/60 dark:bg-[var(--surface-subtle)] text-xs">
                <div className="flex items-center gap-2.5 font-bold text-slate-800 dark:text-[var(--text-primary)]">
                  <GitBranch className="w-4 h-4 text-slate-700 dark:text-[var(--text-secondary)]" />
                  <span>GitHub</span>
                </div>
                {githubStatus.loading ? (
                  <span className="text-slate-400 dark:text-[var(--text-muted)] text-[11px]">Checking…</span>
                ) : githubStatus.connected ? (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 font-bold text-[10px] uppercase">
                    <CheckCircle2 className="w-3 h-3" /> Connected
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-[var(--text-muted)] font-semibold text-[10px] uppercase">
                    Not Connected
                  </span>
                )}
              </div>

              {/* Slack */}
              <div className="flex items-center justify-between p-3 rounded-xl border border-slate-200/70 dark:border-[var(--border-subtle)] bg-slate-50/60 dark:bg-[var(--surface-subtle)] text-xs">
                <div className="flex items-center gap-2.5 font-bold text-slate-800 dark:text-[var(--text-primary)]">
                  <MessageSquare className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  <span>Slack</span>
                </div>
                {slackStatus.loading ? (
                  <span className="text-slate-400 dark:text-[var(--text-muted)] text-[11px]">Checking…</span>
                ) : slackStatus.connected ? (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 font-bold text-[10px] uppercase">
                    <CheckCircle2 className="w-3 h-3" /> Connected
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-[var(--text-muted)] font-semibold text-[10px] uppercase">
                    Not Connected
                  </span>
                )}
              </div>

              {/* Jira */}
              <div className="flex items-center justify-between p-3 rounded-xl border border-slate-200/70 dark:border-[var(--border-subtle)] bg-slate-50/60 dark:bg-[var(--surface-subtle)] text-xs">
                <div className="flex items-center gap-2.5 font-bold text-slate-800 dark:text-[var(--text-primary)]">
                  <Ticket className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                  <span>Jira</span>
                </div>
                {jiraStatus.loading ? (
                  <span className="text-slate-400 dark:text-[var(--text-muted)] text-[11px]">Checking…</span>
                ) : jiraStatus.connected ? (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 font-bold text-[10px] uppercase">
                    <CheckCircle2 className="w-3 h-3" /> Connected
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-[var(--text-muted)] font-semibold text-[10px] uppercase">
                    Not Connected
                  </span>
                )}
              </div>
            </div>

            <div className="pt-2 border-t border-slate-100 dark:border-[var(--border)]">
              <Link
                href={`/workspace/${workspaceId}/integrations`}
                className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 flex items-center justify-between"
              >
                <span>Manage Integrations</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>

          {/* Panel 2: System Risks & Alerts (Real) */}
          <div className="bg-white dark:bg-[var(--surface)] border border-slate-200/80 dark:border-[var(--border)] rounded-2xl p-5 shadow-2xs space-y-3">
            <h3 className="text-sm font-bold text-slate-900 dark:text-[var(--text-primary)] border-b border-slate-100 dark:border-[var(--border)] pb-2">
              Risks & System Alerts
            </h3>
            {analytics?.risks && analytics.risks.length > 0 ? (
              <ul className="space-y-2">
                {analytics.risks.map((risk, idx) => (
                  <li
                    key={idx}
                    className="p-2.5 rounded-xl border border-amber-200/80 dark:border-amber-900/50 bg-amber-50/70 dark:bg-amber-900/20 text-xs text-amber-900 dark:text-amber-200 leading-relaxed flex items-start gap-2"
                  >
                    <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                    <span>{risk}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-slate-500 dark:text-[var(--text-secondary)] italic bg-slate-50 dark:bg-[var(--surface-subtle)] p-3 rounded-xl border border-slate-200/60 dark:border-[var(--border-subtle)]">
                No active system alerts for this period.
              </p>
            )}
          </div>

          {/* Panel 3: Workspace Metadata */}
          <div className="bg-white dark:bg-[var(--surface)] border border-slate-200/80 dark:border-[var(--border)] rounded-2xl p-5 shadow-2xs space-y-2 text-xs text-slate-500 dark:text-[var(--text-secondary)]">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-700 dark:text-[var(--text-primary)]">Workspace Context</span>
              <span className="font-mono text-[11px] text-slate-900 dark:text-[var(--text-primary)] bg-slate-100 dark:bg-[var(--surface-subtle)] px-2 py-0.5 rounded-md">
                {workspaceId ? `${workspaceId.slice(0, 8)}…` : '—'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-700 dark:text-[var(--text-primary)]">Data Isolation</span>
              <span className="text-emerald-700 dark:text-emerald-400 font-bold">100% Encrypted</span>
            </div>
          </div>
        </div>
      </div>

      <CreateWorkspaceModal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
      />
    </div>
  );
}