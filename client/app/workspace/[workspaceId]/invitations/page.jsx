'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { ShieldAlert } from 'lucide-react';

import API_BASE from '../../../../lib/api';
import { fetchWithTimeout, fetchJSONWithTimeout } from '../../../../lib/fetchWithTimeout';

const ROLE_OPTIONS = {
  owner: ['developer', 'maintainer', 'admin', 'viewer'],
  admin: ['developer', 'viewer'],
  maintainer: ['developer', 'viewer'],
};

const ROLE_COLORS = {
  owner: 'bg-violet-50 text-violet-700 ring-violet-600/20',
  admin: 'bg-indigo-50 text-indigo-700 ring-indigo-600/20',
  maintainer: 'bg-blue-50 text-blue-700 ring-blue-600/20',
  developer: 'bg-slate-50 text-slate-700 ring-slate-600/20',
  viewer: 'bg-amber-50 text-amber-700 ring-amber-600/20',
};

function RoleBadge({ role }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset capitalize ${
        ROLE_COLORS[role] || ROLE_COLORS.developer
      }`}
    >
      {role}
    </span>
  );
}

export default function InvitationsPage({ params }) {
  const { workspaceId } = params;
  const { data: session, status } = useSession();
  const userRole = (session?.user?.role || '').toLowerCase();
  const isAllowedToAccess = ['owner', 'admin', 'maintainer'].includes(userRole);
  const availableRoles = ROLE_OPTIONS[userRole] || ['developer', 'viewer'];

  const token =
    session?.accessToken ||
    (typeof window !== 'undefined' ? localStorage.getItem('pulseops_token') : null);

  const [members, setMembers] = useState([]);
  const [invitations, setInvitations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [inviteOrgEmail, setInviteOrgEmail] = useState('');
  const [invitePersonalEmail, setInvitePersonalEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteRole, setInviteRole] = useState('developer');
  const [sending, setSending] = useState(false);
  const [inviteResult, setInviteResult] = useState(null);
  const [inviteError, setInviteError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (availableRoles.length > 0 && !availableRoles.includes(inviteRole)) {
      setInviteRole(availableRoles[0]);
    }
  }, [userRole, availableRoles, inviteRole]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const headers = {
        Authorization: `Bearer ${token}`,
        'x-organization-id': workspaceId,
        'Content-Type': 'application/json',
      };
      const [membersRes] = await Promise.all([
        fetchWithTimeout(`${API_BASE}/api/organizations/members`, { headers }, 10000),
      ]);
      if (membersRes.ok) {
        const data = await membersRes.json();
        setMembers(data.members || []);
        setInvitations(data.invitations || []);
      } else if (membersRes.status === 403) {
        setError('Forbidden. You do not have permission to view team members.');
      } else {
        setError(`Failed to load workspace members (${membersRes.status}).`);
      }
    } catch (e) {
      setError('Failed to load workspace members.');
    } finally {
      setLoading(false);
    }
  }, [token, workspaceId]);

  useEffect(() => {
    if (token) fetchData();
  }, [fetchData, token]);

  const handleInvite = async (e) => {
    e.preventDefault();
    setInviteError('');
    setInviteResult(null);

    const targetEmail = inviteOrgEmail.trim() || invitePersonalEmail.trim();
    if (!targetEmail) {
      setInviteError('Please enter an Organization Email or Personal Email.');
      return;
    }

    setSending(true);
    try {
      const { data: inviteData, res } = await fetchJSONWithTimeout(`${API_BASE}/api/organizations/invite`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'x-organization-id': workspaceId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: targetEmail,
          orgEmail: inviteOrgEmail.trim(),
          personalEmail: invitePersonalEmail.trim(),
          name: inviteName.trim(),
          role: inviteRole,
        }),
      });
      if (!res.ok) {
        setInviteError(data?.message || 'Failed to send invitation.');
      } else {
        setInviteResult(data);
        setInviteOrgEmail('');
        setInvitePersonalEmail('');
        setInviteName('');
        fetchData();
      }
    } catch {
      setInviteError('Could not reach the server. Please try again.');
    } finally {
      setSending(false);
    }
  };

  const copyLink = () => {
    if (!inviteResult?.inviteUrl) return;
    navigator.clipboard.writeText(inviteResult.inviteUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  if (status !== 'loading' && session && !isAllowedToAccess) {
    return (
      <div className="max-w-2xl mx-auto my-12 p-8 rounded-2xl border border-rose-200 bg-white shadow-xs text-center space-y-4">
        <div className="mx-auto w-12 h-12 rounded-full bg-rose-100 flex items-center justify-center text-rose-600">
          <ShieldAlert className="w-6 h-6" />
        </div>
        <h2 className="text-xl font-bold text-slate-900">Access Denied (403)</h2>
        <p className="text-sm text-slate-600">
          You do not have permission to view or manage team invitations in this workspace. Only Owners, Admins, and Maintainers may access this page.
        </p>
        <Link
          href={`/workspace/${workspaceId}`}
          className="inline-flex items-center justify-center rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 transition-colors"
        >
          Return to Overview
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-10">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-[#E9E9E7]">Team & Invitations</h1>
        <p className="mt-2 text-sm text-slate-500 dark:text-[#9B9B9B]">
          Manage workspace members and invite new teammates.
        </p>
      </div>

      {/* Invite form */}
      <div className="rounded-xl border border-slate-200 dark:border-[#2F2F2F] bg-white dark:bg-[#202020] p-6 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900 dark:text-[#E9E9E7] mb-4">Invite a teammate</h2>
        <form onSubmit={handleInvite} className="flex flex-col gap-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input
              type="email"
              placeholder="Organization Email (e.g., colleague@company.com)"
              value={inviteOrgEmail}
              onChange={(e) => setInviteOrgEmail(e.target.value)}
              className="w-full rounded-lg border border-slate-300 dark:border-[#2F2F2F] bg-white dark:bg-[#202020] text-slate-900 dark:text-[#E9E9E7] placeholder-slate-400 dark:placeholder-[#6F6F6F] px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
            />
            <input
              type="email"
              placeholder="Personal Email (e.g., colleague@gmail.com)"
              value={invitePersonalEmail}
              onChange={(e) => setInvitePersonalEmail(e.target.value)}
              className="w-full rounded-lg border border-slate-300 dark:border-[#2F2F2F] bg-white dark:bg-[#202020] text-slate-900 dark:text-[#E9E9E7] placeholder-slate-400 dark:placeholder-[#6F6F6F] px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
            />
            <input
              type="text"
              placeholder="Name (Optional)"
              value={inviteName}
              onChange={(e) => setInviteName(e.target.value)}
              className="w-full rounded-lg border border-slate-300 dark:border-[#2F2F2F] bg-white dark:bg-[#202020] text-slate-900 dark:text-[#E9E9E7] placeholder-slate-400 dark:placeholder-[#6F6F6F] px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
            />
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value)}
              className="w-full rounded-lg border border-slate-300 dark:border-[#2F2F2F] bg-white dark:bg-[#202020] text-slate-900 dark:text-[#E9E9E7] px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 capitalize"
            >
              {availableRoles.map((r) => (
                <option key={r} value={r} className="capitalize bg-white dark:bg-[#202020] text-slate-900 dark:text-[#E9E9E7]">
                  {r}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            disabled={sending}
            className="self-end inline-flex items-center justify-center rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 disabled:opacity-60 cursor-pointer"
          >
            {sending ? 'Sending…' : 'Send Invite'}
          </button>
        </form>

        {inviteError && (
          <div className="mt-3 rounded-lg border border-rose-200 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 text-sm text-rose-800 dark:text-rose-300">
            {inviteError}
          </div>
        )}

        {inviteResult && (
          <div className="mt-3 rounded-lg border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50 dark:bg-emerald-950/30 px-4 py-3 text-sm text-emerald-900 dark:text-emerald-300 space-y-2">
            <p className="font-medium">✓ Invitation sent!</p>
            {inviteResult.tempPassword && (
              <div>
                <p className="text-emerald-700 dark:text-emerald-400">Temporary password (share securely):</p>
                <div className="mt-1 rounded bg-white dark:bg-[#191919] border border-emerald-200 dark:border-emerald-800 px-3 py-2 font-mono text-lg font-bold tracking-widest text-slate-800 dark:text-emerald-300">
                  {inviteResult.tempPassword}
                </div>
                <p className="mt-1 text-xs text-emerald-600 dark:text-emerald-400">
                  The invitee will be required to change this on first login.
                </p>
              </div>
            )}
            {inviteResult.inviteUrl && (
              <p className="text-xs text-emerald-700 dark:text-emerald-400 break-all">
                <span className="font-medium">Login link: </span>
                <a
                  href={inviteResult.inviteUrl}
                  className="underline underline-offset-2"
                  target="_blank"
                  rel="noreferrer"
                >
                  {inviteResult.inviteUrl}
                </a>
              </p>
            )}
          </div>
        )}
      </div>

      {/* Members table */}
      <div className="rounded-xl border border-slate-200 dark:border-[#2F2F2F] bg-white dark:bg-[#202020] shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 dark:border-[#2F2F2F]">
          <h2 className="text-base font-semibold text-slate-900 dark:text-[#E9E9E7]">Active members</h2>
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-200 border-t-indigo-500" />
          </div>
        ) : error ? (
          <p className="p-6 text-sm text-rose-600">{error}</p>
        ) : members.length === 0 ? (
          <p className="p-6 text-sm text-slate-400 dark:text-[#9B9B9B]">No members found.</p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-[#2F2F2F]">
            {members.map((m) => (
              <li key={m.userId || m._id} className="flex items-center justify-between px-6 py-4 hover:bg-slate-50/50 dark:hover:bg-[#2A2A2A] transition-colors">
                <div>
                  <p className="text-sm font-medium text-slate-900 dark:text-[#E9E9E7]">{m.name || m.email || 'Unknown'}</p>
                  {m.email && m.name && (
                    <p className="text-xs text-slate-500 dark:text-[#9B9B9B] mt-0.5">{m.email}</p>
                  )}
                </div>
                <RoleBadge role={m.role} />
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Pending invitations */}
      {invitations.length > 0 && (
        <div className="rounded-xl border border-slate-200 dark:border-[#2F2F2F] bg-white dark:bg-[#202020] shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 dark:border-[#2F2F2F]">
            <h2 className="text-base font-semibold text-slate-900 dark:text-[#E9E9E7]">
              Pending invitations
              <span className="ml-2 inline-flex items-center rounded-full bg-amber-50 dark:bg-amber-950/40 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300 ring-1 ring-inset ring-amber-600/20">
                {invitations.length}
              </span>
            </h2>
          </div>
          <ul className="divide-y divide-slate-100 dark:divide-[#2F2F2F]">
            {invitations.map((inv) => (
              <li key={inv._id} className="flex items-center justify-between px-6 py-4 hover:bg-slate-50/50 dark:hover:bg-[#2A2A2A] transition-colors">
                <div>
                  <p className="text-sm font-medium text-slate-900 dark:text-[#E9E9E7]">{inv.email}</p>
                  <p className="text-xs text-slate-400 dark:text-[#9B9B9B] mt-0.5">
                    Expires {new Date(inv.expiresAt).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <RoleBadge role={inv.role} />
                  <span className="inline-flex items-center rounded-full bg-amber-50 dark:bg-amber-950/40 px-2.5 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300 ring-1 ring-inset ring-amber-600/20">
                    Pending
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

