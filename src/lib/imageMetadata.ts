/**
 * Server-side EXIF/IPTC/XMP metadata stripping for uploaded images.
 *
 * This is byte surgery, not re-encoding: metadata lives in removable
 * container segments (JPEG marker segments, PNG chunks, WebP RIFF chunks),
 * so it can be cut out of the container without touching the compressed
 * pixel data at all. That avoids both the quality loss and the CPU cost of
 * decoding + re-encoding, and it means we don't need an image-processing
 * dependency for something this mechanical.
 *
 * Every format-specific function is a pure byte transform that returns:
 *   - `{ buffer: input, changed: false }` if the container parsed fine but
 *     had nothing to strip (the input is returned as-is, unchanged),
 *   - `{ buffer: <new buffer>, changed: true }` if metadata segments were
 *     removed,
 *   - `null` if the bytes could not be parsed as that format's container
 *     structure at all.
 *
 * Callers decide what to do with `null`: storage.service treats it as a
 * non-fatal, log-and-move-on situation, since the magic-number check that
 * runs before this already proved the bytes are a genuine instance of the
 * declared content type - an unparseable container means our parser
 * doesn't yet cover some real-world variant, not that the upload is bad.
 */

export interface StripResult {
  buffer: Buffer;
  changed: boolean;
}

const JPEG_SOI = 0xffd8;
const JPEG_MARKER_PREFIX = 0xff;
const JPEG_APP1 = 0xe1; // EXIF, XMP
const JPEG_APP13 = 0xed; // IPTC / Photoshop
const JPEG_SOS = 0xda; // start of scan: everything after this is compressed data

/**
 * Strips APP1 (EXIF/XMP) and APP13 (IPTC/Photoshop) marker segments from a
 * JPEG. APP0 (JFIF) is structural and kept. Stops at the start-of-scan
 * marker and copies the rest of the file (the compressed scan data)
 * verbatim, since marker parsing does not apply inside entropy-coded data.
 */
