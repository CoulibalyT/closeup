/**
 * The answer a dropped file suggests: its name without extension, separators as spaces, a
 * trailing copy number dropped, the first letter capitalised. Apostrophes written as such stay.
 */
export function answerFromFileName(name: string): string {
  const stem = name
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s*\(\d+\)\s*$/, '')
    // A copy number ("tour-eiffel-2") goes; a longer number is part of the name ("IMG 0042").
    .replace(/\s+\d{1,2}$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  return stem ? stem.charAt(0).toLocaleUpperCase('fr') + stem.slice(1) : '';
}
