'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import AuthShell from '../_components/AuthShell';

import API_BASE from '../../lib/api';
import { fetchJSONWithTimeout } from '../../lib/fetchWithTimeout';

const ROLE_COLORS = {
  owner: { bg: 'bg-violet-100', text: 'text-violet-700', dot: 'bg-violet-500' },
  admin: { bg: 'bg-indigo-100', text: 'text-indigo-700', dot: 'bg-indigo-500' },
  maintainer: { bg: 'bg-sky-100', text: 'text-sky-700', dot: 'bg-sky-500' },
  developer: { bg: 'bg-emerald-100', text: 'text-emerald-700', dot: 'bg-emerald-500' },
  viewer: { bg: 'bg-amber-100', text: 'text-amber-700', dot: 'bg-amber-500' },
};

const roleColor = (role) =>
  ROLE_COLORS[role] || { bg: 'bg-slate-100', text: 'text-slate-600', dot: 'bg-slate-400' };

function WorkspaceCard({ workspace, onSelect, loading }) {
  const color = roleColor(workspace.role);
  const initials = workspace.name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();

  return (
    <button
      id={`ws-card-${workspace.id}`}
      type="button"
      onClick={() => onSelect(workspace)}
      disabled={loading}
      className="group relative flex w-full flex-col gap-3.5 rounded-xl border border-slate-200/80 bg-white p-5 text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-indigo-400/80 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-60"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-900 text-sm font-bold text-white shadow-sm group-hover:scale-105 transition-transform">
            {initials || '?'}
          </div>
          <div>
            <p className="text-sm font-bold text-slate-900 leading-tight">{workspace.name}</p>
            {workspace.slug && (
              <p className="text-xs text-slate-400 mt-0.5">/{workspace.slug}</p>
            )}
          </div>
        </div>

        <span
          className={`flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${color.bg} ${color.text}`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${color.dot}`} />
          {workspace.role.charAt(0).toUpperCase() + workspace.role.slice(1)}
        </span>
      </div>

      <div className="flex items-center justify-between pt-1">
        <span className="text-xs text-slate-500">Click to enter workspace</span>
        <span className="text-xs font-mono text-slate-400 group-hover:translate-x-0.5 transition-transform">→</span>
      </div>
    </button>
  );
}

function CardSkeleton() {
  return (
    <div className="flex w-full flex-col gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm animate-pulse">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-slate-200" />
          <div className="space-y-1.5">
            <div className="h-3.5 w-28 rounded bg-slate-200" />
            <div className="h-2.5 w-16 rounded bg-slate-100" />
          </div>
        </div>
        <div className="h-5 w-16 rounded-full bg-slate-200" />
      </div>
    </div>
  );
}

export default function SelectWorkspacePage() {
  const router = useRouter();
  const { data: session, status, update } = useSession();

  const [workspaces, setWorkspaces] = useState([]);
  const [switching, setSwitching] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (status === 'loading') return;
    if (status === 'unauthenticated') {
      router.replace('/login');
      return;
    }
    const wsList = session?.user?.workspaces;
    if (Array.isArray(wsList) && wsList.length > 0) {
      setWorkspaces(wsList);
    }
  }, [status, session, router]);

  const handleSelect = async (workspace) => {
    if (switching) return;
    setSwitching(workspace.id);
    setError(null);

    try {
      const token = (() => {
        try { return session?.accessToken || localStorage.getItem('pulseops_token'); } catch { return session?.accessToken || null; }
      })();

      const { data, res } = await fetchJSONWithTimeout(`${API_BASE}/api/organizations/switch-org`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ targetOrganizationId: workspace.id }),
      }, 10000);

      if (!res.ok) {
        setError(data?.message || `Could not switch workspace (${res.status}). Please try again.`);
        setSwitching(null);
        return;
      }

      if (data.token) {
        try { localStorage.setItem('pulseops_token', data.token); } catch { }
      }

      await update({
        accessToken: data.token || token,
        activeOrganizationId: workspace.id,
        role: data.role || workspace.role,
      });

      router.replace(`/workspace/${workspace.id}`);
    } catch {
      setError('Could not reach the server. Please try again.');
      setSwitching(null);
    }
  };

  const isLoading = status === 'loading';
  const userName = session?.user?.name || session?.user?.email || '';

  return (
    <AuthShell
      eyebrow="YOUR WORKSPACES"
      title="Select your workspace."
      subtitle={userName ? `Welcome back, ${userName.split(' ')[0]}. Choose a workspace to continue.` : 'Choose a workspace to continue.'}
      maxWidth="max-w-lg"
    >
      {error && (
        <div
          role="alert"
          className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-xs sm:text-sm text-rose-800"
        >
          {error}
        </div>
      )}

      <div className="space-y-3">
        {isLoading
          ? [1, 2].map((n) => <CardSkeleton key={n} />)
          : workspaces.length > 0
            ? workspaces.map((ws) => (
              <WorkspaceCard
                key={ws.id}
                workspace={ws}
                onSelect={handleSelect}
                loading={switching === ws.id}
              />
            ))
            : (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-center text-xs sm:text-sm text-amber-900">
                No workspaces found in your session.{' '}
                <button
                  type="button"
                  onClick={() => router.replace('/onboarding')}
                  className="font-semibold underline underline-offset-2"
                >
                  Create one now
                </button>
              </div>
            )}
      </div>

      {workspaces.length > 0 && (
        <div className="my-5 flex items-center gap-3">
          <div className="h-px flex-1 bg-slate-200" />
          <span className="text-xs text-slate-400 font-medium">or</span>
          <div className="h-px flex-1 bg-slate-200" />
        </div>
      )}

      <button
        id="create-new-workspace-btn"
        type="button"
        onClick={() => router.push('/onboarding')}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-indigo-300/80 bg-slate-50 hover:bg-indigo-50/50 px-4 py-3 text-xs sm:text-sm font-semibold text-indigo-700 transition-colors"
      >
        <span className="text-base font-bold">+</span>
        Create New Workspace
      </button>
    </AuthShell>
  );
}
