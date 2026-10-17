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
  'Q328468', // Nazi concentration camp
  'Q40357', // prison
  'Q728', // weapon
  'Q12796', // firearm
  'Q15142894', // weapon model
  'Q185785', // ammunition
  'Q14660', // flag
  'Q14659', // coat of arms
  'Q552345', // insignia
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
  // Not for a family game either: what a microscope or a dig shows.
  'virus',
  'bactérie',
  'bactéries',
  'bacterium',
  'bacteria',
  'levure',
  'levures',
  'yeast',
  'microorganisme',
  'microorganism',
  'unicellulaire',
  'unicellular',
  'parasite',
  'parasites',
  'acarien',
  'acariens',
  'mite',
  'mites',
  'moisissure',
  'mould',
  'mold',
  'pathogène',
  'pathogen',
  'fossile',
  'fossiles',
  'fossil',
  'fossils',
  'crâne',
  'skull',
  'squelette',
  'skeleton',
  'momie',
  'mummy',
  'cadavre',
  'corpse',
];

/**
 * Words of a description that says "a group of", not "a thing": "rapace", "mammifère marin",
 * "poisson d'eau douce" are true answers nobody types in front of a polar bear.
 */
export const VAGUE_WORDS = [
  'groupe',
  'ensemble',
  'terme',
  'vernaculaire',
  'désigne',
  'désignant',
  'appellation',
  'générique',
  'group',
  'term',
  'informal',
  'generic',
  'collective',
  'vernacular',
];

const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
const DENIED = new Set(DENIED_WORDS.map(fold));
const VAGUE = new Set(VAGUE_WORDS.map(fold));
const wordsOf = (texts: (string | null | undefined)[]) =>
  texts
    .filter((text): text is string => Boolean(text))
    .flatMap((text) => fold(text).split(/[^\p{L}\p{N}]+/u))
    .filter(Boolean);

export function isDeniedSubject(facts: {
  instanceOf: string[];
  subclassOf: string[];
  labels: string[];
  descriptions: string[];
}): 'GUARD_CLASS' | 'GUARD_WORD' | null {
  if ([...facts.instanceOf, ...facts.subclassOf].some((qid) => DENIED_CLASSES.has(qid))) {
    return 'GUARD_CLASS';
  }
  const words = wordsOf([...facts.labels, ...facts.descriptions]);
  return words.some((word) => DENIED.has(word)) ? 'GUARD_WORD' : null;
}

/** A subject whose description reads like a group name rather than one thing. */
export function isVagueSubject(descriptions: (string | null | undefined)[]): boolean {
  return wordsOf(descriptions).some((word) => VAGUE.has(word));
}

/** "Bos taurus" is not an answer a player types: a taxon with no French common name is skipped. */
export function isLatinName(labelFr: string | undefined, taxonName: string | null): boolean {
  if (!labelFr) return true;
  return taxonName !== null && fold(labelFr) === fold(taxonName);
}
