<script setup lang="ts">
/** Frame of the pages around the game (account, statistics, rankings): a title and the way home. */
defineProps<{ title: string }>();
const { t } = useI18n();
const localePath = useLocalePath();
</script>

<template>
  <main class="page">
    <NuxtLink class="back" :to="localePath('/')">← {{ t('play.home') }}</NuxtLink>
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
</style>
