import { downloadCommonsMedia } from './commons-download.js';
import { WIKIMEDIA_USER_AGENT } from './user-agent.js';

export const WIKIMEDIA = Symbol('WIKIMEDIA');

/** One subject found by a search: the item, how well known it is, and its main picture. */
export interface SparqlRow {
  qid: string;
  /** The number of Wikipedias with an article about it. */
  popularity: number;
  /** A Commons file name, without the "File:" prefix. */
  file: string;
}

export interface WikidataEntity {
  labels: { fr?: string; en?: string };
  aliases: { fr: string[]; en: string[] };
}

/** What makes a Wikidata item a person the importer can use. */
export interface PersonFacts {
  /** An instance of "human" (Q5). */
  human: boolean;
  /** Its main picture (P18), a Commons file name. */
  file: string | null;
  /** The number of Wikipedias with an article about it. */
  popularity: number;
  /** An article on the French Wikipedia: known to the players. */
  frenchArticle: boolean;
  /** "footballeur français", in French when there is one. */
  description: string | null;
  /** The item of their family name (P734), whose label is the alias. */
  familyNameQid: string | null;
}

export interface CommonsFile {
  pageId: number;
  /** The original. */
  url: string;
  /** The rendition at the width asked for, when there is one. */
  thumbUrl: string | null;
  width: number;
  height: number;
  /** Bytes of the original. */
  size: number;
  mime: string;
  /** Commons' "extmetadata", values only: Artist, License, LicenseShortName, Restrictions… */
  metadata: Record<string, string>;
}

/** Everything the importer asks of Wikimedia, downloads included. The tests hand it a fake. */
export interface WikimediaApi {
  sparql(query: string): Promise<SparqlRow[]>;
  entities(qids: string[]): Promise<Map<string, WikidataEntity>>;
  people(qids: string[]): Promise<Map<string, PersonFacts>>;
  /** Items whose name matches, best first: humans or not, the caller checks. */
  searchHumans(name: string): Promise<string[]>;
  /** Keyed by the name given, whatever Commons normalised it to. */
  files(names: string[], thumbWidth: number): Promise<Map<string, CommonsFile>>;
  /** The bytes of a picture at a Commons media address (see `downloadCommonsMedia`). */
  download(url: string): Promise<Buffer>;
}

const METADATA = [
  'Artist',
  'License',
  'LicenseShortName',
  'LicenseUrl',
  'AttributionRequired',
  'Restrictions',
];
/** The Action API takes fifty titles or ids per call. */
const BATCH = 50;

export interface HttpOptions {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  attempts?: number;
}

/**
 * The public services, with the patience they need. The query service was seen answering the
 * same query in 5 s and in 60 s, and refusing with 429, 500, 502 and 504 within the same hour;
 * a network timeout happens too. Each of those is tried again, after the delay the server asks
 * for when it gives one. Any other 4xx is final: asking again will not change the answer.
 */
export class WikimediaHttpClient implements WikimediaApi {
  private readonly fetch: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly attempts: number;

  constructor(options: HttpOptions = {}) {
    this.fetch = options.fetch ?? globalThis.fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.attempts = options.attempts ?? 4;
  }

  async sparql(query: string): Promise<SparqlRow[]> {
    const body = (await this.request(
      'https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(query),
      'application/sparql-results+json',
    )) as { results?: { bindings?: Record<string, { value: string } | undefined>[] } };

    return (body.results?.bindings ?? []).flatMap((row) => {
      const qid = row.item?.value.split('/').pop() ?? '';
      const file = row.file?.value.split('/Special:FilePath/').pop();
      if (!/^Q\d+$/.test(qid) || !file) return [];
      return [
        { qid, popularity: Number(row.popularity?.value ?? 0), file: decodeURIComponent(file) },
      ];
    });
  }

  async entities(qids: string[]): Promise<Map<string, WikidataEntity>> {
    const found = new Map<string, WikidataEntity>();
    for (const ids of batches(qids)) {
      const body = (await this.request(
        'https://www.wikidata.org/w/api.php?action=wbgetentities&format=json' +
          '&props=labels|aliases&languages=fr|en&ids=' +
          ids.join('|'),
      )) as { entities?: Record<string, RawEntity> };
      for (const [id, entity] of Object.entries(body.entities ?? {})) {
        if (entity.missing !== undefined) continue;
        found.set(id, {
          labels: { fr: entity.labels?.fr?.value, en: entity.labels?.en?.value },
          aliases: {
            fr: (entity.aliases?.fr ?? []).map((alias) => alias.value),
            en: (entity.aliases?.en ?? []).map((alias) => alias.value),
          },
        });
      }
    }
    return found;
  }

  async people(qids: string[]): Promise<Map<string, PersonFacts>> {
    const found = new Map<string, PersonFacts>();
    for (const ids of batches(qids)) {
      const body = (await this.request(
        'https://www.wikidata.org/w/api.php?action=wbgetentities&format=json' +
          '&props=' +
          encodeURIComponent('claims|sitelinks|descriptions') +
          '&languages=fr|en&ids=' +
          ids.join('|'),
      )) as { entities?: Record<string, RawPerson> };
      for (const [id, entity] of Object.entries(body.entities ?? {})) {
        if (entity.missing !== undefined) continue;
        const values = (property: string) =>
          (entity.claims?.[property] ?? []).map((claim) => claim.mainsnak?.datavalue?.value);
        const file = values('P18')[0];
        const family = values('P734')[0];
        const sitelinks = entity.sitelinks ?? {};
        found.set(id, {
          human: values('P31').some((value) => itemId(value) === 'Q5'),
          file: typeof file === 'string' ? file : null,
          popularity: Object.keys(sitelinks).length,
          frenchArticle: 'frwiki' in sitelinks,
          description: entity.descriptions?.fr?.value ?? entity.descriptions?.en?.value ?? null,
          familyNameQid: itemId(family),
        });
      }
    }
    return found;
  }

