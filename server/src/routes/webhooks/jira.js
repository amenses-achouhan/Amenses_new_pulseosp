const express = require('express');
const crypto = require('crypto');
const mongoose = require('mongoose');
const Integration = require('../../models/Integration');
const JiraWebhookEvent = require('../../models/JiraWebhookEvent');
const Activity = require('../../models/Activity');
const { normalizeJira } = require('../../services/normalizers/jira');
const { createNotificationsForActivity } = require('../../services/notificationService');

const router = express.Router();

/**
 * Verify Jira webhook signature using HMAC-SHA256 (X-Hub-Signature).
 * The webhook is registered with a shared secret; Jira signs the raw request
 * body and sends `X-Hub-Signature: sha256=<hex>` on every delivery.
 *
 * @param {Object} req - Express request object (req.rawBody set by server.js)
 * @param {Object} integration - The Integration document
 * @returns {boolean} - True if valid
 */
function verifyJiraWebhook(req, integration) {
  const webhookSecret = integration?.metadata?.webhookSecret;

  // No integration or no secret configured: reject (fail-closed).
  // Unauthenticated webhooks must never be trusted — any external actor
  // could forge payloads and inject fake issues/comments/worklog data.
  if (!webhookSecret) {
    console.warn('[jira/webhook] No webhook secret configured for integration:', integration?._id || 'unknown');
    return false;
  }

  const signatureHeader = req.headers['x-hub-signature'] || req.headers['x-hub-signature-256'];
  if (!signatureHeader || typeof signatureHeader !== 'string') {
    console.warn('[jira/webhook] No X-Hub-Signature header provided');
    return false;
  }

  try {
    // Raw body must be used — JSON re-serialization may not byte-match.
    const payload = req.rawBody || Buffer.from(JSON.stringify(req.body || {}), 'utf8');
    const expected = 'sha256=' + crypto.createHmac('sha256', webhookSecret).update(payload).digest('hex');

    const expectedBuf = Buffer.from(expected, 'utf8');
    const receivedBuf = Buffer.from(signatureHeader, 'utf8');
    if (expectedBuf.length !== receivedBuf.length || !crypto.timingSafeEqual(expectedBuf, receivedBuf)) {
      console.warn('[jira/webhook] Signature mismatch');
      return false;
    }
    return true;
  } catch (err) {
    console.error('[jira/webhook] Signature verification error:', err);
    return false;
  }
}

// getOrganizationIdFromCloudId is kept as it is used inside router.post('/')
async function getOrganizationIdFromCloudId(cloudId) {
  if (!cloudId) return null;
  
  const integration = await Integration.findOne({
    jiraCloudId: cloudId,
    provider: 'jira',
    status: 'active'
  });
  
  return integration ? integration.organizationId.toString() : null;
}

// Mounted by webhooks/index.js at /jira -> full path /api/webhooks/jira.
router.post('/', async (req, res) => {
  try {
    const payload = req.body || {};
    const webhookEvent = payload.webhookEvent || 'unknown';
    const issueKey = payload.issue?.key || 'N/A';

    console.log(`[jira/webhook] event=${webhookEvent} issue=${issueKey} cloudId=${payload.cloudId}`);

    // 1. Resolve organization: explicit body organizationId first, then
    // fall back to looking up the integration by Jira cloudId in the payload.
    const cloudId = payload.cloudId;
    let orgId = payload.organizationId || (await getOrganizationIdFromCloudId(cloudId));

    if (!orgId) {
      console.warn('[jira/webhook] Unable to resolve organization (cloudId:', cloudId, ')');
      return res.status(400).json({
        error: 'Unable to resolve organization for this Jira site',
      });
    }

    // 2. Find the integration for signature verification (optional — legacy
    // webhooks without a registered secret are still accepted).
    const integration = await Integration.findOne({
      $or: [
        ...(cloudId ? [{ jiraCloudId: cloudId }] : []),
        { organizationId: orgId },
      ],
      provider: 'jira',
      status: 'active'
    });

    // 3. Verify webhook signature
    const isValid = verifyJiraWebhook(req, integration);
    if (!isValid) {
      console.warn('[jira/webhook] Invalid signature for cloudId:', cloudId);
      return res.status(401).json({ error: 'Invalid webhook signature' });
    }

    // 4. Determine event type and ID
    const supportedEvents = [
      'jira:issue_created', 'jira:issue_updated', 'jira:issue_deleted',
      'comment_created', 'comment_updated', 'comment_deleted'
    ];
    
    if (!supportedEvents.includes(webhookEvent)) {
      console.log(`[jira/webhook] Unsupported event type: ${webhookEvent}, acknowledging`);
      return res.status(200).json({ received: true, ignored: true, event: webhookEvent });
    }

    // 5. Store the raw event in the queue collection
    let eventId = Date.now().toString(); // Fallback
    if (payload.issue?.id) eventId = payload.issue.id;
    if (payload.comment?.id) eventId = payload.comment.id;
    if (payload.worklog?.id) eventId = payload.worklog.id;
    if (payload.issueLink?.id) eventId = payload.issueLink.id;

    const queuedEvent = await JiraWebhookEvent.create({
      organizationId: orgId,
      cloudId,
      eventId,
      eventType: webhookEvent,
      payload,
      status: 'pending',
      receivedAt: new Date(),
    });

    console.log(`[jira/webhook] Queued event ${queuedEvent._id} (${webhookEvent})`);

    // Best-effort Activity tracking (optional inline tracking for dashboard)
    try {
      const orgObjectId = new mongoose.Types.ObjectId(orgId.toString());
      const activity = normalizeJira(payload, orgId.toString());
      if (activity) {
        const savedJiraActivity = await Activity.findOneAndUpdate(
          {
            organizationId: orgObjectId,
            source: 'jira',
            sourceId: activity.sourceId,
          },
          {
            $set: {
              ...activity,
              organizationId: orgObjectId,  // always store as ObjectId
            }
          },
          { upsert: true, new: true }
        );
        // Fire-and-forget notification fan-out
        if (savedJiraActivity) {
          createNotificationsForActivity(savedJiraActivity).catch(() => {});
        }
      }
    } catch (actErr) {
      console.warn('[jira/webhook] Activity creation skipped:', actErr.message);
    }

    res.status(200).json({ 
      received: true, 
      event: webhookEvent, 
      queuedId: queuedEvent._id,
    });
  } catch (error) {
    console.error('❌ Jira webhook error:', error);
    // Return 200 to prevent Jira from retrying indefinitely on our errors.
    // Do NOT leak error.message — it may contain internal details (Mongo errors,
    // Mongoose validation messages, stack traces). The error is logged server-side.
    res.status(200).json({ received: true });
  }
});

module.exports = router;