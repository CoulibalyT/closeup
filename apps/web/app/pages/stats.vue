<script setup lang="ts">
import type { PlayerStats } from '@closeup/shared';

const { t, locale } = useI18n();
const localePath = useLocalePath();
const session = useSessionStore();
const { appName } = useRuntimeConfig().public;

useHead({
  title: () => t('stats.title', { appName }),
  meta: [{ name: 'robots', content: 'noindex' }],
});

const stats = ref<PlayerStats | null>(null);
const loading = ref(true);
// See the rankings page: the session is resolved first, because it decides which player this
// device plays as.
onMounted(async () => {
  await session.whoAmI();
  stats.value = await session.stats();
  loading.value = false;
});

const accuracy = computed(() =>
  stats.value?.roundsSeated
    ? Math.round((stats.value.correctCount / stats.value.roundsSeated) * 100)
    : 0,
);
const day = (iso: string) =>
  new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium' }).format(new Date(iso));
const seconds = (ms: number) => (ms / 1000).toFixed(1).replace('.', t('stats.decimal'));

/** "mcq:5" → "5 manches, 4 propositions". */
function configLabel(key: string): string {
  const [mode = 'text', rounds = '?'] = key.split(':');
  return t('stats.config', {
    rounds,
    mode: t(mode === 'mcq' ? 'lobby.modeMcq' : 'lobby.modeText'),
  });
}
</script>

<template>
  <PageShell :title="t('stats.heading')">
    <p v-if="loading" class="muted">{{ t('admin.loading') }}</p>

    <template v-else-if="!stats || !stats.games">
      <p>{{ t('stats.empty') }}</p>
      <NuxtLink class="button start" :to="localePath('/')">{{ t('home.play') }}</NuxtLink>
    </template>

    <template v-else>
      <p class="muted">{{ t('stats.of', { nickname: stats.nickname }) }}</p>

      <dl class="figures">
        <div>
          <dt>{{ t('stats.games') }}</dt>
          <dd class="display">{{ stats.games }}</dd>
        </div>
        <div>
          <dt>{{ t('stats.wins') }}</dt>
          <dd class="display">{{ stats.wins }}</dd>
          <small class="muted">{{ t('stats.outOf', { n: stats.multiplayerGames }) }}</small>
        </div>
        <div>
          <dt>{{ t('stats.accuracy') }}</dt>
          <dd class="display">{{ accuracy }} %</dd>
          <small class="muted">
            {{ t('stats.found', { n: stats.correctCount, total: stats.roundsSeated }) }}
          </small>
        </div>
        <div>
          <dt>{{ t('stats.speed') }}</dt>
          <dd class="display">
            {{ stats.averageFoundMs === null ? '–' : `${seconds(stats.averageFoundMs)} s` }}
          </dd>
        </div>
        <div>
          <dt>{{ t('stats.bestScore') }}</dt>
          <dd class="display">{{ stats.bestScore }}</dd>
        </div>
        <div>
          <dt>{{ t('stats.bestStreak') }}</dt>
          <dd class="display">{{ stats.bestStreak }}</dd>
        </div>
      </dl>

      <section v-if="stats.soloBests.length" class="block">
        <h2>{{ t('stats.soloBests') }}</h2>
        <ul class="rows">
          <li v-for="best in stats.soloBests" :key="best.configKey">
            <span>{{ configLabel(best.configKey) }}</span>
            <b>{{ best.score }}</b>
          </li>
        </ul>
      </section>

      <section class="block">
        <h2>{{ t('stats.recent') }}</h2>
        <ul class="rows">
          <li v-for="game in stats.recent" :key="game.gameId">
            <span>
              {{ day(game.endedAt) }}
              <small class="muted">
                {{
                  game.mode === 'solo'
                    ? t('stats.solo')
                    : t('stats.rank', { rank: game.rank, players: game.playerCount })
                }}
              </small>
            </span>
            <b>{{ game.score }}</b>
          </li>
        </ul>
      </section>

      <p v-if="!stats.hasAccount" class="block nudge">
        {{ t('stats.guestNudge') }}
        <NuxtLink :to="localePath('/account')">{{ t('account.createAccount') }}</NuxtLink>
      </p>
    </template>
  </PageShell>
</template>

<style scoped>
.start {
  align-self: flex-start;
  margin-top: var(--space-4);
}
.figures {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-2);
  margin: var(--space-3) 0 0;
}
.figures div {
  padding: var(--space-3);
  border-radius: var(--radius);
  background: var(--surface);
}
dt {
  font-size: 14px;
  color: var(--muted);
}
dd {
  margin: 0;
  font-size: clamp(26px, 8vw, 34px);
}
.rows {
  margin: 0;
  padding: 0;
  list-style: none;
}
.rows li {
  display: flex;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-2) 0;
  border-top: 1px solid var(--line);
  font-variant-numeric: tabular-nums;
}
.rows small {
  margin-left: var(--space-2);
}
.nudge a {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
}
</style>
