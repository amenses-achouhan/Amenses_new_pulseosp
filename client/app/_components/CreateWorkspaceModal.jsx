'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { X, Loader2, Plus } from 'lucide-react';

import API_BASE from '../../lib/api';
import { fetchJSONWithTimeout } from '../../lib/fetchWithTimeout';
const ONBOARD_ENDPOINT = `${API_BASE}/api/organizations/onboard`;

const TEAM_SIZES = ['1-10', '11-50', '51-200', '200+'];
const FOCUS_OPTIONS = [
  'Web App Development',
  'AI/ML Solutions',
  'SaaS Infrastructure',
  'Mobile Applications',
  'Data & Analytics',
  'Other',
];

const FLOAT_INPUT =
  'peer w-full rounded-xl border border-slate-200/80 bg-white px-3.5 pb-2 pt-5 text-sm text-slate-900 outline-none transition-all focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 placeholder-transparent';
const FLOAT_LABEL =
  'pointer-events-none absolute left-3.5 top-1.5 text-[10px] font-bold uppercase tracking-wide text-indigo-600 transition-all peer-placeholder-shown:top-3.5 peer-placeholder-shown:text-sm peer-placeholder-shown:font-normal peer-placeholder-shown:normal-case peer-placeholder-shown:tracking-normal peer-placeholder-shown:text-slate-400 peer-focus:top-1.5 peer-focus:text-[10px] peer-focus:font-bold peer-focus:uppercase peer-focus:tracking-wide peer-focus:text-indigo-600';

/**
 * CreateWorkspaceModal — shared component for creating a new workspace.
 * Calls POST /api/organizations/onboard (same API as /onboarding page).
 * On success: updates session, stores token, navigates to the new workspace.
 *
 * Props:
 *   open      {boolean}  — whether the modal is visible
 *   onClose   {function} — called when the modal should close
 */
