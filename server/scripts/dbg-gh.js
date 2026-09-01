/**
 * dbg-gh.js — debug GitHub webhook signature from script context
 * (same signing logic as test-ai-layer.js, isolated for diagnosis)
 */
require('dotenv').config();
const crypto = require('crypto');

const GH_SECRET = process.env.GITHUB_WEBHOOK_SECRET;
const payload = {
  action: 'opened', number: 42,
  pull_request: {
    id: 11110001, number: 42, title: 'feat: AI summary generation',
    state: 'open', draft: false, html_url: 'https://github.com/nova/pulseops-backend/pull/42',
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  },
  repository: { id: 789012345, name: 'pulseops-backend', full_name: 'nova/pulseops-backend' },
  sender: { login: 'priya-shah', id: 345678 },
};
const raw = JSON.stringify(payload);
const sig = 'sha256=' + crypto.createHmac('sha256', GH_SECRET).update(raw).digest('hex');
console.error('GH_SECRET:', GH_SECRET);
console.error('RAW (len):', raw.length);
console.error('SIG:', sig);

(async () => {
  try {
    const res = await fetch('http://localhost:5000/api/webhooks/github', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sig, 'X-GitHub-Event': 'pull_request' },
      body: raw,
    });
    const body = await res.text();
    console.error('STATUS:', res.status);
    console.error('RESP:', body);
  } catch (e) {
    console.error('FETCH ERROR:', e.message);
  }
})();
