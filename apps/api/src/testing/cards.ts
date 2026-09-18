import type { EngineCard } from '../game/engine/types.js';

/** A card whose every secret is a recognisable string, so a leak shows up in a text search. */
export const SECRETS = {
  answer: 'orange-SECRET-ANSWER',
  alias: 'agrume-SECRET-ALIAS',
  cardId: 'SECRET-CARD-ID',
  zoomPointId: 'SECRET-ZOOM-POINT-ID',
  cropId: 'SECRET-CROP-ID',
  imageId: 'SECRET-IMAGE-ID',
} as const;

export function engineCard(n = 1, options: { mcq?: boolean; secret?: boolean } = {}): EngineCard {
  const secret = options.secret ?? false;
  return {
    cardId: secret ? SECRETS.cardId : `card-${n}`,
    zoomPointId: secret ? SECRETS.zoomPointId : `zp-${n}`,
    answers: {
      primary: secret
        ? { text: SECRETS.answer, aliases: [SECRETS.alias] }
        : { text: 'orange', aliases: [] },
    },
    ...(options.mcq
      ? {
          options: [
            { id: 'a', label: 'citron' },
            { id: 'b', label: 'orange' },
            { id: 'c', label: 'pomme' },
            { id: 'd', label: 'poire' },
          ],
          correctOptionId: 'b',
        }
      : {}),
    crops: [0, 1, 2, 3].map((level) => ({
      cropId: `${secret ? SECRETS.cropId : `crop-${n}`}-${level}`,
      focus: { x: 0.5, y: 0.5 },
      scaleFromPrev: level === 0 ? null : 1.8,
    })),
    reveal: {
      imageId: secret ? SECRETS.imageId : `image-${n}`,
      zone: { cx: 0.575, cy: 0.425, r: 0.08 },
      zoneLabel: 'la pulpe',
      answer: secret ? SECRETS.answer : 'orange',
      credit: { author: 'closeup', licence: 'CC0' },
    },
  };
}
