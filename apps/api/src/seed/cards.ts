import * as a from './illustrations-a.js';
import * as b from './illustrations-b.js';

/**
 * Seed content: original illustrations only, so the whole game can be tested without any
 * third-party image. Coordinates are on the 1000 × 1000 canvas of the illustrations.
 */

export type SeedCategory = 'FOOD' | 'OBJECT' | 'ANIMAL';

export interface SeedAnswer {
  text: string;
  aliases?: string[];
}

export interface SeedZoomPoint {
  x: number;
  y: number;
  baseRadius: number;
  fr: string;
  en: string;
  weight?: number;
}

export interface SeedCard {
  slug: string;
  difficulty: 1 | 2 | 3;
  draw: () => string;
  fr: SeedAnswer;
  en: SeedAnswer;
  points: SeedZoomPoint[];
}

export interface SeedPack {
  slug: string;
  category: SeedCategory;
  titleFr: string;
  titleEn: string;
  descriptionFr: string;
  descriptionEn: string;
  cards: SeedCard[];
}

export const SEED_CREDIT = {
  author: 'closeup',
  licence: 'CC0 1.0',
  sourceUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
};

const p = (x: number, y: number, baseRadius: number, fr: string, en: string): SeedZoomPoint => ({
  x,
  y,
  baseRadius,
  fr,
  en,
});

