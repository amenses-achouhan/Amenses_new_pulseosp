'use strict';

const SlackConversation = require('../models/SlackConversation');
const SlackChannelMessage = require('../models/SlackChannelMessage');
const SlackAttachment = require('../models/SlackAttachment');
const SlackUser = require('../models/SlackUser');
const { slackApi, typedSlackResult, hasSlackScope, mapSlackErrorMessage, downloadPrivateFile } = require('./slackApi');
const { uploadFileBuffer, categorizeFile } = require('./slackStorage');
const { extractUrls } = require('./slackLinkPreview');

const { SYNC_STATUS, CONVERSATION_TYPE } = SlackConversation;

/**
 * Slack synchronization service.
 *
 * Two entry points:
 *   1. discoverConversations(integration)   — conversations.list (paginated),
 *      persists every accessible conversation for the workspace.
 *   2. syncConversationHistory({integration, conversationId}) — paginated
 *      conversations.history within SLACK_INITIAL_HISTORY_LIMIT, thread reply
 *      sync, user caching, file job fan-out, and sync-status updates.
 *
 * Everything here is tenant-scoped by integration.organizationId. The service
 * never enforces HTTP auth (that lives in the routes/worker) — it assumes the
 * caller has already resolved a valid active Integration for that workspace.
 */

const MENTION_RE = /<@([UWB][A-Z0-9]+)>/g;

/** Extract Slack user mentions from message text. */
function extractMentions(text) {
  const ids = [];
  const textValue = text || '';
  let m;
  MENTION_RE.lastIndex = 0;
  while ((m = MENTION_RE.exec(textValue)) !== null) {
    if (!ids.includes(m[1])) ids.push(m[1]);
  }
  return ids;
}

/**
 * Enqueue link-preview jobs for every URL referenced in a message. Dedup is
 * handled by the SlackLink unique index (org + channel + messageId + url), so
 * repeated syncs/events never create duplicate preview rows.
 */
async function enqueueLinkPreviews({ text, messageId, channelId, enqueueLink }) {
  if (!enqueueLink || !text || !messageId || !channelId) return;
  await enqueueLink({ channelId, messageId, url: extractUrls(text) });
}

/**
 * Mongo-cached user resolution. Slugs users.info calls down to one lookup per
 * Slack user per workspace (plus explicit refreshes) instead of one per message.
 *
 * @param {object} integration - Integration doc (provider 'slack').
 * @param {string} [userId]    - Slack user id (U…/W…), may be null for bots.
 * @param {boolean} [force]    - Bypass cache (used on message_changed to pick up avatar edits).
 * @returns {Promise<object|null>} SlackUser document (or null when unknown).
 */
