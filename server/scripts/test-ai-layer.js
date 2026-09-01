/**
 * test-ai-layer.js — AI Layer Workflow Test
 *
 * Verifies the full end-to-end pipeline against a running PulseOps server:
 *   Payload injection (signed GitHub/Slack + Jira) → normalize → Activity
 *   storage → fetch → context build → Gemini AI summary → save → fetch
 *   latest → analytics dashboard widgets.
 *
 * Usage:
 *   node scripts/test-ai-layer.js                         # uses default --org
 *   node scripts/test-ai-layer.js --org <your-org-id>     # target a specific org
 *   node scripts/test-ai-layer.js --dry-run               # provision + inject only
 *
 * Env expected at server/.env:
 *   GITHUB_WEBHOOK_SECRET   (REQUIRED for GitHub webhook signing)
 *   SLACK_SIGNING_SECRET    (REQUIRED for Slack injection)
 *   GEMINI_API_KEY
 */

require('dotenv').config();
const crypto = require('crypto');
const mongoose = require('mongoose');

// Pick your org (default = demo workspace). Override with --org or MY_ORG_ID.
const ORG_ID = process.env.MY_ORG_ID || '6a8b2ad0cbaddd12cb32dc51';
const BASE = (process.env.BACKEND_API_URL || 'http://localhost:5000').replace(/\/$/, '');

// ---- helpers ---------------------------------------------------------------
let passed = 0, failed = 0;
const ok = (m) => { passed++; console.log('  \u2705', m); };
const bad = (m) => { failed++; console.log('  \u274c', m); };
const hr = () => console.log('\n' + '\u2500'.repeat(64));

async function json(url, opts = {}) {
  // Merge headers (caller-specified override defaults, Content-Type always present).
  const merged = {
    method: opts.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  };
  if ('body' in opts) merged.body = opts.body;
      const res = await fetch(url, merged);
  // Read the body via stream reader to avoid Node 22 undici arrayBuffer() bugs
  // with certain character sets.
  let buffer = Buffer.from('');
  try {
    const reader = res.body.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
    }
    buffer = Buffer.concat(chunks, total);
    reader.releaseLock();
  } catch (e) {
    // fall back to arrayBuffer, then plain text
    try { buffer = Buffer.from(await res.arrayBuffer()); }
    catch { buffer = Buffer.from(''); }
  }
  const raw = buffer.toString('utf8');
  let body;
  try { body = JSON.parse(raw); } catch { body = raw; }
  return { status: res.status, body };
}

// ---- signing ---------------------------------------------------------------
const GH_SECRET = process.env.GITHUB_WEBHOOK_SECRET;
const signGithub = (raw) => {
  const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw, 'utf8');
  return crypto.createHmac('sha256', GH_SECRET).update(buf).digest('hex');
};

const SLACK_SECRET = process.env.SLACK_SIGNING_SECRET;
const signSlack = (ts, raw) => {
  const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw, 'utf8');
  const base = `v0:${ts}:`;
  const sig = crypto.createHmac('sha256', SLACK_SECRET)
    .update(Buffer.concat([Buffer.from(base, 'utf8'), buf]))
    .digest('hex');
  return `v0=${sig}`;
};

// ---- sample payloads --------------------------------------------------------
const nowISO = () => new Date().toISOString();
const REPO_ID = 789012345;             // must match Integration.metadata.repositories[].id
const PR_OPEN_ID = 11110001;
const PR_MERGE_ID = 11110002;
const SLACK_TEAM = 'T000TESTTEAM';

const SAMPLE = {
  githubPrOpened: {
    action: 'opened',
    number: 42,
    pull_request: {
      id: PR_OPEN_ID, number: 42, title: 'feat: AI summary generation',
      state: 'open', draft: false, html_url: 'https://github.com/nova/pulseops-backend/pull/42',
      created_at: nowISO(), updated_at: nowISO(),
      user: { login: 'priya-shah', id: 345678 },
      head: { ref: 'feat/ai-summary', sha: 'abc123def' },
      base: { ref: 'main' },
    },
    repository: { id: REPO_ID, name: 'pulseops-backend', full_name: 'nova/pulseops-backend' },
    sender: { login: 'priya-shah', id: 345678 },
  },
  githubPrMerged: {
    action: 'closed', number: 41,
    pull_request: {
      id: PR_MERGE_ID, number: 41, title: 'fix: auth retry loop',
      state: 'closed', merged: true, merged_at: nowISO(),
      html_url: 'https://github.com/nova/pulseops-backend/pull/41',
      user: { login: 'daniel-kim', id: 345679 },
      head: { ref: 'fix/auth-retry', sha: 'def456abc' },
    },
    repository: { id: REPO_ID, name: 'pulseops-backend', full_name: 'nova/pulseops-backend' },
    sender: { login: 'priya-shah', id: 345678 },
  },
  githubPush: {
    ref: 'refs/heads/main',
    before: '0'.repeat(40), after: 'a'.repeat(40),
    repository: { id: REPO_ID, name: 'pulseops-backend', full_name: 'nova/pulseops-backend' },
    pusher: { name: 'daniel-kim' },
    commits: [{ id: 'a'.repeat(40), message: 'chore: bump deps' }],
    sender: { login: 'daniel-kim', id: 345679 },
  },
  slackMessage: {
    token: 'XXYYZZ',
    team_id: SLACK_TEAM,
    api_app_id: 'AABBCCDDEEFF',
    event: {
      type: 'message', user: 'U000TESTUSER1', channel: 'C000TESTCHAN',
      text: 'Can someone review the AI summary PR?', ts: `${Math.floor(Date.now()/1000)}.000000`,
    },
    type: 'event_callback',
    event_id: 'Ev000000000000',
    event_time: Math.floor(Date.now() / 1000),
  },
  jiraIssueCreated: {
    webhookEvent: 'jira:issue_created',
    issue: {
      id: '100001', key: 'ENG-42',
      fields: {
        summary: 'Implement AI summary panel',
        issuetype: { name: 'Story' }, status: { name: 'To Do' },
        assignee: { displayName: 'Priya Shah' }, reporter: { displayName: 'Priya Shah' },
        project: { key: 'ENG', name: 'PulseOps' },
      },
    },
    user: { accountId: '5b10a451d2fe2e0f592c2a6f', displayName: 'Priya Shah' },
    timestamp: Date.now(),
  },
};

