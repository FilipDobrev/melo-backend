import crypto from 'node:crypto';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
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
}: CreateUploadUrlParams): Promise<CreateUploadUrlResult> {
  const extension = ALLOWED_CONTENT_TYPES[contentType];
  if (!extension) {
    throw new BadRequestError('Unsupported image content type', { contentType });
  }
  if (contentLength <= 0 || contentLength > MAX_CONTENT_LENGTH_BYTES) {
    throw new BadRequestError('Image exceeds the 10 MB upload limit');
  }

  const storageKey = `posts/${userId}/${crypto.randomUUID()}.${extension}`;

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
