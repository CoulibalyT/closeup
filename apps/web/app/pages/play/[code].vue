<script setup lang="ts">
import { roomCodeSchema } from '@closeup/shared';

const route = useRoute();
const { t, locale } = useI18n();
const localePath = useLocalePath();
const game = useGameStore();
const { appName } = useRuntimeConfig().public;

useVisualViewport();
useHead({ title: () => t('play.title', { appName }) });

const worth = ref(1000);
const countdown = ref(0);
let countdownTimer: ReturnType<typeof setInterval> | undefined;

const yourPoints = computed(() => {
  return game.reveal?.results.find((r) => r.playerId === game.you)?.points ?? 0;
});

onMounted(() => {
  const code = roomCodeSchema.safeParse(route.params.code);
  if (!code.success) return navigateTo(localePath('/'));
  void game.enter(code.data);
  countdownTimer = setInterval(() => {
    const startsAt = game.round?.startsAt ?? 0;
    countdown.value = Math.max(0, Math.ceil((startsAt - game.serverNow()) / 1000));
  }, 100);
});

onBeforeUnmount(() => {
  clearInterval(countdownTimer);
  game.leave();
});

const replaying = ref(false);
async function replay(): Promise<void> {
  replaying.value = true;
  try {
    const code = await game.createSolo(
      { rounds: game.totalRounds, answerMode: game.answerMode },
      locale.value as 'fr' | 'en',
    );
    // A new code is a new page: it mounts again and enters the room by itself.
    await navigateTo(localePath(`/play/${code}`));
  } finally {
    replaying.value = false;
  }
}
</script>

<template>
  <main class="screen">
    <header v-if="game.round && game.stage !== 'ended'" class="top">
      <span>{{ t('play.round', { n: game.round.index + 1, total: game.totalRounds }) }}</span>
      <b>{{ game.score }}</b>
    </header>

    <p v-if="game.stage === 'connecting' || game.stage === 'lobby'" class="notice muted">
      {{ t('play.connecting') }}
    </p>

    <div v-else-if="game.stage === 'lost'" class="notice">
      <p>{{ t('play.lost') }}</p>
      <NuxtLink class="button" :to="localePath('/')">{{ t('play.home') }}</NuxtLink>
    </div>

    <template v-else-if="(game.stage === 'countdown' || game.stage === 'playing') && game.round">
      <section class="stage">
        <ZoomStrip :crops="game.crops" :media-url="game.mediaUrl" />
        <div class="view">
          <div v-if="game.stage === 'countdown'" class="lens-box waiting">
            <span class="display">{{ countdown || '' }}</span>
          </div>
          <LensTimer
            v-else
            class="lens-box"
            :crops="game.crops"
            :starts-at="game.round.startsAt"
            :ends-at="game.round.endsAt"
            :penalty="game.penalty"
            :frozen="game.answered"
            :server-now="game.serverNow"
            :media-url="game.mediaUrl"
            @value="worth = $event"
          />
          <template v-if="game.stage === 'playing'">
            <p class="display worth">{{ worth }}</p>
            <p class="muted note">
              {{ game.answered ? t('play.foundWaiting') : t('play.worthNote') }}
            </p>
          </template>
          <p v-else class="muted note">{{ t('play.getReady') }}</p>
        </div>
      </section>

      <AnswerForm
        v-if="game.answerMode === 'text'"
        :feedback="game.feedback"
        :disabled="game.stage !== 'playing' || game.answered"
        @guess="game.guess"
      />
      <ChoiceGrid
        v-else
        :options="game.round.options ?? []"
        :wrong-ids="game.wrongOptionIds"
        :locked-until="game.lockedUntil"
        :disabled="game.stage !== 'playing' || game.answered"
        :server-now="game.serverNow"
        @pick="game.pick"
      />
    </template>

    <RevealPanel
      v-else-if="game.stage === 'reveal' && game.reveal"
      :reveal="game.reveal"
      :you="yourPoints"
      :crops="game.crops"
      :media-url="game.mediaUrl"
      @next="game.next"
    />

    <section v-else-if="game.stage === 'ended' && game.end" class="end">
      <p class="muted">{{ t('end.title') }}</p>
      <h1 class="display total">{{ game.score }}</h1>
      <p>{{ t('end.found', { n: game.foundCount, total: game.totalRounds }) }}</p>
      <p v-if="game.end.personalBest" class="best" :class="{ fresh: game.end.personalBest.isNew }">
        {{
          game.end.personalBest.isNew
            ? t('end.newBest')
            : t('end.best', { score: game.end.personalBest.score })
        }}
      </p>
      <div class="actions">
        <button type="button" class="button" :disabled="replaying" @click="replay">
          {{ t('end.replay') }}
        </button>
        <NuxtLink class="button quiet" :to="localePath('/')">{{ t('play.home') }}</NuxtLink>
      </div>
    </section>
  </main>
</template>

<style scoped>
.screen {
  display: flex;
  flex-direction: column;
  height: var(--viewport-height);
  max-width: 460px;
  margin: 0 auto;
  overflow: hidden;
}
.top {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding: calc(var(--space-4) + env(safe-area-inset-top)) var(--space-4) 0;
  font-size: 15px;
  color: var(--muted);
}
.top b {
  color: var(--ink);
  font-variant-numeric: tabular-nums;
}
.notice {
  display: grid;
  gap: var(--space-4);
  justify-items: start;
  margin: auto 0;
  padding: var(--space-6);
}
.stage {
  display: grid;
  grid-template-columns: 52px minmax(0, 1fr);
  gap: 14px;
  flex: 1;
  min-height: 0;
  padding: var(--space-4);
  overflow: hidden;
}
.view {
  display: flex;
  flex-direction: column;
  min-height: 0;
}
/* Sized by the height that is left, so the lens shrinks when the keyboard opens. */
.lens-box {
  flex: 0 1 236px;
  min-height: 88px;
  max-height: 236px;
  aspect-ratio: 1;
  align-self: flex-start;
}
.waiting {
  display: grid;
  place-items: center;
  border: 9px solid var(--ring-track);
  border-radius: 50%;
  font-size: 64px;
}
.worth {
  margin-top: var(--space-3);
  font-size: clamp(34px, 11vw, 46px);
}
.note {
  margin-top: var(--space-1);
  font-size: 15px;
}
.end {
  display: flex;
  flex-direction: column;
  flex: 1;
  padding: var(--space-10) var(--space-4) calc(var(--space-4) + env(safe-area-inset-bottom));
}
.total {
  font-size: clamp(56px, 20vw, 88px);
}
.best {
  margin-top: var(--space-4);
  color: var(--muted);
}
.best.fresh {
  color: var(--good);
  font-weight: 700;
}
.actions {
  display: grid;
  gap: var(--space-2);
  margin-top: auto;
}
</style>
