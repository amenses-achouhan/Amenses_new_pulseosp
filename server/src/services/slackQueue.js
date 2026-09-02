'use strict';

/**
 * Minimal async job queue.
 *
 * Slack requires the HTTP webhook to be acknowledged within ~3 seconds, but
 * file downloads + DB writes + storage uploads are slow. This queue decouples
 * the two: the webhook route pushes a job and returns immediately, while a
 * background worker processes jobs (with bounded retries + exponential
 * backoff).
 *
 * The `add(name, payload, opts)` / `process(handler)` signatures mirror
 * BullMQ's, so this module can be swapped for a real BullMQ queue when a Redis
 * instance is available in production — no calling-code changes needed.
 *
 * Retry semantics:
 *   - Each job carries its own `attempts` (default 3) and `backoffMs`.
 *   - `opts.retryAfter` (from Slack's Retry-After header) overrides the backoff
 *     for that retry so rate-limits are respected.
 *   - Jobs baked with `opts.permanent: true` are NOT retried — permanent
 *     Slack errors surface as integration/conversation sync status instead of
 *     endlessly burning queue cycles.
 */

class SlackQueue {
  constructor({ concurrency = 3, retries = 3, backoffMs = 1000 } = {}) {
    this.concurrency = concurrency;
    this.defaultRetries = retries;
    this.defaultBackoffMs = backoffMs;
    this.jobs = [];
    this.running = 0;
    this.handler = null;
    this.started = false;
  }

  /** Register the worker callback (async (job) => void). */
  process(handler) {
    this.handler = handler;
    this._start();
  }

  /**
   * Push a job onto the queue (mirrors BullMQ `queue.add`).
   * @param {string} name
   * @param {object} payload
   * @param {object} opts - { jobId, attempts, backoffMs, retryAfter, permanent }
   */
  add(name, payload, opts = {}) {
    this.jobs.push({
      id: opts.jobId || `${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name,
      payload,
      attempts: 0,
      maxAttempts: opts.attempts || this.defaultRetries,
      backoffMs: opts.backoffMs || this.defaultBackoffMs,
      permanent: !!opts.permanent,
    });
    this._pump();
    return Promise.resolve();
  }

  _start() {
    if (this.started) return;
    this.started = true;
  }

  _pump() {
    if (!this.handler) return;
    while (this.jobs.length > 0 && this.running < this.concurrency) {
      const job = this.jobs.shift();
      this._run(job);
    }
  }

  async _run(job) {
    this.running += 1;
    try {
      await this.handler(job);
    } catch (err) {
      const retryAfter = (err && err.retryAfter) || (job.payload && job.payload.__retryAfter);
      const permanent = !!(job.permanent || (err && err.permanent));

      if (!permanent && job.attempts < job.maxAttempts) {
        job.attempts += 1;
        const backoffMs = retryAfter
          ? Number(retryAfter) * 1000
          : Math.min(job.backoffMs * Math.pow(2, job.attempts - 1), 30000);
        setTimeout(() => {
          this.jobs.unshift(job);
          this._pump();
        }, backoffMs);
      } else {
        console.error(
          `[slackQueue] job "${job.name}" failed after ${job.attempts} retries:`,
          err.message || err
        );
      }
    } finally {
      this.running -= 1;
      this._pump();
    }
  }

  get length() {
    return this.jobs.length;
  }

  get pendingCount() {
    return this.jobs.length;
  }
}

// Singleton — the webhook route enqueues here, the worker is started in
// server.js after DB connection so a live connection is guaranteed.
const slackQueue = new SlackQueue({ concurrency: 3 });

module.exports = { slackQueue };