import { type ImportPreset, PEOPLE_PRESETS } from '@closeup/shared';

type PeoplePreset = (typeof PEOPLE_PRESETS)[number];
type ObjectPreset = Exclude<ImportPreset, PeoplePreset>;

/**
 * Where each preset looks on Wikidata, and how well known a subject must be to be proposed.
 *
 * Every query starts from a small, targeted set (the instances or subclasses of one class),
 * never from "every species": the public query service stops a query at 60 s, and was seen
 * taking 5 s and then 60 s for the same one. For the same reason there is no transitive filter
 * ("descends from the animal kingdom"): it timed out even on forty subjects. What a class lets
 * through and does not belong (a tree among the animals) is left unticked by the admin.
 */
const PRESETS: Record<ObjectPreset, { where: string; minPopularity: number }> = {
  // Organisms known by a common name: dog, cat, sheep, eagle… rather than Latin species.
  animals: { where: '?item wdt:P31 wd:Q55983715 .', minPopularity: 40 },
  fruits: { where: '?item wdt:P279 wd:Q3314483 .', minPopularity: 30 },
  dishes: { where: '?item wdt:P31 wd:Q746549 .', minPopularity: 40 },
  // Up to three levels below "musical instrument": a guitar is a plucked string instrument.
  instruments: { where: '?item wdt:P279/wdt:P279?/wdt:P279? wd:Q34379 .', minPopularity: 30 },
  tools: { where: '?item wdt:P279 wd:Q39546 .', minPopularity: 40 },
  vehicles: { where: '?item wdt:P279 wd:Q42889 .', minPopularity: 30 },
  // UNESCO World Heritage sites.
  heritage: { where: '?item wdt:P1435 wd:Q9259 .', minPopularity: 60 },
};

/**
 * People are searched one occupation (or a few) at a time: the query service gave up at 60 s on
 * every footballer at once, and on every human born before 1900. Small queries in a row, merged,
 * stay well under it (measured 2026-10-01: 4 to 50 s each).
 */
interface PeopleQuery {
  jobs: readonly string[];
  minPopularity: number;
  /** Died before this year: the historical figures. */
  diedBefore?: number;
}

const PEOPLE: Record<PeoplePreset, PeopleQuery[]> = {
  actors: [
    // actor
    { jobs: ['Q33999'], minPopularity: 60 },
    // film, television, stage and voice actor
    { jobs: ['Q10800557', 'Q10798782', 'Q2259451', 'Q2405480'], minPopularity: 60 },
  ],
  musicians: [
    // singer
    { jobs: ['Q177220'], minPopularity: 60 },
    // musician, singer-songwriter
    { jobs: ['Q639669', 'Q488205'], minPopularity: 60 },
    // rapper, composer
    { jobs: ['Q2252262', 'Q36834'], minPopularity: 60 },
  ],
  sports: [
    // association football alone: the largest by far
    { jobs: ['Q937857'], minPopularity: 80 },
    // basketball, tennis
    { jobs: ['Q3665646', 'Q10833314'], minPopularity: 60 },
    // athletics, cycling
    { jobs: ['Q11513337', 'Q2309784'], minPopularity: 60 },
    // Formula One, boxing
    { jobs: ['Q10841764', 'Q11338576'], minPopularity: 60 },
  ],
  // monarch, painter, writer, physicist, philosopher, composer, military officer, explorer
  historical: [
    { jobs: ['Q116'], minPopularity: 100, diedBefore: 1900 },
    { jobs: ['Q1028181'], minPopularity: 80, diedBefore: 1900 },
    { jobs: ['Q36180'], minPopularity: 100, diedBefore: 1900 },
    { jobs: ['Q169470'], minPopularity: 80, diedBefore: 1900 },
    { jobs: ['Q4964182'], minPopularity: 80, diedBefore: 1900 },
    { jobs: ['Q36834'], minPopularity: 80, diedBefore: 1900 },
    { jobs: ['Q189290'], minPopularity: 100, diedBefore: 1900 },
    { jobs: ['Q11900058'], minPopularity: 60, diedBefore: 1900 },
  ],
};

const isPeople = (preset: ImportPreset): preset is PeoplePreset =>
  (PEOPLE_PRESETS as readonly string[]).includes(preset);

/**
 * One query per occupation group. Politicians are out of every people theme: an actor who became
 * president is not who the admin was looking for, and politics is not the game's business.
 * People known to French-speaking players only: an article on the French Wikipedia.
 */
function peopleQuery({ jobs, minPopularity, diedBefore }: PeopleQuery): string {
  const job = jobs.length === 1 ? `wd:${jobs[0]}` : '?job';
  const values =
    jobs.length === 1 ? '' : `VALUES ?job { ${jobs.map((qid) => `wd:${qid}`).join(' ')} }`;
  const died = diedBefore ? `?item wdt:P570 ?died . FILTER(YEAR(?died) < ${diedBefore})` : '';
  return `SELECT ?item (MAX(?links) AS ?popularity) (SAMPLE(?image) AS ?file) WHERE {
  ${values}
  ?item wdt:P106 ${job} ; wdt:P31 wd:Q5 .
  FILTER NOT EXISTS { ?item wdt:P106 wd:Q82955 }
  ${died}
  ?item wdt:P18 ?image ; wikibase:sitelinks ?links .
  FILTER(?links >= ${minPopularity})
  ?article schema:about ?item ; schema:isPartOf <https://fr.wikipedia.org/> .
} GROUP BY ?item ORDER BY DESC(?popularity) LIMIT ${SEARCH_LIMIT}`;
}

/** Candidates per search. The most popular come first; the admin picks among them. */
export const SEARCH_LIMIT = 120;

/**
 * One row per subject, its best-known picture, sorted by popularity (the number of Wikipedias
 * with an article about it). Humans are out twice over: the class "human" itself (it is an
 * organism known by a common name) and anything that is an instance of it.
 */
export function searchQueries(preset: ImportPreset): string[] {
  if (isPeople(preset)) return PEOPLE[preset].map(peopleQuery);
  return [objectQuery(preset)];
}

function objectQuery(preset: ObjectPreset): string {
  const { where, minPopularity } = PRESETS[preset];
  return `SELECT ?item (MAX(?links) AS ?popularity) (SAMPLE(?image) AS ?file) WHERE {
  ${where}
  FILTER(?item != wd:Q5)
  FILTER NOT EXISTS { ?item wdt:P31 wd:Q5 }
  ?item wdt:P18 ?image ; wikibase:sitelinks ?links .
  FILTER(?links >= ${minPopularity})
} GROUP BY ?item ORDER BY DESC(?popularity) LIMIT ${SEARCH_LIMIT}`;
}
