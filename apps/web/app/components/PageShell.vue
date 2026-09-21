<script setup lang="ts">
/**
 * Frame of the pages around the game (account, statistics, rankings, packs): a title and the
 * way home. On a computer the way home becomes a site header, and `wide` lets a page of lists
 * use the width; forms keep a centred column, where a long line would only be harder to read.
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
    </header>
    <h1 class="display">{{ title }}</h1>
    <slot />
  </main>
</template>

<!-- Not scoped: the forms and blocks of these pages share it. -->
<style>
.page {
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
.page .back {
  display: inline-flex;
  align-items: center;
  align-self: flex-start;
  min-height: var(--tap);
  color: var(--muted);
}
.page > h1 {
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

/* Computer: a site header across the top, then either the page's own width (`wide`) or a
   centred column. Same breakpoint as useWideScreen. */
@media (min-width: 1080px) {
  .page {
    max-width: 1208px;
    padding-inline: var(--space-6);
  }
  .page > .bar {
    display: flex;
    align-items: center;
    gap: var(--space-6);
    margin-bottom: var(--space-10);
    padding-bottom: var(--space-4);
    border-bottom: 1px solid var(--line);
  }
  .page .back {
    display: none;
  }
  .page .brand {
    display: inline-flex;
    align-items: center;
    min-height: var(--tap);
    color: var(--ink);
    font-size: 26px;
    font-stretch: 140%;
    text-decoration: none;
  }
  .page .site {
    display: flex;
    gap: var(--space-6);
    margin-left: auto;
  }
  .page .site a {
    display: inline-flex;
    align-items: center;
    min-height: var(--tap);
    color: var(--muted);
  }
  .page .site a[aria-current='page'] {
    color: var(--ink);
    font-weight: 700;
    text-decoration: none;
  }
  .page > h1 {
    margin-top: 0;
    font-size: 56px;
  }
  .page:not(.wide) > :not(.bar) {
    width: min(560px, 100%);
    margin-inline: auto;
  }
}
</style>
