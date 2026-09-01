'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { signIn } from 'next-auth/react';
import Link from 'next/link';
import AuthShell from '../_components/AuthShell';

import API_BASE from '../../lib/api';
const VERIFY_ENDPOINT = `${API_BASE}/api/auth/verify-email`;
const RESEND_ENDPOINT = `${API_BASE}/api/auth/resend-otp`;

const sanitizeParam = (value, { maxLength = 255 } = {}) => {
  let out = String(value == null ? '' : value)
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim();
  return out.slice(0, maxLength);
};

const FLOAT_INPUT =
  'peer w-full rounded-xl border border-slate-300/80 bg-white px-3.5 pb-2.5 pt-5 text-center text-xl font-bold tracking-[0.4em] text-slate-900 outline-none transition-all focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100';
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

function VerifyEmailInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const email = sanitizeParam(searchParams.get('email'));

  const [otp, setOtp] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [verified, setVerified] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setMessage('');
    if (busy) return;

    const trimmedOtp = otp.trim();
    if (!/^\d{6}$/.test(trimmedOtp)) {
      setError({ message: 'Enter the 6-digit code sent to your email.' });
      return;
    }
    if (!email) {
      setError({ message: 'Missing verification email. Please sign up again.' });
      return;
    }

    setBusy(true);
    try {
      const res = await fetch(VERIFY_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, otp: trimmedOtp }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError({ message: data?.message || `Verification failed (${res.status}).` });
        return;
      }
      setVerified(true);
      setMessage(data?.message || 'Email verified successfully.');

      try {
        const signInRes = await signIn('credentials', {
          redirect: false,
          email,
          verifiedToken: data?.token,
        });
        if (!signInRes?.ok || signInRes?.error) {
          setError({
            message: 'Email verified, but automatic sign-in failed. Please sign in to continue.',
          });
          return;
        }
        const sessionRes = await fetch('/api/auth/session');
        const sessionData = await sessionRes.json().catch(() => ({}));
        if (sessionData?.accessToken) {
          try {
            localStorage.setItem('pulseops_token', sessionData.accessToken);
          } catch { }
        }
        router.replace('/onboarding');
        return;
      } catch {
        setError({
          message: 'Email verified, but automatic sign-in failed. Please sign in to continue.',
        });
        return;
      }
    } catch {
      setError({ message: 'Could not reach the verification service. Please try again.' });
    } finally {
      setBusy(false);
    }
  };

  const onResend = async () => {
    setError(null);
    setMessage('');
    if (busy) return;
    if (!email) {
      setError({ message: 'Missing verification email. Please sign up again.' });
      return;
    }

    setBusy(true);
    try {
      const res = await fetch(RESEND_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError({ message: data?.message || `Resend failed (${res.status}).` });
        return;
      }
      setMessage(data?.message || 'A new verification code has been sent to your email.');
    } catch {
      setError({ message: 'Could not reach the verification service. Please try again.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      eyebrow="EMAIL VERIFICATION"
      title="Verify your email."
      subtitle={
        verified
          ? 'Your account is now verified.'
          : email
            ? `We sent a 6-digit verification code to ${email}.`
            : 'Enter the 6-digit code sent to your email to verify your account.'
      }
      footerLink={
        <Link href="/login" className="font-semibold text-indigo-600 hover:text-indigo-700 underline-offset-2 hover:underline">
          Back to sign in
        </Link>
      }
    >
      {verified ? (
        <div className="space-y-4">
          <Banner kind="success">✓ {message}</Banner>
          {error && <Banner kind="error">{error.message}</Banner>}
          <p className="text-xs sm:text-sm text-slate-500 text-center">
            Your email is verified. Continue to set up your workspace.
          </p>
          <a
            href="/login?verified=true"
            className="w-full rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-semibold text-sm py-3 px-4 flex items-center justify-center transition-all shadow-sm"
          >
            Continue to sign in
          </a>
        </div>
      ) : (
        <div className="space-y-4">
          {error && <Banner kind="error">{error.message}</Banner>}
          {message && !error && <Banner kind="success">{message}</Banner>}

          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <div className="relative">
              <input
                id="verify-otp"
                type="text"
                name="otp"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                autoComplete="one-time-code"
                value={otp}
                placeholder=" "
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                className={FLOAT_INPUT}
              />
              <label htmlFor="verify-otp" className={FLOAT_LABEL}>
                Verification Code
              </label>
            </div>

            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-semibold text-sm px-4 py-3 transition-all shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {busy ? 'Verifying…' : 'Verify Email'}
            </button>
          </form>

          <div className="flex items-center justify-center gap-1.5 text-xs sm:text-sm text-slate-500 pt-2">
            <span>Didn&apos;t receive the code?</span>
            <button
              type="button"
              onClick={onResend}
              disabled={busy}
              className="font-semibold text-indigo-600 hover:text-indigo-700 underline-offset-2 hover:underline disabled:opacity-60"
            >
              Resend OTP
            </button>
          </div>
        </div>
      )}
    </AuthShell>
  );
}

function VerifyEmailFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#FAFAFC] text-sm text-slate-400">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-200 border-t-indigo-600" />
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<VerifyEmailFallback />}>
      <VerifyEmailInner />
    </Suspense>
  );
}
