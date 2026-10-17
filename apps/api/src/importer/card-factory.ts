import { Injectable } from '@nestjs/common';
import type { Category } from '@closeup/shared';
import { PrismaService } from '../prisma/prisma.module.js';
import type { StoredCandidate } from './candidates.js';

/** Imported cards are known by their Wikidata item, so that a subject is never imported twice. */
export const slugOf = (qid: string) => `wd-${qid}`;

/**
 * A card from a Wikidata subject, as the hand import and the mass import both make them: the
 * answers and the credit the server found, a picture still to come from the worker.
 */
@Injectable()
export class CardFactory {
  constructor(private readonly prisma: PrismaService) {}

  /** Null when the subject is already in that pack. */
  async fromCandidate(
    packId: string,
    candidate: StoredCandidate,
    facts: { category: Category; isPerson: boolean; difficulty?: 1 | 2 | 3; bulkImportId?: string },
  ): Promise<string | null> {
    const slug = slugOf(candidate.qid);
    const existing = await this.prisma.card.findFirst({
      where: { packId, slug },
      select: { id: true },
    });
    if (existing) return null;
    const answers = (['fr', 'en'] as const).flatMap((locale) => {
      const answer = candidate.answers[locale];
      return answer ? [{ locale, text: answer.text, aliases: answer.aliases }] : [];
    });
    try {
      const card = await this.prisma.card.create({
        data: {
          packId,
          slug,
          source: 'WIKIMEDIA',
          status: 'PROCESSING',
          category: facts.category,
          difficulty: facts.difficulty ?? candidate.difficulty,
          isPerson: facts.isPerson,
          bulkImportId: facts.bulkImportId,
          creditAuthor: candidate.credit!.author,
          creditLicence: candidate.credit!.licence,
          creditSourceUrl: candidate.credit!.sourceUrl,
          answers: { create: answers },
        },
        select: { id: true },
      });
      return card.id;
    } catch (error) {
      // Two imports of the same subject at once: the second one finds the first one's card.
      if ((error as { code?: string }).code === 'P2002') return null;
      throw error;
    }
  }
}
