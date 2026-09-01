'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import AuthShell from '../../../_components/AuthShell';

import API_BASE from '../../../../lib/api';
const CHANGE_PASSWORD_ENDPOINT = `${API_BASE}/api/auth/change-password`;

const FLOAT_INPUT =
  'peer w-full rounded-xl border border-slate-300/80 bg-white px-3.5 pb-2.5 pt-5 text-sm text-slate-900 outline-none transition-all focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100';
const FLOAT_LABEL =
  'pointer-events-none absolute left-3.5 top-1.5 text-[11px] font-bold uppercase tracking-wide text-indigo-600 transition-all peer-placeholder-shown:top-3.5 peer-placeholder-shown:text-sm peer-placeholder-shown:font-normal peer-placeholder-shown:normal-case peer-placeholder-shown:tracking-normal peer-placeholder-shown:text-slate-400 peer-focus:top-1.5 peer-focus:text-[11px] peer-focus:font-bold peer-focus:uppercase peer-focus:tracking-wide peer-focus:text-indigo-600';

export default function InvitationLandingPage() {
  const params = useParams();
  const router = useRouter();
  const { data: session, status, update } = useSession();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [busy, setBusy] = useState(false);
  const [mustChange, setMustChange] = useState(false);

  const workspaceId = params?.workspaceId;

  useEffect(() => {
    if (status === 'authenticated') {
      setMustChange(session?.user?.mustChangePassword === true);
    }
  }, [status, session?.user?.mustChangePassword]);

  if (status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#FAFAFC] text-sm text-slate-400">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-200 border-t-indigo-600" />
      </div>
    );
  }

  if (status === 'unauthenticated') {
    return (
      <AuthShell
        eyebrow="AUTHENTICATION REQUIRED"
        title="Sign in required."
        subtitle="You must be signed in to access workspace invitation security."
      >
        <a
          href="/login"
          className="w-full rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-semibold text-sm py-3 px-4 flex items-center justify-center transition-all shadow-sm"
        >
          Sign in to continue
        </a>
      </AuthShell>
    );
  }

  const onSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    if (busy) return;
    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('New password and confirmation do not match.');
      return;
    }
    setBusy(true);
    try {
      const bearer = session?.accessToken;
      const res = await fetch(CHANGE_PASSWORD_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(bearer ? { Authorization: `Bearer ${bearer.trim()}` } : {}),
        },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.message || `Password change failed (${res.status}).`);
        return;
      }
      if (data.token) {
        try {
          localStorage.setItem('pulseops_token', data.token);
        } catch { }
      }
      setSuccess('Password updated successfully.');
      await update({
        accessToken: data.token,
        mustChangePassword: false,
        activeOrganizationId:
          data?.user?.activeOrganizationId ||
          session?.user?.activeOrganizationId ||
          workspaceId,
        role: data?.user?.role || session?.user?.role,
      });
      router.replace(`/workspace/${workspaceId}`);
      router.refresh();
    } catch {
      setError('Could not reach the password service. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-xl mx-auto space-y-6 pt-4">
      {/* Header */}
      <div className="text-center space-y-1.5">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          {mustChange ? 'Set your password.' : 'Invitation & Security'}
        </h1>
        <p className="text-sm text-slate-500 max-w-md mx-auto">
          {mustChange
            ? 'Your account was provisioned with a temporary password. Set a new password to continue into the workspace.'
            : 'Update the security password associated with your account for this workspace.'}
        </p>
      </div>

      {/* Card Form */}
      <div className="rounded-2xl border border-slate-200/80 bg-white p-6 sm:p-8 shadow-2xs">
        <form onSubmit={onSubmit} className="space-y-4.5" noValidate>
          <div className="relative">
            <input
              id="invitation-current-password"
              type="password"
              name="currentPassword"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              autoComplete="current-password"
              placeholder=" "
              className={FLOAT_INPUT}
            />
            <label htmlFor="invitation-current-password" className={FLOAT_LABEL}>
              Current Password
            </label>
          </div>

          <div className="relative">
            <input
              id="invitation-new-password"
              type="password"
              name="newPassword"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
              placeholder=" "
              className={FLOAT_INPUT}
            />
            <label htmlFor="invitation-new-password" className={FLOAT_LABEL}>
              New Password
            </label>
          </div>

          <div>
            <div className="relative">
              <input
                id="invitation-confirm-password"
                type="password"
                name="confirmPassword"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
                placeholder=" "
                className={FLOAT_INPUT}
              />
              <label htmlFor="invitation-confirm-password" className={FLOAT_LABEL}>
                Confirm New Password
              </label>
            </div>
            <p className="mt-1.5 text-xs text-slate-500 font-medium">At least 8 characters.</p>
          </div>

          {error && (
            <div
              role="alert"
              className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-xs sm:text-sm text-rose-800"
            >
              {error}
            </div>
          )}
          {success && (
            <div
              role="status"
              className="rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-3 text-xs sm:text-sm text-emerald-900"
            >
              ✓ {success}
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-semibold text-sm px-4 py-3 transition-all shadow-2xs disabled:opacity-60 disabled:cursor-not-allowed mt-2"
          >
            {busy ? 'Updating…' : 'Update Password'}
          </button>
        </form>
      </div>
    </div>
  );
}
