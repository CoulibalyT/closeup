import { z } from 'zod';
import { answerFrom } from '../candidates.js';

/**
 * The owner's dataset (`data/celebrities/manifest.json`, built outside the app): what an entry
 * says, and where it goes. Pure: the importer service does the reading and the writing.
 */
export const DATASET_CATEGORIES = [
  'acteur',
  'chanteur',
  'sportif',
  'tele',
  'culture',
  'fiction',
  'enfants',
] as const;
/** Real people: their pictures come from Commons and need a free licence. */
const PEOPLE: readonly DatasetCategory[] = ['acteur', 'chanteur', 'sportif', 'tele', 'culture'];
/** Below this width a face gives no close-up worth playing (the dataset measures it). */
export const MIN_FACE_PX = 150;
export type DatasetCategory = (typeof DATASET_CATEGORIES)[number];

const entrySchema = z.looseObject({
  id: z.string().min(1),
  name: z.string().min(1),
  category: z.enum(DATASET_CATEGORIES),
  image: z.string().min(1),
  source: z.enum(['fandom', 'wikipedia']).optional(),
  wiki: z.string().optional(),
  source_url: z.string(),
  page_url: z.string(),
  page_title: z.string(),
  tags: z.array(z.string()).optional(),
  /** The Commons file of a replaced picture: the truth when it disagrees with `source_url`. */
  file: z.string().optional(),
  /** The Commons file of the main photo ("File:…"), when the dataset knows it. */
  commons_file: z.string().optional(),
  /** The person's Wikidata item: the exact identity, when the dataset knows it. */
  wikidata: z.string().nullish(),
  /** The answer, cleaned of its qualifier; else derived from the name. */
  answer: z.string().optional(),
  /** Other accepted spellings and nicknames. */
  aliases: z.array(z.string()).optional(),
  /** The English name when it differs. */
  name_en: z.string().nullish(),
  /** A character's universe, in French ("La Pat' Patrouille"): its hint. */
  universe: z.string().nullish(),
  /** Width of the largest face on the picture, real people only. */
  face_px: z.number().optional(),
  /** Several photos of a person, the main one first: one card each. */
  images: z
    .array(
      z.looseObject({
        file: z.string().min(1),
        face_px: z.number().optional(),
        source_url: z.string().optional(),
        page_url: z.string().optional(),
        commons_file: z.string().optional(),
      }),
    )
    .optional(),
});
export type DatasetEntry = z.infer<typeof entrySchema>;

export function parseManifest(json: unknown): DatasetEntry[] {
  if (!Array.isArray(json)) throw new Error('manifest.json: an array of entries is expected');
  return json.map((raw, index) => {
    const parsed = entrySchema.safeParse(raw);
    if (parsed.success) return parsed.data;
    const id = (raw as { id?: unknown })?.id;
    throw new Error(
      `manifest.json, entry ${index} (${String(id ?? '?')}): ${parsed.error.issues
        .map((issue) => `${issue.path.join('.')} ${issue.message}`)
        .join('; ')}`,
    );
  });
}

export type DatasetPackKey = DatasetCategory;

export const DATASET_PACKS: Record<
  DatasetPackKey,
  {
    slug: string;
    titleFr: string;
    titleEn: string;
    category: 'CELEBRITY' | 'CHARACTER';
    /** The owner's player's, private and locked; else a house pack, published and restricted. */
    private: boolean;
  }
> = {
  acteur: {
    slug: 'ds-acteur',
    titleFr: 'Acteurs & actrices',
    titleEn: 'Actors & actresses',
    category: 'CELEBRITY',
    private: false,
  },
  chanteur: {
    slug: 'ds-chanteur',
    titleFr: 'Chanteurs & musiciens',
    titleEn: 'Singers & musicians',
    category: 'CELEBRITY',
    private: false,
  },
  sportif: {
    slug: 'ds-sportif',
    titleFr: 'Sportifs',
    titleEn: 'Sportspeople',
    category: 'CELEBRITY',
    private: false,
  },
  fiction: {
    slug: 'ds-fiction',
    titleFr: 'Personnages',
    titleEn: 'Characters',
    category: 'CHARACTER',
    private: true,
  },
  tele: {
    slug: 'ds-tele',
    titleFr: 'Télé & internet',
    titleEn: 'TV & internet',
    category: 'CELEBRITY',
    private: false,
  },
  culture: {
    slug: 'ds-culture',
    titleFr: 'Culture & histoire',
    titleEn: 'Culture & history',
    category: 'CELEBRITY',
    private: false,
  },
  enfants: {
    slug: 'ds-enfants',
    titleFr: 'Héros des enfants',
    titleEn: 'Kids’ heroes',
    category: 'CHARACTER',
    private: true,
  },
};

export interface DatasetTarget {
  pack: DatasetPackKey;
  /** `-kids` for the second card of a character tagged for the kids pack. */
  slugSuffix: '' | '-kids';
  difficulty: 1 | 2;
}

export const isRealPerson = (entry: DatasetEntry) => PEOPLE.includes(entry.category);

