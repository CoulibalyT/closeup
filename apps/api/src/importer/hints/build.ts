import { normalise } from '../../game/engine/matching.js';

/** Words of a name worth hiding: three letters or more, folded. */
const nameWords = (name: string) =>
  normalise(name)
    .split(' ')
    .filter((word) => word.length >= 3);
const mentions = (text: string, words: string[]) => {
  const said = new Set(normalise(text).split(' '));
  return words.some((word) => said.has(word));
};
const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** Up to two works in the hint, up to eight partial answers. */
const HINT_WORKS = 2;
const MAX_SECONDARY = 8;

/**
 * A real person's hint and partial answers: "Actrice — Barbie, Le Loup de Wall Street". Works
 * that name the person ("Zidane, un portrait…") are left out of both.
 */
/** "joueur ou joueuse de tennis" → the form that fits the person. */
function genderedForm(label: string, female: boolean): string {
  const m = /^(\S+) ou (\S+)(.*)$/.exec(label.trim());
  return m ? `${female ? m[2] : m[1]}${m[3]}` : label.trim();
}

/** A description cut at a word, short enough to leave room for a work or two. */
function shortDescription(text: string): string {
  if (text.length <= 50) return text;
  return cutAtWord(text, 50);
}

/** Cut at a word, never leaving a dangling "et", "ou", a comma or a short word at the end. */
function cutAtWord(text: string, max: number): string {
  if (text.length <= max) return text;
  let cut = text.slice(0, max);
  cut = cut.slice(0, Math.max(cut.lastIndexOf(' '), 20));
  for (;;) {
    const trimmed = cut
      .replace(/[,;:—\s]+$/, '')
      .replace(/\s+(et|ou|and|or|de|du|des|d’|d'|la|le|les|l’|the|of)$/i, '');
    if (trimmed === cut) return cut;
    cut = trimmed;
  }
}

export function personHint(
  name: string,
  facts: {
    occupation: string | null;
    works: string[];
    description?: string | null;
    female?: boolean;
  },
): { hint: string | null; secondary: string[] } {
  const words = nameWords(name);
  const seen = new Set<string>();
  const works = facts.works.filter((work) => {
    const key = normalise(work);
    if (!key || seen.has(key) || mentions(work, words)) return false;
    seen.add(key);
    return true;
  });
  // Wikidata's description ("joueur de tennis espagnol") says what the person is best known
  // as; the occupation list is unordered once queried, so it is only the fallback.
  const description = facts.description?.trim();
  const said =
    description && !mentions(description, words)
      ? shortDescription(description)
      : facts.occupation?.trim()
        ? genderedForm(facts.occupation, facts.female ?? false)
        : null;
  const occupation = said ? capital(said) : null;
  const shown = works.slice(0, HINT_WORKS).join(', ');
  const hint = occupation && shown ? `${occupation} — ${shown}` : occupation || shown || null;
  return { hint: hint ? cutAtWord(hint, 80) : null, secondary: works.slice(0, MAX_SECONDARY) };
}

/** Fandom wikis whose name does not read as the universe once capitalised. */
const UNIVERSES: Record<string, string> = {
  starwars: 'Star Wars',
  looneytunes: 'Looney Tunes',
  spongebob: 'Bob l’éponge',
  despicableme: 'Moi, moche et méchant',
  howtotrainyourdragon: 'Dragons',
  peppapig: 'Peppa Pig',
  harrypotter: 'Harry Potter',
  dragonball: 'Dragon Ball',
  kungfupanda: 'Kung Fu Panda',
  onepiece: 'One Piece',
  tmnt: 'Tortues Ninja',
  theloudhouse: 'Bienvenue chez les Loud',
  wallaceandgromit: 'Wallace et Gromit',
  lotr: 'Le Seigneur des anneaux',
  gameofthrones: 'Game of Thrones',
  simpsons: 'Les Simpson',
  'kimetsu-no-yaiba': 'Demon Slayer',
  'hanna-barbera': 'Hanna-Barbera',
  firemansam: 'Sam le pompier',
  attackontitan: 'L’Attaque des Titans',
  asterix: 'Astérix',
  strangerthings: 'Stranger Things',
  dora: 'Dora l’exploratrice',
  miraculousladybug: 'Miraculous',
  scoobydoo: 'Scooby-Doo',
  myheroacademia: 'My Hero Academia',
  fireemblem: 'Fire Emblem',
  'jujutsu-kaisen': 'Jujutsu Kaisen',
  breakingbad: 'Breaking Bad',
  deathnote: 'Death Note',
  luckyluke: 'Lucky Luke',
  gabbysdollhouse: 'Gabby et la maison magique',
  blueypedia: 'Bluey',
  flintstones: 'Les Pierrafeu',
  'she-raandtheprincessesofpower': 'She-Ra',
  pawpatrol: 'La Pat’ Patrouille',
  theamazingworldofgumball: 'Le Monde incroyable de Gumball',
  ttte: 'Thomas et ses amis',
  adventuretime: 'Adventure Time',
  raymanpedia: 'Rayman',
  avp: 'Alien vs. Predator',
  fma: 'Fullmetal Alchemist',
  streetfighter: 'Street Fighter',
  finalfantasy: 'Final Fantasy',
  backtothefuture: 'Retour vers le futur',
  theoffice: 'The Office',
  thelastofus: 'The Last of Us',
  southpark: 'South Park',
  smurfs: 'Les Schtroumpfs',
  tomandjerry: 'Tom et Jerry',
  animalcrossing: 'Animal Crossing',
  lacasadepapel: 'La casa de papel',
  rickandmorty: 'Rick et Morty',
  familyguy: 'Les Griffin',
  mortalkombat: 'Mortal Kombat',
  bobthebuilder: 'Bob le bricoleur',
  curiousgeorge: 'Georges le petit curieux',
  dannyphantom: 'Danny Fantôme',
  hellokitty: 'Hello Kitty',
  heyduggee: 'Hey Duggee',
  jimmyneutron: 'Jimmy Neutron',
  johnnytest: 'Johnny Test',
  powerpuff: 'Les Supers Nanas',
  'masha-and-the-bear': 'Masha et Michka',
  mayathebee: 'Maya l’abeille',
  oggyandthecockroaches: 'Oggy et les Cafards',
  'steven-universe': 'Steven Universe',
  woodywoodpecker: 'Woody Woodpecker',
  'among-us': 'Among Us',
  reddeadredemption: 'Red Dead Redemption',
  astroboy: 'Astro Boy',
  fzero: 'F-Zero',
  childsplay: 'Chucky',
  nightmareonelmstreet: 'Les Griffes de la nuit',
  madmen: 'Mad Men',
  starfox: 'Star Fox',
  'the-boys': 'The Boys',
  indianajones: 'Indiana Jones',
  pirates: 'Pirates des Caraïbes',
  jamesbond: 'James Bond',
  fridaythe13th: 'Vendredi 13',
  johnwick: 'John Wick',
  godofwar: 'God of War',
  tombraider: 'Tomb Raider',
  captaintsubasa: 'Olive et Tom',
  pacman: 'Pac-Man',
  stephenking: 'Stephen King',
  pinkpanther: 'La Panthère rose',
  sailormoon: 'Sailor Moon',
  onepunchman: 'One-Punch Man',
  bigbangtheory: 'The Big Bang Theory',
  metalgear: 'Metal Gear',
  cowboybebop: 'Cowboy Bebop',
  'ted-lasso': 'Ted Lasso',
  sopranos: 'Les Soprano',
  totallyspies: 'Totally Spies',
  'pj-masks': 'Pyjamasques',
  pyjamasques: 'Pyjamasques',
  thesecretlifeofpets: 'Comme des bêtes',
  dexterslab: 'Le Laboratoire de Dexter',
  kidicarus: 'Kid Icarus',
  muppet: 'Muppets',
  dc: 'DC Comics',
  ghibli: 'Studio Ghibli',
  lego: 'Lego',
};

/**
 * A character's hint: their universe, from the bracket of the name ("Alex (Totally Spies)") or
 * the Fandom wiki they come from. Never a universe that is the character's own name.
 */
export function characterHint(
  name: string,
  wiki?: string,
): { hint: string | null; secondary: string[] } {
  const bracket = /\(([^)]+)\)\s*$/.exec(name)?.[1]?.trim();
  const bare = name.replace(/\s*\([^)]*\)\s*$/, '');
  const universe =
    bracket ?? (wiki ? (UNIVERSES[wiki] ?? capital(wiki.replace(/-/g, ' '))) : undefined);
  if (!universe || mentions(universe, nameWords(bare)) || mentions(bare, nameWords(universe))) {
    return { hint: null, secondary: [] };
  }
  return { hint: universe, secondary: [universe] };
}

/** Classes too vague to help anybody guess. */
const VAGUE_CLASSES = new Set(
  [
    'taxon',
    'quartier',
    'entité',
    'objet',
    'concept',
    'élément',
    'type',
    'groupe',
    'classe',
    'catégorie',
    'collection',
    'partie',
    'produit',
    'chose',
    'structure',
    'lieu',
    'site',
    'article',
    'item',
    'entity',
    'object',
    'thing',
    'group',
    'class',
    'part',
    'product',
    'neighbourhood',
    'neighborhood',
    'place',
    'location',
  ].map((word) => normalise(word)),
);

/** A thing's hint: its class, "Race de chien". None when the class names the thing. */
export function classHint(label: string | null, answer: string): string | null {
  // "type de fruit" says "fruit"; "groupe d'organismes…" says nothing.
  const plain = label?.trim().replace(/^type (?:de |d['’])/i, '') ?? '';
  if (!plain || VAGUE_CLASSES.has(normalise(plain)) || /^groupe d['’]organismes/i.test(plain)) {
    return null;
  }
  label = plain;
  if (mentions(label, nameWords(answer)) || mentions(answer, nameWords(label))) return null;
  return capital(label.trim()).slice(0, 80);
}
