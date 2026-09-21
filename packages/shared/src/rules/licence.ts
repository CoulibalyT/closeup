/**
 * What a credit's licence asks of whoever shows the picture. Credits are text, typed by an admin
 * ("CC BY-SA 4.0") or copied from Commons, which also has codes ("cc-by-sa-2.0-de"): both
 * spellings are read here, and anything else is left alone rather than guessed at.
 */
export interface LicenceTerms {
  /** The licence's own page. Creative Commons licences require a link to it. */
  url: string | null;
  /**
   * Attribution licences also require saying the picture was changed, and every card is: it is
   * cut into zoom levels. Public domain and CC0 ask for nothing of the kind.
   */
  attribution: boolean;
  /** Free to show in the game at all: public domain, CC0, CC BY or CC BY-SA. */
  free: boolean;
}

const CC0_URL = 'https://creativecommons.org/publicdomain/zero/1.0/';

// "cc by-sa 4.0", "cc-by-sa-2.0-de", "cc by 2.0 de": the kind, the version, and a country port.
const CREATIVE_COMMONS =
  /^cc[ -](by(?:[ -]nc)?(?:[ -](?:sa|nd))?)[ -](\d\.\d)(?:[ -]([a-z]{2,3}))?$/;

export function licenceTerms(licence: string): LicenceTerms {
  const text = licence.trim().toLowerCase().replace(/\s+/g, ' ');
  if (/^cc0(?: 1\.0)?$/.test(text) || text === 'cc zero') {
    return { url: CC0_URL, attribution: false, free: true };
  }
  if (text === 'public domain' || text === 'pd' || text === 'domaine public') {
    return { url: null, attribution: false, free: true };
  }
  const match = CREATIVE_COMMONS.exec(text);
  if (match) {
    const kind = match[1]!.replace(/ /g, '-');
    const port = match[3] ? `${match[3]}/` : '';
    return {
      url: `https://creativecommons.org/licenses/${kind}/${match[2]}/${port}`,
      attribution: true,
      free: kind === 'by' || kind === 'by-sa',
    };
  }
  return { url: null, attribution: false, free: false };
}
