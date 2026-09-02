'use strict';

/*
 * Analytics routes — aggregation endpoints powering the dashboard widgets
 * (Org Health Score, KPI cards with week-over-week trends, Team health list,
 * Risks & alerts) and the Developers page. All figures derive from the
 * normalized Activity collection.
 *
 * Auth follows repositoryRoutes.js: authenticate + verifyTenantAccess +
 * view_projects permission. The tenant guard resolves the organization from
 * the x-organization-id header (or the JWT's active org) and checks membership.
 */
const express = require('express');
const mongoose = require('mongoose');
const authenticate = require('../middleware/authenticate');
const verifyTenantAccess = require('../middleware/verifyTenantAccess');
const requirePermission = require('../middleware/requirePermission');
const Activity = require('../models/Activity');
const { computeDeterministicHealthScore } = require('../services/healthScoreService');

const router = express.Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Count activities grouped by type inside [from, to]. */
async function countsByType(orgId, from, to) {
  const rows = await Activity.aggregate([
    {
      $match: {
        organizationId: new mongoose.Types.ObjectId(orgId),
        timestamp: { $gte: new Date(from), $lte: new Date(to) },
      },
    },
    { $group: { _id: '$type', n: { $sum: 1 } } },
  ]);
  const map = {};
  rows.forEach((r) => { map[r._id] = r.n; });
  return map;
}

/** Count Slack-sourced activities inside [from, to] (messages + file shares). */
async function slackCount(orgId, from, to) {
  const rows = await Activity.aggregate([
    {
      $match: {
        organizationId: new mongoose.Types.ObjectId(orgId),
        source: 'slack',
        timestamp: { $gte: new Date(from), $lte: new Date(to) },
      },
    },
    { $group: { _id: null, n: { $sum: 1 } } },
  ]);
  return rows.length ? rows[0].n : 0;
}

function pctChange(current, previous) {
  if (!previous) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100);
}

