<script setup lang="ts">
import { DEFAULT_DIFFICULTY, ROOM, roomCodeSchema, DEFAULT_ROUND_SECONDS } from '@closeup/shared';
import { renderSVG } from 'uqr';

/**
 * The shared screen of a big-screen room: the close-up, the timer, the live ranking and the code
 * to join. It is a spectator: nobody plays here, and nothing on this page sends a game command.
 * Sizes are in viewport units because it is read from across a room, not held in a hand.
 */
const route = useRoute();
const { t, locale } = useI18n();
const localePath = useLocalePath();
const game = useGameStore();
const { appName } = useRuntimeConfig().public;

useHead({ title: () => t('screen.title', { appName }) });

const worth = ref(1000);
const clock = ref(0);
let ticker: ReturnType<typeof setInterval> | undefined;

const joinPath = computed(() => localePath(`/join/${game.code}`));
const joinUrl = computed(() => (import.meta.client ? location.origin + joinPath.value : ''));
const siteHost = computed(() => (import.meta.client ? location.host : ''));
// As an image rather than injected markup: nothing from the page ever runs as HTML.
const qrSrc = computed(() =>
  joinUrl.value
    ? `data:image/svg+xml;utf8,${encodeURIComponent(renderSVG(joinUrl.value, { border: 2 }))}`
    : '',
);

const inRound = computed(
  () => (game.stage === 'countdown' || game.stage === 'playing') && game.round !== null,
);
const countdown = computed(() =>
  Math.max(0, Math.ceil(((game.round?.startsAt ?? 0) - clock.value) / 1000)),
);
const nextIn = computed(() => {
  const nextAt = game.reveal?.nextAt;
  return nextAt ? Math.max(0, Math.ceil((nextAt - clock.value) / 1000)) : 0;
});
const hostName = computed(() => game.players.find((p) => p.id === game.hostId)?.nickname ?? '');
const gains = computed(() =>
  Object.fromEntries((game.reveal?.results ?? []).map((r) => [r.playerId, r.points])),
);
// The circle marks what the first zoom level showed. `r` is a fraction of the image width.
const zone = computed(() => {
  const { cx, cy, r } = game.reveal?.reveal.zone ?? { cx: 0, cy: 0, r: 0 };
  return { cx: cx * 100, cy: cy * 100, r: r * 100 };
});

