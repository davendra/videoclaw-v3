import { readFile } from 'node:fs/promises';

export interface ImageDimensions {
  width: number;
  height: number;
  format: 'png' | 'jpeg';
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function readPngDimensions(buffer: Buffer): ImageDimensions | null {
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return null;
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    format: 'png',
  };
}

function readJpegDimensions(buffer: Buffer): ImageDimensions | null {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    return null;
  }

  let offset = 2;
  while (offset < buffer.length) {
    while (buffer[offset] === 0xff) {
      offset += 1;
    }
    const marker = buffer[offset];
    offset += 1;

    if (marker === undefined || marker === 0xd9 || marker === 0xda) {
      break;
    }
    if (offset + 2 > buffer.length) {
      break;
    }
    const segmentLength = buffer.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > buffer.length) {
      break;
    }

    const isStartOfFrame =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc;
    if (isStartOfFrame && segmentLength >= 7) {
      return {
        height: buffer.readUInt16BE(offset + 3),
        width: buffer.readUInt16BE(offset + 5),
        format: 'jpeg',
      };
    }

    offset += segmentLength;
  }

  return null;
}

export async function readImageDimensions(path: string): Promise<ImageDimensions | null> {
  const buffer = await readFile(path);
  return readPngDimensions(buffer) ?? readJpegDimensions(buffer);
}
