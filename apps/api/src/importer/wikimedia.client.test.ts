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

describe('person facts', () => {
  it('reads the claims, sitelinks and description of an item', async () => {
    const fetch = replies(
      json({
        entities: {
          Q1: {
            descriptions: { fr: { value: 'acteur français' } },
            sitelinks: { frwiki: {}, enwiki: {}, dewiki: {} },
            claims: {
              P31: [{ mainsnak: { datavalue: { value: { id: 'Q5' } } } }],
              P18: [{ mainsnak: { datavalue: { value: 'Omar Sy 2012.jpg' } } }],
              P734: [{ mainsnak: { datavalue: { value: { id: 'Q42' } } } }],
            },
          },
          Q2: { descriptions: {}, sitelinks: { enwiki: {} }, claims: {} },
        },
      }),
    );
    const client = new WikimediaHttpClient({ fetch, sleep: async () => undefined });
    const facts = await client.people(['Q1', 'Q2']);
    expect(facts.get('Q1')).toEqual({
      human: true,
      file: 'Omar Sy 2012.jpg',
      popularity: 3,
      frenchArticle: true,
      description: 'acteur français',
      familyNameQid: 'Q42',
    });
    expect(facts.get('Q2')).toMatchObject({ human: false, file: null, frenchArticle: false });
    expect(String(fetch.mock.calls[0]![0])).toContain('props=claims%7Csitelinks%7Cdescriptions');
  });

  it('searches items by name in French, best match first', async () => {
    const fetch = replies(json({ search: [{ id: 'Q1' }, { id: 'Q7' }, { id: 'P31' }] }));
    const client = new WikimediaHttpClient({ fetch, sleep: async () => undefined });
    expect(await client.searchHumans('Omar Sy')).toEqual(['Q1', 'Q7']);
    const url = String(fetch.mock.calls[0]![0]);
    expect(url).toContain('action=wbsearchentities');
    expect(url).toContain('search=Omar%20Sy');
  });
});

describe('labels', () => {
  it('falls back on the multilingual label Wikidata now gives most people', async () => {
    const fetch = replies(
      json({
        entities: {
          Q692: {
            labels: { mul: { value: 'William Shakespeare' }, en: { value: 'William Shakespeare' } },
            aliases: { mul: [{ value: 'Shakespeare' }] },
          },
        },
      }),
    );
    const client = new WikimediaHttpClient({ fetch, sleep: async () => undefined });
    expect((await client.entities(['Q692'])).get('Q692')).toEqual({
      labels: { fr: 'William Shakespeare', en: 'William Shakespeare' },
      aliases: { fr: ['Shakespeare'], en: ['Shakespeare'] },
    });
    expect(String(fetch.mock.calls[0]![0])).toContain('languages=fr|en|mul');
  });

  it('leaves the multilingual label aside when asked: for a thing it is the Latin name', async () => {
    const fetch = replies(
      json({
        entities: {
          Q830: {
            labels: { mul: { value: 'Bos taurus' }, en: { value: 'cattle' } },
            aliases: { mul: [{ value: 'Bos primigenius taurus' }], en: [{ value: 'cow' }] },
          },
        },
      }),
    );
    const client = new WikimediaHttpClient({ fetch, sleep: async () => undefined });
    expect((await client.entities(['Q830'], { mul: false })).get('Q830')).toEqual({
      labels: { fr: undefined, en: 'cattle' },
      aliases: { fr: [], en: ['cow'] },
    });
  });
});

describe('a query that ran out of time', () => {
  it('is not tried again: the query service would stop it at 60 s once more', async () => {
    const fetch = replies(json({}, 504), json(sparqlBody));
    let clock = 0;
    const client = new WikimediaHttpClient({
      fetch: vi.fn<typeof globalThis.fetch>(async (...args) => {
        clock += 61_000;
        return fetch(...args);
      }),
      sleep: async () => undefined,
      now: () => clock,
    });
    await expect(client.sparql('SELECT')).rejects.toThrow('HTTP 504');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('is tried again when the failure came quickly', async () => {
    const fetch = replies(json({}, 504), json(sparqlBody));
    const client = new WikimediaHttpClient({ fetch, sleep: async () => undefined, now: () => 0 });
    expect(await client.sparql('SELECT')).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe('subject facts', () => {
  it('reads what an item is, its taxon name and its description', async () => {
    const fetch = replies(
      json({
        entities: {
          Q140: {
            descriptions: { fr: { value: 'grand félin' }, en: { value: 'big cat' } },
            claims: {
              P31: [{ mainsnak: { datavalue: { value: { id: 'Q55983715' } } } }],
              P279: [{ mainsnak: { datavalue: { value: { id: 'Q25265' } } } }],
              P225: [{ mainsnak: { datavalue: { value: 'Panthera leo' } } }],
            },
          },
        },
      }),
    );
    const client = new WikimediaHttpClient({ fetch, sleep: async () => undefined });
    expect((await client.subjects(['Q140'])).get('Q140')).toEqual({
      instanceOf: ['Q55983715'],
      subclassOf: ['Q25265'],
      taxonName: 'Panthera leo',
      description: { fr: 'grand félin', en: 'big cat' },
    });
  });
});
