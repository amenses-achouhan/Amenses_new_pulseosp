'use strict';
const crypto = require('crypto');
const express = require('express');
const { verifyWebhookSignature } = require('../middleware/verifyGithubWebhook');
const verifySlackWebhook = require('../middleware/verifySlackWebhook');
const authenticate = require('../middleware/authenticate');
const verifyTenantAccess = require('../middleware/verifyTenantAccess');
const requirePermission = require('../middleware/requirePermission');
const { encrypt, decrypt } = require('../utils/crypto');
const { githubRequest } = require('../services/githubClient');
const Integration = require('../models/Integration');
const Repository = require('../models/Repository');
const SlackChannelMessage = require('../models/SlackChannelMessage');
const {
  slackWebhookRequest,
  buildTestMessagePayload,
  postMessage,
} = require('../services/slackClient');
const JiraService = require('../services/jira.service');
const JiraIssue = require('../models/JiraIssue');
const { getSlackCallbackUrl, getJiraCallbackUrl, getGithubCallbackUrl, ensurePublicBackendUrl } = require('../utils/publicUrl');

const router = express.Router();

// ---------------------------------------------------------------------------
// GET /api/integrations/github/connect
// Returns a GitHub OAuth URL for the requesting organisation.
// ---------------------------------------------------------------------------
router.get(
  '/github/connect',
  authenticate,
  verifyTenantAccess,
  requirePermission('manage_integrations'),
  async (req, res) => {
    const clientId = process.env.GITHUB_INTEGRATION_CLIENT_ID;
    if (!clientId) {
      return res.status(503).json({ error: 'GitHub OAuth is not configured on this server.' });
    }
    const state = crypto.randomBytes(20).toString('hex');
    await Integration.findOneAndUpdate(
      { organizationId: req.organizationId, provider: 'github' },
      {
        $setOnInsert: { organizationId: req.organizationId, provider: 'github' },
        $set: { state, status: 'pending' },
      },
      { upsert: true, new: true }
    );
    const authUrl = new URL('https://github.com/login/oauth/authorize');
    authUrl.searchParams.append('client_id', clientId);

    authUrl.searchParams.append(
      'redirect_uri',
      getGithubCallbackUrl() || process.env.GITHUB_CALLBACK_URL
    );
    authUrl.searchParams.append('scope', 'repo repo:hook read:org');
    authUrl.searchParams.append('state', state);
    res.json({ url: authUrl.toString() });
  }
);

// Legacy path: /api/integrations/connect (no provider segment)
router.get('/connect', authenticate, verifyTenantAccess, requirePermission('manage_integrations'), (req, res) => {
  // Redirect internally to the named route.
  req.url = '/github/connect';
  router.handle(req, res, () => { });
});

// ---------------------------------------------------------------------------
// GET /api/integrations/github/callback  (OAuth redirect from GitHub)
// ---------------------------------------------------------------------------
router.get('/github/callback', async (req, res) => {
  const { code, state } = req.query;
  if (!code || !state) {
    return res.status(400).json({ error: 'Missing code or state parameter.' });
  }


  const integration = await Integration.findOne({ provider: 'github', state });
  if (!integration) return res.status(400).json({ error: 'Invalid or expired OAuth state.' });

  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },      body: JSON.stringify({
      client_id: process.env.GITHUB_INTEGRATION_CLIENT_ID,
      client_secret: process.env.GITHUB_INTEGRATION_CLIENT_SECRET,
      code: String(code),
      redirect_uri: getGithubCallbackUrl() || process.env.GITHUB_CALLBACK_URL,
    }),
  });
  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) {
    return res.status(400).json({ error: 'Failed to exchange GitHub code for token.' });
  }

  integration.accessToken = encrypt(tokenData.access_token);
  integration.status = 'active';
  integration.state = undefined; // consumed
  await integration.save();

  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  res.redirect(
    `${frontendUrl}/workspace/${integration.organizationId}/integrations?connected=github`
  );
});

// ---------------------------------------------------------------------------
// GET /api/integrations/github/status
// Returns the connection status of GitHub for the workspace.
// ---------------------------------------------------------------------------
router.get(
  '/github/status',
  authenticate,
  verifyTenantAccess,
  async (req, res) => {
    try {
      const integration = await Integration.findOne({
        organizationId: req.organizationId,
        provider: 'github',
        status: 'active'
      });
      if (integration) {
        return res.status(200).json({ connected: true, accountName: integration.accountName });
      }
      return res.status(200).json({ connected: false });
    } catch (err) {
      console.error('[github/status] error:', err.message);
      return res.status(500).json({ error: 'Internal server error.' });
    }
  }
);

// ---------------------------------------------------------------------------
// GET /api/integrations/github/repositories
// Fetches repositories for the authenticated GitHub user/org.
// ---------------------------------------------------------------------------
router.get(
  '/github/repositories',
  authenticate,
  verifyTenantAccess,
  async (req, res) => {
    const integration = await Integration.findOne({
      organizationId: req.organizationId,
      provider: 'github',
      status: 'active',
    });
    if (!integration?.accessToken) {
      return res.status(404).json({ error: 'GitHub not connected for this workspace.' });
    }

    try {
      const ghRes = await githubRequest('/user/repos?sort=updated&per_page=50', integration);
      if (!ghRes.ok) {
        return res.status(ghRes.status).json({ error: 'GitHub API error.' });
      }
      const repos = await ghRes.json();
      return res.json(
        repos.map((r) => ({
          id: r.id,
          name: r.name,
          full_name: r.full_name,
          private: r.private,
          html_url: r.html_url,
          updated_at: r.updated_at,
          default_branch: r.default_branch,
        }))
      );
    } catch (err) {
      console.error('[github/repos] error:', err.message);
      return res.status(500).json({ error: 'Internal server error.' });
    }
  }
);

