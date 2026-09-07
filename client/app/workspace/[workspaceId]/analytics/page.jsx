'use client';

import { useParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useQuery } from '@tanstack/react-query';
import { fetchDashboard } from '../../../_components/analyticsApi';
import AnalyticsCards from '../../../_components/AnalyticsCards';

export default function AnalyticsPage() {
  const params = useParams();
  const { data: session } = useSession();
  const organizationId = params?.workspaceId || session?.user?.activeOrganizationId;

  let stored = null;
  try { stored = typeof window !== 'undefined' ? localStorage.getItem('pulseops_token') : null; } catch {}
  const token = session?.accessToken || stored;

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['analyticsOverview', organizationId],
    queryFn: () => fetchDashboard(organizationId, 7, token),
    enabled: !!organizationId,
    refetchInterval: 20000,
    staleTime: 10000,
  });

  const totals = data?.totals || {};

  return (
    <div className="max-w-6xl mx-auto space-y-8 p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-[#E9E9E7]">Workspace Analytics</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-[#9B9B9B]">
          Organization health metrics, KPIs, trends, and risk alerts across integrated platforms.
        </p>
      </div>

      {/* Main KPI Dashboard */}
      <AnalyticsCards organizationId={organizationId} />

      {/* Breakdown by source */}
      {!isLoading && !isError && (
        <div className="space-y-6 pt-4 border-t border-slate-200 dark:border-[#2F2F2F]">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-[#E9E9E7]">Integration Event Distribution</h2>
          <div className="space-y-3 rounded-2xl border border-slate-200 dark:border-[#2F2F2F] bg-white dark:bg-[#202020] p-5 shadow-sm">
            {[
              ['GitHub', (totals.prsMerged || 0) + (totals.prsOpened || 0) + (totals.prsClosed || 0) + (totals.pushes || 0)],
              ['Slack', totals.slackMessages || 0],
              ['Jira', (totals.jiraCreated || 0) + (totals.jiraCompleted || 0)],
            ].map(([label, n]) => {
              const max = Math.max(
                1,
                (totals.prsMerged || 0) + (totals.prsOpened || 0) + (totals.prsClosed || 0) + (totals.pushes || 0),
                totals.slackMessages || 0,
                (totals.jiraCreated || 0) + (totals.jiraCompleted || 0)
              );
              return (
                <div key={label}>
                  <div className="flex justify-between text-xs font-medium text-slate-600 dark:text-[#9B9B9B]">
                    <span>{label}</span>
                    <span>{n} events</span>
                  </div>
                  <div className="mt-1.5 h-2.5 w-full rounded-full bg-slate-100 dark:bg-[#2A2A2A]">
                    <div
                      className="h-2.5 rounded-full bg-gradient-to-r from-indigo-500 via-purple-500 to-blue-600 transition-all duration-500"
                      style={{ width: `${Math.round((n / max) * 100)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <dl className="grid gap-4 sm:grid-cols-3">
            {[
              ['PRs Merged', totals.prsMerged],
              ['PRs Opened', totals.prsOpened],
              ['PRs Closed', totals.prsClosed],
              ['Pushes', totals.pushes],
              ['Jira Created', totals.jiraCreated],
              ['Jira Completed', totals.jiraCompleted],
            ].map(([label, value]) => (
              <div key={label} className="rounded-2xl border border-slate-200 dark:border-[#2F2F2F] bg-white dark:bg-[#202020] p-4 shadow-sm">
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-[#6F6F6F]">{label}</dt>
                <dd className="mt-1 text-2xl font-bold text-slate-900 dark:text-[#E9E9E7]">{value ?? 0}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}