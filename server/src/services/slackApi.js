'use strict';
const { decrypt } = require('../utils/crypto');

const SLACK_API = 'https://slack.com/api';
const MAX_FILE_GB = 1 * 1024 * 1024 * 1024; // 1 GB ceiling for mirrored files

/**
 * Slack method errors are mapped to a small typed shape so queue workers and
 * route handlers can reason about retry vs. permanent-failure semantics.
 *
 *   code        — raw Slack error string (invalid_auth, missing_scope, ...)
 *   permanent   — true => do NOT retry; surface as actionable integration/conversation status
 *   message     — human-readable message for the PulseOps UI
 *   retryAfter  — seconds Slack asked us to wait (ratelimited)
 */
function typedSlackResult(result) {
  const { ok, status, error, data } = result;
  if (ok) return { ok: true, data };
  return {
    ok: false,
    error,
    code: error || (status >= 400 ? `http_${status}` : 'slack_api_error'),
    permanent: isPermanentError(error),
    data,
    message: error ? mapSlackErrorMessage(error) : `Slack API error (HTTP ${status})`,
    retryAfter: data && data.retryAfter ? data.retryAfter : null,
  };
}

/** Slack errors that should never be auto-retried (actionable instead). */
function isPermanentError(error) {
  return ['not_in_channel', 'missing_scope', 'invalid_auth', 'account_inactive',
    'invalid_arguments', 'channel_not_found', 'is_archived', 'method_not_supported_for_channel_type']
    .includes(error);
}

function mapSlackErrorMessage(error, ctx = {}) {
  switch (error) {
    case 'not_in_channel':
      return ctx.isPrivate
        ? 'Private channel — invite the PulseOps bot manually, then retry sync.'
        : 'Public channel — the PulseOps bot will join automatically on the next sync.';
    case 'missing_scope': {
      const missing = Array.isArray(ctx.missingScopes) ? ctx.missingScopes : null;
      return missing && missing.length
        ? `Slack permissions need to be updated. Reconnect Slack (missing: ${missing.join(', ')}).`
        : 'Slack permissions need to be updated. Reconnect Slack.';
    }
    case 'invalid_auth':
    case 'account_inactive':
      return 'Slack authorization has expired. Reconnect Slack.';
    case 'ratelimited':
    case 'rate_limited':
      return 'Slack rate limit reached. Sync will retry automatically.';
    case 'channel_not_found':
      return 'This Slack conversation no longer exists.';
    case 'is_archived':
      return 'This Slack conversation is archived.';
    case 'invalid_arguments':
      return 'Slack rejected the request arguments.';
    default:
      return `Slack API error: ${error}`;
  }
}

/** Whether an active Slack integration's granted scopes include `scope`. */
function hasSlackScope(integration, scope) {
  const granted = integration && Array.isArray(integration.grantedScopes)
    ? integration.grantedScopes
    : [];
  return granted.includes(scope);
}

function botToken(integration) {
  return decrypt(integration.botToken);
}

/**
 * Low-level Slack API call. Form-encoded POST (the only body format Slack's
 * Web API accepts for token-authenticated methods).
 * @param {object} integration - Integration doc (provider 'slack').
 * @param {string} method      - e.g. 'conversations.history'.
 * @param {object} [body]      - Form-encoded params.
 * @returns {Promise<{ok:boolean, data:object, status:number, error?:string}>}
 */
async function slackApi(integration, method, body = {}) {
  const token = botToken(integration);
  if (!token) {
    return { ok: false, status: 401, error: 'invalid_auth', data: {} };
  }
  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(body)) {
    if (v !== undefined && v !== null) form.append(k, String(v));
  }
  const res = await fetch(`${SLACK_API}/${method}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
  });
  const status = res.status;
  const data = await res.json();

  // Surface Slack's Retry-After guidance for rate limits on the result object
  // so typedSlackResult can relay it to the queue's backoff logic.
  if (status === 429 || data?.error === 'ratelimited') {
    data.retryAfter = Number(res.headers.get('retry-after') || 5);
  }

  if (!data.ok) {
    return { ok: false, status, error: data.error || 'slack_api_error', data };
  }
  return { ok: true, status, data };
}

/**
 * auth.test — verifies the bot token is still valid and returns the owning
 * bot user id + team + enterprise. No extra scope required.
 */
async function authTest(integration) {
  return slackApi(integration, 'auth.test', {});
}

/** Resolve a Slack user's display name + avatar + profile. */
async function getSlackUser(integration, userId) {
  if (!userId) return null;
  const result = await slackApi(integration, 'users.info', { user: userId });
  if (!result.ok) {
    console.warn(`[slackApi] users.info failed: ${result.error}`);
    return null;
  }
  const profile = result.data.user.profile || {};
  return {
    userName: profile.display_name || profile.real_name || profile.name || null,
    userAvatar: profile.image_192 || profile.image_512 || profile.image_72 || null,
    email: profile.email || null,
  };
}

/** Fetch a single page of conversations.list (types-controlled). */
async function listChannels(integration, cursor = '', limit = 200, types = null) {
  return slackApi(integration, 'conversations.list', {
    types: types || 'public_channel,private_channel',
    cursor,
    limit,
    exclude_archived: 'true',
  });
}

/** Fetch channel history page (cursor-based). */
async function fetchHistory(integration, channelId, cursor = '', limit = 50) {
  return slackApi(integration, 'conversations.history', {
    channel: channelId,
    cursor,
    limit,
  });
}

/** Fetch replies inside a thread (includes the thread root in response.messages). */
async function fetchReplies(integration, channelId, threadTs, cursor = '', limit = 200) {
  return slackApi(integration, 'conversations.replies', {
    channel: channelId,
    ts: threadTs,
    cursor,
    limit,
  });
}

/** Get file metadata (mimetype, size, download URL). */
async function getFileInfo(integration, fileId) {
  return slackApi(integration, 'files.info', { file: fileId });
}

/** Get channel info (topic, purpose, member count). */
async function getConversationInfo(integration, channelId) {
  return slackApi(integration, 'conversations.info', { channel: channelId, include_num_members: 'true' });
}

/**
 * Download a private Slack file as a Buffer.
 * Private URLs (`url_private_download`) require the bot token in the
 * Authorization header. Returns null when the file is missing/oversized.
 */
async function downloadPrivateFile(integration, privateUrl) {
  if (!privateUrl) return null;
  const token = botToken(integration);
  const res = await fetch(privateUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const contentLength = Number(res.headers.get('content-length') || 0);
  if (contentLength > MAX_FILE_GB) return null;
  const buffer = Buffer.from(await res.arrayBuffer());
  return { buffer, mimetype: res.headers.get('content-type') || null };
}

module.exports = {
  slackApi,
  typedSlackResult,
  mapSlackErrorMessage,
  isPermanentError,
  hasSlackScope,
  resolveUser: getSlackUser,
  listChannels,
  fetchHistory,
  fetchReplies,
  getFileInfo,
  getConversationInfo,
  authTest,
  downloadPrivateFile,
};