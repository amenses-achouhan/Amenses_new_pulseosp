'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { setPendingSignup, takePendingSignup } from '../../lib/pendingSignup';

// Backend API base.
import API_BASE from '../../lib/api';
const REGISTER_ENDPOINT = `${API_BASE}/api/auth/register`;

// XSS guard
const sanitizeParam = (value, { maxLength = 255 } = {}) => {
  let out = String(value == null ? '' : value)
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim();
  return out.slice(0, maxLength);
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Floating label inputs matching design system
const FLOAT_INPUT =
  'peer w-full rounded-xl border border-slate-300/80 bg-white px-3.5 pb-2.5 pt-5 text-sm text-slate-900 outline-none transition-all focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100';
const FLOAT_LABEL =
  'pointer-events-none absolute left-3.5 top-1.5 text-[11px] font-bold uppercase tracking-wide text-indigo-600 transition-all peer-placeholder-shown:top-3.5 peer-placeholder-shown:text-sm peer-placeholder-shown:font-normal peer-placeholder-shown:normal-case peer-placeholder-shown:tracking-normal peer-placeholder-shown:text-slate-400 peer-focus:top-1.5 peer-focus:text-[11px] peer-focus:font-bold peer-focus:uppercase peer-focus:tracking-wide peer-focus:text-indigo-600';

function Banner({ kind, children }) {
  return (
    <div
      role={kind === 'success' ? 'status' : 'alert'}
      className={`rounded-xl border px-3.5 py-3 text-xs sm:text-sm ${kind === 'success'
          ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
          : 'border-rose-200 bg-rose-50 text-rose-800'
        }`}
    >
      {children}
    </div>
  );
}

function RegisterInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const orgEmail = sanitizeParam(searchParams.get('orgEmail'));

  const [restored] = useState(() => takePendingSignup());

  const [username, setUsername] = useState(restored.username || '');
  const [email, setEmail] = useState(() => restored.email || (orgEmail ? orgEmail : ''));
  const [password, setPassword] = useState(restored.password || '');
  const [confirm, setConfirm] = useState(restored.confirm || '');
  const [fieldErrors, setFieldErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const validate = () => {
    const errors = {};
    const trimmedUsername = username.trim();
    if (!trimmedUsername) errors.username = 'Username is required.';
    const trimmedEmail = email.trim();
    if (!trimmedEmail) errors.email = 'Email is required.';
    else if (!EMAIL_RE.test(trimmedEmail)) errors.email = 'Enter a valid email address.';
    if (!password) errors.password = 'Password is required.';
    else if (password.length < 8) errors.password = 'Password must be at least 8 characters.';
    if (!confirm) errors.confirm = 'Please confirm your password.';
    else if (confirm !== password) errors.confirm = 'Passwords do not match.';
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    if (busy) return;
    if (!validate()) return;
    setBusy(true);
    try {
      const res = await fetch(REGISTER_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), email: email.trim(), password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError({ message: data?.message || `Registration failed (${res.status}).` });
        return;
      }

      setPendingSignup({ username, email, password, confirm });
      router.replace(`/verify-email?email=${encodeURIComponent(email.trim())}`);
    } catch (err) {
      setError({ message: 'Could not reach the authentication server. Please try again.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#FAFAFC] text-slate-900 flex flex-col justify-between selection:bg-indigo-100 selection:text-indigo-900">

      {/* ------------ Top Header Bar (Minimal Logo Only) ------------ */}
      <header className="px-6 py-6 max-w-7xl w-full mx-auto flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5 group">
          <div className="h-8 w-8 rounded-lg bg-slate-900 flex items-center justify-center text-white shadow-sm group-hover:scale-105 transition-transform">
            <div className="flex items-center gap-0.5">
              <span className="w-1 h-3.5 bg-white rounded-full"></span>
              <span className="w-1 h-5 bg-white rounded-full"></span>
              <span className="w-1 h-3.5 bg-white rounded-full"></span>
            </div>
          </div>
          <span className="text-xl font-bold tracking-tight text-slate-900">
            PulseOps
          </span>
        </Link>
      </header>

      {/* ------------ Main Form Content ------------ */}
      <main className="flex-1 flex items-center justify-center px-4 py-8 sm:px-6">
        <div className="w-full max-w-md relative">

          {/* Subtle Handwritten Annotation */}
          <div className="hidden sm:block absolute -top-5 -right-6 rotate-6 z-10 pointer-events-none">
            <span className="font-handwriting text-slate-700 text-lg font-bold bg-[#FFFDF7] border border-amber-200/70 px-2.5 py-1 rounded-lg shadow-sm">
              One workspace. ✨
            </span>
          </div>

          {/* Card Container */}
          <div className="bg-white border border-slate-200/80 rounded-2xl sm:rounded-3xl p-6 sm:p-8 shadow-md shadow-slate-900/5">

            {/* Header Content */}
            <div className="text-center mb-6">
              <div className="inline-flex items-center gap-1.5 mb-2">
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-600 inline-block"></span>
                <span className="text-[11px] font-bold tracking-widest text-indigo-600 uppercase">
                  GET STARTED
                </span>
              </div>
              <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
                Create your PulseOps account.
              </h1>
              <p className="mt-2 text-xs sm:text-sm text-slate-500">
                Join your team and unify your development workflow.
              </p>
            </div>

            <form onSubmit={onSubmit} className="space-y-4" noValidate>
              {error && (
                <div className="mb-2">
                  <Banner kind="error">{error.message}</Banner>
                </div>
              )}

              <div>
                <div className="relative">
                  <input
                    id="register-username"
                    type="text"
                    name="username"
                    autoComplete="username"
                    value={username}
                    placeholder=" "
                    onChange={(e) => setUsername(e.target.value)}
                    className={FLOAT_INPUT}
                  />
                  <label htmlFor="register-username" className={FLOAT_LABEL}>
                    Username
                  </label>
                </div>
                {fieldErrors.username && (
                  <p className="mt-1 text-xs text-rose-600">{fieldErrors.username}</p>
                )}
              </div>

              <div>
                <div className="relative">
                  <input
                    id="register-email"
                    type="email"
                    name="email"
                    autoComplete="email"
                    value={email}
                    placeholder=" "
                    onChange={(e) => setEmail(e.target.value)}
                    className={FLOAT_INPUT}
                  />
                  <label htmlFor="register-email" className={FLOAT_LABEL}>
                    Work Email
                  </label>
                </div>
                {fieldErrors.email && (
                  <p className="mt-1 text-xs text-rose-600">{fieldErrors.email}</p>
                )}
              </div>

              <div>
                <div className="relative">
                  <input
                    id="register-password"
                    type="password"
                    name="password"
                    autoComplete="new-password"
                    value={password}
                    placeholder=" "
                    onChange={(e) => setPassword(e.target.value)}
                    className={FLOAT_INPUT}
                  />
                  <label htmlFor="register-password" className={FLOAT_LABEL}>
                    Password
                  </label>
                </div>
                <p className="mt-1 text-[11px] text-slate-400">At least 8 characters.</p>
                {fieldErrors.password && (
                  <p className="mt-1 text-xs text-rose-600">{fieldErrors.password}</p>
                )}
              </div>

              <div>
                <div className="relative">
                  <input
                    id="register-confirm"
                    type="password"
                    name="confirm"
                    autoComplete="new-password"
                    value={confirm}
                    placeholder=" "
                    onChange={(e) => setConfirm(e.target.value)}
                    className={FLOAT_INPUT}
                  />
                  <label htmlFor="register-confirm" className={FLOAT_LABEL}>
                    Confirm Password
                  </label>
                </div>
                {fieldErrors.confirm && (
                  <p className="mt-1 text-xs text-rose-600">{fieldErrors.confirm}</p>
                )}
              </div>

              <button
                type="submit"
                disabled={busy}
                className="w-full rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-semibold text-sm px-4 py-3 transition-all shadow-sm disabled:opacity-60 disabled:cursor-not-allowed mt-2"
              >
                {busy ? 'Creating account…' : 'Create Account'}
              </button>
            </form>

          </div>

          {/* Footer Link Under Card */}
          <p className="mt-6 text-center text-xs sm:text-sm text-slate-600">
            Already have an account?{' '}
            <a
              href="/login"
              className="font-semibold text-indigo-600 hover:text-indigo-700 underline-offset-2 hover:underline"
            >
              Sign in
            </a>
          </p>

        </div>
      </main>

      {/* ------------ Bottom Footer Strip ------------ */}
      <footer className="px-6 py-6 text-center text-xs text-slate-400">
        © {new Date().getFullYear()} PulseOps, Inc. All rights reserved.
      </footer>

    </div>
  );
}

function RegisterFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#FAFAFC] text-sm text-slate-400">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-200 border-t-indigo-600" />
    </div>
  );
}

export default function RegisterPage() {
  return (
    <Suspense fallback={<RegisterFallback />}>
      <RegisterInner />
    </Suspense>
  );
}
