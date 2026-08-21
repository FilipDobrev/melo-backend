import { describe, expect, it } from 'vitest';
import {
  stripImageMetadata,
  stripJpegMetadata,
  stripPngMetadata,
  stripWebpMetadata,
} from '../imageMetadata';

/// Builds a minimal-but-valid JPEG: SOI, an APP0/JFIF segment (kept), an
/// optional APP1 (EXIF-carrying, stripped), an optional APP13 (IPTC,
/// stripped), a start-of-scan marker with a couple of bytes of fake
/// "compressed" scan data, and EOI. Real JPEGs are far more complex, but
/// verifyUploadedImage/stripJpegMetadata only ever look at marker segments
/// before SOS, so this is a faithful structural fixture.
function buildJpeg(options: { app1?: Buffer; app13?: Buffer } = {}): Buffer {
  const parts: Buffer[] = [Buffer.from([0xff, 0xd8])]; // SOI

  const jfifPayload = Buffer.from([0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);
  parts.push(segment(0xe0, jfifPayload)); // APP0/JFIF

  if (options.app1) parts.push(segment(0xe1, options.app1));
  if (options.app13) parts.push(segment(0xed, options.app13));

  parts.push(Buffer.from([0xff, 0xda, 0x00, 0x08, 0x03, 0x01, 0x00, 0x02, 0x11, 0x03])); // fake SOS header
  parts.push(Buffer.from([0x12, 0x34, 0x56])); // fake compressed scan data
  parts.push(Buffer.from([0xff, 0xd9])); // EOI

  return Buffer.concat(parts);
}

function segment(marker: number, payload: Buffer): Buffer {
  const length = payload.length + 2; // length field includes itself
  const header = Buffer.from([0xff, marker, (length >> 8) & 0xff, length & 0xff]);
  return Buffer.concat([header, payload]);
}

const EXIF_PAYLOAD = Buffer.concat([Buffer.from('Exif\0\0', 'ascii'), Buffer.from('fake-gps-coordinates-46.2N-6.1E')]);
const IPTC_PAYLOAD = Buffer.from('Photoshop 3.0\0fake-iptc-caption');

describe('stripJpegMetadata', () => {
  it('removes an APP1 (EXIF) segment while keeping APP0 and the scan data', () => {
    const input = buildJpeg({ app1: EXIF_PAYLOAD });
    const result = stripJpegMetadata(input);

    expect(result).not.toBeNull();
    expect(result!.changed).toBe(true);
    expect(result!.buffer.includes(EXIF_PAYLOAD)).toBe(false);
    expect(result!.buffer.readUInt16BE(0)).toBe(0xffd8); // still starts with SOI
    expect(result!.buffer.subarray(0, 4).equals(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe(true); // APP0 kept
    expect(result!.buffer.subarray(result!.buffer.length - 2).equals(Buffer.from([0xff, 0xd9]))).toBe(true); // EOI intact
  });

  it('removes both APP1 and APP13 segments', () => {
    const input = buildJpeg({ app1: EXIF_PAYLOAD, app13: IPTC_PAYLOAD });
    const result = stripJpegMetadata(input);

    expect(result!.changed).toBe(true);
    expect(result!.buffer.includes(EXIF_PAYLOAD)).toBe(false);
    expect(result!.buffer.includes(IPTC_PAYLOAD)).toBe(false);
  });

  it('returns the input unchanged when there is no metadata to strip', () => {
    const input = buildJpeg();
    const result = stripJpegMetadata(input);

    expect(result).not.toBeNull();
    expect(result!.changed).toBe(false);
    expect(result!.buffer).toBe(input); // same reference: no needless copy
  });

  it('returns null for bytes that are not a well-formed JPEG', () => {
    expect(stripJpegMetadata(Buffer.from('not a jpeg'))).toBeNull();
  });
});

/// Builds a minimal-but-valid PNG: signature, IHDR, an optional eXIf chunk,
/// an optional tEXt chunk, and IEND. CRCs are not validated by our stripper
/// (it only reads length + type to find chunk boundaries), so arbitrary
/// placeholder CRC bytes are fine here.
function buildPng(options: { exif?: Buffer; text?: Buffer } = {}): Buffer {
  const parts: Buffer[] = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])];

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(1, 0); // width
  ihdrData.writeUInt32BE(1, 4); // height
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 6; // color type (RGBA)
  parts.push(pngChunk('IHDR', ihdrData));

  if (options.exif) parts.push(pngChunk('eXIf', options.exif));
  if (options.text) parts.push(pngChunk('tEXt', options.text));

  parts.push(pngChunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4); // placeholder: our stripper doesn't validate CRCs
  return Buffer.concat([length, Buffer.from(type, 'ascii'), data, crc]);
}

