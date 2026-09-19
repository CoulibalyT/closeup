<script setup lang="ts">
import {
  type AnswerMode,
  DISPLAY_MODES,
  type DisplayMode,
  ROOM,
  SCORING_MODES,
  type ScoringMode,
} from '@closeup/shared';
import { renderSVG } from 'uqr';

const { t } = useI18n();
const localePath = useLocalePath();
const game = useGameStore();

const joinUrl = computed(() =>
  import.meta.client ? location.origin + localePath(`/join/${game.code}`) : '',
);
// As an image rather than injected markup: nothing from the page ever runs as HTML.
const qrSrc = computed(() =>
  joinUrl.value
    ? `data:image/svg+xml;utf8,${encodeURIComponent(renderSVG(joinUrl.value, { border: 2 }))}`
    : '',
);

// What to open on the TV or the laptop. Shown without the scheme: it is typed by hand.
const screenPath = computed(() => localePath(`/screen/${game.code}`));
const screenUrl = computed(() =>
  import.meta.client ? location.host + screenPath.value : screenPath.value,
);

const shared = ref(false);
async function share(): Promise<void> {
  const data = { title: t('lobby.shareTitle'), url: joinUrl.value };
  try {
    if (navigator.share) await navigator.share(data);
    else await navigator.clipboard.writeText(joinUrl.value);
    shared.value = true;
    setTimeout(() => (shared.value = false), 2_500);
  } catch {
    // The share sheet was dismissed: nothing to report.
  }
}

const canShareNatively = computed(() => import.meta.client && 'share' in navigator);

// The server takes the settings as a whole. Building them from the store would send a stale
// half when two choices are made in quick succession (the first echo has not come back yet), so
// the host's choices live in a local draft that is updated at once and follows the server.
const draft = reactive({
  rounds: game.totalRounds,
  answerMode: game.answerMode,
  scoring: game.scoring,
  display: game.display,
});
watch(
  () => [game.totalRounds, game.answerMode, game.scoring, game.display] as const,
  ([rounds, answerMode, scoring, display]) =>
    Object.assign(draft, { rounds, answerMode, scoring, display }),
);
function setDisplay(display: DisplayMode): void {
  draft.display = display;
  void game.updateSettings({ ...draft });
}
function setScoring(scoring: ScoringMode): void {
  draft.scoring = scoring;
  void game.updateSettings({ ...draft });
}
function setRounds(rounds: number): void {
  draft.rounds = rounds;
  void game.updateSettings({ ...draft });
}
function setMode(answerMode: AnswerMode): void {
  draft.answerMode = answerMode;
  void game.updateSettings({ ...draft });
}

const startError = ref<string | null>(null);
const starting = ref(false);
async function start(): Promise<void> {
  starting.value = true;
  startError.value = await game.start();
  starting.value = false;
}

const enoughPlayers = computed(() => game.presentCount >= ROOM.minPlayers);
// Phones show no image in big-screen mode: the game waits for a screen (the server checks too).
const bigScreen = computed(() => game.display === 'bigscreen');
const screenMissing = computed(() => bigScreen.value && game.screens === 0);
</script>

