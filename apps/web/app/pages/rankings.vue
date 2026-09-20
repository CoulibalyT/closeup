<script setup lang="ts">
import { RANKING_PERIODS, type RankingPeriod, type Rankings } from '@closeup/shared';

const { t } = useI18n();
const localePath = useLocalePath();
const session = useSessionStore();
const { appName } = useRuntimeConfig().public;

useHead({ title: () => t('rankings.title', { appName }) });

const period = ref<RankingPeriod>('week');
const board = ref<Rankings | null>(null);
const failed = ref(false);

async function load(): Promise<void> {
  failed.value = false;
  try {
    board.value = await session.rankings(period.value);
  } catch {
    failed.value = true;
  }
}
watch(period, load);
// The session first: asking who we are is also what re-points a device to its account, and
// the board needs that settled to know which line is the viewer's.
onMounted(async () => {
  await session.whoAmI();
  await load();
});
</script>

<template>
  <PageShell :title="t('rankings.heading')">
    <div class="tabs" role="group" :aria-label="t('rankings.period')">
      <button
        v-for="p in RANKING_PERIODS"
        :key="p"
        type="button"
        :aria-pressed="period === p"
        @click="period = p"
      >
        {{ t(`rankings.periods.${p}`) }}
      </button>
    </div>
    <p class="muted rule">{{ t('rankings.rule') }}</p>

    <p v-if="failed" class="error" role="alert">{{ t('admin.failed') }}</p>
    <p v-else-if="board && !board.rows.length" class="block">{{ t('rankings.empty') }}</p>

    <ol v-else-if="board" class="board">
      <li v-for="(row, index) in board.rows" :key="index" :class="{ me: row.you }">
        <span class="rank">{{ row.rank }}</span>
        <span class="who">
          {{ row.nickname }}
          <small class="muted">{{
            t('rankings.detail', { games: row.games, wins: row.wins })
          }}</small>
        </span>
        <b>{{ row.score }}</b>
      </li>
      <li v-if="board.you" class="me apart">
        <span class="rank">{{ board.you.rank }}</span>
        <span class="who">
          {{ board.you.nickname }}
          <small class="muted">
            {{ t('rankings.detail', { games: board.you.games, wins: board.you.wins }) }}
          </small>
        </span>
        <b>{{ board.you.score }}</b>
      </li>
    </ol>

    <p v-if="session.checked && !session.user" class="block">
      {{ t('rankings.needAccount') }}
      <NuxtLink :to="localePath('/account')">{{ t('account.createAccount') }}</NuxtLink>
    </p>
  </PageShell>
</template>

<style scoped>
.rule {
  margin-top: var(--space-2);
  font-size: 15px;
}
.board {
  margin: var(--space-3) 0 0;
  padding: 0;
  list-style: none;
}
.board li {
  display: grid;
  grid-template-columns: 2.2em minmax(0, 1fr) auto;
  gap: var(--space-2);
  align-items: baseline;
  padding: var(--space-2) var(--space-3);
  border-top: 1px solid var(--line);
  font-variant-numeric: tabular-nums;
}
.board li.me {
  border-radius: var(--radius);
  background: var(--surface);
  font-weight: 700;
}
.board li.apart {
  margin-top: var(--space-3);
}
.rank {
  color: var(--muted);
}
.who {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.who small {
  margin-left: var(--space-2);
  font-weight: 400;
}
.block a {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
}
</style>
