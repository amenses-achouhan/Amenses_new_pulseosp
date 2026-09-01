const crypto = require('crypto');

const verifyGithubWebhook = (req, res, next) => {
  const signature = req.headers['x-hub-signature-256'];
  const secret = process.env.GITHUB_WEBHOOK_SECRET;

  if (!secret) {
    console.error('[github/webhook] GITHUB_WEBHOOK_SECRET is not configured — rejecting request');
    return res.status(500).json({ message: 'Webhook secret not configured on server' });
  }

  if (!signature) {
    return res.status(401).json({ message: 'Missing x-hub-signature-256 header' });
  }

  const payload = req.rawBody || Buffer.from(JSON.stringify(req.body));
  const hmac = crypto.createHmac('sha256', secret);
  const digest = Buffer.from('sha256=' + hmac.update(payload).digest('hex'), 'utf8');
  const checksum = Buffer.from(signature, 'utf8');

  if (checksum.length !== digest.length || !crypto.timingSafeEqual(digest, checksum)) {
    return res.status(401).json({ message: 'Invalid webhook signature' });
  }

  next();
};

module.exports = { verifyGithubWebhook, verifyWebhookSignature: verifyGithubWebhook };