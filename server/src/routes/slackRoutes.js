'use strict';
const express = require('express');
const authenticate = require('../middleware/authenticate');
const verifyTenantAccess = require('../middleware/verifyTenantAccess');
const SlackConversation = require('../models/SlackConversation');
const SlackChannelMessage = require('../models/SlackChannelMessage');
const SlackAttachment = require('../models/SlackAttachment');
const Integration = require('../models/Integration');
const realtime = require('../services/slackRealtime');

const router = express.Router();
router.use(authenticate, verifyTenantAccess);

/**
 * Gateway router for the PulseOps Slack intra-app experience.
 * Mounted in server.js at  /api/workspace/:workspaceId/slack
 *
 * Every handler is tenant-scoped in two dimensions:
 *   1. verifyTenantAccess (through the workspaceId param) resolves the
 *      organization and requires an ACTIVE membership.
 *   2. Each query filters by req.organizationId AND the conversation id — a
 *      user from Workspace A can never read Workspace B conversations/messages.
 *
 * No Slack secrets (bot tokens, signing secrets, private URLs) ever leave the
 * server through these routes.
 */

function serializeAttachment(a) {
  return {
    id: a.fileId,
    messageId: a.messageId,
    name: a.fileName,
    mimeType: a.fileType,
    category: a.fileCategory,
    sizeBytes: a.fileSizeBytes,
    url: a.storageUrl,
  };
}

function serializeMessage(m) {
  const raw = m.rawPayload || {};
  const ts = Number(m.messageId);
  return {
    id: m._id,
    slackMessageTs: m.messageId,
    author: {
      id: m.slackUserId,
      name: m.userName || 'Unknown',
      avatarUrl: m.userAvatar,
    },
    text: m.text || '',
    timestamp: Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000).toISOString() : null,
    subtype: m.subtype,
    messageType: m.messageType,
    threadTs: m.threadTs,
    parentMessageId: m.parentMessageId,
    mentions: m.mentions || [],
    reactions: m.reactions || {},
    replyCount: m.replyCount || 0,
    threadLatestReply: m.threadLatestReply || null,
    deletedAt: m.deletedAt,
    editedAt: m.editedAt,
    files: raw.files || [],
  };
}

/**
 * GET /api/workspace/:workspaceId/slack/conversations
 * Returns all accessible conversations grouped by type with sync status.
 */
