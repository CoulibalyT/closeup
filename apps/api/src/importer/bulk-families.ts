import { BULK, type BulkFamily, type Category } from '@closeup/shared';

/** Where a class's cards go. One pack per key, "— 2" past BULK.packSize. */
export interface BulkPack {
  key: string;
  titleFr: string;
  titleEn: string;
  category: Category;
}

export interface BulkClass {
  key: string;
  labelFr: string;
  /** A SPARQL pattern binding ?item. */
  where: string;
  /** Humans: the people rules (personality flag accepted, family-name alias, face points). */
  people?: boolean;
  pack: BulkPack;
  /** Kids packs: everything easy. */
  difficulty?: 1;
  /** The lowest band this class goes down to (an index in BULK.bands); kids stop early. */
  lastBand?: number;
}

const P31 = (qid: string) => `?item wdt:P31 wd:${qid} .`;
const P279 = (qid: string) => `?item wdt:P279 wd:${qid} .`;
const JOBS = (qids: string[]) =>
  `VALUES ?job { ${qids.map((qid) => `wd:${qid}`).join(' ')} } ?item wdt:P106 ?job .`;

const packs = {
  nature: {
    key: 'nature',
    titleFr: 'Catalogue étendu — Animaux et plantes',
    titleEn: 'Extended catalogue — Animals and plants',
    category: 'ANIMAL',
  },
  objects: {
    key: 'objects',
    titleFr: 'Catalogue étendu — Objets et nourriture',
    titleEn: 'Extended catalogue — Objects and food',
    category: 'OBJECT',
  },
  places: {
    key: 'places',
    titleFr: 'Catalogue étendu — Lieux et monuments',
    titleEn: 'Extended catalogue — Places and monuments',
    category: 'LANDMARK',
  },
  people: {
    key: 'people',
    titleFr: 'Catalogue étendu — Personnalités',
    titleEn: 'Extended catalogue — People',
    category: 'CELEBRITY',
  },
  kidsNature: {
    key: 'kids-nature',
    titleFr: 'Catalogue enfants — Animaux',
    titleEn: 'Kids catalogue — Animals',
    category: 'ANIMAL',
  },
  kidsSpace: {
    key: 'kids-space',
    titleFr: 'Catalogue enfants — Dinosaures et espace',
    titleEn: 'Kids catalogue — Dinosaurs and space',
    category: 'OTHER',
  },
  kidsThings: {
    key: 'kids-things',
    titleFr: 'Catalogue enfants — Véhicules et jouets',
    titleEn: 'Kids catalogue — Vehicles and toys',
    category: 'OBJECT',
  },
  tales: {
    key: 'kids-tales',
    titleFr: 'Catalogue enfants — Contes',
    titleEn: 'Kids catalogue — Tales',
    category: 'CHARACTER',
  },
} satisfies Record<string, BulkPack>;

/**
 * The classes of each family. Item ids are checked against the live query service once, with
 * their timing, before the first run; a class that answers under 20 subjects or times out is
 * removed here.
 */