// A TV that goes to sleep mid-round ends the party. The lock is lost whenever the tab is hidden,
// so it is asked for again each time the page comes back.
let wakeLock: WakeLockSentinel | null = null;
async function keepAwake(): Promise<void> {
  if (document.visibilityState !== 'visible' || !('wakeLock' in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
  } catch {
    // Refused (battery saver, old browser): the screen still works, it may just dim.
  }
}

const isFullscreen = ref(false);
const canFullscreen = ref(false);
const onFullscreenChange = () => (isFullscreen.value = document.fullscreenElement !== null);
function goFullscreen(): void {
  void document.documentElement.requestFullscreen?.().catch(() => undefined);
}

onMounted(() => {
  const code = roomCodeSchema.safeParse(route.params.code);
  if (!code.success) return navigateTo(localePath('/'));

  void game.enter(code.data, 'screen');
  ticker = setInterval(() => (clock.value = game.serverNow()), 200);
  canFullscreen.value = document.fullscreenEnabled;
  document.addEventListener('fullscreenchange', onFullscreenChange);
  document.addEventListener('visibilitychange', keepAwake);
  void keepAwake();
});

onBeforeUnmount(() => {
  clearInterval(ticker);
  document.removeEventListener('fullscreenchange', onFullscreenChange);
  document.removeEventListener('visibilitychange', keepAwake);
  void wakeLock?.release().catch(() => undefined);
  game.leave();
});

const busy = ref(false);
/** The room is gone (everyone left, or nobody came): this screen opens a fresh one. */
async function reopen(): Promise<void> {
  busy.value = true;
  try {
    const code = await game.createRoom(
      'private',
      {
        rounds: ROOM.defaultRounds,
        answerMode: 'text',
        scoring: 'decay',
        display: 'bigscreen',
        roundSeconds: DEFAULT_ROUND_SECONDS,
        hints: true,
        difficulty: DEFAULT_DIFFICULTY,
        packIds: [],
      },
      locale.value as 'fr' | 'en',
      'screen',
    );
    // A new code is a new page: it mounts again and joins the room by itself.
    await navigateTo(localePath(`/screen/${code}`));
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <main class="tv cabin" :class="`at-${game.stage}`">
    <header class="bar">
      <span class="display brand">{{ appName }}</span>
      <span v-if="game.round && (inRound || game.stage === 'reveal')" class="muted">
        {{ t('play.round', { n: game.round.index + 1, total: game.totalRounds }) }}
      </span>
      <span class="grow" />
      <!-- Latecomers can still join: they play from the next round. -->
      <span v-if="game.code && !['lobby', 'lost', 'connecting'].includes(game.stage)" class="chip">
        {{ t('screen.joinChip', { host: siteHost }) }} <b>{{ game.code }}</b>
      </span>
      <!-- Colours are chosen before the game: during it the screen belongs to the image. -->
      <ThemeSwitch v-if="['lobby', 'ended'].includes(game.stage)" class="theme" />
      <button
        v-if="canFullscreen && !isFullscreen"
        type="button"
        class="button quiet small"
        @click="goFullscreen"
      >
        {{ t('screen.fullscreen') }}
      </button>
    </header>

    <p v-if="game.stage === 'connecting'" class="notice muted">{{ t('play.connecting') }}</p>

    <div v-else-if="['lost', 'full'].includes(game.stage)" class="notice">
      <h1 class="display">{{ t(game.stage === 'full' ? 'screen.full' : 'screen.closed') }}</h1>
      <p class="muted">{{ t('screen.closedHint') }}</p>
      <div class="row">
        <button type="button" class="button" :disabled="busy" @click="reopen">
          {{ t('screen.reopen') }}
        </button>
        <NuxtLink class="button quiet" :to="localePath('/')">{{ t('play.home') }}</NuxtLink>
      </div>
    </div>

    <section v-else-if="game.stage === 'lobby'" class="split lobby">
      <div class="invite">
        <p class="step">{{ t('screen.scan') }}</p>
        <img v-if="qrSrc" class="qr" :src="qrSrc" :alt="t('lobby.qrAlt')" />
        <p class="muted">{{ t('screen.orCode', { host: siteHost }) }}</p>
        <p class="display code">{{ game.code }}</p>
      </div>
      <aside class="side">
        <h2>{{ t('lobby.players', { n: game.players.length, max: ROOM.maxPlayers }) }}</h2>
        <ul class="names">
          <li v-for="player in game.players" :key="player.id" :class="{ off: !player.connected }">
            {{ player.nickname }}
            <small v-if="player.id === game.hostId">{{ t('lobby.host') }}</small>
          </li>
        </ul>
        <p v-if="!game.players.length" class="muted">{{ t('screen.firstIsHost') }}</p>
        <p v-else class="muted">{{ t('screen.hostStarts', { host: hostName }) }}</p>
        <!-- What the host chose, readable by the whole room before it starts. -->
        <dl class="settings" :aria-label="t('screen.settings')">
          <div>
            <dt>{{ t('home.rounds') }}</dt>
            <dd>{{ game.totalRounds }}</dd>
          </div>
          <div>
            <dt>{{ t('home.answerMode') }}</dt>
            <dd>{{ t(game.answerMode === 'text' ? 'home.text' : 'home.mcq') }}</dd>
          </div>
          <div>
            <dt>{{ t('home.scoring') }}</dt>
            <dd>{{ t(`home.scoringMode.${game.scoring}`) }}</dd>
          </div>
          <div>
            <dt>{{ t('lobby.roundSeconds') }}</dt>
            <dd>
              {{
                game.roundSeconds === null
                  ? t('lobby.untimed')
                  : t('lobby.seconds', { n: game.roundSeconds })
              }}
            </dd>
          </div>
          <div>
            <dt>{{ t('lobby.hints') }}</dt>
            <dd>{{ t(game.hintsOn ? 'lobby.yes' : 'lobby.no') }}</dd>
          </div>
          <div>
            <dt>{{ t('lobby.difficulty') }}</dt>
            <dd>{{ t(`lobby.difficultyLevel.${game.difficulty}`) }}</dd>
          </div>
          <div class="wide">
            <dt>{{ t('lobby.packs') }}</dt>
            <dd>
              {{
                game.packIds.length
                  ? t('lobby.packsChosen', { n: game.packIds.length })
                  : t('lobby.packsAll')
              }}
            </dd>
          </div>
        </dl>
        <p v-if="game.display === 'phones'" class="warn">{{ t('screen.phonesMode') }}</p>
        <!-- A full room needs the height for its names: the board shrinks, then leaves. -->
        <HowToPlay
          v-if="game.players.length <= 8"
          layout="board"
          class="howto-board"
          :compact="game.players.length > 4"
        />
      </aside>
    </section>

    <section v-else-if="inRound && game.round" class="split round">
      <div class="shot">
        <ZoomStrip class="strip" :crops="game.crops" :media-url="game.mediaUrl" />
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
          :penalty="0"
          :scoring="game.scoring"
          :found-before="game.answeredIds.length"
          :malus="null"
          :frozen="false"
          :server-now="game.serverNow"
          :media-url="game.mediaUrl"
          @value="worth = $event"
        />
      </div>
      <aside class="side">
        <template v-if="game.stage === 'playing'">
          <p class="display worth">{{ worth }}</p>
          <p class="muted">
            {{ t(game.scoring === 'fixed' ? 'play.worthFixed' : 'screen.worthNote') }}
          </p>
          <ol v-if="game.round.options?.length" class="options">
            <li
              v-for="(option, i) in game.round.options"
              :key="option.id"
              :style="{ background: `var(--option-${i % 4})` }"
            >
              <OptionMark :index="i" />
              {{ option.label }}
            </li>
          </ol>
        </template>
        <p v-else class="display ready">{{ t('play.getReady') }}</p>
        <EventFeed class="feed" />
        <RoomHint v-if="game.roundHint" :hint="game.roundHint" />
        <RankingList
          class="board"
          :players="game.players"
          you=""
          :found-ids="game.answeredIds"
          :gains="game.roundGains"
        />
      </aside>
    </section>

    <section v-else-if="game.stage === 'reveal' && game.reveal" class="split round">
      <div class="shot">
        <ZoomStrip class="strip" :crops="game.crops" :media-url="game.mediaUrl" />
        <figure>
          <div class="photo">
            <img
              :src="game.mediaUrl(game.reveal.reveal.imageUrl)"
              :alt="game.reveal.reveal.answer"
            />
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              <circle :cx="zone.cx" :cy="zone.cy" :r="zone.r" class="halo" />
              <circle :cx="zone.cx" :cy="zone.cy" :r="zone.r" class="mark" />
            </svg>
          </div>
          <figcaption class="muted">
            <CreditLine
              :author="game.reveal.reveal.credit.author"
              :licence="game.reveal.reveal.credit.licence"
            />
          </figcaption>
        </figure>
      </div>
      <aside class="side">
        <p class="muted">{{ t('screen.itWas') }}</p>
        <h1 class="display answer">{{ game.reveal.reveal.answer }}</h1>
        <p v-if="game.reveal.reveal.zoneLabel" class="muted">
          {{ t('screen.zone', { zone: game.reveal.reveal.zoneLabel }) }}
        </p>
        <RankingList class="board" :players="game.reveal.ranking" you="" :gains="gains" />
        <p v-if="nextIn" class="muted">
          {{ t(game.reveal.isLast ? 'reveal.resultIn' : 'reveal.nextIn', { seconds: nextIn }) }}
        </p>
      </aside>
    </section>

    <section v-else-if="game.stage === 'ended' && game.end" class="split final">
      <div class="podium">
        <p class="muted">{{ t('screen.winner') }}</p>
        <h1 class="display answer">{{ game.end.ranking[0]?.nickname }}</h1>
        <p class="display worth">{{ game.end.ranking[0]?.score }}</p>
      </div>
      <aside class="side">
        <h2>{{ t('screen.finalRanking') }}</h2>
        <RankingList class="board" :players="game.end.ranking" you="" />
        <p class="muted">{{ t('screen.replayHint', { host: hostName }) }}</p>
      </aside>
    </section>
  </main>
</template>

<style scoped>
.tv {
  --ring-width: 1.7vmin;
  display: flex;
  flex-direction: column;
  height: 100dvh;
  padding: 2.5vmin 4vmin 4vmin;
  overflow: hidden;
  font-size: clamp(16px, 2.3vmin, 30px);
}
.bar {
  display: flex;
  align-items: center;
  gap: 3vmin;
  min-height: 48px;
}
.brand {
  font-size: 1.3em;
}
.grow {
  flex: 1;
}
.chip b {
  margin-left: 0.4em;
  font-family: var(--font-display);
  font-size: 1.25em;
  letter-spacing: 0.06em;
  color: var(--ink);
}
.chip {
  color: var(--muted);
}
.button.small {
  min-height: 44px;
  padding: 0 var(--space-4);
  font-size: 15px;
}
.notice {
  display: grid;
  gap: 2.5vmin;
  justify-items: start;
  margin: auto 0;
  max-width: 28em;
}
.notice h1 {
  font-size: 2.6em;
}
.row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
}

/* Two columns on a TV or a laptop; one under the other on a screen held upright. */
.split {
  display: grid;
  grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr);
  gap: 5vmin;
  flex: 1;
  min-height: 0;
  padding-top: 2.5vmin;
}
.side {
  display: flex;
  flex-direction: column;
  gap: 1.4vmin;
  min-height: 0;
  overflow: hidden;
}
h2 {
  font-size: 1em;
  font-weight: 700;
}

/* ---- lobby ---- */
/* The host's choices, as tiles the room can read. */
.settings {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(clamp(110px, 13vmin, 200px), 1fr));
  gap: 0.8vmin;
  margin: 0;
  font-size: 0.85em;
}
.settings div {
  padding: 0.7vmin 1.2vmin;
  border-radius: var(--radius);
  background: var(--surface);
}
.settings .wide {
  grid-column: 1 / -1;
}
.settings dt {
  color: var(--muted);
  font-size: 0.85em;
}
.settings dd {
  margin: 0;
  font-size: 1.1em;
  font-weight: 700;
}
/* Everything in the column must fit a TV: it starts at the top rather than overflowing both ends. */
.lobby .side {
  justify-content: flex-start;
  gap: 1.4vmin;
}
/* How to play, read from the sofa while people join. */
.howto-board {
  padding: 1.6vmin 2vmin;
  border-radius: var(--radius);
  background: var(--surface);
}
.invite {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  gap: 1.6vmin;
}
.step {
  font-size: 1.5em;
  font-weight: 700;
}
.qr {
  width: min(44vmin, 100%);
  aspect-ratio: 1;
  border-radius: var(--radius);
  background: #ffffff;
}
.code {
  font-size: clamp(56px, 13vmin, 180px);
  line-height: 0.95;
  letter-spacing: 0.04em;
}
.lobby .side {
  justify-content: center;
}
.names {
  display: flex;
  flex-wrap: wrap;
  gap: 1.2vmin;
  margin: 0;
  padding: 0;
  list-style: none;
}
.names li {
  padding: 0.35em 0.7em;
  border-radius: var(--radius);
  background: var(--surface);
  font-size: 1.25em;
  font-weight: 700;
  animation: arrive 0.3s ease-out;
}
.names li.off {
  opacity: 0.5;
}
.names small {
  margin-left: 0.4em;
  font-size: 0.6em;
  font-weight: 400;
  color: var(--muted);
}
.warn {
  padding: 0.6em 0.8em;
  border: 1.5px dashed var(--ink);
  border-radius: var(--radius);
}
@keyframes arrive {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
}

