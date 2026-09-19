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

const solo = computed(() => game.mode === 'solo');
// Big-screen mode: the image is on the shared screen, this phone only answers and plays bonuses.
const controller = computed(() => game.display === 'bigscreen');
// A malus lasts a few seconds: a ticking clock makes it end on screen without a server event.
const clock = ref(0);
const malus = computed(() =>
  game.effect && game.effect.until > clock.value ? game.effect.type : null,
);
const frozen = computed(() => malus.value === 'freeze');
const canAnswer = computed(
  () => game.stage === 'playing' && game.seated && !game.answered && !frozen.value,
);

onMounted(async () => {
  const code = roomCodeSchema.safeParse(route.params.code);
  if (!code.success) return navigateTo(localePath('/'));

  // A room with other people needs a nickname first. Someone who opens the play link without
  // one (a forwarded URL) goes through the join screen; solo rooms have no summary and skip it.
  if (!game.rememberedNickname()) {
    const summary = await game.fetchSummary(code.data).catch(() => null);
    if (summary) return navigateTo(localePath(`/join/${code.data}`));
  }

  void game.enter(code.data);
  countdownTimer = setInterval(() => {
    const startsAt = game.round?.startsAt ?? 0;
    clock.value = game.serverNow();
    countdown.value = Math.max(0, Math.ceil((startsAt - clock.value) / 1000));
  }, 100);
});

onBeforeUnmount(() => {
  clearInterval(countdownTimer);
  game.leave();
});

const busy = ref(false);
async function replaySolo(): Promise<void> {
  busy.value = true;
  try {
    const code = await game.createRoom(
      'solo',
      {
        rounds: game.totalRounds,
        answerMode: game.answerMode,
        scoring: game.scoring,
        display: 'phones',
      },
      locale.value as 'fr' | 'en',
    );
    // A new code is a new page: it mounts again and enters the room by itself.
    await navigateTo(localePath(`/play/${code}`));
  } finally {
    busy.value = false;
  }
}

async function quit(): Promise<void> {
  await game.leaveRoom();
  await navigateTo(localePath('/'));
}
</script>

