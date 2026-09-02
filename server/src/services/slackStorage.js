'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Mirror storage adapter.
 *
 * Default: files are written to the local `uploads/` directory and served
 * back through the Express static mount (`/uploads/...`). If the AWS SDK and
 * `S3_BUCKET` env are present, uploads route to S3 instead. This indirection
 * keeps the webhook/worker pipeline independent of where the bytes land.
 */

const ROOT_UPLOAD_DIR =
  process.env.UPLOAD_DIR || path.resolve(__dirname, '../../../uploads');

/**
 * Write a file buffer to local disk under a channel-scoped namespace.
 * @returns {Promise<{ storageUrl: string, storageType: 'local'|'s3' }>}
 */
async function saveToLocal({
  organizationId,
  channelId,
  fileName,
  buffer,
}) {
  const safeOrg =
    typeof organizationId === 'string'
      ? organizationId.replace(/[^a-zA-Z0-9]/g, '')
      : String(organizationId || 'unknown');
  const safeChannel = String(channelId || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '');
  const safeName = String(fileName || 'file')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 120);
  const stamp = crypto.randomBytes(6).toString('hex');

  const dir = path.join(ROOT_UPLOAD_DIR, 'slack', safeOrg, safeChannel);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${stamp}-${safeName}`);
  fs.writeFileSync(filePath, buffer);

  const publicBase = process.env.BACKEND_PUBLIC_URL;
  const uriPath = `/uploads/slack/${safeOrg}/${safeChannel}/${path.basename(filePath)}`;
  return { storageUrl: `${publicBase}${uriPath}`, storageType: 'local', filePath };
}

/** Optional S3 adapter — used only when the SDK is resolvable + configured. */
async function saveToS3({ organizationId, channelId, fileName, buffer, fileType }) {
  // Lazy require so an unconfigured environment never fails on the import.
  let S3Client, PutObjectCommand;
  try {
    const AWS = require('@aws-sdk/client-s3');
    S3Client = AWS.S3Client;
    PutObjectCommand = AWS.PutObjectCommand;
  } catch {
    return null;
  }
  const bucket = process.env.S3_BUCKET;
  if (!bucket) return null;

  const client = new S3Client({
    region: process.env.AWS_REGION || 'us-east-1',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });
  const key = `slack/${String(organizationId)}/${String(channelId)}/${Date.now()}-${fileName}`;
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: fileType || undefined,
    })
  );
  return {
    storageUrl: `https://${bucket}.s3.amazonaws.com/${key}`,
    storageType: 's3',
  };
}

/**
 * Persist a file buffer to the configured storage backend.
 * @returns {Promise<{storageUrl:string, storageType:string}|null>}
 */
async function uploadFileBuffer({ organizationId, channelId, fileName, buffer, fileType }) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return null;

  // Prefer S3 when configured; fall back to local disk.
  const s3 = await saveToS3({ organizationId, channelId, fileName, buffer, fileType });
  if (s3) return s3;

  return saveToLocal({ organizationId, channelId, fileName, buffer });
}

/** Bucket files into a render category for the PulseOps channel UI. */
function categorizeFile(fileName, fileType) {
  const name = String(fileName || '').toLowerCase();
  const type = String(fileType || '').toLowerCase();
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('audio/')) return 'audio';
  if (type.startsWith('text/')) return 'document';
  const extMap = {
    pdf: 'document',
    doc: 'document',
    docx: 'document',
    xls: 'document',
    xlsx: 'document',
    ppt: 'document',
    pptx: 'document',
    txt: 'document',
    md: 'document',
    csv: 'document',
    json: 'document',
  };
  for (const [ext, category] of Object.entries(extMap)) {
    // Match the final extension (e.g. "report.pdf").
    if (name === ext || name.endsWith(`.${ext}`)) return category;
  }
  return 'other';
}

module.exports = { uploadFileBuffer, categorizeFile, saveToLocal, saveToS3, ROOT_UPLOAD_DIR };