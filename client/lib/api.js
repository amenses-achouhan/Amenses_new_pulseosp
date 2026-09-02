/**
 * Centralized API base URL configuration.
 *
 * CLIENT SIDE: Returns '/' (root) so fetch('/api/...') goes to the same origin.
 * Next.js rewrites in next.config.js then proxy /api/* to the Render backend.
 * This eliminates CORS entirely — the browser sees same-origin requests.
 *
 * SERVER SIDE: Returns the full Render URL (NEXT_PUBLIC_API_URL) for direct
 * server-to-server calls (e.g. authOptions.js signIn callback → Render).
 * Server-to-server calls don't have CORS restrictions.
 *
 * FALLBACK: 'http://localhost:5000' for local development server-side.
 */
const API_BASE =
  typeof window === 'undefined'
    ? (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000')
    : '';

export default API_BASE;