export const SEED_PACKS: SeedPack[] = [
  {
    slug: 'seed-food',
    category: 'FOOD',
    titleFr: 'À table',
    titleEn: 'On the table',
    descriptionFr: 'Des choses qui se mangent, vues de très près.',
    descriptionEn: 'Things you can eat, seen from very close.',
    cards: [
      {
        slug: 'orange',
        difficulty: 1,
        draw: a.orange,
        fr: { text: 'orange', aliases: ["tranche d'orange", 'clémentine', 'mandarine'] },
        en: { text: 'orange', aliases: ['orange slice', 'clementine', 'tangerine'] },
        points: [
          p(640, 360, 60, 'la pulpe', 'the pulp'),
          p(500, 500, 60, 'le cœur', 'the core'),
          p(175, 330, 60, "l'écorce", 'the rind'),
        ],
      },
      {
        slug: 'kiwi',
        difficulty: 1,
        draw: a.kiwi,
        fr: { text: 'kiwi' },
        en: { text: 'kiwi', aliases: ['kiwifruit'] },
        points: [
          p(655, 430, 55, 'les pépins', 'the seeds'),
          p(500, 500, 60, 'le cœur', 'the core'),
          p(800, 760, 60, 'la peau', 'the skin'),
        ],
      },
      {
        slug: 'watermelon',
        difficulty: 1,
        draw: a.watermelon,
        fr: { text: 'pastèque', aliases: ["melon d'eau"] },
        en: { text: 'watermelon' },
        points: [
          p(500, 480, 60, 'les pépins', 'the seeds'),
          p(500, 715, 60, "l'écorce", 'the rind'),
          p(300, 400, 60, 'la chair', 'the flesh'),
        ],
      },
      {
        slug: 'donut',
        difficulty: 1,
        draw: a.donut,
        fr: { text: 'donut', aliases: ['doughnut', 'beignet'] },
        en: { text: 'donut', aliases: ['doughnut'] },
        points: [
          p(700, 330, 60, 'les vermicelles', 'the sprinkles'),
          p(500, 500, 65, 'le trou', 'the hole'),
          p(500, 880, 60, 'le bord', 'the edge'),
        ],
      },
      {
        slug: 'pizza',
        difficulty: 1,
        draw: a.pizza,
        fr: { text: 'pizza' },
        en: { text: 'pizza' },
        points: [
          p(610, 560, 60, 'le chorizo', 'the pepperoni'),
          p(500, 80, 60, 'la croûte', 'the crust'),
          p(390, 420, 60, 'le fromage', 'the cheese'),
        ],
      },
      {
        slug: 'fried-egg',
        difficulty: 2,
        draw: a.friedEgg,
        fr: { text: 'œuf au plat', aliases: ['œuf', 'oeuf sur le plat', 'œuf poêlé'] },
        en: { text: 'fried egg', aliases: ['egg', 'sunny side up'] },
        points: [
          p(460, 480, 60, 'le jaune', 'the yolk'),
          p(700, 640, 60, 'le blanc', 'the white'),
          p(560, 800, 60, 'le bord', 'the edge'),
        ],
      },
    ],
  },
  {
    slug: 'seed-objects',
    category: 'OBJECT',
    titleFr: 'Objets',
    titleEn: 'Objects',
    descriptionFr: 'Des objets de tous les jours, méconnaissables de près.',
    descriptionEn: 'Everyday objects, unrecognisable up close.',
    cards: [
      {
        slug: 'vinyl',
        difficulty: 2,
        draw: a.vinyl,
        fr: { text: 'disque vinyle', aliases: ['vinyle', 'disque', '33 tours', '45 tours'] },
        en: { text: 'vinyl record', aliases: ['vinyl', 'record', 'lp'] },
        points: [
          p(760, 300, 60, 'les sillons', 'the grooves'),
          p(500, 500, 60, "l'étiquette", 'the label'),
          p(880, 500, 55, 'le bord', 'the edge'),
        ],
      },
      {
        slug: 'dartboard',
        difficulty: 2,
        draw: a.dartboard,
        fr: { text: 'cible de fléchettes', aliases: ['cible', 'fléchettes', 'jeu de fléchettes'] },
        en: { text: 'dartboard', aliases: ['dart board', 'darts'] },
        points: [
          p(500, 500, 55, 'le centre', 'the bullseye'),
          p(500, 275, 55, 'le triple', 'the treble'),
          p(770, 640, 60, 'un secteur', 'a segment'),
        ],
      },
      {
        slug: 'clock',
        difficulty: 1,
        draw: a.clock,
        fr: { text: 'horloge', aliases: ['pendule', 'montre', 'réveil', 'cadran'] },
        en: { text: 'clock', aliases: ['watch', 'wall clock'] },
        points: [
          p(500, 500, 55, 'le centre', 'the centre'),
          p(500, 120, 55, 'midi', "twelve o'clock"),
          p(760, 330, 60, 'les aiguilles', 'the hands'),
        ],
      },
      {
        slug: 'button',
        difficulty: 2,
        draw: a.button,
        fr: { text: 'bouton', aliases: ['bouton de chemise', 'bouton de manteau'] },
        en: { text: 'button' },
        points: [
          p(500, 500, 60, 'le fil', 'the thread'),
          p(570, 430, 50, 'un trou', 'a hole'),
          p(830, 700, 60, 'le bord', 'the rim'),
        ],
      },
      {
        slug: 'dice',
        difficulty: 1,
        draw: a.dice,
        fr: { text: 'dé', aliases: ['dés', 'dé à jouer'] },
        en: { text: 'dice', aliases: ['die'] },
        points: [
          p(345, 545, 55, 'un point', 'a pip'),
          p(700, 390, 55, 'un point', 'a pip'),
          p(530, 360, 60, 'un coin', 'a corner'),
        ],
      },
      {
        slug: 'basketball',
        difficulty: 1,
        draw: a.basketball,
        fr: {
          text: 'ballon de basket',
          aliases: ['basket', 'basketball', 'ballon', 'ballon de basketball'],
        },
        en: { text: 'basketball', aliases: ['ball'] },
        points: [
          p(500, 500, 60, 'le croisement', 'the cross'),
          p(330, 330, 60, 'le grain', 'the texture'),
          p(660, 700, 60, 'une couture', 'a seam'),
        ],
      },
      {
        slug: 'tennis-ball',
        difficulty: 2,
        draw: a.tennisBall,
        fr: { text: 'balle de tennis', aliases: ['tennis', 'balle'] },
        en: { text: 'tennis ball', aliases: ['ball'] },
        points: [
          p(320, 500, 60, 'la couture', 'the seam'),
          p(500, 250, 60, 'le feutre', 'the felt'),
          p(690, 520, 60, 'la couture', 'the seam'),
        ],
      },
      {
        slug: 'piano',
        difficulty: 2,
        draw: a.piano,
        fr: { text: 'piano', aliases: ['clavier', 'touches de piano', 'synthé'] },
        en: { text: 'piano', aliases: ['keyboard', 'piano keys'] },
        points: [
          p(400, 560, 55, 'une touche noire', 'a black key'),
          p(650, 850, 60, 'les touches blanches', 'the white keys'),
          p(500, 200, 55, 'le feutre', 'the felt strip'),
        ],
      },
      {
        slug: 'guitar',
        difficulty: 2,
        draw: a.guitar,
        fr: { text: 'guitare', aliases: ['guitare acoustique', 'guitare sèche'] },
        en: { text: 'guitar', aliases: ['acoustic guitar'] },
        points: [
          p(500, 500, 60, 'la rosace', 'the sound hole'),
          p(500, 820, 55, 'le chevalet', 'the bridge'),
          p(500, 200, 55, 'les frettes', 'the frets'),
        ],
      },
      {
        slug: 'traffic-light',
        difficulty: 2,
        draw: a.trafficLight,
        fr: {
          text: 'feu tricolore',
          aliases: ['feu rouge', 'feu de signalisation', 'feu', 'feu de circulation'],
        },
        en: { text: 'traffic light', aliases: ['traffic lights', 'stoplight', 'traffic signal'] },
        points: [
          p(500, 235, 60, 'le rouge', 'the red light'),
          p(500, 735, 60, 'le vert', 'the green light'),
          p(400, 120, 55, 'la visière', 'the visor'),
        ],
      },
    ],
  },
  {
    slug: 'seed-animals',
    category: 'ANIMAL',
    titleFr: 'Animaux',
    titleEn: 'Animals',
    descriptionFr: 'Des bêtes dessinées, à reconnaître à un détail.',
    descriptionEn: 'Drawn creatures, to recognise from one detail.',
    cards: [
      {
        slug: 'ladybug',
        difficulty: 1,
        draw: b.ladybug,
        fr: { text: 'coccinelle', aliases: ['bête à bon dieu'] },
        en: { text: 'ladybug', aliases: ['ladybird', 'lady beetle'] },
        points: [
          p(600, 430, 55, 'un point', 'a spot'),
          p(500, 250, 60, 'la tête', 'the head'),
          p(500, 640, 60, 'les élytres', 'the wing cases'),
        ],
      },
      {
        slug: 'bee',
        difficulty: 2,
        draw: b.bee,
        fr: { text: 'abeille', aliases: ['guêpe', 'bourdon'] },
        en: { text: 'bee', aliases: ['wasp', 'bumblebee', 'honeybee'] },
        points: [
          p(520, 500, 60, 'les rayures', 'the stripes'),
          p(215, 480, 55, 'la tête', 'the head'),
          p(520, 310, 60, 'les ailes', 'the wings'),
        ],
      },
      {
        slug: 'fish',
        difficulty: 1,
        draw: b.fish,
        fr: { text: 'poisson', aliases: ['poisson clown', 'poisson rouge'] },
        en: { text: 'fish', aliases: ['clownfish', 'goldfish'] },
        points: [
          p(285, 455, 55, "l'œil", 'the eye'),
          p(620, 520, 60, 'les écailles', 'the scales'),
          p(860, 500, 60, 'la queue', 'the tail'),
        ],
      },
      {
        slug: 'owl',
        difficulty: 2,
        draw: b.owl,
        fr: { text: 'hibou', aliases: ['chouette'] },
        en: { text: 'owl' },
        points: [
          p(375, 400, 60, "l'œil", 'the eye'),
          p(500, 510, 55, 'le bec', 'the beak'),
          p(500, 740, 60, 'les plumes', 'the feathers'),
        ],
      },
      {
        slug: 'butterfly',
        difficulty: 1,
        draw: b.butterfly,
        fr: { text: 'papillon' },
        en: { text: 'butterfly', aliases: ['moth'] },
        points: [
          p(800, 330, 55, "l'ocelle", 'the eyespot'),
          p(500, 300, 55, 'la tête', 'the head'),
          p(280, 700, 60, "l'aile", 'the wing'),
        ],
      },
      {
        slug: 'turtle',
        difficulty: 2,
        draw: b.turtle,
        fr: { text: 'tortue', aliases: ['tortue de mer'] },
        en: { text: 'turtle', aliases: ['tortoise', 'sea turtle'] },
        points: [
          p(500, 520, 60, 'la carapace', 'the shell'),
          p(500, 165, 55, 'la tête', 'the head'),
          p(225, 330, 60, 'une patte', 'a flipper'),
        ],
      },
    ],
  },
];
