'use strict';

const Integration = require('../models/Integration');
const SlackEvent = require('../models/SlackEvent');
const SlackConversation = require('../models/SlackConversation');
const SlackChannelMessage = require('../models/SlackChannelMessage');
const SlackLink = require('../models/SlackLink');
const { slackQueue } = require('./slackQueue');
const {
  resolveUser,
  discoverConversations,
  syncConversationHistory,
  syncFile,
  upsertSlackMessage,
  markMessageDeleted,
  enqueueLinkPreviews,
} = require('./slackSync');
const { slackApi, typedSlackResult } = require('./slackApi');
const { normalizeUrl, domainOf, isSafeUrl, fetchPreview, LinkError } = require('./slackLinkPreview');
const realtime = require('./slackRealtime');

/**
 * Slack Events API worker.
 *
 * Job types handled:
 *   slack_event_callback       — realtime event (message / file / channel meta)
 *   slack_discover_conversations — conversations.list after OAuth / reconnect
 *   slack_sync_conversation    — full historical backfill for one conversation
 *   slack_sync_file            — authenticated file download + mirror
 *
 * All writes are tenant-scoped to the Integration's organizationId, which is
 * resolved from the event's team_id (never from anything the client controls).
 */

/** Record an event in the idempotency ledger. Returns false when duplicate. */
async function recordSlackEvent({ organizationId, eventId, eventType, teamId, payload }) {
  if (!eventId) return true; // challenge / non-event_callback bodies have no event_id
  const existing = await SlackEvent.findOne({ organizationId, eventId });
  if (existing) return false;
  try {
    await SlackEvent.create({
      organizationId,
      eventId,
      eventType: String(eventType || ''),
      slackTeamId: teamId || null,
      payload,
    });
    return true;
  } catch (err) {
    if (err && err.code === 11000) return false; // concurrent duplicate
    throw err;
  }
}

/** Resolve the tenant's active Slack Integration from team_id. */
async function findIntegration(teamId, event) {
  if (teamId) {
    const byTeam = await Integration.findOne({ provider: 'slack', slackTeamId: teamId, status: 'active' });
    if (byTeam) return byTeam;
  }
  // Fallback: match by conversation id captured on the OAuth integration.
  if (event && event.channel) {
    const byChannel = await Integration.findOne({ provider: 'slack', slackChannelId: event.channel, status: 'active' });
    if (byChannel) return byChannel;
  }
  return Integration.findOne({ provider: 'slack', status: 'active' });
}

// ---------------------------------------------------------------------------
// Realtime events
// ---------------------------------------------------------------------------

async function processSlackEvent(job) {
  const payload = (job && job.payload) || {};
  const body = payload.body || payload;

  if (!body || body.type !== 'event_callback' || !body.event) {
    return { dropped: true, reason: 'not_event_callback' };
  }

  const event = body.event;
  const teamId = body.team_id || null;
  const eventId = body.event_id || null;

  const integration = await findIntegration(teamId, event);
  if (!integration) {
    return { dropped: true, reason: 'no_integration' };
  }
  const organizationId = integration.organizationId;

  // Idempotency: Slack may retry the same event_id; a fresh consumer must not
  // create duplicate messages. (Ledger entry happens BEFORE processing.)
  const isNewEvent = await recordSlackEvent({
    organizationId,
    eventId,
    eventType: event.type,
    teamId,
    payload: body,
  });
  if (!isNewEvent) {
    return { dropped: true, reason: 'duplicate_event' };
  }

  try {
    const result = await handleEvent({ integration, organizationId, event });
    await SlackEvent.updateOne(
      { organizationId, eventId },
      { $set: { status: 'processed', processedAt: new Date() } }
    );
    return result;
  } catch (err) {
    await SlackEvent.updateOne(
      { organizationId, eventId },
      { $set: { status: 'error', error: (err && err.message) || 'error', processedAt: new Date() } }
    );
    throw err; // let the queue retry transient failures
  }
}

async function handleEvent({ integration, organizationId, event }) {
  const eventType = event.type;

  if (eventType === 'message') return handleMessageEvent({ integration, organizationId, event });
  if (eventType === 'file_shared' && event.file_id) {
    return handleFileShared({ integration, organizationId, event });
  }
  if (eventType === 'reaction_added' || eventType === 'reaction_removed') {
    return handleReactionEvent({ integration, organizationId, event });
  }
  if (['channel_created', 'channel_rename', 'channel_archive', 'channel_unarchive',
    'group_created', 'group_rename', 'group_archive', 'group_unarchive'].includes(eventType)) {
    return handleChannelMeta({ integration, organizationId, event });
  }
  return { dropped: true, reason: `unhandled_event:${eventType}` };
}

