/**
 * aiSummaryApi.js
 *
 * Plain-CJS API module for the AI Summary panel — separated out from the
 * JSX component so Node's console-script tests can exercise the fetch/mapping
 * logic without a JSX/CSS transpiler (the repo has no Babel/esbuild in the client,
 * and next-api helpers are baked into Next's internal compiler only).
 *
 * Both functions now accept an optional `token` parameter.
 * When supplied, an `Authorization: Bearer <token>` header and
 * `x-organization-id` header are included in every request so the backend
 * `authenticate` + `verifyTenantAccess` middlewares pass correctly.
 *
 * Without the token the requests return 401 "Authentication required".
 */
// Use the centralized API_BASE from lib/api.js for consistency.
// This is a CommonJS file so we inline the same resolution logic.
const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

const LATEST_ENDPOINT = `${API_BASE}/api/ai-summaries/latest`;
const GENERATE_ENDPOINT = `${API_BASE}/api/ai-summaries`;

function fetchWithTimeout(url, opts = {}, ms = 10000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  return fetch(url, { ...opts, signal: c.signal }).finally(() => clearTimeout(t));
}

/**
 * Build auth headers for a request.
 * @param {string|null} token - Bearer token from session or localStorage
 * @param {string} organizationId - Current workspace ID (sent as x-organization-id)
 */
function buildHeaders(token, organizationId) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  if (organizationId) {
    headers['x-organization-id'] = organizationId;
  }
  return headers;
}

/**
 * Fetch the latest AI summary for an organization.
 * @param {string} organizationId
 * @param {string|null} [token] - Bearer token for authentication
 */
async function fetchLatestSummary(organizationId, token) {
  try {
    const headers = buildHeaders(token, organizationId);
    const res = await fetchWithTimeout(
      `${LATEST_ENDPOINT}?organizationId=${encodeURIComponent(organizationId)}`,
      { headers }
    );
    if (res.status === 404) return null;
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(json?.message || json?.error || `Failed to fetch latest summary (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return json?.data || null;
  } catch (err) {
    if (err?.status === 404) return null;
    throw err;
  }
}

/**
 * Generate a new AI Engineering Health Summary.
 * @param {string} organizationId
 * @param {string} [type='weekly'] - Summary type
 * @param {string|null} [token] - Bearer token for authentication
 */
async function generateSummary(organizationId, type = 'weekly', token) {
  const headers = buildHeaders(token, organizationId);
  const res = await fetchWithTimeout(GENERATE_ENDPOINT, {
    method: 'POST',
    headers,
    body: JSON.stringify({ organizationId, type }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json?.message || json?.error || `Failed to generate summary (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return json?.data || null;
}

module.exports = { API_BASE, fetchLatestSummary, generateSummary };