export const BULK_CLASSES: Record<BulkFamily, BulkClass[]> = {
  nature: [
    {
      key: 'common-organisms',
      labelFr: 'Organismes à nom courant',
      where: P31('Q55983715'),
      pack: packs.nature,
    },
    { key: 'dog-breeds', labelFr: 'Races de chiens', where: P31('Q39367'), pack: packs.nature },
    { key: 'cat-breeds', labelFr: 'Races de chats', where: P31('Q43577'), pack: packs.nature },
    {
      key: 'horse-breeds',
      labelFr: 'Races de chevaux',
      where: P31('Q1160573'),
      pack: packs.nature,
    },
    { key: 'fruits', labelFr: 'Fruits', where: P279('Q3314483'), pack: packs.nature },
    { key: 'vegetables', labelFr: 'Légumes', where: P279('Q11004'), pack: packs.nature },
    {
      key: 'mushrooms',
      labelFr: 'Champignons comestibles',
      where: P31('Q654236'),
      pack: packs.nature,
    },
    { key: 'trees', labelFr: 'Arbres', where: P31('Q10884'), pack: packs.nature },
  ],
  objects: [
    { key: 'dishes', labelFr: 'Plats', where: P31('Q746549'), pack: packs.objects },
    { key: 'desserts', labelFr: 'Desserts', where: P279('Q182940'), pack: packs.objects },
    { key: 'cheeses', labelFr: 'Fromages', where: P31('Q3444702'), pack: packs.objects },
    { key: 'drinks', labelFr: 'Boissons', where: P279('Q40050'), pack: packs.objects },
    {
      key: 'instruments',
      labelFr: 'Instruments',
      where: '?item wdt:P279/wdt:P279?/wdt:P279? wd:Q34379 .',
      pack: packs.objects,
    },
    { key: 'tools', labelFr: 'Outils', where: P279('Q39546'), pack: packs.objects },
    {
      key: 'kitchenware',
      labelFr: 'Ustensiles de cuisine',
      where: P279('Q3773693'),
      pack: packs.objects,
    },
    { key: 'clothing', labelFr: 'Vêtements', where: P279('Q11460'), pack: packs.objects },
    { key: 'furniture', labelFr: 'Meubles', where: P279('Q14745'), pack: packs.objects },
    {
      key: 'appliances',
      labelFr: 'Appareils ménagers',
      where: P279('Q212920'),
      pack: packs.objects,
    },
    { key: 'toys', labelFr: 'Jouets', where: P279('Q11422'), pack: packs.objects },
    {
      key: 'sports-gear',
      labelFr: 'Équipements de sport',
      where: P279('Q1050636'),
      pack: packs.objects,
    },
    { key: 'vehicles', labelFr: 'Véhicules', where: P279('Q42889'), pack: packs.objects },
    {
      key: 'car-models',
      labelFr: 'Modèles de voitures',
      where: P31('Q3231690'),
      pack: packs.objects,
    },
  ],
  places: [
    {
      key: 'heritage',
      labelFr: 'Patrimoine mondial',
      where: '?item wdt:P1435 wd:Q9259 .',
      pack: packs.places,
    },
    { key: 'towers', labelFr: 'Tours', where: P31('Q12518'), pack: packs.places },
    { key: 'bridges', labelFr: 'Ponts', where: P31('Q12280'), pack: packs.places },
    { key: 'castles', labelFr: 'Châteaux', where: P31('Q23413'), pack: packs.places },
    { key: 'cathedrals', labelFr: 'Cathédrales', where: P31('Q2977'), pack: packs.places },
    { key: 'museums', labelFr: 'Musées', where: P31('Q33506'), pack: packs.places },
    { key: 'skyscrapers', labelFr: 'Gratte-ciel', where: P31('Q11303'), pack: packs.places },
    { key: 'stadiums', labelFr: 'Stades', where: P31('Q483110'), pack: packs.places },
    { key: 'lighthouses', labelFr: 'Phares', where: P31('Q39715'), pack: packs.places },
    { key: 'monuments', labelFr: 'Monuments', where: P31('Q4989906'), pack: packs.places },
    { key: 'statues', labelFr: 'Statues', where: P31('Q179700'), pack: packs.places },
    { key: 'palaces', labelFr: 'Palais', where: P31('Q16560'), pack: packs.places },
    { key: 'squares', labelFr: 'Places', where: P31('Q174782'), pack: packs.places },
    { key: 'mountains', labelFr: 'Montagnes', where: P31('Q8502'), pack: packs.places },
    { key: 'waterfalls', labelFr: 'Cascades', where: P31('Q34038'), pack: packs.places },
    { key: 'volcanoes', labelFr: 'Volcans', where: P31('Q8072'), pack: packs.places },
    { key: 'lakes', labelFr: 'Lacs', where: P31('Q23397'), pack: packs.places },
    { key: 'national-parks', labelFr: 'Parcs nationaux', where: P31('Q46169'), pack: packs.places },
    {
      key: 'cities',
      labelFr: 'Grandes villes',
      where: P31('Q515'),
      pack: packs.places,
      lastBand: 0,
    },
  ],
  people: [
    {
      key: 'actors',
      labelFr: 'Acteurs',
      where: JOBS(['Q33999', 'Q10800557', 'Q10798782', 'Q2259451', 'Q2405480']),
      people: true,
      pack: packs.people,
    },
    {
      key: 'musicians',
      labelFr: 'Musiciens',
      where: JOBS(['Q177220', 'Q639669', 'Q488205', 'Q2252262', 'Q36834']),
      people: true,
      pack: packs.people,
    },
    {
      key: 'sports',
      labelFr: 'Sportifs',
      where: JOBS([
        'Q937857',
        'Q3665646',
        'Q10833314',
        'Q11513337',
        'Q2309784',
        'Q10841764',
        'Q11338576',
      ]),
      people: true,
      pack: packs.people,
    },
    {
      key: 'creators',
      labelFr: 'Créateurs',
      where: JOBS(['Q2526255', 'Q36180', 'Q1028181', 'Q33231', 'Q3501317', 'Q3499072']),
      people: true,
      pack: packs.people,
    },
    {
      key: 'stage',
      labelFr: 'Télé et scène',
      where: JOBS(['Q947873', 'Q245068', 'Q4610556']),
      people: true,
      pack: packs.people,
    },
    {
      key: 'historical',
      labelFr: 'Personnages historiques',
      where: `${JOBS(['Q116', 'Q1028181', 'Q36180', 'Q169470', 'Q4964182', 'Q36834', 'Q189290', 'Q11900058'])} ?item wdt:P570 ?died . FILTER(YEAR(?died) < 1900)`,
      people: true,
      pack: packs.people,
    },
  ],
  kids: [
    {
      key: 'kids-animals',
      labelFr: 'Animaux',
      where: P31('Q55983715'),
      pack: packs.kidsNature,
      difficulty: 1,
      lastBand: 1,
    },
    {
      key: 'kids-fruits',
      labelFr: 'Fruits et légumes',
      where: `{ ${P279('Q3314483')} } UNION { ${P279('Q11004')} }`,
      pack: packs.kidsNature,
      difficulty: 1,
      lastBand: 1,
    },
    {
      key: 'kids-dinosaurs',
      labelFr: 'Dinosaures',
      where:
        '?item wdt:P31 wd:Q16521 ; wdt:P105 wd:Q34740 ; wdt:P171/wdt:P171/wdt:P171/wdt:P171? wd:Q430 .',
      pack: packs.kidsSpace,
      difficulty: 1,
      lastBand: 2,
    },
    {
      key: 'kids-planets',
      labelFr: 'Planètes et lunes',
      where: `{ ${P31('Q634')} } UNION { ${P31('Q2199')} } UNION { ${P31('Q2537')} }`,
      pack: packs.kidsSpace,
      difficulty: 1,
      lastBand: 1,
    },
    {
      key: 'kids-vehicles',
      labelFr: 'Véhicules',
      where: P279('Q42889'),
      pack: packs.kidsThings,
      difficulty: 1,
      lastBand: 1,
    },
    {
      key: 'kids-toys',
      labelFr: 'Jouets',
      where: P279('Q11422'),
      pack: packs.kidsThings,
      difficulty: 1,
      lastBand: 1,
    },
    {
      key: 'kids-instruments',
      labelFr: 'Instruments',
      where: P279('Q34379'),
      pack: packs.kidsThings,
      difficulty: 1,
      lastBand: 1,
    },
    {
      key: 'kids-household',
      labelFr: 'Objets de la maison',
      where: `{ ${P279('Q3773693')} } UNION { ${P279('Q14745')} }`,
      pack: packs.kidsThings,
      difficulty: 1,
      lastBand: 1,
    },
    // To confirm after the contact sheet: classic illustrations of public-domain tale characters.
    {
      key: 'kids-tales',
      labelFr: 'Contes',
      where: `${P31('Q15632617')} ?item wdt:P1441 ?work . ?work wdt:P577 ?date . FILTER(YEAR(?date) < 1900)`,
      pack: packs.tales,
      difficulty: 1,
      lastBand: 1,
    },
  ],
};

