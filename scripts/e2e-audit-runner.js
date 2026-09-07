#!/usr/bin/env node
/**
 * TASK-113 — End-to-End Dummy-Data Audit Runner.
 *
 * Boots the real Express app in-process (server.js exports the app), connects
 * to the real MongoDB, stubs the SMTP transporters so verification/invite
 * links are captured locally (no email leaves this machine), then executes the
 * full multi-user lifecycle:
 *
 *   Scenario A — Workspace Owner lifecycle (Credentials / Case 1)
 *     register -> verify-email -> login -> onboard -> /me
 *   Scenario B — Developer invitation & acceptance (Case 1.5)
 *     owner invites -> invitee self-registers (pending-invite aware) ->
 *     verifies -> logs in with inviteToken -> RBAC 403 guard
 *   Scenario C — OAuth user lifecycle (Case 2)
 *     oauth/sync auto-verification + onboarding gate precondition
 *   Scenario D — Workspace switcher round-trip (TASK-107)
 *
 * Usage: node scripts/e2e-audit-runner.js
 * Env:   EXPRESS_BASE_URL=<url>  optional — run against an already-started
 *        server instead of embedding one (skips DB verification).
 *
 * Note: the corporate DNS on this machine refuses mongodb+srv SRV lookups, so
 * this runner applies the same Google-DNS override that server.js applies in
 * non-production before anything resolves the connection string.
 */
'use strict';

const path = require('path');
const dns = require('dns');

if (process.env.NODE_ENV !== 'production') {
  dns.setServers(['8.8.8.8', '8.8.4.4']);
}

const SERVER_DIR = path.resolve(__dirname, '..', 'server');
// Deps live in the server's pnpm node_modules; the scripts dir has none.
require(path.join(SERVER_DIR, 'node_modules', 'dotenv')).config({
  path: path.join(SERVER_DIR, '.env'),
});

const crypto = require('crypto');
const jwt = require(path.join(SERVER_DIR, 'node_modules', 'jsonwebtoken'));

const mongoose = require(path.join(SERVER_DIR, 'node_modules', 'mongoose'));

// ---------------------------------------------------------------------------
// SMTP interception — capture every outgoing mail so we can extract the raw
// verification + invitation tokens exactly like a real inbox would.
//
// IMPORTANT: this stub MUST be installed BEFORE server.js / authRoutes /
// orgRoutes are required. Those modules destructure `sendMail` from the mailer
// module at require time, so stubbing later would leave them bound to the real
// nodemailer transporter (and this machine would attempt a real Gmail send).
// ---------------------------------------------------------------------------
const mailerModule = require(path.join(SERVER_DIR, 'src', 'utils', 'mailer'));
const sentMails = [];
mailerModule.sendMail = async (mail) => {
  sentMails.push(mail);
  // Match the real mailer contract { ok, info, error } so routes don't log
  // spurious "Email send failed" lines when the capture succeeds.
  return {
    ok: true,
    info: { messageId: `e2e-stub-${sentMails.length}` },
    error: null,
  };
};

const app = require(path.join(SERVER_DIR, 'server.js'));

const User = require(path.join(SERVER_DIR, 'src', 'models', 'User'));
const Organization = require(path.join(SERVER_DIR, 'src', 'models', 'Organization'));
const OrganizationMember = require(path.join(SERVER_DIR, 'src', 'models', 'OrganizationMember'));
const Invitation = require(path.join(SERVER_DIR, 'src', 'models', 'Invitation'));

// ---------------------------------------------------------------------------
// Dummy-data fixtures (spec Part 2)
// ---------------------------------------------------------------------------
const OWNER_EMAIL = 'owner@acmelabs.io';
const OWNER_PASSWORD = 'Password123!';
const WORKSPACE_NAME = 'Acme Cloud Ops';
const WORKSPACE_TEAM_SIZE = '11-50'; // spec says "10-50"; model enum is '11-50'
const WORKSPACE_FOCUS = 'Infrastructure Monitoring';

const DEV_EMAIL = 'dev@acmelabs.io';
const DEV_PASSWORD = 'TempPass2026!';
const DEV_NAME = 'Alex Rivera';
const DEV_ROLE = 'developer';