<template>
  <section class="lobby">
    <p class="muted">{{ t('lobby.codeLabel') }}</p>
    <h1 class="display code">{{ game.code }}</h1>

    <div class="invite">
      <img v-if="qrSrc" class="qr" :src="qrSrc" :alt="t('lobby.qrAlt')" />
      <div>
        <p>{{ t('lobby.inviteHint') }}</p>
        <button type="button" class="button quiet" @click="share">
          {{ shared ? t('lobby.copied') : canShareNatively ? t('lobby.share') : t('lobby.copy') }}
        </button>
      </div>
    </div>

    <div v-if="bigScreen" class="screen-status" :class="{ on: !screenMissing }" role="status">
      <template v-if="screenMissing">
        <p>
          <b>{{ t('lobby.screenOpen') }}</b>
        </p>
        <p class="url">{{ screenUrl }}</p>
        <NuxtLink class="here" :to="screenPath" target="_blank">{{
          t('lobby.screenHere')
        }}</NuxtLink>
      </template>
      <p v-else>
        <b>{{ t('lobby.screenOn') }}</b>
      </p>
    </div>

    <h2>{{ t('lobby.players', { n: game.players.length, max: ROOM.maxPlayers }) }}</h2>
    <ul class="players">
      <li v-for="player in game.players" :key="player.id" :class="{ offline: !player.connected }">
        <span class="name">
          {{ player.nickname }}
          <small v-if="player.id === game.you">{{ t('lobby.you') }}</small>
          <small v-if="player.id === game.hostId">{{ t('lobby.host') }}</small>
          <small v-if="!player.connected">{{ t('lobby.offline') }}</small>
        </span>
        <button
          v-if="game.isHost && player.id !== game.you"
          type="button"
          class="remove"
          @click="game.kick(player.id)"
        >
          {{ t('lobby.remove') }}
        </button>
      </li>
    </ul>

    <template v-if="game.isHost">
      <fieldset>
        <legend>{{ t('home.display') }}</legend>
        <label v-for="mode in DISPLAY_MODES" :key="mode">
          <input
            type="radio"
            name="lobby-display"
            :checked="draft.display === mode"
            @change="setDisplay(mode)"
          />
          <span>{{ t(`home.displayMode.${mode}`) }}</span>
        </label>
        <p class="muted hint">{{ t(`home.displayHint.${draft.display}`) }}</p>
      </fieldset>
      <fieldset>
        <legend>{{ t('home.rounds') }}</legend>
        <label v-for="n in ROOM.roundsOptions" :key="n">
          <input
            type="radio"
            name="lobby-rounds"
            :value="n"
            :checked="draft.rounds === n"
            @change="setRounds(n)"
          />
          <span>{{ n }}</span>
        </label>
      </fieldset>
      <fieldset>
        <legend>{{ t('home.answerMode') }}</legend>
        <label>
          <input
            type="radio"
            name="lobby-mode"
            :checked="draft.answerMode === 'text'"
            @change="setMode('text')"
          />
          <span>{{ t('home.text') }}</span>
        </label>
        <label>
          <input
            type="radio"
            name="lobby-mode"
            :checked="draft.answerMode === 'mcq'"
            @change="setMode('mcq')"
          />
          <span>{{ t('home.mcq') }}</span>
        </label>
      </fieldset>
      <fieldset>
        <legend>{{ t('home.scoring') }}</legend>
        <label v-for="mode in SCORING_MODES" :key="mode">
          <input
            type="radio"
            name="lobby-scoring"
            :checked="draft.scoring === mode"
            @change="setScoring(mode)"
          />
          <span>{{ t(`home.scoringMode.${mode}`) }}</span>
        </label>
        <p class="muted hint">{{ t(`home.scoringHint.${draft.scoring}`) }}</p>
      </fieldset>
    </template>
    <p v-else class="muted">
      {{
        t('lobby.settingsSummary', {
          rounds: game.totalRounds,
          mode: t(game.answerMode === 'text' ? 'lobby.modeText' : 'lobby.modeMcq'),
        })
      }}
      {{ t(`home.scoringHint.${game.scoring}`) }}
      <template v-if="bigScreen">{{ t('home.displayHint.bigscreen') }}</template>
    </p>

    <div class="actions">
      <p v-if="game.isHost && !enoughPlayers" class="muted">{{ t('lobby.needPlayers') }}</p>
      <p v-else-if="game.isHost && screenMissing" class="muted">{{ t('lobby.needScreen') }}</p>
      <p v-else-if="!game.isHost" class="muted">{{ t('lobby.waitingHost') }}</p>
      <p v-if="startError" class="error" role="alert">
        {{ t(startError === 'NO_SCREEN' ? 'lobby.needScreen' : 'lobby.startFailed') }}
      </p>
      <button
        v-if="game.isHost"
        type="button"
        class="button"
        :disabled="!enoughPlayers || screenMissing || starting"
        @click="start"
      >
        {{ t('lobby.start') }}
      </button>
    </div>
  </section>
</template>

<style scoped>
.lobby {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  padding: calc(var(--space-4) + env(safe-area-inset-top)) var(--space-4)
    calc(var(--space-4) + env(safe-area-inset-bottom));
  overflow-y: auto;
}
.code {
  font-size: clamp(44px, 16vw, 68px);
  letter-spacing: 0.04em;
}
.screen-status {
  display: grid;
  gap: var(--space-1);
  margin-top: var(--space-4);
  padding: var(--space-3);
  border: 1.5px dashed var(--ink);
  border-radius: var(--radius);
}
.screen-status.on {
  border: 1.5px solid var(--good);
  color: var(--good);
}
.screen-status .url {
  font-size: 17px;
  font-weight: 700;
  overflow-wrap: anywhere;
}
.screen-status .here {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  color: var(--accent);
}
.invite {
  display: grid;
  grid-template-columns: 112px minmax(0, 1fr);
  gap: var(--space-4);
  align-items: center;
  margin-top: var(--space-4);
}
.invite p {
  margin-bottom: var(--space-2);
  font-size: 15px;
}
.qr {
  display: block;
  width: 112px;
  height: 112px;
  padding: 6px;
  border-radius: var(--radius);
  background: #ffffff;
}
h2 {
  margin-top: var(--space-6);
  font-size: 17px;
}
.players {
  margin: var(--space-2) 0 0;
  padding: 0;
  list-style: none;
}
.players li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  min-height: var(--tap);
  padding: 0 var(--space-3);
  border-radius: var(--radius);
}
.players li:nth-child(odd) {
  background: var(--surface);
}
.players li.offline .name {
  color: var(--muted);
}
.name {
  overflow: hidden;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
small {
  margin-left: var(--space-2);
  font-size: 13px;
  font-weight: 400;
  color: var(--muted);
}
.remove {
  min-height: 44px;
  padding: 0 var(--space-2);
  border: 0;
  background: none;
  color: var(--danger);
  text-decoration: underline;
  cursor: pointer;
}
fieldset {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin: var(--space-4) 0 0;
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
.hint {
  width: 100%;
  font-size: 14px;
}
.actions {
  display: grid;
  gap: var(--space-2);
  margin-top: auto;
  padding-top: var(--space-6);
}
.error {
  color: var(--danger);
}
</style>
