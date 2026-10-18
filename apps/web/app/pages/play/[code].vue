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
const inRound = computed(
  () => (game.stage === 'countdown' || game.stage === 'playing') && !!game.round,
);
// On a computer the ranking has a column of its own: everyone fits, not only the top three.
const wide = useWideScreen();
// Big-screen mode: the image is on the shared screen, this phone only answers and plays bonuses.
const controller = computed(() => game.display === 'bigscreen');
// On a computer the round, the reveal, the lobby and the result sit in the cabin; a controller's
// round keeps to its phone-sized layout, and a solo room's brief lobby is only a notice.
const cabin = computed(
  () =>
    ['lobby', 'countdown', 'playing', 'reveal', 'ended'].includes(game.stage) &&
    !(controller.value && inRound.value),
);
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

// Reporting somebody from a public game, once it is over.
const reporting = ref<{ id: string; nickname: string } | null>(null);
const others = computed(() => (game.end?.ranking ?? []).filter((player) => player.id !== game.you));

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
        roundSeconds: game.roundSeconds,
        hints: game.hintsOn,
        difficulty: game.difficulty,
        packIds: [],
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
  <main
    class="screen"
    :class="{ 'in-round': inRound, cabin, controller, [`at-${game.stage}`]: true }"
    :data-brand="appName"
  >
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
      <LobbyPanel />
      <button type="button" class="quit" @click="quit">{{ t('lobby.leave') }}</button>
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
            :round-seconds="game.roundSeconds"
            :after-hint="!!game.roundHint"
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
              <template v-else-if="game.partialPoints !== null">{{
                t('play.partial', { points: game.partialPoints })
              }}</template>
              <template v-else-if="game.answered">{{ t('play.foundWaiting') }}</template>
              <template v-else-if="frozen">{{ t('play.frozen') }}</template>
              <template v-else-if="game.scoring === 'fixed'">{{ t('play.worthFixed') }}</template>
              <template v-else>{{ t('play.worthNote') }}</template>
            </p>
            <RoomHint v-if="game.roundHint" :hint="game.roundHint" />
            <button
              v-if="game.roundSeconds === null && (game.isHost || solo)"
              type="button"
              class="button quiet skip"
              @click="game.skipRound()"
            >
              {{ t(solo ? 'play.giveUp' : 'play.skip') }}
            </button>
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
        :limit="wide ? undefined : 3"
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
      <div class="result">
        <p class="muted">{{ t('end.title') }}</p>
        <h1 class="display total">{{ game.score }}</h1>
      </div>

      <div class="outcome">
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

        <!-- Public games put strangers together: the way to say something went wrong is here. -->
        <section v-if="game.mode === 'public'" class="report-zone">
          <template v-if="reporting">
            <ReportDialog
              :player-id="reporting.id"
              :nickname="reporting.nickname"
              @close="reporting = null"
            />
          </template>
          <template v-else>
            <p class="muted">{{ t('report.who') }}</p>
            <div class="targets">
              <button
                v-for="player in others"
                :key="player.id"
                type="button"
                class="button quiet small"
                @click="reporting = player"
              >
                {{ player.nickname }}
              </button>
            </div>
          </template>
        </section>

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
/* Two groups that only become columns on a computer. */
.result,
.outcome {
  display: contents;
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
.report-zone {
  margin-top: var(--space-4);
  font-size: 15px;
}
.targets {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-top: var(--space-2);
}
.button.small {
  min-height: 44px;
  padding: 0 var(--space-3);
  font-size: 15px;
}

/* Computer. Same breakpoint as useWideScreen. */
@media (min-width: 1080px) {
  .screen {
    max-width: 1240px;
    padding-inline: var(--space-6);
  }
  /* A link-like button: as wide as its words. */
  .quit {
    align-self: flex-start;
  }

  /* A controller's round (big-screen mode on a computer) keeps the two columns it had: the
     lens only keeps time, the column holds the news, the bonuses, the ranking and the answer. */
  .screen.in-round.controller {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 380px;
    grid-template-rows: auto auto auto auto minmax(0, 1fr) auto;
    grid-template-areas:
      'top top'
      'alert alert'
      'stage feed'
      'stage bonus'
      'stage ranking'
      'stage controls';
    column-gap: 48px;
    padding-bottom: var(--space-6);
  }
  .in-round.controller .top {
    grid-area: top;
    padding-inline: 0;
    font-size: 17px;
  }
  .in-round.controller .no-screen {
    grid-area: alert;
    margin-inline: 0;
  }
  .in-round.controller .stage {
    grid-area: stage;
    padding: var(--space-6) 0 0;
  }
  .in-round.controller .feed {
    grid-area: feed;
    padding-top: var(--space-6);
  }
  .in-round.controller .bonuses {
    grid-area: bonus;
  }
  .in-round.controller .live {
    grid-area: ranking;
    padding: var(--space-4) 0;
    overflow-y: auto;
  }
  .in-round.controller .controls {
    grid-area: controls;
    overflow: hidden;
    border-radius: var(--radius);
  }

  /* The cabin: the curtain down the left, the strip on it. */
  .screen.cabin {
    --panel: 21vw;
    --side: clamp(320px, 24vw, 440px);
    --gutter: clamp(24px, 3vw, 56px);
    position: relative;
    max-width: none;
    padding: 0;
  }
  .screen.cabin.at-lobby,
  .screen.cabin.at-ended {
    --panel: 30vw;
  }
  /* The name at the top of the curtain, as on every other page. Out of the flow, so that no
     layout below has to make room for it. */
  .screen.cabin::before,
  .screen.at-lost::before,
  .screen.at-full::before,
  .screen.at-kicked::before {
    content: attr(data-brand) / '';
    position: absolute;
    top: var(--space-6);
    left: var(--space-6);
    color: var(--curtain-ink);
    font: 800 22px/1 var(--font-display);
    font-stretch: 140%;
  }

  /* The round: strip | lens | everything the player reads and does, top to bottom. The stage
     and its view step aside so that their children are placed on this grid. */
  .screen.cabin.in-round {
    display: grid;
    grid-template-columns: var(--panel) minmax(0, 1fr) var(--side);
    /* The bonuses row may shrink and scroll: a long list of targets must not push itself off
       the bottom of the window. */
    grid-template-rows: repeat(6, auto) minmax(0, auto) minmax(0, 1fr);
    column-gap: var(--gutter);
    padding-right: var(--gutter);
  }
  .cabin.in-round .stage,
  .cabin.in-round .view {
    display: contents;
  }
  .cabin.in-round .strip {
    grid-column: 1;
    grid-row: 1 / -1;
    align-self: center;
    justify-self: center;
    /* Four square frames and the feed under them must fit the height. */
    width: min(var(--panel) * 0.5, (var(--viewport-height) - 220px) / 4);
  }
  .cabin.in-round .feed {
    position: absolute;
    left: 0;
    bottom: var(--space-6);
    width: var(--panel);
    padding: 0 var(--space-6);
  }
  .cabin.in-round .lens-box {
    grid-column: 2;
    grid-row: 1 / -1;
    align-self: center;
    justify-self: center;
    flex: none;
    width: min(100%, var(--viewport-height) - 96px);
    min-height: 0;
    max-height: none;
  }
  .cabin.in-round .waiting {
    font-size: 160px;
  }
  .cabin.in-round .top {
    grid-column: 3;
    grid-row: 1;
    padding: var(--space-10) 0 0;
    font-size: 17px;
  }
  .cabin.in-round .below {
    grid-column: 3;
    grid-row: 2;
  }
  /* Four digits are about 3.6 em wide in the display face: this fills the column. */
  .cabin.in-round .worth {
    margin-top: var(--space-6);
    font-size: min(104px, var(--side) / 3.9);
  }
  .cabin.in-round .note.muted {
    grid-column: 3;
    grid-row: 3;
    font-size: 17px;
  }
  .cabin.in-round .initials {
    grid-column: 3;
    grid-row: 4;
    font-size: 32px;
  }
  .cabin.in-round .note:not(.muted) {
    grid-column: 3;
    grid-row: 5;
  }
  .cabin.in-round .controls {
    grid-column: 3;
    grid-row: 6;
    margin-top: var(--space-6);
  }
  .cabin.in-round .bonuses {
    grid-column: 3;
    grid-row: 7;
    min-height: 0;
    padding: var(--space-4) 0 0;
    overflow-y: auto;
  }
  .cabin.in-round .live {
    grid-column: 3;
    grid-row: 8;
    padding: var(--space-6) 0 var(--space-10);
    overflow-y: auto;
    font-size: 17px;
  }

  /* Leaving the lobby is a link at the foot of the curtain. */
  .screen.cabin.at-lobby .quit {
    position: absolute;
    left: var(--space-10);
    bottom: var(--space-6);
    margin: 0;
    color: var(--curtain-ink);
  }

  /* During the reveal the round and score line belongs to the right-hand column. */
  .screen.cabin.at-reveal .top {
    width: var(--side);
    margin: 0 var(--gutter) 0 auto;
    padding: var(--space-10) 0 0;
    font-size: 17px;
  }

  /* The end of a game: the total on the curtain, what it means on the right. */
  .cabin .end {
    display: grid;
    grid-template-columns: var(--panel) minmax(0, 1fr);
    column-gap: var(--gutter);
    padding: 0 var(--gutter) 0 0;
  }
  .cabin .result {
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: var(--space-10) var(--space-6);
    color: var(--curtain-ink);
    container-type: inline-size;
  }
  .cabin .result .muted {
    color: inherit;
    font-size: 19px;
  }
  /* "12 480" is about 5.5 em wide in the display face. */
  .cabin .total {
    font-size: min(176px, 17cqi);
  }
  .cabin .outcome {
    display: flex;
    flex-direction: column;
    /* `safe`: a long result overflows downwards, where it can be scrolled, not past the top. */
    justify-content: safe center;
    justify-self: center;
    width: min(720px, 100%);
    min-height: 0;
    padding: var(--space-10) 0;
    overflow-y: auto;
    font-size: 19px;
  }
  /* The first three of a party as a podium of cards, the rest as a list under them. */
  .cabin .final {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--space-3);
    font-size: 19px;
  }
  .cabin .final :deep(li) {
    grid-column: 1 / -1;
  }
  .cabin .final :deep(li:nth-child(-n + 3)) {
    grid-column: auto;
    flex-direction: column;
    justify-content: space-between;
    min-height: 140px;
    padding: var(--space-4);
    border-radius: var(--radius);
    background: var(--surface);
    color: var(--ink);
    font-size: 21px;
  }
  /* The winner's card takes the curtain's colour: a podium, not three equal boxes. */
  .cabin .final :deep(li:first-child) {
    min-height: 172px;
    background: var(--curtain);
    color: var(--curtain-ink);
    font-size: 25px;
  }
  .cabin .actions {
    margin-top: 0;
  }
  .cabin .actions .button {
    min-height: 64px;
    font-size: 19px;
  }

  /* A notice: the curtain across the top, the message in a block centred under it. */
  .screen.at-lost,
  .screen.at-full,
  .screen.at-kicked {
    position: relative;
    max-width: none;
    padding: 0;
    background:
      var(--curtain-folds) 0 0 / 100% 38vh no-repeat,
      linear-gradient(var(--curtain), var(--curtain)) 0 0 / 100% 38vh no-repeat,
      var(--bg);
  }
  .at-lost .notice,
  .at-full .notice,
  .at-kicked .notice {
    width: min(560px, 100% - 2 * var(--space-10));
    margin: 30vh auto auto;
    padding: var(--space-10);
    border-radius: var(--radius);
    background: var(--surface);
  }
}
</style>
