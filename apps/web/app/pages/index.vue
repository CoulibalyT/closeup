<script setup lang="ts">
import { type AnswerMode, NICKNAME, ROOM, roomCodeSchema } from '@closeup/shared';

const { t, locale, locales } = useI18n();
const localePath = useLocalePath();
const switchLocalePath = useSwitchLocalePath();
const game = useGameStore();
const { appName } = useRuntimeConfig().public;

useHead({ title: appName });

const busy = ref(false);
const failed = ref(false);

/** Runs one of the three ways to start, with a single "busy" and a single error message. */
async function go(action: () => Promise<string>): Promise<void> {
  busy.value = true;
  failed.value = false;
  try {
    await navigateTo(localePath(await action()));
  } catch {
    failed.value = true;
  } finally {
    busy.value = false;
  }
}

// --- with friends: the nickname is asked here, the settings are chosen in the lobby ---
const nickname = ref('');
const nicknameOk = computed(() => nickname.value.trim().length >= NICKNAME.minLength);
onMounted(() => (nickname.value = game.rememberedNickname()));

const createParty = () =>
  go(async () => {
    game.setNickname(nickname.value);
    const code = await game.createRoom(
      'private',
      { rounds: ROOM.defaultRounds, answerMode: 'text' },
      locale.value as 'fr' | 'en',
    );
    return `/play/${code}`;
  });

const joinCode = ref('');
const joinCodeOk = computed(() => roomCodeSchema.safeParse(joinCode.value).success);
const joinParty = () => go(async () => `/join/${roomCodeSchema.parse(joinCode.value)}`);

// --- solo training ---
const rounds = ref<number>(ROOM.roundsOptions[0]);
const answerMode = ref<AnswerMode>('text');
const playSolo = () =>
  go(async () => {
    const settings = { rounds: rounds.value, answerMode: answerMode.value };
    return `/play/${await game.createRoom('solo', settings, locale.value as 'fr' | 'en')}`;
  });
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
    <p v-if="failed" class="error" role="alert">{{ t('home.failed') }}</p>

    <section class="block">
      <h2>{{ t('home.friends') }}</h2>
      <form class="stack" @submit.prevent="createParty">
        <label for="nickname">{{ t('join.nickname') }}</label>
        <input
          id="nickname"
          v-model="nickname"
          type="text"
          autocomplete="nickname"
          :maxlength="NICKNAME.maxLength"
          :placeholder="t('join.nicknamePlaceholder')"
        />
        <button type="submit" class="button" :disabled="busy || !nicknameOk">
          {{ t('home.create') }}
        </button>
      </form>

      <form class="row" @submit.prevent="joinParty">
        <label for="code" class="sr-only">{{ t('home.codeLabel') }}</label>
        <input
          id="code"
          v-model="joinCode"
          type="text"
          class="code"
          autocapitalize="characters"
          autocomplete="off"
          spellcheck="false"
          :maxlength="ROOM.codeLength"
          :placeholder="t('home.codePlaceholder')"
        />
        <button type="submit" class="button quiet" :disabled="busy || !joinCodeOk">
          {{ t('home.join') }}
        </button>
      </form>
    </section>

    <form class="block stack" @submit.prevent="playSolo">
      <h2>{{ t('home.solo') }}</h2>

      <fieldset>
        <legend>{{ t('home.rounds') }}</legend>
        <label v-for="n in ROOM.roundsOptions" :key="n" class="choice">
          <input v-model="rounds" type="radio" name="rounds" :value="n" />
          <span>{{ n }}</span>
        </label>
      </fieldset>

      <fieldset>
        <legend>{{ t('home.answerMode') }}</legend>
        <label class="choice">
          <input v-model="answerMode" type="radio" name="mode" value="text" />
          <span>{{ t('home.text') }}</span>
        </label>
        <label class="choice">
          <input v-model="answerMode" type="radio" name="mode" value="mcq" />
          <span>{{ t('home.mcq') }}</span>
        </label>
      </fieldset>

      <button type="submit" class="button quiet" :disabled="busy">{{ t('home.play') }}</button>
    </form>
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
  margin-top: var(--space-6);
  font-size: clamp(40px, 14vw, 64px);
  overflow-wrap: anywhere;
}
.pitch {
  max-width: 32ch;
  margin-top: var(--space-3);
  font-size: 19px;
}
.block {
  margin-top: var(--space-6);
  padding: var(--space-4);
  border-radius: var(--radius);
  background: var(--surface);
}
.stack {
  display: grid;
  gap: var(--space-2);
}
.block > .stack {
  margin-top: var(--space-3);
}
.row {
  display: flex;
  gap: var(--space-2);
  margin-top: var(--space-4);
  padding-top: var(--space-4);
  border-top: 1px solid var(--line);
}
h2 {
  font-size: 19px;
}
label,
legend {
  font-size: 15px;
  color: var(--muted);
}
input[type='text'] {
  flex: 1;
  min-width: 0;
  min-height: var(--tap);
  padding: 0 var(--space-4);
  border: 1.5px solid var(--line);
  border-radius: var(--radius);
  background: var(--bg);
  /* 16 px minimum, or iOS Safari zooms the page when the field takes focus. */
  font-size: 17px;
}
input.code {
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
input.code::placeholder {
  letter-spacing: 0;
  text-transform: none;
}
fieldset {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin: var(--space-2) 0 0;
  padding: 0;
  border: 0;
}
legend {
  width: 100%;
  margin-bottom: var(--space-2);
  padding: 0;
}
.choice {
  flex: 1;
  cursor: pointer;
}
.choice input {
  position: absolute;
  opacity: 0;
}
.choice span {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: var(--tap);
  padding: 0 var(--space-3);
  border: 1.5px solid var(--line);
  border-radius: var(--radius);
  color: var(--ink);
  font-size: 17px;
  font-weight: 600;
}
.choice input:checked + span {
  border-color: var(--ink);
  background: var(--ink);
  color: var(--bg);
}
.choice input:focus-visible + span {
  outline: 3px solid var(--focus);
  outline-offset: 2px;
}
.error {
  margin-top: var(--space-3);
  color: var(--danger);
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
</style>
