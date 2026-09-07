const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

const User = require('../models/User');
const PendingRegistration = require('../models/PendingRegistration');
const PasswordReset = require('../models/PasswordReset');
const OrganizationMember = require('../models/OrganizationMember');
const Invitation = require('../models/Invitation');
const authenticate = require('../middleware/authenticate');
const { sendMail, transporter } = require('../utils/mailer');

const router = express.Router();

const createRateLimiter = require('../middleware/rateLimiter');

// TASK-112: rate limiting for sensitive auth routes — 15-minute sliding window,
// 20 requests per IP, 429 { code: 'RATE_LIMIT_EXCEEDED' } when exceeded.
const authRateLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 20 });

// Expose transporter for test stubbing (e2e-audit-runner.js)
router.transporter = transporter;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const OTP_RE = /^\d{6}$/;
const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes

// Generates a secure 6-digit OTP. Only its SHA-256 hash is ever persisted.
const generateOtp = () => crypto.randomInt(100000, 1000000).toString();

/**
 * Sends the email-verification OTP email. Follows the invite-email HTML style
 * from orgRoutes. Returns { ok, error } — never throws.
 */
const sendOtpEmail = async (email, otp) => {
  const result = await sendMail({
    to: email,
    subject: 'Your PulseOps verification code',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:auto">
        <h2 style="color:#4f46e5">Verify your PulseOps email</h2>
        <p>Welcome to PulseOps! Use the 6-digit code below to verify your email address. It expires in 10 minutes.</p>
        <div style="background:#f1f5f9;border-radius:8px;padding:12px 20px;font-size:24px;font-family:monospace;letter-spacing:6px;font-weight:bold">${otp}</div>
        <p style="margin-top:16px;font-size:12px;color:#6b7280">If you didn't create a PulseOps account, you can safely ignore this email.</p>
      </div>`,
    text: `Welcome to PulseOps! Your email verification code is: ${otp}. It expires in 10 minutes.`,
  });
  return { ok: result.ok, error: result.error };
};

/**
 * Sends the password-reset OTP email, following the same inline-HTML style as
 * the email-verification / invite emails. Returns { ok, error } — never throws.
 */
const sendPasswordResetEmail = async (email, otp) => {
  const result = await sendMail({
    to: email,
    subject: 'Your PulseOps password reset code',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:auto">
        <h2 style="color:#4f46e5">Reset your PulseOps password</h2>
        <p>Use the 6-digit code below to reset your password. It expires in 10 minutes.</p>
        <div style="background:#f1f5f9;border-radius:8px;padding:12px 20px;font-size:24px;font-family:monospace;letter-spacing:6px;font-weight:bold">${otp}</div>
        <p style="margin-top:16px;font-size:12px;color:#6b7280">If you didn't request a password reset, you can safely ignore this email.</p>
      </div>`,
    text: `Your PulseOps password reset code is: ${otp}. It expires in 10 minutes.`,
  });
  return { ok: result.ok, error: result.error };
};

const resolveRole = async (user) => {
  if (!user.activeOrganizationId) return null;
  const membership = await OrganizationMember.findOne({
    organizationId: user.activeOrganizationId,
    userId: user._id,
  });
  return membership ? membership.role : null;
};

/**
 * Returns full workspace membership payload for a user.
 * Queries OrganizationMember for all active memberships, populates org name.
 * Always accurate — derived from DB, not from user.activeOrganizationId alone.
 */
const fetchWorkspacePayload = async (userId) => {
  const memberships = await OrganizationMember.find({
    userId,
    status: 'active',
  }).populate('organizationId', 'name slug');

  const workspaces = memberships
    .filter((m) => m.organizationId)
    .map((m) => ({
      id: m.organizationId._id.toString(),
      name: m.organizationId.name,
      slug: m.organizationId.slug || '',
      role: m.role,
    }));

  return {
    workspaces,
    hasWorkspace: workspaces.length > 0,
    workspaceCount: workspaces.length,
  };
};

