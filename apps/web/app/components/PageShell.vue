<script setup lang="ts">
/**
 * Frame of the pages around the game (account, statistics, rankings, packs): a title and the
 * way home. On a computer the header becomes the curtain band, title included, and `wide` lets a
 * page of lists use the width; forms keep a centred column, where a long line would only be
 * harder to read.
 */
withDefaults(defineProps<{ title: string; wide?: boolean }>(), { wide: false });
const { t } = useI18n();
const localePath = useLocalePath();
const { appName } = useRuntimeConfig().public;
</script>

<template>
  <main class="page" :class="{ wide }">
    <header class="bar">
      <NuxtLink class="back" :to="localePath('/')">← {{ t('play.home') }}</NuxtLink>
      <NuxtLink class="brand display" :to="localePath('/')">{{ appName }}</NuxtLink>
      <nav class="site" :aria-label="t('home.more')">
        <NuxtLink :to="localePath('/packs')">{{ t('catalogue.short') }}</NuxtLink>
        <NuxtLink :to="localePath('/me/packs')">{{ t('myPacks.heading') }}</NuxtLink>
        <NuxtLink :to="localePath('/rankings')">{{ t('rankings.heading') }}</NuxtLink>
        <NuxtLink :to="localePath('/stats')">{{ t('stats.short') }}</NuxtLink>
        <NuxtLink :to="localePath('/account')">{{ t('account.short') }}</NuxtLink>
      </nav>
      <ThemeSwitch class="theme" />
      <h1 class="display title">{{ title }}</h1>
    </header>
    <slot />
  </main>
</template>

<!-- Not scoped: the forms and blocks of these pages share it. -->
<style>
.page {
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 100dvh;
  max-width: 460px;
  margin: 0 auto;
  padding: calc(var(--space-4) + env(safe-area-inset-top)) var(--space-4) var(--space-6);
}
/* On a phone the header is only the way back: the wrapper steps aside so that the link stays a
   direct child of the column, as it always was. */
.page > .bar {
  display: contents;
}
.page .brand,
.page .site {
  display: none;
}
/* On a phone the theme button sits in the top right corner, level with the way back. */
.page .theme {
  position: absolute;
  top: calc(var(--space-4) + env(safe-area-inset-top) + 2px);
  right: var(--space-2);
  color: var(--muted);
}
.page .back {
  display: inline-flex;
  align-items: center;
  align-self: flex-start;
  min-height: var(--tap);
  color: var(--muted);
}
.page .title {
  margin: var(--space-2) 0 var(--space-4);
  /* The display face is 140% wide: a long word ("Classement") needs a smaller step than usual. */
  font-size: clamp(28px, 8.5vw, 44px);
  overflow-wrap: break-word;
}
.page .block {
  margin-top: var(--space-4);
  padding: var(--space-4);
  border-radius: var(--radius);
  background: var(--surface);
}
.page h2 {
  margin: 0 0 var(--space-3);
  font-size: 17px;
}
.page form {
  display: grid;
  gap: var(--space-2);
}
.page label {
  font-size: 15px;
  font-weight: 600;
}
.page input[type='email'],
.page input[type='password'] {
  width: 100%;
  min-height: var(--tap);
  padding: 0 var(--space-3);
  border: 1.5px solid var(--line);
  border-radius: var(--radius);
  background: var(--bg);
  /* 17 px: below 16, iOS Safari zooms into a focused field. */
  font-size: 17px;
}
.page .error {
  color: var(--danger);
  font-weight: 600;
}
.page .good {
  color: var(--good);
  font-weight: 600;
}
.page .link {
  min-height: 44px;
  padding: 0;
  border: 0;
  background: none;
  color: var(--accent);
  text-align: left;
  text-decoration: underline;
  cursor: pointer;
}
.page .link.danger {
  color: var(--danger);
}
.page ul.plain {
  margin: 0;
  padding: 0;
  list-style: none;
}
.page .tabs {
  display: flex;
  gap: var(--space-2);
}
.page .tabs button {
  flex: 1;
  min-height: var(--tap);
  border: 1.5px solid var(--line);
  border-radius: var(--radius);
  background: var(--bg);
  font-weight: 600;
  cursor: pointer;
}
.page .tabs button[aria-pressed='true'] {
  border-color: var(--ink);
  background: var(--ink);
  color: var(--bg);
}

/* Computer: the header becomes the curtain band, with the name, the links and the title; the
   page's content sits under it in the 1208 px column (`wide`) or the 560 px one. Same breakpoint
   as useWideScreen. */
@media (min-width: 1080px) {
  /* Three columns: the band spans them, the content takes the middle one. The pages' own rules
     set their margins, so the centring cannot rely on `margin: auto`. */
  .page {
    display: grid;
    grid-template-columns:
      minmax(var(--space-10), 1fr)
      min(1208px, 100% - 2 * var(--space-10))
      minmax(var(--space-10), 1fr);
    align-content: start;
    max-width: none;
    padding: 0 0 var(--space-10);
  }
  .page > * {
    grid-column: 2;
  }
  .page > .bar {
    grid-column: 1 / -1;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    grid-template-areas:
      'brand site theme'
      'title title title';
    align-items: center;
    column-gap: var(--space-6);
    margin-bottom: var(--space-10);
    padding: var(--space-4) max(var(--space-10), (100% - 1208px) / 2) var(--space-10);
    background-color: var(--curtain);
    background-image: var(--curtain-folds);
    color: var(--curtain-ink);
    /* The title is sized on the band, not on the window. */
    container-type: inline-size;
  }
  .page .back {
    display: none;
  }
  .page .brand {
    grid-area: brand;
    display: inline-flex;
    align-items: center;
    min-height: var(--tap);
    color: inherit;
    font-size: 26px;
    font-stretch: 140%;
    text-decoration: none;
  }
  .page .theme {
    grid-area: theme;
    position: static;
    color: inherit;
  }
  .page .site {
    grid-area: site;
    display: flex;
    justify-content: flex-end;
    gap: var(--space-6);
  }
  .page .site a {
    display: inline-flex;
    align-items: center;
    min-height: var(--tap);
    color: inherit;
    opacity: 0.75;
  }
  .page .site a[aria-current='page'] {
    font-weight: 700;
    text-decoration: none;
    opacity: 1;
  }
  /* A twelve-letter word ("Confirmation") is about 10.5 em wide in the display face: 9.5cqi
     keeps it whole on the band's width, 96 px keeps a two-word title to two lines. */
  .page .title {
    grid-area: title;
    margin: var(--space-10) 0 0;
    font-size: min(96px, 9.5cqi);
    overflow-wrap: anywhere;
  }
  .page:not(.wide) > :not(.bar) {
    width: min(560px, 100%);
    justify-self: center;
  }
}
</style>