export function stripJpegMetadata(input: Buffer): StripResult | null {
  if (input.length < 4 || input.readUInt16BE(0) !== JPEG_SOI) return null;

  const segments: Buffer[] = [input.subarray(0, 2)]; // SOI
  let offset = 2;
  let removedAny = false;

  while (offset < input.length) {
    if (input[offset] !== JPEG_MARKER_PREFIX) return null; // not a valid marker start

    // Markers can be padded with extra 0xFF fill bytes before the real marker byte.
    let markerOffset = offset;
    while (markerOffset < input.length && input[markerOffset] === JPEG_MARKER_PREFIX) {
      markerOffset += 1;
    }
    if (markerOffset >= input.length) return null;
    const marker: number = input[markerOffset] ?? 0;
    const markerStart = offset;
    offset = markerOffset + 1;

    // Markers with no payload (e.g. 0xD0-0xD7 restart markers, 0x01 TEM). Rare in a
    // freshly-uploaded JPEG's header but handled so an unexpected one doesn't crash us.
    if (marker >= 0xd0 && marker <= 0xd7) {
      segments.push(input.subarray(markerStart, offset));
      continue;
    }

    if (marker === JPEG_SOS) {
      // Everything from here to EOF is compressed scan data (plus a trailing EOI);
      // copy it verbatim rather than trying to parse it as more markers.
      segments.push(input.subarray(markerStart, input.length));
      offset = input.length;
      break;
    }

    if (offset + 2 > input.length) return null;
    const segmentLength = input.readUInt16BE(offset); // includes the 2 length bytes themselves
    const segmentEnd = offset + segmentLength;
    if (segmentLength < 2 || segmentEnd > input.length) return null;

    if (marker === JPEG_APP1 || marker === JPEG_APP13) {
      removedAny = true;
    } else {
      segments.push(input.subarray(markerStart, segmentEnd));
    }
    offset = segmentEnd;
  }

  if (!removedAny) return { buffer: input, changed: false };
  return { buffer: Buffer.concat(segments), changed: true };
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_STRIPPED_CHUNK_TYPES = new Set(['eXIf', 'tEXt', 'iTXt', 'zTXt']);

/**
 * Strips `eXIf`, `tEXt`, `iTXt` and `zTXt` chunks from a PNG. Every other
 * chunk (including ancillary ones like `tIME` or `pHYs`) is kept verbatim.
 * Per-chunk CRCs cover only that chunk's own type+data, so removing whole
 * chunks needs no CRC recalculation of anything that remains.
 */
export function stripPngMetadata(input: Buffer): StripResult | null {
  if (input.length < 8 || !input.subarray(0, 8).equals(PNG_SIGNATURE)) return null;

  const chunks: Buffer[] = [input.subarray(0, 8)];
  let offset = 8;
  let removedAny = false;

  while (offset < input.length) {
    if (offset + 8 > input.length) return null;
    const dataLength = input.readUInt32BE(offset);
    const type = input.toString('ascii', offset + 4, offset + 8);
    const chunkEnd = offset + 8 + dataLength + 4; // length + type + data + crc
    if (chunkEnd > input.length) return null;

    if (PNG_STRIPPED_CHUNK_TYPES.has(type)) {
      removedAny = true;
    } else {
      chunks.push(input.subarray(offset, chunkEnd));
    }
    offset = chunkEnd;
    if (type === 'IEND') break;
  }

  if (!removedAny) return { buffer: input, changed: false };
  return { buffer: Buffer.concat(chunks), changed: true };
}

const RIFF_TAG = Buffer.from('RIFF', 'ascii');
const WEBP_TAG = Buffer.from('WEBP', 'ascii');
const WEBP_STRIPPED_CHUNK_TYPES = new Set(['EXIF', 'XMP ']);

/**
 * Strips `EXIF` and `XMP ` chunks from a WebP RIFF container. Chunks are
 * padded to an even length (a trailing 0x00 pad byte when the declared
 * chunk size is odd), which must be dropped along with the chunk itself,
 * and the RIFF header's overall file-size field must be corrected to
 * reflect the bytes actually removed, or the result is a corrupt file.
 */
export function stripWebpMetadata(input: Buffer): StripResult | null {
  if (
    input.length < 12 ||
    !input.subarray(0, 4).equals(RIFF_TAG) ||
    !input.subarray(8, 12).equals(WEBP_TAG)
  ) {
    return null;
  }

  const chunks: Buffer[] = [input.subarray(8, 12)]; // "WEBP", RIFF size recomputed below
  let offset = 12;
  let removedAny = false;

  while (offset < input.length) {
    if (offset + 8 > input.length) return null;
    const type = input.toString('ascii', offset, offset + 4);
    const dataLength = input.readUInt32LE(offset + 4); // RIFF chunk sizes are little-endian
    const paddedLength = dataLength + (dataLength % 2);
    const chunkEnd = offset + 8 + paddedLength;
    if (chunkEnd > input.length) return null;

    if (WEBP_STRIPPED_CHUNK_TYPES.has(type)) {
      removedAny = true;
    } else {
      chunks.push(input.subarray(offset, chunkEnd));
    }
    offset = chunkEnd;
  }

  if (!removedAny) return { buffer: input, changed: false };

  const payload = Buffer.concat(chunks);
  const riffSize = payload.length; // byte count after the 4-byte RIFF size field itself
  const sizeField = Buffer.alloc(4);
  sizeField.writeUInt32LE(riffSize, 0);
  return { buffer: Buffer.concat([RIFF_TAG, sizeField, payload]), changed: true };
}

const METADATA_STRIPPERS: Record<string, (input: Buffer) => StripResult | null> = {
  'image/jpeg': stripJpegMetadata,
  'image/png': stripPngMetadata,
  'image/webp': stripWebpMetadata,
};

/**
 * Dispatches to the right format-specific stripper for `contentType`.
 * @returns `{ buffer, changed: false }` if there was nothing to remove (the
 * original buffer, unchanged), `{ buffer, changed: true }` if metadata was
 * removed, or `null` if the content type has no stripper or the bytes could
 * not be parsed as that format's container structure.
 */
export function stripImageMetadata(contentType: string, input: Buffer): StripResult | null {
  const strip = METADATA_STRIPPERS[contentType];
  if (!strip) return null;
  return strip(input);
}
