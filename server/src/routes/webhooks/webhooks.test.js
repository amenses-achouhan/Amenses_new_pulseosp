/*
 * Ticket 2 — Webhook route tests (T2-01 … T2-10).
 *
 * Console-script pattern (no jest/supertest). Mounts the real webhook router,
 * mocks Mongoose models (Integration, Activity) via require.cache, and
 * exercises each endpoint over real HTTP with Node's global fetch.
 *
 * Run: node server/src/routes/webhooks/webhooks.test.js
 */
const crypto = require('crypto');
const express = require('express');
const path = require('path');

// Signature secrets must be set BEFORE handlers read them.
process.env.GITHUB_WEBHOOK_SECRET = 'test-github-secret';
process.env.SLACK_SIGNING_SECRET = 'test-slack-secret';

let passed = 0;
let failed = 0;
function check(name, cond, detail = '') {
  if (cond) { passed++; console.log(`✅ ${name}`); }
  else { failed++; console.log(`❌ ${name}${detail ? ` — ${detail}` : ''}`); }
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
const MockIntegration = {
  state: { organizationId: null }, // null => not found / untracked
  lastQuery: null,
  findOne(query) {
    this.lastQuery = query;
    return Promise.resolve(
      this.state.organizationId
        ? { organizationId: this.state.organizationId, metadata: { webhookSecret: 'test-jira-webhook-secret' } }
        : null
    );
  },
};

const MockActivity = {
  created: [],
  create(payload) {
    this.created.push(payload);
    return Promise.resolve({ _id: `mock_${this.created.length}`, ...payload });
  },
  findOneAndUpdate(query, update, options) {
    const payload = update.$set;
    this.created.push(payload);
    return Promise.resolve({ _id: `mock_${this.created.length}`, ...payload });
  },
};

const MockJiraWebhookEvent = {
  create(payload) {
    return Promise.resolve({ _id: `mock_jwe_${Date.now()}`, ...payload });
  },
};

function installMock(rel, fake) {
  const file = require.resolve(path.join(__dirname, rel));
  require.cache[file] = { id: file, filename: file, loaded: true, exports: fake };
}

// Signature helpers (mirror server-side verification).
function ghSignature(secret, rawBody) {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
}
function slackSignature(secret, timestamp, rawBody) {
  const base = `v0:${timestamp}:${rawBody}`;
  return `v0=${crypto.createHmac('sha256', secret).update(base).digest('hex')}`;
}
function jiraSignature(secret, rawBody) {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
}

async function runTests() {
  installMock('../../models/Integration', MockIntegration);
  installMock('../../models/Activity', MockActivity); // model uses a DEFAULT export
  installMock('../../models/JiraWebhookEvent', MockJiraWebhookEvent);

  const webhookRoutes = require('./index');

  const app = express();
  app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));
  app.use('/api/webhooks', webhookRoutes);

  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/webhooks`;

  const fixtures = require('../../../test/fixtures/github');
  const slackFixtures = require('../../../test/fixtures/slack');
  const jiraFixtures = require('../../../test/fixtures/jira');

  const ghRaw = Buffer.from(JSON.stringify(fixtures.prOpened), 'utf8');
  const ghMergedRaw = Buffer.from(JSON.stringify(fixtures.prMerged), 'utf8');
  const ghUntrackedRaw = Buffer.from(
    JSON.stringify({ ...fixtures.prOpened, repository: { id: 999 } }), 'utf8');
  const slackMsgRaw = Buffer.from(JSON.stringify(slackFixtures.message), 'utf8');
  const slackUrlRaw = Buffer.from(JSON.stringify(slackFixtures.urlVerification), 'utf8');
  const jiraRaw = Buffer.from(JSON.stringify(jiraFixtures.issueCreated), 'utf8');

  const post = (url, rawBody, extraHeaders = {}) =>
    fetch(base + url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...extraHeaders },
      body: rawBody,
    });

  try {
    console.log('🧪 Running Ticket 2 — Webhook route tests...\n');
    await githubTests({ post, ghRaw, ghMergedRaw, ghUntrackedRaw });
    await slackTests({ post, slackMsgRaw, slackUrlRaw });
    await jiraTests({ post, jiraRaw, jiraFixtures });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  console.log(`\n📊 ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