const OAUTH_EMAIL = 'oauth.user@gmail.com';
const OAUTH_NAME = 'OAuth User';

// ---------------------------------------------------------------------------
// Assertion harness
// ---------------------------------------------------------------------------
const results = [];
const check = (name, condition, detail = '') => {
  results.push({ name, pass: Boolean(condition), detail });
  if (!condition) {
    console.error(`  [FAIL] ${name}${detail ? `  (${detail})` : ''}`);
  }
};

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

const extractQueryParam = (value, param) => {
  const m = String(value).match(new RegExp(`[?&]${param}=([^&"'<>\\s]+)`));
  return m ? decodeURIComponent(m[1]) : null;
};

const decodeJwt = (token) => jwt.verify(token, process.env.JWT_SECRET);

const findMail = (substring) => sentMails.find((m) => JSON.stringify(m).includes(substring));

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------
let BASE = null;
const request = async (route, { method = 'GET', body, token } = {}) => {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token.trim()}`;
  const res = await fetch(`${BASE}${route}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
};

// ---------------------------------------------------------------------------
// DB cleanup — makes re-runs idempotent (dummy data only, exact fixture emails)
// ---------------------------------------------------------------------------
const FIXTURE_EMAILS = [OWNER_EMAIL, DEV_EMAIL, OAUTH_EMAIL];

const PendingRegistration = require(path.join(SERVER_DIR, 'src', 'models', 'PendingRegistration'));
const PasswordReset = require(path.join(SERVER_DIR, 'src', 'models', 'PasswordReset'));

const cleanup = async () => {
  const users = await User.find({ email: { $in: FIXTURE_EMAILS } });
  const userIds = users.map((u) => u._id);
  const orgs = await Organization.find({ ownerId: { $in: userIds } });
  const orgIds = orgs.map((o) => o._id);

  await Invitation.deleteMany({
    $or: [{ email: { $in: FIXTURE_EMAILS } }, { organizationId: { $in: orgIds } }],
  });
  await OrganizationMember.deleteMany({
    $or: [{ userId: { $in: userIds } }, { organizationId: { $in: orgIds } }],
  });
  await PendingRegistration.deleteMany({ email: { $in: FIXTURE_EMAILS } });
  await PasswordReset.deleteMany({ email: { $in: FIXTURE_EMAILS } });
  await Organization.deleteMany({ _id: { $in: orgIds } });
  await User.deleteMany({ _id: { $in: userIds } });

  return { users: userIds.length, orgs: orgIds.length };
};