// ---- Integration provisioning ----------------------------------------------
// GitHub: org resolved from Integration.metadata.repositories[].id
// Slack:  org resolved from Integration.slackTeamId (signed route)
// Jira:   org resolved from body.organizationId or metadata.webhookId
async function provisionIntegration(db, orgId) {
  const Integration = mongoose.model('Integration');
  const repos = [{ id: String(REPO_ID), name: 'pulseops-backend', full_name: 'nova/pulseops-backend' }];

  await Integration.updateOne(
    { organizationId: orgId, provider: 'github' },
    {
      $set: { status: 'active', metadata: { repositories: repos } },
      $setOnInsert: { organizationId: orgId, provider: 'github' },
    },
    { upsert: true }
  );
  await Integration.updateOne(
    { organizationId: orgId, provider: 'slack' },
    {
      $set: { status: 'active', slackTeamId: SLACK_TEAM, slackTeamName: 'Nova Test Workspace', botUserId: 'U000TESTBOT' },
      $setOnInsert: { organizationId: orgId, provider: 'slack' },
    },
    { upsert: true }
  );
  await Integration.updateOne(
    { organizationId: orgId, provider: 'jira' },
    {
      $set: { status: 'active', metadata: { webhookId: 'jira-webhook-test', siteUrl: 'https://pulseops-test.atlassian.net' } },
      $setOnInsert: { organizationId: orgId, provider: 'jira' },
    },
    { upsert: true }
  );
    ok('Integration records provisioned (github + slack + jira) for org ' + orgId);
}