export interface DatasetPhoto {
  /** Added to the card's slug: '' for the main photo, '-p2', '-p3' for the others. */
  suffix: string;
  path: string;
  commonsFile: string | null;
  facePx: number | undefined;
}

/**
 * The pictures of an entry, one card each: a person's photos (main first), or a character's
 * single artwork. Several photos keep players from learning a picture instead of a face.
 */
export function photosOf(entry: DatasetEntry): DatasetPhoto[] {
  const main: DatasetPhoto = {
    suffix: '',
    path: entry.image,
    commonsFile: commonsFileOf(entry),
    facePx: entry.face_px,
  };
  if (!isRealPerson(entry) || !entry.images?.length) return [main];
  return entry.images.map((photo, index) =>
    index === 0 && photo.file === entry.image
      ? { ...main, facePx: photo.face_px ?? main.facePx }
      : {
          suffix: index === 0 ? '' : `-p${index + 1}`,
          path: photo.file,
          commonsFile: commonsFileOf({
            ...entry,
            file: undefined,
            commons_file: photo.commons_file,
            source_url: photo.source_url ?? '',
          }),
          facePx: photo.face_px,
        },
  );
}

/** Each pack an entry goes to; a character tagged `enfants` goes to both character packs. */
export function targetsOf(entry: DatasetEntry): DatasetTarget[] {
  if (entry.category === 'enfants') return [{ pack: 'enfants', slugSuffix: '', difficulty: 1 }];
  const own: DatasetTarget = { pack: entry.category, slugSuffix: '', difficulty: 2 };
  if (entry.category === 'fiction' && entry.tags?.includes('enfants')) {
    return [own, { pack: 'enfants', slugSuffix: '-kids', difficulty: 1 }];
  }
  return [own];
}

/** The Commons file name: `file` when given, else from an upload or thumb URL; null elsewhere. */
export function commonsFileOf(entry: DatasetEntry): string | null {
  if (entry.commons_file) return entry.commons_file.replace(/^File:/, '');
  if (entry.file) return entry.file;
  let url: URL;
  try {
    url = new URL(entry.source_url);
  } catch {
    return null;
  }
  // The dataset's thumbnails come from thumb.wikimedia.org (the manifest has 474 of them).
  if (!/^(upload|thumb)\.wikimedia\.org$/.test(url.hostname)) return null;
  const parts = url.pathname.split('/').filter(Boolean);
  // Only Commons: /wikipedia/fr/… is a local (often fair-use) file of the French Wikipedia.
  if (parts[0] !== 'wikipedia' || parts[1] !== 'commons') return null;
  // …/commons/thumb/9/9a/<file>/1280px-<file>, or …/commons/7/71/<file>
  const thumb = parts.indexOf('thumb');
  const name = thumb >= 0 ? parts[thumb + 3] : parts.at(-1);
  try {
    return name ? decodeURIComponent(name) : null;
  } catch {
    return null;
  }
}

/** The French Wikipedia title: from a frwiki page URL, else the page title. */
export function frwikiTitleOf(entry: DatasetEntry): string {
  try {
    const url = new URL(entry.page_url);
    if (url.hostname === 'fr.wikipedia.org' && url.pathname.startsWith('/wiki/')) {
      return decodeURIComponent(url.pathname.slice('/wiki/'.length)).replaceAll('_', ' ');
    }
  } catch {
    // Not a URL: the title will do.
  }
  return entry.page_title;
}

/** The answer: the name, without a trailing qualifier in brackets. */
export function answerOf(entry: DatasetEntry): string | null {
  return entry.answer?.trim() || (answerFrom(entry.name)?.text ?? null);
}

const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();

/** Accepted other spellings: the dataset's aliases, without the answer itself or duplicates. */
export function aliasesOf(entry: DatasetEntry): string[] {
  const answer = answerOf(entry);
  const seen = new Set(answer ? [fold(answer)] : []);
  return (entry.aliases ?? []).filter((alias) => {
    const key = fold(alias);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The English answer, when the dataset gives one. */
export function englishAnswerOf(entry: DatasetEntry): string | null {
  return entry.name_en?.trim() || null;
}

/** The person's Wikidata item, when the dataset gives a well-formed one. */
export function wikidataOf(entry: DatasetEntry): string | null {
  return entry.wikidata && /^Q\d+$/.test(entry.wikidata) ? entry.wikidata : null;
}

/**
 * Every card slug the manifest still asks for: one per photo of a person (under its Wikidata
 * slug when known, else the dataset id, both counted), one per pack of a character.
 */
export function expectedSlugs(
  entries: DatasetEntry[],
  prefix: string,
  qids: Map<string, string>,
): Set<string> {
  const slugs = new Set<string>();
  for (const entry of entries) {
    for (const target of targetsOf(entry)) {
      for (const photo of photosOf(entry)) {
        slugs.add(`${prefix}-${entry.id}${target.slugSuffix}${photo.suffix}`);
        const qid = qids.get(entry.id);
        if (qid && isRealPerson(entry)) slugs.add(`wd-${qid}${photo.suffix}`);
      }
    }
  }
  return slugs;
}
