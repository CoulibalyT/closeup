import { type PublishBlocker, ZOOM_POINTS } from '../schemas/admin.js';

/** What the rule needs to know about a card, whoever produced it (seed, admin, importer). */
export interface PublicationFacts {
  hasImage: boolean;
  /** The worker is still ingesting the image or cutting crops. */
  processing: boolean;
  /** Uploads only: the uploader ticked "I have the right to use this image". */
  rightsConfirmed: boolean;
  credit: { author?: string | null; licence?: string | null };
  answers: { fr?: string | null; en?: string | null };
  points: { cropsReady: boolean }[];
}

const filled = (text?: string | null) => Boolean(text?.trim());

/**
 * Why a card cannot go live, most fundamental reason first. Empty means it can. The one rule that
 * is not about playability is the credit: **a card without a credit cannot be published**.
 */
export function publishBlockers(card: PublicationFacts): PublishBlocker[] {
  if (!card.hasImage) return ['NO_IMAGE'];
  if (card.processing) return ['PROCESSING'];

  const blockers: PublishBlocker[] = [];
  if (!card.rightsConfirmed) blockers.push('RIGHTS_NOT_CONFIRMED');
  if (!filled(card.credit.author) || !filled(card.credit.licence)) blockers.push('CREDIT_MISSING');
  if (!filled(card.answers.fr)) blockers.push('ANSWER_FR_MISSING');
  if (!filled(card.answers.en)) blockers.push('ANSWER_EN_MISSING');
  if (card.points.length < ZOOM_POINTS.min) blockers.push('TOO_FEW_POINTS');
  else if (card.points.some((point) => !point.cropsReady)) blockers.push('CROPS_MISSING');
  return blockers;
}
