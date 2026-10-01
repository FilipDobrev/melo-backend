import crypto from 'node:crypto';
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  NotFound,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../config/env';
import { BadRequestError } from '../lib/errors';
import { logger } from '../lib/logger';

/**
 * The app re-encodes every image to JPEG on the device before upload (frontend/src/lib/image.ts),
 * so JPEG is the only type accepted. Fewer formats means a single, small parser to audit.
 */
const ALLOWED_CONTENT_TYPE = 'image/jpeg';

const MAX_CONTENT_LENGTH_BYTES = 2 * 1024 * 1024;
const UPLOAD_URL_TTL_SECONDS = 300;

/**
 * The app caps the long edge at 1600px; this leaves headroom while still rejecting
 * decompression-bomb style images (small file, enormous pixel count).
 */
const MAX_IMAGE_EDGE_PX = 2048;

/**
 * JPEG headers (APPn/EXIF/ICC segments, then the first frame header) sit at the start of the
 * file, so the first 64 KB is enough to find the dimensions without downloading the whole image.
 */
const HEADER_PROBE_BYTES = 64 * 1024;

const UPLOAD_FOLDER = 'uploads';
export type AttachedImageFolder = 'posts' | 'recipes' | 'avatars';

function hasJpegMagicBytes(bytes: Uint8Array): boolean {
  return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

/** Big-endian uint16; callers check bounds first, so the `?? 0` only satisfies the type checker. */
function uint16At(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
}

/**
 * Reads the pixel dimensions from the first start-of-frame (SOF) marker of a JPEG.
 *
 * Walks the marker segments after SOI: standalone markers (no length field) and 0xFF fill bytes
 * are skipped, every other segment is skipped by its declared length. The walk gives up at
 * SOS/EOI, since a SOF always precedes the entropy-coded data.
 * @returns null if the bytes are not a JPEG, are truncated before a SOF, or are malformed.
 */
export function readJpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (!hasJpegMagicBytes(bytes)) return null;

  let offset = 2;
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    // Any number of 0xFF fill bytes may precede a marker code.
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    if (marker === undefined) return null;

    // 0x00 is a stuffed byte, only valid inside entropy-coded data, so it is malformed here.
    if (marker === 0x00) return null;
    // SOS starts entropy-coded data and EOI ends the file; neither can come before a SOF.
    if (marker === 0xda || marker === 0xd9) return null;
    // TEM (0x01) and RSTn/SOI (0xD0-0xD8) are standalone: they have no length field.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      offset += 1;
      continue;
    }

    if (offset + 2 >= bytes.length) return null;
    const segmentLength = uint16At(bytes, offset + 1);
    if (segmentLength < 2) return null;

    // SOF0-SOF15, except DHT (C4), JPG (C8) and DAC (CC), which share the range but are not frames.
    const isStartOfFrame =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isStartOfFrame) {
      // After the marker: length (2), precision (1), height (2), width (2).
      if (offset + 7 >= bytes.length) return null;
      const height = uint16At(bytes, offset + 4);
      const width = uint16At(bytes, offset + 6);
      return { width, height };
    }

    offset += 1 + segmentLength;
  }
  return null;
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
}

export interface CreateUploadUrlResult {
  uploadUrl: string;
  storageKey: string;
}

/**
 * Issues a presigned PUT URL for a fresh key under the caller's own `uploads/<userId>/` prefix.
 * The key is only a staging location: {@link promoteUpload} moves it to its final folder when the
 * caller attaches it to a post, recipe or avatar.
 * @throws {BadRequestError} if the content type is not image/jpeg, or the declared content
 * length is non-positive or exceeds the 2 MB upload limit.
 */
