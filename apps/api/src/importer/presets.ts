import type { ImportPreset } from '@closeup/shared';

/**
 * Where each preset looks on Wikidata, and how well known a subject must be to be proposed.
 *
 * Every query starts from a small, targeted set (the instances or subclasses of one class),
 * never from "every species": the public query service stops a query at 60 s, and was seen
 * taking 5 s and then 60 s for the same one. For the same reason there is no transitive filter
 * ("descends from the animal kingdom"): it timed out even on forty subjects. What a class lets
 * through and does not belong (a tree among the animals) is left unticked by the admin.
 */
const PRESETS: Record<ImportPreset, { where: string; minPopularity: number }> = {
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

/** Candidates per search. The most popular come first; the admin picks among them. */
export const SEARCH_LIMIT = 120;

/**
 * One row per subject, its best-known picture, sorted by popularity (the number of Wikipedias
 * with an article about it). Humans are out twice over: the class "human" itself (it is an
 * organism known by a common name) and anything that is an instance of it.
 */
export function searchQuery(preset: ImportPreset): string {
  const { where, minPopularity } = PRESETS[preset];
  return `SELECT ?item (MAX(?links) AS ?popularity) (SAMPLE(?image) AS ?file) WHERE {
  ${where}
  FILTER(?item != wd:Q5)
  FILTER NOT EXISTS { ?item wdt:P31 wd:Q5 }
  ?item wdt:P18 ?image ; wikibase:sitelinks ?links .
  FILTER(?links >= ${minPopularity})
} GROUP BY ?item ORDER BY DESC(?popularity) LIMIT ${SEARCH_LIMIT}`;
}
