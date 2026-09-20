import { describe, expect, it } from 'vitest';
import { UPLOAD } from '../schemas/admin.js';
import { checkDecodedImage, checkUpload, sniffImageFormat } from './upload.js';

const bytes = (...values: number[]) => Uint8Array.from(values);
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 0);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d);
const WEBP = bytes(0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x45, 0x42, 0x50);
const GIF = bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0);
// "<svg xmlns": a scriptable format that a renamed file could try to smuggle in.
const SVG = bytes(0x3c, 0x73, 0x76, 0x67, 0x20, 0x78, 0x6d, 0x6c, 0x6e, 0x73, 0x3d, 0x22);

describe('sniffImageFormat', () => {
  it('recognises the three accepted formats from their first bytes', () => {
    expect(sniffImageFormat(JPEG)).toBe('jpeg');
    expect(sniffImageFormat(PNG)).toBe('png');
    expect(sniffImageFormat(WEBP)).toBe('webp');
  });

  it('turns away everything else, scriptable formats included', () => {
    expect(sniffImageFormat(GIF)).toBeNull();
    expect(sniffImageFormat(SVG)).toBeNull();
    // A RIFF container that is not WebP (a WAV file).
    expect(
      sniffImageFormat(bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45)),
    ).toBeNull();
    expect(sniffImageFormat(bytes())).toBeNull();
  });
});

describe('checkUpload', () => {
  const file = { size: 2_000_000, head: JPEG, rightsConfirmed: true };

  it('lets a confirmed picture of a reasonable size through', () => {
    expect(checkUpload(file)).toBeNull();
  });

  it('asks for the confirmation of rights before anything else', () => {
    expect(checkUpload({ ...file, rightsConfirmed: false })).toBe('RIGHTS_NOT_CONFIRMED');
  });

  it('refuses a file over the limit, and an empty one', () => {
    expect(checkUpload({ ...file, size: UPLOAD.maxBytes + 1 })).toBe('TOO_LARGE');
    expect(checkUpload({ ...file, size: UPLOAD.maxBytes })).toBeNull();
    expect(checkUpload({ ...file, size: 0 })).toBe('UNSUPPORTED_TYPE');
  });

  it('does not believe a file name: a script renamed .jpg is refused on its bytes', () => {
    expect(checkUpload({ ...file, head: SVG })).toBe('UNSUPPORTED_TYPE');
  });
});

describe('checkDecodedImage', () => {
  it('accepts a still picture that is large enough', () => {
    expect(checkDecodedImage({ format: 'jpeg', width: 1600, height: 1200 })).toBeNull();
  });

  it('refuses what could not be decoded, animations and small pictures', () => {
    expect(checkDecodedImage({ format: 'jpeg' })).toBe('UNREADABLE');
    expect(checkDecodedImage({ format: 'gif', width: 800, height: 800 })).toBe('UNSUPPORTED_TYPE');
    expect(checkDecodedImage({ format: 'webp', width: 800, height: 800, pages: 12 })).toBe(
      'ANIMATED',
    );
    expect(checkDecodedImage({ format: 'png', width: 2000, height: 599 })).toBe('TOO_SMALL');
  });
});