export async function createUploadUrl({
  userId,
  contentType,
  contentLength,
}: CreateUploadUrlParams): Promise<CreateUploadUrlResult> {
  if (contentType !== ALLOWED_CONTENT_TYPE) {
    throw new BadRequestError('Unsupported image content type', { contentType });
  }
  if (contentLength <= 0 || contentLength > MAX_CONTENT_LENGTH_BYTES) {
    throw new BadRequestError('Image exceeds the 2 MB upload limit');
  }

  const storageKey = `${UPLOAD_FOLDER}/${userId}/${crypto.randomUUID()}.jpg`;

  const uploadUrl = await getSignedUrl(
    s3Client,
    new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: storageKey,
      ContentType: contentType,
      ContentLength: contentLength,
    }),
    {
      expiresIn: UPLOAD_URL_TTL_SECONDS,
      // The presigner puts content-type in its unsignable set by default, which would let a
      // client PUT any type (e.g. text/html) to this URL. Listing it here forces it into the
      // signature so the client must send exactly the type that was signed.
      signableHeaders: new Set(['content-type']),
    },
  );

  return { uploadUrl, storageKey };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Exact shape of a key this service issues: `<folder>/<ownerId>/<uuid>.jpg`. Matching the whole
 * string (rather than a `startsWith` prefix) is what stops path-traversal keys such as
 * `posts/<me>/../<victim>/x.jpg`. The uuid is the capture group.
 */
function ownedKeyPattern(folder: string, ownerId: string): RegExp {
  return new RegExp(`^${folder}/${escapeRegExp(ownerId)}/([0-9a-f-]{36})\\.jpg$`);
}

/** True when `key` is exactly a key this service issued for `ownerId` under `folder`. */
export function isOwnedKey(key: string, folder: AttachedImageFolder, ownerId: string): boolean {
  return ownedKeyPattern(folder, ownerId).test(key);
}

function isPreconditionFailed(err: unknown): boolean {
  return err instanceof S3ServiceException && err.$metadata.httpStatusCode === 412;
}

/**
 * Verifies a client-uploaded object and copies it to its final, immutable location.
 *
 * The client only ever holds write access to `uploads/`, never to an attached object, so the
 * bytes verified here cannot change after they are attached (a presigned URL can be re-used
 * until it expires, but only ever overwrites the `uploads/` copy). Anything never attached is
 * reaped by an R2 lifecycle rule on the `uploads/` prefix.
 *
 * Checks, in order: the key is exactly the caller's own upload key; the object exists, is within
 * the size limit and is image/jpeg; the first bytes are a JPEG whose dimensions are within
 * {@link MAX_IMAGE_EDGE_PX}. The ETag from the HEAD is pinned on the ranged GET and on the copy,
 * so an overwrite between check and copy fails instead of slipping through.
 *
 * Storage being unreachable is deliberately NOT turned into a 400: only the S3-modeled
 * `NotFound` (the bucket positively answered "no such key") and a failed precondition are the
 * caller's fault. Any other error is rethrown and reported as a 500.
 * @returns The final key, `<folder>/<ownerId>/<uuid>.jpg`.
 * @throws {BadRequestError} if the key is not the caller's upload key, was never uploaded, has an
 * invalid size or content type, is not a JPEG within the dimension limit, or changed mid-check.
 */
