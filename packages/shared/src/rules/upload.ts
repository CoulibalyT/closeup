import { UPLOAD, type UploadError } from '../schemas/admin.js';

export type SniffedFormat = (typeof UPLOAD.formats)[number];

const startsWith = (bytes: Uint8Array, signature: number[], offset = 0) =>
  signature.every((byte, i) => bytes[offset + i] === byte);

/**
 * The format according to the first bytes of the file. The file name and the `Content-Type` sent
 * by the browser are claims; this is evidence. The worker decodes the image afterwards, which
 * is the real test: this one only turns away what is obviously not a picture, cheaply.
 */
export function sniffImageFormat(head: Uint8Array): SniffedFormat | null {
  if (startsWith(head, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  // "RIFF" <size> "WEBP"
  if (startsWith(head, [0x52, 0x49, 0x46, 0x46]) && startsWith(head, [0x57, 0x45, 0x42, 0x50], 8)) {
    return 'webp';
  }
  return null;
}

/** First gate of an upload, before anything is stored. `null` lets the file through. */
export function checkUpload(file: {
  size: number;
  head: Uint8Array;
  rightsConfirmed: boolean;
}): UploadError | null {
  if (!file.rightsConfirmed) return 'RIGHTS_NOT_CONFIRMED';
  if (file.size > UPLOAD.maxBytes) return 'TOO_LARGE';
  if (file.size === 0 || !sniffImageFormat(file.head)) return 'UNSUPPORTED_TYPE';
  return null;
}

/** Second gate, in the worker, once the image has been decoded. */
export function checkDecodedImage(meta: {
  format?: string;
  width?: number;
  height?: number;
  pages?: number;
}): UploadError | null {
  if (!meta.width || !meta.height) return 'UNREADABLE';
  if (!(UPLOAD.formats as readonly string[]).includes(meta.format ?? '')) return 'UNSUPPORTED_TYPE';
  if ((meta.pages ?? 1) > 1) return 'ANIMATED';
  if (Math.min(meta.width, meta.height) < UPLOAD.minSidePx) return 'TOO_SMALL';
  return null;
}
