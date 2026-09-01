'use client';

import { signIn, useSession } from 'next-auth/react';
import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';

// Backend API base.
import API_BASE from '../../lib/api';
const LOGIN_ENDPOINT = `${API_BASE}/api/auth/login`;

// XSS guard
const sanitizeParam = (value, { alphanumeric = false, maxLength = 255 } = {}) => {
  let out = String(value == null ? '' : value)
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim();
  if (alphanumeric) out = out.replace(/[^A-Za-z0-9]/g, '');
  return out.slice(0, maxLength);
};

// Floating label inputs matching design system
const FLOAT_INPUT =
  'peer w-full rounded-xl border border-slate-300/80 bg-white px-3.5 pb-2.5 pt-5 text-sm text-slate-900 outline-none transition-all focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100';
const FLOAT_LABEL =
  'pointer-events-none absolute left-3.5 top-1.5 text-[11px] font-bold uppercase tracking-wide text-indigo-600 transition-all peer-placeholder-shown:top-3.5 peer-placeholder-shown:text-sm peer-placeholder-shown:font-normal peer-placeholder-shown:normal-case peer-placeholder-shown:tracking-normal peer-placeholder-shown:text-slate-400 peer-focus:top-1.5 peer-focus:text-[11px] peer-focus:font-bold peer-focus:uppercase peer-focus:tracking-wide peer-focus:text-indigo-600';

function LockedBanner({ orgEmail }) {
  return (
    <div
      role="status"
      className="flex items-start gap-2.5 rounded-xl border border-indigo-200 bg-indigo-50/80 px-3.5 py-3 text-xs sm:text-sm text-indigo-900"
    >
      <span aria-hidden="true" className="shrink-0">🔒</span>
      <span>
        <strong className="font-semibold">Locked to invited email:</strong> {orgEmail}
      </span>
    </div>
  );
}

function ErrorBanner({ error, email }) {
  if (!error) return null;
  const isMismatch = error.code === 'INVITATION_EMAIL_MISMATCH';
  const isUnverified = error.code === 'EMAIL_NOT_VERIFIED';
  return (
    <div
      role="alert"
      className={`rounded-xl border px-3.5 py-3 text-xs sm:text-sm ${isMismatch
          ? 'border-rose-200 bg-rose-50 text-rose-800'
          : isUnverified
            ? 'border-amber-200 bg-amber-50 text-amber-900'
            : 'border-rose-200 bg-rose-50 text-rose-800'
        }`}
    >
      {isMismatch
        ? `This invitation is locked to a different email. Sign in with the exact invited address (${error.message}).`
        : error.message}
      {isUnverified && (
        <div className="mt-2">
          <a
            href={`/verify-email?email=${encodeURIComponent(email || '')}`}
            className="font-semibold text-amber-900 underline underline-offset-2 hover:text-amber-950"
          >
            Resend verification code
          </a>
        </div>
      )}
    </div>
  );
}

const OAUTH_ERROR_MESSAGES = {
  Configuration:
    'Single sign-on is not configured in this environment. Please sign in with email & password.',
  google:
    'Google Single Sign-On is not configured in this environment. Please sign in with email & password.',
  github:
    'GitHub Single Sign-On is not configured in this environment. Please sign in with email & password.',
  OAuthSignin:
    'Single sign-on could not complete. Please try again or sign in with email & password.',
  OAuthCallback:
    'Single sign-on could not complete. Please try again or sign in with email & password.',
  OAuthCreateAccount:
    'Could not create a single sign-on account. Please try again or sign in with email & password.',
  AccessDenied:
    'You were not authorized to sign in. Please try again or sign in with email & password.',
};

function NextAuthErrorBanner({ code }) {
  if (!code) return null;
  return (
    <div
      role="alert"
      className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-xs sm:text-sm text-amber-900"
    >
      {OAUTH_ERROR_MESSAGES[code] || 'Sign-in failed. Please try again.'}
    </div>
  );
}

