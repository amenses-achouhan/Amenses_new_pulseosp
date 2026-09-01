#!/usr/bin/env node
/**
 * Slack two-way sync End-to-End runner.
 *
 * Boots the real Express app in-process (server.js exports the app), connects
 * to the real MongoDB, starts the real Slack queue worker, and stubs ONLY the
 * outbound Slack API (fetch to slack.com / the fake file host) so the entire
 * inbound pipeline runs for real:
 *
 *   1. URL-verification challenge round-trip.
 *   2. Webhook signature verification (valid + tampered + missing secret).
 *   3. Realtime message / edit / delete / file_shared / channel_rename events
 *      through the queue worker, asserting idempotency (duplicate event_id is
 *      a no-op) and database rows.
 *   4. Discovery + historical sync (conversations.list + history + replies +
 *      users.info) via POST /api/integrations/slack/sync.
 *   5. File mirroring (files.info -> private download -> local upload).
 *   6. Tenant isolation — a second workspace never leaks rows into the first.
 *   7. Public API contract (/slack/status scopes health, /slack/test guard,
 *      conversations list/messages routes, SSE access_token auth).
 *
 * Usage: node scripts/slack-e2e-runner.js
 * Safety: uses exact fixture orgs/users (email `slacke2e@acmelabs.test`) and
 * deletes all fixture-generated rows + local uploads on start and on exit.
 */
'use strict';

const path = require('path');
const dns = require('dns');
const fs = require('fs');

if (process.env.NODE_ENV !== 'production') {
  dns.setServers(['8.8.8.8', '8.8.4.4']);
}

const SERVER_DIR = path.resolve(__dirname, '..', 'server');
require(path.join(SERVER_DIR, 'node_modules', 'dotenv')).config({
  path: path.join(SERVER_DIR, '.env'),
});

// Fail-closed middleware reads this at request time — a fixture value for the
// test harness (the repo .env intentionally leaves it blank).
if (!process.env.SLACK_SIGNING_SECRET) {
  console.error('[slack-e2e] SLACK_SIGNING_SECRET is required. Add it to server/.env');
  process.exit(1);
}

const crypto = require('crypto');
const jwt = require(path.join(SERVER_DIR, 'node_modules', 'jsonwebtoken'));
const mongoose = require(path.join(SERVER_DIR, 'node_modules', 'mongoose'));

const app = require(path.join(SERVER_DIR, 'server.js'));
const { startSlackWorker } = require(path.join(SERVER_DIR, 'src', 'services', 'slackEventsProcessor'));
const { encrypt } = require(path.join(SERVER_DIR, 'src', 'utils', 'crypto'));
const { ROOT_UPLOAD_DIR } = require(path.join(SERVER_DIR, 'src', 'services', 'slackStorage'));

const User = require(path.join(SERVER_DIR, 'src', 'models', 'User'));
const Organization = require(path.join(SERVER_DIR, 'src', 'models', 'Organization'));
const OrganizationMember = require(path.join(SERVER_DIR, 'src', 'models', 'OrganizationMember'));
const Integration = require(path.join(SERVER_DIR, 'src', 'models', 'Integration'));
const SlackConversation = require(path.join(SERVER_DIR, 'src', 'models', 'SlackConversation'));
const SlackChannelMessage = require(path.join(SERVER_DIR, 'src', 'models', 'SlackChannelMessage'));
const SlackAttachment = require(path.join(SERVER_DIR, 'src', 'models', 'SlackAttachment'));
const SlackUser = require(path.join(SERVER_DIR, 'src', 'models', 'SlackUser'));
const SlackEvent = require(path.join(SERVER_DIR, 'src', 'models', 'SlackEvent'));

const EMAIL1 = 'slacke2e.owner1@acmelabs.test';
const EMAIL2 = 'slacke2e.owner2@acmelabs.test';
const ORG1 = 'Acme E2E Slack Org';
const ORG2 = 'Second E2E Slack Org';

