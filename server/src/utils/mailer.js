'use strict';
/**
 * Centralised Nodemailer transporter for all PulseOps emails.
 *
 * Configuration priority:
 *   1. SMTP_HOST + SMTP_PORT + SMTP_USER + SMTP_PASS  → any external SMTP (Gmail, SendGrid, etc.)
 *   2. No credentials but SMTP_HOST set                → relay (local mail server / MailHog)
 *   3. Nothing set (dev)                               → Ethereal test account (auto-created,
 *                                                        preview URL logged to console)
 *
 * Gmail App Password notes:
 *   - Enable 2-FA on the Google account, then create an App Password.
 *   - Set SMTP_HOST=smtp.gmail.com, SMTP_PORT=587, SMTP_USER=<gmail>, SMTP_PASS=<app-password>.
 *   - family:4 forces IPv4 so ::1 ECONNREFUSED errors are eliminated.
 *
 * TASK-112 — Production resilience improvements:
 *   - Graceful Ethereal fallback (never crashes if Ethereal is unreachable)
 *   - sendMail() returns { ok, info, error } instead of throwing on failure
 *   - verifyTransporter() for health checks
 *   - Retry logic for transient SMTP errors
 */
const nodemailer = require('nodemailer');

let _transporter = null;
let _transporterReady = false;
let _initError = null;

/**
 * Create a transporter from explicit SMTP config (host + user + pass).
 */
function createSmtpTransporter(host, port, user, pass) {
  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
    socketOptions: { family: 4 },
    tls: { rejectUnauthorized: process.env.NODE_ENV === 'production' },
    connectionTimeout: 10000,
    greetingTimeout: 5000,
  });
}

/**
 * Create a relay transporter (local mail server, no auth).
 */
function createRelayTransporter(host, port) {
  return nodemailer.createTransport({
    host,
    port,
    secure: false,
    socketOptions: { family: 4 },
    tls: { rejectUnauthorized: false },
    connectionTimeout: 10000,
  });
}

/**
 * Create an Ethereal test account transporter (dev fallback).
 * Returns null if Ethereal is unreachable — never throws.
 */
async function createEtherealTransporter() {
  try {
    const testAccount = await Promise.race([
      nodemailer.createTestAccount(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Ethereal account creation timed out')), 10000)
      ),
    ]);
    const transport = nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      secure: false,
      auth: { user: testAccount.user, pass: testAccount.pass },
      socketOptions: { family: 4 },
      connectionTimeout: 10000,
    });
    console.log(
      `[mailer] ⚠  No SMTP credentials — using Ethereal test account.\n` +
        `  Preview emails at https://ethereal.email (user: ${testAccount.user})`
    );
    return transport;
  } catch (err) {
    console.error(`[mailer] ⚠  Ethereal fallback failed: ${err.message}`);
    console.error('[mailer]    Emails will NOT be sent. Set SMTP_HOST/SMTP_USER/SMTP_PASS on Render.');
    return null;
  }
}

/**
 * Lazily initialize the transporter. Called on first sendMail().
 * Caches the result — subsequent calls return the cached transporter.
 */
async function getTransporter() {
  if (_transporter && _transporterReady) return _transporter;
  if (_initError && !_transporter) throw _initError;

  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (host && user && pass) {
    // Production / staging path — real SMTP credentials supplied.
    const passPrefixed = pass ? `${pass.substring(0, 2)}...${pass.substring(pass.length - 2)}` : 'empty';
    _transporter = createSmtpTransporter(host, port, user, pass);
    _transporterReady = true;
    console.log(
      `[mailer] SMTP transporter ready — ${host}:${port} (user: ${user}, pass: ${passPrefixed}, env: ${process.env.NODE_ENV || 'dev'})`
    );
  } else if (host) {
    // Local relay (MailHog, Papercut, etc.) — no auth needed.
    _transporter = createRelayTransporter(host, port);
    _transporterReady = true;
    console.log(`[mailer] Relay transporter ready — ${host}:${port} (no auth)`);
  } else {
    // Dev fallback — Ethereal ephemeral test account.
    // If Ethereal is unreachable, _transporter stays null and sendMail() will
    // return { ok: false } instead of crashing the server.
    console.log(
      `[mailer] No SMTP credentials found (HOST=${host || 'none'}, USER=${user || 'none'}, PASS=${pass ? pass.substring(0, 2) + '...' : 'none'}). ` +
      `Falling back to Ethereal. Set SMTP_HOST/SMTP_USER/SMTP_PASS for production.`
    );
    _transporter = await createEtherealTransporter();
    _transporterReady = _transporter !== null;
    if (!_transporter) {
      _initError = new Error(
        'No SMTP credentials configured and Ethereal is unreachable. ' +
        'Set SMTP_HOST, SMTP_USER, SMTP_PASS in your environment.'
      );
    }
  }

  return _transporter;
}

