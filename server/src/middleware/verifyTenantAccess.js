const OrganizationMember = require('../models/OrganizationMember');
const mongoose = require('mongoose');

/**
 * Tenant-scoping guard. Derives the target organization from (in priority
 * order): the `organizationId` route param, the `/api/workspace/:workspaceId/*`
 * route param alias, the `x-organization-id` header, or the JWT's active
 * organization. Verifies an ACTIVE membership before tagging `req.organizationId`.
 *
 * Never trusts workspace/org ids sent from the browser for the authorization
 * decision — the authenticated user must hold an active membership in the
 * resolved organization.
 */
const verifyTenantAccess = async (req, res, next) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({
      message: 'Service temporarily unavailable. Please try again in a moment.',
    });
  }

  const targetOrgId =
    (req.params && req.params.organizationId) ||
    (req.params && req.params.workspaceId) ||
    req.headers['x-organization-id'] ||
    (req.user && req.user.activeOrganizationId) ||
    null;

  if (!targetOrgId) {
    return res.status(400).json({ message: 'Missing organization context.' });
  }

  if (!req.user || !req.user.userId) {
    return res.status(401).json({ message: 'Authentication required' });
  }

  try {
    const membership = await OrganizationMember.findOne({
      organizationId: targetOrgId,
      userId: req.user.userId,
      status: 'active',
    });

    if (!membership) {
      return res
        .status(403)
        .json({ message: 'Forbidden. No active membership in this workspace.' });
    }

    req.organizationId = targetOrgId;
    req.userRole = membership.role;
    next();
  } catch (err) {
    return res.status(500).json({ message: 'Internal server error' });
  }
};

module.exports = verifyTenantAccess;