function LoginInner() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();

  const orgEmail = sanitizeParam(searchParams.get('orgEmail'), { maxLength: 255 });
  const inviteToken = sanitizeParam(searchParams.get('inviteToken'), {
    alphanumeric: true,
    maxLength: 128,
  });
  const verified = searchParams.get('verified') === 'true';

  const [tab, setTab] = useState('credentials');
  const [email, setEmail] = useState(() => (orgEmail ? orgEmail : ''));
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const locked = Boolean(orgEmail);

  const redirectedRef = useRef(false);
  const [oauthProviders, setOauthProviders] = useState(null);

  const oauthErrorParam = sanitizeParam(searchParams.get('error'), {
    alphanumeric: true,
    maxLength: 64,
  });

  useEffect(() => {
    if (locked) setEmail(orgEmail);
  }, [orgEmail, locked]);

  useEffect(() => {
    fetch('/api/auth/providers')
      .then((res) => res.json())
      .then((body) => setOauthProviders(body && typeof body === 'object' ? body : {}))
      .catch(() => setOauthProviders({}));
  }, []);

  const missingOAuth = oauthProviders
    ? ['google', 'github'].filter((p) => !oauthProviders[p])
    : [];
  const providerLabel = (provider) => (provider === 'google' ? 'Google' : 'GitHub');

  useEffect(() => {
    if (status === 'loading' || busy) return;
    if (redirectedRef.current) return;

    const params = new URLSearchParams(window.location.search);
    const hasOrg = params.get('orgEmail') || params.get('email');
    const hasToken = params.get('inviteToken') || params.get('token');
    if (Boolean(hasOrg || hasToken)) return;

    if (status === 'unauthenticated') return;

    if (status === 'authenticated' && session?.user) {
      const u = session.user;
      const userWorkspaces = Array.isArray(u.workspaces) ? u.workspaces : [];
      const wsId = u.activeOrganizationId || (userWorkspaces[0]?.id ?? null);
      const hasWs = u.hasWorkspace || userWorkspaces.length > 0 || !!wsId;
      redirectedRef.current = true;

      if (hasWs && wsId) {
        window.location.href = `/workspace/${wsId}`;
      } else {
        window.location.href = '/onboarding';
      }
    }
  }, [status, session, router, busy]);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    if (busy) return;
    setBusy(true);
    try {
      const payload = { email: email.trim(), password };
      if (inviteToken) payload.inviteToken = inviteToken;

      const result = await signIn('credentials', {
        redirect: false,
        ...payload,
      });

      if (!result?.ok) {
        const msg = result?.error || 'Login failed.';
        setError({
          message: msg,
          code: msg.includes('Email not verified') ? 'EMAIL_NOT_VERIFIED' : undefined,
        });
        return;
      }

      const sessionRes = await fetch('/api/auth/session');
      const sessionData = await sessionRes.json();
      const user = sessionData?.user || {};

      if (sessionData?.accessToken) {
        try { localStorage.setItem('pulseops_token', sessionData.accessToken); } catch { }
      }

      redirectedRef.current = true;
      const { hasWorkspace, activeOrganizationId, isInvitedUser, workspaces } = user;
      const userWorkspaces = Array.isArray(workspaces) ? workspaces : [];
      const wsId = activeOrganizationId || (userWorkspaces[0]?.id ?? null);
      const hasWs = hasWorkspace || userWorkspaces.length > 0 || !!wsId;

      if (isInvitedUser || orgEmail) {
        const targetOrg = wsId || searchParams.get('workspaceId');
        if (targetOrg) {
          window.location.href = `/workspace/${targetOrg}/invitations`;
        } else {
          window.location.href = wsId ? `/workspace/${wsId}` : '/onboarding';
        }
      } else if (hasWs && wsId) {
        window.location.href = `/workspace/${wsId}`;
      } else {
        window.location.href = '/onboarding';
      }
    } catch (err) {
      redirectedRef.current = false;
      setError({ message: 'Could not reach the authentication server. Please try again.' });
    } finally {
      setBusy(false);
    }
  };

  const onOAuth = async (provider) => {
    setError(null);
    if (oauthProviders && !oauthProviders[provider]) {
      setError({
        message: `${providerLabel(provider)} Single Sign-On is not configured in this environment. Please sign in with email & password.`,
      });
      return;
    }
    try {
      const cb = new URL(window.location.href);
      if (orgEmail) cb.searchParams.set('orgEmail', orgEmail);
      if (inviteToken) cb.searchParams.set('inviteToken', inviteToken);
      await signIn(provider, {
        callbackUrl: '/workspace',
        ...(orgEmail ? { email: orgEmail } : {}),
      });
    } catch (err) {
      setError({
        message: `${providerLabel(provider)} Single Sign-On could not complete. Please sign in with email & password.`,
      });
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
        <div className="w-full max-w-md">

          {/* Card Container */}
          <div className="bg-white border border-slate-200/80 rounded-2xl sm:rounded-3xl p-6 sm:p-8 shadow-md shadow-slate-900/5">

            {/* Header Content */}
            <div className="text-center mb-6">
              <div className="inline-flex items-center gap-1.5 mb-2">
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-600 inline-block"></span>
                <span className="text-[11px] font-bold tracking-widest text-indigo-600 uppercase">
                  WELCOME BACK
                </span>
              </div>
              <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
                Sign in to PulseOps.
              </h1>
              <p className="mt-2 text-xs sm:text-sm text-slate-500">
                {locked
                  ? 'Locked to your organization invitation'
                  : 'Enter your credentials to access your workspace.'}
              </p>
            </div>

            {/* Tab switcher: Credentials vs Single sign-on */}
            <div
              role="tablist"
              aria-label="Sign-in method"
              className="mb-6 grid grid-cols-2 gap-1 rounded-xl bg-slate-100/80 p-1"
            >
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'credentials'}
                onClick={() => setTab('credentials')}
                className={`rounded-lg px-3 py-2 text-xs sm:text-sm transition-all ${tab === 'credentials'
                    ? 'bg-white font-bold text-slate-900 shadow-sm'
                    : 'font-medium text-slate-500 hover:text-slate-900'
                  }`}
              >
                Email &amp; password
              </button>
              {!locked && (
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === 'oauth'}
                  onClick={() => setTab('oauth')}
                  className={`rounded-lg px-3 py-2 text-xs sm:text-sm transition-all ${tab === 'oauth'
                      ? 'bg-white font-bold text-slate-900 shadow-sm'
                      : 'font-medium text-slate-500 hover:text-slate-900'
                    }`}
                >
                  Single sign-on
                </button>
              )}
            </div>

            {oauthErrorParam && <NextAuthErrorBanner code={oauthErrorParam} />}
            {verified && !error && (
              <div
                role="status"
                className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-3 text-xs sm:text-sm text-emerald-900"
              >
                ✓ Email verified successfully. You can now sign in.
              </div>
            )}
            {locked && (
              <div className="mb-4">
                <LockedBanner orgEmail={orgEmail.trim()} />
              </div>
            )}
            <div className="mb-4">
              <ErrorBanner error={error} email={email} />
            </div>

            {tab === 'credentials' ? (
              <form onSubmit={onSubmit} className="space-y-4" noValidate>
                <div className="relative">
                  <input
                    id="login-email"
                    type="email"
                    name="email"
                    autoComplete="email"
                    value={email}
                    readOnly={locked}
                    placeholder=" "
                    onChange={(e) => setEmail(e.target.value)}
                    className={`${FLOAT_INPUT} ${locked
                        ? 'cursor-not-allowed border-indigo-200 bg-indigo-50/50 text-indigo-900 focus:ring-indigo-200'
                        : ''
                      }`}
                  />
                  <label htmlFor="login-email" className={FLOAT_LABEL}>
                    Work Email
                  </label>
                </div>
                {locked && (
                  <p className="mt-1.5 text-xs text-indigo-600">
                    Email is locked to this invitation. Missing one?{' '}
                    <a href="/login" className="underline underline-offset-2">
                      Sign in with another email
                    </a>
                  </p>
                )}

                <div className="relative">
                  <input
                    id="login-password"
                    type="password"
                    name="password"
                    autoComplete="current-password"
                    value={password}
                    placeholder=" "
                    onChange={(e) => setPassword(e.target.value)}
                    className={FLOAT_INPUT}
                  />
                  <label htmlFor="login-password" className={FLOAT_LABEL}>
                    Password
                  </label>
                </div>

                <div className="flex justify-end pt-0.5">
                  <a
                    href="/forgot-password"
                    className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 underline-offset-2 hover:underline"
                  >
                    Forgot password?
                  </a>
                </div>

                <button
                  type="submit"
                  disabled={busy}
                  className="w-full rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-semibold text-sm px-4 py-3 transition-all shadow-sm disabled:opacity-60 disabled:cursor-not-allowed mt-2"
                >
                  {busy ? 'Signing in…' : 'Sign In'}
                </button>
              </form>
            ) : (
              <div className="space-y-3">
                {missingOAuth.length > 0 && (
                  <div
                    role="status"
                    className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-xs sm:text-sm text-amber-900"
                  >
                    {missingOAuth.length === 2
                      ? 'Google / GitHub Single Sign-On is not configured in this environment. Please sign in with email & password.'
                      : `${providerLabel(missingOAuth[0])} Single Sign-On is not configured in this environment. Please sign in with email & password.`}
                  </div>
                )}
                <p className="text-xs sm:text-sm text-slate-500 leading-relaxed">
                  Continue with Google or GitHub.
                </p>
                <button
                  type="button"
                  onClick={() => onOAuth('google')}
                  disabled={busy || Boolean(oauthProviders && !oauthProviders.google)}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 px-4 py-2.5 text-xs sm:text-sm font-semibold text-slate-700 transition-colors disabled:opacity-60"
                >
                  Google
                </button>
                <button
                  type="button"
                  onClick={() => onOAuth('github')}
                  disabled={busy || Boolean(oauthProviders && !oauthProviders.github)}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 px-4 py-2.5 text-xs sm:text-sm font-semibold text-slate-700 transition-colors disabled:opacity-60"
                >
                  GitHub
                </button>
              </div>
            )}

          </div>

          {/* Footer Link Under Card */}
          <p className="mt-6 text-center text-xs sm:text-sm text-slate-600">
            Don&apos;t have an account?{' '}
            <a
              href={locked ? `/register?orgEmail=${encodeURIComponent(orgEmail)}` : '/register'}
              className="font-semibold text-indigo-600 hover:text-indigo-700 underline-offset-2 hover:underline"
            >
              Sign up
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

function LoginFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#FAFAFC] text-sm text-slate-400">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-200 border-t-indigo-600" />
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginFallback />}>
      <LoginInner />
    </Suspense>
  );
}
