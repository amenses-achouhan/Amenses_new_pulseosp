'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Loader2, Check, ChevronRight, Plus } from 'lucide-react';
import CreateWorkspaceModal from '../../../_components/CreateWorkspaceModal';

// Backend API base — mirror of the dashboard / sidebar pages.
import API_BASE from '../../../../lib/api';
import { fetchJSONWithTimeout } from '../../../../lib/fetchWithTimeout';
const ME_ENDPOINT = `${API_BASE}/api/auth/me`;
const SWITCH_ENDPOINT = `${API_BASE}/api/organizations/switch-org`;

export default function WorkspacesPage({ params }) {
  const { workspaceId } = params;
  const router = useRouter();
  const { data: session, status, update } = useSession();

  const [me, setMe] = useState(null);
  const [meError, setMeError] = useState(null);
  const [switching, setSwitching] = useState(null); // org id currently being switched to
  const [switchError, setSwitchError] = useState(null);
  const [showCreateModal, setShowCreateModal] = useState(false);

  const token =
    session?.accessToken ||
    (typeof window !== 'undefined' ? localStorage.getItem('pulseops_token') : null);

  const activeOrganizationId = session?.user?.activeOrganizationId || workspaceId || null;

  // Load available workspaces from /api/auth/me
  useEffect(() => {
    let cancelled = false;
    if (!token) return undefined;

    (async () => {
      try {
        const { data, res } = await fetchJSONWithTimeout(ME_ENDPOINT, {
          headers: { Authorization: `Bearer ${token.trim()}` },
        }, 10000);
        if (cancelled) return;
        if (res.ok) {
          setMe(data);
          setMeError(null);
        } else {
          setMeError(data?.message || `Could not load workspaces (${res.status}).`);
        }
      } catch {
        if (!cancelled) setMeError('Could not reach the workspace service.');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token, status]);

  // Switch active workspace
  const switchWorkspace = async (orgId, orgRole) => {
    if (!orgId || orgId === activeOrganizationId) return;
    setSwitching(orgId);
    setSwitchError(null);
    try {
      let storedToken = null;
      try {
        storedToken = localStorage.getItem('pulseops_token');
      } catch (storageErr) {}
      const bearer = session?.accessToken || storedToken;
      const { data, res } = await fetchJSONWithTimeout(SWITCH_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(bearer ? { Authorization: `Bearer ${String(bearer).trim()}` } : {}),
        },
        body: JSON.stringify({ targetOrganizationId: orgId }),
      }, 10000);
      if (res.status === 403) {
        setSwitchError(
          data?.message || 'Forbidden. You are not an active member of this organization.'
        );
        return;
      }
      if (!res.ok) {
        setSwitchError(data?.message || `Could not switch workspace (${res.status}).`);
        return;
      }
      const nextOrgId = data.activeOrganizationId || orgId;
      if (data.token) {
        try {
          localStorage.setItem('pulseops_token', data.token);
        } catch (storageErr) {}
      }
      await update({
        accessToken: data.token,
        activeOrganizationId: nextOrgId,
        role: data.role || orgRole,
      });
      router.push(`/workspace/${nextOrgId}/workspaces`);
      router.refresh();
    } catch {
      setSwitchError('Could not reach the workspace server. Please try again.');
    } finally {
      setSwitching(null);
    }
  };

  if (status === 'loading') {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-slate-300" />
      </div>
    );
  }

  const organizations = me?.availableOrganizations || session?.user?.workspaces || [];
  // Active workspace always at top
  const sortedOrganizations = [...organizations].sort((a, b) => {
    const aId = a.id || a._id;
    const bId = b.id || b._id;
    if (aId === activeOrganizationId) return -1;
    if (bId === activeOrganizationId) return 1;
    return 0;
  });

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-[#E9E9E7]">Workspaces</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-[#9B9B9B]">
            Manage the workspaces you belong to and switch between them.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreateModal(true)}
          className="shrink-0 inline-flex items-center gap-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 px-4 py-2 text-xs font-semibold text-white shadow-2xs transition-all"
        >
          <Plus className="h-4 w-4" />
          <span>Create Workspace</span>
        </button>
      </div>

      {meError && (
        <div
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
        >
          {meError}
        </div>
      )}
      {switchError && (
        <div
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
        >
          {switchError}
        </div>
      )}

      {/* ─── Workspaces List ─────────────────────────────────────────────── */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-[#6F6F6F]">
            Your Workspaces ({sortedOrganizations.length})
          </h2>
        </div>

        <div className="space-y-3">
          {sortedOrganizations.map((org) => {
            const orgId = org.id || org._id;
            const isActive = orgId === activeOrganizationId;

            return (
              <div
                key={orgId}
                className={`flex w-full items-center justify-between gap-4 rounded-2xl border bg-white dark:bg-[#202020] p-5 text-left transition-all ${
                  isActive
                    ? 'border-indigo-300 dark:border-indigo-700 ring-2 ring-indigo-100/80 dark:ring-indigo-900/40 shadow-xs'
                    : 'border-slate-200/80 dark:border-[#2F2F2F] hover:border-indigo-200 dark:hover:border-indigo-800 hover:shadow-xs'
                }`}
              >
                <div className="flex min-w-0 items-center gap-4">
                  <div
                    className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-sm font-bold text-white shadow-2xs ${
                      isActive
                        ? 'bg-slate-900 dark:bg-indigo-600'
                        : 'bg-slate-200 dark:bg-[#2A2A2A] text-slate-700 dark:text-[#9B9B9B]'
                    }`}
                  >
                    {(org.name || '?').slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-bold text-slate-900 dark:text-[#E9E9E7]">{org.name}</p>
                      {isActive && (
                        <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 ring-1 ring-inset ring-emerald-600/20 dark:ring-emerald-500/30">
                          <Check className="h-3 w-3" aria-hidden="true" /> Active
                        </span>
                      )}
                    </div>
                    <p className="text-xs capitalize text-slate-500 dark:text-[#9B9B9B] mt-0.5">
                      Role: <span className="font-semibold text-slate-700 dark:text-[#E9E9E7]">{org.role || 'member'}</span>
                    </p>
                  </div>
                </div>

                <div className="shrink-0">
                  {isActive ? (
                    <span className="text-xs font-semibold text-slate-400 dark:text-[#6F6F6F] px-3 py-1.5 rounded-xl bg-slate-50 dark:bg-[#2A2A2A] border border-slate-200/60 dark:border-[#2F2F2F]">
                      Currently Active
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={switching === orgId}
                      onClick={() => switchWorkspace(orgId, org.role)}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-[#2F2F2F] bg-white dark:bg-[#202020] hover:bg-slate-50 dark:hover:bg-[#2A2A2A] px-3.5 py-1.5 text-xs font-semibold text-slate-700 dark:text-[#E9E9E7] transition-all shadow-2xs disabled:opacity-60"
                    >
                      {switching === orgId ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                          <span>Switching…</span>
                        </>
                      ) : (
                        <>
                          <span>Switch</span>
                          <ChevronRight className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          {sortedOrganizations.length === 0 && !meError && (
            <div className="rounded-2xl border border-slate-200/80 dark:border-[#2F2F2F] bg-white dark:bg-[#202020] px-6 py-12 text-center shadow-2xs">
              <p className="text-sm text-slate-500 dark:text-[#9B9B9B]">No workspaces found.</p>
              <button
                type="button"
                onClick={() => setShowCreateModal(true)}
                className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-slate-800"
              >
                <Plus className="h-4 w-4" /> Create workspace
              </button>
            </div>
          )}
        </div>
      </section>

      {/* Shared Create Workspace Modal */}
      <CreateWorkspaceModal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
      />
    </div>
  );
}