export default function CreateWorkspaceModal({ open, onClose }) {
  const router = useRouter();
  const { data: session, status, update } = useSession();

  const [name, setName] = useState('');
  const [teamSize, setTeamSize] = useState('');
  const [primaryFocus, setPrimaryFocus] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  const handleClose = () => {
    if (busy) return;
    setName('');
    setTeamSize('');
    setPrimaryFocus('');
    setError(null);
    onClose();
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    const trimmedName = name.trim();
    const trimmedFocus = primaryFocus.trim();
    if (!trimmedName) { setError('Workspace name is required.'); return; }
    if (!teamSize) { setError('Please select a team size.'); return; }
    if (!trimmedFocus) { setError('Primary focus is required.'); return; }
    if (busy) return;
    setBusy(true);

    try {
      let storedToken = null;
      try { storedToken = localStorage.getItem('pulseops_token'); } catch {}
      const activeToken = session?.accessToken || storedToken;

      const { data, res } = await fetchJSONWithTimeout(ONBOARD_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(activeToken ? { Authorization: `Bearer ${activeToken.trim()}` } : {}),
        },
        body: JSON.stringify({ name: trimmedName, teamSize, primaryFocus: trimmedFocus }),
      }, 10000);

      if (!res.ok) {
        setError(data?.message || `Could not create workspace (${res.status}). Please try again.`);
        return;
      }

      // Persist the new token
      if (data?.token) {
        try { localStorage.setItem('pulseops_token', data.token); } catch {}
      }

      // Update the NextAuth session so middleware & top bar see the new workspace
      if (status === 'authenticated' && data?.organization?._id) {
        try {
          await update({
            accessToken: data.token,
            activeOrganizationId: data.organization._id,
            role: 'owner',
            hasWorkspace: true,
            workspaceCount: (session?.user?.workspaceCount ?? 0) + 1,
            workspaces: [
              ...(Array.isArray(session?.user?.workspaces) ? session.user.workspaces : []),
              { id: data.organization._id, name: data.organization.name || trimmedName, role: 'owner' },
            ],
          });
        } catch {}
      }

      const newId = data?.organization?._id;
      handleClose();
      if (newId) {
        router.push(`/workspace/${newId}`);
        router.refresh();
      }
    } catch {
      setError('Could not reach the workspace service. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 dark:bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-200"
      onClick={handleClose}
    >
      {/* Panel */}
      <div
        className="w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200/80 dark:border-[#2F2F2F] bg-white dark:bg-[#202020] shadow-2xl transition-all"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-[#2F2F2F] bg-slate-50/50 dark:bg-[#191919] px-6 py-4.5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-900 dark:bg-[#E9E9E7] text-white dark:text-slate-900 shadow-2xs">
              <Plus className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-[#E9E9E7]">Create New Workspace</h2>
              <p className="text-xs text-slate-500 dark:text-[#9B9B9B]">Set up an organization workspace for your engineering team.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={busy}
            className="rounded-lg p-1.5 text-slate-400 dark:text-[#6F6F6F] transition-colors hover:bg-slate-100 dark:hover:bg-[#2A2A2A] hover:text-slate-600 dark:hover:text-[#E9E9E7] disabled:opacity-40"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={onSubmit} className="px-6 py-6 space-y-5" noValidate>
          {error && (
            <div
              role="alert"
              className="rounded-xl border border-rose-200 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-950/30 px-4 py-3 text-xs text-rose-800 dark:text-rose-300"
            >
              {error}
            </div>
          )}

          {/* Workspace Name Input */}
          <div className="space-y-1.5">
            <label htmlFor="cw-name" className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-[#9B9B9B]">
              Workspace Name <span className="text-rose-500">*</span>
            </label>
            <input
              id="cw-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Acme Engineering"
              autoComplete="off"
              disabled={busy}
              className="w-full rounded-xl border border-slate-200/80 dark:border-[#2F2F2F] bg-white dark:bg-[#202020] px-4 py-2.5 text-sm text-slate-900 dark:text-[#E9E9E7] shadow-2xs outline-none transition-all placeholder:text-slate-400 dark:placeholder:text-[#6F6F6F] focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
            />
          </div>

          {/* Team Size - Pill Toggle Buttons */}
          <div className="space-y-2">
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-[#9B9B9B]">
              Team Size <span className="text-rose-500">*</span>
            </label>
            <div className="grid grid-cols-4 gap-2">
              {TEAM_SIZES.map((s) => {
                const selected = teamSize === s;
                return (
                  <button
                    key={s}
                    type="button"
                    disabled={busy}
                    onClick={() => setTeamSize(s)}
                    className={`rounded-xl border py-2.5 text-xs font-bold transition-all shadow-2xs ${
                      selected
                        ? 'border-indigo-600 bg-indigo-600 text-white shadow-xs'
                        : 'border-slate-200/80 dark:border-[#2F2F2F] bg-white dark:bg-[#202020] text-slate-700 dark:text-[#E9E9E7] hover:border-slate-300 dark:hover:border-[#383838] hover:bg-slate-50 dark:hover:bg-[#2A2A2A]'
                    }`}
                  >
                    {s}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Primary Focus - Styled Select */}
          <div className="space-y-1.5">
            <label htmlFor="cw-focus" className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-[#9B9B9B]">
              Primary Focus <span className="text-rose-500">*</span>
            </label>
            <div className="relative">
              <select
                id="cw-focus"
                value={primaryFocus}
                onChange={(e) => setPrimaryFocus(e.target.value)}
                disabled={busy}
                className="w-full rounded-xl border border-slate-200/80 dark:border-[#2F2F2F] bg-white dark:bg-[#202020] px-4 py-2.5 text-sm text-slate-900 dark:text-[#E9E9E7] shadow-2xs outline-none transition-all focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
              >
                <option value="" disabled className="bg-white dark:bg-[#202020] text-slate-900 dark:text-[#E9E9E7]">Select primary focus area...</option>
                {FOCUS_OPTIONS.map((f) => (
                  <option key={f} value={f} className="bg-white dark:bg-[#202020] text-slate-900 dark:text-[#E9E9E7]">{f}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Action buttons */}
          <div className="pt-2 flex items-center justify-end gap-3 border-t border-slate-100 dark:border-[#2F2F2F]">
            <button
              type="button"
              onClick={handleClose}
              disabled={busy}
              className="rounded-xl border border-slate-200 dark:border-[#2F2F2F] bg-white dark:bg-[#202020] px-4 py-2.5 text-xs font-semibold text-slate-700 dark:text-[#E9E9E7] transition-colors hover:bg-slate-50 dark:hover:bg-[#2A2A2A] disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 dark:bg-[#E9E9E7] px-5 py-2.5 text-xs font-semibold text-white dark:text-slate-900 shadow-2xs transition-all hover:bg-slate-800 dark:hover:bg-white disabled:opacity-60"
            >
              {busy ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Creating Workspace…
                </>
              ) : (
                'Create Workspace'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
