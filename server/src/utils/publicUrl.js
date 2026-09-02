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

module.exports = {
  getPublicBackendUrl,
  ensurePublicBackendUrl,
  getSlackCallbackUrl,
  getJiraCallbackUrl,
  getGithubCallbackUrl,
  clearCache,
  fetchNgrokTunnelUrl,
};