// ---------------------------------------------------------------------------
// POST /api/integrations/track-repositories
// Save selected repos and register GitHub webhooks.
// ---------------------------------------------------------------------------
router.post(
  '/track-repositories',
  authenticate,
  verifyTenantAccess,
  requirePermission('manage_integrations'),
  async (req, res) => {
    const integration = await Integration.findOne({
      organizationId: req.organizationId,
      provider: 'github',
      status: 'active',
    });
    if (!integration?.accessToken) {
      return res.status(404).json({ error: 'GitHub not connected' });
    }

    const repositoryIds = Array.isArray(req.body?.repositoryIds) ? req.body.repositoryIds : [];
    if (repositoryIds.length === 0) {
      return res.status(400).json({ error: 'No repositories selected.' });
    }

    try {
      // Fetch repo details from GitHub to get the full_name needed for webhooks.
      const ghRes = await githubRequest('/user/repos?per_page=100', integration);
      const allRepos = ghRes.ok ? await ghRes.json() : [];

      const results = [];
      for (const repoId of repositoryIds) {
        const repoMeta = allRepos.find((r) => r.id === Number(repoId));
        const fullName = repoMeta?.full_name;

        await Repository.findOneAndUpdate(
          // Unique index on { organizationId, githubRepoId } + upsert prevents
          // duplicate imports for the same workspace.
          { organizationId: req.organizationId, githubRepoId: String(repoId) },
          {
            $set: {
              name: repoMeta?.name || String(repoId),
              fullName: fullName || String(repoId),
              private: !!repoMeta?.private,
              htmlUrl: repoMeta?.html_url || null,
              defaultBranch: repoMeta?.default_branch || 'main',
            },
          },
          { upsert: true }
        );

        const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;
        if (fullName && process.env.BACKEND_API_URL && webhookSecret) {
          try {
            await githubRequest(`/repos/${fullName}/hooks`, integration, {
              method: 'POST',
              body: JSON.stringify({
                name: 'web',
                active: true,
                events: ['push', 'pull_request'],
                config: {
                  url: `${process.env.BACKEND_API_URL}/api/webhooks/github`,
                  content_type: 'json',
                  secret: webhookSecret,
                },
              }),
            });
            results.push({ repoId, status: 'webhook_registered' });
          } catch (hookErr) {
            results.push({ repoId, status: 'webhook_failed', error: hookErr.message });
          }
        } else if (fullName && process.env.BACKEND_API_URL && !webhookSecret) {
          console.warn('[track-repos] GITHUB_WEBHOOK_SECRET not set — skipping webhook registration for', fullName);
          results.push({ repoId, status: 'tracked_no_webhook', reason: 'GITHUB_WEBHOOK_SECRET not configured' });
        } else {
          results.push({ repoId, status: 'tracked_no_webhook' });
        }
      }

      return res.json({ success: true, results });
    } catch (err) {
      console.error('[track-repos] error:', err.message);
      return res.status(500).json({ error: 'Internal server error.' });
    }
  }
);

// ---------------------------------------------------------------------------
// POST /api/webhooks/github  (also served via /api/integrations/github via server.js)
// Receives GitHub push and pull_request events.
// ---------------------------------------------------------------------------
router.post('/github', verifyWebhookSignature, (req, res) => {
  const event = req.headers['x-github-event'] || 'unknown';
  const payload = req.body;
  console.log(`[webhook/github] event=${event} repo=${payload?.repository?.full_name}`);

  if (event === 'push') {
    console.log(
      `[webhook/github] push ref=${payload.ref} commits=${(payload.commits || []).length}`
    );
  } else if (event === 'pull_request') {
    console.log(
      `[webhook/github] PR #${payload.pull_request?.number} action=${payload.action}`
    );
  } else if (event === 'ping') {
    return res.json({ ok: true, message: 'pong' });
  }

  res.status(200).json({ received: true, event });
});

// ---------------------------------------------------------------------------
// Slack Events API persistence
// ---------------------------------------------------------------------------

/**
 * Map an incoming Slack `message` event to a PulseOps workspace + connected
 * channel, then persist it (deduplicated). Runner for the Events API webhook.
 * The GET /api/communication/messages route backfills user names/avatars from
 * users.list, so the webhook only stores what the event already carries.
 */
async function persistSlackEvent({ body, event }) {
  // The same Slack app can be connected to multiple PulseOps workspaces in the
  // same Slack team (one per channel). Because multiple active integrations can
  // share `slackTeamId`, resolve the correct one by matching the event's channel
  // first — otherwise a team_id-only findOne can return a different workspace's
  // integration and drop the message as "unrelated".
  const matches = await Integration.find({
    provider: 'slack',
    slackTeamId: body.team_id,
    status: 'active',
  });
  const integration = matches.find((i) => i.slackChannelId === event.channel) || matches[0] || null;
  if (!integration) {
    console.warn(`[webhook/slack] No active Slack integration for team ${body.team_id}`);
    return;
  }

  // Workspace isolation: only persist messages from THIS workspace's connected
  // channel — other channels in the same Slack team are ignored.
  if (event.channel !== integration.slackChannelId) {
    console.log(
      `[webhook/slack] Ignoring message in channel ${event.channel} (connected=${integration.slackChannelId})`
    );
    return;
  }

  // MVP: the timeline is history-driven, so edits/deletes are ignored rather
  // than applied incrementally.
  if (['message_deleted', 'message_changed'].includes(event.subtype)) {
    return;
  }

  const messageTs = event.ts;
  if (!messageTs) return;

  const userId = event.user || null;
  const bot = Boolean(event.bot_id);
  const threadTs = event.thread_ts || null;

  const doc = {
    organizationId: integration.organizationId,
    slackTeamId: integration.slackTeamId || null,
    channelId: event.channel,
    messageTs,
    userId,
    userName: bot
      ? event.username || event.bot_profile?.name || 'Slack bot'
      : userId || 'Unknown',
    // userAvatar is backfilled by GET /api/communication/messages (users.list).
    userAvatar: null,
    text: typeof event.text === 'string' ? event.text : '',
    threadTs,
    isReply: Boolean(threadTs && threadTs !== messageTs),
    replyCount: typeof event.reply_count === 'number' ? event.reply_count : 0,
    reactions: Array.isArray(event.reactions)
      ? event.reactions.map((r) => ({ name: r.name, count: r.count, users: r.users }))
      : [],
    attachments: Array.isArray(event.attachments) ? event.attachments : [],
    files: Array.isArray(event.files) ? event.files : [],
    bot,
    eventId: body.event_id || null,
  };

  try {
    await SlackChannelMessage.updateOne(
      { organizationId: integration.organizationId, channelId: event.channel, messageTs },
      { $set: doc },
      { upsert: true }
    );
  } catch (err) {
    // 11000 = duplicate key on a concurrent/redelivered event — already stored.
    if (err?.code !== 11000) console.error('[webhook/slack] persist error:', err.message);
  }
}

/** Shared Slack Events API handler (URL verification + event_callback). */
async function handleSlackWebhook(req, res) {
  try {
    const body = req.body || {};

    // URL Verification challenge (Slack sends this when registering the endpoint).
    if (body.type === 'url_verification') {
      console.log('[webhook/slack] URL verification challenge received.');
      return res.json({ challenge: body.challenge });
    }

    if (body.type === 'event_callback') {
      const event = body.event || {};
      const eventType = event.type || 'unknown';
      console.log(
        `[webhook/slack] event_callback type=${eventType} team=${body.team_id} channel=${event.channel}`
      );

      if (eventType === 'message' && event.channel && event.ts) {
        await persistSlackEvent({ body, event });
      } else if (eventType === 'app_mention') {
        console.log('[webhook/slack] Bot was mentioned:', event.text);
      }
    }

    res.status(200).send('OK');
  } catch (err) {
    console.error('[webhook/slack] handler error:', err.message);
    // Always ack Slack; persistence failures are logged, never surfaced to Slack.
    res.status(200).send('OK');
  }
}


