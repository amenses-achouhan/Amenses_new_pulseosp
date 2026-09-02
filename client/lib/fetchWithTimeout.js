/**
 * fetchWithTimeout — wraps the native fetch with an AbortController timeout.
 *
 * Prevents the browser from hanging for 300+ seconds when the Render backend
 * is cold-starting or unreachable. After `timeoutMs`, the request is aborted
 * and a clear error is thrown.
 *
 * Usage:
 *   import { fetchWithTimeout } from '../../lib/fetchWithTimeout';
 *   const res = await fetchWithTimeout(`${API_BASE}/api/auth/register`, {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify(payload),
 *   });
 */
export async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeout);
    return res;
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      const timeoutError = new Error(
        'Request timed out. The server may be starting up — please try again in a moment.'
      );
      timeoutError.name = 'TimeoutError';
      throw timeoutError;
    }
    throw err;
  }
}

/**
 * fetchJSONWithTimeout — calls fetchWithTimeout and parses the JSON response.
 * Returns { data, res } so callers can check res.ok without a second parse.
 * On non-OK responses, always returns the parsed body (or {} on parse failure).
 */
export async function fetchJSONWithTimeout(url, options = {}, timeoutMs = 8000) {
  const res = await fetchWithTimeout(url, options, timeoutMs);
  let data = {};
  try {
    data = await res.json();
  } catch {
    // Response body was not JSON — return empty object
  }
  return { data, res };
}
