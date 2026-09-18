/**
 * Keeps `--viewport-height` equal to the height that is really visible. On iOS Safari the
 * on-screen keyboard does not resize the layout viewport, so `100dvh` alone would leave the
 * answer field hidden behind it; with this, the game screen shrinks and the lens stays in view
 * above a pinned field.
 */
export function useVisualViewport(): void {
  if (import.meta.server) return;
  const viewport = window.visualViewport;
  if (!viewport) return;

  const root = document.documentElement;
  const update = () => {
    root.style.setProperty('--viewport-height', `${viewport.height}px`);
    // Safari also scrolls the page up to reveal the field; keep the screen anchored.
    if (viewport.offsetTop > 0) window.scrollTo(0, 0);
  };

  onMounted(() => {
    update();
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
  });
  onBeforeUnmount(() => {
    viewport.removeEventListener('resize', update);
    viewport.removeEventListener('scroll', update);
    root.style.removeProperty('--viewport-height');
  });
}
