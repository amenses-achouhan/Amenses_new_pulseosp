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

// Dynamic CORS allowlist.
// - Requests with no Origin (curl, server-to-server NextAuth → Express) pass.
// - Production: only FRONTEND_URL (single source of truth for the frontend origin).
// - Development: also allow localhost origins for the Next.js dev server.
//
// IMPORTANT: FRONTEND_URL must exactly match what the browser sends as Origin.
// No trailing slash. Must be https:// in production.
const frontendUrl = process.env.FRONTEND_URL ? process.env.FRONTEND_URL.replace(/\/$/, '') : null;

if (process.env.NODE_ENV === 'production' && !frontendUrl) {
  console.error('[cors] ⚠️  FRONTEND_URL is not set. CORS will block ALL browser requests.');
  console.error('[cors]    Set FRONTEND_URL=https://your-frontend-domain.com in server/.env');
}

const devOrigins = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3001',
  'http://localhost:3100',
  'http://localhost:3002',
];

const allowedOrigins = process.env.NODE_ENV === 'production'
  ? (frontendUrl ? [frontendUrl] : [])
  : [...devOrigins, ...(frontendUrl ? [frontendUrl] : [])];

if (process.env.NODE_ENV === 'production') {
  console.log('[cors] Production allowed origins:', allowedOrigins);
} else {
  console.log('[cors] Development allowed origins:', allowedOrigins);
}

const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (server-to-server, curl, mobile apps)
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    console.error('[cors] Origin rejected:', origin, '| Allowed:', allowedOrigins);
    return callback(new Error(`CORS blocked for origin: ${origin}`));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Organization-Id'],
  credentials: true,
  optionsSuccessStatus: 204,
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

  // Startup validation: ensure critical env vars are set in production.
  if (process.env.NODE_ENV === 'production') {
    const missing = [];
    if (!process.env.FRONTEND_URL) missing.push('FRONTEND_URL');
    if (!process.env.BACKEND_PUBLIC_URL) missing.push('BACKEND_PUBLIC_URL');
    if (!process.env.JWT_SECRET) missing.push('JWT_SECRET');
    if (missing.length > 0) {
      console.error(`[startup] ⚠️  Missing required env vars: ${missing.join(', ')}`);
      console.error('[startup]    CORS and OAuth will not work correctly without these.');
    }
  }

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
      console.warn('   Or set BACKEND_PUBLIC_URL=<your-public-url> in server/.env for a stable URL.');
      console.warn('   After a hostname change, paste the callback above into: Slack App → OAuth & Permissions → Redirect URLs');
      console.warn('   Direct link: https://api.slack.com/apps → Your App → OAuth & Permissions');
    } else if (slackCallback && slackCallback.includes('ngrok')) {
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