router.get('/conversations', async (req, res) => {
  try {
    const integration = await Integration.findOne({
      organizationId: req.organizationId,
      provider: 'slack',
      status: 'active',
    });
    if (!integration) {
      return res.status(404).json({ error: 'Slack is not connected for this workspace.' });
    }

    const docs = await SlackConversation.find({ organizationId: req.organizationId })
      .sort({ name: 1 })
      .lean();

    const conversations = docs.map((c) => ({
      id: c.conversationId,
      name: c.name,
      conversationType: c.conversationType,
      isPrivate: c.isPrivate,
      isArchived: c.isArchived,
      isMpim: c.isMpim,
      memberCount: c.memberCount,
      topic: c.topic,
      purpose: c.purpose,
      syncStatus: c.syncStatus,
      syncError: c.syncError,
      messageCount: c.messageCount,
      lastSyncedAt: c.lastSyncedAt,
    }));

    const byType = {
      publicChannels: conversations.filter((c) => c.conversationType === 'PUBLIC_CHANNEL'),
      privateChannels: conversations.filter((c) => c.conversationType === 'PRIVATE_CHANNEL'),
      groupDMs: conversations.filter((c) => c.conversationType === 'GROUP_DM'),
      directMessages: conversations.filter((c) => c.conversationType === 'DIRECT_MESSAGE'),
    };

    return res.json({ conversations, ...byType });
  } catch (err) {
    console.error('[slack/conversations] error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

/**
 * GET /api/workspace/:workspaceId/slack/conversations/:conversationId
 * Single conversation detail (metadata + sync status).
 */
router.get('/conversations/:conversationId', async (req, res) => {
  try {
    const { conversationId } = req.params;
    const doc = await SlackConversation.findOne({
      organizationId: req.organizationId,
      conversationId,
    }).lean();
    if (!doc) {
      return res.status(404).json({ error: 'Conversation not found in this workspace.' });
    }
    return res.json({
      id: doc.conversationId,
      name: doc.name,
      conversationType: doc.conversationType,
      isPrivate: doc.isPrivate,
      isArchived: doc.isArchived,
      memberCount: doc.memberCount,
      topic: doc.topic,
      purpose: doc.purpose,
      syncStatus: doc.syncStatus,
      syncError: doc.syncError,
      messageCount: doc.messageCount,
      lastSyncedAt: doc.lastSyncedAt,
    });
  } catch (err) {
    console.error('[slack/conversation] error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

/**
 * GET /api/workspace/:workspaceId/slack/conversations/:conversationId/messages
 *
 * Cursor-paginated, newest-first. Optional `threadTs` returns that thread's
 * replies instead of top-level messages. Each message carries its mirrored
 * attachments.
 */
router.get('/conversations/:conversationId/messages', async (req, res) => {
  try {
    const { conversationId } = req.params;
    const organizationId = req.organizationId;
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const before = req.query.before || null;
    const threadTs = req.query.threadTs || null;

    const conversation = await SlackConversation.findOne({ organizationId, conversationId }).lean();
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found in this workspace.' });
    }

    const filter = { organizationId, channelId: conversationId };
    if (before) filter.messageId = { $lt: before };
    if (threadTs) {
      // Thread view: all replies belonging to the requested thread.
      filter.threadTs = threadTs;
    } else {
      filter.parentMessageId = null;
    }

    const rows = await SlackChannelMessage.find(filter)
      .sort({ messageId: -1 })
      .limit(limit + 1)
      .lean();

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    const messageIds = page.map((m) => m.messageId);
    const attachments = await SlackAttachment.find({
      organizationId,
      channelId: conversationId,
      messageId: { $in: messageIds },
    })
      .sort({ createdAt: 1 })
      .lean();

    const attachmentMap = {};
    for (const a of attachments) {
      if (!attachmentMap[a.messageId]) attachmentMap[a.messageId] = [];
      attachmentMap[a.messageId].push(serializeAttachment(a));
    }

    const messages = page.map((m) => ({
      ...serializeMessage(m),
      attachments: attachmentMap[m.messageId] || [],
    }));

    return res.json({
      messages,
      nextCursor: hasMore ? page[page.length - 1].messageId : null,
      hasMore,
      limit,
      syncStatus: conversation.syncStatus,
      syncError: conversation.syncError,
      messageCount: conversation.messageCount,
    });
  } catch (err) {
    console.error('[slack/messages] error:', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

/**
 * GET /api/workspace/:workspaceId/slack/conversations/:conversationId/stream
 * Server-Sent Events live feed for one conversation. The worker broadcasts
 * `new_slack_message` / `slack_message_updated` / `slack_message_deleted` /
 * `slack_attachment_ready` events which this stream forwards to the open UI.
 */
router.get('/conversations/:conversationId/stream', (req, res) => {
  const { conversationId } = req.params;

  res.status(200).set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('event: connected\ndata: {"ok":true}\n\n');

  realtime.subscribe(conversationId, res);

  // Heartbeat keeps the connection alive through proxies.
  const heartbeat = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      clearInterval(heartbeat);
      realtime.unsubscribe(conversationId, res);
      res.end();
    }
  }, 25000);

  req.on('close', () => {
    clearInterval(heartbeat);
    realtime.unsubscribe(conversationId, res);
  });
});

/**
 * GET /api/workspace/:workspaceId/slack/events
 * Workspace-level SSE feed — notifies the sidebar when conversations change
 * (channel_rename / archive / newly discovered).
 */
router.get('/events', (req, res) => {
  const organizationId = req.organizationId;
  const key = `ws:${organizationId}`;

  res.status(200).set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('event: connected\ndata: {"ok":true}\n\n');

  realtime.subscribe(key, res);

  const heartbeat = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      clearInterval(heartbeat);
      realtime.unsubscribe(key, res);
      res.end();
    }
  }, 25000);

  req.on('close', () => {
    clearInterval(heartbeat);
    realtime.unsubscribe(key, res);
  });
});

module.exports = router;