/* ---- round and reveal ---- */
.shot {
  display: grid;
  grid-template-columns: clamp(52px, 9vmin, 120px) minmax(0, 1fr);
  gap: 2.4vmin;
  align-items: start;
  min-height: 0;
}
.strip :deep(li span) {
  font-size: clamp(10px, 1.3vmin, 16px);
}
.lens-box {
  width: min(100%, 78vh);
  aspect-ratio: 1;
}
.waiting {
  display: grid;
  place-items: center;
  border: var(--ring-width) solid var(--ring-track);
  border-radius: 50%;
  font-size: 22vmin;
}
.worth {
  font-size: clamp(56px, 14vmin, 200px);
  line-height: 0.95;
  font-variant-numeric: tabular-nums;
}
.ready {
  font-size: 3em;
}
.options {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1.2vmin;
  margin: 0;
  padding: 0;
  list-style: none;
}
.options li {
  --mark-size: 0.9em;
  display: flex;
  gap: 0.5em;
  align-items: center;
  padding: 0.55em 0.7em;
  border-radius: var(--radius);
  color: #ffffff;
  font-weight: 800;
  line-height: 1.2;
}
.feed {
  padding: 0;
}
.feed :deep(p) {
  font-size: 0.85em;
}
.side .board {
  margin-top: auto;
  font-size: 1.1em;
  color: var(--ink);
}
.side .board :deep(small) {
  font-size: 0.7em;
}
.side .board :deep(li) {
  padding: 0.25em 0;
  border-top: 1px solid var(--line);
}
figure {
  margin: 0;
  min-width: 0;
}
.photo {
  position: relative;
  width: fit-content;
  padding: 0.8vmin;
  border-radius: var(--radius);
  background: var(--surface);
}
.photo img {
  display: block;
  max-width: 100%;
  max-height: 72vh;
  border-radius: 2px;
}
.photo svg {
  position: absolute;
  inset: 0.8vmin;
  width: calc(100% - 1.6vmin);
  height: calc(100% - 1.6vmin);
  overflow: visible;
}
circle {
  fill: none;
  vector-effect: non-scaling-stroke;
}
.halo {
  stroke: #ffffff;
  stroke-width: 9;
}
.mark {
  stroke: var(--accent);
  stroke-width: 5;
}
figcaption {
  margin-top: 1vmin;
  font-size: 0.7em;
}
.answer {
  font-size: clamp(40px, 8.5vmin, 120px);
  line-height: 1;
  overflow-wrap: anywhere;
}