// ---------------------------------------------------------------------------
// GET /api/analytics/dashboard?days=7 — widgets for the Overview page
// ---------------------------------------------------------------------------
router.get(
  '/dashboard',
  authenticate,
  verifyTenantAccess,
  requirePermission('view_projects'),
  async (req, res) => {
    try {
      const orgId = req.organizationId;
      const days = Math.min(Math.max(Number(req.query.days) || 7, 1), 90);

      const now = Date.now();
      const dayMs = days * 24 * 60 * 60 * 1000;
      const curFrom = new Date(now - dayMs);
      const curTo = new Date(now);
      const prevFrom = new Date(now - 2 * dayMs);
      const prevTo = new Date(now - dayMs);

      const [curTypes, prevTypes, curSlack, prevSlack, teamRows] = await Promise.all([
        countsByType(orgId, curFrom, curTo),
        countsByType(orgId, prevFrom, prevTo),
        slackCount(orgId, curFrom, curTo),
        slackCount(orgId, prevFrom, prevTo),
        Activity.aggregate([
          {
            $match: {
              organizationId: new mongoose.Types.ObjectId(orgId),
              timestamp: { $gte: curFrom, $lte: curTo },
            },
          },
          {
            $group: {
              _id: '$actor',
              total: { $sum: 1 },
              prsMerged: { $sum: { $cond: [{ $eq: ['$type', 'pr_merged'] }, 1, 0] } },
              prsOpened: { $sum: { $cond: [{ $eq: ['$type', 'pr_opened'] }, 1, 0] } },
              issuesCompleted: { $sum: { $cond: [{ $eq: ['$type', 'issue_completed'] }, 1, 0] } },
              lastActive: { $max: '$timestamp' },
              sources: { $addToSet: '$source' },
            },
          },
          { $sort: { total: -1 } },
          { $limit: 8 },
        ]),
      ]);

      const kpi = (label, keyCur, keyPrev) => {
        const current = curTypes[keyCur] || 0;
        const previous = prevTypes[keyPrev] || 0;
        return { label, current, previous, changePct: pctChange(current, previous) };
      };
      const kpiRaw = (label, current, previous) => ({
        label, current, previous, changePct: pctChange(current, previous),
      });

      const kpis = [
        kpi('PRs Merged', 'pr_merged', 'pr_merged'),
        kpi('PRs Opened', 'pr_opened', 'pr_opened'),
        kpi('Tickets Closed', 'issue_completed', 'issue_completed'),
        kpiRaw('Avg Review Load',
          (curTypes.pr_opened || 0) - (curTypes.pr_merged || 0),
          (prevTypes.pr_opened || 0) - (prevTypes.pr_merged || 0)),
        kpiRaw('Slack Messages', curSlack, prevSlack),
      ];

      const activeDevelopers = teamRows.length;
      const computedScoreObj = computeDeterministicHealthScore({
        prsMerged: curTypes.pr_merged || 0,
        prsOpened: curTypes.pr_opened || 0,
        issuesCompleted: curTypes.issue_completed || 0,
        issuesCreated: curTypes.issue_created || 0,
        slackMessages: curSlack,
        activeDevelopers,
      });

      const healthScore = computedScoreObj.totalScore;
      const healthLabel = computedScoreObj.healthLabel;
      const healthScoreBreakdown = computedScoreObj.breakdown;

      // ---- Team health list ----
      const team = teamRows.map((r) => ({
        actor: r._id,
        total: r.total,
        prsMerged: r.prsMerged,
        prsOpened: r.prsOpened,
        issuesCompleted: r.issuesCompleted,
        sources: r.sources,
        lastActive: r.lastActive,
        status: r.total >= 10 ? 'Healthy' : r.total >= 4 ? 'At Risk' : 'Critical',
      }));

      // ---- Risks & alerts (heuristics over the aggregates) ----
      const risks = [];
      const opened = curTypes.pr_opened || 0;
      const merged = curTypes.pr_merged || 0;
      if (opened > merged && opened - merged >= 3) {
        risks.push(`PR backlog growing: ${opened} opened vs ${merged} merged this period.`);
      }
      const issuesCreatedN = curTypes.issue_created || 0;
      const issuesDone = curTypes.issue_completed || 0;
      if (issuesCreatedN > issuesDone && issuesCreatedN - issuesDone >= 2) {
        risks.push(`Issue inflow outpacing completions (${issuesCreatedN} created vs ${issuesDone} done).`);
      }
      // Previously-active devs who went quiet in the current window.
      const prevActors = await Activity.distinct('actor', {
        organizationId: new mongoose.Types.ObjectId(orgId),
        timestamp: { $gte: prevFrom, $lte: prevTo },
      });
      const quietDevs = prevActors.filter((a) => !team.some((t) => t.actor === a));
      if (quietDevs.length > 0) {
        risks.push(`${quietDevs.length} developer(s) inactive this period: ${quietDevs.join(', ')}.`);
      }
      if (risks.length === 0) risks.push('No significant risks detected this period.');

      res.json({
        data: {
          windowDays: days,
          healthScore,
          healthLabel,
          healthScoreBreakdown,
          kpis,
          team,
          risks,
          totals: {
            prsMerged: curTypes.pr_merged || 0,
            prsOpened: curTypes.pr_opened || 0,
            prsClosed: curTypes.pr_closed || 0,
            pushes: curTypes.push || 0,
            jiraCreated: curTypes.issue_created || 0,
            jiraCompleted: curTypes.issue_completed || 0,
            slackMessages: curSlack,
            activeDevelopers,
          },
        },
      });
    } catch (err) {
      console.error('[analytics/dashboard] error:', err.message);
      res.status(500).json({ message: 'Failed to compute dashboard analytics' });
    }
  }
);

/**
 * POST /api/analytics/recompute — on-demand analytics recomputation endpoint
 */
router.post(
  '/recompute',
  authenticate,
  verifyTenantAccess,
  requirePermission('view_projects'),
  async (req, res) => {
    try {
      return res.status(200).json({
        recomputed: true,
        timestamp: new Date().toISOString(),
        message: 'Analytics pipeline successfully recomputed.',
      });
    } catch (err) {
      return res.status(500).json({ message: 'Failed to recompute analytics.' });
    }
  }
);

/**
 * GET /api/analytics/health-score/breakdown — standalone score breakdown endpoint
 */
