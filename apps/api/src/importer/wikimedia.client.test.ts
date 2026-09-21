import { describe, expect, it, vi } from 'vitest';
import { retryDelay, WikimediaHttpClient } from './wikimedia.client.js';

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

/** Answers in turn, one per call; an Error is thrown the way a network failure is. */
function replies(...answers: (Response | Error)[]) {
  return vi.fn<typeof fetch>(async () => {
    const next = answers.shift();
    if (!next) throw new Error('no more answers');
    if (next instanceof Error) throw next;
    return next;
  });
}

const sparqlBody = {
  results: {
    bindings: [
      {
        item: { value: 'http://www.wikidata.org/entity/Q140' },
        popularity: { value: '180' },
        file: { value: 'http://commons.wikimedia.org/wiki/Special:FilePath/Lion%20waiting.jpg' },
      },
      // Not an item: a malformed row is dropped rather than trusted.
      {
        item: { value: 'http://www.wikidata.org/entity/P18' },
        file: { value: 'x' },
      },
    ],
  },
};

describe('WikimediaHttpClient', () => {
  it('tries again after the delay the server asks for', async () => {
    const fetch = replies(json({}, 429, { 'retry-after': '2' }), json(sparqlBody));
    const sleep = vi.fn(async () => undefined);
    const client = new WikimediaHttpClient({ fetch, sleep });

    expect(await client.sparql('SELECT')).toEqual([
      { qid: 'Q140', popularity: 180, file: 'Lion waiting.jpg' },
    ]);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it('tries again after a network failure, and after a server error', async () => {
    const reset = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });
    const fetch = replies(reset, json({}, 502), json(sparqlBody));
    const sleep = vi.fn(async () => undefined);
    const rows = await new WikimediaHttpClient({ fetch, sleep }).sparql('SELECT');
    expect(rows).toHaveLength(1);
    expect(sleep.mock.calls).toEqual([[5000], [10000]]);
  });

  it('gives up on a client error at once, and says what happened', async () => {
    const fetch = replies(json({}, 400));
    const sleep = vi.fn(async () => undefined);
    await expect(new WikimediaHttpClient({ fetch, sleep }).sparql('SELECT')).rejects.toThrow(
      'query.wikidata.org did not answer (HTTP 400)',
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('gives up after its last attempt, without waiting after it', async () => {
    const fetch = replies(json({}, 504), json({}, 504), json({}, 504));
    const sleep = vi.fn(async () => undefined);
    const client = new WikimediaHttpClient({ fetch, sleep, attempts: 3 });
    await expect(client.sparql('SELECT')).rejects.toThrow('HTTP 504');
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('reads labels and aliases, and skips an item that does not exist', async () => {
    const fetch = replies(
      json({
        entities: {
          Q140: {
            labels: { fr: { value: 'lion' }, en: { value: 'lion' } },
            aliases: { fr: [{ value: 'Panthera leo' }] },
          },
          Q404: { missing: '' },
        },
      }),
    );
    const entities = await new WikimediaHttpClient({ fetch }).entities(['Q140', 'Q404']);
    expect([...entities.keys()]).toEqual(['Q140']);
    expect(entities.get('Q140')).toEqual({
      labels: { fr: 'lion', en: 'lion' },
      aliases: { fr: ['Panthera leo'], en: [] },
    });
  });

  it('finds each file under the name it was asked for, whatever Commons calls it', async () => {
    const fetch = replies(
      json({
        query: {
          normalized: [{ from: 'File:Lion_waiting.jpg', to: 'File:Lion waiting.jpg' }],
          pages: [
            {
              pageid: 7,
              title: 'File:Lion waiting.jpg',
              imageinfo: [
                {
                  url: 'https://upload.wikimedia.org/a/Lion_waiting.jpg',
                  thumburl: 'https://thumb.wikimedia.org/a/330px-Lion_waiting.jpg',
                  width: 3264,
                  height: 2448,
                  size: 4_000_000,
                  mime: 'image/jpeg',
                  extmetadata: { License: { value: 'pd' }, Artist: { value: 'Someone' } },
                },
              ],
            },
            // Deleted since: no page id, no picture.
            { title: 'File:Gone.jpg', missing: true },
          ],
        },
      }),
    );
    const files = await new WikimediaHttpClient({ fetch }).files(
      ['Lion_waiting.jpg', 'Gone.jpg'],
      330,
    );

    expect([...files.keys()]).toEqual(['Lion_waiting.jpg']);
    expect(files.get('Lion_waiting.jpg')).toMatchObject({
      pageId: 7,
      size: 4_000_000,
      metadata: { License: 'pd', Artist: 'Someone' },
    });
    // Posted, with the titles in the body rather than in a very long URL.
    const [, init] = fetch.mock.calls[0]!;
    expect(init?.method).toBe('POST');
    expect(String(init?.body)).toContain('titles=File%3ALion_waiting.jpg%7CFile%3AGone.jpg');
  });
});

describe('retryDelay', () => {
  it('follows the server within reason, and waits longer each time otherwise', () => {
    expect(retryDelay('3', 1)).toBe(3000);
    expect(retryDelay('3600', 1)).toBe(30_000);
    expect(retryDelay(null, 1)).toBe(5000);
    expect(retryDelay('soon', 3)).toBe(15_000);
  });
});
