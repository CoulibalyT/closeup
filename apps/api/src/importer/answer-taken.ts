import type { PrismaService } from '../prisma/prisma.module.js';

/** Folded for comparison in SQL: case and the accents of French. */
const FOLD_FROM = 'àâäáãåçéèêëíìîïñóòôöõúùûüýÿœæÀÂÄÁÃÅÇÉÈÊËÍÌÎÏÑÓÒÔÖÕÚÙÛÜÝŸ';
const FOLD_TO = 'aaaaaaceeeeiiiinooooouuuuyyoaAAAAAACEEEEIIIINOOOOOUUUUYY';

/**
 * Whether a catalogue card already gives this French answer, or is about to: house packs only
 * (a player's private card blocks nothing), live or on its way, case and accents aside. The
 * mass import and the dataset import both ask it, so a subject never comes in twice.
 */
export async function answerTaken(prisma: PrismaService, text: string): Promise<boolean> {
  const same = await prisma.$queryRaw<unknown[]>`
    SELECT 1 FROM "CardAnswer" a
    JOIN "Card" c ON c.id = a."cardId"
    JOIN "Pack" p ON p.id = c."packId"
    WHERE a.locale = 'fr'
      AND p."ownerId" IS NULL
      AND c.status IN ('LIVE', 'READY', 'PROCESSING', 'NEEDS_POINTS')
      AND lower(translate(a.text, ${FOLD_FROM}, ${FOLD_TO}))
        = lower(translate(${text}, ${FOLD_FROM}, ${FOLD_TO}))
    LIMIT 1`;
  return same.length > 0;
}