  async searchHumans(name: string): Promise<string[]> {
    const body = (await this.request(
      'https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&type=item' +
        '&language=fr&uselang=fr&limit=7&search=' +
        encodeURIComponent(name),
    )) as { search?: { id: string }[] };
    return (body.search ?? []).map((hit) => hit.id).filter((id) => /^Q\d+$/.test(id));
  }

  async files(names: string[], thumbWidth: number): Promise<Map<string, CommonsFile>> {
    const found = new Map<string, CommonsFile>();
    for (const group of batches(names)) {
      // POST: fifty long file names do not fit in a URL every proxy accepts.
      const form = new URLSearchParams({
        action: 'query',
        format: 'json',
        formatversion: '2',
        prop: 'imageinfo',
        iiprop: 'url|size|mime|extmetadata',
        iiurlwidth: String(thumbWidth),
        iiextmetadatafilter: METADATA.join('|'),
        titles: group.map((name) => `File:${name}`).join('|'),
      });
      const body = (await this.request(
        'https://commons.wikimedia.org/w/api.php',
        'application/json',
        form,
      )) as RawImageQuery;

      // Commons answers under its own spelling of each title ("_" becomes " ", and so on).
      const spelled = new Map(
        (body.query?.normalized ?? []).map((pair) => [pair.from, pair.to] as const),
      );
      const pages = new Map((body.query?.pages ?? []).map((page) => [page.title, page]));
      for (const name of group) {
        const page = pages.get(spelled.get(`File:${name}`) ?? `File:${name}`);
        const info = page?.imageinfo?.[0];
        if (!page?.pageid || !info?.url) continue;
        found.set(name, {
          pageId: page.pageid,
          url: info.url,
          thumbUrl: info.thumburl ?? null,
          width: info.width ?? 0,
          height: info.height ?? 0,
          size: info.size ?? 0,
          mime: info.mime ?? '',
          metadata: Object.fromEntries(
            Object.entries(info.extmetadata ?? {}).map(([key, entry]) => [
              key,
              String(entry.value),
            ]),
          ),
        });
      }
    }
    return found;
  }

  download(url: string): Promise<Buffer> {
    return downloadCommonsMedia(url, { fetch: this.fetch });
  }

  private async request(url: string, accept = 'application/json', form?: URLSearchParams) {
    let failure = '';
    for (let attempt = 1; attempt <= this.attempts; attempt++) {
      let retryAfter: string | null = null;
      try {
        const response = await this.fetch(url, {
          method: form ? 'POST' : 'GET',
          body: form,
          headers: { 'User-Agent': WIKIMEDIA_USER_AGENT, Accept: accept },
          // The query service gives up on a query at 60 s: wait a little longer than that.
          signal: AbortSignal.timeout(70_000),
        });
        if (response.ok) return (await response.json()) as unknown;
        failure = `HTTP ${response.status}`;
        if (response.status !== 429 && response.status < 500) break;
        retryAfter = response.headers.get('retry-after');
      } catch (error) {
        const cause = (error as { cause?: { code?: string } }).cause?.code;
        failure = cause ?? (error instanceof Error ? error.name : String(error));
      }
      if (attempt < this.attempts) await this.sleep(retryDelay(retryAfter, attempt));
    }
    throw new Error(`${new URL(url).host} did not answer (${failure})`);
  }
}

/** What the server asks for, within reason; otherwise 5 s, then 10, then 15. */
export function retryDelay(retryAfter: string | null, attempt: number): number {
  const asked = Number(retryAfter);
  const seconds = Number.isFinite(asked) && asked > 0 ? Math.min(asked, 30) : 5 * attempt;
  return seconds * 1000;
}

function batches<T>(items: T[]): T[][] {
  const groups: T[][] = [];
  for (let start = 0; start < items.length; start += BATCH) {
    groups.push(items.slice(start, start + BATCH));
  }
  return groups;
}

/** The id of an item a claim points to (`{ id: "Q5" }`), or null for anything else. */
function itemId(value: unknown): string | null {
  const id = (value as { id?: unknown } | null | undefined)?.id;
  return typeof id === 'string' ? id : null;
}

interface RawPerson {
  missing?: string;
  descriptions?: Record<string, { value: string } | undefined>;
  sitelinks?: Record<string, unknown>;
  claims?: Record<string, { mainsnak?: { datavalue?: { value?: unknown } } }[] | undefined>;
}

interface RawEntity {
  missing?: string;
  labels?: Record<string, { value: string } | undefined>;
  aliases?: Record<string, { value: string }[] | undefined>;
}

interface RawImageQuery {
  query?: {
    normalized?: { from: string; to: string }[];
    pages?: {
      pageid?: number;
      title: string;
      imageinfo?: {
        url?: string;
        thumburl?: string;
        width?: number;
        height?: number;
        size?: number;
        mime?: string;
        extmetadata?: Record<string, { value: unknown }>;
      }[];
    }[];
  };
}