// ---- main workflow ---------------------------------------------------------
async function run() {
  const args = process.argv.slice(2);
  const ORG = args.includes('--org') ? args[args.indexOf('--org') + 1] : ORG_ID;
    const dryRun = args.includes('--dry-run');
  let authToken = null;

  console.log(`\n🚀 AI LAYER WORKFLOW TEST`);
  console.log(`   Server:    ${BASE}`);
  console.log(`   Organization: ${ORG}`);
  console.log(`   Dry run:   ${dryRun}`);

  // 0. Server health
  hr();
  console.log('▶ Server health');
  const h = await json(`${BASE}/health`);
  if (h.status === 200 && h.body.success) ok(`Health endpoint OK ({success:true})`);
  else { bad(`Health endpoint failed (${h.status})`); return finish(); }

  // 1. Provision Integration linkages (so webhook org-resolution succeeds)
  hr();
  console.log('▶ Provisioning Integration linkage');
      if (!ORG) return bad('--org not provided and MY_ORG_ID unset — aborting'), finish();
  const connectDB = require('../src/config/db');
  // Models must be registered with Mongoose before we issue queries.
  require('../src/models/Integration');
  require('../src/models/Activity');
  require('../src/models/AISummary');
  await connectDB();
  ok('MongoDB connected');
    await provisionIntegration(mongoose.connection.db, ORG).catch(e => { bad('Integration provisioning failed: ' + e.message); return finish(); });

  // Mint a dev JWT for authenticated analytics calls (mint-test-token.js)
  if (process.env.JWT_SECRET) {
    const { execSync } = require('child_process');
    try {
      const mintOutput = execSync(`node scripts/mint-test-token.js ${ORG}`, { encoding: 'utf8', timeout: 15000 });
      // Database startup logs may precede the token on stdout. Extract the
      // JWT rather than passing those diagnostics into the HTTP header.
      authToken = mintOutput.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/)?.[0] || null;
      if (authToken) ok('Dev JWT minted for org member');
      else { bad('No active member found for org — analytics calls will be 401'); authToken = null; }
    } catch (e) {
      bad('Token mint failed: ' + (e.message || e));
      authToken = null;
    }
  }

  // 2. Inject GitHub
  hr();
  console.log('▶ Injecting GitHub payloads');
      for (const [name, payload] of Object.entries({ opened: SAMPLE.githubPrOpened, merged: SAMPLE.githubPrMerged, push: SAMPLE.githubPush })) {
    const raw = JSON.stringify(payload);
    const sig = 'sha256=' + signGithub(raw);
    const r = await json(`${BASE}/api/webhooks/github`, {
      method: 'POST', body: raw,
      headers: { 'X-GitHub-Event': 'pull_request', 'X-Hub-Signature-256': sig },
    });
    if (r.status === 200 && r.body.received) ok(`GitHub ${name} → activityId=${String(r.body.activityId).slice(-8)}`);
    else bad(`GitHub ${name} → ${r.status} ${JSON.stringify(r.body)}`);
  }

  // 3. Inject Slack (signed, event_callback path)
  hr();
  console.log('▶ Injecting Slack payload');
  if (!process.env.SLACK_SIGNING_SECRET) {
    bad('SLACK_SIGNING_SECRET unset — cannot sign Slack; skipping');
  } else {
    const ts = String(Math.floor(Date.now() / 1000));
    const raw = JSON.stringify(SAMPLE.slackMessage);
    const r = await json(`${BASE}/api/webhooks/slack/events`, {
      method: 'POST', body: raw,
      headers: { 'X-Slack-Signature': signSlack(ts, raw), 'X-Slack-Request-Timestamp': ts },
    });
    if (r.status === 200 && (r.body.received || r.body.challenge)) ok('Slack message → stored');
    else bad(`Slack message → ${r.status} ${JSON.stringify(r.body)}`);
  }

  // 4. Inject Jira (unsigned; org from body)
  hr();
  console.log('▶ Injecting Jira payload');
  const jiraPayload = { ...SAMPLE.jiraIssueCreated, organizationId: ORG };
  const rJ = await json(`${BASE}/api/webhooks/jira`, { method: 'POST', body: JSON.stringify(jiraPayload) });
  if (rJ.status === 200 && rJ.body.received) ok('Jira issue created → stored');
  else bad(`Jira issue created → ${rJ.status} ${JSON.stringify(rJ.body)}`);

  // 5. Tally Activities in Mongo
  hr();
  console.log('▶ Verifying Activity storage');
  await new Promise(res => setTimeout(res, 1500));
  const counts = await mongoose.connection.db.collection('activities').aggregate([
    { $match: { organizationId: new mongoose.Types.ObjectId(ORG) } },
    { $group: { _id: '$source', count: { $sum: 1 } } },
  ]).toArray();
  if (counts.length > 0) counts.forEach(c => ok(`${c._id} activities: ${c.count}`));
  else bad('No activities found for org — storage pipeline broken');

  // 6-8. AI summary + fetch latest + analytics (unless dry-run)
  if (!dryRun) {
    hr();
    console.log('▶ Generating AI summary');
    const gen = await json(`${BASE}/api/ai-summaries`, { method: 'POST', body: JSON.stringify({ organizationId: ORG, type: 'weekly' }) });
    if (gen.status === 201 && gen.body.data) {
      ok(`AI summary generated — id=${String(gen.body.data._id).slice(-8)}`);
      const m = gen.body.data.keyMetrics || gen.body.data.key_metrics || {};
      const tc = gen.body.data.topContributors || [];
      console.log('   ├─ summary:', (gen.body.data.summary || '').slice(0, 80) + '…');
      console.log('   ├─ metrics:', JSON.stringify(m));
      console.log('   ├─ contributors:', tc.slice(0, 3).join(', '));
    } else {
      bad(`AI summary generation → ${gen.status} ${JSON.stringify(gen.body)}`);
    }

    hr();
    console.log('▶ Fetching latest summary');
    const lat = await json(`${BASE}/api/ai-summaries/latest?organizationId=${ORG}`);
    if (lat.status === 200 && lat.body.data) ok('GET /latest → summary returned');
    else bad(`GET /latest → ${lat.status} ${JSON.stringify(lat.body)}`);

    hr();
    console.log('▶ Fetching analytics dashboard');
    const da = await json(`${BASE}/api/analytics/dashboard?days=7&organizationId=${ORG}`, authToken ? { headers: { Authorization: `Bearer ${authToken}` } } : {});
    if (da.status === 200 && da.body.data) {
      const dashboard = da.body.data;
      const kp = dashboard.kpis || [];
      ok(`Dashboard → health=${dashboard.healthScore || 0}, kpis=${kp.length}`);
    } else bad(`Dashboard → ${da.status} ${JSON.stringify(da.body)}`);
  } else {
    ok('Dry-run — skipping AI generation & retrieval');
  }

  await mongoose.disconnect();
  finish();

  function finish() {
    hr();
    console.log(`🏁 Results: ${passed} passed, ${failed} failed\n`);
    process.exit(failed > 0 ? 1 : 0);
  }
}

run().catch(e => { console.error('FATAL', e); process.exit(2); });