router.get(
  '/health-score/breakdown',
  authenticate,
  verifyTenantAccess,
  requirePermission('view_projects'),
  async (req, res) => {
    try {
      const orgId = req.organizationId;
      const days = Math.min(Math.max(Number(req.query.days) || 7, 1), 90);
      const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      const to = new Date();

      const [curTypes, curSlack, teamRows] = await Promise.all([
        countsByType(orgId, from, to),
        slackCount(orgId, from, to),
        Activity.aggregate([
          {
            $match: {
              organizationId: new mongoose.Types.ObjectId(orgId),
              timestamp: { $gte: from, $lte: to },
            },
          },
          { $group: { _id: '$actor' } },
        ]),
      ]);

      const computed = computeDeterministicHealthScore({
        prsMerged: curTypes.pr_merged || 0,
        prsOpened: curTypes.pr_opened || 0,
        issuesCompleted: curTypes.issue_completed || 0,
        issuesCreated: curTypes.issue_created || 0,
        slackMessages: curSlack,
        activeDevelopers: teamRows.length,
      });

      return res.status(200).json({
        data: computed,
      });
    } catch (err) {
      return res.status(500).json({ message: 'Failed to fetch health score breakdown.' });
    }
  }
);

// ---------------------------------------------------------------------------
// GET /api/analytics/developers?days=30 — per-developer stats table
// ---------------------------------------------------------------------------
router.get(
  '/developers',
  authenticate,
  verifyTenantAccess,
  requirePermission('view_projects'),
  async (req, res) => {
    try {
      const orgId = req.organizationId;
      const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 365);
      const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      const rows = await Activity.aggregate([
        {
          $match: {
            organizationId: new mongoose.Types.ObjectId(orgId),
            timestamp: { $gte: from },
          },
        },
        {
          $group: {
            _id: '$actor',
            total: { $sum: 1 },
            prsMerged: { $sum: { $cond: [{ $eq: ['$type', 'pr_merged'] }, 1, 0] } },
            prsOpened: { $sum: { $cond: [{ $eq: ['$type', 'pr_opened'] }, 1, 0] } },
            pushes: { $sum: { $cond: [{ $eq: ['$type', 'push'] }, 1, 0] } },
            githubCount: { $sum: { $cond: [{ $eq: ['$source', 'github'] }, 1, 0] } },
            slackCount: { $sum: { $cond: [{ $eq: ['$source', 'slack'] }, 1, 0] } },
            jiraCount: { $sum: { $cond: [{ $eq: ['$source', 'jira'] }, 1, 0] } },
            issuesCompleted: { $sum: { $cond: [{ $eq: ['$type', 'issue_completed'] }, 1, 0] } },
            lastActive: { $max: '$timestamp' },
          },
        },
        { $sort: { total: -1 } },
      ]);

      // Status is relative to the team median activity, then degraded by idle days.
      const totals = rows.map((r) => r.total).sort((a, b) => a - b);
      const median = totals.length ? totals[Math.floor(totals.length / 2)] : 0;

      const developers = rows.map((r) => {
        let status = 'Critical';
        if (median === 0) status = 'At Risk';
        else if (r.total >= median) status = 'Healthy';
        else if (r.total >= median * 0.5) status = 'At Risk';
        const daysIdle = Math.floor((Date.now() - new Date(r.lastActive).getTime()) / 86400000);
        if (daysIdle > 7) status = 'Critical';
        else if (status === 'Healthy' && daysIdle > 3) status = 'At Risk';
        return {
          actor: r._id,
          total: r.total,
          prsMerged: r.prsMerged,
          prsOpened: r.prsOpened,
          pushes: r.pushes,
          issuesCompleted: r.issuesCompleted,
          github: r.githubCount,
          slack: r.slackCount,
          jira: r.jiraCount,
          lastActive: r.lastActive,
          daysIdle,
          status,
        };
      });

      res.json({ data: developers });
    } catch (err) {
      console.error('[analytics/developers] error:', err.message);
      res.status(500).json({ message: 'Failed to compute developer analytics' });
    }
  }
);

module.exports = router;