// ---------------------------------------------------------------------------
// Scenario A — Workspace Owner lifecycle (Credentials / Case 1)
// ---------------------------------------------------------------------------
const runScenarioA = async () => {
  console.log('\n  Scenario A — Workspace Owner lifecycle (Credentials / Case 1)');

  // A1 — register
  const reg = await request('/api/auth/register', {
    method: 'POST',
    body: { email: OWNER_EMAIL, password: OWNER_PASSWORD, name: 'Workspace Owner', username: 'owner' },
  });
  check(
    'A1 register -> 201, hasPendingInvite:false',
    reg.status === 201 && reg.data.hasPendingInvite === false,
    `status=${reg.status}`
  );

  // A2 — DB state after register (PendingRegistration created, no real User yet)
  const PendingRegistration = require(path.join(SERVER_DIR, 'src', 'models', 'PendingRegistration'));
  const ownerPending = await PendingRegistration.findOne({ email: OWNER_EMAIL });
  check(
    'A2 DB: PendingRegistration created with OTP hash, no real User yet',
    !!ownerPending &&
      !!ownerPending.verificationTokenHash &&
      !!ownerPending.verificationTokenExpires &&
      ownerPending.passwordHash
  );
  // Verify no real User exists yet
  const ownerDoc = await User.findOne({ email: OWNER_EMAIL });
  check('A2 DB: no real User record yet (created on OTP verify)', !ownerDoc);

  // A3 — OTP verification (extract 6-digit code from the stubbed mail)
  const verifyMails = sentMails.filter((m) => m.subject && m.subject.includes('verification code'));
  const verifyMail = verifyMails[verifyMails.length - 1];
  const verifyOtp = verifyMail ? (verifyMail.html.match(/(\d{6})/)?.[1] || null) : null;
  const verifyRes = await request('/api/auth/verify-email', {
    method: 'POST',
    body: { email: OWNER_EMAIL, otp: verifyOtp },
  });
  const ownerAfterVerify = await User.findOne({ email: OWNER_EMAIL });
  check(
    'A3 verify-email -> 200, DB isVerified=true, token cleared',
    verifyRes.status === 200 &&
      ownerAfterVerify.isVerified === true &&
      !ownerAfterVerify.verificationTokenHash,
    `status=${verifyRes.status}`
  );

  // A4 — login -> JWT
  const login = await request('/api/auth/login', {
    method: 'POST',
    body: { email: OWNER_EMAIL, password: OWNER_PASSWORD },
  });
  let ownerJwt = null;
  try {
    ownerJwt = decodeJwt(login.data.token);
  } catch {
    /* captured below */
  }
  check(
    'A4 login -> 200 JWT {userId,email,activeOrganizationId:null,role:null}',
    login.status === 200 &&
      ownerJwt &&
      ownerJwt.userId &&
      ownerJwt.email === OWNER_EMAIL &&
      ownerJwt.activeOrganizationId === null &&
      ownerJwt.role === null,
    `status=${login.status}`
  );

  // A5 — onboarding
  const onboard = await request('/api/organizations/onboard', {
    method: 'POST',
    token: login.data.token,
    body: {
      name: WORKSPACE_NAME,
      teamSize: WORKSPACE_TEAM_SIZE,
      primaryFocus: WORKSPACE_FOCUS,
    },
  });
  const orgId = onboard.data?.organization?._id;
  check(
    'A5 onboard -> 201 + org {name,teamSize,primaryFocus}',
    onboard.status === 201 &&
      !!orgId &&
      onboard.data.organization.name === WORKSPACE_NAME &&
      onboard.data.organization.teamSize === WORKSPACE_TEAM_SIZE &&
      onboard.data.organization.primaryFocus === WORKSPACE_FOCUS,
    `status=${onboard.status}`
  );

  // A6 — DB: organization + owner membership + user.activeOrganizationId
  const orgDoc = orgId ? await Organization.findById(orgId) : null;
  const ownerMember = orgId
    ? await OrganizationMember.findOne({ organizationId: orgId, userId: ownerAfterVerify._id })
    : null;
  const ownerReloaded = await User.findById(ownerAfterVerify._id);
  check(
    'A6 DB: Organization + owner member(active) + user.activeOrganizationId set',
    !!orgDoc &&
      orgDoc.slug &&
      String(orgDoc.ownerId) === String(ownerAfterVerify._id) &&
      ownerMember &&
      ownerMember.role === 'owner' &&
      ownerMember.status === 'active' &&
      String(ownerReloaded.activeOrganizationId) === String(orgDoc._id)
  );

  // A7 — onboard JWT carries the new tenant context
  const onboardJwt = (() => {
    try {
      return decodeJwt(onboard.data.token);
    } catch {
      return null;
    }
  })();
  check(
    'A7 onboard JWT: activeOrganizationId + role=owner',
    !!onboardJwt &&
      !!orgDoc &&
      onboardJwt.activeOrganizationId === String(orgDoc._id) &&
      onboardJwt.role === 'owner' &&
      onboardJwt.email === OWNER_EMAIL
  );

  // A8 — /me reflects the workspace (dashboard data contract)
  const me = await request('/api/auth/me', { token: onboard.data.token });
  check(
    'A8 /me: workspaces includes Acme Cloud Ops, role=owner, 1 workspace',
    me.status === 200 &&
      me.data.workspaces?.length === 1 &&
      me.data.workspaces[0].name === WORKSPACE_NAME &&
      me.data.workspaces[0].role === 'owner' &&
      me.data.role === 'owner' &&
      me.data.hasWorkspace === true,
    `status=${me.status}`
  );

  return { ownerToken: onboard.data.token, orgId: String(orgDoc ? orgDoc._id : '') };
};

