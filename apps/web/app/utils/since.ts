/** How far back the admin looks: what an import or a review did in the last hours or days. */
export const PERIODS = ['all', '1h', '24h', '7d', '30d'] as const;
export type Period = (typeof PERIODS)[number];

const SPAN: Record<Exclude<Period, 'all'>, number> = {
  '1h': 3_600_000,
  '24h': 86_400_000,
  '7d': 7 * 86_400_000,
  '30d': 30 * 86_400_000,
};

/** True when the date falls inside the period (always for "all"; never for no date). */
export function within(iso: string | null | undefined, period: Period, now = Date.now()): boolean {
  if (period === 'all') return true;
  if (!iso) return false;
  return now - Date.parse(iso) <= SPAN[period];
}

/** "il y a 3 h", "2 days ago": the largest unit that fits. */
export function ago(iso: string, locale: string, now = Date.now()): string {
  const seconds = Math.round((Date.parse(iso) - now) / 1000);
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ];
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  }
  return format.format(0, 'minute');
}
