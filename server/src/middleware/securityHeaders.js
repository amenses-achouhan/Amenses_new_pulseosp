'use strict';

/**
 * TASK-112 — Security headers middleware (drop-in stand-in for `helmet`).
 *
 * The `helmet` package is not installed and the npm registry is unreachable
 * from this machine (corporate network — documented in SPRINT1_TRACKER.md),
 * so this middleware applies the same defaults that `helmet()` v7 applies at
 * the Express app root:
 *   Content-Security-Policy, Cross-Origin-Resource-Policy, X-Content-Type-Options,
 *   X-DNS-Prefetch-Control, X-Download-Options, X-Frame-Options,
 *   X-Permitted-Cross-Domain-Policies, X-XSS-Protection, Referrer-Policy,
 *   Strict-Transport-Security (production only).
 */
module.exports = function securityHeaders(req, res, next) {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; base-uri 'self'; font-src 'self' https: data:; form-action 'self'; frame-ancestors 'self'; img-src 'self' data:; object-src 'none'; script-src 'self'; script-src-attr 'none'; style-src 'self' https: 'unsafe-inline'; upgrade-insecure-requests"
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
