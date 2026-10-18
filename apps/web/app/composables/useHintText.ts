import type { RoundHint } from '@closeup/shared';

/** The room's hint as one line: the written hint, or "Monument · T··· E·····". */
export function useHintText() {
  const { t } = useI18n();
  return (hint: RoundHint): string =>
    hint.text ??
    [hint.category ? t(`category.${hint.category}`) : null, hint.initials]
      .filter(Boolean)
      .join(' · ');
}
