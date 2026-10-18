<script setup lang="ts">
import {
  type AnswerMode,
  type CataloguePack,
  DISPLAY_MODES,
  type DisplayMode,
  ROOM,
  SCORING_MODES,
  type ScoringMode,
  ROUND_SECONDS,
  type RoundSeconds,
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
  roundSeconds: game.roundSeconds,
  packIds: [...game.packIds],
});
watch(
  () => [game.totalRounds, game.answerMode, game.scoring, game.display, game.roundSeconds] as const,
  ([rounds, answerMode, scoring, display, roundSeconds]) =>
    Object.assign(draft, { rounds, answerMode, scoring, display, roundSeconds }),
);
watch(
  () => game.packIds,
  (packIds) => (draft.packIds = [...packIds]),
);

/** The packs this room may draw from: the catalogue, plus the host's own. */
const packs = ref<CataloguePack[]>([]);
const packsOpen = ref(false);
onMounted(async () => {
  if (!game.isHost) return;
  packs.value = await game.playablePacks().catch(() => []);
});

function togglePack(id: string): void {
  draft.packIds = draft.packIds.includes(id)
    ? draft.packIds.filter((packId) => packId !== id)
    : [...draft.packIds, id];
  void game.updateSettings({ ...draft });
}
function setDisplay(display: DisplayMode): void {
  draft.display = display;
  void game.updateSettings({ ...draft });
}
function setScoring(scoring: ScoringMode): void {
  draft.scoring = scoring;
  void game.updateSettings({ ...draft });
}
function setRoundSeconds(roundSeconds: RoundSeconds | null): void {
  draft.roundSeconds = roundSeconds;
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
    <!-- Two groups, which only become columns on a computer: who is here and how to bring more,
         then what the host decides. On a phone both wrappers step aside (display: contents). -->
    <div class="guests">
      <div class="booth">
        <p class="muted code-label">{{ t('lobby.codeLabel') }}</p>
        <h1 class="display code">{{ game.code }}</h1>

        <div class="invite">
          <img v-if="qrSrc" class="qr" :src="qrSrc" :alt="t('lobby.qrAlt')" />
          <div>
            <p>{{ t('lobby.inviteHint') }}</p>
            <button type="button" class="button quiet" @click="share">
              {{
                shared ? t('lobby.copied') : canShareNatively ? t('lobby.share') : t('lobby.copy')
              }}
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
      </div>

      <h2>{{ t('lobby.players', { n: game.players.length, max: ROOM.maxPlayers }) }}</h2>
      <ul class="players">
        <li v-for="player in game.players" :key="player.id" :class="{ offline: !player.connected }">
          <span class="initial" aria-hidden="true">{{ [...player.nickname][0] }}</span>
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
    </div>

    <div class="setup">
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
        <fieldset class="packs">
          <legend>{{ t('lobby.packs') }}</legend>
          <p class="muted hint">
            {{
              draft.packIds.length
                ? t('lobby.packsChosen', { n: draft.packIds.length })
                : t('lobby.packsAll')
            }}
          </p>
          <button type="button" class="button quiet small" @click="packsOpen = !packsOpen">
            {{ t(packsOpen ? 'lobby.packsClose' : 'lobby.packsChoose') }}
          </button>
          <ul v-if="packsOpen" class="plain pack-list">
            <li v-for="pack in packs" :key="pack.id">
              <label class="check">
                <input
                  type="checkbox"
                  :checked="draft.packIds.includes(pack.id)"
                  @change="togglePack(pack.id)"
                />
                <span>
                  {{ pack.title }}
                  <small class="muted">
                    {{ t('lobby.packCards', { n: pack.cards }) }}
                    <template v-if="pack.byPlayer"> · {{ t('lobby.packMine') }}</template>
                  </small>
                </span>
              </label>
            </li>
          </ul>
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
        <fieldset>
          <legend>{{ t('lobby.roundSeconds') }}</legend>
          <label v-for="seconds in [...ROUND_SECONDS, null]" :key="String(seconds)">
            <input
              type="radio"
              name="lobby-seconds"
              :checked="draft.roundSeconds === seconds"
              @change="setRoundSeconds(seconds)"
            />
            <span>{{
              seconds === null ? t('lobby.untimed') : t('lobby.seconds', { n: seconds })
            }}</span>
          </label>
          <p v-if="draft.roundSeconds === null" class="muted hint">{{ t('lobby.untimedHint') }}</p>
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
        {{
          game.roundSeconds === null
            ? t('lobby.untimed')
            : t('lobby.secondsSummary', { n: game.roundSeconds })
        }}
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
.packs .hint {
  margin-bottom: var(--space-2);
}
.pack-list {
  margin-top: var(--space-2);
  max-height: 210px;
  overflow-y: auto;
}
.pack-list .check {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  min-height: 44px;
  font-weight: 400;
}
.pack-list .check input {
  width: 20px;
  height: 20px;
  margin-top: 12px;
  flex: none;
}
.pack-list small {
  display: block;
  font-size: 13px;
}
.button.small {
  min-height: 44px;
  padding: 0 var(--space-4);
  font-size: 15px;
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

.guests,
.setup,
.booth {
  display: contents;
}
/* A player's initial is a computer's card face; a phone lists names. */
.initial {
  display: none;
}
/* Computer: the code, the QR code and the way to invite on the curtain; the players as cards
   and the host's choices on the right. Same breakpoint as useWideScreen. */
@media (min-width: 1080px) {
  .lobby {
    display: grid;
    grid-template-columns: var(--panel, 30vw) minmax(0, 1fr);
    /* The last row takes what the booth's height leaves, so the first three keep their own. */
    grid-template-rows: auto auto auto minmax(0, 1fr);
    column-gap: var(--gutter, 48px);
    align-items: start;
    padding: 0 var(--gutter, 48px) 0 0;
  }
  .booth {
    grid-column: 1;
    grid-row: 1 / -1;
    /* The lobby scrolls when the settings are long: the booth stays on screen. */
    position: sticky;
    top: 0;
    height: var(--viewport-height);
    display: flex;
    flex-direction: column;
    /* `safe`, and room at the top and the foot for the name and the way out: with the screen
       box under the invite, the booth is taller than a 720 px window. */
    justify-content: safe center;
    gap: var(--space-4);
    padding: 72px var(--space-10);
    overflow-y: auto;
    color: var(--curtain-ink);
    container-type: inline-size;
  }
  .booth .muted,
  .booth .invite p {
    color: inherit;
    font-size: 17px;
  }
  /* Five letters spaced 0.04 em are about 5.2 em wide in the display face. */
  .code {
    font-size: min(128px, 18cqi);
  }
  .invite {
    grid-template-columns: minmax(0, 1fr);
    margin-top: 0;
  }
  .qr {
    width: min(100%, 280px, 24vh);
    height: auto;
    aspect-ratio: 1;
    padding: 10px;
  }
  /* On the curtain, green and dashed ink would not read: the box speaks in the curtain's ink. */
  .booth .screen-status,
  .booth .screen-status.on {
    border: 1.5px solid var(--curtain-ink);
    color: var(--curtain-ink);
  }
  .booth .screen-status .here {
    color: inherit;
  }
  .guests > h2 {
    grid-column: 2;
    grid-row: 1;
    margin-top: var(--space-10);
    font-family: var(--font-display);
    font-size: 32px;
    font-stretch: 140%;
  }
  .players {
    grid-column: 2;
    grid-row: 2;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: var(--space-3);
    align-content: start;
  }
  .players li,
  .players li:nth-child(odd) {
    flex-direction: column;
    align-items: flex-start;
    justify-content: flex-start;
    gap: var(--space-2);
    min-height: 168px;
    padding: var(--space-4);
    background: var(--surface);
  }
  .initial {
    display: block;
    color: var(--accent);
    font: 800 56px/1 var(--font-display);
    font-stretch: 140%;
    text-transform: uppercase;
  }
  /* A card has the room for a long nickname and its tags on two lines. */
  .name {
    max-width: 100%;
    overflow-wrap: anywhere;
    white-space: normal;
  }
  .remove {
    margin-top: auto;
    padding: 0;
  }
  /* The host's choices two by two, so that the start button stays in sight. */
  .setup {
    grid-column: 2;
    grid-row: 3;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    column-gap: var(--space-6);
    align-items: start;
    margin-top: var(--space-6);
    padding-bottom: var(--space-10);
  }
  .setup > .packs,
  .setup > p,
  .setup > .actions {
    grid-column: 1 / -1;
  }
  /* The short choices pair up first; the packs list, which grows, comes after them. */
  .setup > .packs {
    order: 1;
  }
  .setup > p,
  .setup > .actions {
    order: 2;
  }
  .packs > .button {
    align-self: flex-start;
  }
  .pack-list {
    width: 100%;
    padding: 0;
    list-style: none;
  }
  .actions {
    margin-top: 0;
  }
  .actions .button {
    min-height: 64px;
    font-size: 19px;
  }
}
</style>
