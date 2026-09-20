import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { type Locale, MULTIPLE_CHOICE, revealZone, ZOOM } from '@closeup/shared';
import { normalise } from '../game/engine/matching.js';
import type { AnswerMode, EngineCard } from '../game/engine/types.js';
import { PrismaService } from '../prisma/prisma.module.js';
import { chooseDistractors, pickWeighted, shuffle } from './distractors.js';
import { type DeckScope, playableWhere } from './playable.js';

/** Phones get the small crops; the big screen (phase 4) will ask for the large ones. */
const PHONE_CROP_PX = ZOOM.cropSizesPx[0];

export interface Deck {
  cardIds: string[];
  /** Normalised answers of the whole deck: one card's answer must not pass as a typo of another. */
  lexicon: string[];
}

@Injectable()
export class DeckService {
  constructor(private readonly prisma: PrismaService) {}

  async build(rounds: number, scope: DeckScope): Promise<Deck> {
    const cards = await this.prisma.card.findMany({
      where: playableWhere(scope),
      select: { id: true, answers: { select: { text: true, aliases: true } } },
    });
    const picked = shuffle(cards, Math.random).slice(0, rounds);
    const lexicon = picked.flatMap((card) =>
      card.answers.flatMap((answer) => [answer.text, ...answer.aliases].map(normalise)),
    );
    return { cardIds: picked.map((card) => card.id), lexicon: [...new Set(lexicon)] };
  }

  /**
   * Everything the engine needs to play a card, or `null` if it cannot be played *right now*.
   * Called at the start of every round, which is what makes disabling a pack immediate.
   */
  async load(
    cardId: string,
    language: Locale,
    answerMode: AnswerMode,
    scope: DeckScope = { kind: 'room' },
  ): Promise<EngineCard | null> {
    const card = await this.prisma.card.findFirst({
      where: { id: cardId, ...playableWhere(scope) },
      include: {
        answers: true,
        image: true,
        zoomPoints: { include: { crops: { where: { sizePx: PHONE_CROP_PX } } } },
      },
    });
    if (!card?.image?.revealKey) return null;

    const playable = card.zoomPoints.filter((point) => point.crops.length > ZOOM.maxLevel);
    const point = pickWeighted(playable, Math.random);
    const primary = card.answers.find((a) => a.locale === language) ?? card.answers[0];
    if (!point || !primary) return null;
    const fallback = card.answers.find((a) => a.id !== primary.id);

    // For the "second zone" bonus: the closest view of another zoom point of the same image.
    const elsewhere = pickWeighted(
      playable.filter((candidate) => candidate.id !== point.id),
      Math.random,
    );
    const second = elsewhere?.crops.find((crop) => crop.level === 0);

    const crops = [...point.crops]
      .sort((a, b) => a.level - b.level)
      .map((crop) => ({
        cropId: crop.id,
        focus: { x: crop.focusX, y: crop.focusY },
        scaleFromPrev: crop.scaleFromPrev,
      }));

    return {
      cardId: card.id,
      zoomPointId: point.id,
      answers: {
        primary: { text: primary.text, aliases: primary.aliases },
        fallback: fallback && { text: fallback.text, aliases: fallback.aliases },
      },
      crops,
      category: card.category,
      secondZone: second && {
        cropId: second.id,
        focus: { x: second.focusX, y: second.focusY },
        scaleFromPrev: null,
      },
      reveal: {
        imageId: card.image.id,
        zone: revealZone(card.image, point),
        zoneLabel: (language === 'fr' ? point.labelFr : point.labelEn) ?? undefined,
        answer: primary.text,
        credit: {
          author: card.creditAuthor ?? '',
          licence: card.creditLicence ?? '',
          sourceUrl: card.creditSourceUrl ?? undefined,
        },
      },
      ...(answerMode === 'mcq' ? await this.options(card, primary.text, language, scope) : {}),
    };
  }

  private async options(
    card: { id: string; category: string; difficulty: number },
    label: string,
    language: Locale,
    scope: DeckScope,
  ): Promise<Pick<EngineCard, 'options' | 'correctOptionId'>> {
    const others = await this.prisma.card.findMany({
      where: {
        ...playableWhere(scope),
        category: card.category as never,
        id: { not: card.id },
      },
      select: { id: true, difficulty: true, category: true, answers: true },
    });
    const pool = others.flatMap((other) => {
      const answer = other.answers.find((a) => a.locale === language) ?? other.answers[0];
      return answer ? [{ ...other, label: answer.text }] : [];
    });
    const wrong = chooseDistractors(
      { ...card, label },
      pool,
      MULTIPLE_CHOICE.optionCount - 1,
      Math.random,
    );

    // Fresh ids every round: an option id learnt in one game means nothing in the next.
    const correctOptionId = randomUUID();
    const options = shuffle(
      [
        { id: correctOptionId, label },
        ...wrong.map((option) => ({ id: randomUUID(), label: option.label })),
      ],
      Math.random,
    );
    return { options, correctOptionId };
  }
}