async function handleMessageEvent({ integration, organizationId, event }) {
  const channelId = event.channel;
  if (!channelId) return { dropped: true, reason: 'missing_channel' };

  // Self-echo suppression: any message our own bot produced is skipped — both
  // modern bot_message events and the bot's direct messages.
  if (event.bot_id && integration.botUserId && event.bot_id === integration.botUserId) {
    return { dropped: true, reason: 'self_echo' };
  }

  // Skip message_im / message_mpim (DM scopes not requested in MVP).
  if (channelId && channelId.startsWith('D') && !channelId.startsWith('G')) {
    return { dropped: true, reason: 'direct_message_unsupported' };
  }

  if (event.subtype === 'message_deleted') {
    await markMessageDeleted({ organizationId, channelId, deletedTs: event.deleted_ts });
    const messageId = event.deleted_ts || event.ts;
    realtime.broadcast(channelId, 'slack_message_deleted', { channelId, messageId });
    return { dropped: false, action: 'deleted', messageId };
  }

  if (event.subtype === 'message_changed' && event.message) {
    const user = await resolveUser(integration, event.message.user, true);
    const saved = await upsertSlackMessage({
      integration,
      organizationId,
      channelId,
      msg: { ...event.message, channel: channelId, edited: { ts: event.ts, user: event.edited?.user } },
      source: 'realtime',
      user,
    });
    realtime.broadcast(channelId, 'slack_message_updated', {
      channelId,
      message: serializeMessage(saved),
    });
    return { dropped: false, action: 'updated', messageId: saved && saved.messageId };
  }

  // Normal new message.
  const saved = await upsertSlackMessage({
    integration,
    organizationId,
    channelId,
    msg: event,
    source: 'realtime',
  });

  const attachments = Array.isArray(saved && saved.rawPayload && saved.rawPayload.files)
    ? saved.rawPayload.files
    : [];

  realtime.broadcast(channelId, 'new_slack_message', {
    channelId,
    message: serializeMessage(saved),
    attachments,
  });

  // file_shared-style events embed candidate file ids; schedule dedicated jobs.
  if (Array.isArray(event.files) && event.files.length > 0) {
    for (const f of event.files) {
      await enqueueFileJob({
        integrationId: integration._id.toString(),
        organizationId,
        channelId,
        file: f,
        messageId: saved.messageId,
      });
    }
  }

  // Link previews <- dedicated worker jobs.
  await enqueueLinkPreviews({
    text: event.text,
    messageId: saved && saved.messageId,
    channelId,
    enqueueLink: ({ url }) =>
      enqueueLinkJob({
        integrationId: integration._id.toString(),
        organizationId,
        channelId,
        messageId: saved.messageId,
        urls: url,
      }),
  });

  return { dropped: false, action: 'created', messageId: saved && saved.messageId };
}

async function handleFileShared({ integration, organizationId, event }) {
  const channelId = event.channel_id || event.channel || null;
  // files.info links the file to its message via `associated_message_id`.
  const job = { file: { id: event.file_id }, messageId: event.file_id };
  await enqueueFileJob({
    integrationId: integration._id.toString(),
    organizationId,
    channelId,
    file: job.file,
    messageId: job.messageId,
  });
  return { dropped: false, action: 'file_shared_enqueued', fileId: event.file_id };
}

async function handleReactionEvent({ organizationId, event }) {
  const item = event.item || {};
  const channelId = item.channel || null;
  const messageId = item.ts || null;
  const reactionName = event.reaction || null;
  const userId = event.user || null;
  if (!channelId || !messageId || !reactionName) {
    return { dropped: true, reason: 'missing_reaction_context' };
  }

  // Only mirror reactions on messages we already hold.
  const msg = await SlackChannelMessage.findOne({ organizationId, channelId, messageId });
  if (!msg) return { dropped: true, reason: 'message_not_mirrored' };

  const reactions = { ...(msg.reactions || {}) };
  const entry = reactions[reactionName] || { count: 0, users: [] };
  let users = Array.isArray(entry.users) ? entry.users.slice() : [];
  if (event.type === 'reaction_added') {
    if (!users.includes(userId)) users.push(userId);
  } else {
    users = users.filter((u) => u !== userId);
  }
  if (users.length === 0) {
    delete reactions[reactionName];
  } else {
    reactions[reactionName] = { count: users.length, users };
  }

  await SlackChannelMessage.updateOne(
    { organizationId, channelId, messageId },
    { $set: { reactions } }
  );

  const updated = await SlackChannelMessage.findOne({ organizationId, channelId, messageId }).lean();
  realtime.broadcast(channelId, 'slack_message_updated', {
    channelId,
    message: serializeMessage(updated),
  });
  return { dropped: false, action: event.type, messageId };
}