// ---------------------------------------------------------------------------
// Scenario B — Developer invitation & acceptance
// ---------------------------------------------------------------------------
const runScenarioB = async (ownerToken, orgId) => {
  console.log('\n  Scenario B — Developer invitation & acceptance');

  // B1 — owner invites the developer (new user -> OTP-based acceptance)
  const invite = await request('/api/organizations/invite', {
    method: 'POST',
    token: ownerToken,
    body: { email: DEV_EMAIL, role: DEV_ROLE },
  });
  const inviteMail = findMail('inviteToken=');
  const rawInviteToken = inviteMail
    ? extractQueryParam(inviteMail.text, 'inviteToken')
    : null;
  const mailOrgEmail = inviteMail ? extractQueryParam(inviteMail.text, 'orgEmail') : null;
  const inviteOtp = inviteMail
    ? (inviteMail.text.match(/Invitation Code: (\d{6})/)?.[1] || null)
    : null;
  check(
    'B1 invite -> 200, mail carries orgEmail + inviteToken + 6-digit code',
    invite.status === 200 &&
      invite.data.success === true &&
      invite.data.inviteOtp === inviteOtp &&
      !!rawInviteToken &&
      mailOrgEmail === DEV_EMAIL &&
      /^\d{6}$/.test(inviteOtp || ''),
    `status=${invite.status}`
  );

  // B2 — DB: pending invitation with sha256 tokenHash + 7-day expiry + OTP hash
  const inviteDoc = await Invitation.findOne({ email: DEV_EMAIL, status: 'pending' });
  const expiryDrift = inviteDoc ? inviteDoc.expiresAt.getTime() - Date.now() : 0;
  check(
    'B2 DB: Invitation pending, role=developer, tokenHash=sha256(raw), otpHash set, ~7d expiry',
    !!inviteDoc &&
      String(inviteDoc.organizationId) === orgId &&
      inviteDoc.role === DEV_ROLE &&
      inviteDoc.tokenHash === sha256(rawInviteToken) &&
      inviteDoc.otpHash === sha256(inviteOtp) &&
      !!inviteDoc.otpExpiresAt &&
      expiryDrift > 6.9 * 24 * 60 * 60 * 1000 &&
      expiryDrift < 7.1 * 24 * 60 * 60 * 1000
  );

  // B3 — invite created the User WITHOUT a password (OTP acceptance); first login
  // must set one (mustChangePassword).
  const devDoc = await User.findOne({ email: DEV_EMAIL });
  check(
    'B3 DB: invite created User (isVerified=true, credentials, NO passwordHash, mustChangePassword)',
    !!devDoc &&
      devDoc.isVerified === true &&
      devDoc.authProvider === 'credentials' &&
      !devDoc.passwordHash &&
      devDoc.mustChangePassword === true,
    `found=${!!devDoc}`
  );

  // B4 — accept via OTP: login with the 6-digit code + invite link token
  const loginDev = await request('/api/auth/login', {
    method: 'POST',
    body: { email: DEV_EMAIL, inviteOtp, inviteToken: rawInviteToken },
  });
  const inviteJwt = (() => {
    try {
      return decodeJwt(loginDev.data.token);
    } catch {
      return null;
    }
  })();
  check(
    'B4 login with invitation code + inviteToken -> membership applied (org + role=developer)',
    loginDev.status === 200 &&
      loginDev.data.user.hasPassword === false &&
      loginDev.data.user.mustChangePassword === true &&
      inviteJwt &&
      inviteJwt.activeOrganizationId === orgId &&
      inviteJwt.role === DEV_ROLE,
    `status=${loginDev.status}`
  );

  // B5 — no password and no code -> cannot sign in
  const loginPlain = await request('/api/auth/login', {
    method: 'POST',
    body: { email: DEV_EMAIL, password: DEV_PASSWORD },
  });
  check(
    'B5 login without invitation code -> 401 invalid credentials (no password set yet)',
    loginPlain.status === 401,
    `status=${loginPlain.status}`
  );

  // B6 — set own password (initial set — no currentPassword needed), then sign in
  const setPw = await request('/api/auth/change-password', {
    method: 'POST',
    token: loginDev.data.token,
    body: { newPassword: DEV_PASSWORD },
  });
  check(
    'B6 change-password (initial set) -> 200, mustChangePassword cleared, hasPassword true',
    setPw.status === 200 &&
      setPw.data.user.mustChangePassword === false &&
      setPw.data.user.hasPassword === true,
    `status=${setPw.status}`
  );
  const loginWithPassword = await request('/api/auth/login', {
    method: 'POST',
    body: { email: DEV_EMAIL, password: DEV_PASSWORD },
  });
  const devToken = loginWithPassword.data.token || setPw.data.token;
  check(
    'B6b login with newly set password -> 200',
    loginWithPassword.status === 200 && !!loginWithPassword.data.token,
    `status=${loginWithPassword.status}`
  );

  // B7 — DB: active membership + accepted invitation + user org set + passwordHash
  const devMember = await OrganizationMember.findOne({
    organizationId: orgId,
    userId: devDoc._id,
  });
  const acceptedInvite = await Invitation.findOne({ email: DEV_EMAIL, status: 'accepted' });
  const devReloaded = await User.findById(devDoc._id);
  check(
    'B7 DB: membership(developer/active) + invitation accepted + user org set',
    !!devMember &&
      devMember.role === DEV_ROLE &&
      devMember.status === 'active' &&
      !!acceptedInvite &&
      !!devReloaded.passwordHash &&
      String(devReloaded.activeOrganizationId) === orgId
  );

  // B8 — RBAC guard: a developer cannot invite teammates (owner/admin only).
  const rbac = await request('/api/organizations/invite', {
    method: 'POST',
    token: devToken,
    body: { email: 'another@acmelabs.io', role: 'developer' },
  });
  check(
    'B8 RBAC: developer invite attempt -> 403 insufficient permissions',
    rbac.status === 403 && rbac.data.message === 'Forbidden. Insufficient permissions.',
    `status=${rbac.status}`
  );

  // B9 — tenant guard: switching to a foreign org -> 403.
  const foreignId = new mongoose.Types.ObjectId();
  const foreign = await request('/api/organizations/switch-org', {
    method: 'POST',
    token: devToken,
    body: { targetOrganizationId: foreignId.toString() },
  });
  check(
    'B9 switch-org to non-member org -> 403',
    foreign.status === 403 &&
      foreign.data.message === 'Forbidden. You are not an active member of this organization.',
    `status=${foreign.status}`
  );
};

