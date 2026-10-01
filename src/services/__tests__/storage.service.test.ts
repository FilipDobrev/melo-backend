import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotFound, S3Client } from '@aws-sdk/client-s3';

vi.mock('../../config/env', () => ({
  env: {
    S3_BUCKET: 'melo-images',
    S3_REGION: 'us-east-1',
    S3_ACCESS_KEY_ID: 'test',
    S3_SECRET_ACCESS_KEY: 'test',
  },
}));

import { BadRequestError } from '../../lib/errors';
import { isOwnedKey, promoteUpload, readJpegDimensions } from '../storage.service';

/** SOI, an APP0 segment, then a frame header of the given SOF type declaring `width` x `height`. */
function buildJpeg(sofMarker: number, width: number, height: number): Uint8Array {
  return Uint8Array.from([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, sofMarker, 0x00, 0x11, 0x08,
    height >> 8, height & 0xff, width >> 8, width & 0xff,
    0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
  ]);
}

describe('readJpegDimensions', () => {
  it('reads dimensions from a baseline SOF0 frame', () => {
    expect(readJpegDimensions(buildJpeg(0xc0, 1200, 1600))).toEqual({ width: 1200, height: 1600 });
  });

  it('reads dimensions from a progressive SOF2 frame', () => {
    expect(readJpegDimensions(buildJpeg(0xc2, 800, 600))).toEqual({ width: 800, height: 600 });
  });

  it('skips APPn segments, fill bytes and standalone markers before the frame', () => {
    const bytes = Uint8Array.from([
      0xff, 0xd8,
      0xff, 0xe1, 0x00, 0x06, 0x01, 0x02, 0x03, 0x04, // APP1 with 4 payload bytes
      0xff, 0xff, 0xff, 0x01, // fill bytes, then TEM (standalone)
      0xff, 0xc4, 0x00, 0x04, 0xaa, 0xbb, // DHT must not be mistaken for a frame
      0xff, 0xc0, 0x00, 0x0b, 0x08, 0x01, 0x00, 0x02, 0x00, 0x01, 0x01, 0x11, 0x00,
    ]);
    expect(readJpegDimensions(bytes)).toEqual({ width: 512, height: 256 });
  });

  it('returns null for bytes that are not a JPEG', () => {
    expect(readJpegDimensions(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
    expect(readJpegDimensions(new Uint8Array(0))).toBeNull();
  });

  it('returns null when truncated before the frame header is complete', () => {
    const bytes = buildJpeg(0xc0, 100, 100);
    expect(readJpegDimensions(bytes.slice(0, 20))).toBeNull();
    expect(readJpegDimensions(bytes.slice(0, 26))).toBeNull();
  });

  it('returns null when the scan starts before any frame header', () => {
    const bytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02, 0x00, 0x00]);
    expect(readJpegDimensions(bytes)).toBeNull();
  });

  it('returns null for a segment with an impossible length', () => {
    const bytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x00, 0x00, 0x00]);
    expect(readJpegDimensions(bytes)).toBeNull();
  });
});

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const UPLOAD_ID = '33333333-3333-4333-8333-333333333333';

describe('isOwnedKey', () => {
  it('accepts an exact key for the owner and folder', () => {
    expect(isOwnedKey(`posts/${OWNER}/${UPLOAD_ID}.jpg`, 'posts', OWNER)).toBe(true);
  });

  it('rejects another folder, another owner, traversal and other extensions', () => {
    expect(isOwnedKey(`recipes/${OWNER}/${UPLOAD_ID}.jpg`, 'posts', OWNER)).toBe(false);
    expect(isOwnedKey(`posts/${OTHER}/${UPLOAD_ID}.jpg`, 'posts', OWNER)).toBe(false);
    expect(isOwnedKey(`posts/${OWNER}/../${OTHER}/${UPLOAD_ID}.jpg`, 'posts', OWNER)).toBe(false);
    expect(isOwnedKey(`posts/${OWNER}/${UPLOAD_ID}.png`, 'posts', OWNER)).toBe(false);
  });
});

describe('promoteUpload key validation', () => {
  const rejected: Array<[string, string]> = [
    ['another user upload', `uploads/${OTHER}/${UPLOAD_ID}.jpg`],
    ['a path traversal key', `uploads/${OWNER}/../${OTHER}/${UPLOAD_ID}.jpg`],
    ['a non-jpg extension', `uploads/${OWNER}/${UPLOAD_ID}.png`],
    ['an already attached key', `posts/${OWNER}/${UPLOAD_ID}.jpg`],
    ['a key with a trailing suffix', `uploads/${OWNER}/${UPLOAD_ID}.jpg.html`],
  ];

  it.each(rejected)('rejects %s before touching storage', async (_label, key) => {
    const send = vi.spyOn(S3Client.prototype, 'send');
    await expect(promoteUpload(key, OWNER, 'posts')).rejects.toBeInstanceOf(BadRequestError);
    expect(send).not.toHaveBeenCalled();
    send.mockRestore();
  });
});

