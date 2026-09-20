<script setup lang="ts">
import { MATCHMAKING, NICKNAME, PUBLIC_SETTINGS } from '@closeup/shared';

/** The public queue: a nickname, a language, and the wait. Nothing is negotiated with strangers. */
const { t, locale } = useI18n();
const localePath = useLocalePath();
const game = useGameStore();
const { appName } = useRuntimeConfig().public;

useHead({ title: () => t('publicGame.title', { appName }) });

const nickname = ref('');
const error = ref<string | null>(null);
const busy = ref(false);
const clock = ref(Date.now());
let ticker: ReturnType<typeof setInterval> | undefined;

const waiting = computed(() => game.queue !== null);
const nicknameOk = computed(() => nickname.value.trim().length >= NICKNAME.minLength);
const secondsLeft = computed(() => {
  const startsAt = game.queue?.startsAt;
  return startsAt ? Math.max(0, Math.ceil((startsAt - game.serverNow()) / 1000)) : null;
});
// Only a hint of what is happening: the exact clock is the server's.
void clock;

onMounted(async () => {
  nickname.value = game.rememberedNickname();
  await game.ensureGuest().catch(() => undefined);
  ticker = setInterval(() => (clock.value = Date.now()), 500);
});
onBeforeUnmount(() => {
  clearInterval(ticker);
  // Leaving the page gives up the place — unless we are leaving *because* a room was found:
  // that socket is the one about to join it.
  if (waiting.value && !game.matchedCode) void game.leaveQueue();
});

// The server found a room: everyone matched goes to it.
watch(
  () => game.matchedCode,
  (code) => {
    if (code) void navigateTo(localePath(`/play/${code}`));
  },
);

async function join(): Promise<void> {
  busy.value = true;
  error.value = null;
  try {
    error.value = await game.joinQueue(nickname.value.trim(), locale.value as 'fr' | 'en');
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <PageShell :title="t('publicGame.heading')">
    <template v-if="!waiting">
      <p>{{ t('publicGame.pitch') }}</p>
      <p class="muted rules">
        {{
          t('publicGame.rules', {
            rounds: PUBLIC_SETTINGS.rounds,
            max: MATCHMAKING.maxPlayers,
            start: MATCHMAKING.startAtPlayers,
            seconds: MATCHMAKING.timeoutMs / 1000,
          })
        }}
      </p>

      <form class="block" @submit.prevent="join">
        <label for="nickname">{{ t('join.nickname') }}</label>
        <input
          id="nickname"
          v-model="nickname"
          type="text"
          autocomplete="nickname"
          :maxlength="NICKNAME.maxLength"
          :placeholder="t('join.nicknamePlaceholder')"
        />
        <small class="muted">{{ t('publicGame.nicknameRule') }}</small>
        <p v-if="error" class="error" role="alert">
          {{ t(`publicGame.error.${error}`, t('publicGame.error.other')) }}
        </p>
        <button type="submit" class="button" :disabled="busy || !nicknameOk">
          {{ t('publicGame.join') }}
        </button>
      </form>
    </template>

    <section v-else class="block waiting" role="status">
      <p class="display count">{{ game.queue?.waiting }}</p>
      <p>{{ t('publicGame.waiting', { n: game.queue?.waiting ?? 0 }) }}</p>
      <p v-if="secondsLeft !== null" class="muted">
        {{ t('publicGame.startsIn', { seconds: secondsLeft }) }}
      </p>
      <p v-else class="muted">{{ t('publicGame.needOneMore') }}</p>
      <button type="button" class="button quiet" @click="game.leaveQueue">
        {{ t('publicGame.cancel') }}
      </button>
    </section>
  </PageShell>
</template>

<style scoped>
.rules {
  margin-top: var(--space-2);
  font-size: 15px;
}
.waiting {
  display: grid;
  gap: var(--space-2);
  justify-items: start;
}
.count {
  font-size: clamp(56px, 20vw, 88px);
}
</style>