// ---------------------------------------------------------------------------
// Scenario C — OAuth user lifecycle (Case 2)
// ---------------------------------------------------------------------------
const runScenarioC = async () => {
  console.log('\n  Scenario C — OAuth user lifecycle (Case 2)');

  // C1 — mock Google OAuth callback payload -> oauth/sync
  const sync = await request('/api/auth/oauth/sync', {
    method: 'POST',
    body: { email: OAUTH_EMAIL, name: OAUTH_NAME },
  });
  const syncJwt = (() => {
    try {
      return decodeJwt(sync.data.token);
    } catch {
      return null;
    }
  })();
  check(
    'C1 oauth/sync -> 200 JWT + auto-verified user (no active org)',
    sync.status === 200 &&
      !!syncJwt &&
      syncJwt.email === OAUTH_EMAIL &&
      sync.data.user.activeOrganizationId === null,
    `status=${sync.status}`
  );

  // C2 — DB: OAuth user is verified with no password hash
  const oauthDoc = await User.findOne({ email: OAUTH_EMAIL });
  check(
    'C2 DB: isVerified=true, authProvider=google, no passwordHash',
    !!oauthDoc &&
      oauthDoc.isVerified === true &&
      oauthDoc.authProvider === 'google' &&
      !oauthDoc.passwordHash
  );

  // C3 — /me with no org -> onboarding gate precondition (middleware TASK-110)
  const me = await request('/api/auth/me', { token: sync.data.token });
  check(
    'C3 /me: activeOrganizationId=null, 0 workspaces -> client gates to /onboarding',
    me.status === 200 &&
      me.data.activeOrganizationId === null &&
      me.data.workspaces.length === 0,
    `status=${me.status}`
  );
};

