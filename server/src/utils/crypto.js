'use strict';

/**
 * TASK-108 (audit) — AES-256-GCM token encryption.
 * OAuth access tokens are encrypted at rest before being stored on the
 * Integration document. The key is derived from TOKEN_ENCRYPTION_KEY via
 * SHA-256 (any-length env value -> fixed 32-byte AES-256 key). GCM provides
 * authenticated encryption; a random 96-bit IV + auth tag are stored alongside
 * the ciphertext in a single `iv:tag:ciphertext` (base64) string.
 */
const crypto = require('crypto');

function getKey() {
  const secret = process.env.TOKEN_ENCRYPTION_KEY;
  if (!secret || String(secret).length < 16) {
    throw new Error('TOKEN_ENCRYPTION_KEY must be set and at least 16 characters. Add it to server/.env');
  }
  return crypto.createHash('sha256').update(String(secret)).digest();
}

/** Encrypt a plaintext string. Returns null for null/undefined input. */
function encrypt(value) {
  if (value == null) return null;
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), tag.toString('base64'), encrypted.toString('base64')].join(':');
}

/** Decrypt an `iv:tag:ciphertext` string. Returns null for null/undefined. */
function decrypt(payload) {
  if (payload == null) return null;
  const parts = String(payload).split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted payload');
  }
  const [ivB64, tagB64, dataB64] = parts;
  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

module.exports = { encrypt, decrypt };