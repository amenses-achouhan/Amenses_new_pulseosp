/** @type {import('next').NextConfig} */

/**
 * PROXY CONFIGURATION — Eliminates CORS entirely.
 *
 * All client-side /api/* requests are proxied through Vercel's serverless
 * functions to the Render backend. The browser sees same-origin requests
 * (Vercel → Vercel), so CORS is never triggered.
 *
 * /api/auth/* has SPLIT routing:
 *   - Backend auth routes (forgot-password, register, login, me, etc.) → Render
 *   - NextAuth routes (session, signin, signout, callback, providers, csrf) → stay on Vercel
 */
const EXPRESS_API_URL = process.env.EXPRESS_API_URL || process.env.NEXT_PUBLIC_API_URL;

const API_PREFIXES = [
  'organizations',
  'integrations',
  'workspace',
  'repositories',
  'communication',
  'analytics',
  'ai-summaries',
  'notifications',
  'webhooks',
];

// Backend auth routes that should be proxied to Render (NOT NextAuth routes)
const AUTH_ROUTES = [
  'forgot-password',
  'register',
  'login',
  'logout',
  'verify-email',
  'resend-otp',
  'me',
  'change-password',
  'verify-password-reset-otp',
  'reset-password',
  'resend-password-otp',
  'oauth',
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    if (!EXPRESS_API_URL) return [];

    const rewrites = [];

    // Proxy all non-auth API prefixes to Render
    for (const prefix of API_PREFIXES) {
      rewrites.push({
        source: `/api/${prefix}/:path*`,
        destination: `${EXPRESS_API_URL}/api/${prefix}/:path*`,
      });
    }

    // Proxy backend auth sub-routes to Render
    // (NextAuth routes like /api/auth/session, /api/auth/signin, etc. stay on Vercel)
    for (const route of AUTH_ROUTES) {
      rewrites.push({
        source: `/api/auth/${route}/:path*`,
        destination: `${EXPRESS_API_URL}/api/auth/${route}/:path*`,
      });
      // Also match the route without a sub-path (e.g. /api/auth/me)
      rewrites.push({
        source: `/api/auth/${route}`,
        destination: `${EXPRESS_API_URL}/api/auth/${route}`,
      });
    }

    return rewrites;
  },
};

module.exports = nextConfig;
