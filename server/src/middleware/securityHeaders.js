'use strict';

/**
 * TASK-112 — Security headers middleware (drop-in stand-in for `helmet`).
 *
 * The `helmet` package is not installed and the npm registry is unreachable
 * from this machine (corporate network — documented in SPRINT1_TRACKER.md), so
 * this middleware applies the same defaults that `helmet()` v7 applies at the
 * Express app root:
 *   Content-Security-Policy, Cross-Origin-Resource-Policy, X-Content-Type-Options,
 *   X-DNS-Prefetch-Control, X-Download-Options, X-Frame-Options,
 *   X-Permitted-Cross-Domain-Policies, X-XSS-Protection, Referrer-Policy,
 *   Strict-Transport-Security (production only).
 */
module.exports = function securityHeaders(req, res, next) {
  // Build connect-src directive dynamically from FRONTEND_URL so cross-origin
  // fetch() from the browser is not blocked by CSP.  In development, also
  // allow localhost origins used by the Next.js dev server.
  const frontendOrigin = process.env.FRONTEND_URL || '';
  const devConnectSources = process.env.NODE_ENV !== 'production'
    ? ' http://localhost:3000 http://localhost:3001 http://127.0.0.1:3000 http://127.0.0.1:3001'
    : '';
  const connectSrc = `'self'${frontendOrigin ? ' ' + frontendOrigin : ''}${devConnectSources}`;

  res.setHeader(
    'Content-Security-Policy',
    `default-src 'self'; base-uri 'self'; connect-src ${connectSrc}; font-src 'self' https: data:; form-action 'self'; frame-ancestors 'self'; img-src 'self' data:; object-src 'none'; script-src 'self'; script-src-attr 'none'; style-src 'self' https: 'unsafe-inline'; upgrade-insecure-requests`
  );
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  res.setHeader('X-Download-Options', 'noopen');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  res.setHeader('X-XSS-Protection', '0');
  res.setHeader('Referrer-Policy', 'no-referrer');

  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  }

  return next();
};