describe('promoteUpload', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const uploadKey = `uploads/${OWNER}/${UPLOAD_ID}.jpg`;

  interface SentCommand {
    name: string;
    input: Record<string, unknown>;
  }

  function mockStorage(overrides: { contentType?: string; size?: number; jpeg?: Uint8Array } = {}): SentCommand[] {
    const sent: SentCommand[] = [];
    // send() has a callback overload typed as returning void, which trips this rule for a plain async stub.
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    vi.spyOn(S3Client.prototype, 'send').mockImplementation(async (command: unknown) => {
      const { constructor, input } = command as { constructor: { name: string }; input: Record<string, unknown> };
      sent.push({ name: constructor.name, input });
      switch (constructor.name) {
        case 'HeadObjectCommand':
          return {
            ContentLength: overrides.size ?? 1000,
            ContentType: overrides.contentType ?? 'image/jpeg',
            ETag: '"etag-1"',
          };
        case 'GetObjectCommand':
          return { Body: { transformToByteArray: async () => overrides.jpeg ?? buildJpeg(0xc0, 1200, 1600) } };
        default:
          return {};
      }
    });
    return sent;
  }

  it('copies a valid upload to its final key, pinned to the verified ETag, then deletes the staging copy', async () => {
    const sent = mockStorage();

    const finalKey = await promoteUpload(uploadKey, OWNER, 'posts');

    expect(finalKey).toBe(`posts/${OWNER}/${UPLOAD_ID}.jpg`);
    expect(sent.map((command) => command.name)).toEqual([
      'HeadObjectCommand',
      'GetObjectCommand',
      'CopyObjectCommand',
      'DeleteObjectCommand',
    ]);
    expect(sent[1]?.input).toMatchObject({ IfMatch: '"etag-1"' });
    expect(sent[2]?.input).toMatchObject({
      CopySource: `melo-images/${uploadKey}`,
      Key: finalKey,
      CopySourceIfMatch: '"etag-1"',
      MetadataDirective: 'REPLACE',
      ContentType: 'image/jpeg',
      ContentDisposition: 'inline',
    });
    expect(sent[3]?.input).toMatchObject({ Key: uploadKey });
  });

  it('still succeeds when deleting the staging copy fails', async () => {
    // send() has a callback overload typed as returning void, which trips this rule for a plain async stub.
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    vi.spyOn(S3Client.prototype, 'send').mockImplementation(async (command: unknown) => {
      const name = (command as { constructor: { name: string } }).constructor.name;
      if (name === 'HeadObjectCommand') return { ContentLength: 1000, ContentType: 'image/jpeg', ETag: '"e"' };
      if (name === 'GetObjectCommand') {
        return { Body: { transformToByteArray: async () => buildJpeg(0xc0, 100, 100) } };
      }
      if (name === 'DeleteObjectCommand') throw new Error('storage down');
      return {};
    });

    await expect(promoteUpload(uploadKey, OWNER, 'avatars')).resolves.toBe(`avatars/${OWNER}/${UPLOAD_ID}.jpg`);
  });

  it('maps a missing object to a 400', async () => {
    vi.spyOn(S3Client.prototype, 'send').mockRejectedValue(new NotFound({ message: 'nope', $metadata: {} }));
    await expect(promoteUpload(uploadKey, OWNER, 'posts')).rejects.toBeInstanceOf(BadRequestError);
  });

  it('rejects a non-jpeg stored content type', async () => {
    mockStorage({ contentType: 'text/html' });
    await expect(promoteUpload(uploadKey, OWNER, 'posts')).rejects.toBeInstanceOf(BadRequestError);
  });

  it('rejects an oversized object', async () => {
    mockStorage({ size: 3 * 1024 * 1024 });
    await expect(promoteUpload(uploadKey, OWNER, 'posts')).rejects.toBeInstanceOf(BadRequestError);
  });

  it('rejects an image whose long edge exceeds the limit', async () => {
    mockStorage({ jpeg: buildJpeg(0xc0, 4000, 3000) });
    await expect(promoteUpload(uploadKey, OWNER, 'posts')).rejects.toBeInstanceOf(BadRequestError);
  });

  it('rejects bytes that are not a jpeg', async () => {
    mockStorage({ jpeg: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]) });
    await expect(promoteUpload(uploadKey, OWNER, 'posts')).rejects.toBeInstanceOf(BadRequestError);
  });
});