<template>
  <main class="screen">
    <header v-if="game.round && !['ended', 'lobby'].includes(game.stage)" class="top">
      <span>{{ t('play.round', { n: game.round.index + 1, total: game.totalRounds }) }}</span>
      <b>{{ game.score }}</b>
    </header>

    <p v-if="game.stage === 'connecting'" class="notice muted">{{ t('play.connecting') }}</p>

    <div v-else-if="['lost', 'full', 'kicked'].includes(game.stage)" class="notice">
      <p>{{ t(`play.${game.stage}`) }}</p>
      <NuxtLink class="button" :to="localePath('/')">{{ t('play.home') }}</NuxtLink>
    </div>

    <template v-else-if="game.stage === 'lobby'">
      <p v-if="solo" class="notice muted">{{ t('play.connecting') }}</p>
      <template v-else>
        <LobbyPanel />
        <button type="button" class="quit" @click="quit">{{ t('lobby.leave') }}</button>
      </template>
    </template>

    <template v-else-if="(game.stage === 'countdown' || game.stage === 'playing') && game.round">
      <p v-if="controller && !game.screens" class="no-screen" role="status">
        {{ t('play.screenGone') }}
      </p>
      <section class="stage" :class="{ controller }">
        <ZoomStrip v-if="!controller" :crops="game.crops" :media-url="game.mediaUrl" />
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
            :scoring="game.scoring"
            :found-before="game.answeredIds.length"
            :malus="malus"
            :frozen="game.answered"
            :server-now="game.serverNow"
            :media-url="game.mediaUrl"
            @value="worth = $event"
          >
            <span class="look-up">{{ t('play.lookUp') }}</span>
          </LensTimer>
          <template v-if="game.stage === 'playing'">
            <div class="below">
              <p class="display worth">{{ worth }}</p>
              <!-- The "second zone" bonus: another part of the same image, in a small lens.
                   Beside the value, never over the main lens: its ring is the timer. -->
              <img
                v-if="game.hints.secondZone"
                class="second-lens"
                :src="game.mediaUrl(game.hints.secondZone.url)"
                :alt="t('play.secondZoneAlt')"
              />
            </div>
            <p class="muted note">
              <template v-if="!game.seated">{{ t('play.nextRound') }}</template>
              <template v-else-if="game.answered">{{ t('play.foundWaiting') }}</template>
              <template v-else-if="frozen">{{ t('play.frozen') }}</template>
              <template v-else-if="game.scoring === 'fixed'">{{ t('play.worthFixed') }}</template>
              <template v-else>{{ t('play.worthNote') }}</template>
            </p>
            <p v-if="game.hints.initials" class="display initials">{{ game.hints.initials }}</p>
            <p v-if="game.hints.category" class="note">
              {{ t('play.categoryHint', { category: t(`category.${game.hints.category}`) }) }}
            </p>
          </template>
          <p v-else class="muted note">{{ t('play.getReady') }}</p>
        </div>
      </section>

      <EventFeed />
      <BonusBar />

      <!-- On a controller the ranking is on the shared screen: the phone keeps to the controls. -->
      <RankingList
        v-if="!solo && !controller"
        class="live"
        :players="game.players"
        :you="game.you"
        :found-ids="game.answeredIds"
        :gains="game.roundGains"
        :limit="3"
      />

      <!-- In big-screen mode a blur or a flip cannot touch the shared image: it hits the
           target's own controls instead. -->
      <div class="controls" :class="controller ? malus : null">
        <AnswerForm
          v-if="game.answerMode === 'text'"
          :feedback="game.feedback"
          :disabled="!canAnswer"
          @guess="game.guess"
        />
        <ChoiceGrid
          v-else
          :options="game.round.options ?? []"
          :wrong-ids="game.wrongOptionIds"
          :removed-ids="game.hints.removedOptionIds"
          :locked-until="game.lockedUntil"
          :disabled="!canAnswer"
          :server-now="game.serverNow"
          @pick="game.pick"
        />
      </div>
    </template>

    <RevealPanel
      v-else-if="game.stage === 'reveal' && game.reveal"
      :reveal="game.reveal"
      :you="game.you"
      :can-skip="solo || game.isHost"
      :party="!solo"
      :crops="game.crops"
      :server-now="game.serverNow"
      :media-url="game.mediaUrl"
      @next="game.next"
    />

    <section v-else-if="game.stage === 'ended' && game.end" class="end">
      <p class="muted">{{ t('end.title') }}</p>
      <h1 class="display total">{{ game.score }}</h1>

      <template v-if="solo">
        <p>{{ t('end.found', { n: game.foundCount, total: game.totalRounds }) }}</p>
        <p
          v-if="game.end.personalBest"
          class="best"
          :class="{ fresh: game.end.personalBest.isNew }"
        >
          {{
            game.end.personalBest.isNew
              ? t('end.newBest')
              : t('end.best', { score: game.end.personalBest.score })
          }}
        </p>
      </template>
      <RankingList v-else class="final" :players="game.end.ranking" :you="game.you" />

      <div class="actions">
        <button v-if="solo" type="button" class="button" :disabled="busy" @click="replaySolo">
          {{ t('end.replay') }}
        </button>
        <button v-else-if="game.isHost" type="button" class="button" @click="game.playAgain">
          {{ t('end.replayParty') }}
        </button>
        <p v-else class="muted">{{ t('end.waitingHost') }}</p>
        <button type="button" class="button quiet" @click="quit">{{ t('play.home') }}</button>
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
.quit {
  min-height: 44px;
  margin: 0 var(--space-4) calc(var(--space-2) + env(safe-area-inset-bottom));
  border: 0;
  background: none;
  color: var(--muted);
  text-decoration: underline;
  cursor: pointer;
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
/* Controller: no strip, a small lens that only keeps time (or shows a zoom-out bonus). */
.stage.controller {
  grid-template-columns: minmax(0, 1fr);
}
.stage.controller .lens-box {
  flex-basis: 148px;
  max-height: 148px;
}
.look-up {
  font-size: 13px;
  font-weight: 600;
  line-height: 1.25;
  color: var(--muted);
}
.no-screen {
  margin: var(--space-2) var(--space-4) 0;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius);
  background: var(--danger);
  color: #ffffff;
  font-size: 15px;
  font-weight: 600;
}
.controls {
  transition:
    filter 0.25s,
    rotate 0.35s;
}
.controls.blur {
  filter: blur(7px);
}
.controls.flip {
  rotate: 180deg;
}
@media (prefers-reduced-motion: reduce) {
  .controls {
    transition: none;
  }
}
.below {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-3);
}
/* Round like the main lens: the only other round thing on screen, and only while it is earned. */
.second-lens {
  flex: none;
  width: 76px;
  height: 76px;
  margin-top: var(--space-2);
  border: 4px solid var(--surface);
  border-radius: 50%;
  background: var(--surface);
}
.initials {
  margin-top: var(--space-2);
  font-size: 22px;
  font-stretch: 100%;
  letter-spacing: 0.08em;
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
.live {
  padding: 0 var(--space-4) var(--space-3);
}
.end {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  padding: var(--space-10) var(--space-4) calc(var(--space-4) + env(safe-area-inset-bottom));
  overflow-y: auto;
}
.total {
  font-size: clamp(56px, 20vw, 88px);
}
.final {
  margin-top: var(--space-4);
  font-size: 17px;
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
  padding-top: var(--space-6);
}
</style>
