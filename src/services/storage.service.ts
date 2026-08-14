import crypto from 'node:crypto';
import { GetObjectCommand, HeadObjectCommand, NotFound, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../config/env';
import { BadRequestError } from '../lib/errors';

/// Only these types can be uploaded as post images; anything else is rejected
/// before we ever hand out a presigned URL.
const ALLOWED_CONTENT_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const MAX_CONTENT_LENGTH_BYTES = 10 * 1024 * 1024;
const UPLOAD_URL_TTL_SECONDS = 300;

/// Magic-number check for each allowed content type. WebP needs two
/// disjoint byte ranges (the RIFF container header, then the "WEBP" tag
/// after the 4-byte chunk size), so each entry is a list of
/// (offset, expected bytes) pairs rather than a single prefix.
const MAGIC_NUMBER_RANGES: Record<string, Array<{ offset: number; bytes: number[] }>> = {
  'image/jpeg': [{ offset: 0, bytes: [0xff, 0xd8, 0xff] }],
  'image/png': [{ offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] }],
  'image/webp': [
    { offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] }, // "RIFF"
    { offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] }, // "WEBP"
  ],
};

// Covers the longest range used above (WebP's "WEBP" tag ends at byte 11).
const MAGIC_NUMBER_PROBE_BYTES = 12;

function matchesDeclaredType(contentType: string, bytes: Uint8Array): boolean {
  const ranges = MAGIC_NUMBER_RANGES[contentType];
  if (!ranges) return false;
  return ranges.every((range) =>
    range.bytes.every((expected, index) => bytes[range.offset + index] === expected),
  );
}

const s3Client = new S3Client({
  region: env.S3_REGION,
  endpoint: env.S3_ENDPOINT,
  // A custom endpoint means a self-hosted, S3-compatible store such as MinIO.
  // Those serve buckets as a path segment, whereas the SDK defaults to the
  // virtual-hosted form (bucket.host), which does not resolve there.
  // Real AWS S3 keeps the default.
  forcePathStyle: Boolean(env.S3_ENDPOINT),
  credentials: {
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  },
});

export interface CreateUploadUrlParams {
  userId: string;
  contentType: string;
  contentLength: number;
  /// Top-level storage folder the key is issued under, e.g. `posts` or
  /// `recipes`. Callers validate ownership later by checking the resulting
  /// key starts with `<folder>/<userId>/`, so this must match that check.
  folder: string;
}

export interface CreateUploadUrlResult {
  uploadUrl: string;
  storageKey: string;
}

/// Issues a presigned PUT URL scoped to the caller's own prefix, so ownership
/// of an uploaded key can later be verified from the key itself.
export async function createUploadUrl({
  userId,
  contentType,
  contentLength,
  folder,
}: CreateUploadUrlParams): Promise<CreateUploadUrlResult> {
  const extension = ALLOWED_CONTENT_TYPES[contentType];
  if (!extension) {
    throw new BadRequestError('Unsupported image content type', { contentType });
  }
  if (contentLength <= 0 || contentLength > MAX_CONTENT_LENGTH_BYTES) {
    throw new BadRequestError('Image exceeds the 10 MB upload limit');
  }

  const storageKey = `${folder}/${userId}/${crypto.randomUUID()}.${extension}`;

  const uploadUrl = await getSignedUrl(
    s3Client,
    new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: storageKey,
      ContentType: contentType,
      ContentLength: contentLength,
    }),
    { expiresIn: UPLOAD_URL_TTL_SECONDS },
  );

  return { uploadUrl, storageKey };
}

/// Confirms a client-supplied storage key is a real, plausible image before
/// it is attached to a post or recipe - the presigned PUT only reserves the
/// key and asserts what the client *claims* it will upload; nothing forces
/// the client to actually upload, or to upload what it declared. This is a
/// write-path check only (called from createPost/createRecipe/updateRecipe),
/// never from a read path.
///
/// Storage being unreachable (network error, timeout, wrong credentials,
/// bucket misconfigured, ...) is deliberately NOT turned into a 400: only
/// the S3-modeled `NotFound` exception - which means the bucket positively
/// answered "no such key" - is treated as the caller's fault. Any other
/// error (including a plain network failure) is rethrown as-is and falls
/// through to the app's default error handler, which reports it as a 500,
/// exactly like any other infrastructure failure.
export async function verifyUploadedImage(storageKey: string): Promise<void> {
  let head;
  try {
    head = await s3Client.send(new HeadObjectCommand({ Bucket: env.S3_BUCKET, Key: storageKey }));
  } catch (err) {
    if (err instanceof NotFound) {
      throw new BadRequestError('Image was never uploaded to storage', { storageKey });
    }
    throw err;
  }

  const size = head.ContentLength ?? 0;
  if (size <= 0 || size > MAX_CONTENT_LENGTH_BYTES) {
    throw new BadRequestError('Uploaded image has an invalid size', { storageKey, size });
  }

  const contentType = head.ContentType ?? '';
  if (!(contentType in ALLOWED_CONTENT_TYPES)) {
    throw new BadRequestError('Uploaded image has an unsupported content type', {
      storageKey,
      contentType,
    });
  }

  const probe = await s3Client.send(
    new GetObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: storageKey,
      Range: `bytes=0-${MAGIC_NUMBER_PROBE_BYTES - 1}`,
    }),
  );
  const bytes = (await probe.Body?.transformToByteArray()) ?? new Uint8Array(0);
  if (!matchesDeclaredType(contentType, bytes)) {
    throw new BadRequestError('Uploaded image bytes do not match its declared content type', {
      storageKey,
      contentType,
    });
  }
}

/// The database stores only the object key; this resolves it to a fetchable
/// URL at read time, so switching storage/CDN providers is a config change.
export function publicUrlFor(storageKey: string): string {
  if (env.S3_PUBLIC_BASE_URL) {
    return `${env.S3_PUBLIC_BASE_URL.replace(/\/+$/, '')}/${storageKey}`;
  }
  if (env.S3_ENDPOINT) {
    return `${env.S3_ENDPOINT.replace(/\/+$/, '')}/${env.S3_BUCKET}/${storageKey}`;
  }
  return `https://${env.S3_BUCKET}.s3.${env.S3_REGION}.amazonaws.com/${storageKey}`;
}