export async function promoteUpload(
  uploadKey: string,
  ownerId: string,
  folder: AttachedImageFolder,
): Promise<string> {
  const match = ownedKeyPattern(UPLOAD_FOLDER, ownerId).exec(uploadKey);
  if (!match) {
    throw new BadRequestError('Image key must belong to the caller');
  }
  const finalKey = `${folder}/${ownerId}/${match[1]}.jpg`;

  let head;
  try {
    head = await s3Client.send(new HeadObjectCommand({ Bucket: env.S3_BUCKET, Key: uploadKey }));
  } catch (err) {
    if (err instanceof NotFound) {
      throw new BadRequestError('Image was never uploaded to storage', { storageKey: uploadKey });
    }
    throw err;
  }

  const size = head.ContentLength ?? 0;
  if (size <= 0 || size > MAX_CONTENT_LENGTH_BYTES) {
    throw new BadRequestError('Uploaded image has an invalid size', { storageKey: uploadKey, size });
  }
  if (head.ContentType !== ALLOWED_CONTENT_TYPE) {
    throw new BadRequestError('Uploaded image has an unsupported content type', {
      storageKey: uploadKey,
      contentType: head.ContentType,
    });
  }
  const etag = head.ETag;
  if (!etag) {
    throw new Error('Storage returned no ETag for an uploaded object');
  }

  let header: Uint8Array;
  try {
    const probe = await s3Client.send(
      new GetObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: uploadKey,
        Range: `bytes=0-${HEADER_PROBE_BYTES - 1}`,
        IfMatch: etag,
      }),
    );
    header = (await probe.Body?.transformToByteArray()) ?? new Uint8Array(0);
  } catch (err) {
    if (isPreconditionFailed(err)) {
      throw new BadRequestError('Image changed during upload, try again');
    }
    throw err;
  }

  if (!hasJpegMagicBytes(header)) {
    throw new BadRequestError('Uploaded image bytes are not a JPEG', { storageKey: uploadKey });
  }
  const dimensions = readJpegDimensions(header);
  if (
    !dimensions ||
    dimensions.width === 0 ||
    dimensions.height === 0 ||
    dimensions.width > MAX_IMAGE_EDGE_PX ||
    dimensions.height > MAX_IMAGE_EDGE_PX
  ) {
    throw new BadRequestError(`Image dimensions are invalid or exceed ${MAX_IMAGE_EDGE_PX}px`, {
      storageKey: uploadKey,
    });
  }

  try {
    await s3Client.send(
      new CopyObjectCommand({
        Bucket: env.S3_BUCKET,
        // Keys here match ownedKeyPattern, so they contain only characters that need no escaping.
        CopySource: `${env.S3_BUCKET}/${uploadKey}`,
        Key: finalKey,
        CopySourceIfMatch: etag,
        MetadataDirective: 'REPLACE',
        ContentType: ALLOWED_CONTENT_TYPE,
        ContentDisposition: 'inline',
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );
  } catch (err) {
    if (isPreconditionFailed(err)) {
      throw new BadRequestError('Image changed during upload, try again');
    }
    throw err;
  }

  try {
    await s3Client.send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: uploadKey }));
  } catch (err) {
    // The lifecycle rule on uploads/ reaps it, so a failed cleanup must not fail the attach.
    logger.warn({ err, uploadKey }, 'failed to delete promoted upload; lifecycle rule will reap it');
  }

  return finalKey;
}

// S3's DeleteObjects accepts at most 1000 keys per call.
const DELETE_BATCH_SIZE = 1000;

/**
 * Deletes the given objects in batches of up to 1000 keys. A no-op for an empty list. Keys that
 * do not exist are not an error (S3 deletes are idempotent).
 * @throws {Error} if storage reports any key it failed to delete.
 */
export async function deleteObjects(keys: string[]): Promise<void> {
  for (let i = 0; i < keys.length; i += DELETE_BATCH_SIZE) {
    const batch = keys.slice(i, i + DELETE_BATCH_SIZE);
    const result = await s3Client.send(
      new DeleteObjectsCommand({
        Bucket: env.S3_BUCKET,
        Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
      }),
    );
    if (result.Errors && result.Errors.length > 0) {
      throw new Error(`Storage failed to delete ${result.Errors.length} object(s)`);
    }
  }
}

/**
 * Fire-and-forget {@link deleteObjects} for cleanup after a database change has committed. The
 * database is the source of truth, so a leaked object is a cleanup detail, not a reason to fail
 * the request (same stance as accountPurge.service.ts): failures are logged, never thrown.
 */
export function deleteObjectsInBackground(keys: string[], context: Record<string, unknown>): void {
  deleteObjects(keys).catch((err: unknown) => {
    logger.error({ err, keys, ...context }, 'failed to delete storage objects; leaked until purged');
  });
}

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
