import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { env } from '../../src/config/env';
import { app } from './helpers/testApp';
import { authHeader, createRecipe, getUploadUrl, putToPresignedUrl, registerUser } from './helpers/factories';

/// A JPEG carrying a real APP1/EXIF segment: SOI, an APP0/JFIF segment
/// (kept - it's structural), an APP1 segment whose payload contains a
/// recognisable marker string standing in for GPS/EXIF data, a start-of-scan
/// header, a couple of bytes of fake compressed scan data, and EOI. This is
/// enough to exercise the real marker-segment parsing in
/// stripJpegMetadata via the full presigned-upload -> attach -> storage
/// round trip, without needing a real photo file in the repo.
const EXIF_MARKER = 'GPS-46.2N-6.1E-fake-home-coordinates';

function jpegSegment(marker: number, payload: Buffer): Buffer {
  const length = payload.length + 2;
  return Buffer.concat([Buffer.from([0xff, marker, (length >> 8) & 0xff, length & 0xff]), payload]);
}

function buildJpegWithExif(): Buffer {
  const jfifPayload = Buffer.from([0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);
  const exifPayload = Buffer.concat([Buffer.from('Exif\0\0', 'ascii'), Buffer.from(EXIF_MARKER)]);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]), // SOI
    jpegSegment(0xe0, jfifPayload), // APP0/JFIF - kept
    jpegSegment(0xe1, exifPayload), // APP1/EXIF - must be stripped
    Buffer.from([0xff, 0xda, 0x00, 0x08, 0x03, 0x01, 0x00, 0x02, 0x11, 0x03]), // SOS
    Buffer.from([0x12, 0x34, 0x56]), // fake compressed scan data
    Buffer.from([0xff, 0xd9]), // EOI
  ]);
}

const rawS3Client = new S3Client({
  region: env.S3_REGION,
  endpoint: env.S3_ENDPOINT,
  forcePathStyle: Boolean(env.S3_ENDPOINT),
  credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
});

async function fetchStoredObject(storageKey: string): Promise<Buffer> {
  const object = await rawS3Client.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: storageKey }));
  return Buffer.from((await object.Body?.transformToByteArray()) ?? new Uint8Array(0));
}

describe('server-side image metadata stripping', () => {
  it('strips the EXIF segment from a real uploaded JPEG once it is attached to a post', async () => {
    const owner = await registerUser(app);
    const recipe = await createRecipe(app, owner.accessToken);
    const jpegWithExif = buildJpegWithExif();

    const reserved = await getUploadUrl(app, owner.accessToken, 'posts', 'image/jpeg', jpegWithExif.length);
    await putToPresignedUrl(reserved.uploadUrl, 'image/jpeg', jpegWithExif);

    // Sanity check: the EXIF payload really is present before attach-time stripping runs.
    const beforeAttach = await fetchStoredObject(reserved.storageKey);
    expect(beforeAttach.includes(EXIF_MARKER)).toBe(true);

    const res = await request(app)
      .post('/api/v1/posts')
      .set(...authHeader(owner.accessToken))
      .send({ caption: 'a photo with embedded location', recipeId: recipe.id, imageKeys: [reserved.storageKey] });
    expect(res.status).toBe(201);

    const stripped = await fetchStoredObject(reserved.storageKey);
    expect(stripped.includes(EXIF_MARKER)).toBe(false);
    expect(stripped.readUInt16BE(0)).toBe(0xffd8); // still a valid, viewable JPEG: starts with SOI
    expect(stripped.subarray(stripped.length - 2).equals(Buffer.from([0xff, 0xd9]))).toBe(true); // EOI intact
  });
});