// ---------------------------------------------------------------------------
// POST /api/webhooks/slack  (Slack events + URL verification)
// Incoming Slack Events API requests are cryptographically verified with the
// Slack Signing Secret before any event is processed (see verifySlackWebhook).
// ---------------------------------------------------------------------------
router.post('/slack', verifySlackWebhook, handleSlackWebhook);

// ---------------------------------------------------------------------------
// POST /api/webhooks/jira  (Jira issue webhooks)
// ---------------------------------------------------------------------------
router.post('/jira', (req, res) => {
  const body = req.body || {};
  const webhookEvent = body.webhookEvent || 'unknown';
  const issueKey = body.issue?.key || 'N/A';

  console.log(`[webhook/jira] event=${webhookEvent} issue=${issueKey}`);

  if (webhookEvent === 'jira:issue_created') {
    console.log('[webhook/jira] New issue created:', issueKey, body.issue?.fields?.summary);
  } else if (webhookEvent === 'jira:issue_updated') {
    console.log('[webhook/jira] Issue updated:', issueKey, body.issue?.fields?.status?.name);
  }

  res.status(200).json({ received: true, event: webhookEvent, issue: issueKey });
});

// Slack legacy path /api/integrations/slack
router.post('/slack-events', (req, res) => {
  req.url = '/slack';
  router.handle(req, res, () => { });
});

// slack part
// ---------------------------------------------------------------------------
// GET /api/integrations/slack/authorize
// Returns a Slack OAuth URL for the requesting organisation.
// Mirrors /github/connect: authenticate -> verifyTenantAccess ->
// requirePermission('manage_integrations'), random state stored on the
// org's Slack Integration document before redirecting.
//
// Scopes: the original MVP only needed `incoming-webhook` (posting AI
// summaries). The Communication module ALSO reads real channel history and
// user profile data, so the bot scopes below are requested — Slack returns an
// `access_token` (the bot token; stored encrypted as Integration.slackBotToken)
// alongside the incoming-webhook URL. This extends the SAME Slack connection; it
// does not create a second integration.
// ---------------------------------------------------------------------------
router.get(
  '/slack/authorize',
  authenticate,
  verifyTenantAccess,
  requirePermission('manage_integrations'),
  async (req, res) => {
    const clientId = process.env.SLACK_CLIENT_ID;
    if (!clientId) {
      return res.status(503).json({ error: 'Slack OAuth is not configured on this server.' });
    }
    const state = crypto.randomBytes(20).toString('hex');
    await Integration.findOneAndUpdate(
      { organizationId: req.organizationId, provider: 'slack' },
      {
        $setOnInsert: { organizationId: req.organizationId, provider: 'slack' },
        $set: { state, status: 'pending' },
      },
      { upsert: true, new: true }
    );

    const redirectUri = getSlackCallbackUrl();
    if (!redirectUri) {
      return res.status(503).json({ error: 'Slack OAuth callback URL not configured. Set BACKEND_PUBLIC_URL or start ngrok.' });
    }

    const authUrl = new URL('https://slack.com/oauth/v2/authorize');
    authUrl.searchParams.append('client_id', clientId);
    authUrl.searchParams.append('redirect_uri', redirectUri);
    // incoming-webhook keeps the existing "Send Test Message" live; the
    // channel/user read scopes enable the Communication message history.
    authUrl.searchParams.append(
      'scope',
      'incoming-webhook channels:history channels:read channels:join groups:history im:history mpim:history users:read files:read'
    );
    authUrl.searchParams.append('state', state);
    res.json({ url: authUrl.toString() });
  }
);

// ---------------------------------------------------------------------------
// GET /api/integrations/slack/callback  (OAuth redirect from Slack)
// No authenticate/verifyTenantAccess here — mirrors /github/callback, since
// the browser is arriving fresh from Slack, not carrying an app session.
// The organisation is recovered from the Integration doc matched by `state`,
// never trusted from the request itself.
// ---------------------------------------------------------------------------
router.get('/slack/callback', async (req, res) => {
  const { code, state } = req.query;
  if (!code || !state) {
    return res.status(400).json({ error: 'Missing code or state parameter.' });
  }

  const integration = await Integration.findOne({ provider: 'slack', state });
  if (!integration) return res.status(400).json({ error: 'Invalid or expired OAuth state.' });

  const redirectUri = getSlackCallbackUrl();
  if (!redirectUri) {
    console.error('[slack/callback] Slack OAuth callback URL not configured');
    return res.status(500).json({ error: 'Slack OAuth callback URL not configured on server.' });
  }

  // Slack's oauth.v2.access endpoint expects application/x-www-form-urlencoded,
  // unlike GitHub's JSON body — this is a required deviation for Slack's API
  // to actually accept the exchange request, not a stylistic choice.
  const tokenRes = await fetch('https://slack.com/api/oauth.v2.access', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.SLACK_CLIENT_ID,
      client_secret: process.env.SLACK_CLIENT_SECRET,
      code: String(code),
      redirect_uri: redirectUri,
    }),
  });
  const tokenData = await tokenRes.json();

  if (!tokenData.ok || !tokenData.incoming_webhook?.url) {
    console.error('[slack/callback] Slack OAuth error:', tokenData.error || 'unknown');
    return res.status(400).json({ error: 'Failed to exchange Slack code for a webhook.' });
  }

  const webhook = tokenData.incoming_webhook;

  // Reuses the same generic accessToken field GitHub stores its encrypted
  // token in — the Slack Incoming Webhook URL is the equivalent bearer
  // credential for this provider, so no new encryptedWebhookUrl field.
  integration.accessToken = encrypt(webhook.url);
  // New: bot token (encrypted) enables reading real channel history for the
  // Communication module + team id lets the Events API webhook map a Slack
  // team back to this PulseOps workspace. Existing (webhook-only) connections
  // simply leave these null until the workspace reconnects Slack.
  //
  // oauth.v2.access returns the bot token in the top-level `access_token`
  // field (token_type "bot") — there is NO `bot_token` field in the response.
  // Reading `access_token` is what actually populates slackBotToken so the
  // Communication page can fetch channel history.
  integration.slackBotToken = tokenData.access_token ? encrypt(tokenData.access_token) : null;
  integration.slackTeamId = tokenData.team?.id || null;
  integration.slackChannelId = webhook.channel_id || null;
  integration.slackChannelName = webhook.channel || null;
  integration.slackTeamName = tokenData.team?.name || null;
  integration.status = 'active';
  integration.state = undefined; // consumed — prevents replay of this callback
  await integration.save();

  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  res.redirect(
    `${frontendUrl}/workspace/${integration.organizationId}/integrations?connected=slack`
  );
});