async function resolveUser(integration, userId, force = false) {
  if (!userId) return null;
  const organizationId = integration.organizationId;

  if (!force) {
    const cached = await SlackUser.findOne({ organizationId, userId }).lean();
    if (cached) return cached;
  }

  const result = await slackApi(integration, 'users.info', { user: userId });
  if (!result.ok) {
    // Unknown / deleted members still produce messages; keep a minimal row so
    // message rendering has a stable identity.
    return SlackUser.findOneAndUpdate(
      { organizationId, userId },
      {
        $set: { displayName: '', realName: '', isDeleted: true },
        $setOnInsert: { organizationId, userId, slackTeamId: integration.slackTeamId || null },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }

  const u = result.data.user || {};
  const profile = u.profile || {};
  return SlackUser.findOneAndUpdate(
    { organizationId, userId },
    {
      $set: {
        displayName: profile.display_name || profile.real_name || u.name || '',
        realName: profile.real_name || profile.display_name || '',
        avatarUrl: profile.image_192 || profile.image_512 || profile.image_72 || null,
        email: profile.email || null,
        isBot: !!u.is_bot,
        isDeleted: !!u.deleted,
        slackTeamId: integration.slackTeamId || null,
        refreshedAt: new Date(),
      },
      $setOnInsert: { organizationId, userId },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

/** Build the normalized, AI-ready message document before upsert. */
function normalizeMessage({ channelId, msg, source, parentMessageId }) {
  const threadTs = msg.thread_ts || null;
  const messageId = msg.ts;

  let messageType = 'message';
  if (msg.subtype === 'bot_message' || msg.bot_id) messageType = 'bot';
  if (Array.isArray(msg.files) && msg.files.length > 0 && !msg.text) messageType = 'file';
  if (msg.subtype && ['channel_join', 'channel_leave', 'channel_topic', 'channel_purpose',
    'channel_name', 'channel_archive', 'channel_unarchive', 'pinned_item', 'thread_broadcast'].includes(msg.subtype)) {
    messageType = 'system';
  }

  const rawPayload = {
    type: msg.type || 'message',
    subtype: msg.subtype || null,
    ts: messageId,
    user: msg.user || null,
    bot_id: msg.bot_id || null,
    text: msg.text || '',
    channel: msg.channel || channelId,
    thread_ts: threadTs,
    files: Array.isArray(msg.files)
      ? msg.files.map((f) => ({ id: f.id, name: f.name, title: f.title, mimetype: f.mimetype, filetype: f.filetype, size: f.size })).slice(0, 10)
      : [],
    reactions: Array.isArray(msg.reactions)
      ? msg.reactions.map((r) => ({ name: r.name, count: r.count, users: r.users || [] }))
      : [],
    edited: msg.edited ? { user: msg.edited.user || null, ts: msg.edited.ts || null } : null,
    blocks: Array.isArray(msg.blocks) ? { blockCount: msg.blocks.length } : null,
  };

  return {
    messageId,
    threadTs,
    parentMessageId,
    subtype: msg.subtype || null,
    messageType,
    mentions: extractMentions(msg.text),
    reactions: Array.isArray(msg.reactions)
      ? msg.reactions.reduce((acc, r) => {
          acc[r.name] = { count: r.count || 0, users: r.users || [] };
          return acc;
        }, {})
      : {},
    replyCount: Number(msg.reply_count || 0) || 0,
    threadLatestReply: msg.latest_reply || null,
    text: msg.text || '',
    rawPayload,
    syncSource: source,
    editedAt: msg.edited ? new Date(Number(msg.edited.ts) * 1000) : null,
  };
}

/**
 * Upsert a single Slack message (shared by historical sync + realtime workers).
 * Returns the resulting document.
 */
async function upsertSlackMessage({ integration, organizationId, channelId, msg, source, user, parentMessageId = null }) {
  const messageId = msg.ts;
  if (!channelId || !messageId) return null;

  let resolvedUser = user;
  if (msg.user) resolvedUser = resolvedUser || (await resolveUser(integration, msg.user));
  else if (msg.bot_id && msg.username && !resolvedUser) {
    resolvedUser = { displayName: msg.username, realName: '', avatarUrl: null, isBot: true };
  }

  const setFields = normalizeMessage({
    integration,
    organizationId,
    channelId,
    msg,
    source,
    parentMessageId,
  });

  const doc = await SlackChannelMessage.findOneAndUpdate(
    { organizationId, channelId, messageId },
    {
      $set: {
        ...setFields,
        parentMessageId: parentMessageId || null,
        slackUserId: msg.user || null,
        userName: resolvedUser ? resolvedUser.userName || resolvedUser.displayName || resolvedUser.realName : null,
        userAvatar: resolvedUser ? resolvedUser.userAvatar || resolvedUser.avatarUrl : null,
        threadTs: msg.thread_ts || null,
      },
      $setOnInsert: { organizationId, channelId, messageId },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  if (Array.isArray(msg.files) && msg.files.length > 0 && source === 'history') {
    for (const f of msg.files) await syncFile({ integration, organizationId, channelId, messageId, file: f });
  }

  return doc;
}

/** Apply a Slack message_deleted event (used by history + realtime). */
async function markMessageDeleted({ organizationId, channelId, deletedTs }) {
  if (!deletedTs) return;
  await SlackChannelMessage.updateOne(
    { organizationId, channelId, messageId: deletedTs, deletedAt: null },
    { $set: { deletedAt: new Date() } }
  );
}

/**
 * Sync a thread's replies (conversations.replies, paginated). Replies are
 * stored as their own documents with parentMessageId = threadTs; the root's
 * replyCount is refreshed from the actual reply documents.
 */
async function syncThread({ integration, organizationId, channelId, threadTs, replyCount }) {
  let cursor = '';
  let replies = 0;
  do {
    const result = typedSlackResult(await slackApi(integration, 'conversations.replies', {
      channel: channelId,
      ts: threadTs,
      cursor: cursor || undefined,
      limit: 200,
    }));
    if (!result.ok) throw result;

    const { messages = [] } = result.data;
    for (const reply of messages) {
      // conversations.replies returns the thread root as the first message.
      if (reply.ts === threadTs) continue;
      await upsertSlackMessage({
        integration,
        organizationId,
        channelId,
        msg: { ...reply, thread_ts: threadTs },
        source: 'history',
        parentMessageId: threadTs,
      });
      replies += 1;
    }
    cursor = (result.data.response_metadata && result.data.response_metadata.next_cursor) || '';
  } while (cursor);

  if (replyCount != null || replies > 0) {
    const count = replyCount != null && replyCount > 0 ? replyCount : replies;
    await SlackChannelMessage.updateOne(
      { organizationId, channelId, messageId: threadTs },
      { $set: { replyCount: count, threadLatestReply: threadTs } }
    );
  }
}

/**
 * Discover every accessible conversation for the workspace (conversations.list
 * with cursor pagination) and persist them.
 * @returns {Promise<Array>} persisted conversation documents.
 */
async function discoverConversations(integration) {
  const organizationId = integration.organizationId;
  let cursor = '';
  const discovered = [];
  let page = 0;

  do {
    const result = typedSlackResult(await slackApi(integration, 'conversations.list', {
      types: 'public_channel,private_channel',
      limit: 200,
      cursor: cursor || undefined,
      exclude_archived: undefined,
    }));
    if (!result.ok) throw result;

    const channels = result.data.channels || [];
    for (const c of channels) {
      let conversationType = CONVERSATION_TYPE.PUBLIC_CHANNEL;
      if (c.is_private) conversationType = CONVERSATION_TYPE.PRIVATE_CHANNEL;
      if (c.is_im || c.id && c.id.startsWith('D')) conversationType = CONVERSATION_TYPE.DIRECT_MESSAGE;
      if (c.is_mpim) conversationType = CONVERSATION_TYPE.GROUP_DM;

      const doc = await SlackConversation.findOneAndUpdate(
        { organizationId, conversationId: c.id },
        {
          $set: {
            slackTeamId: integration.slackTeamId || null,
            name: c.name || '',
            conversationType,
            isPrivate: !!c.is_private,
            isArchived: !!c.is_archived,
            isMember: c.is_member === undefined ? true : !!c.is_member,
            isMpim: !!c.is_mpim,
            topic: (c.topic && c.topic.value) || '',
            purpose: (c.purpose && c.purpose.value) || '',
            memberCount: Number(c.num_members || c.member_count || 0),
            createdBy: c.creator || null,
          },
          $setOnInsert: { organizationId, conversationId: c.id },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      discovered.push(doc);
    }

    cursor = (result.data.response_metadata && result.data.response_metadata.next_cursor) || '';
    page += 1;
  } while (cursor && page < 100); // hard ceiling guards an infinite loop

  return discovered;
}

/**
 * Ensure the bot is a member of a conversation it must read. Slack only
 * permits auto-joining PUBLIC channels (via `conversations.join`, guarded by
 * the `channels:join` scope). Private channels require a manual invite and are
 * never auto-joined here.
 *
 * @returns {Promise<boolean>} true when the bot is (or became) a member.
 */
async function ensureConversationMembership(integration, conversation) {
  if (!conversation) return false;
  if (conversation.isMember) return true;
  if (conversation.isPrivate || conversation.isArchived) return false;
  if (!hasSlackScope(integration, 'channels:join')) return false;

  const result = typedSlackResult(await slackApi(integration, 'conversations.join', {
    channel: conversation.conversationId,
  }));
  if (!result.ok) throw result;

  await SlackConversation.updateOne(
    { organizationId: integration.organizationId, conversationId: conversation.conversationId },
    { $set: { isMember: true } }
  );
  return true;
}

/**
 * Historical sync for a single conversation. Pulls up to
 * SLACK_INITIAL_HISTORY_LIMIT newest messages (configurable), upserts
 * messages, resolves+marks deleted ones, syncs threads, and fans file
 * downloads out to dedicated file jobs when an enqueueFile callback is given.
 *
 * When Slack reports `not_in_channel` for an eligible public channel and the
 * `channels:join` scope is granted, the bot joins once and the sync is retried
 * a single bounded time. All other failures persist `SYNC_ERROR` with the raw
 * Slack error code for actionable UI messaging.
 *
 * @param {object}   opts
 * @param {object}   opts.integration
 * @param {string}   opts.conversationId
 * @param {Function} [opts.enqueueFile]   async ({file, messageId}) => void
 * @param {Function} [opts.enqueueLink]   async ({channelId, messageId, url}) => void
 * @returns {Promise<{ok:boolean, messageCount:number, error?:object}>}
 */
async function syncConversationHistory({ integration, conversationId, enqueueFile, enqueueLink }) {
  const organizationId = integration.organizationId;
  const conversation = await SlackConversation.findOne({ organizationId, conversationId });
  if (!conversation) return { ok: false, error: { permanent: true, code: 'channel_not_found', message: 'Conversation not found.' } };

  const syncErrorMessage = (code) => mapSlackErrorMessage(code, { isPrivate: conversation.isPrivate });

  const runSync = async () => {
    await SlackConversation.updateOne(
      { organizationId, conversationId },
      { $set: { syncStatus: SYNC_STATUS.SYNCING, syncError: null, syncErrorCode: null } }
    );

    try {
      const historyLimit = Math.max(1, Number(process.env.SLACK_INITIAL_HISTORY_LIMIT) || 200);
      let cursor = '';
      let synced = 0;

      do {
        const result = typedSlackResult(await slackApi(integration, 'conversations.history', {
          channel: conversationId,
          cursor: cursor || undefined,
          limit: 50,
        }));
        if (!result.ok) throw result;

        for (const msg of result.data.messages || []) {
          if (synced >= historyLimit) break;

          if (msg.subtype === 'message_deleted') {
            await markMessageDeleted({ organizationId, channelId: conversationId, deletedTs: msg.deleted_ts });
            synced += 1;
            continue;
          }
          // message_changed inside history carries the edited message in the `message` key.
          if (msg.subtype === 'message_changed' && msg.message) {
            await upsertSlackMessage({
              integration,
              organizationId,
              channelId: conversationId,
              msg: { ...msg.message, channel: conversationId },
              source: 'history',
              user: await resolveUser(integration, msg.message.user),
            });
            synced += 1;
            continue;
          }

          const isThreadRoot = msg.thread_ts && msg.thread_ts === msg.ts;
          const saved = await upsertSlackMessage({
            integration,
            organizationId,
            channelId: conversationId,
            msg,
            source: 'history',
          });
          if (!saved) continue;
          synced += 1;

          // Link previews <- dedicated worker jobs (off the history loop).
          if (saved.messageId && saved.text) {
            await enqueueLinkPreviews({
              text: saved.text,
              messageId: saved.messageId,
              channelId: conversationId,
              enqueueLink,
            });
          }

          // Files -> dedicated worker jobs (never downloaded inline in webhook/history).
          if (Array.isArray(msg.files) && msg.files.length > 0) {
            for (const f of msg.files) {
              if (enqueueFile) await enqueueFile({ file: f, messageId: msg.ts });
            }
          }

          // Thread roots -> paginated replies.
          if (isThreadRoot) {
            try {
              await syncThread({
                integration,
                organizationId,
                channelId: conversationId,
                threadTs: msg.thread_ts,
                replyCount: msg.reply_count,
              });
            } catch (threadErr) {
              const t = typedSlackResult(threadErr);
              if (t.permanent) {
                console.warn(`[slackSync] thread sync blocked (${t.code}) for ${conversationId}/${msg.thread_ts} — continuing.`);
              } else {
                throw threadErr;
              }
            }
          }

          if (synced >= historyLimit) break;
        }

        cursor = (result.data.response_metadata && result.data.response_metadata.next_cursor) || '';
      } while (cursor && synced < historyLimit);

      const messageCount = await SlackChannelMessage.countDocuments({
        organizationId,
        channelId: conversationId,
        deletedAt: null,
        parentMessageId: null,
      });

      await SlackConversation.updateOne(
        { organizationId, conversationId },
        { $set: { syncStatus: SYNC_STATUS.SYNCED, syncError: null, syncErrorCode: null, messageCount, lastSyncedAt: new Date() } }
      );

      return { ok: true, messageCount };
    } catch (err) {
      const t = typedSlackResult(err);
      await SlackConversation.updateOne(
        { organizationId, conversationId },
        {
          $set: {
            syncStatus: SYNC_STATUS.SYNC_ERROR,
            syncError: syncErrorMessage(t.code),
            syncErrorCode: t.code,
          },
        }
      );
      return { ok: false, error: { ...t, message: syncErrorMessage(t.code) } };
    }
  };

  const first = await runSync();
  if (first.ok || first.error.code !== 'not_in_channel') return first;

  // Auto-join eligible public channels once, then retry a single bounded time.
  const eligible = !conversation.isPrivate && !conversation.isArchived && hasSlackScope(integration, 'channels:join');
  if (!eligible) return first;

  try {
    const joined = await ensureConversationMembership(integration, conversation);
    if (joined) return runSync();
  } catch (joinErr) {
    console.warn(`[slackSync] conversations.join failed for ${conversationId}:`, joinErr.message);
  }
  return first;
}

/**
 * Download + mirror a single Slack file and persist the attachment row.
 * Refuses to run inside the webhook request — always driven by a worker job.
 */
async function syncFile({ integration, organizationId, channelId, messageId, file }) {
  if (!file || !file.id) return null;

  let meta = file;
  if (!meta.url_private_download && !meta.url_private && meta.id) {
    const info = typedSlackResult(await slackApi(integration, 'files.info', { file: file.id }));
    if (info.ok) meta = info.data.file;
  }

  const fileId = meta.id;
  const fileName = meta.name || meta.title || null;
  const fileType = meta.mimetype || meta.filetype || null;
  const fileSizeBytes = Number(meta.size || 0);
  const privateUrl = meta.url_private_download || meta.url_private || null;

  let storageUrl = null;
  if (privateUrl) {
    const downloaded = await downloadPrivateFile(integration, privateUrl);
    if (downloaded) {
      const stored = await uploadFileBuffer({
        organizationId,
        channelId,
        fileName: fileName || `file-${fileId}`,
        buffer: downloaded.buffer,
        fileType: downloaded.mimetype || fileType,
      });
      if (stored) storageUrl = stored.storageUrl;
    }
  }

  return SlackAttachment.findOneAndUpdate(
    { organizationId, channelId, fileId },
    {
      $set: {
        messageId,
        fileName,
        fileType,
        fileCategory: categorizeFile(fileName, fileType),
        fileSizeBytes,
        storageUrl,
        slackPrivateUrl: privateUrl,
      },
      $setOnInsert: { organizationId, channelId, fileId },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

module.exports = {
  resolveUser,
  discoverConversations,
  syncConversationHistory,
  syncThread,
  syncFile,
  upsertSlackMessage,
  markMessageDeleted,
  ensureConversationMembership,
  enqueueLinkPreviews,
  normalizeMessage,
  extractMentions,
};