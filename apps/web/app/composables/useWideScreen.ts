/**
 * The width at which the pages switch to their computer layout. Stylesheets cannot read a
 * variable in a media query, so they repeat `1080px`: change both together.
 */
export const WIDE_SCREEN_QUERY = '(min-width: 1080px)';

/**
 * True on a computer-sized window. The layouts themselves switch in CSS; this is only for what
 * CSS cannot decide, such as how many rows a ranking shows.
 */
export function useWideScreen(): Readonly<Ref<boolean>> {
  const wide = ref(false);
  let query: MediaQueryList | undefined;
  const update = () => (wide.value = query?.matches ?? false);

  onMounted(() => {
    query = window.matchMedia(WIDE_SCREEN_QUERY);
    update();
    query.addEventListener('change', update);
  });
  onBeforeUnmount(() => query?.removeEventListener('change', update));

  return readonly(wide);
}
