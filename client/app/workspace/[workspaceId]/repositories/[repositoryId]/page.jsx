'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { Loader2, ArrowLeft } from 'lucide-react';
import RepositoryOverview from './components/RepositoryOverview';
import LatestCommit from './components/LatestCommit';
import RecentCommits from './components/RecentCommits';
import Contributors from './components/Contributors';
import Issues from './components/Issues';
import PullRequests from './components/PullRequests';
import Branches from './components/Branches';
import RepositoryActivity from './components/RepositoryActivity';
import RepositoryMetadata from './components/RepositoryMetadata';

import API_BASE from '../../../../../lib/api';
import { fetchWithTimeout } from '../../../../../lib/fetchWithTimeout';

export default function RepositoryDetailsPage({ params }) {
const { workspaceId, repositoryId } = params;
const { data: session } = useSession();
const token =
  session?.accessToken ||
  (typeof window !== 'undefined' ? localStorage.getItem('pulseops_token') : null);

const [data, setData] = useState(null);
const [loading, setLoading] = useState(true);
const [error, setError] = useState('');

const load = async () => {
  setLoading(true);
  setError('');
  try {
    const res = await fetchWithTimeout(`${API_BASE}/api/repositories/${repositoryId}`, {
      headers: { Authorization: `Bearer ${token}`, 'x-organization-id': workspaceId },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body?.message || `Failed to load repository (${res.status}).`);
    }
    setData(await res.json());
  } catch (err) {
    setError(err.message || 'Could not load repository intelligence.');
  } finally {
    setLoading(false);
  }
};

useEffect(() => {
  if (token && repositoryId) {
    load();
  } else {
    setLoading(false);
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [token, repositoryId]);

const backHref = `/workspace/${workspaceId}/repositories`;

if (loading) {
  return (
    <div className="flex justify-center py-24">
      <Loader2 className="h-8 w-8 animate-spin text-slate-300" />
    </div>
  );
}

if (error) {
  return (
    <div className="rounded-2xl border border-rose-200 bg-rose-50 p-10 text-center">
      <p className="text-sm font-medium text-rose-700">{error}</p>
      <div className="mt-5 flex items-center justify-center gap-3">
        <button
          type="button"
          onClick={load}
          className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-rose-700"
        >
          Retry
        </button>
        <Link
          href={`/workspace/${workspaceId}/integrations`}
          className="rounded-lg border border-rose-200 bg-white px-4 py-2 text-sm font-semibold text-rose-600 transition-colors hover:bg-rose-50"
        >
          Go to Integrations
        </Link>
      </div>
    </div>
  );
}

const repo = data?.repository || {};
const gh = data?.github || {};

return (
  <div className="mx-auto max-w-[1600px] space-y-6">
    {/* Page header */}
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <Link
          href={backHref}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 shadow-sm transition-colors hover:bg-slate-50 hover:text-slate-800"
          aria-label="Back to repositories"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
            {repo.name || gh?.detail?.name || 'Repository Intelligence'}
          </h1>
          <p className="text-sm text-slate-500">
            {repo.fullName || gh?.detail?.fullName || 'GitHub Repository'}
          </p>
        </div>
      </div>
      {repo && (
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${
            repo.private
              ? 'bg-rose-50 text-rose-700 ring-rose-600/20'
              : 'bg-emerald-50 text-emerald-700 ring-emerald-600/20'
          }`}
        >
          {repo.private ? 'Private' : 'Public'}
        </span>
      )}
    </div>

    {/* Main content area */}
    <>{!loading && !error ? (
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Overview + Stats row */}
        <div className="lg:col-span-12">
          <RepositoryOverview data={data} />
        </div>

        {/* Latest Commit */}
        <div className="lg:col-span-12">
          <LatestCommit data={data} />
        </div>

        {/* Recent Commits */}
        <div className="lg:col-span-12">
          <RecentCommits data={data} />
        </div>

        {/* Contributors */}
        <div className="lg:col-span-12">
          <Contributors data={data} />
        </div>

        {/* Issues (section 8) */}
        <div className="lg:col-span-12">
          <Issues data={data} />
        </div>

        {/* Pull Requests */}
        <div className="lg:col-span-12">
          <PullRequests data={data} />
        </div>

        {/* Branches (best-effort section 6) */}
        <div className="lg:col-span-12">
          <Branches data={data} />
        </div>

        {/* Repository Activity (best-effort section 7) */}
        <div className="lg:col-span-12">
          <RepositoryActivity data={data} />
        </div>

        {/* Repository Metadata (best-effort section 9) */}
        <div className="lg:col-span-12">
          <RepositoryMetadata data={data} />
        </div>
      </div>
    ) : (
      <div className="col-span-full">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="lg:col-span-12">
            <LatestCommit data={{ github: { latest: null } }} />
          </div>
          <div className="lg:col-span-12">
            <RecentCommits data={{ github: { commits: [] } }} />
          </div>
          <div className="lg:col-span-12">
            <Contributors data={{ github: { contributors: [] } }} />
          </div>
          <div className="lg:col-span-12">
            <Issues data={{ github: { issues: [] } }} />
          </div>
          <div className="lg:col-span-12">
            <PullRequests data={{ github: { recent: [], open: 0, merged: 0, closed: 0 } }} />
          </div>
        </div>
      </div>
    )}</>

    {/* Report card removed — this page is 100% GitHub-focused */}
  </div>
);
}
