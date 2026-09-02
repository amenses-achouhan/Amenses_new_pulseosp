'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { Loader2, Search, Calendar, User, Tag, AlertCircle, ExternalLink, RefreshCw } from 'lucide-react';

import API_BASE from '../../lib/api';
import { fetchWithTimeout } from '../../lib/fetchWithTimeout';

export default function JiraTaskList({ workspaceId }) {
  const { data: session } = useSession();
  const token =
    session?.accessToken ||
    (typeof window !== 'undefined' ? localStorage.getItem('pulseops_token') : null);

  const [issues, setIssues] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Filters & search
  const [search, setSearch] = useState('');
  const [selectedProject, setSelectedProject] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('');
  const [projects, setProjects] = useState([]);
  const [siteUrl, setSiteUrl] = useState('');

  const headers = {
    Authorization: `Bearer ${token}`,
    'x-organization-id': workspaceId,
  };

  // Fetch Jira status (to get siteUrl) and project list
  useEffect(() => {
    if (!token || !workspaceId) return;

    const fetchMeta = async () => {
      try {
        const [statusRes, projectsRes] = await Promise.all([
          fetchWithTimeout(`${API_BASE}/api/integrations/jira/status`, { headers }, 10000),
          fetchWithTimeout(`${API_BASE}/api/integrations/jira/projects`, { headers }, 10000),
        ]);

        if (statusRes.ok) {
          const sData = await statusRes.json();
          if (sData.siteUrl) setSiteUrl(sData.siteUrl);
        }

        if (projectsRes.ok) {
          const pData = await projectsRes.json();
          setProjects(Array.isArray(pData) ? pData : []);
        }
      } catch (err) {
        // non-blocking metadata load
      }
    };

    fetchMeta();
  }, [token, workspaceId]);

  // Fetch issues
  const fetchIssues = useCallback(async () => {
    if (!token || !workspaceId) return;
    setLoading(true);
    setError(null);

    try {
      let url = `${API_BASE}/api/integrations/jira/issues?limit=100`;
      if (selectedProject) url += `&projectKey=${encodeURIComponent(selectedProject)}`;
      if (selectedStatus) url += `&status=${encodeURIComponent(selectedStatus)}`;

      const res = await fetchWithTimeout(url, { headers }, 10000);
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data?.error || `Failed to fetch Jira issues (${res.status}).`);
        setIssues([]);
        setTotal(0);
      } else {
        setIssues(data.issues || []);
        setTotal(data.total || (data.issues || []).length);
      }
    } catch (err) {
      setError('Could not reach the server to load Jira tasks.');
    } finally {
      setLoading(false);
    }
  }, [token, workspaceId, selectedProject, selectedStatus]);

  useEffect(() => {
    fetchIssues();
  }, [fetchIssues]);

  // Client side search filtering across key, summary, assignee name
  const filteredIssues = issues.filter((issue) => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    const key = (issue.issueKey || '').toLowerCase();
    const summary = (issue.summary || '').toLowerCase();
    const assignee = (issue.assignee?.displayName || '').toLowerCase();
    const reporter = (issue.reporter?.displayName || '').toLowerCase();
    return key.includes(q) || summary.includes(q) || assignee.includes(q) || reporter.includes(q);
  });

  const formatDate = (dateStr) => {
    if (!dateStr) return '—';
    try {
      return new Date(dateStr).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    } catch {
      return dateStr;
    }
  };

  const getStatusBadgeClass = (status) => {
    const s = (status || '').toLowerCase();
    if (s.includes('done') || s.includes('complete') || s.includes('closed')) {
      return 'bg-emerald-50 text-emerald-700 ring-emerald-600/20';
    }
    if (s.includes('progress') || s.includes('review') || s.includes('doing')) {
      return 'bg-indigo-50 text-indigo-700 ring-indigo-600/20';
    }
    if (s.includes('block')) {
      return 'bg-rose-50 text-rose-700 ring-rose-600/20';
    }
    return 'bg-slate-100 text-slate-700 ring-slate-500/20';
  };

  return (
    <div className="space-y-6">
      {/* Search & Filter Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-[#6F6F6F]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by key, title, assignee..."
            className="w-full rounded-xl border border-slate-200 dark:border-[#2F2F2F] bg-white dark:bg-[#202020] pl-10 pr-4 py-2 text-sm text-slate-900 dark:text-[#E9E9E7] placeholder-slate-400 dark:placeholder-[#6F6F6F] outline-none shadow-sm transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {projects.length > 0 && (
            <select
              value={selectedProject}
              onChange={(e) => setSelectedProject(e.target.value)}
              className="rounded-xl border border-slate-200 dark:border-[#2F2F2F] bg-white dark:bg-[#202020] px-3 py-2 text-sm text-slate-700 dark:text-[#E9E9E7] shadow-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
            >
              <option value="" className="bg-white dark:bg-[#202020]">All Projects</option>
              {projects.map((p) => (
                <option key={p.key} value={p.key} className="bg-white dark:bg-[#202020]">
                  {p.key} — {p.name}
                </option>
              ))}
            </select>
          )}

          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            className="rounded-xl border border-slate-200 dark:border-[#2F2F2F] bg-white dark:bg-[#202020] px-3 py-2 text-sm text-slate-700 dark:text-[#E9E9E7] shadow-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
          >
            <option value="" className="bg-white dark:bg-[#202020]">All Statuses</option>
            <option value="To Do" className="bg-white dark:bg-[#202020]">To Do</option>
            <option value="In Progress" className="bg-white dark:bg-[#202020]">In Progress</option>
            <option value="Done" className="bg-white dark:bg-[#202020]">Done</option>
          </select>

          <button
            type="button"
            onClick={fetchIssues}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-[#2F2F2F] bg-white dark:bg-[#202020] px-3 py-2 text-sm font-medium text-slate-700 dark:text-[#E9E9E7] shadow-sm transition hover:bg-slate-50 dark:hover:bg-[#2A2A2A] disabled:opacity-50"
            title="Refresh issues"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Loading State */}
      {loading && (
        <div className="flex justify-center py-16">
          <div className="flex items-center gap-2 rounded-xl border border-slate-200 dark:border-[#2F2F2F] bg-white dark:bg-[#202020] px-6 py-4 text-sm text-slate-500 dark:text-[#9B9B9B] shadow-sm">
            <Loader2 className="h-5 w-5 animate-spin text-indigo-600 dark:text-indigo-400" />
            Loading Jira tasks…
          </div>
        </div>
      )}

      {/* Error State */}
      {error && !loading && (
        <div role="alert" className="rounded-xl border border-rose-200 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-950/30 p-4 text-sm text-rose-800 dark:text-rose-300 shadow-sm">
          <div className="flex items-center gap-2 font-semibold">
            <AlertCircle className="h-4 w-4" />
            Failed to load tasks
          </div>
          <p className="mt-1 text-xs text-rose-700 dark:text-rose-400">{error}</p>
        </div>
      )}

      {/* Empty State */}
      {!loading && !error && filteredIssues.length === 0 && (
        <div className="rounded-2xl border border-slate-200 dark:border-[#2F2F2F] bg-white dark:bg-[#202020] p-12 text-center shadow-sm">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100 dark:bg-[#191919] text-slate-400 dark:text-[#6F6F6F]">
            <Tag className="h-6 w-6" />
          </div>
          <h3 className="mt-4 text-base font-semibold text-slate-900 dark:text-[#E9E9E7]">No tasks found</h3>
          <p className="mt-1 text-sm text-slate-500 dark:text-[#9B9B9B]">
            {issues.length === 0
              ? 'No Jira issues have been synced for this workspace yet. Connect or sync Jira in Integrations.'
              : 'No issues match your active search or filters.'}
          </p>
        </div>
      )}

      {/* Issues List */}
      {!loading && !error && filteredIssues.length > 0 && (
        <div className="rounded-2xl border border-slate-200 dark:border-[#2F2F2F] bg-white dark:bg-[#202020] shadow-sm overflow-hidden divide-y divide-slate-100 dark:divide-[#2F2F2F]">
          {filteredIssues.map((issue) => (
            <div
              key={issue.jiraIssueId || issue._id || issue.issueKey}
              className="p-5 sm:p-6 transition hover:bg-slate-50/70 dark:hover:bg-[#2A2A2A] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
            >
              <div className="space-y-2 min-w-0 flex-1">
                <div className="flex items-center gap-2.5 flex-wrap">
                  {siteUrl ? (
                    <a
                      href={`${siteUrl.replace(/\/$/, '')}/browse/${issue.issueKey}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-mono text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:underline"
                    >
                      {issue.issueKey}
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  ) : (
                    <span className="font-mono text-xs font-bold text-indigo-600 dark:text-indigo-400">
                      {issue.issueKey}
                    </span>
                  )}

                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${getStatusBadgeClass(
                      issue.status
                    )}`}
                  >
                    {issue.status || 'To Do'}
                  </span>

                  {issue.issueType && (
                    <span className="inline-flex items-center rounded-full bg-slate-100 dark:bg-[#191919] px-2.5 py-0.5 text-xs font-medium text-slate-600 dark:text-[#9B9B9B]">
                      {issue.issueType}
                    </span>
                  )}

                  {issue.priority && (
                    <span className="inline-flex items-center rounded-full bg-amber-50 dark:bg-amber-950/40 px-2.5 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300 border border-amber-200/60 dark:border-amber-900/50">
                      {issue.priority}
                    </span>
                  )}

                  {issue.projectKey && (
                    <span className="text-xs text-slate-400 dark:text-[#6F6F6F] font-medium">
                      Project: {issue.projectKey}
                    </span>
                  )}
                </div>

                <h4 className="text-base font-semibold text-slate-900 dark:text-[#E9E9E7] truncate">
                  {issue.summary || 'No summary'}
                </h4>

                <div className="flex items-center gap-4 text-xs text-slate-500 dark:text-[#9B9B9B] flex-wrap pt-0.5">
                  {issue.assignee && (
                    <span className="flex items-center gap-1.5 text-slate-600 dark:text-[#E9E9E7] font-medium">
                      <User className="h-3.5 w-3.5 text-slate-400 dark:text-[#6F6F6F]" />
                      Assignee: {issue.assignee.displayName || issue.assignee.name || 'Unassigned'}
                    </span>
                  )}

                  {issue.reporter && (
                    <span className="flex items-center gap-1.5 text-slate-500 dark:text-[#9B9B9B]">
                      Reporter: {issue.reporter.displayName || issue.reporter.name}
                    </span>
                  )}

                  {issue.updated && (
                    <span className="flex items-center gap-1.5 text-slate-400 dark:text-[#6F6F6F]">
                      <Calendar className="h-3.5 w-3.5" />
                      Updated: {formatDate(issue.updated)}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
