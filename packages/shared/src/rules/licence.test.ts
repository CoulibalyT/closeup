import { describe, expect, it } from 'vitest';
import { licenceTerms } from './licence.js';

describe('licenceTerms', () => {
  it('links a Creative Commons licence to its own page, in either spelling', () => {
    const typed = licenceTerms('CC BY-SA 4.0');
    expect(typed).toEqual({
      url: 'https://creativecommons.org/licenses/by-sa/4.0/',
      attribution: true,
      free: true,
    });
    expect(licenceTerms('cc-by-sa-4.0')).toEqual(typed);
    expect(licenceTerms('  cc  by-sa   4.0 ')).toEqual(typed);
  });

  it('keeps the country of a ported licence', () => {
    expect(licenceTerms('CC BY-SA 2.0 de').url).toBe(
      'https://creativecommons.org/licenses/by-sa/2.0/de/',
    );
    expect(licenceTerms('cc-by-2.5-fr').url).toBe(
      'https://creativecommons.org/licenses/by/2.5/fr/',
    );
  });

  it('asks nothing of public domain and CC0 pictures', () => {
    expect(licenceTerms('CC0')).toEqual({
      url: 'https://creativecommons.org/publicdomain/zero/1.0/',
      attribution: false,
      free: true,
    });
    expect(licenceTerms('CC0 1.0').free).toBe(true);
    expect(licenceTerms('Public domain')).toEqual({ url: null, attribution: false, free: true });
    expect(licenceTerms('pd').free).toBe(true);
  });

  it('names a non-commercial or no-derivatives licence, but does not call it free', () => {
    // A card is cropped: "no derivatives" forbids it, "non commercial" rules out ever selling.
    expect(licenceTerms('CC BY-NC 4.0')).toMatchObject({ attribution: true, free: false });
    expect(licenceTerms('CC BY-ND 4.0').free).toBe(false);
    expect(licenceTerms('CC BY-NC-SA 3.0').url).toBe(
      'https://creativecommons.org/licenses/by-nc-sa/3.0/',
    );
  });

  it('leaves anything else alone rather than guessing', () => {
    for (const licence of ['GFDL', 'Licence Art Libre', 'Attribution', 'CC BY', '', 'CC BY-SA 4']) {
      expect(licenceTerms(licence)).toEqual({ url: null, attribution: false, free: false });
    }
  });
});