async function enqueueFileJob({ integrationId, organizationId, channelId, file, messageId }) {
  await slackQueue.add(
    'slack_sync_file',
    { organizationId, integrationId, conversationId: channelId, file, messageId },
    { attempts: 3 }
  );
}

function enqueueLinkJob({ integrationId, organizationId, channelId, messageId, urls }) {
  for (const url of urls || []) {
    slackQueue.add(
      'slack_link_preview',
      { organizationId, integrationId, conversationId: channelId, messageId, url },
      { attempts: 3 }
    );
  }
}

async function handleChannelMeta({ integration, organizationId, event }) {
  const conversationId =
    (event.channel && (event.channel.id || event.channel)) ||
    event.conversation_id ||
    null;
  if (!conversationId) return { dropped: true, reason: 'missing_conversation' };

  const info = typedSlackResult(await slackApi(integration, 'conversations.info', { channel: conversationId }));
  if (info.ok) {
    const c = info.data.channel || {};
    const conversationType =
      c.is_im || conversationId.startsWith('D')
        ? 'DIRECT_MESSAGE'
        : c.is_mpim
          ? 'GROUP_DM'
          : c.is_private
            ? 'PRIVATE_CHANNEL'
            : 'PUBLIC_CHANNEL';
    await SlackConversation.findOneAndUpdate(
      { organizationId, conversationId },
      {
        $set: {
          name: c.name || '',
          conversationType,
          isPrivate: !!c.is_private,
          isArchived: !!c.is_archived,
          isMpim: !!c.is_mpim,
          topic: (c.topic && c.topic.value) || '',
          purpose: (c.purpose && c.purpose.value) || '',
          memberCount: Number(c.num_members || 0),
        },
        $setOnInsert: { organizationId, conversationId, slackTeamId: integration.slackTeamId || null },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  } else {
    // Conversation removed from the workspace → reflect archive/removal.
    await SlackConversation.updateOne(
      { organizationId, conversationId },
      { $set: { isArchived: event.type.includes('archive') } }
    );
  }

  // Sidebar refresh signal (keyed by workspace so the Slack section re-renders).
  realtime.broadcast(`ws:${organizationId}`, 'slack_conversations_changed', {
    workspaceId: String(organizationId),
    conversationId,
  });
  return { dropped: false, action: 'metadata_updated' };
}

function serializeMessage(doc) {
  if (!doc) return null;
  const raw = doc.rawPayload || {};
  const ts = Number(doc.messageId);
  return {
    id: doc._id,
    slackMessageTs: doc.messageId,
    author: {
      id: doc.slackUserId,
      name: doc.userName || 'Unknown',
      avatarUrl: doc.userAvatar,
    },
    text: doc.text || '',
    timestamp: Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000).toISOString() : null,
    subtype: doc.subtype,
    messageType: doc.messageType,
    threadTs: doc.threadTs,
    parentMessageId: doc.parentMessageId,
    mentions: doc.mentions || [],
    reactions: doc.reactions || {},
    replyCount: doc.replyCount || 0,
    threadLatestReply: doc.threadLatestReply || null,
    deletedAt: doc.deletedAt,
    editedAt: doc.editedAt,
    files: raw.files || [],
    attachments: [],
  };
}

// ---------------------------------------------------------------------------
// Background job dispatcher + worker bootstrap
// ---------------------------------------------------------------------------

async function runSyncFile(job) {
  const { integrationId, organizationId, conversationId, file, messageId } = job.payload;
  if (!integrationId || !file) return null;

  const integration = await Integration.findById(integrationId);
  if (!integration || integration.status !== 'active' || String(integration.organizationId) !== String(organizationId)) {
    return null;
  }
  const attachment = await syncFile({
    integration,
    organizationId,
    channelId: conversationId,
    messageId: messageId || null,
    file,
  });

  if (attachment) {
    // Notify the channel UI that an attachment finished downloading.
    realtime.broadcast(conversationId, 'slack_attachment_ready', {
      channelId: conversationId,
      attachment: {
        id: attachment.fileId,
        messageId: attachment.messageId,
        name: attachment.fileName,
        mimeType: attachment.fileType,
        category: attachment.fileCategory,
        sizeBytes: attachment.fileSizeBytes,
        url: attachment.storageUrl,
      },
    });
  }
  return attachment;
}

/** Serialize a SlackLink document for the channel UI / SSE. */
function serializeLink(l) {
  if (!l) return null;
  return {
    id: l._id,
    url: l.url,
    normalizedUrl: l.normalizedUrl,
    domain: l.domain,
    title: l.title,
    description: l.description,
    imageUrl: l.imageUrl,
    status: l.status,
    errorCode: l.errorCode,
    messageId: l.messageId,
    channelId: l.channelId,
  };
}

async function runLinkPreview(job) {
  const { integrationId, organizationId, conversationId, messageId, url } = job.payload;
  if (!integrationId || !url || !conversationId || !messageId) return null;

  const integration = await Integration.findById(integrationId);
  if (!integration || integration.status !== 'active' || String(integration.organizationId) !== String(organizationId)) {
    return { dropped: true, reason: 'integration_invalid' };
  }

  const normalizedUrl = normalizeUrl(url) || String(url).replace(/\/+$/, '');
  const domain = domainOf(normalizedUrl);

  // Idempotent upsert: repeated events for the same (channel, message, url)
  // never create duplicate preview rows.
  const doc = await SlackLink.findOneAndUpdate(
    { organizationId, channelId: conversationId, messageId, normalizedUrl },
    {
      $setOnInsert: { organizationId, channelId: conversationId, messageId, url, normalizedUrl, domain },
      $set: { status: 'pending' },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  if (!doc) return null;

  let status = 'error';
  let errorCode = null;
  let meta = { title: null, description: null, imageUrl: null };
  try {
    if (!(await isSafeUrl(url))) throw new LinkError('ssrf_blocked');
    meta = await fetchPreview(url);
    status = 'ok';
  } catch (err) {
    errorCode = (err && err.code) || 'fetch_failed';
  }

  await SlackLink.updateOne(
    { _id: doc._id },
    {
      $set: {
        status,
        errorCode,
        title: meta.title || null,
        description: meta.description || null,
        imageUrl: meta.imageUrl || null,
        fetchedAt: new Date(),
      },
    }
  );

  const updated = await SlackLink.findById(doc._id).lean();
  realtime.broadcast(conversationId, 'slack_link_ready', {
    channelId: conversationId,
    link: serializeLink(updated),
  });
  return { ok: status === 'ok', status, errorCode };
}

/** Start the Slack queue worker (called from server.js after DB connect). */
function startSlackWorker() {
  slackQueue.process(async (job) => {
    try {
      switch (job.name) {
        case 'slack_event_callback':
          return await processSlackEvent(job);
        case 'slack_discover_conversations':
        case 'slack_sync_all':
          return await runDiscover(job);
        case 'slack_sync_conversation':
          return await runSyncConversation(job);
        case 'slack_sync_file':
          return await runSyncFile(job);
        case 'slack_link_preview':
          return await runLinkPreview(job);
        default:
          console.warn(`[slackWorker] Unknown job name: ${job.name}`);
          return null;
      }
    } catch (err) {
      // Tag queue-level metadata so the retry layer can honor Retry-After.
      err.retryAfter =
        (err && err.retryAfter) ||
        (job.payload && job.payload.__retryAfter) ||
        (err && err.data && err.data.retryAfter) ||
        null;
      throw err;
    }
  });
  console.log('[slackQueue] Slack worker started.');
}

async function runDiscover(job) {
  const { integrationId, organizationId, conversationIds } = job.payload;
  const integration = await Integration.findById(integrationId);
  if (!integration || integration.status !== 'active' || String(integration.organizationId) !== String(organizationId)) {
    return { dropped: true, reason: 'integration_invalid' };
  }

  const conversations = await discoverConversations(integration);

  const targets = conversationIds && conversationIds.length
    ? conversations.filter((c) => conversationIds.includes(c.conversationId))
    : conversations;

  for (const c of targets) {
    await slackQueue.add(
      'slack_sync_conversation',
      { integrationId, organizationId, conversationId: c.conversationId },
      { attempts: 3, backoffMs: 1500 }
    );
  }
  return { discovered: conversations.length, enqueued: targets.length };
}

async function runSyncConversation(job) {
  const { integrationId, organizationId, conversationId } = job.payload;
  const integration = await Integration.findById(integrationId);
  if (!integration || integration.status !== 'active' || String(integration.organizationId) !== String(organizationId)) {
    return { dropped: true, reason: 'integration_invalid' };
  }

  const result = await syncConversationHistory({
    integration,
    conversationId,
    enqueueFile: async ({ file, messageId }) => {
      await slackQueue.add(
        'slack_sync_file',
        { integrationId, organizationId, conversationId, file, messageId },
        { attempts: 3 }
      );
    },
    enqueueLink: async ({ channelId, messageId, url }) => {
      for (const u of url || []) {
        await slackQueue.add(
          'slack_link_preview',
          { integrationId, organizationId, conversationId: channelId, messageId, url: u },
          { attempts: 3 }
        );
      }
    },
  });

  if (result.ok) {
    realtime.broadcast(`ws:${organizationId}`, 'slack_conversations_changed', {
      workspaceId: String(organizationId),
      conversationId,
      messageCount: result.messageCount,
    });
  }
  return result;
}

module.exports = {
  processSlackEvent,
  startSlackWorker,
};