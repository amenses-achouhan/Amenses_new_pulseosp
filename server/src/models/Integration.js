const mongoose = require('mongoose');
const { Schema } = mongoose;

const integrationSchema = new Schema({
  organizationId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
  provider: { type: String, required: true, enum: ['github', 'slack', 'jira'] },
  status: { type: String, enum: ['active', 'revoked', 'pending'], default: 'pending' },
  // OAuth `state` guard. Persisted in /github/connect BEFORE the redirect and
  // consumed in /github/callback. Without this field Mongoose's strict mode
  // silently drops the value, breaking state validation on the callback.
  state: { type: String },
  // RC-1 — frontend origin the user initiated the connect from. The OAuth
  // callback redirects here (not a hardcoded FRONTEND_URL) so the NextAuth
  // session cookie travels with the landing request and the user stays signed
  // in. Set on each /authorize, consumed by the matching callback.
  returnTo: { type: String, default: null },
  accessToken: { type: String },
  refreshToken: { type: String },
  // Slack bot (xoxb) token for Web API calls (conversations.history/replies,
  // users.list). Encrypted at rest — never exposed to the browser.
  slackBotToken: { type: String, default: null },
  slackTeamId: { type: String, default: null },
  slackChannelId: { type: String, default: null },
  slackChannelName: { type: String, default: null },
  slackTeamName: { type: String, default: null },
  // Bot user id (U…) returned by auth.test — used for self-echo suppression.
  botUserId: { type: String, default: null },
  // Scopes actually granted on the token. Never assumed; recorded from the
  // OAuth response and/or the token introspection. Drives the "Permissions
  // need updating → Reconnect Slack" UX when the required scope set grows.
  grantedScopes: { type: [String], default: [] },
  requiredScopes: { type: [String], default: [] },
  // Actionable integration-level error (missing_scope, invalid_auth, ...) that
  // surfaces in the integrations UI instead of a silent failure.
  authError: { type: String, default: null },
  lastAuthTestAt: { type: Date, default: null },
  metadata: { type: Schema.Types.Mixed, default: {} },
  // TASK-108 — webhook activity trail (updated by POST /api/integrations/:provider/webhook).
  lastWebhookEvent: { type: String, default: null },
  lastWebhookAt: { type: Date, default: null },
  lastWebhookId: { type: String, default: null },
  // Jira-specific fields
  jiraSiteUrl: { type: String },
  jiraCloudId: { type: String },
  tokenExpiresAt: { type: Date },
  jiraWebhookId: { type: String },
  lastSyncAt: { type: Date },
}, { timestamps: true });

integrationSchema.index({ organizationId: 1, provider: 1 }, { unique: true });

module.exports = mongoose.model('Integration', integrationSchema);