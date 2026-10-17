/**
 * What the mass import leaves out on sight. Neither list is complete, and both are meant to be
 * extended by the owner when a subject offends; a whole pack can be switched off meanwhile.
 */

/** Classes a subject must not be an instance or a subclass of (Wikidata items). */
export const DENIED_CLASSES = new Set([
  'Q39614', // cemetery
  'Q5003624', // memorial
  'Q575759', // war memorial
  'Q152081', // concentration camp
  'Q328468', // extermination camp
  'Q40357', // prison
  'Q728', // weapon
  'Q12796', // firearm
  'Q15142894', // weapon model
  'Q185785', // ammunition
  'Q14660', // flag
  'Q14659', // coat of arms
  'Q4740146', // insignia
  'Q4936952', // anatomical structure
  'Q3839081', // disaster
  'Q2223653', // terrorist attack
  'Q178561', // battle
]);

/** Whole words, in French and English, matched after folding accents and case. */
export const DENIED_WORDS = [
  'génocide',
  'genocide',
  'massacre',
  'nazi',
  'nazie',
  'nazis',
  'arme',
  'armes',
  'weapon',
  'weapons',
  'fusil',
  'fusils',
  'rifle',
  'gun',
  'guns',
  'nu',
  'nue',
  'nus',
  'nues',
  'nude',
  'naked',
  'sexe',
  'sex',
  'sexuel',
  'sexuelle',
  'sexual',
  'porno',
  'porn',
  'pornographie',
  'pornography',
  'drogue',
  'drogues',
  'drug',
  'drugs',
  'torture',
  'exécution',
  'execution',
  'suicide',
  'viol',
  'rape',
];

const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
const DENIED = new Set(DENIED_WORDS.map(fold));

export function isDeniedSubject(facts: {
  instanceOf: string[];
  subclassOf: string[];
  labels: string[];
  descriptions: string[];
}): 'GUARD_CLASS' | 'GUARD_WORD' | null {
  if ([...facts.instanceOf, ...facts.subclassOf].some((qid) => DENIED_CLASSES.has(qid))) {
    return 'GUARD_CLASS';
  }
  const words = [...facts.labels, ...facts.descriptions]
    .flatMap((text) => fold(text).split(/[^\p{L}\p{N}]+/u))
    .filter(Boolean);
  return words.some((word) => DENIED.has(word)) ? 'GUARD_WORD' : null;
}

/** "Bos taurus" is not an answer a player types: a taxon with no French common name is skipped. */
export function isLatinName(labelFr: string | undefined, taxonName: string | null): boolean {
  if (!labelFr) return true;
  return taxonName !== null && fold(labelFr) === fold(taxonName);
}