/** One page of one popularity band of one class. */
export function bulkQuery(
  cls: BulkClass,
  band: { min: number; max: number | null },
  page: number,
): string {
  const links =
    band.max === null
      ? `FILTER(?links >= ${band.min})`
      : `FILTER(?links >= ${band.min} && ?links <= ${band.max})`;
  // People known to French-speaking players only, and never a politician; anything else is
  // never a human.
  const human = cls.people
    ? `?item wdt:P31 wd:Q5 .
  FILTER NOT EXISTS { ?item wdt:P106 wd:Q82955 }
  ?article schema:about ?item ; schema:isPartOf <https://fr.wikipedia.org/> .`
    : `FILTER NOT EXISTS { ?item wdt:P31 wd:Q5 }`;
  return `SELECT ?item (MAX(?links) AS ?popularity) (SAMPLE(?image) AS ?file) WHERE {
  ${cls.where}
  ${human}
  ?item wdt:P18 ?image ; wikibase:sitelinks ?links .
  ${links}
} GROUP BY ?item ORDER BY DESC(?popularity) LIMIT ${BULK.pageSize} OFFSET ${page * BULK.pageSize}`;
}

/** The bands a class goes through, best known first. */
export function bandsOf(cls: BulkClass): { min: number; max: number | null }[] {
  const last = cls.lastBand ?? BULK.bands.length - 1;
  return BULK.bands.slice(0, last + 1).map((min, i) => ({
    min,
    max: i === 0 ? null : BULK.bands[i - 1]! - 1,
  }));
}