/**
 * Verify the transporter is reachable (for health-check endpoints).
 * Returns { ok, message } — never throws.
 */
async function verifyTransporter() {
  try {
    const transport = await getTransporter();
    if (!transport) {
      return { ok: false, message: 'No transporter available — SMTP not configured' };
    }
    // Use a Promise.race with a timeout so verify() doesn't hang indefinitely
    // (some SMTP servers accept the connection but never respond to the VERIFY command).
    await Promise.race([
      transport.verify(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('SMTP VERIFY timed out after 8s')), 8000)
      ),
    ]);
    return { ok: true, message: 'SMTP connection verified' };
  } catch (err) {
    return { ok: false, message: `SMTP verification failed: ${err.message}` };
  }
}

/**
 * Send an email with retry logic for transient errors.
 * Returns { ok, info, error } — never throws.
 *
 * @param {{ to: string, subject: string, html: string, text?: string }} options
 * @param {{ retries?: number, retryDelayMs?: number }} opts
 */
async function sendMail({ to, subject, html, text }, { retries = 2, retryDelayMs = 2000 } = {}) {
  const from = process.env.EMAIL_FROM || process.env.SMTP_USER || 'PulseOps <noreply@pulseops.dev>';
  let lastError = null;
  // Per-attempt timeout — prevents a single hung SMTP connection from blocking
  // for 15+ seconds (connectionTimeout + greetingTimeout on the transporter).
  const SEND_TIMEOUT_MS = 8000;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const transport = await getTransporter();
      if (!transport) {
        // No transporter — fail fast with clear error.
        const err = new Error('SMTP not configured — no transporter available');
        console.error(`[mailer] ✗ Send failed (attempt ${attempt + 1}/${retries + 1}): ${err.message}`);
        return { ok: false, info: null, error: err };
      }

      const info = await Promise.race([
        transport.sendMail({ from, to, subject, html, text }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`SMTP send timed out after ${SEND_TIMEOUT_MS}ms`)), SEND_TIMEOUT_MS)
        ),
      ]);

      // Log Ethereal preview URL in development.
      const previewUrl = nodemailer.getTestMessageUrl(info);
      if (previewUrl) {
        console.log(`[mailer] Preview: ${previewUrl}`);
      }

      console.log(
        `[mailer] ✓ Email sent to ${to} (messageId: ${info.messageId}) ` +
        `[${process.env.NODE_ENV || 'dev'} | SMTP: ${process.env.SMTP_HOST || 'none'}]`
      );
      return { ok: true, info, error: null };
    } catch (err) {
      lastError = err;
      const isRetryable =
        err.code === 'ECONNECTION' ||
        err.code === 'ETIMEDOUT' ||
        err.code === 'ECONNRESET' ||
        err.code === 'EPIPE' ||
        (err.message && err.message.includes('timeout'));

      console.error(
        `[mailer] ✗ Send failed (attempt ${attempt + 1}/${retries + 1}): ${err.message}` +
        (isRetryable ? ' (retryable)' : ' (non-retryable)') +
        ` [code=${err.code || 'none'} | SMTP: ${process.env.SMTP_HOST || 'none'} | env=${process.env.NODE_ENV || 'dev'}]`
      );

      // If this was a timeout, it's always retryable.
      if (err.message && err.message.includes('timed out')) {
        isRetryable = true;
      }

      if (!isRetryable || attempt >= retries) break;

      // Wait before retrying.
      await new Promise((r) => setTimeout(r, retryDelayMs * (attempt + 1)));
    }
  }

  return { ok: false, info: null, error: lastError };
}

// Legacy compatibility — some routes expose transporter.sendMail directly for test stubbing.
// We expose a proxy object so the e2e-audit-runner.js stubs continue working.
const transporter = {
  sendMail: (opts) => sendMail(opts),
};

module.exports = { sendMail, transporter, getTransporter, verifyTransporter };
