import { z } from 'zod';
import { answerFrom } from '../candidates.js';

/**
 * The owner's dataset (`data/celebrities/manifest.json`, built outside the app): what an entry
 * says, and where it goes. Pure: the importer service does the reading and the writing.
 */
export const DATASET_CATEGORIES = ['acteur', 'chanteur', 'sportif', 'fiction', 'enfants'] as const;
export type DatasetCategory = (typeof DATASET_CATEGORIES)[number];

const entrySchema = z.looseObject({
  id: z.string().min(1),
  name: z.string().min(1),
  category: z.enum(DATASET_CATEGORIES),
  image: z.string().min(1),
  source: z.literal('fandom').optional(),
  wiki: z.string().optional(),
  source_url: z.string(),
  page_url: z.string(),
  page_title: z.string(),
  tags: z.array(z.string()).optional(),
  /** The Commons file of a replaced picture: the truth when it disagrees with `source_url`. */
  file: z.string().optional(),
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

export const isRealPerson = (entry: DatasetEntry) =>
  entry.category === 'acteur' || entry.category === 'chanteur' || entry.category === 'sportif';

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
  if (entry.file) return entry.file;
  let url: URL;
  try {
    url = new URL(entry.source_url);
  } catch {
    return null;
  }
  if (!/^(upload|thumb)\.wikimedia\.org$/.test(url.hostname)) return null;
  const parts = url.pathname.split('/').filter(Boolean);
  // …/commons/thumb/9/9a/<file>/1280px-<file>, or …/commons/7/71/<file>
  const thumb = parts.indexOf('thumb');
  const name = thumb >= 0 ? parts[thumb + 3] : parts.at(-1);
  return name ? decodeURIComponent(name) : null;
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
  return answerFrom(entry.name)?.text ?? null;
}
