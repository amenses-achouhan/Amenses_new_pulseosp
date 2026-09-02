/**
 * Centralized API base URL configuration.
 *
 * CLIENT SIDE: Returns '/api' (relative) so Next.js rewrites in next.config.js
 * proxy the request through Vercel's serverless functions to Render.
 * This eliminates CORS entirely — the browser sees same-origin requests.
 *
 * SERVER SIDE: Returns the full Render URL (NEXT_PUBLIC_API_URL) for direct
 * server-to-server calls (e.g. authOptions.js signIn callback → Render).
 * Server-to-server calls don't have CORS restrictions.
 *
 * FALLBACK: 'http://localhost:5000' for local development.
 */
const API_BASE =
  typeof window === 'undefined'
    ? (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000')
    : '/api';

export default API_BASE;
