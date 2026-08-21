import crypto from 'node:crypto';
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  NotFound,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../config/env';
import { BadRequestError } from '../lib/errors';
import { stripImageMetadata } from '../lib/imageMetadata';
import { logger } from '../lib/logger';

/**
 * Only these types can be uploaded as post images; anything else is rejected before we ever
 * hand out a presigned URL.
 */
const ALLOWED_CONTENT_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const MAX_CONTENT_LENGTH_BYTES = 10 * 1024 * 1024;
const UPLOAD_URL_TTL_SECONDS = 300;

/**
 * Magic-number check for each allowed content type. WebP needs two disjoint byte ranges (the
 * RIFF container header, then the "WEBP" tag after the 4-byte chunk size), so each entry is a
 * list of (offset, expected bytes) pairs rather than a single prefix.
 */
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
  /**
   * A custom endpoint means a self-hosted, S3-compatible store such as MinIO. Those serve
   * buckets as a path segment, whereas the SDK defaults to the virtual-hosted form
   * (bucket.host), which does not resolve there. Real AWS S3 keeps the default.
   */
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
  /**
   * Top-level storage folder the key is issued under, e.g. `posts` or `recipes`. Callers
   * validate ownership later by checking the resulting key starts with `<folder>/<userId>/`, so
   * this must match that check.
   */
  folder: string;
}

export interface CreateUploadUrlResult {
  uploadUrl: string;
  storageKey: string;
}

/**
 * Issues a presigned PUT URL scoped to the caller's own prefix, so ownership of an uploaded key
 * can later be verified from the key itself.
 * @throws {BadRequestError} if the content type is not one of the allowed image types, or the
 * declared content length is non-positive or exceeds the 10 MB upload limit.
 */
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

/**
 * Confirms a client-supplied storage key is a real, plausible image before it is attached to a
 * post or recipe - the presigned PUT only reserves the key and asserts what the client *claims*
 * it will upload; nothing forces the client to actually upload, or to upload what it declared.
 * This is a write-path check only (called from createPost/createRecipe/updateRecipe), never from
 * a read path.
 *
 * Storage being unreachable (network error, timeout, wrong credentials, bucket misconfigured,
 * ...) is deliberately NOT turned into a 400: only the S3-modeled `NotFound` exception - which
 * means the bucket positively answered "no such key" - is treated as the caller's fault. Any
 * other error (including a plain network failure) is rethrown as-is and falls through to the
 * app's default error handler, which reports it as a 500, exactly like any other infrastructure
 * failure.
 * @throws {BadRequestError} if the key was never uploaded (S3 NotFound), or the uploaded object
 * has an invalid size, unsupported content type, or bytes that don't match the declared type.
 */
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

  await stripMetadataInPlace(storageKey, contentType);
}

/**
 * Re-fetches the whole object and overwrites it with an EXIF/IPTC/XMP-stripped copy, so that a
 * camera's embedded GPS coordinates never survive into a publicly-readable object, regardless of
 * whether the client re-encoded the image before uploading (the client's re-encode is a courtesy,
 * not something the server can enforce - a modified client or a raw PUT to the presigned URL
 * bypasses it entirely).
 *
 * Buffering the whole object in memory is fine here: uploads are capped at 10 MB
 * (MAX_CONTENT_LENGTH_BYTES) by both the presigned URL and the size check above, so this never
 * holds more than that.
 *
 * Never throws: this runs after the image has already passed verification and is about to be
 * attached to a post/recipe/avatar, so a stripping failure (network error, an S3 write conflict,
 * a parser bug) must not fail the user's request - losing the upload would be worse than a
 * metadata field surviving. Failures are logged and swallowed.
 */
async function stripMetadataInPlace(storageKey: string, contentType: string): Promise<void> {
  try {
    const object = await s3Client.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: storageKey }));
    const original = Buffer.from((await object.Body?.transformToByteArray()) ?? new Uint8Array(0));

    const result = stripImageMetadata(contentType, original);
    if (!result) {
      // The magic-number check already proved the bytes are a genuine instance of
      // `contentType`, so failing to parse its container here means our parser doesn't yet
      // handle some real-world variant of the format - not that the upload is invalid. Leaving
      // the object untouched is the safe default; this is worth a warn since it means a real
      // image is shipping with whatever metadata it already had.
      logger.warn({ storageKey, contentType }, 'Could not parse image container to strip metadata');
      return;
    }

    if (!result.changed) return; // nothing to strip - avoid a pointless write and version churn

    await s3Client.send(
      new PutObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: storageKey,
        Body: result.buffer,
        ContentType: contentType,
      }),
    );
  } catch (err) {
    logger.error({ err, storageKey, contentType }, 'Failed to strip image metadata after upload');
  }
}

// S3's DeleteObjects accepts at most 1000 keys per call.
const DELETE_BATCH_SIZE = 1000;

/**
 * Deletes every object under `prefix` (e.g. `posts/<userId>/`), used by the account purge script
 * to remove a deleted user's stored images.
 *
 * Lists in pages (S3 caps ListObjectsV2 at 1000 keys per page) and deletes in batches of up to
 * 1000 keys, which is also DeleteObjects' own limit. Safe to call on a prefix with nothing under
 * it, and safe to re-run: a key that no longer exists is simply not returned by the list and
 * never submitted for deletion.
 * @returns The number of objects actually deleted.
 */
export async function deleteByPrefix(prefix: string): Promise<number> {
  let deletedCount = 0;
  let continuationToken: string | undefined;

  do {
    const listed = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: env.S3_BUCKET,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );

    const keys = (listed.Contents ?? [])
      .map((object) => object.Key)
      .filter((key): key is string => key !== undefined);

    for (let i = 0; i < keys.length; i += DELETE_BATCH_SIZE) {
      const batch = keys.slice(i, i + DELETE_BATCH_SIZE);
      await s3Client.send(
        new DeleteObjectsCommand({
          Bucket: env.S3_BUCKET,
          Delete: { Objects: batch.map((Key) => ({ Key })) },
        }),
      );
      deletedCount += batch.length;
    }

    continuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
  } while (continuationToken);

  return deletedCount;
}

/**
 * The database stores only the object key; this resolves it to a fetchable URL at read time, so
 * switching storage/CDN providers is a config change.
 */
export function publicUrlFor(storageKey: string): string {
  if (env.S3_PUBLIC_BASE_URL) {
    return `${env.S3_PUBLIC_BASE_URL.replace(/\/+$/, '')}/${storageKey}`;
  }
  if (env.S3_ENDPOINT) {
    return `${env.S3_ENDPOINT.replace(/\/+$/, '')}/${env.S3_BUCKET}/${storageKey}`;
  }
  return `https://${env.S3_BUCKET}.s3.${env.S3_REGION}.amazonaws.com/${storageKey}`;
}