const signAuthToken = (user, role) =>
  jwt.sign(
    {
      userId: user._id.toString(),
      activeOrganizationId: user.activeOrganizationId
        ? user.activeOrganizationId.toString()
        : null,
      role,
      email: user.email,
    },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );

/**
 * Resolves accurate workspace context for the current user directly from DB memberships.
 * Ensures user.activeOrganizationId is always set to a valid workspace if the user has any,
 * or null if they have none. Saves user and returns payload for auth responses.
 */
const resolveUserWorkspaceContext = async (user) => {
  const wpPayload = await fetchWorkspacePayload(user._id);

  if (wpPayload.hasWorkspace) {
    const hasValidActiveOrg =
      user.activeOrganizationId &&
      wpPayload.workspaces.some(
        (w) => w.id === user.activeOrganizationId.toString()
      );

    if (!hasValidActiveOrg) {
      user.activeOrganizationId = wpPayload.workspaces[0].id;
      await user.save();
    }
  } else if (user.activeOrganizationId) {
    user.activeOrganizationId = null;
    await user.save();
  }

  const role = await resolveRole(user);
  const token = signAuthToken(user, role);

  return {
    token,
    role,
    wpPayload,
  };
};

/**
 * Invitation interceptor (TASK-106).
 * When an optional inviteToken is present on login/oauth-sync:
 *   - 404 if no pending, unexpired invitation matches the token hash.
 *   - 403 (INVITATION_EMAIL_MISMATCH) if the invitation was issued to a
 *     different email address (hard email lock).
 *   - Otherwise: upsert the OrganizationMember, accept the invitation, set the
 *     invited workspace as the user's activeOrganizationId, and re-resolve role.
 * Returns { ok: true } when there is nothing to apply.
 */
