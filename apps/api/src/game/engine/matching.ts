/**
 * Free-text answer matching. Ported from the prototype's `judge()`, then widened from people's
 * names to any subject: aliases, two languages, and stricter rules for short words ("chat" must
 * not accept "char"). Pure and server only: the client never learns why a guess was accepted.
 *
 * The engine does not know what a card depicts. "Family name alone" is just an alias that the
 * authoring tools add for people.
 */

export type Verdict = 'correct' | 'close' | 'wrong' | 'empty';

export interface AnswerSet {
  text: string;
  aliases: string[];
}

export interface CardAnswers {
  /** Answers in the room's language. */
  primary: AnswerSet;
  /** Answers in the other language, accepted as a fallback. */
  fallback?: AnswerSet;
}

// Letters that Unicode decomposition leaves untouched.
const FOLDED: Record<string, string> = { œ: 'oe', æ: 'ae', ß: 'ss', ł: 'l', ø: 'o', đ: 'd' };

const LEADING_ARTICLE = /^(?:de la|de l|le|la|les|l|un|une|des|du|the|an|a) (?=\S)/;

export function normalise(input: string): string {
  const folded = input
    .toLowerCase()
    .replace(/[œæßłøđ]/g, (letter) => FOLDED[letter] ?? letter)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return folded.replace(LEADING_ARTICLE, '');
}

/** Optimal string alignment: Levenshtein where swapping two neighbours costs one, as on a phone. */
export function editDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[][] = Array.from({ length: rows }, (_, i) =>
    Array.from({ length: cols }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  const at = (i: number, j: number) => d[i]?.[j] ?? 0;

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(at(i - 1, j) + 1, at(i, j - 1) + 1, at(i - 1, j - 1) + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        best = Math.min(best, at(i - 2, j - 2) + 1);
      }
      d[i]![j] = best;
    }
  }
  return at(rows - 1, cols - 1);
}

/** Typos forgiven for an answer of this length. */
function tolerance(length: number): number {
  if (length <= 4) return 0;
  return length <= 8 ? 1 : 2;
}

const CLOSE_MARGIN = 2;
const CLOSE_MAX_RATIO = 0.4;
const CLOSE_MIN_LENGTH = 5;
const CLOSE_MIN_WORD = 4;

/**
 * How far a guess may be and still earn "you're close". A fixed margin alone is too generous on
 * short words: 3 letters off a 5-letter answer ("chou" for "matou") is a different word.
 */
function closeBound(length: number): number {
  return Math.min(tolerance(length) + CLOSE_MARGIN, Math.ceil(length * CLOSE_MAX_RATIO));
}

/**
 * @param lexicon normalised answers of the *other* cards in play. A guess that is exactly one of
 *   them is a different word, not a typo: "boule" must not pass for "poule".
 */
export function matchAnswer(
  guess: string,
  answers: CardAnswers,
  lexicon?: ReadonlySet<string>,
): Verdict {
  const g = normalise(guess);
  if (!g) return 'empty';

  const candidates = [answers.primary, answers.fallback]
    .flatMap((set) => (set ? [set.text, ...set.aliases] : []))
    .map(normalise)
    .filter(Boolean);

  if (candidates.includes(g)) return 'correct';
  const isAnotherCard = lexicon?.has(g) ?? false;

  let close = false;
  for (const candidate of candidates) {
    const allowed = tolerance(candidate.length);
    const distance = editDistance(g, candidate);
    if (distance <= allowed && !isAnotherCard) return 'correct';

    if (candidate.length >= CLOSE_MIN_LENGTH && distance <= closeBound(candidate.length)) {
      close = true;
    }

    const words = candidate.split(' ');
    if (
      words.length > 1 &&
      words.some((word) => word.length >= CLOSE_MIN_WORD && editDistance(g, word) <= 1)
    ) {
      close = true;
    }
  }
  return close && !isAnotherCard ? 'close' : 'wrong';
}
