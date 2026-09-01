'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import AuthShell from '../_components/AuthShell';

import API_BASE from '../../lib/api';
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
  'peer w-full rounded-xl border border-slate-300/80 bg-white px-3.5 pb-2.5 pt-5 text-sm text-slate-900 outline-none transition-all focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100';
const FLOAT_LABEL =
  'pointer-events-none absolute left-3.5 top-1.5 text-[11px] font-bold uppercase tracking-wide text-indigo-600 transition-all peer-placeholder-shown:top-3.5 peer-placeholder-shown:text-sm peer-placeholder-shown:font-normal peer-placeholder-shown:normal-case peer-placeholder-shown:tracking-normal peer-placeholder-shown:text-slate-400 peer-focus:top-1.5 peer-focus:text-[11px] peer-focus:font-bold peer-focus:uppercase peer-focus:tracking-wide peer-focus:text-indigo-600';

function ErrorBanner({ error }) {
  if (!error) return null;
  return (
    <div
      role="alert"
      className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-xs sm:text-sm text-rose-800"
    >
      {error.message}
    </div>
  );
}

function NoSessionBanner() {
  return (
    <div
      role="alert"
      className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-xs sm:text-sm text-amber-900"
    >
      No active session found on this device. Please{' '}
      <a href="/login" className="font-semibold underline underline-offset-2">
        sign in
      </a>{' '}
      first to create your workspace.
    </div>
  );
}

export default function OnboardingPage() {
  const router = useRouter();
  const { data: session, status, update } = useSession();

  const [name, setName] = useState('');
  const [teamSize, setTeamSize] = useState('');
  const [primaryFocus, setPrimaryFocus] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState(null);
  const [tokenReady, setTokenReady] = useState(false);

  // Sync token from NextAuth session or localStorage
  useEffect(() => {
    let stored = null;
    try {
      stored = localStorage.getItem('pulseops_token') || null;
    } catch {
      stored = null;
    }
    const activeToken = session?.accessToken || stored;
    if (activeToken) {
      setToken(activeToken);
      if (session?.accessToken && typeof window !== 'undefined') {
        try {
          localStorage.setItem('pulseops_token', session.accessToken);
        } catch {}
      }
    } else {
      setToken(null);
    }
    setTokenReady(true);
  }, [session?.accessToken, status]);

  // Redirect existing users with a workspace away from onboarding
  useEffect(() => {
    if (status === 'loading') return;

    if (status === 'authenticated' && session?.user) {
      const u = session.user;
      const hasWs =
        u.hasWorkspace ||
        (Array.isArray(u.workspaces) && u.workspaces.length > 0) ||
        !!u.activeOrganizationId;
      const wsId = u.activeOrganizationId || (u.workspaces?.[0]?.id ?? null);

      const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
      const isExplicitNew = params?.get('mode') === 'create' || params?.get('new') === 'true';

      if (hasWs && wsId && !isExplicitNew) {
        router.replace(`/workspace/${wsId}`);
      }
    }
  }, [status, session, router]);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    const trimmedName = name.trim();
    const trimmedFocus = primaryFocus.trim();
    if (!trimmedName) {
      setError({ message: 'Organization name is required.' });
      return;
    }
    if (!teamSize) {
      setError({ message: 'Please select a team size.' });
      return;
    }
    if (!trimmedFocus) {
      setError({ message: 'Primary focus is required.' });
      return;
    }
    if (busy) return;
    setBusy(true);

    try {
      const activeToken = token || session?.accessToken;
      const res = await fetch(ONBOARD_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(activeToken ? { Authorization: `Bearer ${activeToken.trim()}` } : {}),
        },
        body: JSON.stringify({ name: trimmedName, teamSize, primaryFocus: trimmedFocus }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError({
          message: data?.message || `Onboarding failed (${res.status}). Please try again.`,
          code: data?.code,
        });
        return;
      }

      if (data && data.token) {
        try {
          localStorage.setItem('pulseops_token', data.token);
          setToken(data.token);
        } catch { }
      }

      if (status === 'authenticated' && data && data.organization && data.organization._id) {
        try {
          await update({
            accessToken: data.token,
            activeOrganizationId: data.organization._id,
            role: 'owner',
            hasWorkspace: true,
            workspaceCount: 1,
            workspaces: [{ id: data.organization._id, name: data.organization.name || '', role: 'owner' }],
          });
        } catch { }
      }

      const newWorkspaceId = data?.organization?._id;
      if (newWorkspaceId) {
        router.replace(`/workspace/${newWorkspaceId}`);
      } else {
        router.replace('/dashboard');
      }
    } catch {
      setError({ message: 'Could not reach the authentication server. Please try again.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      eyebrow="ORGANIZATION SETUP"
      title="Create your organization."
      subtitle="Set up your workspace to collaborate with your engineering team."
      handwrittenNote="Set up in 2 mins ✨"
    >
      <ErrorBanner error={error} />
      {tokenReady && status === 'unauthenticated' && !token && <NoSessionBanner />}

      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <div className="relative">
          <input
            id="onboard-name"
            type="text"
            name="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder=" "
            autoComplete="organization"
            className={FLOAT_INPUT}
          />
          <label htmlFor="onboard-name" className={FLOAT_LABEL}>
            Organization Name <span className="text-rose-500">*</span>
          </label>
        </div>

        <div>
          <label className="block mb-1 text-xs font-bold uppercase tracking-wide text-slate-700">
            Team Size <span className="text-rose-500">*</span>
          </label>
          <select
            name="teamSize"
            value={teamSize}
            onChange={(e) => setTeamSize(e.target.value)}
            className="w-full rounded-xl border border-slate-300/80 bg-white px-3.5 py-3 text-sm text-slate-900 outline-none transition-all focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
          >
            <option value="" disabled>
              Select range…
            </option>
            {TEAM_SIZES.map((size) => (
              <option key={size} value={size}>
                {size} members
              </option>
            ))}
          </select>
        </div>

        <div>
          <div className="relative">
            <input
              id="onboard-focus"
              type="text"
              name="primaryFocus"
              list="focus-options"
              value={primaryFocus}
              onChange={(e) => setPrimaryFocus(e.target.value)}
              placeholder=" "
              className={FLOAT_INPUT}
            />
            <label htmlFor="onboard-focus" className={FLOAT_LABEL}>
              Primary Focus <span className="text-rose-500">*</span>
            </label>
            <datalist id="focus-options">
              {FOCUS_OPTIONS.map((option) => (
                <option key={option} value={option} />
              ))}
            </datalist>
          </div>
          <span className="mt-1 block text-[11px] text-slate-400">
            Pick a suggestion or type your own domain.
          </span>
        </div>

        <button
          type="submit"
          disabled={busy || (tokenReady && !token)}
          className="w-full rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-semibold text-sm px-4 py-3 transition-all shadow-sm disabled:opacity-60 disabled:cursor-not-allowed mt-2"
        >
          {busy ? 'Creating organization…' : 'Create Organization'}
        </button>
      </form>
    </AuthShell>
  );
}