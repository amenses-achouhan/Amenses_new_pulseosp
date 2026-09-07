const crypto = require('crypto');
const express = require('express');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { runInTransaction } = require('../utils/dbTransaction');
const { sendMail, transporter } = require('../utils/mailer');

const User = require('../models/User');
const Organization = require('../models/Organization');
const OrganizationMember = require('../models/OrganizationMember');
const Invitation = require('../models/Invitation');

const authenticate = require('../middleware/authenticate');
const verifyTenantAccess = require('../middleware/verifyTenantAccess');
const requirePermission = require('../middleware/requirePermission');

const router = express.Router();

// Expose transporter for e2e-audit-runner.js stubbing.
router.transporter = transporter;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TEAM_SIZES = ['1-10', '11-50', '51-200', '200+'];
const ALLOWED_ROLES = ['owner', 'admin', 'maintainer', 'developer', 'viewer'];

const signToken = (payload) =>
  jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '7d' });

const slugify = (name) => {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug || 'org';
};

/**
 * POST /api/organizations/onboard (authenticate)
 * Validates { name, teamSize, primaryFocus }, creates the Organization +
 * owner OrganizationMember + activeOrganizationId inside runInTransaction,
 * then returns a fresh 7-day JWT carrying the new org context.
 */
router.post('/onboard', authenticate, async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({
        message: 'Service temporarily unavailable. Please try again in a moment.',
      });
    }

    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const teamSize = typeof req.body?.teamSize === 'string' ? req.body.teamSize : '';
    const primaryFocus =
      typeof req.body?.primaryFocus === 'string' ? req.body.primaryFocus.trim() : '';

    if (!name) {
      return res.status(400).json({ message: 'Organization name is required.' });
    }
    if (!TEAM_SIZES.includes(teamSize)) {
      return res.status(400).json({
        message: 'teamSize must be one of: 1-10, 11-50, 51-200, 200+.',
      });
    }
    if (!primaryFocus) {
      return res.status(400).json({ message: 'primaryFocus is required.' });
    }

    // Lowercase slug from name; append a random suffix on collision.
    const baseSlug = slugify(name);
    let slug = baseSlug;
    if (await Organization.findOne({ slug: baseSlug })) {
      do {
        slug = `${baseSlug}-${crypto.randomBytes(4).toString('hex')}`;
      } while (await Organization.findOne({ slug }));
    }

    const userId = req.user.userId;
    const email = req.user.email;

    const { organization } = await runInTransaction(async (session) => {
      const opts = session ? { session } : {};

      const organization = new Organization({
        name,
        slug,
        teamSize,
        primaryFocus,
        ownerId: userId,
      });
      await organization.save(opts);

      const member = new OrganizationMember({
        organizationId: organization._id,
        userId,
        role: 'owner',
        status: 'active',
      });
      await member.save(opts);

      await User.updateOne(
        { _id: userId },
        { $set: { activeOrganizationId: organization._id } },
        opts
      );

      return { organization };
    });

    const token = signToken({
      userId,
      activeOrganizationId: organization._id.toString(),
      role: 'owner',
      email,
    });

    return res.status(201).json({ token, organization });
  } catch (err) {
    return res.status(500).json({ message: 'Internal server error' });
  }
});

/**
 * POST /api/organizations/switch-org (authenticate)
 * Body: { targetOrganizationId }.
 * 403 when the caller has no active membership; otherwise updates
 * User.activeOrganizationId and returns a fresh 7-day JWT with the member role.
 */
router.post('/switch-org', authenticate, async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({
        message: 'Service temporarily unavailable. Please try again in a moment.',
      });
    }

    const targetOrganizationId = req.body?.targetOrganizationId;
    if (
      typeof targetOrganizationId !== 'string' ||
      !mongoose.isValidObjectId(targetOrganizationId)
    ) {
      return res.status(400).json({ message: 'Invalid target organization id.' });
    }

    const member = await OrganizationMember.findOne({
      organizationId: targetOrganizationId,
      userId: req.user.userId,
      status: 'active',
    });

    if (!member) {
      return res.status(403).json({
        message: 'Forbidden. You are not an active member of this organization.',
      });
    }

    await User.updateOne(
      { _id: req.user.userId },
      { $set: { activeOrganizationId: targetOrganizationId } }
    );

    const token = signToken({
      userId: req.user.userId,
      activeOrganizationId: targetOrganizationId,
      role: member.role,
      email: req.user.email,
    });

    return res.status(200).json({
      token,
      activeOrganizationId: targetOrganizationId,
      role: member.role,
    });
  } catch (err) {
    return res.status(500).json({ message: 'Internal server error' });
  }
});

