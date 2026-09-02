'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';

import API_BASE from '../../../../lib/api';
import { fetchJSONWithTimeout } from '../../../../lib/fetchWithTimeout';

function PasswordSection({ token }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setStatus(null);

    if (newPassword.length < 8) {
      setStatus({ ok: false, message: 'New password must be at least 8 characters.' });
      return;
    }
    if (newPassword !== confirmPassword) {
      setStatus({ ok: false, message: 'New password and confirmation do not match.' });
      return;
    }

    setBusy(true);
    try {
      const { data, res } = await fetchJSONWithTimeout(`${API_BASE}/api/auth/change-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ currentPassword, newPassword }),
      }, 10000);
      if (res.ok) {
        setStatus({ ok: true, message: 'Password updated successfully.' });
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
      } else {
        setStatus({ ok: false, message: data?.error || data?.message || 'Failed to update password.' });
      }
    } catch {
      setStatus({ ok: false, message: 'Could not reach the server. Please try again.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-base font-semibold text-slate-900 mb-1">Change Password</h2>
      <p className="text-sm text-slate-500 mb-6">
        Only available for email/password accounts. OAuth accounts (Google, GitHub) do not use passwords.
      </p>

      {status && (
        <div
          role={status.ok ? 'status' : 'alert'}
          className={`mb-4 rounded-xl border px-4 py-3 text-sm ${
            status.ok
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border-rose-200 bg-rose-50 text-rose-800'
          }`}
        >
          {status.message}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4 max-w-sm">
        <div className="flex flex-col gap-1">
          <label htmlFor="settings-current-password" className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Current Password
          </label>
          <input
            id="settings-current-password"
            type="password"
            required
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            placeholder="Enter current password"
            className="rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="settings-new-password" className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            New Password
          </label>
          <input
            id="settings-new-password"
            type="password"
            required
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="Enter new password (min 8 chars)"
            className="rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="settings-confirm-password" className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Confirm New Password
          </label>
          <input
            id="settings-confirm-password"
            type="password"
            required
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Re-enter new password"
            className="rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200"
          />
        </div>

        <button
          type="submit"
          disabled={busy}
          className="rounded-xl bg-gradient-to-r from-indigo-500 via-purple-500 to-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? 'Updating…' : 'Update Password'}
        </button>
      </form>
    </section>
  );
}

export default function SettingsPage() {
  const params = useParams();
  const workspaceId = params?.workspaceId;

  // Read the JWT from localStorage (set on credentials login)
  const token = typeof window !== 'undefined' ? localStorage.getItem('pulseops_token') : null;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Workspace Settings</h1>
        <p className="mt-1 text-sm text-slate-500">
          Manage your account security and workspace preferences.
        </p>
      </div>

      <PasswordSection token={token} />
    </div>
  );
}
