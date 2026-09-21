import { sniffImageFormat, UPLOAD } from '@closeup/shared';
import { WIKIMEDIA_USER_AGENT } from './user-agent.js';

/** Where Commons keeps originals and renditions. Nothing else is ever downloaded. */
const MEDIA_HOSTS = new Set(['upload.wikimedia.org', 'thumb.wikimedia.org']);

/**
 * The address comes from the Commons API, not from a person; it is checked all the same, so
 * that no bug and no odd answer can turn the worker into a way to reach something else
 * (an address on the server's own network, a plain-HTTP host).
 */
export function isCommonsMediaUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === 'https:' &&
      MEDIA_HOSTS.has(parsed.hostname) &&
      parsed.port === '' &&
      parsed.username === '' &&
      parsed.password === ''
    );
  } catch {
    return false;
  }
}

export interface DownloadOptions {
  fetch?: typeof fetch;
  maxBytes?: number;
  timeoutMs?: number;
}

/**
 * The bytes of one Commons picture, bounded: by host, by size as announced and as received
 * (a missing or wrong Content-Length must not let a larger file through), by time, and by what
 * the first bytes say the file is. A redirect is refused rather than followed somewhere else.
 */
export async function downloadCommonsMedia(
  url: string,
  options: DownloadOptions = {},
): Promise<Buffer> {
  const { fetch: get = globalThis.fetch, maxBytes = UPLOAD.maxBytes } = options;
  if (!isCommonsMediaUrl(url)) throw new Error('Not a Commons media address');

  const response = await get(url, {
    headers: { 'User-Agent': WIKIMEDIA_USER_AGENT },
    redirect: 'error',
    signal: AbortSignal.timeout(options.timeoutMs ?? 60_000),
  });
  if (!response.ok || !response.body) throw new Error(`Commons answered ${response.status}`);
  if (Number(response.headers.get('content-length')) > maxBytes) throw new Error('Too large');

  const chunks: Uint8Array[] = [];
  let received = 0;
  for await (const chunk of response.body) {
    received += chunk.length;
    // Leaving the loop cancels the stream: the rest of the file is never read.
    if (received > maxBytes) throw new Error('Too large');
    chunks.push(chunk);
  }

  const data = Buffer.concat(chunks);
  if (!sniffImageFormat(data.subarray(0, 16))) throw new Error('Not a picture');
  return data;
}