/* ---- end ---- */
.podium {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 1.5vmin;
}
.final .side {
  justify-content: center;
}
.final .side .board {
  margin-top: 0;
}

/* A TV or a laptop: the cabin, readable from across the room. The strip and the code to join
   are placed on the curtain; the sections keep their own two columns to its right. */
@media (min-width: 1080px) and (orientation: landscape) {
  .tv {
    --panel: 16vw;
    position: relative;
    padding-left: calc(var(--panel) + 4vmin);
  }
  /* The lobby's invitation is the curtain itself: wider, and the section starts at the edge. */
  .tv.at-lobby {
    --panel: 34vw;
    padding-left: 4vmin;
  }
  .bar .brand {
    position: absolute;
    top: 2.5vmin;
    left: 2.4vw;
    color: var(--curtain-ink);
  }
  .bar .chip {
    position: absolute;
    left: 2.4vw;
    bottom: 4vmin;
    width: calc(var(--panel) - 4.8vw);
    color: var(--curtain-ink);
  }
  .bar .chip b {
    display: block;
    margin: 0.2em 0 0;
    color: inherit;
    font-size: 2em;
  }
  .shot {
    grid-template-columns: minmax(0, 1fr);
  }
  /* Under the name, and short enough to leave the foot of the curtain to the code to join. */
  .shot .strip {
    position: absolute;
    top: 11vh;
    left: calc(var(--panel) / 2);
    width: min(var(--panel) * 0.6, 15vh);
    translate: -50% 0;
  }
  .lens-box {
    width: min(100%, 86vh);
  }
  /* The column is narrower beside the curtain: the answer is sized on it, so that a long word
     ("coccinelle") shrinks instead of breaking. */
  .side {
    container-type: inline-size;
  }
  .answer {
    font-size: min(120px, 8.5vmin, 9.5cqi);
  }
  .split.lobby {
    grid-template-columns: calc(var(--panel) - 8vmin) minmax(0, 1fr);
    column-gap: 8vmin;
  }
  .lobby .invite {
    color: var(--curtain-ink);
    container-type: inline-size;
  }
  .lobby .invite .muted {
    color: inherit;
  }
  .code {
    font-size: min(180px, 18cqi);
  }
  .qr {
    width: min(100%, 52vmin);
  }
}
/* A TV standing upright keeps its single column, and no curtain. */
@media (orientation: portrait) {
  .tv {
    --panel: 0px;
    height: auto;
    min-height: 100dvh;
    overflow: visible;
  }
  .split {
    grid-template-columns: minmax(0, 1fr);
  }
  .side {
    overflow: visible;
  }
  .lens-box {
    width: min(100%, 60vh);
  }
}
@media (prefers-reduced-motion: reduce) {
  .names li {
    animation: none;
  }
}
</style>