const applyInvitation = async (user, inviteToken) => {
  if (!inviteToken || typeof inviteToken !== 'string') {
    return { ok: true };
  }

  const tokenHash = sha256(inviteToken);
  const invitation = await Invitation.findOne({
    tokenHash,
    status: 'pending',
    expiresAt: { $gt: new Date() },
  });

  if (!invitation) {
    return { ok: false, status: 404, message: 'Invitation token invalid or expired' };
  }

  // Hard email lock: the invitation belongs to exactly one email address.
  if (invitation.email.toLowerCase() !== user.email.toLowerCase()) {
    return {
      ok: false,
      status: 403,
      message: 'Forbidden. Invitation was issued to a different email address.',
      code: 'INVITATION_EMAIL_MISMATCH',
    };
  }

  // Attach membership (upsert — idempotent and concurrent-safe).
  await OrganizationMember.findOneAndUpdate(
    { organizationId: invitation.organizationId, userId: user._id },
    { $set: { role: invitation.role, status: 'active' } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  // Consume the invitation.
  await Invitation.updateOne({ _id: invitation._id }, { $set: { status: 'accepted' } });

  // Make the invited workspace the user's active organization.
  user.activeOrganizationId = invitation.organizationId;
  await user.save();

  return { ok: true };
};

// ---------------------------------------------------------------------------
// POST /api/auth/register
// Email/password signup. Does NOT create a real User yet — the account is held
// as a PendingRegistration with only the bcrypt passwordHash + a 6-digit OTP's
// SHA-256 hash (~10 min expiry). Plaintext password/OTP are never persisted,
// returned, or logged. The real User is created (verified) only on successful
// OTP verification; the client routes to /verify-email.
// ---------------------------------------------------------------------------
router.post('/register', authRateLimiter, async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({
        message: 'Service temporarily unavailable. Please try again in a moment.',
      });
    }

    const email = String(req.body.email || '').toLowerCase().trim();
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    const username = typeof req.body.username === 'string' ? req.body.username.trim() : '';

    if (!email || !EMAIL_RE.test(email)) {
      return res.status(400).json({ message: 'A valid email is required.' });
    }
    if (!password || password.length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters.' });
    }
    if (!username) {
      return res.status(400).json({ message: 'Username is required.' });
    }
    if (username.length > 50) {
      return res.status(400).json({ message: 'Username must be at most 50 characters.' });
    }

    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(409).json({ message: 'User already exists' });
    }
    const usernameExists = await User.findOne({ username });
    if (usernameExists) {
      return res.status(409).json({ message: 'Username is already taken.' });
    }

    // TASK-112: pending-invitation lookup — if an owner already invited this
    // email but the user self-registers without clicking the invite link, the
    // 201 response carries hasPendingInvite:true so the client can inform them.
    // (Invitation acceptance itself stays with the inviteToken interceptor.)
    const pendingInvite = await Invitation.findOne({
      email: email.toLowerCase().trim(),
      status: 'pending',
      expiresAt: { $gt: new Date() },
    });

    const passwordHash = await bcrypt.hash(password, 12);

    // Store the signup as pending verification (upsert per email). Issuing a
    // new OTP here also makes any previously sent code for this email invalid.
    const otp = generateOtp();
    const otpHash = sha256(otp);
    const otpExpires = new Date(Date.now() + OTP_TTL_MS);

    await PendingRegistration.findOneAndUpdate(
      { email },
      {
        $set: {
          name,
          username,
          passwordHash,
          verificationTokenHash: otpHash,
          verificationTokenExpires: otpExpires,
        },
      },
      { upsert: true, new: true }
    );

    // Fire-and-forget: don't block the response on SMTP delivery.
    sendOtpEmail(email, otp).catch((err) => {
      console.error('[register] Background email failed:', err.message);
    });

    return res.status(201).json(
      pendingInvite
        ? {
            message: 'Account registered. A verification code was sent — please verify your email.',
            hasPendingInvite: true,
            emailSent: true,
          }
        : {
            message: 'Registration successful. A verification code was sent — please verify your email.',
            hasPendingInvite: false,
            emailSent: true,
          }
    );
  } catch (error) {
    // Username uniqueness race — the sparse unique index is the final guard.
    if (error && error.code === 11000) {
      return res.status(409).json({ message: 'Username is already taken.' });
    }
    console.error('[register] error:', { message: error.message, stack: error.stack, name: error.name });
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/auth/verify-email
// ---------------------------------------------------------------------------
router.get('/verify-email', authRateLimiter, async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({
        message: 'Service temporarily unavailable. Please try again in a moment.',
      });
    }

    const rawToken = typeof req.query.token === 'string' ? req.query.token.trim() : '';
    if (!rawToken) {
      return res.status(400).json({ message: 'Verification token is required.' });
    }

    const tokenHash = sha256(rawToken);
    const user = await User.findOne({
      verificationTokenHash: tokenHash,
      verificationTokenExpires: { $gt: new Date() },
    });

    if (!user) {
      return res.status(400).json({ message: 'Invalid or expired verification token.' });
    }

    user.isVerified = true;
    user.verificationTokenHash = null;
    user.verificationTokenExpires = null;
    await user.save();

    return res.status(200).json({ message: 'Email verified successfully.' });
  } catch (error) {
    console.error('[verify-email] error:', { message: error.message, stack: error.stack, name: error.name });
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/auth/verify-email — OTP verification
// Body: { email, otp }. On a correct, unexpired OTP the PendingRegistration is
// converted into the real (verified) User exactly once; the pending record is
// then removed. Wrong/expired codes leave the pending record intact for retry.
// The client then continues with the normal login flow.
// ---------------------------------------------------------------------------
router.post('/verify-email', authRateLimiter, async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({
        message: 'Service temporarily unavailable. Please try again in a moment.',
      });
    }

    const email = String(req.body.email || '').toLowerCase().trim();
    const otp = typeof req.body.otp === 'string' ? req.body.otp.trim() : '';

    if (!email || !EMAIL_RE.test(email)) {
      return res.status(400).json({ message: 'A valid email is required.' });
    }
    if (!OTP_RE.test(otp)) {
      return res.status(400).json({ message: 'Verification code must be 6 digits.' });
    }

    const otpHash = sha256(otp);
    const pending = await PendingRegistration.findOne({
      email,
      verificationTokenHash: otpHash,
      verificationTokenExpires: { $gt: new Date() },
    });

    if (!pending) {
      return res.status(400).json({ message: 'Invalid or expired verification code.' });
    }

    // Guard: a real account may exist already (e.g. created via OAuth in the
    // meantime). If so, nothing to verify — drop the pending record.
    if (await User.findOne({ email })) {
      await PendingRegistration.deleteOne({ _id: pending._id });
      return res.status(409).json({ message: 'User already exists. Please sign in.' });
    }

    // Correct OTP — create the real User now, verified, preserving the signup
    // data while leaving the plaintext password/OTP never stored or exposed.
    const user = await User.create({
      name: pending.name || '',
      username: pending.username,
      email: pending.email,
      passwordHash: pending.passwordHash,
      isVerified: true,
      authProvider: 'credentials',
    });

    await PendingRegistration.deleteOne({ _id: pending._id });

    // Mint the standard auth JWT now, so the client can establish the existing
    // NextAuth session without re-entering the password. Same token/response
    // shape as /login; never includes the plaintext password.
    const role = await resolveRole(user);
    const token = signAuthToken(user, role);

    return res.status(200).json({
      message: 'Email verified successfully. You can now sign in.',
      token,
      user: {
        id: user._id.toString(),
        email: user.email,
        name: user.name,
        username: user.username,
        activeOrganizationId: user.activeOrganizationId
          ? user.activeOrganizationId.toString()
          : null,
        role,
        hasWorkspace: false,
        workspaceCount: 0,
        workspaces: [],
      },
    });
  } catch (error) {
    // Duplicate-key race (email/username already taken by a just-created User).
    if (error && error.code === 11000) {
      await PendingRegistration.deleteOne({
        email: String(req.body.email || '').toLowerCase().trim(),
      }).catch(() => {});
      const field = error.keyValue && error.keyValue.username ? 'Username' : 'Email';
      return res
        .status(409)
        .json({
          message: field === 'Username' ? 'Username is already taken.' : 'User already exists. Please sign in.',
        });
    }
    console.error('[verify-email-otp] error:', { message: error.message, stack: error.stack, name: error.name });
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/auth/resend-otp
// Body: { email }. Regenerates the pending registration's OTP (10 min expiry),
// invalidating any previously sent code, and emails it again.
// ---------------------------------------------------------------------------
router.post('/resend-otp', authRateLimiter, async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({
        message: 'Service temporarily unavailable. Please try again in a moment.',
      });
    }

    const email = String(req.body.email || '').toLowerCase().trim();

    if (!email || !EMAIL_RE.test(email)) {
      return res.status(400).json({ message: 'A valid email is required.' });
    }

    const pending = await PendingRegistration.findOne({ email });
    if (!pending) {
      return res.status(404).json({ message: 'No pending verification found for this email.' });
    }

    const otp = generateOtp();
    pending.verificationTokenHash = sha256(otp);
    pending.verificationTokenExpires = new Date(Date.now() + OTP_TTL_MS);
    await pending.save();

    // Fire-and-forget: don't block the response on SMTP delivery.
    sendOtpEmail(email, otp).catch((err) => {
      console.error('[resend-otp] Background email failed:', err.message);
    });

    return res.status(200).json({
      message: 'A new verification code has been sent to your email.',
      emailSent: true,
    });
  } catch (error) {
    console.error('[resend-otp] error:', { message: error.message, stack: error.stack, name: error.name });
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/auth/forgot-password
// Body: { email }. Sends a password-reset OTP (SHA-256 hash stored in its own
// model, ~10 min expiry). Returns a generic response whether or not an account
// exists, so it never reveals existence — and never returns/logs the OTP.
// ---------------------------------------------------------------------------
router.post('/forgot-password', authRateLimiter, async (req, res) => {
  try {
    const email = String(req.body.email || '').toLowerCase().trim();

    if (!email || !EMAIL_RE.test(email)) {
      return res.status(400).json({ message: 'A valid email is required.' });
    }

    // Guard: if Mongoose isn't connected, fail with a clear 503 instead of
    // letting the query throw an unhandled rejection → generic 500.
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({
        message: 'Service temporarily unavailable. Please try again in a moment.',
      });
    }

    let emailSent = false;
    const user = await User.findOne({ email });
    if (user) {
      const otp = generateOtp();
      await PasswordReset.findOneAndUpdate(
        { email },
        {
          $set: {
            userId: user._id,
            otpHash: sha256(otp),
            expiresAt: new Date(Date.now() + OTP_TTL_MS),
            resetTokenHash: null,
            resetTokenExpires: null,
          },
        },
        { upsert: true, new: true }
      );
      try {
        const mailRes = await Promise.race([
          sendPasswordResetEmail(email, otp),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Email dispatch timed out')), 5000)
          ),
        ]);
        emailSent = Boolean(mailRes && mailRes.ok);
      } catch (mailErr) {
        console.error('[forgot-password] Email dispatch failed:', mailErr.message);
        emailSent = false;
      }
    }

    // Always return 200 to prevent email enumeration — include emailSent
    // flag so the client can show a more helpful message when email fails.
    return res.status(200).json({
      message: 'If an account exists for this email, a verification code has been sent.',
      emailSent,
    });
  } catch (error) {
    console.error('[forgot-password] error:', { message: error.message, stack: error.stack, name: error.name });
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/auth/verify-password-reset-otp
// Body: { email, otp }. On a correct, unexpired OTP, issues a short-lived
// one-time reset token (only its SHA-256 hash is stored) and consumes the OTP.
// Does NOT change the password, log anyone in, or issue a JWT/session.
// ---------------------------------------------------------------------------
router.post('/verify-password-reset-otp', authRateLimiter, async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({
        message: 'Service temporarily unavailable. Please try again in a moment.',
      });
    }

    const email = String(req.body.email || '').toLowerCase().trim();
    const otp = typeof req.body.otp === 'string' ? req.body.otp.trim() : '';

    if (!email || !EMAIL_RE.test(email)) {
      return res.status(400).json({ message: 'A valid email is required.' });
    }
    if (!OTP_RE.test(otp)) {
      return res.status(400).json({ message: 'Verification code must be 6 digits.' });
    }

    const record = await PasswordReset.findOne({
      email,
      otpHash: sha256(otp),
      expiresAt: { $gt: new Date() },
    });

    if (!record) {
      return res.status(400).json({ message: 'Invalid or expired verification code.' });
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    record.otpHash = null; // consume the OTP
    record.expiresAt = null;
    record.resetTokenHash = sha256(resetToken);
    record.resetTokenExpires = new Date(Date.now() + OTP_TTL_MS);
    await record.save();

    return res.status(200).json({
      message: 'Verification successful. Set a new password.',
      resetToken,
    });
  } catch (error) {
    console.error('[verify-password-reset-otp] error:', { message: error.message, stack: error.stack, name: error.name });
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/auth/reset-password
// Body: { email, resetToken, password }. Consumes the one-time reset token,
// hashes the new password with the existing mechanism, updates the user, and
// deletes the reset record. Does NOT log the user in.
// ---------------------------------------------------------------------------
router.post('/reset-password', authRateLimiter, async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({
        message: 'Service temporarily unavailable. Please try again in a moment.',
      });
    }

    const email = String(req.body.email || '').toLowerCase().trim();
    const resetToken =
      typeof req.body.resetToken === 'string' ? req.body.resetToken.trim() : '';
    const password = typeof req.body.password === 'string' ? req.body.password : '';

    if (!email || !EMAIL_RE.test(email)) {
      return res.status(400).json({ message: 'A valid email is required.' });
    }
    if (!resetToken) {
      return res
        .status(400)
        .json({ message: 'Invalid or expired reset session. Please request a new code.' });
    }
    if (!password || password.length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters.' });
    }

    const record = await PasswordReset.findOne({
      email,
      resetTokenHash: sha256(resetToken),
      resetTokenExpires: { $gt: new Date() },
    });
    if (!record) {
      return res
        .status(400)
        .json({ message: 'Invalid or expired reset session. Please request a new code.' });
    }

    const user = await User.findById(record.userId);
    if (!user) {
      // Stale record for a missing user — clean up and stay generic.
      await PasswordReset.deleteOne({ _id: record._id });
      return res
        .status(400)
        .json({ message: 'Invalid or expired reset session. Please request a new code.' });
    }

    user.passwordHash = await bcrypt.hash(password, 10);
    user.mustChangePassword = false;
    await user.save();

    await PasswordReset.deleteOne({ _id: record._id }); // invalidate immediately

    return res.status(200).json({
      message: 'Password changed successfully. You can now sign in.',
    });
  } catch (error) {
    console.error('[reset-password] error:', { message: error.message, stack: error.stack, name: error.name });
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/auth/resend-password-otp
// Body: { email }. Regenerates the password-reset OTP (10 min expiry),
// invalidating the previous OTP and any pending reset token. Never returns or
// logs the OTP and never creates duplicate reset records (unique email).
// ---------------------------------------------------------------------------
router.post('/resend-password-otp', authRateLimiter, async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({
        message: 'Service temporarily unavailable. Please try again in a moment.',
      });
    }

    const email = String(req.body.email || '').toLowerCase().trim();

    if (!email || !EMAIL_RE.test(email)) {
      return res.status(400).json({ message: 'A valid email is required.' });
    }

    const record = await PasswordReset.findOne({ email });
    if (record) {
      const otp = generateOtp();
      record.otpHash = sha256(otp);
      record.expiresAt = new Date(Date.now() + OTP_TTL_MS);
      record.resetTokenHash = null;
      record.resetTokenExpires = null;
      await record.save();

      let emailSent = false;
      try {
        const mailRes = await Promise.race([
          sendPasswordResetEmail(email, otp),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Email dispatch timed out')), 5000)
          ),
        ]);
        emailSent = Boolean(mailRes && mailRes.ok);
      } catch (mailErr) {
        console.error('[resend-password-otp] Email dispatch failed:', mailErr.message);
        emailSent = false;
      }

      return res.status(200).json({
        message: emailSent
          ? 'A new verification code has been sent to your email.'
          : 'Verification code generated, but email delivery failed. Please try again.',
        emailSent,
      });
    }

    // No active reset request — respond generically to avoid revealing anything.
    return res.status(200).json({
      message: 'If an account exists for this email, a verification code has been sent.',
    });
  } catch (error) {
    console.error('[resend-password-otp] error:', { message: error.message, stack: error.stack, name: error.name });
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/auth/login
// ---------------------------------------------------------------------------
router.post('/login', authRateLimiter, async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({
        message: 'Service temporarily unavailable. Please try again in a moment.',
      });
    }

    const email = String(req.body.email || '').toLowerCase().trim();
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const verifiedToken =
      typeof req.body.verifiedToken === 'string' ? req.body.verifiedToken.trim() : '';
    const inviteToken =
      typeof req.body.inviteToken === 'string' ? req.body.inviteToken.trim() : undefined;
    const inviteOtp =
      typeof req.body.inviteOtp === 'string' ? req.body.inviteOtp.trim() : '';

    // An OTP only makes sense with its invitation link.
    if (inviteOtp && !inviteToken) {
      return res
        .status(400)
        .json({ message: 'Open the invite link from your email to accept the invitation.' });
    }

    let user = null;

    if (verifiedToken) {
      // Email-OTP verification grant: a valid JWT minted by the verify-email
      // flow proves this already-isVerified user without re-entering the
      // password. Reuses the same token + login response shape as usual.
      try {
        const decoded = jwt.verify(verifiedToken, process.env.JWT_SECRET);
        const candidate = await User.findById(decoded.userId);
        if (candidate && candidate.isVerified) user = candidate;
      } catch (err) {
        // invalid/expired token — treated as no match below
      }
      if (!user) {
        return res.status(401).json({ message: 'Invalid credentials' });
      }
    } else if (inviteOtp && inviteToken) {
      // OTP-based invitation acceptance — works for BOTH new and existing users.
      // The 6-digit code from the invite email is the sole proof of email
      // ownership needed to accept. No password is required or checked.
      // The invitation is matched by its (hashed) token; the OTP by its
      // SHA-256 hash — the plaintext code is never stored.
      const tokenHash = sha256(inviteToken);
      const invitation = await Invitation.findOne({
        tokenHash,
        status: 'pending',
        expiresAt: { $gt: new Date() },
      });
      if (!invitation) {
        return res.status(404).json({ message: 'Invitation token invalid or expired' });
      }
      if (
        invitation.email.toLowerCase() !== email.toLowerCase() ||
        !invitation.otpHash ||
        !invitation.otpExpiresAt ||
        invitation.otpExpiresAt <= new Date() ||
        sha256(inviteOtp) !== invitation.otpHash
      ) {
        return res.status(400).json({ message: 'Invalid or expired invitation code.' });
      }

      // Consume the OTP now; the invitation stays pending until membership is
      // attached below by applyInvitation.
      invitation.otpHash = null;
      invitation.otpExpiresAt = null;
      await invitation.save();

      user = await User.findOne({ email });
      if (!user) {
        return res.status(404).json({ message: 'Invitation token invalid or expired' });
      }
    } else {
      if (!email || !password) {
        return res.status(400).json({ message: 'Email and password are required.' });
      }

      user = await User.findOne({ email });
      if (!user || !user.passwordHash) {
        return res.status(401).json({ message: 'Invalid credentials' });
      }

      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) {
        return res.status(401).json({ message: 'Invalid credentials' });
      }

      // Hard check: unverified accounts cannot log in.
      if (user.isVerified === false) {
        return res.status(403).json({
          message: 'Email not verified. Please check your inbox.',
          code: 'EMAIL_NOT_VERIFIED',
        });
      }
    }

    // Invitation interceptor: attach workspace membership if inviteToken present.
    // TASK-112: inviteToken is type-checked + trimmed before hashing/DB lookups.
    const inviteResult = await applyInvitation(user, inviteToken);
    if (!inviteResult.ok) {
      return res
        .status(inviteResult.status)
        .json(
          inviteResult.code
            ? { message: inviteResult.message, code: inviteResult.code }
            : { message: inviteResult.message }
        );
    }

    const { token, role, wpPayload } = await resolveUserWorkspaceContext(user);

    return res.status(200).json({
      token,
      user: {
        id: user._id.toString(),
        email: user.email,
        name: user.name,
        activeOrganizationId: user.activeOrganizationId
          ? user.activeOrganizationId.toString()
          : null,
        role,
        mustChangePassword: user.mustChangePassword === true,
        hasPassword: !!user.passwordHash,
        hasWorkspace: wpPayload.hasWorkspace,
        workspaceCount: wpPayload.workspaceCount,
        workspaces: wpPayload.workspaces,
        isInvitedUser: Boolean(user.isInvited || user.temporaryPassword || user.mustChangePassword),
      },
    });
  } catch (error) {
    console.error('[login] error:', { message: error.message, stack: error.stack, name: error.name });
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/auth/oauth/sync — atomic upsert (double-click race safe)
// ---------------------------------------------------------------------------
router.post('/oauth/sync', authRateLimiter, async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({
        message: 'Service temporarily unavailable. Please try again in a moment.',
      });
    }

    const email = String(req.body.email || '').toLowerCase().trim();
    const name = typeof req.body.name === 'string' ? req.body.name : '';

    if (!email || !EMAIL_RE.test(email)) {
      return res.status(400).json({ message: 'A valid email is required.' });
    }

    // Atomic upsert: concurrent identical requests create exactly one document.
    const user = await User.findOneAndUpdate(
      { email },
      {
        $setOnInsert: {
          email,
          name: name || '',
          isVerified: true,
          authProvider: 'google',
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    // If an existing account was unverified (e.g. registered via /register), upgrade it.
    if (!user.isVerified) {
      user.isVerified = true;
      await user.save();
    }

    // Invitation interceptor: attach workspace membership if inviteToken present.
    // TASK-112: inviteToken is type-checked + trimmed before hashing/DB lookups.
    const inviteToken =
      typeof req.body.inviteToken === 'string' ? req.body.inviteToken.trim() : undefined;
    const inviteResult = await applyInvitation(user, inviteToken);
    if (!inviteResult.ok) {
      return res
        .status(inviteResult.status)
        .json(
          inviteResult.code
            ? { message: inviteResult.message, code: inviteResult.code }
            : { message: inviteResult.message }
        );
    }

    const { token, role, wpPayload } = await resolveUserWorkspaceContext(user);

    return res.status(200).json({
      token,
      user: {
        id: user._id.toString(),
        email: user.email,
        name: user.name,
        activeOrganizationId: user.activeOrganizationId
          ? user.activeOrganizationId.toString()
          : null,
        role,
        mustChangePassword: user.mustChangePassword === true,
        hasPassword: !!user.passwordHash,
        hasWorkspace: wpPayload.hasWorkspace,
        workspaceCount: wpPayload.workspaceCount,
        workspaces: wpPayload.workspaces,
        isInvitedUser: Boolean(user.isInvited || user.temporaryPassword || user.mustChangePassword),
      },
    });
  } catch (error) {
    console.error('[oauth-sync] error:', { message: error.message, stack: error.stack, name: error.name });
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/auth/change-password — protected
// Rotates the user's password and clears the mustChangePassword gate. Used by
// the invitation landing flow (TASK-109) where an owner pre-provisioned an
// account with a temporary password (mustChangePassword:true).
// ---------------------------------------------------------------------------
router.post('/change-password', authRateLimiter, authenticate, async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({
        message: 'Service temporarily unavailable. Please try again in a moment.',
      });
    }

    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    if (!user.passwordHash && user.authProvider && user.authProvider !== 'credentials') {
      return res.status(400).json({ 
        error: 'OAuth accounts (Google/GitHub) do not use passwords. Log in with your OAuth provider.' 
      });
    }
    const hasPassword = !!user.passwordHash;

    const currentPassword =
      typeof req.body.currentPassword === 'string' ? req.body.currentPassword : '';
    const newPassword = typeof req.body.newPassword === 'string' ? req.body.newPassword : '';

    if (!newPassword) {
      return res.status(400).json({ message: 'New password is required.' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ message: 'New password must be at least 8 characters.' });
    }
    // Accounts provisioned without a password (OTP invite acceptance) set their
    // first password here — no currentPassword is required.
    if (hasPassword && !currentPassword) {
      return res.status(400).json({ message: 'Current password is required.' });
    }
    if (hasPassword) {
      const isMatch = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!isMatch) {
        return res.status(400).json({ error: 'Current password does not match' });
      }
    }

    user.passwordHash = await bcrypt.hash(newPassword, 10);
    user.mustChangePassword = false;
    await user.save();

    const role = await resolveRole(user);
    const token = signAuthToken(user, role);

    return res.status(200).json({
      message: 'Password updated successfully.',
      token,
      user: {
        id: user._id.toString(),
        email: user.email,
        name: user.name,
        activeOrganizationId: user.activeOrganizationId
          ? user.activeOrganizationId.toString()
          : null,
        role,
        mustChangePassword: false,
        hasPassword: true,
      },
    });
  } catch (error) {
    console.error('[change-password] error:', { message: error.message, stack: error.stack, name: error.name });
    return res.status(500).json({ message: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/auth/me — protected
// ---------------------------------------------------------------------------
router.get('/me', authenticate, async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({
        message: 'Service temporarily unavailable. Please try again in a moment.',
      });
    }

    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const { wpPayload, role } = await resolveUserWorkspaceContext(user);

    res.status(200).json({
      id: user._id.toString(),
      email: user.email,
      name: user.name,
      username: user.username,
      isVerified: user.isVerified,
      authProvider: user.authProvider,
      activeOrganizationId: user.activeOrganizationId
        ? user.activeOrganizationId.toString()
        : null,
      ...wpPayload,
      role,
    });
  } catch (error) {
    console.error('[get-me] error:', { message: error.message, stack: error.stack, name: error.name });
    res.status(500).json({ message: 'Internal server error' });
  }
});

module.exports = router;