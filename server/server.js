require('dotenv').config();
const dns = require("dns");

if (process.env.NODE_ENV !== "production") {
  dns.setServers(["8.8.8.8", "8.8.4.4"]);
}
const express = require('express');
const path = require('path');
const cors = require('cors');
const connectDB = require('./src/config/db');
const authRoutes = require('./src/routes/authRoutes');
const orgRoutes = require('./src/routes/orgRoutes');
const integrationRoutes = require('./src/routes/integrationRoutes');
const repositoryRoutes = require('./src/routes/repositoryRoutes');
const communicationRoutes = require('./src/routes/communicationRoutes');
const slackWebhookRoutes = require('./src/routes/slackWebhookRoutes');
const slackRoutes = require('./src/routes/slackRoutes');
const webhookRoutes = require('./src/routes/webhooks');
const { startSlackWorker } = require('./src/services/slackEventsProcessor');
const { startJiraWorker } = require('./src/services/jiraEventsProcessor');
const securityHeaders = require('./src/middleware/securityHeaders');
const errorHandler = require('./src/middleware/errorHandler');

const app = express();

// TASK-112: security headers mounted at root (helmet-equivalent stand-in — the
// helmet package cannot be installed offline on this machine; same headers).
app.use(securityHeaders);

// TASK-112: dynamic CORS allowlist.
//  - Requests with no Origin (curl, server-to-server NextAuth -> Express) pass.
//  - process.env.FRONTEND_URL is always allowed.
//  - In non-production, http://localhost:3000 and http://localhost:3100 are
//    also allowed (client dev server + production-build smoke-test ports).
const FRONTEND_URL =
  process.env.FRONTEND_URL || process.env.CLIENT_URL || 'http://localhost:3000';
const allowedOrigins = [
  process.env.FRONTEND_URL,
  process.env.CLIENT_URL,
  'http://localhost:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3001',
  'http://localhost:3100',
  'http://localhost:3002',
].filter(Boolean);

const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    } else {
      return callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'x-organization-id'],
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// TASK-112: JSON body parser. The `verify` callback captures the RAW request
// body so the GitHub webhook route can recompute X-Hub-Signature-256 over the
// exact bytes GitHub sent (parsed req.body is not byte-for-byte stable).
app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  })
);

app.use('/api/auth', authRoutes);
app.use('/api/organizations', orgRoutes);
app.use('/api/integrations', integrationRoutes);

// Repositories module — lists imported GitHub repositories for a workspace.
app.use('/api/repositories', repositoryRoutes);

// Communication module — Slack message history for the current workspace.
app.use('/api/communication', communicationRoutes);

// Analytics module — dashboard widgets (health score, KPI trends, team health,
// risks & alerts) and the per-developer table.
const analyticsRoutes = require('./src/routes/analyticsRoutes');
app.use('/api/analytics', analyticsRoutes);

// Webhook routes (GitHub, Slack, Jira) — normalized event storage. raw-body
// access is already set up by the express.json verify callback above, so these
// share the same parser. This is the canonical /api/webhooks/* router; the
// lighter-weight logging handlers in integrationRoutes are served only under
// /api/integrations/* (mounted above) so they don't shadow storage.
app.use('/api/webhooks', webhookRoutes);

// Slack Events API — signature-verified inbound (real-time mirroring).
app.use('/api/webhooks/slack', slackWebhookRoutes);

// Slack intra-app routes: conversation list, channel messages, live streams.
// Mounted with the workspaceId + /slack prefix so the router's `:workspaceId`
// param resolves for verifyTenantAccess and the client URLs match exactly.
app.use('/api/workspace/:workspaceId/slack', slackRoutes);

// AI Summaries routes
const aiSummariesRoutes = require('./src/routes/ai-summaries');
app.use('/api/ai-summaries', aiSummariesRoutes);

// Notification Bell routes — RBAC-scoped, deep-linked
const notificationRoutes = require('./src/routes/notificationRoutes');
app.use('/api/notifications', notificationRoutes);

// Mirrored Slack files (local-disk storage by default). Routes are built from
// random-stamped filenames under a workspace-scoped namespace; in production a
// signed-URL layer should guard this mount.
const uploadsDir = path.resolve(__dirname, 'uploads');
app.use('/uploads', express.static(uploadsDir, { dotfiles: 'ignore', fallthrough: true }));

app.get('/health', (req, res) => {
  res.json({ success: true, message: 'PulseOps server is running' });
});

// TASK: Jira/health diagnostic endpoint. Exact shape used by external health
// checks. Business endpoints do NOT rely on this (auth still required there).
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    service: 'pulseops-api',
    timestamp: new Date().toISOString(),
  });
});

// TASK-112: JSON 404 + global error handler (production error masking).
app.use((req, res) => {
  res.status(404).json({ message: 'Not found' });
});

app.use(errorHandler);

const { getSlackCallbackUrl, getJiraCallbackUrl, getGithubCallbackUrl, ensurePublicBackendUrl, getPublicBackendUrl } = require('./src/utils/publicUrl');

const startServer = async () => {
  // Resolve public URL BEFORE connecting — ensures ngrok tunnel is detected early
  // and OAuth redirect_uris are built from the live tunnel, not stale env.
  const publicUrl = await ensurePublicBackendUrl();

  await connectDB();
  startSlackWorker();
  startJiraWorker();

  const slackCallback = getSlackCallbackUrl();
  const jiraCallback = getJiraCallbackUrl();
  const githubCallback = getGithubCallbackUrl();

  const port = process.env.PORT || 5000;
  app.listen(port, () => {
    console.log(`Server running on port ${port}`);
    console.log(`🌐 Public Backend URL: ${publicUrl || getPublicBackendUrl()}`);
    console.log(`🔗 Slack OAuth Callback: ${slackCallback}`);
    console.log(`🔗 Jira OAuth Callback: ${jiraCallback}`);
    console.log(`🔗 GitHub OAuth Callback: ${githubCallback}`);
    if (slackCallback && slackCallback.includes('localhost')) {
      console.warn('⚠️  Slack callback is localhost — Slack cannot reach it over the internet.');
      console.warn('   Run `npm run dev:tunnel` or start ngrok (`ngrok http 5000`) and restart the server.');
      console.warn('   Or set NGROK_STATIC_DOMAIN=<your-reserved-domain> in server/.env for a stable URL.');
      console.warn('   After a hostname change, paste the callback above into: Slack App → OAuth & Permissions → Redirect URLs');
      console.warn('   Direct link: https://api.slack.com/apps → Your App → OAuth & Permissions');
    } else if (slackCallback && slackCallback.includes('ngrok')) {
      const host = new URL(slackCallback).host;
      console.log(`👉 If this ngrok host changed since last run, paste ${slackCallback} into Slack dashboard → OAuth & Permissions → Redirect URLs`);
      console.log(`   https://api.slack.com/apps → Your App → OAuth & Permissions (add & Save URLs)`);
    }
  });
};

// Start only when executed directly (`node server.js`); exporting the app lets
// gate/test harnesses exercise the full wiring without binding a port or
// requiring a live database.
if (require.main === module) {
  startServer();
}

module.exports = app;