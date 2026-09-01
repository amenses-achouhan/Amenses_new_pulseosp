'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import AuthShell from '../_components/AuthShell';

import API_BASE from '../../lib/api';
const VERIFY_OTP_ENDPOINT = `${API_BASE}/api/auth/verify-password-reset-otp`;
const RESET_ENDPOINT = `${API_BASE}/api/auth/reset-password`;
const RESEND_ENDPOINT = `${API_BASE}/api/auth/resend-password-otp`;

const sanitizeParam = (value, { maxLength = 255 } = {}) => {
  let out = String(value == null ? '' : value)
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim();
  return out.slice(0, maxLength);
};

const FLOAT_INPUT =
  'peer w-full rounded-xl border border-slate-300/80 bg-white px-3.5 pb-2.5 pt-5 text-sm text-slate-900 outline-none transition-all focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100';
const FLOAT_INPUT_OTP =
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

function ResetPasswordInner() {
  const searchParams = useSearchParams();
  const email = sanitizeParam(searchParams.get('email'));

  const [step, setStep] = useState('otp'); // 'otp' | 'password' | 'success'
  const [otp, setOtp] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const verifyOtp = async (e) => {
    e.preventDefault();
    setError(null);
    setMessage('');
    if (busy) return;
    if (!email) {
      setError({ message: 'Missing email. Please request a reset code again.' });
      return;
    }
    const trimmedOtp = otp.trim();
    if (!/^\d{6}$/.test(trimmedOtp)) {
      setError({ message: 'Enter the 6-digit code sent to your email.' });
      return;
    }

    setBusy(true);
    try {
      const res = await fetch(VERIFY_OTP_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, otp: trimmedOtp }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError({ message: data?.message || `Verification failed (${res.status}).` });
        return;
      }
      setResetToken(data?.resetToken || '');
      setOtp('');
      setStep('password');
    } catch {
      setError({ message: 'Could not reach the authentication server. Please try again.' });
    } finally {
      setBusy(false);
    }
  };

  const resendOtp = async () => {
    setError(null);
    setMessage('');
    if (busy) return;
    if (!email) {
      setError({ message: 'Missing email. Please request a reset code again.' });
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
      setError({ message: 'Could not reach the authentication server. Please try again.' });
    } finally {
      setBusy(false);
    }
  };

  const resetPassword = async (e) => {
    e.preventDefault();
    setError(null);
    setMessage('');
    if (busy) return;

    if (!newPassword || newPassword.length < 8) {
      setError({ message: 'Password must be at least 8 characters.' });
      return;
    }
    if (confirm !== newPassword) {
      setError({ message: 'Passwords do not match.' });
      return;
    }
    if (!email || !resetToken) {
      setError({ message: 'Reset session expired. Please request a new code.' });
      return;
    }

    setBusy(true);
    try {
      const res = await fetch(RESET_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, resetToken, password: newPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError({ message: data?.message || `Reset failed (${res.status}).` });
        return;
      }
      setNewPassword('');
      setConfirm('');
      setMessage(data?.message || 'Password changed successfully.');
      setStep('success');
    } catch {
      setError({ message: 'Could not reach the authentication server. Please try again.' });
    } finally {
      setBusy(false);
    }
  };

  const getShellProps = () => {
    if (step === 'success') {
      return {
        eyebrow: 'PASSWORD RESET',
        title: 'Password updated.',
        subtitle: 'Your password was updated successfully. You can now sign in with your new password.',
      };
    }
    if (step === 'password') {
      return {
        eyebrow: 'PASSWORD RESET',
        title: 'Set a new password.',
        subtitle: `Setting new password for ${email || 'your account'}.`,
      };
    }
    return {
      eyebrow: 'ACCOUNT RECOVERY',
      title: 'Check your email.',
      subtitle: `Enter the 6-digit code sent to ${email || 'your email'}.`,
    };
  };

  const shellProps = getShellProps();

  return (
    <AuthShell
      {...shellProps}
      footerLink={
        <Link href="/login" className="font-semibold text-indigo-600 hover:text-indigo-700 underline-offset-2 hover:underline">
          Back to sign in
        </Link>
      }
    >
      {step === 'success' ? (
        <div className="space-y-4">
          <Banner kind="success">✓ {message}</Banner>
          <a
            href="/login"
            className="w-full rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-semibold text-sm py-3 px-4 flex items-center justify-center transition-all shadow-sm"
          >
            Go to Login
          </a>
        </div>
      ) : step === 'password' ? (
        <div className="space-y-4">
          {error && <Banner kind="error">{error.message}</Banner>}
          {message && !error && <Banner kind="success">{message}</Banner>}

          <form onSubmit={resetPassword} className="space-y-4" noValidate>
            <div className="relative">
              <input
                id="reset-new-password"
                type="password"
                name="newPassword"
                autoComplete="new-password"
                value={newPassword}
                placeholder=" "
                onChange={(e) => setNewPassword(e.target.value)}
                className={FLOAT_INPUT}
              />
              <label htmlFor="reset-new-password" className={FLOAT_LABEL}>
                New Password
              </label>
            </div>

            <div>
              <div className="relative">
                <input
                  id="reset-confirm"
                  type="password"
                  name="confirm"
                  autoComplete="new-password"
                  value={confirm}
                  placeholder=" "
                  onChange={(e) => setConfirm(e.target.value)}
                  className={FLOAT_INPUT}
                />
                <label htmlFor="reset-confirm" className={FLOAT_LABEL}>
                  Confirm New Password
                </label>
              </div>
              <p className="mt-1 text-[11px] text-slate-400">At least 8 characters.</p>
            </div>

            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-semibold text-sm px-4 py-3 transition-all shadow-sm disabled:opacity-60 disabled:cursor-not-allowed mt-2"
            >
              {busy ? 'Resetting…' : 'Reset Password'}
            </button>
          </form>
        </div>
      ) : (
        <div className="space-y-4">
          {error && <Banner kind="error">{error.message}</Banner>}
          {message && !error && <Banner kind="success">{message}</Banner>}

          <form onSubmit={verifyOtp} className="space-y-4" noValidate>
            <div className="relative">
              <input
                id="reset-otp"
                type="text"
                name="otp"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                autoComplete="one-time-code"
                value={otp}
                placeholder=" "
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                className={FLOAT_INPUT_OTP}
              />
              <label htmlFor="reset-otp" className={FLOAT_LABEL}>
                Verification Code
              </label>
            </div>

            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-semibold text-sm px-4 py-3 transition-all shadow-sm disabled:opacity-60 disabled:cursor-not-allowed mt-2"
            >
              {busy ? 'Verifying…' : 'Verify Code'}
            </button>
          </form>

          <div className="flex items-center justify-center gap-1.5 text-xs sm:text-sm text-slate-500 pt-2">
            <span>Didn&apos;t receive the code?</span>
            <button
              type="button"
              onClick={resendOtp}
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

function Fallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#FAFAFC] text-sm text-slate-400">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-200 border-t-indigo-600" />
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<Fallback />}>
      <ResetPasswordInner />
    </Suspense>
  );
}