<script setup lang="ts">
import type { FeedEntry } from '~/stores/game';

/**
 * Who did what to whom, one line at a time. Sabotage is public on purpose: seeing that Awa just
 * blurred Moussa is half of the game. Motion only answers an event: the line slides in once.
 */
const { t } = useI18n();
const game = useGameStore();

const SHOWN_MS = 3_500;
const current = ref<FeedEntry | null>(null);
let timer: ReturnType<typeof setTimeout> | undefined;

// Always the nickname, the viewer's included: "Awa blurs Moussa's picture" reads the same for
// everyone, and avoids a second set of sentences ("… blurs your picture") in each language.
const name = (id?: string) => game.players.find((p) => p.id === id)?.nickname ?? '?';

const line = computed(() => {
  const entry = current.value;
  if (!entry) return '';
  const names = { from: name(entry.from), to: name(entry.to) };
  const bonus = entry.bonus ? t(`bonus.name.${entry.bonus}`) : '';
  switch (entry.kind) {
    case 'granted':
      return t(`feed.granted.${entry.reason}`, { bonus });
    case 'malus':
      return t(`feed.malus.${entry.bonus}`, names);
    case 'stealBonus':
      return t('feed.stealBonus', { ...names, bonus });
    case 'stealPoints':
      return t('feed.stealPoints', names);
    case 'stolenPoints':
      return t('feed.stolenPoints', { ...names, amount: entry.amount });
    case 'blocked':
      return t('feed.blocked', names);
    case 'partial':
      return t('feed.partial', { name: names.from, points: entry.amount });
    default:
      return '';
  }
});

watch(
  () => game.feed.at(-1),
  (entry) => {
    if (!entry) return;
    current.value = entry;
    clearTimeout(timer);
    timer = setTimeout(() => (current.value = null), SHOWN_MS);
  },
);
onBeforeUnmount(() => clearTimeout(timer));
</script>

<template>
  <div class="feed" role="status" aria-live="polite">
    <p v-if="current" :key="current.id" :class="current.kind">{{ line }}</p>
  </div>
</template>

<style scoped>
.feed {
  min-height: 28px;
  padding: 0 var(--space-4);
}
p {
  display: inline-block;
  padding: 2px var(--space-2);
  border-radius: var(--radius);
  background: var(--ink);
  color: var(--bg);
  font-size: 14px;
  font-weight: 600;
  animation: arrive 0.25s ease-out;
}
p.granted {
  background: var(--good);
  color: #ffffff;
}
@keyframes arrive {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
}
</style>