const PNG_EXIF_DATA = Buffer.from('fake-exif-gps-46.2N-6.1E');
const PNG_TEXT_DATA = Buffer.concat([Buffer.from('Comment\0', 'ascii'), Buffer.from('taken at home')]);

describe('stripPngMetadata', () => {
  it('removes an eXIf chunk and a tEXt chunk', () => {
    const input = buildPng({ exif: PNG_EXIF_DATA, text: PNG_TEXT_DATA });
    const result = stripPngMetadata(input);

    expect(result).not.toBeNull();
    expect(result!.changed).toBe(true);
    expect(result!.buffer.includes(PNG_EXIF_DATA)).toBe(false);
    expect(result!.buffer.includes(PNG_TEXT_DATA)).toBe(false);
    expect(result!.buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(
      true,
    );
    expect(result!.buffer.includes('IHDR')).toBe(true);
    expect(result!.buffer.includes('IEND')).toBe(true);
  });

  it('returns the input unchanged when there is no metadata to strip', () => {
    const input = buildPng();
    const result = stripPngMetadata(input);

    expect(result!.changed).toBe(false);
    expect(result!.buffer).toBe(input);
  });

  it('returns null for bytes that are not a well-formed PNG', () => {
    expect(stripPngMetadata(Buffer.from('not a png'))).toBeNull();
  });
});

/// Builds a minimal-but-valid WebP (VP8L lossless is simplest to fake since
/// this stripper never inspects chunk payloads beyond EXIF/XMP, only chunk
/// boundaries), with an optional EXIF chunk.
function buildWebp(options: { exif?: Buffer } = {}): Buffer {
  const vp8lData = Buffer.from([0x2f, 0x00, 0x00, 0x00, 0x00]); // arbitrary odd-length fake payload
  const chunks: Buffer[] = [riffChunk('VP8L', vp8lData)];
  if (options.exif) chunks.push(riffChunk('EXIF', options.exif));

  const payload = Buffer.concat([Buffer.from('WEBP', 'ascii'), ...chunks]);
  const sizeField = Buffer.alloc(4);
  sizeField.writeUInt32LE(payload.length, 0);
  return Buffer.concat([Buffer.from('RIFF', 'ascii'), sizeField, payload]);
}

function riffChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32LE(data.length, 0);
  const padding = data.length % 2 === 1 ? Buffer.from([0x00]) : Buffer.alloc(0);
  return Buffer.concat([Buffer.from(type, 'ascii'), length, data, padding]);
}

const WEBP_EXIF_DATA = Buffer.from('fake-exif-gps-46.2N-6.1E-odd'); // odd length, exercises padding

describe('stripWebpMetadata', () => {
  it('removes an EXIF chunk and corrects the RIFF size field', () => {
    const input = buildWebp({ exif: WEBP_EXIF_DATA });
    const result = stripWebpMetadata(input);

    expect(result).not.toBeNull();
    expect(result!.changed).toBe(true);
    expect(result!.buffer.includes(WEBP_EXIF_DATA)).toBe(false);
    expect(result!.buffer.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(result!.buffer.subarray(8, 12).toString('ascii')).toBe('WEBP');

    const declaredSize = result!.buffer.readUInt32LE(4);
    expect(declaredSize).toBe(result!.buffer.length - 8); // RIFF size excludes "RIFF" + the size field itself
  });

  it('returns the input unchanged when there is no metadata to strip', () => {
    const input = buildWebp();
    const result = stripWebpMetadata(input);

    expect(result!.changed).toBe(false);
    expect(result!.buffer).toBe(input);
  });

  it('returns null for bytes that are not a well-formed WebP', () => {
    expect(stripWebpMetadata(Buffer.from('not a webp'))).toBeNull();
  });
});

describe('stripImageMetadata', () => {
  it('dispatches to the right stripper based on content type', () => {
    const jpeg = stripImageMetadata('image/jpeg', buildJpeg({ app1: EXIF_PAYLOAD }));
    expect(jpeg!.changed).toBe(true);

    const png = stripImageMetadata('image/png', buildPng({ exif: PNG_EXIF_DATA }));
    expect(png!.changed).toBe(true);

    const webp = stripImageMetadata('image/webp', buildWebp({ exif: WEBP_EXIF_DATA }));
    expect(webp!.changed).toBe(true);
  });

  it('returns null for an unsupported content type', () => {
    expect(stripImageMetadata('image/gif', Buffer.from('GIF89a'))).toBeNull();
  });
});
