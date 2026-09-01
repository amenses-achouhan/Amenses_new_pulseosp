'use client';

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { Printer, RefreshCw, FileText, AlertTriangle, CheckCircle2, User, Activity } from 'lucide-react';
import { fetchLatestSummary, generateSummary } from './aiSummaryApi';
import { fetchDashboard } from './analyticsApi';
import './AISummaryPanel.css';

import API_BASE from '../../lib/api';

export default function AISummaryPanel({ organizationId }) {
  const [error, setError] = useState(null);
  const queryClient = useQueryClient();
  const { data: session } = useSession();

  let storedToken = null;
  try { storedToken = typeof window !== 'undefined' ? localStorage.getItem('pulseops_token') : null; } catch {}
  const bearer = session?.accessToken || storedToken;

  // Query: latest AI summary report
  const {
    data: summary,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ['aiSummary', organizationId, bearer],
    queryFn: () => fetchLatestSummary(organizationId, bearer),
    enabled: !!organizationId && !!bearer,
    refetchInterval: 30000,
    staleTime: 10000,
  });

  // Query: workspace members to resolve top contributor IDs/emails to names
  const { data: membersData } = useQuery({
    queryKey: ['membersList', organizationId],
    queryFn: async () => {
      if (!bearer || !organizationId) return [];
      const res = await fetch(`${API_BASE}/api/organizations/members`, {
        headers: { Authorization: `Bearer ${bearer}`, 'x-organization-id': organizationId },
      });
      if (!res.ok) return [];
      const json = await res.json();
      return json?.members || [];
    },
    enabled: !!organizationId && !!bearer,
  });

  // Query: Phase 2 Analytics Dashboard to get identical Health Score & Trends
  const { data: analyticsData } = useQuery({
    queryKey: ['analyticsDashboardReport', organizationId],
    queryFn: () => fetchDashboard(organizationId, 7, bearer),
    enabled: !!organizationId,
    refetchInterval: 20000,
  });

  // Mutation: generate new summary
  const mutation = useMutation({
    mutationFn: () => generateSummary(organizationId, 'weekly', bearer),
    onMutate: () => setError(null),
    onSuccess: (newSummary) => {
      queryClient.setQueryData(['aiSummary', organizationId, bearer], newSummary);
      refetch();
    },
    onError: (err) => {
      setError(err.message || 'Failed to generate summary. Please try again.');
    },
  });

  const handleGenerate = () => mutation.mutate();
  const handleDismissError = () => setError(null);

  const handleExportPDF = () => {
    if (typeof window !== 'undefined') {
      window.print();
    }
  };

  const formatDate = (dateString) => {
    try {
      return new Date(dateString).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return dateString;
    }
  };

  if (isLoading) {
    return (
      <div className="ai-summary-panel loading">
        <div className="spinner-container">
          <div className="spinner"></div>
          <span>Loading engineering health summary...</span>
        </div>
      </div>
    );
  }

  const km = summary ? summary.key_metrics || summary.keyMetrics || {} : {};
  const metric = (camel, snake) => km[camel] ?? km[snake] ?? 0;
  const rawContributors = summary
    ? summary.top_contributors || summary.topContributors || []
    : [];
  const risksArr = summary ? summary.risks || [] : [];
  const recs = summary ? summary.recommendations || [] : [];

  // Resolve contributors to Name + Email + metrics
  const members = membersData || [];
  const resolvedContributors = rawContributors.map((c) => {
    const matched = members.find(
      (m) =>
        m.email?.toLowerCase() === c?.toLowerCase() ||
        m.name?.toLowerCase() === c?.toLowerCase() ||
        m.userId === c ||
        m._id === c
    );
    return {
      raw: c,
      name: matched?.name || matched?.email?.split('@')[0] || c,
      email: matched?.email || (c.includes('@') ? c : ''),
      role: matched?.role || 'Contributor',
    };
  });

  const healthScore = analyticsData?.healthScore ?? 75;
  const healthLabel = analyticsData?.healthLabel ?? 'Good';
  const scoreColor =
    healthScore >= 75 ? 'text-emerald-600' :
    healthScore >= 55 ? 'text-indigo-600' :
    healthScore >= 35 ? 'text-amber-600' : 'text-rose-600';

  return (
    <div className="ai-summary-panel space-y-6">
      {/* HEADER */}
      <div className="panel-header flex items-center justify-between">
        <div className="panel-title">
          <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <FileText className="h-5 w-5 text-indigo-600" /> Engineering Health Summary
          </h2>
          <span className="subtitle text-xs text-slate-500">AI-powered executive report</span>
        </div>
        <div className="flex items-center gap-3">
          {summary && (
            <button
              onClick={handleExportPDF}
              className="export-pdf-button inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 transition-all cursor-pointer"
              title="Export Report as PDF"
            >
              <Printer className="h-4 w-4 text-indigo-600" /> Export PDF
            </button>
          )}
          <button
            onClick={handleGenerate}
            disabled={mutation.isPending}
            className={`generate-button ${mutation.isPending ? 'loading' : ''}`}
          >
            {mutation.isPending ? (
              <>
                <span className="spinner-small"></span>
                Generating...
              </>
            ) : (
              '🔄 Generate Summary'
            )}
          </button>
        </div>
      </div>

      {/* ERROR STATE */}
      {error && (
        <div className="error-message">
          <div className="error-icon">🌐</div>
          <div className="error-text">{error}</div>
          <button onClick={handleDismissError} className="error-dismiss">
            Dismiss
          </button>
        </div>
      )}

      {/* EMPTY STATE */}
      {!summary && !isLoading && !error && (
        <div className="empty-state text-center p-8 bg-slate-50 rounded-2xl border border-slate-200">
          <div className="empty-icon text-3xl mb-2">📋</div>
          <h3 className="text-base font-bold text-slate-900">No Summary Generated Yet</h3>
          <p className="text-sm text-slate-500 mt-1">Click the &quot;Generate Summary&quot; button to create your first report.</p>
        </div>
      )}

      {/* REPORT CONTENT */}
      {summary && (
        <div className="summary-content space-y-6">
          {/* Meta Info + Identical Health Score Banner */}
          <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-2xl bg-slate-50 border border-slate-200">
            <div className="flex items-center gap-3">
              <span className="text-xs font-medium text-slate-600">📅 {formatDate(summary.generatedAt)}</span>
              <span className="badge bg-indigo-50 text-indigo-700 px-2.5 py-1 rounded-full text-xs font-bold">Weekly Report</span>
              <span className="badge secondary bg-slate-200 text-slate-700 px-2.5 py-1 rounded-full text-xs font-medium">AI Generated</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Org Health Score:</span>
              <span className={`text-xl font-extrabold ${scoreColor}`}>{healthScore}/100</span>
              <span className="text-xs font-bold text-slate-700 uppercase">({healthLabel})</span>
            </div>
          </div>

          {/* Executive Summary Prose */}
          <div className="summary-section summary-text p-5 rounded-2xl bg-indigo-50/50 border border-indigo-100">
            <h3 className="text-sm font-bold uppercase tracking-wide text-indigo-900 mb-2 flex items-center gap-2">
              <Activity className="h-4 w-4 text-indigo-600" /> Executive Summary
            </h3>
            <p className="text-sm leading-relaxed text-slate-800 font-normal">{summary.summary}</p>
          </div>

          {/* Key Metrics Stat Cards with Bar Visuals */}
          <div className="summary-section key-metrics">
            <h3 className="text-sm font-bold uppercase tracking-wide text-slate-700 mb-3">📊 Key Metrics Visual</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[
                ['PRs Merged', metric('prsMerged', 'prs_merged'), 'bg-indigo-600'],
                ['PRs Opened', metric('prsOpened', 'prs_opened'), 'bg-purple-600'],
                ['Active Developers', metric('activeDevelopers', 'active_developers'), 'bg-blue-600'],
                ['Jira Issues Done', metric('jiraIssuesCompleted', 'jira_issues_completed'), 'bg-emerald-600'],
                ['Jira Issues Created', metric('jiraIssuesCreated', 'jira_issues_created'), 'bg-amber-600'],
                ['Slack Messages', metric('slackMessages', 'slack_messages'), 'bg-slate-700'],
              ].map(([label, val, barBg]) => (
                <div key={label} className="metric-card rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs space-y-2">
                  <div className="flex justify-between items-center text-xs font-medium text-slate-500 uppercase tracking-wide">
                    <span>{label}</span>
                    <span className="font-bold text-slate-900 text-base">{val}</span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${barBg} transition-all duration-500`}
                      style={{ width: `${Math.min(100, Math.max(15, (Number(val) || 0) * 10))}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Severity-Colored Risks & Blockers */}
          {risksArr.length > 0 && (
            <div className="summary-section risks space-y-3">
              <h3 className="text-sm font-bold uppercase tracking-wide text-rose-900 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-rose-600" /> Risks &amp; Severity Alerts
              </h3>
              <div className="space-y-2.5">
                {risksArr.map((risk, idx) => {
                  const isCritical = risk.toLowerCase().includes('backlog') || risk.toLowerCase().includes('inactive');
                  const isWarning = risk.toLowerCase().includes('inflow') || risk.toLowerCase().includes('outpacing');
                  const cardStyle = isCritical
                    ? 'border-l-4 border-rose-500 bg-rose-50/80 text-rose-900'
                    : isWarning
                    ? 'border-l-4 border-amber-500 bg-amber-50/80 text-amber-900'
                    : 'border-l-4 border-emerald-500 bg-emerald-50/80 text-emerald-900';

                  return (
                    <div key={idx} className={`rounded-xl p-3.5 text-sm font-medium shadow-2xs ${cardStyle}`}>
                      <span className="mr-2">{isCritical ? '🔴' : isWarning ? '⚠️' : '🟢'}</span>
                      {risk}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Top Contributors Table */}
          {resolvedContributors.length > 0 && (
            <div className="summary-section contributors space-y-3">
              <h3 className="text-sm font-bold uppercase tracking-wide text-slate-800 flex items-center gap-2">
                <User className="h-4 w-4 text-indigo-600" /> Top Contributors
              </h3>
              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xs">
                <table className="w-full text-left text-sm border-collapse">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50 text-slate-500 text-xs font-semibold uppercase tracking-wider">
                      <th className="px-4 py-3">Contributor</th>
                      <th className="px-4 py-3">Email</th>
                      <th className="px-4 py-3">Role</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {resolvedContributors.map((c, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/50">
                        <td className="px-4 py-3 font-semibold text-slate-900 flex items-center gap-2.5">
                          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-indigo-100 text-indigo-700 font-bold text-xs">
                            {c.name.charAt(0).toUpperCase()}
                          </span>
                          {c.name}
                        </td>
                        <td className="px-4 py-3 text-slate-600 font-mono text-xs">{c.email || '—'}</td>
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700 capitalize">
                            {c.role}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Recommendations */}
          {recs.length > 0 && (
            <div className="summary-section recommendations space-y-3">
              <h3 className="text-sm font-bold uppercase tracking-wide text-emerald-900 flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" /> Actionable Recommendations
              </h3>
              <div className="space-y-2">
                {recs.map((rec, idx) => (
                  <div key={idx} className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3.5 text-sm text-emerald-900 font-medium">
                    ✅ {rec}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Footer */}
          <div className="summary-footer flex items-center justify-between pt-4 border-t border-slate-100">
            <button onClick={() => refetch()} className="refresh-button flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-800 cursor-pointer">
              <RefreshCw className="h-3.5 w-3.5" /> Refresh Data
            </button>
            <span className="summary-id text-xs text-slate-400 font-mono">
              Report ID: {summary._id ? summary._id.toString().slice(0, 8) : '—'}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}