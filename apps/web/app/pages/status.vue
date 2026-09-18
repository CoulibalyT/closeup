<script setup lang="ts">
import type { Light } from '~/stores/status';

// Phase 0 technical page: deliberately unstyled. The design direction is chosen at the start of
// phase 1 and this page goes away with it.
const { t, locale, locales } = useI18n();
const switchLocalePath = useSwitchLocalePath();
const { appName } = useRuntimeConfig().public;
const status = useStatusStore();
const serviceWorker = ref<Light>('unknown');

useHead({ title: () => t('status.title', { appName }) });

const rows = computed(() => [
  { key: 'api', light: status.api },
  { key: 'postgres', light: status.postgres },
  { key: 'redis', light: status.redis },
  {
    key: 'worker',
    light: status.worker,
    note:
      status.workerLatencyMs === null
        ? undefined
        : t('status.workerLatency', { ms: status.workerLatencyMs }),
  },
  { key: 'socket', light: status.realtime },
  { key: 'pwa', light: serviceWorker.value },
]);

async function checkServiceWorker(): Promise<void> {
  if (!('serviceWorker' in navigator)) {
    serviceWorker.value = 'down';
    return;
  }
  const registration = await navigator.serviceWorker.getRegistration();
  serviceWorker.value = registration ? 'up' : 'unknown';
}

async function refresh(): Promise<void> {
  await Promise.all([status.refreshServices(), checkServiceWorker()]);
}

let timer: ReturnType<typeof setInterval> | undefined;

onMounted(() => {
  status.watchRealtime(useGameSocket());
  void refresh();
  timer = setInterval(() => void refresh(), 5_000);
});

onBeforeUnmount(() => clearInterval(timer));
</script>

<template>
  <main class="page">
    <header class="head">
      <h1>{{ t('status.title', { appName }) }}</h1>
      <nav :aria-label="t('status.language')">
        <NuxtLink
          v-for="l in locales"
          :key="l.code"
          :to="switchLocalePath(l.code)"
          :aria-current="l.code === locale ? 'true' : undefined"
          class="lang"
        >
          {{ l.name }}
        </NuxtLink>
      </nav>
    </header>

    <p>{{ t('status.intro') }}</p>

    <section aria-live="polite">
      <h2>{{ t('status.services') }}</h2>
      <ul class="rows">
        <li v-for="row in rows" :key="row.key" :data-light="row.light">
          <span>{{ t(`status.${row.key}`) }}</span>
          <span class="state">
            {{ t(`status.${row.light}`) }}<template v-if="row.note"> — {{ row.note }}</template>
          </span>
        </li>
      </ul>

      <p v-if="status.clock">
        {{
          t('status.clock', {
            offset: Math.round(status.clock.offsetMs),
            rtt: Math.round(status.clock.rttMs),
          })
        }}
      </p>
      <p v-else>{{ t('status.clockPending') }}</p>
    </section>

    <button type="button" class="refresh" @click="refresh">{{ t('status.refresh') }}</button>
  </main>
</template>

<style scoped>
.page {
  max-width: 36rem;
  margin: 0 auto;
  padding: 2rem 1rem;
  font-family: ui-sans-serif, system-ui, sans-serif;
  line-height: 1.5;
}
.head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
}
.lang {
  display: inline-block;
  min-height: 44px;
  padding: 0.6rem 0.5rem;
  color: inherit;
}
.lang[aria-current='true'] {
  font-weight: 700;
  text-decoration: none;
}
.rows {
  padding: 0;
  list-style: none;
}
.rows li {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.6rem 0;
  border-bottom: 1px solid #ddd;
}
/* The state is always written out; colour only reinforces it. */
.rows li[data-light='up'] .state {
  color: #1f7a4d;
}
.rows li[data-light='down'] .state {
  color: #b3122d;
  font-weight: 700;
}
.refresh {
  min-height: 44px;
  padding: 0 1rem;
  font: inherit;
}
</style>
