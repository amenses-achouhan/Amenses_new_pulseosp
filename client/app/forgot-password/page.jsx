'use client';

import { Suspense, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import AuthShell from '../_components/AuthShell';

import API_BASE from '../../lib/api';
import { fetchJSONWithTimeout } from '../../lib/fetchWithTimeout';
const FORGOT_ENDPOINT = `${API_BASE}/api/auth/forgot-password`;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const FLOAT_INPUT =
  'peer w-full rounded-xl border border-slate-300/80 bg-white px-3.5 pb-2.5 pt-5 text-sm text-slate-900 outline-none transition-all focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100';
const FLOAT_LABEL =
  'pointer-events-none absolute left-3.5 top-1.5 text-[11px] font-bold uppercase tracking-wide text-indigo-600 transition-all peer-placeholder-shown:top-3.5 peer-placeholder-shown:text-sm peer-placeholder-shown:font-normal peer-placeholder-shown:normal-case peer-placeholder-shown:tracking-normal peer-placeholder-shown:text-slate-400 peer-focus:top-1.5 peer-focus:text-[11px] peer-focus:font-bold peer-focus:uppercase peer-focus:tracking-wide peer-focus:text-indigo-600';

function ErrorBanner({ error }) {
  if (!error) return null;
  return (
    <div
      role="alert"
      className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-xs sm:text-sm text-rose-800"
    >
      {error.message}
    </div>
  );
}

function ForgotPasswordInner() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    if (busy) return;

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !EMAIL_RE.test(trimmedEmail)) {
      setError({ message: 'Enter a valid email address.' });
      return;
    }

    setBusy(true);
    try {
      const { data, res } = await fetchJSONWithTimeout(FORGOT_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmedEmail }),
      });
      if (!res.ok) {
        setError({ message: data?.message || `Request failed (${res.status}).` });
        return;
      }
      router.push(`/reset-password?email=${encodeURIComponent(trimmedEmail)}`);
    } catch {
      setError({ message: 'Could not reach the authentication server. Please try again.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      eyebrow="ACCOUNT RECOVERY"
      title="Reset your password."
      subtitle="Enter your account email and we'll send you a code to reset your password."
      footerLink={
        <Link href="/login" className="font-semibold text-indigo-600 hover:text-indigo-700 underline-offset-2 hover:underline">
          Back to sign in
        </Link>
      }
    >
      {error && (
        <div className="mb-4">
          <ErrorBanner error={error} />
        </div>
      )}

      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <div className="relative">
          <input
            id="forgot-email"
            type="email"
            name="email"
            autoComplete="email"
            value={email}
            placeholder=" "
            onChange={(e) => setEmail(e.target.value)}
            className={FLOAT_INPUT}
          />
          <label htmlFor="forgot-email" className={FLOAT_LABEL}>
            Account Email
          </label>
        </div>

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-semibold text-sm px-4 py-3 transition-all shadow-sm disabled:opacity-60 disabled:cursor-not-allowed mt-2"
        >
          {busy ? 'Sending…' : 'Send Reset Code'}
        </button>
      </form>
    </AuthShell>
  );
}

function Fallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#FAFAFC] text-sm text-slate-400">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-200 border-t-indigo-600" />
    </div>
  );
}

export default function ForgotPasswordPage() {
  return (
    <Suspense fallback={<Fallback />}>
      <ForgotPasswordInner />
    </Suspense>
  );
}
