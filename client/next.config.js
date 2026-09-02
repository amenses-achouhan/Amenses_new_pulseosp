/** @type {import('next').NextConfig} */

/**
 * PROXY CONFIGURATION — Eliminates CORS entirely.
 *
 * All client-side /api/* requests are proxied through Vercel's serverless
 * functions to the Render backend. The browser sees same-origin requests
 * (Vercel → Vercel), so CORS is never triggered.
 *
 * /api/auth/* is NOT proxied — it's handled by NextAuth on Vercel.
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

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    if (!EXPRESS_API_URL) return [];
    return API_PREFIXES.map((prefix) => ({
      source: `/api/${prefix}/:path*`,
      destination: `${EXPRESS_API_URL}/api/${prefix}/:path*`,
    }));
  },
};

module.exports = nextConfig;
