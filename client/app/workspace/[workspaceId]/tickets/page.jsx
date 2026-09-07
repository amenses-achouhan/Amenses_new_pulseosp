'use client';

import { useParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useQuery } from '@tanstack/react-query';
import { fetchDashboard } from '../../../_components/analyticsApi';
import JiraTaskList from '../../../_components/JiraTaskList';

export default function TicketsPage() {
  const params = useParams();
  const { data: session } = useSession();
  const organizationId = params?.workspaceId || session?.user?.activeOrganizationId;

  let stored = null;
  try { stored = typeof window !== 'undefined' ? localStorage.getItem('pulseops_token') : null; } catch {}
  const token = session?.accessToken || stored;

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['ticketsAnalytics', organizationId],
    queryFn: () => fetchDashboard(organizationId, 7, token),
    enabled: !!organizationId,
    staleTime: 15000,
  });

  const totals = data?.totals || {};
  const jiraTeam = (data?.team || []).filter((m) => (m.issuesCompleted || 0) > 0);

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-[#E9E9E7]">Tickets & Tasks</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-[#9B9B9B]">Jira issue flow and active task list.</p>
      </div>

      {isLoading && <p className="text-sm text-slate-500 dark:text-[#9B9B9B]">Loading tickets…</p>}
      {isError && (
        <p role="alert" className="rounded-xl border border-rose-200 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 text-sm text-rose-700 dark:text-rose-300">
          {error?.message || 'Could not load ticket analytics.'}
        </p>
      )}

      {!isLoading && !isError && (
        <>
          <dl className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-2xl border border-slate-200/80 dark:border-[#2F2F2F] bg-white dark:bg-[#202020] p-5 shadow-2xs">
              <dt className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-[#6F6F6F]">Issues Created</dt>
              <dd className="mt-1 text-3xl font-extrabold text-slate-900 dark:text-[#E9E9E7]">{totals.jiraCreated ?? 0}</dd>
            </div>
            <div className="rounded-2xl border border-slate-200/80 dark:border-[#2F2F2F] bg-white dark:bg-[#202020] p-5 shadow-2xs">
              <dt className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-[#6F6F6F]">Issues Completed</dt>
              <dd className="mt-1 text-3xl font-extrabold text-emerald-600 dark:text-emerald-400">{totals.jiraCompleted ?? 0}</dd>
            </div>
            <div className="rounded-2xl border border-slate-200/80 dark:border-[#2F2F2F] bg-white dark:bg-[#202020] p-5 shadow-2xs">
              <dt className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-[#6F6F6F]">Net Backlog</dt>
              <dd className={`mt-1 text-3xl font-extrabold ${(totals.jiraCreated - totals.jiraCompleted) > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-900 dark:text-[#E9E9E7]'}`}>
                {(totals.jiraCreated ?? 0) - (totals.jiraCompleted ?? 0)}
              </dd>
            </div>
          </dl>

          {(jiraTeam.length > 0) && (
            <p className="text-xs text-slate-500 dark:text-[#9B9B9B]">
              Completions this week by:{' '}
              {jiraTeam.map((m) => `${m.actor} (${m.issuesCompleted})`).join(', ')}
            </p>
          )}
        </>
      )}

      {/* Jira Tasks List */}
      <div className="pt-4 border-t border-slate-200 dark:border-[#2F2F2F]">
        <JiraTaskList workspaceId={organizationId} />
      </div>
    </div>
  );
}