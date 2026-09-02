'use strict';

const { WEIGHTS, TARGETS, PENALTIES } = require('../config/healthScoreConfig');

/**
 * Computes a transparent, deterministic Health Score (0-100) and full breakdown.
 *
 * @param {Object} metrics
 * @param {number} metrics.prsMerged
 * @param {number} metrics.prsOpened
 * @param {number} metrics.issuesCompleted
 * @param {number} metrics.issuesCreated
 * @param {number} metrics.slackMessages
 * @param {number} metrics.activeDevelopers
 * @param {number} [metrics.staleTickets=0]
 * @param {number} [metrics.zeroActivityDays=0]
 * @returns {Object} { totalScore, healthLabel, breakdown }
 */
function computeDeterministicHealthScore({
  prsMerged = 0,
  prsOpened = 0,
  issuesCompleted = 0,
  issuesCreated = 0,
  slackMessages = 0,
  staleTickets = 0,
  zeroActivityDays = 0,
}) {
  // 1. PR Velocity Component (Max 25 points)
  const prVelocityRatio = Math.min(prsMerged / TARGETS.prVelocityTarget, 1);
  const prVelocityScore = Math.round(prVelocityRatio * WEIGHTS.prVelocity);

  // 2. Review Speed / Merge Efficiency Component (Max 25 points)
  const mergeRatio = prsOpened > 0 ? Math.min(prsMerged / prsOpened, 1) : prsMerged > 0 ? 1 : 0.5;
  const avgReviewTimeScore = Math.round(mergeRatio * WEIGHTS.avgReviewTime);

  // 3. Ticket Resolution Rate Component (Max 25 points)
  const resolutionRatio = issuesCreated > 0
    ? Math.min(issuesCompleted / issuesCreated, 1)
    : issuesCompleted > 0 ? 1 : 0.5;
  const ticketResolutionScore = Math.round(resolutionRatio * WEIGHTS.ticketResolution);

  // 4. Communication & Collaboration Activity Component (Max 25 points)
  const commsRatio = Math.min(slackMessages / TARGETS.commsActivityTarget, 1);
  const commsActivityScore = Math.round(commsRatio * WEIGHTS.commsActivity);

  // 5. Penalties Calculation
  const stalePenalty = Math.min(staleTickets * PENALTIES.staleTicketDeduction, PENALTIES.maxStalePenalty);
  const quietPenalty = Math.min(zeroActivityDays * PENALTIES.zeroActivityDayDeduction, PENALTIES.maxQuietPenalty);
  const totalPenalties = stalePenalty + quietPenalty;

  // Base raw score sum (0 to 100) minus penalties
  const rawTotal = prVelocityScore + avgReviewTimeScore + ticketResolutionScore + commsActivityScore - totalPenalties;
  const totalScore = Math.max(0, Math.min(100, Math.round(rawTotal)));

  const healthLabel =
    totalScore >= 75 ? 'Excellent' :
    totalScore >= 55 ? 'Good' :
    totalScore >= 35 ? 'Fair' : 'Poor';

  const breakdown = {
    prVelocity: {
      score: prVelocityScore,
      max: WEIGHTS.prVelocity,
      value: `${prsMerged} merged`,
      description: 'PR throughput vs target (10 PRs)',
    },
    avgReviewTime: {
      score: avgReviewTimeScore,
      max: WEIGHTS.avgReviewTime,
      value: `${Math.round(mergeRatio * 100)}% merged`,
      description: 'Ratio of opened PRs merged vs pending',
    },
    ticketResolution: {
      score: ticketResolutionScore,
      max: WEIGHTS.ticketResolution,
      value: `${Math.round(resolutionRatio * 100)}% resolved`,
      description: 'Jira tickets completed vs created',
    },
    commsActivity: {
      score: commsActivityScore,
      max: WEIGHTS.commsActivity,
      value: `${slackMessages} msgs`,
      description: 'Slack team activity volume',
    },
    penalties: {
      total: -totalPenalties,
      staleTickets: -stalePenalty,
      zeroActivityDays: -quietPenalty,
      details: `${staleTickets} stale tickets, ${zeroActivityDays} quiet days`,
    },
  };

  return {
    totalScore,
    healthLabel,
    breakdown,
  };
}

module.exports = { computeDeterministicHealthScore };