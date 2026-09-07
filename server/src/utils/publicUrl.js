'use strict';

let cachedUrl = null;
let cachedAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

async function fetchNgrokTunnelUrl() {
  const ngrokApi = process.env.NGROK_API_URL || 'http://127.0.0.1:4040/api/tunnels';
  try {
    const res = await fetch(ngrokApi, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return null;
    const data = await res.json();
    const tunnels = data.tunnels || [];
    // Prefer https tunnel, fallback to any tunnel with public_url
    const httpsTunnel = tunnels.find(t => t.proto === 'https' && t.public_url);
    if (httpsTunnel) return httpsTunnel.public_url;
    const anyTunnel = tunnels.find(t => t.public_url);
    return anyTunnel?.public_url || null;
  } catch {
    return null;
  }
}

function normalize(u) {
  if (!u) return null;
  const t = String(u).trim();
  if (!t) return null;
  return t.replace(/\/$/, '');
}

function buildCallbackUrl(path) {
  const base = getPublicBackendUrl();
  if (!base) return null;
  return `${base}${path}`;
}

function getPublicBackendUrl() {
  if (cachedUrl && Date.now() - cachedAt < CACHE_TTL_MS) {
    return cachedUrl;
  }

  // Single source of truth: BACKEND_PUBLIC_URL.
  const explicitUrl = normalize(process.env.BACKEND_PUBLIC_URL);
  if (explicitUrl) {
    cachedUrl = explicitUrl;
    cachedAt = Date.now();
    return cachedUrl;
  }

  if (process.env.NODE_ENV !== 'production') {
    // Dev fallback: use localhost so routes don't 503. Slack/Jira OAuth will still
    // require a public URL — we warn clearly so the developer knows to start ngrok
    // or set BACKEND_PUBLIC_URL.
    const port = process.env.PORT || 5000;
    const fallback = `http://localhost:${port}`;
    // Cache fallback briefly but allow ensurePublicBackendUrl to override it quickly
    cachedUrl = fallback;
    cachedAt = Date.now();
    return cachedUrl;
  }

  return null;
}

async function ensurePublicBackendUrl() {
  // Fast path: explicit config already resolved
  const existing = normalize(process.env.BACKEND_PUBLIC_URL);
  if (existing) {
    // Populate cache via getPublicBackendUrl
    getPublicBackendUrl();
    return cachedUrl;
  }

  if (process.env.NODE_ENV === 'production') {
    console.error('[publicUrl] ⚠️  BACKEND_PUBLIC_URL must be set in production.');
    console.error('[publicUrl]    OAuth callbacks and webhooks will not work without it.');
    return null;
  }

  // In dev: try to auto-discover ngrok tunnel
  const tunnelUrl = await fetchNgrokTunnelUrl();
  if (tunnelUrl) {
    const normalized = normalize(tunnelUrl);
    cachedUrl = normalized;
    cachedAt = Date.now();
    process.env.BACKEND_PUBLIC_URL = normalized;
    console.log(`[publicUrl] Auto-detected ngrok tunnel: ${normalized}`);
    return normalized;
  }

  // No tunnel found — fall back to localhost but warn that Slack callbacks will not
  // be reachable from Slack's servers until ngrok is started or BACKEND_PUBLIC_URL is set.
  const port = process.env.PORT || 5000;
  const fallback = `http://localhost:${port}`;
  cachedUrl = fallback;
  cachedAt = Date.now();
  // Do NOT set process.env.BACKEND_PUBLIC_URL to fallback — keep it empty so a later
  // ngrok start can be detected without restart (clearCache + retry).
  console.warn(`[publicUrl] No ngrok tunnel found. Falling back to ${fallback}.`);
  console.warn(`[publicUrl] Slack/Jira OAuth will fail over the public internet. Run: npm run dev:tunnel  OR  ngrok http ${port}  OR set BACKEND_PUBLIC_URL in server/.env`);
  return fallback;
}

function getSlackCallbackUrl() {
  return buildCallbackUrl('/api/integrations/slack/callback');
}

function getJiraCallbackUrl() {
  return buildCallbackUrl('/api/integrations/jira/callback');
}

function getGithubCallbackUrl() {
  return buildCallbackUrl('/api/integrations/github/callback');
}

function clearCache() {
  cachedUrl = null;
  cachedAt = 0;
}

// ---------------------------------------------------------------------------
// Frontend origin resolution (RC-1 — post-OAuth redirect session preservation)
// ---------------------------------------------------------------------------

/**
 * Normalize a URL to its bare origin (scheme + host + port).
 * Returns null for anything that is not http(s) or is unparseable, or that
 * embeds credentials (user:pass@host) — never redirect to such a URL.
 */
function normalizeOrigin(value) {
  if (!value || typeof value !== 'string') return null;
  try {
    const u = new URL(value.trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (u.username || u.password) return null;
    return u.origin;
  } catch {
    return null;
  }
}

/**
 * Resolve the frontend origin the browser session actually belongs to.
 *
 * The integration OAuth callbacks run UNAUTHENTICATED (the browser arrives
 * fresh from the provider), so the final redirect must land on the same origin
 * the user initiated the connect from — otherwise the NextAuth session cookie
 * is not sent with the landing request and the auth guard bounces the user to
 * the sign-in page (the reported production bug).
 *
 * Candidate sources, in order:
 *   1. `x-frontend-origin` — sent explicitly by our own client code. Works in
 *      every topology: same-origin GETs behind the Vercel rewrite proxy send
 *      no Origin/Referer guarantees, but the browser always knows its origin.
 *   2. `Origin` — present on cross-origin browser requests.
 *   3. `Referer` — present on same-origin browser requests proxied to Render.
 *   4. FRONTEND_URL — canonical fallback for non-browser callers.
 *
 * NOTE on trust: sources 1–3 are client-supplied. An authenticated user could
 * redirect the return hop of THEIR OWN OAuth grant to an arbitrary origin;
 * the impact is limited to that user's own browser (no tokens or other users'
 * data travel in the redirect). The alternative — trusting only FRONTEND_URL —
 * is exactly what breaks production when that env var is stale or misspelled
 * (the historical pulseops/pulseosp mismatch), so we prefer the browser's
 * actual origin and keep FRONTEND_URL as the fallback.
 */
function resolveFrontendOrigin(req) {
  if (req && typeof req.get === 'function') {
    for (const header of ['x-frontend-origin', 'origin', 'referer']) {
      const origin = normalizeOrigin(req.get(header));
      if (origin) return origin;
    }
  }
  return normalizeOrigin(process.env.FRONTEND_URL);
}

module.exports = {
  getPublicBackendUrl,
  ensurePublicBackendUrl,
  getSlackCallbackUrl,
  getJiraCallbackUrl,
  getGithubCallbackUrl,
  clearCache,
  fetchNgrokTunnelUrl,
  normalizeOrigin,
  resolveFrontendOrigin,
};
