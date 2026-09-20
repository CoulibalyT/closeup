import { describe, expect, it } from 'vitest';
import { type PublicationFacts, publishBlockers } from './publication.js';

const ready: PublicationFacts = {
  hasImage: true,
  processing: false,
  rightsConfirmed: true,
  credit: { author: 'Awa Diop', licence: 'CC BY 4.0' },
  answers: { fr: 'grille-pain', en: 'toaster' },
  points: [{ cropsReady: true }, { cropsReady: true }],
};

describe('publishBlockers', () => {
  it('lets a complete card go live', () => {
    expect(publishBlockers(ready)).toEqual([]);
  });

  it('never publishes a card without a credit', () => {
    expect(publishBlockers({ ...ready, credit: { author: 'Awa Diop', licence: '' } })).toEqual([
      'CREDIT_MISSING',
    ]);
    expect(publishBlockers({ ...ready, credit: { author: '   ', licence: 'CC0' } })).toEqual([
      'CREDIT_MISSING',
    ]);
    expect(publishBlockers({ ...ready, credit: {} })).toEqual(['CREDIT_MISSING']);
  });

  it('never publishes an upload whose rights were not confirmed', () => {
    expect(publishBlockers({ ...ready, rightsConfirmed: false })).toEqual(['RIGHTS_NOT_CONFIRMED']);
  });

  it('asks for the answer in both languages', () => {
    expect(publishBlockers({ ...ready, answers: { fr: 'grille-pain' } })).toEqual([
      'ANSWER_EN_MISSING',
    ]);
    expect(publishBlockers({ ...ready, answers: { fr: ' ', en: 'toaster' } })).toEqual([
      'ANSWER_FR_MISSING',
    ]);
  });

  it('asks for at least two zoom points, each with all its crops', () => {
    expect(publishBlockers({ ...ready, points: [{ cropsReady: true }] })).toEqual([
      'TOO_FEW_POINTS',
    ]);
    expect(
      publishBlockers({ ...ready, points: [{ cropsReady: true }, { cropsReady: false }] }),
    ).toEqual(['CROPS_MISSING']);
  });

  it('says only the root cause when there is no image yet, or while the worker is busy', () => {
    const empty = { ...ready, hasImage: false, credit: {}, answers: {}, points: [] };
    expect(publishBlockers(empty)).toEqual(['NO_IMAGE']);
    expect(publishBlockers({ ...ready, processing: true, points: [] })).toEqual(['PROCESSING']);
  });

  it('lists everything that is missing on a fresh upload', () => {
    expect(
      publishBlockers({ ...ready, rightsConfirmed: true, credit: {}, answers: {}, points: [] }),
    ).toEqual(['CREDIT_MISSING', 'ANSWER_FR_MISSING', 'ANSWER_EN_MISSING', 'TOO_FEW_POINTS']);
  });
});