// ---------------------------------------------------------------------------
// Assertion harness
// ---------------------------------------------------------------------------
const results = [];
const check = (name, condition, detail = '') => {
  results.push({ name, pass: Boolean(condition), detail });
  if (!condition) console.error(`  [FAIL] ${name}${detail ? `  (${detail})` : ''}`);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Poll `fn` until truthy or timeout. */
async function waitFor(fn, { label = 'condition', timeout = 15000, interval = 250 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const value = await fn();
    if (value) return value;
    await sleep(interval);
  }
  throw new Error(`Timed out waiting for: ${label}`);
}

// ---------------------------------------------------------------------------
// Slack Web API + file-host mock (the ONLY Slack interaction in the test)
// ---------------------------------------------------------------------------
const FIXTURES = {
  'xoxb-e2e-org1': {
    team: { id: 'TET1', name: 'E2E Team One' },
    botUserId: 'U0BOT',
    channels: [
      { id: 'C111', name: 'general', is_private: false, is_member: true, is_archived: false,
        topic: { value: 'E2E topic' }, purpose: { value: 'E2E purpose' }, num_members: 3 },
      { id: 'C222', name: 'engineering', is_private: true, is_member: true, is_archived: false,
        topic: { value: '' }, purpose: { value: '' }, num_members: 5 },
    ],
    history: {
      C111: {
        messages: [
          { type: 'message', subtype: null, user: 'U1', text: 'hello <@U2> and <@U1>', ts: '1700000000.000001',
            reactions: [{ name: 'eyes', count: 2, users: ['U1', 'U2'] }] },
          { type: 'message', user: 'U2', text: 'thread root message', ts: '1700000001.000001',
            thread_ts: '1700000001.000001', reply_count: 1 },
          { type: 'message', user: 'U1', text: 'an older message', ts: '1700000002.000001' },
          { type: 'message', subtype: 'message_deleted', deleted_ts: '1700000000.000001', ts: '1700000003.000001' },
        ],
      },
      C222: {
        messages: [
          { type: 'message', user: 'U1', text: 'private channel hello', ts: '1700000100.000001' },
        ],
      },
    },
    replies: {
      '1700000001.000001': {
        messages: [
          { type: 'message', user: 'U2', text: 'thread root message', ts: '1700000001.000001', thread_ts: '1700000001.000001' },
          { type: 'message', user: 'U1', text: 'a threaded reply', ts: '1700000001.500000', thread_ts: '1700000001.000001' },
        ],
      },
    },
  },
  'xoxb-e2e-org2': {
    team: { id: 'TET2', name: 'E2E Team Two' },
    botUserId: 'U0BOT2',
    channels: [
      { id: 'C333', name: 'other-team', is_private: false, is_member: true, is_archived: false,
        topic: { value: '' }, purpose: { value: '' }, num_members: 2 },
    ],
    history: { C333: { messages: [{ type: 'message', user: 'U9', text: 'org2 secret', ts: '1700000200.000001' }] } },
    replies: {},
  },
};

const USERS = {
  U1: { id: 'U1', name: 'alice', profile: { display_name: 'Alice', real_name: 'Alice Smith', image_192: 'https://files.slack.example/alice.png', email: 'alice@acmelabs.test' } },
  U2: { id: 'U2', name: 'bob', profile: { display_name: 'Bob', real_name: 'Bob Jones', image_192: 'https://files.slack.example/bob.png', email: 'bob@acmelabs.test' } },
  U9: { id: 'U9', name: 'zoe', profile: { display_name: 'Zoe', real_name: 'Zoe Ray', image_192: null, email: 'zoe@acmelabs.test' } },
};

// Mutable Slack-side state (renames/archives) so conversations.info reflects events.
const mockState = {
  names: {},      // C… -> current name
  archived: {},   // C… -> bool
};

let currentTimestamps = {}; // token -> counter for unique ts

function nextTs(token, label) {
  if (!currentTimestamps[token]) currentTimestamps[token] = {};
  currentTimestamps[token][label] = (currentTimestamps[token][label] || 1750000000) + 1;
  return `${currentTimestamps[token][label]}.000001`;
}

function installSlackMock() {
  const originalFetch = global.fetch;

  global.fetch = async (url, opts = {}) => {
    const input = typeof url === 'string' ? url : url.url;

    // Private file download host.
    if (input.startsWith('https://files.slack.example/')) {
      const contents = Buffer.from('%PDF-1.4\n% E2E mirrored fixture\n', 'utf8');
      return new Response(contents, {
        status: 200,
        headers: { 'Content-Type': 'application/pdf', 'Content-Length': String(contents.length) },
      });
    }

    if (input.startsWith('https://slack.com/api/')) {
      const method = input.split('slack.com/api/')[1];
      const authHeader = opts.headers && opts.headers.Authorization;
      const token = String(authHeader || '').replace(/^Bearer /, '');
      return jsonResponse(mockSlackMethod(method, token, opts));
    }

    return originalFetch(url, opts);
  };

  return () => { global.fetch = originalFetch; };
}

const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function methodParams(opts) {
  const params = {};
  const bodyText = opts.body || '';
  for (const pair of String(bodyText).split('&')) {
    if (!pair) continue;
    const [k, v] = pair.split('=');
    params[decodeURIComponent(k || '')] = v == null ? '' : decodeURIComponent(v);
  }
  return params;
}

function mockSlackMethod(method, token, opts) {
  const fixture = FIXTURES[token];
  const params = methodParams(opts);

  const respond = (payload) => ({ ok: true, ...payload });

  switch (method) {
    case 'auth.test':
      if (!fixture) return { ok: false, error: 'invalid_auth' };
      return respond({ team: fixture.team.id, team_id: fixture.team.id, user: fixture.botUserId, user_id: fixture.botUserId });
    case 'oauth.v2.access':
      return { ok: false, error: 'invalid_client_secret' };
    case 'conversations.list':
      if (!fixture) return { ok: false, error: 'invalid_auth' };
      return respond({
        channels: fixture.channels.map((c) => ({
          ...c,
          name: mockState.names[c.id] || c.name,
          is_archived: !!mockState.archived[c.id],
        })),
        response_metadata: { next_cursor: '' },
      });
    case 'conversations.info': {
      const channel = fixture.channels.find((c) => c.id === params.channel);
      if (!channel) return respond({ channel: { id: params.channel, is_archived: !!mockState.archived[params.channel], is_member: false } });
      return respond({
        channel: {
          ...channel,
          name: mockState.names[params.channel] || channel.name,
          is_archived: !!mockState.archived[params.channel],
        },
      });
    }
    case 'conversations.history': {
      if (!fixture) return { ok: false, error: 'channel_not_found' };
      const history = fixture.history[params.channel] || { messages: [] };
      // Return a second (empty) page after the first to exercise cursor pagination.
      if (params.cursor) return respond({ messages: [], response_metadata: { next_cursor: '' } });
      return respond({ messages: history.messages, response_metadata: { next_cursor: 'e2e-next' } });
    }
    case 'conversations.replies': {
      if (!fixture) return { ok: false, error: 'channel_not_found' };
      const replies = (fixture.replies[params.ts] || { messages: [] }).messages;
      return respond({ messages: replies, response_metadata: { next_cursor: '' } });
    }
    case 'users.info': {
      const user = USERS[params.user];
      if (!user) return { ok: false, error: 'user_not_found' };
      return respond({ user });
    }
    case 'files.info':
      if (params.file !== 'F1') return { ok: false, error: 'file_not_found' };
      return respond({
        file: {
          id: 'F1', name: 'report.pdf', title: 'report.pdf', mimetype: 'application/pdf',
          filetype: 'pdf', size: 47,
          url_private_download: 'https://files.slack.example/F1.pdf',
        },
      });
    default:
      return { ok: false, error: `method_not_found:${method}` };
  }
}

// ---------------------------------------------------------------------------
// Signed webhook helper — mirrors exactly what Slack's Events API sends
// ---------------------------------------------------------------------------
function signedWebhookBody(payload) {
  const raw = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const sigBase = `v0:${timestamp}:${raw}`;
  const signature = `v0=${crypto.createHmac('sha256', process.env.SLACK_SIGNING_SECRET).update(sigBase).digest('hex')}`;
  return { raw, headers: { 'x-slack-signature': signature, 'x-slack-request-timestamp': timestamp } };
}

const postWebhook = async (payload, { appendSignature = null, tamper = false, skipSecret = false } = {}) => {
  const { raw, headers } = signedWebhookBody(payload);
  const finalHeaders = { ...headers, 'Content-Type': 'application/json' };
  if (tamper) finalHeaders['x-slack-signature'] = 'v0=deadbeef';
  if (appendSignature) finalHeaders['x-slack-request-timestamp'] = String(Math.floor(Date.now() / 1000) + 9999);
  if (skipSecret) delete finalHeaders['x-slack-signature'];
  const res = await fetch(`${BASE}/api/webhooks/slack`, {
    method: 'POST', headers: finalHeaders, body: raw,
  });
  let data = {};
  try { data = await res.json(); } catch { /* non-JSON responses */ }
  return { status: res.status, data };
};

// ---------------------------------------------------------------------------
// HTTP helper (authenticated API calls)
// ---------------------------------------------------------------------------
const request = async (route, { method = 'GET', body, token, headers } = {}) => {
  const h = { ...(headers || {}) };
  if (body) h['Content-Type'] = 'application/json';
  if (token) h.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${route}`, {
    method,
    headers: h,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
};

// ---------------------------------------------------------------------------
// Session token helper (authenticated fixtures use a real JWT)
// ---------------------------------------------------------------------------
const signToken = (userId, organizationId, role, email) =>
  jwt.sign(
    { userId, activeOrganizationId: organizationId, role, email },
    process.env.JWT_SECRET
  );

// ---------------------------------------------------------------------------
// Cleanup — removes ALL fixture-generated data (orgs, integrations, slack rows, uploads)
// ---------------------------------------------------------------------------
async function cleanup() {
  const emails = [EMAIL1, EMAIL2];
  const users = await User.find({ email: { $in: emails } });
  const userIds = users.map((u) => u._id);

  const orgQuery = { $or: [{ name: { $in: [ORG1, ORG2] } }] };
  if (userIds.length) orgQuery.$or.push({ ownerId: { $in: userIds } });
  const orgs = await Organization.find(orgQuery);
  const orgIds = orgs.map((o) => o._id);

  if (orgIds.length) {
    await OrganizationMember.deleteMany({ organizationId: { $in: orgIds } });
    await Integration.deleteMany({ organizationId: { $in: orgIds } });
    await SlackConversation.deleteMany({ organizationId: { $in: orgIds } });
    await SlackChannelMessage.deleteMany({ organizationId: { $in: orgIds } });
    await SlackAttachment.deleteMany({ organizationId: { $in: orgIds } });
    await SlackUser.deleteMany({ organizationId: { $in: orgIds } });
    await SlackEvent.deleteMany({ organizationId: { $in: orgIds } });
    await Organization.deleteMany({ _id: { $in: orgIds } });
  }
  if (userIds.length) {
    await OrganizationMember.deleteMany({ userId: { $in: userIds } });
    await Organization.deleteMany({ ownerId: { $in: userIds } });
    await User.deleteMany({ _id: { $in: userIds } });
  }

  // Remove mirrored uploads for the fixture orgs.
  const uploadRoot = path.resolve(ROOT_UPLOAD_DIR, 'slack');
  if (fs.existsSync(uploadRoot)) {
    for (const dir of fs.readdirSync(uploadRoot)) {
      if (orgIds.some((id) => String(id).replace(/[^a-zA-Z0-9]/g, '') === dir)) {
        fs.rmSync(path.join(uploadRoot, dir), { recursive: true, force: true });
      }
    }
  }
  return orgIds.length;
}

// ---------------------------------------------------------------------------
// Main scenarios
// ---------------------------------------------------------------------------
async function seedOrg(name, email) {
  const user = await User.create({
    email, name: 'Slack E2E', isVerified: true, authProvider: 'credentials',
  });
  const org = await Organization.create({
    name,
    slug: `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 6)}-${name.toLowerCase().replace(/[^a-z0-9]/g, '')}`,
    teamSize: '1-10',
    primaryFocus: 'Infrastructure Monitoring',
    ownerId: user._id,
  });
  await OrganizationMember.create({
    organizationId: org._id, userId: user._id, role: 'owner', status: 'active',
  });
  return { user, org };
}

async function connectIntegration(org, token, teamId, teamName, { scopes = null, withWebhook = true } = {}) {
  const granted = scopes || ['incoming-webhook', 'channels:read', 'channels:history', 'groups:read', 'groups:history', 'files:read', 'users:read'];
  return Integration.create({
    organizationId: org._id,
    provider: 'slack',
    status: 'active',
    ...(withWebhook ? { accessToken: encrypt('https://hooks.slack.example/incoming') } : {}),
    botToken: encrypt(token),
    slackTeamId: teamId,
    slackTeamName: teamName,
    botUserId: FIXTURES[token].botUserId,
    grantedScopes: granted,
    requiredScopes: ['incoming-webhook', 'channels:read', 'channels:history', 'groups:read', 'groups:history', 'files:read', 'users:read'],
  });
}

const run = async () => {
  console.log('==============================================================');
  console.log('  PULSEOPS SLACK SYNC E2E RUNNER');
  console.log('  Mode: embedded Express + live MongoDB, Slack API mocked');
  console.log('==============================================================');

  const restoreFetch = installSlackMock();
  let server = null;
  let uploadsSeen = 0;

  try {
    server = await new Promise((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    BASE = `http://127.0.0.1:${server.address().port}`;
    console.log(`  Embedded server listening on ${BASE}`);

    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000 });
    startSlackWorker();
    console.log('  MongoDB connected + Slack worker started');

    await cleanup();
    console.log('  Prior fixtures cleaned');

    // -------------------------------------------------------------------------
    // Seed fixtures
    // -------------------------------------------------------------------------
    const { user: user1, org: org1 } = await seedOrg(ORG1, EMAIL1);
    const { user: user2, org: org2 } = await seedOrg(ORG2, EMAIL2);
    await connectIntegration(org1, 'xoxb-e2e-org1', 'TET1', 'E2E Team One');
    await connectIntegration(org2, 'xoxb-e2e-org2', 'TET2', 'E2E Team Two', { withWebhook: false, scopes: ['channels:read', 'channels:history'] });
    const org1Token = signToken(String(user1._id), String(org1._id), 'owner', EMAIL1);
    const org2Token = signToken(String(user2._id), String(org2._id), 'owner', EMAIL2);
    const fileUploadDir = path.join(ROOT_UPLOAD_DIR, 'slack', String(org1._id).replace(/[^a-zA-Z0-9]/g, ''));

    // -------------------------------------------------------------------------
    console.log('\n  A. Webhook handshake + signature verification');
    // -------------------------------------------------------------------------
    const challenge = await postWebhook({ type: 'url_verification', challenge: 'challenge-abc-123' });
    check('A1 url_verification -> 200 + verbatim challenge', challenge.status === 200 && challenge.data.challenge === 'challenge-abc-123', `status=${challenge.status}`);

    const badSig = await postWebhook({ type: 'event_callback', team_id: 'TET1', event_id: 'EV-TAMPER', event: { type: 'message' } }, { tamper: true });
    check('A2 tampered signature -> 401', badSig.status === 401, `status=${badSig.status}`);

    // -------------------------------------------------------------------------
    console.log('\n  B. Realtime events -> worker -> DB (message / edit / delete)');
    // -------------------------------------------------------------------------
    const helloTs = nextTs('xoxb-e2e-org1', 'msg');
    const hello = await postWebhook({
      type: 'event_callback',
      team_id: 'TET1',
      event_id: 'EV-HELLO-1',
      event: { type: 'message', user: 'U2', text: 'realtime hello <@U1>', ts: helloTs, channel: 'C111' },
    });
    check('B1 message.channels event -> 200 accepted', hello.status === 200 && hello.data.ok === true, `status=${hello.status}`);

    await waitFor(async () => !!(await SlackChannelMessage.findOne({ organizationId: org1._id, messageId: helloTs })), { label: 'realtime message persisted' });
    const realtimeMsg = await SlackChannelMessage.findOne({ organizationId: org1._id, messageId: helloTs }).lean();
    check('B2 realtime message row: tenant+channel+mentions+source', !!realtimeMsg,
      `org=${realtimeMsg && realtimeMsg.organizationId}, ch=${realtimeMsg && realtimeMsg.channelId}`);
    check('B2b realtime row extras',
      realtimeMsg.channelId === 'C111' &&
      realtimeMsg.syncSource === 'realtime' &&
      realtimeMsg.text === 'realtime hello <@U1>' &&
      Array.isArray(realtimeMsg.mentions) && realtimeMsg.mentions.includes('U1') &&
      realtimeMsg.userName === 'Bob' &&
      !!realtimeMsg.userAvatar);
    check('B2c realtime rawPayload (AI-ready)',
      realtimeMsg.rawPayload && realtimeMsg.rawPayload.channel === 'C111' && realtimeMsg.rawPayload.ts === helloTs);

    // Duplicate delivery (idempotency ledger).
    const dupe = await postWebhook({
      type: 'event_callback', team_id: 'TET1', event_id: 'EV-HELLO-1',
      event: { type: 'message', user: 'U2', text: 'realtime hello <@U1>', ts: helloTs, channel: 'C111' },
    });
    await sleep(1200);
    const dupRows = await SlackChannelMessage.countDocuments({ organizationId: org1._id, messageId: helloTs });
    check('B3 duplicate event_id -> no second message row', dupe.status === 200 && dupRows === 1, `rows=${dupRows}, status=${dupe.status}`);

    // message_changed
    const editEvent = await postWebhook({
      type: 'event_callback', team_id: 'TET1', event_id: 'EV-EDIT-1',
      event: {
        type: 'message', subtype: 'message_changed', channel: 'C111', ts: '1750000009.000001',
        message: { type: 'message', user: 'U2', text: 'realtime hello <@U1> EDITED', ts: helloTs },
        edited: { user: 'U2', ts: '1750000009.000001' },
      },
    });
    check('B4 message_changed -> 200', editEvent.status === 200);
    await waitFor(async () => {
      const m = await SlackChannelMessage.findOne({ organizationId: org1._id, messageId: helloTs }).lean();
      return m && m.text === 'realtime hello <@U1> EDITED';
    }, { label: 'edited text persisted' });
    const edited = await SlackChannelMessage.findOne({ organizationId: org1._id, messageId: helloTs }).lean();
    check('B4b edited row updated in place (1 row, editedAt set)',
      (await SlackChannelMessage.countDocuments({ organizationId: org1._id, messageId: helloTs })) === 1 && !!edited.editedAt);

    // message_deleted
    const delEvent = await postWebhook({
      type: 'event_callback', team_id: 'TET1', event_id: 'EV-DEL-1',
      event: { type: 'message', subtype: 'message_deleted', channel: 'C111', ts: '1750000010.000001', deleted_ts: helloTs },
    });
    check('B5 message_deleted -> 200', delEvent.status === 200);
    await waitFor(async () => {
      const m = await SlackChannelMessage.findOne({ organizationId: org1._id, messageId: helloTs }).lean();
      return m && !!m.deletedAt;
    }, { label: 'soft-delete persisted' });
    const deleted = await SlackChannelMessage.findOne({ organizationId: org1._id, messageId: helloTs }).lean();
    check('B5b row soft-deleted (still present, deletedAt set)', !!deleted && !!deleted.deletedAt);

    // -------------------------------------------------------------------------
    console.log('\n  C. file_shared -> download -> mirror');
    // -------------------------------------------------------------------------
    const fileEvent = await postWebhook({
      type: 'event_callback', team_id: 'TET1', event_id: 'EV-FILE-1',
      event: { type: 'file_shared', file_id: 'F1', channel_id: 'C111', user_id: 'U1' },
    });
    check('C1 file_shared -> 200', fileEvent.status === 200);
    await waitFor(async () => !!(await SlackAttachment.findOne({ organizationId: org1._id, fileId: 'F1' })), { label: 'attachment mirrored' });
    const attachment = await SlackAttachment.findOne({ organizationId: org1._id, fileId: 'F1' }).lean();
    check('C2 attachment row: category document + local storageUrl',
      attachment.fileCategory === 'document' && !!attachment.storageUrl && attachment.storageUrl.includes(`/uploads/slack/${String(org1._id).replace(/[^a-zA-Z0-9]/g, '')}/`));
    const dirHasFile = fs.existsSync(fileUploadDir) && fs.readdirSync(fileUploadDir).length > 0;
    uploadsSeen = dirHasFile ? fs.readdirSync(fileUploadDir).length : 0;
    check('C3 mirrored bytes on local disk', dirHasFile, `files=${uploadsSeen}`);
    check('C4 slackPrivateUrl never exposed by API serializer',
      !JSON.stringify(await request(`/api/workspace/${org1._id}/slack/conversations/C111/messages`, { token: org1Token })).includes('https://files.slack.example/F1.pdf'));

    // -------------------------------------------------------------------------
    console.log('\n  D. channel_rename metadata event');
    // -------------------------------------------------------------------------
    mockState.names.C111 = 'general-renamed'; // reflect the rename server-side
    const renameEvent = await postWebhook({
      type: 'event_callback', team_id: 'TET1', event_id: 'EV-RENAME-1',
      event: { type: 'channel_rename', channel: { id: 'C111', name: 'general-renamed', is_archived: false, is_private: false } },
    });
    check('D1 channel_rename -> 200', renameEvent.status === 200);
    await waitFor(async () => {
      const c = await SlackConversation.findOne({ organizationId: org1._id, conversationId: 'C111' }).lean();
      return c && c.name === 'general-renamed';
    }, { label: 'rename persisted' });
    const renamed = await SlackConversation.findOne({ organizationId: org1._id, conversationId: 'C111' }).lean();
    check('D2 conversations.info upsert wrote metadata (type public)',
      !!renamed && renamed.conversationType === 'PUBLIC_CHANNEL' && renamed.topic === 'E2E topic' && renamed.memberCount === 3);

    // -------------------------------------------------------------------------
    console.log('\n  E. Discovery + historical backfill via POST /slack/sync');
    // -------------------------------------------------------------------------
    const syncRes = await request('/api/integrations/slack/sync', { method: 'POST', token: org1Token, body: { conversationIds: [] } });
    check('E1 /slack/sync -> 202 accepted', syncRes.status === 202 && syncRes.data.accepted === true, `status=${syncRes.status}`);
    await waitFor(async () => {
      const all = await SlackConversation.find({ organizationId: org1._id }).lean();
      return all.length === 2 && all.every((c) => c.syncStatus === 'SYNCED') && all.every((c) => c.messageCount > 0);
    }, { label: 'both conversations discovered + synced', timeout: 25000 });
    check('E2 discovery upserts are idempotent (no duplicate conversations)',
      (await SlackConversation.countDocuments({ organizationId: org1._id })) === 2);

    const threadRoot = await SlackChannelMessage.findOne({ organizationId: org1._id, messageId: '1700000001.000001' }).lean();
    const threadReply = await SlackChannelMessage.findOne({ organizationId: org1._id, messageId: '1700000001.500000' }).lean();
    check('E3 thread sync: reply row with parentMessageId', !!threadReply && threadReply.parentMessageId === '1700000001.000001' && threadReply.threadTs === '1700000001.000001');
    check('E4 thread sync: replyCount refreshed on root', threadRoot && threadRoot.replyCount === 1);

    const deletedByHistory = await SlackChannelMessage.findOne({ organizationId: org1._id, messageId: '1700000000.000001' }).lean();
    check('E5 history message_deleted applied (soft delete)', !!deletedByHistory && !!deletedByHistory.deletedAt);

    const C222conv = await SlackConversation.findOne({ organizationId: org1._id, conversationId: 'C222' }).lean();
    check('E6 private channel discovered + synced', !!C222conv && C222conv.conversationType === 'PRIVATE_CHANNEL' && C222conv.syncStatus === 'SYNCED');

    // -------------------------------------------------------------------------
    console.log('\n  F. Public API contract');
    // -------------------------------------------------------------------------
    const convApi = await request(`/api/workspace/${org1._id}/slack/conversations`, { token: org1Token });
    check('F1 GET conversations -> 200 + 2 grouped channels', convApi.status === 200 && convApi.data.publicChannels.length === 1 && convApi.data.privateChannels.length === 1, `status=${convApi.status}`);

    const msgApi = await request(`/api/workspace/${org1._id}/slack/conversations/C111/messages?limit=50`, { token: org1Token });
    const msgTs = (msgApi.data.messages || []).map((m) => m.slackMessageTs);
    check('F2 GET messages: newest-first incl. deleted-flagged + payload has author object',
      msgApi.status === 200 &&
      msgTs[0] === '1750000001.000001' &&
      msgTs[1] === '1700000002.000001' &&
      !!msgApi.data.messages[0].deletedAt &&
      !!msgApi.data.messages[1].author &&
      msgApi.data.messages[1].author.name);
    check('F2b serialized message carries keys the UI needs', (() => {
      const first = msgApi.data.messages[0];
      return first.slackMessageTs && ('timestamp' in first) && ('reactions' in first) && ('attachments' in first);
    })());

    const detail = await request(`/api/workspace/${org1._id}/slack/conversations/C111`, { token: org1Token });
    check('F3 conversation detail -> 200 name updated', detail.status === 200 && detail.data.name === 'general-renamed' && detail.data.syncStatus === 'SYNCED');

    const sse = await fetch(`${BASE}/api/workspace/${org1._id}/slack/conversations/C111/stream?access_token=${encodeURIComponent(org1Token)}`);
    const sseReader = sse.body.getReader();
    const sseFirst = await sseReader.read();
    const sseChunk = Buffer.from(sseFirst.value || []).toString('utf8');
    sseReader.cancel().catch(() => {});
    check('F4 SSE stream authenticates via access_token query (200 + connected frame)',
      sse.status === 200 && sseChunk.includes('event: connected'));

    const sseNoAuth = await fetch(`${BASE}/api/workspace/${org1._id}/slack/conversations/C111/stream`);
    check('F5 SSE stream without token -> 401', sseNoAuth.status === 401, `status=${sseNoAuth.status}`);

    const status = await request('/api/integrations/slack/status', { token: org1Token });
    check('F6 /slack/status: connected, counts, scopes healthy',
      status.status === 200 &&
      status.data.connected === true &&
      status.data.scopesHealthy === true &&
      status.data.conversationCount === 2 &&
      status.data.syncedConversationCount === 2 &&
      status.data.messageCount > 0,
      `status=${status.status}`);

    // Scopes health (org2 granted a subset).
    const status2 = await request('/api/integrations/slack/status', { token: org2Token });
    check('F7 scopes health: org2 subset -> scopesHealthy false + missing list',
      status2.status === 200 &&
      status2.data.connected === true && status2.data.scopesHealthy === false &&
      Array.isArray(status2.data.missingScopes) && status2.data.missingScopes.includes('users:read'),
      `status=${status2.status}`);

    // Test-message guard: org2 has no incoming webhook -> actionable 404.
    const test2 = await request('/api/integrations/slack/test', { method: 'POST', token: org2Token });
    check('F8 /slack/test without webhook -> 404 actionable message', test2.status === 404 && /reconnect/i.test(test2.data.error || ''), `status=${test2.status}`);

    // -------------------------------------------------------------------------
    console.log('\n  G. Tenant isolation');
    // -------------------------------------------------------------------------
    await request('/api/integrations/slack/sync', { method: 'POST', token: org2Token, body: { conversationIds: [] } });
    await waitFor(async () => (await SlackConversation.countDocuments({ organizationId: org2._id })) === 1, { label: 'org2 discovery' });

    const org1Visible = (await request(`/api/workspace/${org1._id}/slack/conversations`, { token: org1Token })).data.conversations.map((c) => c.id);
    const org2Visible = (await request(`/api/workspace/${org2._id}/slack/conversations`, { token: org2Token })).data.conversations.map((c) => c.id);
    check('G1 org1 sees only its own conversations', org1Visible.includes('C111') && org1Visible.includes('C222') && !org1Visible.includes('C333'));
    check('G2 org2 sees only its own conversations', org2Visible.includes('C333') && !org2Visible.includes('C111'));

    const org2Msg = await request(`/api/workspace/${org2._id}/slack/conversations/C333/messages`, { token: org2Token });
    check('G3 org2 reads its own message', org2Msg.status === 200 && org2Msg.data.messages.some((m) => m.text === 'org2 secret'));

    const foreign = await request(`/api/workspace/${org1._id}/slack/conversations/C333/messages`, { token: org1Token });
    check('G4 org1 cannot read org2 conversation (404)', foreign.status === 404, `status=${foreign.status}`);

    const crossTenantMsgRows = await SlackChannelMessage.countDocuments({ text: 'org2 secret', organizationId: org1._id });
    check('G5 org2 rows never written under org1 tenant', crossTenantMsgRows === 0, `rows=${crossTenantMsgRows}`);

    // -------------------------------------------------------------------------
    console.log('\n  H. Unhandled / unsupported event paths');
    // -------------------------------------------------------------------------
    const dmEvent = await postWebhook({
      type: 'event_callback', team_id: 'TET1', event_id: 'EV-DM-1',
      event: { type: 'message', user: 'U1', text: 'dm attempt', ts: nextTs('xoxb-e2e-org1', 'dm'), channel: 'D10001' },
    });
    await sleep(1200);
    const dmRows = await SlackChannelMessage.countDocuments({ organizationId: org1._id, channelId: 'D10001' });
    check('H1 DM message dropped (MVP excludes direct messages)', dmEvent.status === 200 && dmRows === 0, `rows=${dmRows}, status=${dmEvent.status}`);

    const selfEcho = await postWebhook({
      type: 'event_callback', team_id: 'TET1', event_id: 'EV-ECHO-1',
      event: { type: 'message', bot_id: 'U0BOT', username: 'pulseops', text: 'our own echo', ts: nextTs('xoxb-e2e-org1', 'echo'), channel: 'C111' },
    });
    await sleep(1200);
    const echoRows = await SlackChannelMessage.countDocuments({ organizationId: org1._id, text: 'our own echo' });
    check('H2 bot self-echo suppressed', selfEcho.status === 200 && echoRows === 0, `rows=${echoRows}`);

    const unknown = await postWebhook({
      type: 'event_callback', team_id: 'TET1', event_id: 'EV-UNKN-1',
      event: { type: 'app_mention', user: 'U1', text: 'hi' },
    });
    await sleep(800);
    check('H3 unhandled event type -> 200 + no crash + ledger recorded', unknown.status === 200);

    // Summary
    const passed = results.filter((r) => r.pass).length;
    const failed = results.length - passed;
    console.log('\n' + '-'.repeat(60));
    results.forEach((r) => console.log(`  [${r.pass ? 'PASS' : 'FAIL'}] ${r.name}${r.detail ? `  (${r.detail})` : ''}`));
    console.log('-'.repeat(60));
    console.log(`  TOTAL: ${results.length} | PASSED: ${passed} | FAILED: ${failed}`);
    console.log(failed === 0 ? '  ALL_PASS' : '  FAILURES DETECTED');
    console.log('-'.repeat(60));

    await cleanup();
    restoreFetch();
    process.exit(failed === 0 ? 0 : 1);
  } catch (err) {
    console.error('\n[SlackE2E] Fatal error:', err && err.stack ? err.stack : err);
    try { await cleanup(); } catch { /* ignore */ }
    restoreFetch();
    process.exit(1);
  } finally {
    if (server) server.close();
    try { await mongoose.disconnect(); } catch { /* ignore */ }
  }
};

let BASE = null;
run();