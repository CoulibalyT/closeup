import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.module.js';
import { WIKIMEDIA, type WikimediaApi } from './wikimedia.client.js';

/**
 * Fills the gender of people cards from Wikidata, so that multiple-choice options stay within
 * the answer's gender. A person's card carries their QID in its slug (`wd-Q…`, `wd-Q…-p2`).
 * Idempotent: only cards still without a gender are looked up.
 */
@Injectable()
export class CardGenders {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(WIKIMEDIA) private readonly wikimedia: WikimediaApi,
  ) {}

  async fill(): Promise<{ cards: number; filled: number }> {
    const cards = await this.prisma.card.findMany({
      where: { gender: null, slug: { startsWith: 'wd-Q' } },
      select: { id: true, slug: true },
    });
    const byQid = new Map<string, string[]>();
    for (const card of cards) {
      const qid = /^wd-(Q\d+)/.exec(card.slug ?? '')?.[1];
      if (qid) byQid.set(qid, [...(byQid.get(qid) ?? []), card.id]);
    }
    const genders = await this.wikimedia.genders([...byQid.keys()]);
    let filled = 0;
    for (const gender of ['FEMALE', 'MALE', 'OTHER'] as const) {
      const ids = [...genders].flatMap(([qid, g]) => (g === gender ? (byQid.get(qid) ?? []) : []));
      if (!ids.length) continue;
      const { count } = await this.prisma.card.updateMany({
        where: { id: { in: ids } },
        data: { gender },
      });
      filled += count;
    }
    return { cards: cards.length, filled };
  }
}
