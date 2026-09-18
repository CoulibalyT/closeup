<script setup lang="ts">
import { type AnswerMode, ROOM } from '@closeup/shared';

const { t, locale, locales } = useI18n();
const localePath = useLocalePath();
const switchLocalePath = useSwitchLocalePath();
const game = useGameStore();
const { appName } = useRuntimeConfig().public;

useHead({ title: appName });

const rounds = ref<number>(ROOM.roundsOptions[0]);
const answerMode = ref<AnswerMode>('text');
const starting = ref(false);
const failed = ref(false);

async function play(): Promise<void> {
  starting.value = true;
  failed.value = false;
  try {
    const code = await game.createSolo(
      { rounds: rounds.value, answerMode: answerMode.value },
      locale.value as 'fr' | 'en',
    );
    await navigateTo(localePath(`/play/${code}`));
  } catch {
    failed.value = true;
  } finally {
    starting.value = false;
  }
}
</script>

<template>
  <main class="home">
    <nav :aria-label="t('home.language')">
      <NuxtLink
        v-for="l in locales"
        :key="l.code"
        :to="switchLocalePath(l.code)"
        :aria-current="l.code === locale ? 'true' : undefined"
      >
        {{ l.name }}
      </NuxtLink>
    </nav>

    <h1 class="display">{{ appName }}</h1>
    <p class="pitch">{{ t('home.pitch') }}</p>

    <form class="setup" @submit.prevent="play">
      <h2>{{ t('home.solo') }}</h2>

      <fieldset>
        <legend>{{ t('home.rounds') }}</legend>
        <label v-for="n in ROOM.roundsOptions" :key="n">
          <input v-model="rounds" type="radio" name="rounds" :value="n" />
          <span>{{ n }}</span>
        </label>
      </fieldset>

      <fieldset>
        <legend>{{ t('home.answerMode') }}</legend>
        <label>
          <input v-model="answerMode" type="radio" name="mode" value="text" />
          <span>{{ t('home.text') }}</span>
        </label>
        <label>
          <input v-model="answerMode" type="radio" name="mode" value="mcq" />
          <span>{{ t('home.mcq') }}</span>
        </label>
      </fieldset>

      <p v-if="failed" class="error" role="alert">{{ t('home.failed') }}</p>
      <button type="submit" class="button" :disabled="starting">{{ t('home.play') }}</button>
    </form>

    <p class="foot muted">{{ t('home.soon') }}</p>
  </main>
</template>

<style scoped>
.home {
  display: flex;
  flex-direction: column;
  min-height: 100dvh;
  max-width: 460px;
  margin: 0 auto;
  padding: calc(var(--space-4) + env(safe-area-inset-top)) var(--space-4) var(--space-6);
}
nav {
  display: flex;
  gap: var(--space-2);
  margin-left: calc(-1 * var(--space-2));
}
nav a {
  display: inline-flex;
  align-items: center;
  min-height: var(--tap);
  padding: 0 var(--space-2);
  color: var(--muted);
}
nav a[aria-current='true'] {
  color: var(--ink);
  font-weight: 700;
  text-decoration: none;
}
h1 {
  margin-top: var(--space-10);
  font-size: clamp(40px, 14vw, 64px);
  overflow-wrap: anywhere;
}
.pitch {
  max-width: 32ch;
  margin-top: var(--space-3);
  font-size: 19px;
}
.setup {
  display: grid;
  gap: var(--space-4);
  margin-top: var(--space-10);
  padding: var(--space-4);
  border-radius: var(--radius);
  background: var(--surface);
}
h2 {
  font-size: 19px;
}
fieldset {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  border: 0;
}
legend {
  width: 100%;
  margin-bottom: var(--space-2);
  padding: 0;
  font-size: 15px;
  color: var(--muted);
}
label {
  flex: 1;
  cursor: pointer;
}
label input {
  position: absolute;
  opacity: 0;
}
label span {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: var(--tap);
  padding: 0 var(--space-3);
  border: 1.5px solid var(--line);
  border-radius: var(--radius);
  font-weight: 600;
  text-align: center;
}
label input:checked + span {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--accent-ink);
}
label input:focus-visible + span {
  outline: 3px solid var(--focus);
  outline-offset: 2px;
}
.error {
  color: var(--danger);
}
.foot {
  margin-top: auto;
  padding-top: var(--space-6);
  font-size: 15px;
}
</style>
