import { describe, expect, it } from 'vitest';
import { dealableBonuses } from './bonuses.js';

describe('dealableBonuses', () => {
  it('deals only self bonuses in solo', () => {
    expect(dealableBonuses({ mode: 'solo', answerMode: 'text', display: 'phones' })).toEqual([
      'zoomOut',
      'secondZone',
      'initials',
      'category',
      'shield',
    ]);
  });

  it('deals attacks with others, and removing two options only in multiple choice', () => {
    const text = dealableBonuses({ mode: 'private', answerMode: 'text', display: 'phones' });
    expect(text).toEqual(expect.arrayContaining(['blur', 'flip', 'freeze', 'stealPoints']));
    expect(text).not.toContain('removeTwo');
    expect(dealableBonuses({ mode: 'private', answerMode: 'mcq', display: 'phones' })).toContain(
      'removeTwo',
    );
  });

  it('deals no Blur or Flip on a big screen: they would blur it for everyone', () => {
    const big = dealableBonuses({ mode: 'private', answerMode: 'mcq', display: 'bigscreen' });
    expect(big).toEqual([
      'zoomOut',
      'secondZone',
      'initials',
      'category',
      'removeTwo',
      'shield',
      'freeze',
      'stealBonus',
      'stealPoints',
    ]);
  });
});
