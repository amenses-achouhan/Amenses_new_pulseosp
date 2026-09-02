'use strict';
/**
 * dev-tunnel.js — starts ngrok and the PulseOps backend together so Slack/Jira
 * OAuth redirect_uris always match the live tunnel.
 *
 * Flow:
 *  1. If NGROK_STATIC_DOMAIN is set in server/.env: skip spawning — the
 *     publicUrl utility will use it directly. Just start the server.
 *  2. Otherwise spawn `ngrok http <PORT>` (or use npx fallback), poll
 *     http://127.0.0.1:4040/api/tunnels until an https public_url appears,
 *     inject it as BACKEND_PUBLIC_URL, then start the server with that env.
 *
 * Usage: npm run dev:tunnel
 */
require('dotenv').config();
const { spawn } = require('child_process');
const { setTimeout: sleep } = require('timers/promises');

const NGROK_READY_TIMEOUT = 15000;
const NGROK_POLL_INTERVAL = 600;
const PORT = process.env.PORT || 5000;

function hasStaticDomain() {
  const v = (process.env.NGROK_STATIC_DOMAIN || '').trim();
  return !!v;
}

async function fetchTunnel(maxMs) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch('http://127.0.0.1:4040/api/tunnels', { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        const data = await res.json();
        const tunnels = data.tunnels || [];
        const t = tunnels.find(x => x.proto === 'https' && x.public_url) || tunnels.find(x => x.public_url);
        if (t?.public_url) return t.public_url.replace(/\/$/, '');
      }
    } catch {
      // ignore fetch/parse errors, retry
    }
    await sleep(NGROK_POLL_INTERVAL);
  }
  return null;
}

async function main() {
  if (hasStaticDomain()) {
    console.log(`[dev:tunnel] NGROK_STATIC_DOMAIN set (${process.env.NGROK_STATIC_DOMAIN.trim()}) — skipping ngrok spawn.`);
    console.log(`[dev:tunnel] Ensure Slack dashboard Redirect URL is https://${process.env.NGROK_STATIC_DOMAIN.trim().replace(/^https?:\/\//, '')}/api/integrations/slack/callback`);
    startServer(process.env.BACKEND_PUBLIC_URL || `https://${process.env.NGROK_STATIC_DOMAIN.trim().replace(/^https?:\/\//, '')}`);
    return;
  }

  // Try to reuse an already-running ngrok tunnel (user may have started it manually)
  console.log('[dev:tunnel] Checking for existing ngrok tunnel at http://127.0.0.1:4040/api/tunnels ...');
  let tunnelUrl = await fetchTunnel(2500);
  let ngrokProc = null;

  if (tunnelUrl) {
    console.log(`[dev:tunnel] Reusing existing tunnel: ${tunnelUrl}`);
  } else {
    console.log(`[dev:tunnel] No tunnel found — spawning ngrok http ${PORT} ...`);
    const candidates = [
      { cmd: 'ngrok', args: ['http', String(PORT)] },
      { cmd: 'npx', args: ['--yes', 'ngrok', 'http', String(PORT)] },
    ];
    let spawned = false;
    for (const c of candidates) {
      try {
        console.log(`[dev:tunnel] Trying: ${c.cmd} ${c.args.join(' ')}`);
        ngrokProc = spawn(c.cmd, c.args, { stdio: ['ignore', 'pipe', 'pipe'], shell: true });
        spawned = true;
        ngrokProc.stdout?.on('data', d => process.stdout.write(`[ngrok] ${d}`));
        ngrokProc.stderr?.on('data', d => process.stderr.write(`[ngrok] ${d}`));
        ngrokProc.on('error', err => console.error(`[dev:tunnel] ngrok spawn error: ${err.message}`));
        break;
      } catch (e) {
        console.warn(`[dev:tunnel] Failed to spawn ${c.cmd}: ${e.message}`);
      }
    }
    if (!spawned) {
      console.error('[dev:tunnel] Could not spawn ngrok. Is ngrok installed? Try: npm i -D ngrok  or  npm i -g ngrok');
      console.error('[dev:tunnel] Falling back to starting server without tunnel (localhost callbacks).');
      startServer(null);
      return;
    }

    console.log('[dev:tunnel] Waiting for tunnel to become ready ...');
    tunnelUrl = await fetchTunnel(NGROK_READY_TIMEOUT);
    if (!tunnelUrl) {
      console.error('[dev:tunnel] Timed out waiting for ngrok tunnel. Check that ngrok is authenticated: ngrok config add-authtoken <token>');
      console.error('[dev:tunnel] Starting server anyway with localhost fallback.');
      startServer(null);
      return;
    }
    console.log(`[dev:tunnel] Tunnel ready: ${tunnelUrl}`);
  }

  console.log(`[dev:tunnel] Live Slack callback will be: ${tunnelUrl}/api/integrations/slack/callback`);
  console.log(`[dev:tunnel] If host changed, paste it into https://api.slack.com/apps → OAuth & Permissions → Redirect URLs`);
  if (ngrokProc) {
    // Ensure ngrok is killed when this script exits
    const cleanup = () => { try { ngrokProc.kill(); } catch { /* already exited */ } };
    process.on('exit', cleanup);
    process.on('SIGINT', () => { cleanup(); process.exit(0); });
    process.on('SIGTERM', cleanup);
  }
  startServer(tunnelUrl);
}

function startServer(tunnelUrl) {
  const env = { ...process.env };
  if (tunnelUrl) env.BACKEND_PUBLIC_URL = tunnelUrl;

  console.log(`[dev:tunnel] Starting server (BACKEND_PUBLIC_URL=${env.BACKEND_PUBLIC_URL || '(localhost fallback)'}) ...`);
  const server = spawn('node', ['server.js'], { env, stdio: ['inherit', 'pipe', 'pipe'] });

  server.stdout?.on('data', d => process.stdout.write(d));
  server.stderr?.on('data', d => process.stderr.write(d));
  server.on('close', code => {
    console.log(`[dev:tunnel] Server exited with code ${code}`);
    process.exit(code ?? 0);
  });
  server.on('error', err => {
    console.error(`[dev:tunnel] Server spawn error: ${err.message}`);
    process.exit(1);
  });

  const shutdown = () => { try { server.kill('SIGTERM'); } catch { /* already exited */ } };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(err => {
  console.error('[dev:tunnel] Fatal:', err);
  process.exit(1);
});