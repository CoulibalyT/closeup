/** The colour themes a visitor may choose; `auto` follows the device. */
export const THEMES = ['auto', 'light', 'rose', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

/** Same key as the inline script in nuxt.config.ts, which applies it before the first paint. */
export const THEME_KEY = 'closeup-theme';

/** The page background of each theme, for the browser bar (`theme-color`). */
const BAR: Record<Exclude<Theme, 'auto'>, string> = {
  light: '#e9edf3',
  rose: '#f6e8ea',
  dark: '#0c1130',
};

/**
 * The visitor's colour theme, remembered on this device only (no account needed, nothing sent).
 * `auto` removes the attribute, and the CSS follows `prefers-color-scheme`.
 */
export function useTheme() {
  const theme = useState<Theme>('theme', () => 'auto');

  onMounted(() => {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved && (THEMES as readonly string[]).includes(saved)) theme.value = saved as Theme;
    } catch {
      // Storage refused (private window): the device's scheme it is.
    }
  });

  function setTheme(next: Theme): void {
    theme.value = next;
    const root = document.documentElement;
    if (next === 'auto') delete root.dataset.theme;
    else root.dataset.theme = next;
    try {
      if (next === 'auto') localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, next);
    } catch {
      // Not remembered, still applied.
    }
    const dark =
      next === 'dark' || (next === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
    const colour = next === 'auto' ? BAR[dark ? 'dark' : 'light'] : BAR[next];
    for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
      meta.content = colour;
    }
  }

  return { theme, setTheme };
}