/**
 * Shared invite handler — called by both POST /api/organizations/invite and
 * POST /api/workspaces/:workspaceId/invitations. By the time this runs,
 * req.organizationId is already set by whichever middleware injected it.
 */
async function handleInvite(req, res) {
  try {
    // Guard: if Mongoose isn't connected, fail with a clear 503 instead of
    // letting the query throw an unhandled rejection → generic 500.
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({
        message: 'Service temporarily unavailable. Please try again in a moment.',
      });
    }

    // Accept email from any of: { email, orgEmail, personalEmail } for
    // backward compatibility and simplified client testing (Case 3).
    const recipientEmail = (
      req.body?.email ||
      req.body?.orgEmail ||
      req.body?.personalEmail ||
      ''
    ).toString().trim().toLowerCase();

    const role = typeof req.body?.role === 'string' && req.body.role ? req.body.role : 'developer';
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';

    if (!EMAIL_RE.test(recipientEmail)) {
      return res.status(400).json({ message: 'A valid email address is required.' });
    }
    if (!ALLOWED_ROLES.includes(role)) {
      return res
        .status(400)
        .json({ message: `role must be one of: ${ALLOWED_ROLES.join(', ')}.` });
    }

    if (['admin', 'maintainer'].includes(req.userRole) && ['admin', 'owner'].includes(role)) {
      return res.status(403).json({
        message: 'Forbidden. Admin and Maintainer can only invite Developer or Viewer roles.',
      });
    }

    // ALL invitations (new AND existing users) use OTP-based acceptance.
    // A 6-digit code is generated, its SHA-256 hash stored in the Invitation
    // record, and the plaintext code is emailed. The invitee enters it on the
    // login page — no password required. For existing users this is a one-time
    // acceptance gate; their password is never touched or overwritten.
    const existingUser = await User.findOne({ email: recipientEmail });
    const isNewUser = !existingUser;
    // Always generate a fresh 6-digit OTP — used for both new and existing accounts.
    const inviteOtp = crypto.randomInt(100000, 1000000).toString();

    if (existingUser) {
      // An admin vouched for this address, so an unverified account (e.g. a
      // self-registration that never completed OTP) is treated as verified.
      // Password and mustChangePassword are left untouched.
      if (!existingUser.isVerified) {
        existingUser.isVerified = true;
        await existingUser.save();
      }
    } else {
      // Upsert instead of bare create — makes concurrent invites for the same
      // email idempotent (exactly one document created, no duplicate-key 500).
      await User.findOneAndUpdate(
        { email: recipientEmail },
        {
          $setOnInsert: {
            name: name || recipientEmail.split('@')[0],
            email: recipientEmail,
            passwordHash: null,
            isVerified: true,
            authProvider: 'credentials',
            mustChangePassword: true,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = sha256(rawToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await Invitation.findOneAndUpdate(
      { organizationId: req.organizationId, email: recipientEmail },
      {
        $set: {
          role,
          tokenHash,
          expiresAt,
          status: 'pending',
          // Always store a fresh OTP hash — used by ALL invitees regardless of
          // whether they already have an account. Expires in 10 minutes.
          otpHash: sha256(inviteOtp),
          otpExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
        },
      },
      { upsert: true, new: true }
    );

    const org = await Organization.findById(req.organizationId);
    const orgName = org ? org.name : 'Organization';
    const frontendUrl = process.env.FRONTEND_URL;
    const inviteUrl = `${frontendUrl}/login?orgEmail=${encodeURIComponent(recipientEmail)}&inviteToken=${rawToken}`;

    // Unified invitation email — same template for new AND existing users.
    // The 6-digit OTP is shown prominently so the invitee can copy-paste it.
    const emailPayload = {
      to: recipientEmail,
      subject: `You've been invited to join ${orgName} on PulseOps`,
      html: `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:520px;margin:auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0">
          <div style="background:#4f46e5;padding:32px 40px">
            <h1 style="margin:0;font-size:22px;font-weight:700;color:#ffffff">You've been invited to ${orgName}</h1>
          </div>
          <div style="padding:32px 40px">
            <p style="margin:0 0 16px;color:#374151;font-size:15px">
              You have been invited to join <strong>${orgName}</strong> on PulseOps as a <strong style="color:#4f46e5">${role}</strong>.
            </p>
            <p style="margin:0 0 12px;color:#374151;font-size:15px">Your one-time invitation code is:</p>
            <div style="background:#f8fafc;border:2px solid #4f46e5;border-radius:10px;padding:20px 24px;text-align:center;margin:0 0 20px">
              <span style="font-size:36px;font-family:monospace;font-weight:900;letter-spacing:12px;color:#1e1b4b;display:inline-block">${inviteOtp}</span>
            </div>
            <p style="margin:0 0 24px;color:#6b7280;font-size:13px">⏱ This code expires in <strong>10 minutes</strong>. Click the button below, then enter this code on the sign-in page to accept your invitation.</p>
            <a href="${inviteUrl}" style="display:inline-block;padding:13px 28px;background:#4f46e5;color:#ffffff;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px">Accept Invitation →</a>
            <p style="margin:24px 0 0;font-size:12px;color:#9ca3af">Or paste this link in your browser:<br/><a href="${inviteUrl}" style="color:#4f46e5;word-break:break-all">${inviteUrl}</a></p>
          </div>
        </div>`,
      text: `You've been invited to ${orgName} on PulseOps as ${role}.\n\nYour invitation code: ${inviteOtp}\n(expires in 10 minutes)\n\nClick to accept: ${inviteUrl}\n\nOr open the link and enter the code when prompted.`,
    };

    let emailSent = false;
    try {
      const mailRes = await Promise.race([
        sendMail(emailPayload),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Email dispatch timed out')), 5000)
        ),
      ]);
      emailSent = Boolean(mailRes && mailRes.ok);
    } catch (mailErr) {
      console.error('[invite] Email dispatch failed:', mailErr.message);
      emailSent = false;
    }

    return res.status(200).json({
      success: true,
      inviteUrl,
      // Always return the OTP so the admin UI can show it as a manual fallback
      // if email delivery fails (or for testing). Never log it server-side.
      inviteOtp,
      existingUser: !isNewUser,
      orgEmail: recipientEmail,
      emailSent,
    });
  } catch (err) {
    console.error('[invite] error:', { message: err.message, stack: err.stack, name: err.name });
    return res.status(500).json({ message: 'Internal server error' });
  }
}


/**
 * POST /api/organizations/invite
 * (authenticate, verifyTenantAccess, requirePermission('manage_members'))
 * Body: { email, role } — role defaults to 'developer'.
 */
router.post(
  '/invite',
  authenticate,
  verifyTenantAccess,
  requirePermission('invite_members'),
  handleInvite
);

/**
 * POST /api/workspaces/:workspaceId/invitations
 * RESTful alias of /api/organizations/invite scoped by workspaceId URL param.
 * Injects req.organizationId from the URL so shared middleware works correctly.
 * The original router.handle() dispatch was unreliable — replaced with a direct
 * call to the shared handleInvite function.
 */
router.post(
  '/workspaces/:workspaceId/invitations',
  authenticate,
  (req, res, next) => {
    // Inject organizationId from URL param so verifyTenantAccess + requireRole work.
    req.organizationId = req.params.workspaceId;
    next();
  },
  verifyTenantAccess,
  requirePermission('manage_members'),
  handleInvite
);


/**
 * GET /api/organizations/settings — protected
 * Returns the active organization's profile + themeSettings for the workspace
 * shell and the settings UI.
 */
router.get(
  '/settings',
  authenticate,
  verifyTenantAccess,
  async (req, res) => {
    try {
      if (mongoose.connection.readyState !== 1) {
        return res.status(503).json({
          message: 'Service temporarily unavailable. Please try again in a moment.',
        });
      }

      const org = await Organization.findById(req.organizationId);
      if (!org) {
        return res.status(404).json({ message: 'Organization not found.' });
      }
      return res.status(200).json({
        organization: {
          id: org._id.toString(),
          name: org.name,
          slug: org.slug,
          teamSize: org.teamSize,
          primaryFocus: org.primaryFocus,
          themeSettings: org.themeSettings || {},
        },
      });
    } catch (err) {
      console.error('[org-settings] error:', { message: err.message, stack: err.stack, name: err.name });
      return res.status(500).json({ message: 'Internal server error' });
    }
  }
);

/**
 * PATCH /api/organizations/theme — protected
 * Updates the active organization's primary accent color in themeSettings.
 */
router.patch(
  '/theme',
  authenticate,
  verifyTenantAccess,
  async (req, res) => {
    try {
      if (mongoose.connection.readyState !== 1) {
        return res.status(503).json({
          message: 'Service temporarily unavailable. Please try again in a moment.',
        });
      }

      const { primaryColor } = req.body;
      if (!primaryColor || typeof primaryColor !== 'string') {
        return res.status(400).json({ message: 'primaryColor is required.' });
      }

      const org = await Organization.findById(req.organizationId);
      if (!org) {
        return res.status(404).json({ message: 'Organization not found.' });
      }

      if (!org.themeSettings) {
        org.themeSettings = {};
      }

      org.themeSettings.primaryColor = primaryColor;
      await org.save();

      return res.status(200).json({
        success: true,
        themeSettings: org.themeSettings,
      });
    } catch (err) {
      console.error('[org-theme] error:', { message: err.message, stack: err.stack, name: err.name });
      return res.status(500).json({ message: 'Internal server error' });
    }
  }
);

/**
 * GET /api/organizations/members
 * Returns the active member list + pending invitations for the active org.
 * Guarded by `requirePermission('view_developers')`.
 */
router.get(
  '/members',
  authenticate,
  verifyTenantAccess,
  requirePermission('view_developers'),
  async (req, res) => {
    try {
      if (mongoose.connection.readyState !== 1) {
        return res.status(503).json({
          message: 'Service temporarily unavailable. Please try again in a moment.',
        });
      }

      const [memberDocs, inviteDocs] = await Promise.all([
        OrganizationMember.find({ organizationId: req.organizationId, status: 'active' })
          .populate('userId', 'name email')
          .lean(),
        Invitation.find({
          organizationId: req.organizationId,
          status: 'pending',
          expiresAt: { $gt: new Date() },
        })
          .select('email role expiresAt')
          .lean(),
      ]);

      const members = memberDocs.map((m) => ({
        _id: m._id,
        userId: m.userId?._id || m.userId,
        name: m.userId?.name || '',
        email: m.userId?.email || '',
        role: m.role,
        joinedAt: m.createdAt,
      }));

      return res.status(200).json({ members, invitations: inviteDocs });
    } catch (err) {
      console.error('[members] error:', { message: err.message, stack: err.stack, name: err.name });
      return res.status(500).json({ message: 'Internal server error' });
    }
  }
);

/**
 * PATCH /api/organizations/members/:memberId/role
 * Updates a member's role.
 * - Requires `manage_members` permission.
 * - Blocked: Non-owners cannot change anyone else's role to owner/admin, nor modify an owner/admin's role.
 */
router.patch(
  '/members/:memberId/role',
  authenticate,
  verifyTenantAccess,
  requirePermission('manage_members'),
  async (req, res) => {
    try {
      if (mongoose.connection.readyState !== 1) {
        return res.status(503).json({
          message: 'Service temporarily unavailable. Please try again in a moment.',
        });
      }

      const { memberId } = req.params;
      const { role } = req.body;

      if (!ALLOWED_ROLES.includes(role)) {
        return res.status(400).json({ message: 'Invalid role.' });
      }

      const targetMember = await OrganizationMember.findOne({
        _id: memberId,
        organizationId: req.organizationId,
      });

      if (!targetMember) {
        return res.status(404).json({ message: 'Member not found.' });
      }

      // Operational rule: Non-owners (admin/maintainer) CANNOT change role of an owner/admin or grant owner/admin role.
      if (req.userRole !== 'owner') {
        if (['owner', 'admin'].includes(targetMember.role) || ['owner', 'admin'].includes(role)) {
          return res.status(403).json({
            message: 'Forbidden. Only the workspace owner can modify or assign Admin/Owner roles.',
          });
        }
      }

      targetMember.role = role;
      await targetMember.save();

      return res.status(200).json({ success: true, member: targetMember });
    } catch (err) {
      console.error('[update-role] error:', { message: err.message, stack: err.stack, name: err.name });
      return res.status(500).json({ message: 'Internal server error' });
    }
  }
);

/**
 * DELETE /api/organizations/members/:memberId
 * Removes a member from the organization.
 * - Requires `manage_members` permission.
 * - Blocked: Non-owners cannot remove owner or admin members.
 */
router.delete(
  '/members/:memberId',
  authenticate,
  verifyTenantAccess,
  requirePermission('manage_members'),
  async (req, res) => {
    try {
      if (mongoose.connection.readyState !== 1) {
        return res.status(503).json({
          message: 'Service temporarily unavailable. Please try again in a moment.',
        });
      }

      const { memberId } = req.params;
      const targetMember = await OrganizationMember.findOne({
        _id: memberId,
        organizationId: req.organizationId,
      });

      if (!targetMember) {
        return res.status(404).json({ message: 'Member not found.' });
      }

      if (targetMember.role === 'owner') {
        return res.status(403).json({ message: 'Forbidden. The workspace owner cannot be removed.' });
      }

      if (req.userRole !== 'owner' && targetMember.role === 'admin') {
        return res.status(403).json({ message: 'Forbidden. Only the workspace owner can remove Admins.' });
      }

      await OrganizationMember.deleteOne({ _id: memberId });
      return res.status(200).json({ success: true });
    } catch (err) {
      console.error('[remove-member] error:', { message: err.message, stack: err.stack, name: err.name });
      return res.status(500).json({ message: 'Internal server error' });
    }
  }
);

module.exports = router;