// ---------------------------------------------------------------------------
// Scenario D — Workspace switcher round-trip (TASK-107)
// ---------------------------------------------------------------------------
const runScenarioD = async (ownerToken) => {
  console.log('\n  Scenario D — Workspace switcher round-trip (TASK-107)');

  const secondOrg = await request('/api/organizations/onboard', {
    method: 'POST',
    token: ownerToken,
    body: { name: 'Acme Cloud Ops (Backup)', teamSize: '1-10', primaryFocus: 'Other' },
  });
  check(
    'D1 onboard second org -> 201',
    secondOrg.status === 201 && !!secondOrg.data?.organization?._id,
    `status=${secondOrg.status}`
  );

  const switchRes = await request('/api/organizations/switch-org', {
    method: 'POST',
    token: ownerToken,
    body: { targetOrganizationId: secondOrg.data?.organization?._id },
  });
  const switchJwt = (() => {
    try {
      return decodeJwt(switchRes.data.token);
    } catch {
      return null;
    }
  })();
  check(
    'D2 switch-org -> 200 + rotated JWT {org, role=owner}',
    switchRes.status === 200 &&
      switchJwt &&
      switchJwt.activeOrganizationId === secondOrg.data.organization._id.toString() &&
      switchJwt.role === 'owner',
    `status=${switchRes.status}`
  );

  const meAfter = await request('/api/auth/me', { token: switchRes.data.token });
  check(
    'D3 /me now lists both workspaces',
    meAfter.status === 200 && meAfter.data.workspaces.length === 2,
    `status=${meAfter.status}`
  );
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const redactUri = (uri) => {
  try {
    const u = new URL(uri);
    u.username = '***';
    u.password = '***';
    u.search = '';
    u.hash = '';
    return u.toString();
  } catch {
    return '[unparseable]';
  }
};

(async () => {
  console.log('==============================================================');
  console.log('  PULSEOPS E2E AUDIT RUNNER — TASK-113');
  console.log(
    `  Mode: ${process.env.EXPRESS_BASE_URL ? 'external server' : 'embedded Express + live MongoDB'}`
  );
  console.log(`  DB:   ${redactUri(process.env.MONGO_URI)}`);
  console.log('==============================================================');

  let server = null;
  try {
    if (process.env.EXPRESS_BASE_URL) {
      BASE = process.env.EXPRESS_BASE_URL.replace(/\/$/, '');
      console.log(`  Using external server at ${BASE} — skipping DB connect.`);
    } else {
      server = await new Promise((resolve) => {
        const s = app.listen(0, () => resolve(s));
      });
      BASE = `http://127.0.0.1:${server.address().port}`;
      console.log(`  Embedded server listening on ${BASE}`);

      await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000 });
      console.log('  MongoDB connected');
    }

    const removed = await cleanup();
    console.log(
      `  Cleaned up prior fixtures: ${removed.users} user(s), ${removed.orgs} org(s)`
    );

    const { ownerToken, orgId } = await runScenarioA();
    await runScenarioB(ownerToken, orgId);
    await runScenarioC();
    await runScenarioD(ownerToken);

    // Summary
    const passed = results.filter((r) => r.pass).length;
    const failed = results.length - passed;
    console.log('\n' + '-'.repeat(60));
    results.forEach((r) => {
      console.log(
        `  [${r.pass ? 'PASS' : 'FAIL'}] ${r.name}${r.detail ? `  (${r.detail})` : ''}`
      );
    });
    console.log('-'.repeat(60));
    console.log(
      `  TOTAL: ${results.length} | PASSED: ${passed} | FAILED: ${failed}`
    );
    console.log(failed === 0 ? '  ALL_PASS' : '  FAILURES DETECTED');
    console.log('-'.repeat(60));

    const removedEnd = await cleanup();
    console.log(
      `  Fixture data cleaned: ${removedEnd.users} user(s), ${removedEnd.orgs} org(s)`
    );
    process.exit(failed === 0 ? 0 : 1);
  } catch (err) {
    console.error('\n[E2E] Fatal error:', err.message);
    process.exit(1);
  } finally {
    if (server) server.close();
    try {
      await mongoose.disconnect();
    } catch {
      /* ignore */
    }
  }
})();



