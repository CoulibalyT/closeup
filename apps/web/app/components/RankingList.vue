<script setup lang="ts">
import type { Player } from '@closeup/shared';

/**
 * The live ranking. During a round it also says who has already found, which is all the other
 * players ever learn about an answer.
 */
const props = defineProps<{
  players: Player[];
  you: string;
  foundIds?: string[];
  /** Points scored in the round that just ended, by player id. */
  gains?: Record<string, number>;
  limit?: number;
}>();
const { t } = useI18n();

const rows = computed(() => {
  const ranked = [...props.players]
    .sort((a, b) => b.score - a.score || a.nickname.localeCompare(b.nickname))
    .map((player, index) => ({ ...player, rank: index + 1 }));
  if (!props.limit || ranked.length <= props.limit) return ranked;
  // Always keep the viewer in sight, even when they are far down the list.
  const top = ranked.slice(0, props.limit);
  const me = ranked.find((row) => row.id === props.you);
  return me && !top.includes(me) ? [...top.slice(0, -1), me] : top;
});
</script>

<template>
  <ol class="ranking">
    <li v-for="row in rows" :key="row.id" :class="{ me: row.id === you, offline: !row.connected }">
      <span class="who">
        {{ row.rank }}. {{ row.nickname }}
        <small v-if="foundIds?.includes(row.id)" class="found">{{ t('ranking.found') }}</small>
        <small v-else-if="!row.connected">{{ t('lobby.offline') }}</small>
        <!-- How many, never which: enough to decide who is worth robbing. -->
        <small v-if="row.bonusCount">{{ t('ranking.bonuses', { n: row.bonusCount }) }}</small>
      </span>
      <span class="score">
        <small v-if="gains && gains[row.id]" class="found">+{{ gains[row.id] }}</small>
        {{ row.score }}
      </span>
    </li>
  </ol>
</template>

<style scoped>
.ranking {
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: 15px;
  color: var(--muted);
}
li {
  display: flex;
  justify-content: space-between;
  gap: var(--space-3);
  padding: 3px 0;
  font-variant-numeric: tabular-nums;
}
li.me {
  color: var(--ink);
  font-weight: 700;
}
li.offline .who {
  opacity: 0.6;
}
.who {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
small {
  margin-left: var(--space-2);
  font-size: 13px;
  font-weight: 400;
}
.found {
  color: var(--good);
  font-weight: 600;
}
.score small {
  margin: 0 var(--space-2) 0 0;
}
</style>