router.get(
  '/slack/status',
  authenticate,
  verifyTenantAccess,
  async (req, res) => {
    try {
      const integration = await Integration.findOne({
        organizationId: req.organizationId,
        provider: 'slack',
        status: 'active',
      });
      if (integration) {
        return res.status(200).json({
          connected: true,
          teamName: integration.slackTeamName || null,
          channelName: integration.slackChannelName || null,
          channelId: integration.slackChannelId || null,
        });
      }
      return res.status(200).json({ connected: false });
    } catch (err) {
      console.error('[slack/status] error:', err.message);
      return res.status(500).json({ error: 'Internal server error.' });
    }
  }
);
router.post(
  '/slack/test',
  authenticate,
  verifyTenantAccess,
  requirePermission('manage_integrations'),
  async (req, res) => {
    const integration = await Integration.findOne({
      organizationId: req.organizationId,
      provider: 'slack',
      status: 'active',
    });
    if (!integration?.accessToken) {
      return res.status(404).json({ error: 'Slack not connected for this workspace.' });
    }

    try {
      const payload = buildTestMessagePayload();
      // Prefer sending with the bot token to the integration's own channel. The
      // stored incoming webhook can be bound to a DIFFERENT channel than the
      // one PulseOps displays (webhooks ignore a `channel` override and always
      // post to their own bound channel), so chat.postMessage to slackChannelId
      // is the reliable path once the bot is a member (requires chat:write).
      let delivered = false;
      if (integration.slackBotToken && integration.slackChannelId) {
        try {
          const pm = await postMessage(integration, integration.slackChannelId, {
            text: payload.text,
            blocks: payload.blocks,
          });
          if (pm.ok) {
            delivered = true;
          } else {
            console.error(`[slack/test] chat.postMessage not ok:`, pm.error);
          }
        } catch (pmErr) {
          console.error('[slack/test] chat.postMessage error:', pmErr.message);
        }
      }

      // Fallback: legacy incoming-webhook path (webhook-only connections that
      // have no bot token). Slack Incoming Webhooks return HTTP 200 with a
      // plain-text body of `ok` on success but can return 2xx with a NON-"ok"
      // body on delivery failure — so verify the body too, not just res.ok.
      if (!delivered) {
        const slackRes = await slackWebhookRequest(integration, payload);
        const body = await slackRes.text();
        delivered = slackRes.ok && body.trim().toLowerCase() === 'ok';
        if (!delivered) {
          console.error(
            `[slack/test] Slack webhook rejected the request: status=${slackRes.status} body=${body}`
          );
        }
      }

      if (!delivered) {
        return res.status(502).json({ error: 'Slack rejected the test message. Please reconnect Slack.' });
      }

      return res.status(200).json({ success: true, message: 'Test message sent to Slack.' });

      return res.status(200).json({ success: true, message: 'Test message sent to Slack.' });
    } catch (err) {
      console.error('[slack/test] error:', err.message);
      return res.status(500).json({ error: 'Internal server error.' });
    }
  }
);

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// POST /api/integrations/:provider/disable
// Shared generic deactivation for GitHub / Slack / Jira.
// ---------------------------------------------------------------------------
router.post(
  '/:provider/disable',
  authenticate,
  verifyTenantAccess,
  requirePermission('manage_integrations'),
  async (req, res) => {
    const provider = req.params.provider;
    if (!['github', 'slack', 'jira'].includes(provider)) {
      return res.status(400).json({ message: 'Provider not supported.' });
    }
    try {
      const integration = await Integration.findOne({
        organizationId: req.organizationId,
        provider,
        status: 'active',
      });
      if (!integration) {
        return res.status(200).json({
          disabled: false,
          message: 'No active connection to disable.',
        });
      }
      integration.status = 'revoked';
      await integration.save();
      return res.status(200).json({ disabled: true, provider });
    } catch (err) {
      console.error(`[${provider}/disable] error:`, err.message);
      return res.status(500).json({ error: 'Internal server error.' });
    }
  }
);

// ---------------------------------------------------------------------------
// GET /api/integrations/jira/auth
// Returns a Jira OAuth URL for the requesting organisation.
// ---------------------------------------------------------------------------
router.get(
  '/jira/auth',
  authenticate,
  verifyTenantAccess,
  requirePermission('manage_integrations'),
  async (req, res) => {
    const clientId = process.env.JIRA_CLIENT_ID;
    if (!clientId) {
      return res.status(503).json({ error: 'Jira OAuth is not configured on this server.' });
    }
    const state = crypto.randomBytes(20).toString('hex');
    await Integration.findOneAndUpdate(
      { organizationId: req.organizationId, provider: 'jira' },
      {
        $setOnInsert: { organizationId: req.organizationId, provider: 'jira' },
        $set: { state, status: 'pending' },
      },
      { upsert: true, new: true }
    );

    const redirectUri = getJiraCallbackUrl();
    if (!redirectUri) {
      return res.status(503).json({ error: 'Jira OAuth callback URL not configured. Set BACKEND_PUBLIC_URL or start ngrok.' });
    }

    const authUrl = new URL('https://auth.atlassian.com/authorize');
    authUrl.searchParams.append('audience', 'api.atlassian.com');
    authUrl.searchParams.append('client_id', clientId);
    authUrl.searchParams.append('scope', 'read:jira-work read:jira-user manage:jira-webhook offline_access');
    authUrl.searchParams.append('redirect_uri', redirectUri);
    authUrl.searchParams.append('response_type', 'code');
    authUrl.searchParams.append('prompt', 'consent');
    authUrl.searchParams.append('state', state);
    // Branch-3 diagnostic: log the exact URL fired so it can be diffed against
    // what the browser actually requested (catches stale/cached connect URLs).
    console.log('[jira/auth] Authorize URL:', authUrl.toString());
    res.json({ url: authUrl.toString() });
  }
);

