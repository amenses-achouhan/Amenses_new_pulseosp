const express = require('express');
const { getActivityForRange } = require('../services/ai/activity.service');
const { buildContext } = require('../ai/services/context-builder.service');
const { geminiService } = require('../services/ai/gemini.service');
const AISummary = require('../models/AISummary');
const authenticate = require('../middleware/authenticate');
const verifyTenantAccess = require('../middleware/verifyTenantAccess');
const requirePermission = require('../middleware/requirePermission');

const router = express.Router();

/**
 * Map user-facing summary types to the AISummary model enum values.
 * Accepts both short names (`weekly`) and stored enum names (`weekly_summary`).
 */
const SUMMARY_TYPE_MAP = {
  weekly: 'weekly_summary',
  weekly_summary: 'weekly_summary',
  monthly: 'monthly_summary',
  monthly_summary: 'monthly_summary',
  quarterly: 'quarterly_summary',
  quarterly_summary: 'quarterly_summary'
};

/**
 * Normalize a requested summary type to a valid AISummary enum value.
 * @param {string} [type] - Raw type from the request body
 * @returns {string} Normalized enum value (e.g. 'weekly_summary')
 * @throws {Error} If the type is not supported
 */
function normalizeSummaryType(type) {
  const normalized = SUMMARY_TYPE_MAP[String(type || 'weekly').toLowerCase()];
  if (!normalized) {
    throw new Error(`Unsupported summary type: ${type}`);
  }
  return normalized;
}

/**
 * GET /api/ai-summaries/latest
 * Fetch the most recent summary for an organization.
 */
router.get('/latest', authenticate, verifyTenantAccess, requirePermission('view_reports'), async (req, res) => {
  try {
    const organizationId = req.organizationId || req.query.organizationId;

    if (!organizationId) {
      return res.status(400).json({ error: 'organizationId is required' });
    }

    const latest = await AISummary.findOne({ organizationId })
      .sort({ generatedAt: -1 })
      .lean()
      .exec();

    if (!latest) {
      return res.status(404).json({
        message: 'No AI summary found for this organization',
        data: null
      });
    }

    res.json({ data: latest });
  } catch (error) {
    console.error('❌ Error fetching latest summary:', error);
    res.status(500).json({
      error: 'Failed to fetch latest summary',
      message: error.message
    });
  }
});

/**
 * GET /api/ai-summaries
 * Fetch all summaries for an organization with pagination.
 */
router.get('/', authenticate, verifyTenantAccess, requirePermission('view_reports'), async (req, res) => {
  try {
    const organizationId = req.organizationId || req.query.organizationId;
    const { limit = 10, offset = 0 } = req.query;

    if (!organizationId) {
      return res.status(400).json({ error: 'organizationId is required' });
    }

    // Clamp pagination values to sane bounds (1..50 page size, non-negative offset).
    const pageLimit = Math.min(Math.max(Number(limit) || 10, 1), 50);
    const pageOffset = Math.max(Number(offset) || 0, 0);

    const summaries = await AISummary.find({ organizationId })
      .sort({ generatedAt: -1 })
      .skip(pageOffset)
      .limit(pageLimit)
      .lean()
      .exec();

    const total = await AISummary.countDocuments({ organizationId });

    res.json({
      data: summaries,
      pagination: {
        total,
        limit: pageLimit,
        offset: pageOffset,
        hasMore: pageOffset + pageLimit < total
      }
    });
  } catch (error) {
    console.error('❌ Error fetching summaries:', error);
    res.status(500).json({
      error: 'Failed to fetch summaries',
      message: error.message
    });
  }
});

/**
 * GET /api/ai-summaries/:id
 * Fetch a specific summary by ID (scoped to the organization).
 */
router.get('/:id', authenticate, verifyTenantAccess, requirePermission('view_reports'), async (req, res) => {
  try {
    const { id } = req.params;
    const organizationId = req.organizationId || req.query.organizationId;

    if (!organizationId) {
      return res.status(400).json({ error: 'organizationId is required' });
    }

    const summary = await AISummary.findOne({ _id: id, organizationId })
      .lean()
      .exec();

    if (!summary) {
      return res.status(404).json({ message: 'AI summary not found' });
    }

    res.json({ data: summary });
  } catch (error) {
    // Invalid ObjectId in the URL path -> malformed request, not a server error.
    if (error && error.name === 'CastError') {
      return res.status(400).json({ error: 'Invalid summary ID format' });
    }
    console.error('❌ Error fetching summary:', error);
    res.status(500).json({
      error: 'Failed to fetch summary',
      message: error.message
    });
  }
});

/**
 * POST /api/ai-summaries
 * Generate a new AI summary from recent activity and persist it.
 */
router.post('/', authenticate, verifyTenantAccess, requirePermission('generate_reports'), async (req, res) => {
  try {
    const { type = 'weekly', startDate, endDate } = req.body;
    const organizationId = req.organizationId;

    if (!organizationId) {
      return res.status(400).json({ error: 'organizationId is required' });
    }

    // Normalize + validate the summary type before hitting the model enum.
    let summaryType;
    try {
      summaryType = normalizeSummaryType(type);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }

    // Parse dates. Default to the last 7 days when no range is provided.
    const start = startDate ? new Date(startDate) : new Date();
    if (!startDate) start.setDate(start.getDate() - 7);

    const end = endDate ? new Date(endDate) : new Date();

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return res.status(400).json({
        error: 'Invalid date format',
        message: 'startDate and endDate must be valid ISO dates'
      });
    }

    if (start > end) {
      return res.status(400).json({
        error: 'Invalid date range',
        message: 'startDate must be before or equal to endDate'
      });
    }

    // Fetch activities in the period.
    const activities = await getActivityForRange({
      organizationId,
      startDate: start,
      endDate: end
    });

    // Check if we have enough data.
    if (activities.length === 0) {
      return res.status(400).json({
        error: 'Not enough activity to summarize',
        message: 'No activities found for the specified period'
      });
    }

    // Build context and generate the AI summary (validated + retried upstream).
    const context = buildContext(activities);
    const summaryData = await geminiService.generateSummary(context, type);

    // Save to database.
    const aiSummary = await AISummary.create({
      organizationId,
      type: summaryType,
      startDate: start,
      endDate: end,
      summary: summaryData.summary,
      key_metrics: summaryData.key_metrics,
      top_contributors: summaryData.top_contributors,
      risks: summaryData.risks,
      recommendations: summaryData.recommendations,
      generatedAt: new Date()
    });

    res.status(201).json({
      message: 'AI summary generated successfully',
      data: aiSummary
    });
  } catch (error) {
    console.error('❌ AI summary generation error:', error);
    res.status(500).json({
      error: 'Failed to generate AI summary',
      message: error.message
    });
  }
});

module.exports = router;
module.exports.normalizeSummaryType = normalizeSummaryType;
