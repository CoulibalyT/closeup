import { describe, expect, it, vi } from 'vitest';
import { downloadCommonsMedia, isCommonsMediaUrl } from './commons-download.js';

const JPEG = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1,
]);
const ORIGINAL = 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Lion.jpg';

/** A server that answers with these bytes, cut in chunks, announcing any length it likes. */
function server(bytes: Uint8Array, init: { status?: number; length?: number | null } = {}) {
  return vi.fn<typeof fetch>(async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let start = 0; start < bytes.length; start += 8) {
          controller.enqueue(bytes.subarray(start, start + 8));
        }
        controller.close();
      },
    });
    const headers = new Headers({ 'content-type': 'image/jpeg' });
    const length = init.length === undefined ? bytes.length : init.length;
    if (length !== null) headers.set('content-length', String(length));
    return new Response(stream, { status: init.status ?? 200, headers });
  });
}

describe('isCommonsMediaUrl', () => {
  it('accepts the two hosts where Commons keeps pictures, over HTTPS', () => {
    expect(isCommonsMediaUrl(ORIGINAL)).toBe(true);
    expect(
      isCommonsMediaUrl('https://thumb.wikimedia.org/wikipedia/commons/thumb/x/330px-x.jpg'),
    ).toBe(true);
  });

  it('refuses anything that could lead somewhere else', () => {
    for (const url of [
      'http://upload.wikimedia.org/a.jpg',
      'https://upload.wikimedia.org.example.com/a.jpg',
      'https://example.com/upload.wikimedia.org/a.jpg',
      'https://upload.wikimedia.org:8443/a.jpg',
      'https://user:secret@upload.wikimedia.org/a.jpg',
      'https://127.0.0.1/a.jpg',
      'https://commons.wikimedia.org/wiki/File:Lion.jpg',
      'file:///etc/passwd',
      'not a url',
    ]) {
      expect(isCommonsMediaUrl(url), url).toBe(false);
    }
  });
});

describe('downloadCommonsMedia', () => {
  it('returns the bytes of a picture, and refuses to follow a redirect', async () => {
    const fetch = server(JPEG);
    expect(await downloadCommonsMedia(ORIGINAL, { fetch })).toEqual(Buffer.from(JPEG));
    expect(fetch.mock.calls[0]![1]).toMatchObject({ redirect: 'error' });
  });

  it('never calls an address outside Commons', async () => {
    const fetch = server(JPEG);
    await expect(downloadCommonsMedia('https://example.com/a.jpg', { fetch })).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refuses a file announced as too large without reading it', async () => {
    const fetch = server(JPEG, { length: 50_000_000 });
    await expect(downloadCommonsMedia(ORIGINAL, { fetch, maxBytes: 1000 })).rejects.toThrow(
      'Too large',
    );
  });

  it('stops a file that grows past the limit when its length was not announced, or was a lie', async () => {
    const big = new Uint8Array(64).fill(1);
    big.set(JPEG);
    for (const length of [null, 10]) {
      const fetch = server(big, { length });
      await expect(downloadCommonsMedia(ORIGINAL, { fetch, maxBytes: 32 })).rejects.toThrow(
        'Too large',
      );
    }
  });

  it('refuses what is not a picture, and what Commons would not give', async () => {
    const html = new TextEncoder().encode('<!doctype html><title>Error</title>');
    await expect(downloadCommonsMedia(ORIGINAL, { fetch: server(html) })).rejects.toThrow(
      'Not a picture',
    );
    await expect(
      downloadCommonsMedia(ORIGINAL, { fetch: server(JPEG, { status: 404 }) }),
    ).rejects.toThrow('404');
  });
});