// ---------------------------------------------------------------------------
// GET /api/integrations/jira/callback  (OAuth redirect from Atlassian)
// ---------------------------------------------------------------------------
router.get('/jira/callback', async (req, res) => {
  const { code, state } = req.query;
  if (!code || !state) {
    return res.status(400).json({ error: 'Missing code or state parameter.' });
  }

  const integration = await Integration.findOne({ provider: 'jira', state });
  if (!integration) {
    return res.status(400).json({ error: 'Invalid or expired OAuth state.' });
  }

  const redirectUri = getJiraCallbackUrl();
  if (!redirectUri) {
    console.error('[jira/callback] Jira OAuth callback URL not configured');
    return res.status(500).json({ error: 'Jira OAuth callback URL not configured on server.' });
  }

  try {
    const tokenRes = await fetch('https://auth.atlassian.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: process.env.JIRA_CLIENT_ID,
        client_secret: process.env.JIRA_CLIENT_SECRET,
        code: String(code),
        redirect_uri: redirectUri,
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      console.error('[jira/callback] Token exchange failed:', tokenData);
      return res.status(400).json({ error: 'Failed to exchange Jira code for token.' });
    }

    // Audit trail for scope-staleness debugging (Check #1): log exactly what
    // Jira GRANTED, not just what we requested. Adding a scope to the OAuth
    // app never retroactively upgrades already-issued tokens, so this is the
    // only authoritative record of the live grant.
    console.log('[jira/callback] Granted scopes:', tokenData.scope);
    if (tokenData.scope && !String(tokenData.scope).includes('manage:jira-webhook')) {
      console.warn('[jira/callback] ⚠️ manage:jira-webhook MISSING from granted scope — webhook registration will 401/403 until a fresh consent grants it.');
    }

    // Get accessible Jira sites
    const sitesRes = await fetch('https://api.atlassian.com/oauth/token/accessible-resources', {
      headers: { Authorization: `Bearer ${tokenData.access_token}`, Accept: 'application/json' },
    });
    const sites = await sitesRes.json();
    if (!sites || sites.length === 0) {
      return res.status(400).json({ error: 'No accessible Jira sites found for this account.' });
    }

    // Use the first accessible site (user can have multiple)
    const site = sites[0];
    const cloudId = site.id;
    const siteUrl = site.url;

    // Resolve the Atlassian identity that just consented (Check #3 audit):
    // lets us always answer "which account actually connected?" from the DB.
    let connectedAs = null;
    try {
      const meRes = await fetch('https://api.atlassian.com/ex/jira/' + cloudId + '/rest/api/3/myself', {
        headers: { Authorization: 'Bearer ' + tokenData.access_token, Accept: 'application/json' },
      });
      if (meRes.ok) {
        const me = await meRes.json();
        connectedAs = {
          accountId: me.accountId || null,
          displayName: me.displayName || null,
          emailAddress: me.emailAddress || null,
          active: me.active !== false,
        };
        console.log('[jira/callback] Connected as:', connectedAs.emailAddress || connectedAs.accountId);
      } else {
        console.warn('[jira/callback] Could not resolve connecting user:', meRes.status);
      }
    } catch (meErr) {
      console.warn('[jira/callback] myself lookup failed (non-fatal):', meErr.message);
    }

    integration.accessToken = encrypt(tokenData.access_token);
    integration.refreshToken = tokenData.refresh_token ? encrypt(tokenData.refresh_token) : undefined;
    integration.tokenExpiresAt = tokenData.expires_in ? new Date(Date.now() + tokenData.expires_in * 1000) : undefined;
    integration.jiraCloudId = cloudId;
    integration.jiraSiteUrl = siteUrl;
    // Reconnect = new grant. Drop any stale webhook registration state so the
    // old webhook (tied to the previous token/user consent) can't be reused
    // with an unknown secret. The user must re-register the webhook.
    integration.jiraWebhookId = undefined;
    if (integration.metadata) {
      delete integration.metadata.webhookProjectKey;
      delete integration.metadata.webhookUrl;
      delete integration.metadata.webhookSecret;
      delete integration.metadata.webhookRegisteredAt;
      delete integration.metadata.webhookVerifiedAt;
      delete integration.metadata.webhookExpirationAt;
      integration.markModified('metadata');
    }
    integration.status = 'active';
    integration.state = undefined; // consumed — prevents replay
    // Persist the grant audit fields (fresh grant => overwrite stale values)
    integration.metadata = {
      ...(integration.metadata || {}),
      grantedScopes: tokenData.scope || null,
      grantedScopesAt: new Date(),
      connectedAs,
    };
    await integration.save();

    console.log('[jira/callback] Integration saved for org:', integration.organizationId, 'cloudId:', cloudId);

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    res.redirect(
      `${frontendUrl}/workspace/${integration.organizationId}/integrations?connected=jira`
    );
  } catch (err) {
    console.error('[jira/callback] error:', err);
    return res.status(500).json({ error: 'Internal server error during Jira OAuth callback.' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/integrations/jira/disconnect
// Revokes the OAuth grant at Atlassian and clears ALL local token/webhook
// state, so the next connect is a genuinely fresh grant (Phase 2 fix) — not an
// overwrite of a stale token issued before the current app scopes existed.
// ---------------------------------------------------------------------------
router.post(
  '/jira/disconnect',
  authenticate,
  verifyTenantAccess,
  requirePermission('manage_integrations'),
  async (req, res) => {
    try {
      const integration = await Integration.findOne({
        organizationId: req.organizationId,
        provider: 'jira',
      });
      if (!integration) {
        return res.status(404).json({ error: 'Jira is not connected for this workspace.' });
      }

      // Best-effort remote revocation — even if it fails (expired token etc.),
      // we still clear local state so the user isn't stuck.
      if (integration.accessToken) {
        try {
          const revokeRes = await fetch('https://auth.atlassian.com/oauth/token/revoke', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({
              token: decrypt(integration.accessToken),
              client_id: process.env.JIRA_CLIENT_ID,
              client_secret: process.env.JIRA_CLIENT_SECRET,
            }),
          });
          console.log('[jira/disconnect] Revocation status:', revokeRes.status);
        } catch (revErr) {
          console.warn('[jira/disconnect] Revocation failed (clearing locally anyway):', revErr.message);
        }
      }

      integration.accessToken = undefined;
      integration.refreshToken = undefined;
      integration.tokenExpiresAt = undefined;
      integration.jiraWebhookId = undefined;
      integration.jiraCloudId = undefined;
      integration.jiraSiteUrl = undefined;
      integration.state = undefined;
      if (integration.metadata) {
        delete integration.metadata.webhookProjectKey;
        delete integration.metadata.webhookUrl;
        delete integration.metadata.webhookSecret;
        delete integration.metadata.webhookRegisteredAt;
        delete integration.metadata.webhookVerifiedAt;
        delete integration.metadata.webhookExpirationAt;
        delete integration.metadata.grantedScopes;
        delete integration.metadata.grantedScopesAt;
        delete integration.metadata.connectedAs;
        integration.markModified('metadata');
      }
      // 'revoked' is the existing enum value for a cleared connection.
      integration.status = 'revoked';
      await integration.save();

      console.log('[jira/disconnect] Integration cleared for org:', integration.organizationId);
      return res.json({ success: true });
    } catch (err) {
      console.error('[jira/disconnect] error:', err);
      return res.status(500).json({ error: 'Internal server error during Jira disconnect.' });
    }
  }
);

// ---------------------------------------------------------------------------
// GET /api/integrations/jira/status
// Returns the connection status of Jira for the workspace.
// ---------------------------------------------------------------------------
router.get(
  '/jira/status',
  authenticate,
  verifyTenantAccess,
  async (req, res) => {
    try {
      const integration = await Integration.findOne({
        organizationId: req.organizationId,
        provider: 'jira',
        status: 'active',
      });
      if (integration) {
        const publicBase = (process.env.BACKEND_API_URL || '').replace(/\/$/, '');
        // Scope-health check (Check #1): a token issued before
        // manage:jira-webhook was added to the app will never gain the scope,
        // even though the app config shows it. Surface that staleness here so
        // the UI can render an actionable "Scopes outdated" badge.
        const requiredScopes = ['read:jira-work', 'read:jira-user', 'manage:jira-webhook', 'offline_access'];
        const granted = String(integration.metadata?.grantedScopes || '').split(/\s+/).filter(Boolean);
        const missingScopes = requiredScopes.filter((s) => !granted.includes(s));
        const JiraSyncState = require('../models/JiraSyncState');
        const syncStatesRaw = await JiraSyncState.find({
          organizationId: req.organizationId,
          jiraCloudId: integration.jiraCloudId,
        });
        const syncStates = typeof syncStatesRaw.lean === 'function' ? syncStatesRaw.lean() : syncStatesRaw;

        return res.status(200).json({
          connected: true,
          siteUrl: integration.jiraSiteUrl,
          cloudId: integration.jiraCloudId,
          lastSyncAt: integration.lastSyncAt,
          webhookRegistered: !!integration.jiraWebhookId,
          webhookUrl: integration.metadata?.webhookUrl
            || (publicBase ? `${publicBase}/api/webhooks/jira` : ''),
          grantedScopes: granted,
          connectedAs: integration.metadata?.connectedAs || null,
          scopesHealthy: missingScopes.length === 0,
          syncStates,
          ...(missingScopes.length ? { missingScopes } : {}),
        });
      }
      return res.status(200).json({ connected: false });
    } catch (err) {
      console.error('[jira/status] error:', err.message);
      return res.status(500).json({ error: 'Internal server error.' });
    }
  }
);

// ---------------------------------------------------------------------------
// GET /api/integrations/jira/projects
// Fetches Jira projects for the connected Jira site.
// ---------------------------------------------------------------------------
router.get(
  '/jira/projects',
  authenticate,
  verifyTenantAccess,
  async (req, res) => {
    const integration = await Integration.findOne({
      organizationId: req.organizationId,
      provider: 'jira',
      status: 'active',
    });
    if (!integration?.accessToken) {
      return res.status(404).json({ error: 'Jira not connected for this workspace.' });
    }
    if (!integration.jiraCloudId) {
      return res.status(400).json({ error: 'Jira cloud ID not found. Please reconnect Jira.' });
    }

    try {
      // Check token expiration and refresh if needed
      let accessToken = decrypt(integration.accessToken);
      if (integration.tokenExpiresAt && integration.tokenExpiresAt <= new Date()) {
        if (!integration.refreshToken) {
          return res.status(401).json({ error: 'Jira token expired and no refresh token available. Please reconnect Jira.' });
        }
        const refreshToken = decrypt(integration.refreshToken);
        const refreshed = await JiraService.refreshAccessToken(refreshToken);
        accessToken = refreshed.accessToken;
        integration.accessToken = encrypt(refreshed.accessToken);
        integration.refreshToken = refreshed.refreshToken ? encrypt(refreshed.refreshToken) : integration.refreshToken;
        integration.tokenExpiresAt = new Date(Date.now() + refreshed.expiresIn * 1000);
        await integration.save();
      }

      const projects = await JiraService.getProjects(accessToken, integration.jiraCloudId);
      return res.json(
        projects.map((p) => ({
          key: p.key,
          name: p.name,
          id: p.id,
          projectTypeKey: p.projectTypeKey,
          simplified: p.simplified,
        }))
      );
    } catch (err) {
      console.error('[jira/projects] error:', err.status, err.message);
      const status = typeof err.status === 'number' && err.status >= 400 && err.status < 600 ? err.status : 500;
      const mapped =
        status === 401 || status === 403
          ? 'Jira returned a permission/scope error. Ensure the connected Jira account is a site admin, then re-connect Jira.'
          : status === 502 || status === 503
            ? 'Jira API is temporarily unavailable. Try again shortly.'
            : `Jira API error (${status}): ${err.message}. Verify the Jira integration and project access.`;
      return res.status(status).json({ error: mapped });
    }
  }
);

// ---------------------------------------------------------------------------
// POST /api/integrations/jira/sync
// Syncs Jira issues for a specific project into MongoDB.
// ---------------------------------------------------------------------------
router.post(
  '/jira/sync',
  authenticate,
  verifyTenantAccess,
  requirePermission('manage_integrations'),
  async (req, res) => {
    const { projectKey } = req.body;
    if (!projectKey) {
      return res.status(400).json({ error: 'projectKey is required.' });
    }

    const integration = await Integration.findOne({
      organizationId: req.organizationId,
      provider: 'jira',
      status: 'active',
    });
    if (!integration?.accessToken) {
      return res.status(404).json({ error: 'Jira not connected for this workspace.' });
    }
    if (!integration.jiraCloudId) {
      return res.status(400).json({ error: 'Jira cloud ID not found. Please reconnect Jira.' });
    }

    try {
      // Check token expiration and refresh if needed
      let accessToken = decrypt(integration.accessToken);
      if (integration.tokenExpiresAt && integration.tokenExpiresAt <= new Date()) {
        if (!integration.refreshToken) {
          return res.status(401).json({ error: 'Jira token expired and no refresh token available. Please reconnect Jira.' });
        }
        const refreshToken = decrypt(integration.refreshToken);
        const refreshed = await JiraService.refreshAccessToken(refreshToken);
        accessToken = refreshed.accessToken;
        integration.accessToken = encrypt(refreshed.accessToken);
        integration.refreshToken = refreshed.refreshToken ? encrypt(refreshed.refreshToken) : integration.refreshToken;
        integration.tokenExpiresAt = new Date(Date.now() + refreshed.expiresIn * 1000);
        await integration.save();
      }

      const JiraSyncState = require('../models/JiraSyncState');
      const { startProjectSync } = require('../services/jiraSync');

      // 1. Initialize or update sync state
      const syncState = await JiraSyncState.findOneAndUpdate(
        {
          organizationId: req.organizationId,
          jiraCloudId: integration.jiraCloudId,
          projectKey
        },
        {
          $set: {
            status: 'syncing',
            lastError: null,
            issuesSynced: 0,    // reset counter so re-runs don't accumulate
            failedCount: 0,     // reset failed counter
            nextPageToken: '',  // restart pagination from page 1
          }
        },
        { upsert: true, new: true }
      );

      // 2. Start async sync process (do not await)
      startProjectSync(
        integration.organizationId,
        integration.jiraCloudId,
        projectKey,
        accessToken, // Note: the background job should refresh the token if it takes a long time, but for initial sync, the 1-hour token is usually fine.
        syncState._id
      ).catch(err => {
        console.error('[jira/sync] Background sync error:', err);
      });

      // 3. Update integration lastSyncAt (just to show activity)
      integration.lastSyncAt = new Date();
      await integration.save();

      return res.status(202).json({
        success: true,
        message: 'Sync started in background',
        projectKey,
        syncStateId: syncState._id
      });
    } catch (err) {
      console.error('[jira/sync] error:', err.status, err.message);
      // Surface the underlying cause instead of a blanket 500. 401/403 = Jira
      // permission/scope problem (often needs site-admin); never leak tokens.
      const status = typeof err.status === 'number' && err.status >= 400 && err.status < 600
        ? err.status
        : 500;
      const mapped =
        status === 401 || status === 403
          ? 'Jira returned a permission/scope error. Ensure the connected Jira account is a site admin, then re-connect Jira.'
          : status === 502 || status === 503
            ? 'Jira API is temporarily unavailable. Try again shortly.'
            : `Jira API error (${status}): ${err.message}. Verify the Jira project key and that the integration is active.`;
      return res.status(status).json({ error: mapped });
    }
  }
);

// ---------------------------------------------------------------------------
// GET /api/integrations/jira/issues
// Returns paginated Jira issues from MongoDB for the workspace.
// ---------------------------------------------------------------------------
router.get(
  '/jira/issues',
  authenticate,
  verifyTenantAccess,
  async (req, res) => {
    const { projectKey, status, limit = 50, skip = 0 } = req.query;
    const JiraIssue = require('../models/JiraIssue');

    try {
      const query = { organizationId: req.organizationId };
      if (projectKey) query.projectKey = projectKey;
      if (status) query.status = status;

      const [issues, total] = await Promise.all([
        JiraIssue.find(query)
          .sort({ updated: -1 })
          .skip(Number(skip))
          .limit(Number(limit))
          .lean(),
        JiraIssue.countDocuments(query),
      ]);

      return res.json({ issues, total, limit: Number(limit), skip: Number(skip) });
    } catch (err) {
      console.error('[jira/issues] error:', err.message);
      return res.status(500).json({ error: 'Failed to fetch Jira issues.' });
    }
  }
);

// ---------------------------------------------------------------------------
// POST /api/integrations/jira/register-webhook
// Registers a Jira webhook for the specified project with remote verification.
// ---------------------------------------------------------------------------
router.post(
  '/jira/register-webhook',
  authenticate,
  verifyTenantAccess,
  requirePermission('manage_integrations'),
  async (req, res) => {
    const { projectKey } = req.body;
    if (!projectKey) {
      return res.status(400).json({ error: 'projectKey is required.' });
    }

    const integration = await Integration.findOne({
      organizationId: req.organizationId,
      provider: 'jira',
      status: 'active',
    });
    if (!integration?.accessToken) {
      return res.status(404).json({ error: 'Jira not connected for this workspace.' });
    }
    if (!integration.jiraCloudId) {
      return res.status(400).json({ error: 'Jira cloud ID not found. Please reconnect Jira.' });
    }
    if (!integration.jiraSiteUrl) {
      return res.status(400).json({ error: 'Jira site URL not found. Please reconnect Jira.' });
    }

    try {
      // Check token expiration and refresh if needed. Force a refresh when the
      // token is expired OR within a 5-minute window so webhook management
      // calls never race against an imminent expiry.
      let accessToken = decrypt(integration.accessToken);
      if (integration.tokenExpiresAt && integration.tokenExpiresAt <= new Date(Date.now() + 5 * 60 * 1000)) {
        if (!integration.refreshToken) {
          return res.status(401).json({ error: 'Jira token expired and no refresh token available. Please reconnect Jira.' });
        }
        const refreshToken = decrypt(integration.refreshToken);
        const refreshed = await JiraService.forceRefreshAccessToken(refreshToken);
        accessToken = refreshed.accessToken;
        integration.accessToken = encrypt(refreshed.accessToken);
        integration.refreshToken = refreshed.refreshToken ? encrypt(refreshed.refreshToken) : integration.refreshToken;
        integration.tokenExpiresAt = new Date(Date.now() + refreshed.expiresIn * 1000);
        await integration.save();
      }

      // Scope/admin pre-check: listing webhooks exercises the same permission
      // surface (manage:jira-webhook scope + site admin) as creating them.
      // Failing here gives the user a clear message before any mutation.
      try {
        console.log('[jira/register-webhook] Pre-check: verifying webhook management permission...');
        await JiraService.listWebhooks(accessToken, integration.jiraCloudId);
      } catch (preErr) {
        const status = typeof preErr.status === 'number' && preErr.status >= 400 && preErr.status < 600 ? preErr.status : 500;
        if (status === 401 || status === 403) {
          console.error('[jira/register-webhook] Pre-check failed:', status, preErr.message);
          return res.status(status).json({
            error: 'Jira rejected webhook management. Ensure the connected Jira account is a site admin and the OAuth grant includes the manage:jira-webhook scope, then re-connect Jira.',
          });
        }
        if (status === 502 || status === 503) {
          return res.status(status).json({ error: 'Jira API is temporarily unavailable. Try again shortly.' });
        }
        throw preErr;
      }

      const webhookUrl = `${process.env.BACKEND_API_URL || 'http://localhost:5000'}/api/webhooks/jira`;

      // If we already have a webhook ID, verify it remotely
      if (integration.jiraWebhookId) {
        console.log('[jira/register-webhook] Verifying existing webhook:', integration.jiraWebhookId);
        const verification = await JiraService.verifyWebhook(
          accessToken,
          integration.jiraCloudId,
          integration.jiraWebhookId,
          webhookUrl,
          projectKey
        );

        if (verification.exists && verification.allMatch) {
          console.log('[jira/register-webhook] Existing webhook verified remotely:', integration.jiraWebhookId);
          // Renew expiration so Jira doesn't silently delete the webhook.
          const renewal = await JiraService.renewWebhooks(accessToken, integration.jiraCloudId, [Number(integration.jiraWebhookId)]);
          if (renewal && Array.isArray(renewal.webhooks) && renewal.webhooks[0]?.expirationDate) {
            integration.metadata = {
              ...integration.metadata,
              webhookExpirationAt: new Date(renewal.webhooks[0].expirationDate),
            };
            await integration.save();
          }
          return res.json({
            success: true,
            webhookId: integration.jiraWebhookId,
            webhookUrl: verification.webhook.url,
            events: verification.webhook.events,
            projectKey,
            alreadyRegistered: true,
            verified: true,
          });
        }

        console.warn('[jira/register-webhook] Existing webhook verification failed, will re-register:', verification);
        // Fall through to re-register
      }

      // Try to find an existing matching webhook remotely
      console.log('[jira/register-webhook] Searching for existing matching webhook...');
      const existingWebhook = await JiraService.findMatchingWebhook(
        accessToken,
        integration.jiraCloudId,
        webhookUrl,
        projectKey
      );

      if (existingWebhook) {
        console.log('[jira/register-webhook] Found existing matching webhook:', existingWebhook.id);

        // Verify it matches our criteria
        const verification = await JiraService.verifyWebhook(
          accessToken,
          integration.jiraCloudId,
          existingWebhook.id,
          webhookUrl,
          projectKey
        );

        if (verification.exists && verification.allMatch) {
          // Use the existing webhook
          integration.jiraWebhookId = existingWebhook.id;
          integration.metadata = {
            ...integration.metadata,
            webhookProjectKey: projectKey,
            webhookUrl: webhookUrl,
            webhookRegisteredAt: new Date(),
          };
          await integration.save();

          return res.json({
            success: true,
            webhookId: existingWebhook.id,
            webhookUrl: existingWebhook.url,
            events: existingWebhook.events,
            projectKey,
            alreadyRegistered: true,
            verified: true,
            message: 'Using existing verified webhook',
          });
        }
      }

      // Generate a webhook secret for signature verification (HMAC-SHA256 via
      // X-Hub-Signature). Jira signs every delivery with this shared secret.
      const webhookSecret = JiraService.generateWebhookSecret();

      // Register new webhook
      console.log('[jira/register-webhook] Registering new webhook for project:', projectKey);
      const webhook = await JiraService.registerWebhook(accessToken, integration.jiraCloudId, webhookUrl, projectKey, webhookSecret);

      // Verify the newly registered webhook remotely
      console.log('[jira/register-webhook] Verifying newly registered webhook:', webhook.id);
      const verification = await JiraService.verifyWebhook(
        accessToken,
        integration.jiraCloudId,
        webhook.id,
        webhookUrl,
        projectKey
      );

      if (!verification.exists || !verification.allMatch) {
        console.error('[jira/register-webhook] New webhook verification failed:', verification);
        // Don't fail - the webhook was created, just log the verification issue
      }

      integration.jiraWebhookId = webhook.id;
      integration.metadata = {
        ...integration.metadata,
        webhookProjectKey: projectKey,
        webhookUrl: webhookUrl,
        webhookSecret: webhookSecret, // Store for signature verification
        webhookRegisteredAt: new Date(),
        webhookVerifiedAt: verification.allMatch ? new Date() : null,
        // Jira classic webhooks expire (~30 days); capture the exact expiry so
        // we can renew proactively.
        ...(webhook.expirationDate ? { webhookExpirationAt: new Date(webhook.expirationDate) } : {}),
      };
      await integration.save();

      console.log('[jira/register-webhook] Webhook registered:', webhook.id, 'for project:', projectKey);
      return res.json({
        success: true,
        webhookId: webhook.id,
        webhookUrl: webhook.url,
        events: webhook.events,
        projectKey,
        verified: verification.allMatch,
        verification: verification.matches,
      });
    } catch (err) {
      console.error('[jira/register-webhook] error:', err.status, err.message);
      const status = typeof err.status === 'number' && err.status >= 400 && err.status < 600 ? err.status : 500;
      const mapped =
        status === 401 || status === 403
          ? 'Jira rejected webhook management (Unauthorized; scope does not match). Ensure the connected Jira account is a site admin and the app is approved for webhooks, then re-connect Jira.'
          : status === 502 || status === 503
            ? 'Jira API is temporarily unavailable. Try again shortly.'
            : `Jira webhook error (${status}): ${err.message}.`;
      return res.status(status).json({ error: mapped });
    }
  }
);




// ---------------------------------------------------------------------------
// POST /api/webhooks/github  (also served via /api/integrations/github via server.js)
// Receives GitHub push and pull_request events.
// ---------------------------------------------------------------------------
router.post('/github', verifyWebhookSignature, (req, res) => {
  const event = req.headers['x-github-event'] || 'unknown';
  const payload = req.body;
  console.log(`[webhook/github] event=${event} repo=${payload?.repository?.full_name}`);

  if (event === 'push') {
    console.log(
      `[webhook/github] push ref=${payload.ref} commits=${(payload.commits || []).length}`
    );
  } else if (event === 'pull_request') {
    console.log(
      `[webhook/github] PR #${payload.pull_request?.number} action=${payload.action}`
    );
  } else if (event === 'ping') {
    return res.json({ ok: true, message: 'pong' });
  }

  res.status(200).json({ received: true, event });
});

// ---------------------------------------------------------------------------
// POST /api/webhooks/slack  (Slack events + URL verification)
// ---------------------------------------------------------------------------
router.post('/slack', verifySlackWebhook, handleSlackWebhook);

// ---------------------------------------------------------------------------
// POST /api/webhooks/jira  (Jira issue webhooks)
// ---------------------------------------------------------------------------
router.post('/jira', (req, res) => {
  const body = req.body || {};
  const webhookEvent = body.webhookEvent || 'unknown';
  const issueKey = body.issue?.key || 'N/A';

  console.log(`[webhook/jira] event=${webhookEvent} issue=${issueKey}`);

  if (webhookEvent === 'jira:issue_created') {
    console.log('[webhook/jira] New issue created:', issueKey, body.issue?.fields?.summary);
  } else if (webhookEvent === 'jira:issue_updated') {
    console.log('[webhook/jira] Issue updated:', issueKey, body.issue?.fields?.status?.name);
  }

  res.status(200).json({ received: true, event: webhookEvent, issue: issueKey });
});

// Slack legacy path /api/integrations/slack
router.post('/slack-events', (req, res) => {
  req.url = '/slack';
  router.handle(req, res, () => { });
});

module.exports = router;