async function githubTests({ post, ghRaw, ghMergedRaw, ghUntrackedRaw }) {
  // T2-01 / T2-04 — tracked repo stores an Activity.
  MockIntegration.state.organizationId = '507f1f77bcf86cd799439011';
  MockActivity.created.length = 0;
  let res = await post('/github', ghRaw, { 'x-hub-signature-256': ghSignature('test-github-secret', ghRaw) });
  let body = await res.json().catch(() => ({}));
  check('T2-01/POST /github returns 200', res.status === 200, String(res.status));
  check('T2-01 stores Activity source=github', MockActivity.created.length === 1 && MockActivity.created[0].source === 'github', JSON.stringify(MockActivity.created));
  check('T2-04 GitHub payload stored (activityId returned)', !!body.activityId, JSON.stringify(body));

  // T2-07 — duplicate payload creates two documents (no dedup).
  MockActivity.created.length = 0;
  await post('/github', ghRaw, { 'x-hub-signature-256': ghSignature('test-github-secret', ghRaw) });
  await post('/github', ghRaw, { 'x-hub-signature-256': ghSignature('test-github-secret', ghRaw) });
  check('T2-07 duplicate payload -> two Activity documents', MockActivity.created.length === 2, String(MockActivity.created.length));

  // T2-10 — untracked repository.
  MockIntegration.state.organizationId = null;
  MockActivity.created.length = 0;
  res = await post('/github', ghUntrackedRaw, { 'x-hub-signature-256': ghSignature('test-github-secret', ghUntrackedRaw) });
  body = await res.json().catch(() => ({}));
  check('T2-10 untracked repo -> 200 "not tracked"', res.status === 200 && /not tracked/i.test(JSON.stringify(body)), JSON.stringify(body));

  // T2-09 — invalid GitHub signature -> 401.
  MockIntegration.state.organizationId = '507f1f77bcf86cd799439011';
  res = await post('/github', ghRaw, { 'x-hub-signature-256': 'sha256=invalid' });
  check('T2-09 invalid GitHub signature -> 401', res.status === 401, String(res.status));

  // Normalized PR-merged travels through the route as pr_merged.
  MockActivity.created.length = 0;
  await post('/github', ghMergedRaw, { 'x-hub-signature-256': ghSignature('test-github-secret', ghMergedRaw) });
  check('Route stores pr_merged for merged PR', MockActivity.created[0]?.type === 'pr_merged', JSON.stringify(MockActivity.created[0]));
}

async function slackTests({ post, slackMsgRaw, slackUrlRaw }) {
  // T2-08 — URL verification echoes challenge (no signature needed).
  let res = await post('/slack', slackUrlRaw);
  let body = await res.json().catch(() => ({}));
  const slackFixtures = require('../../../test/fixtures/slack');
  check('T2-08 Slack url_verification returns challenge', res.status === 200 && body.challenge === slackFixtures.urlVerification.challenge, JSON.stringify(body));

  // T2-05 — event_callback message, valid signature, tracked team.
  MockIntegration.state.organizationId = '507f1f77bcf86cd799439011';
  MockActivity.created.length = 0;
  const ts = String(Math.floor(Date.now() / 1000));
  res = await post('/slack', slackMsgRaw, {
    'x-slack-signature': slackSignature('test-slack-secret', ts, slackMsgRaw.toString('utf8')),
    'x-slack-request-timestamp': ts,
  });
  check('T2-05/POST /slack returns 200', res.status === 200, String(res.status));
  check('T2-05 Slack message stored (source=slack, type=message)',
    MockActivity.created.length === 1 && MockActivity.created[0].source === 'slack' && MockActivity.created[0].type === 'message',
    JSON.stringify(MockActivity.created));

  // Invalid Slack signature -> 401.
  MockActivity.created.length = 0;
  res = await post('/slack', slackMsgRaw, { 'x-slack-signature': 'v0=invalid', 'x-slack-request-timestamp': ts });
  check('T2-09 invalid Slack signature -> 401', res.status === 401, String(res.status));

  // Untracked Slack team -> 400.
  MockIntegration.state.organizationId = null;
  res = await post('/slack', slackMsgRaw, {
    'x-slack-signature': slackSignature('test-slack-secret', ts, slackMsgRaw.toString('utf8')),
    'x-slack-request-timestamp': ts,
  });
  check('Slack untracked team -> 400', res.status === 400, String(res.status));
}

async function jiraTests({ post, jiraRaw, jiraFixtures }) {
  const jiraSecret = 'test-jira-webhook-secret';

  // T2-06 — valid Jira payload with orgId in body -> stored.
  MockIntegration.state.organizationId = '507f1f77bcf86cd799439011';
  MockActivity.created.length = 0;
  const withOrg = Buffer.from(JSON.stringify({ ...jiraFixtures.issueCreated, organizationId: '507f1f77bcf86cd799439011' }), 'utf8');
  let res = await post('/jira', withOrg, { 'x-hub-signature': jiraSignature(jiraSecret, withOrg) });
  check('T2-06/POST /jira returns 200 + stores', res.status === 200 && MockActivity.created.length === 1 && MockActivity.created[0].source === 'jira', `${res.status} / ${JSON.stringify(MockActivity.created[0])}`);

  // Missing orgId -> 400.
  res = await post('/jira', jiraRaw, { 'x-hub-signature': jiraSignature(jiraSecret, jiraRaw) });
  check('Jira missing organizationId -> 400', res.status === 400, String(res.status));
}

runTests().catch((e) => { console.error('Harness crashed', e); process.exit(1); });
