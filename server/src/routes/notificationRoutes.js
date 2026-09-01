'use strict';

/**
 * Notification API routes
 *
 *   GET  /api/notifications          → list latest (up to 50) + unreadCount
 *   POST /api/notifications/:id/read → mark one notification read
 *   POST /api/notifications/read-all → mark all notifications read
 *
 * Auth: authenticate + verifyTenantAccess (same pattern as all other routes).
 * The requesting user's ID is resolved from req.user.userId (set by authenticate).
 * The organization is resolved from req.organizationId (set by verifyTenantAccess).
 */

const express = require('express');
const mongoose = require('mongoose');
const authenticate = require('../middleware/authenticate');
const verifyTenantAccess = require('../middleware/verifyTenantAccess');
const {
  getNotifications,
  getUnreadCount,
  markRead,
  markAllRead,
} = require('../services/notificationService');

const router = express.Router();

// All routes require authentication and workspace membership
router.use(authenticate, verifyTenantAccess);

// ---------------------------------------------------------------------------
// GET /api/notifications
// Returns: { notifications: [...], unreadCount: N }
// ---------------------------------------------------------------------------
router.get('/', async (req, res) => {
  try {
    const userId = req.user.userId;
    const orgId  = req.organizationId;
    const limit  = Math.min(parseInt(req.query.limit, 10) || 20, 50);

    const [notifications, unreadCount] = await Promise.all([
      getNotifications(userId, orgId, limit),
      getUnreadCount(userId, orgId),
    ]);

    res.json({ notifications, unreadCount });
  } catch (err) {
    console.error('[notificationRoutes] GET / error:', err);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/notifications/read-all
// Marks every unread notification for this user in this org as read.
// Must be defined BEFORE /:id/read so "read-all" isn't captured as :id
// ---------------------------------------------------------------------------
router.post('/read-all', async (req, res) => {
  try {
    const userId = req.user.userId;
    const orgId  = req.organizationId;
    await markAllRead(userId, orgId);
    res.json({ ok: true });
  } catch (err) {
    console.error('[notificationRoutes] POST /read-all error:', err);
    res.status(500).json({ error: 'Failed to mark all as read' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/notifications/:id/read
// Marks a single notification as read (ownership-checked inside service).
// ---------------------------------------------------------------------------
router.post('/:id/read', async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid notification ID' });
    }
    const userId = req.user.userId;
    const updated = await markRead(id, userId);
    if (!updated) {
      return res.status(404).json({ error: 'Notification not found or not owned by user' });
    }
    res.json({ ok: true, notification: updated });
  } catch (err) {
    console.error('[notificationRoutes] POST /:id/read error:', err);
    res.status(500).json({ error: 'Failed to mark notification as read' });
  }
});

module.exports = router;
