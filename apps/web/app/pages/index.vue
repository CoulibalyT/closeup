<script setup lang="ts">
import {
  type AnswerMode,
  NICKNAME,
  ROOM,
  roomCodeSchema,
  SCORING_MODES,
  type ScoringMode,
  DEFAULT_ROUND_SECONDS,
} from '@closeup/shared';

const { t, locale, locales } = useI18n();
const localePath = useLocalePath();
const switchLocalePath = useSwitchLocalePath();
const game = useGameStore();
const { appName } = useRuntimeConfig().public;

useHead({ title: appName });

const busy = ref(false);
const failed = ref(false);

/** Runs one of the four ways to start, with a single "busy" and a single error message. */
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

// --- the one action this page is about: a code, and in ---
// Nothing else is asked here. `/join/:code` shows who invites and takes the nickname, so the
// landing screen can stay down to a single field.
const joinCode = ref('');
const joinCodeOk = computed(() => roomCodeSchema.safeParse(joinCode.value).success);
const joinParty = () => go(async () => `/join/${roomCodeSchema.parse(joinCode.value)}`);

const notInAlphabet = new RegExp(`[^${ROOM.codeAlphabet}]`, 'g');

/**
 * Codes are read aloud across a room, so the alphabet has no 0/O/1/I/L. Dropping what cannot
 * belong as it is typed beats refusing the whole thing afterwards: someone hearing "o" types
 * the letter, and the field simply does not take it.
 */
function cleanCode(event: Event): void {
  const field = event.target as HTMLInputElement;
  const cleaned = field.value.toUpperCase().replace(notInAlphabet, '').slice(0, ROOM.codeLength);
  joinCode.value = cleaned;
  // v-model alone would leave the rejected character on screen: the model did not change, so
  // Vue has nothing to patch. Writing the field back is what removes it.
  field.value = cleaned;
}

/** An invitation is shared as a link, and a link pastes whole. Keep its last segment. */
function pasteCode(event: ClipboardEvent): void {
  const parsed = roomCodeSchema.safeParse(
    (event.clipboardData?.getData('text') ?? '').trim().split(/[/?#]/).filter(Boolean).pop() ?? '',
  );
  if (!parsed.success) return;
  event.preventDefault();
  joinCode.value = parsed.data;
}

// --- the other ways in, behind the panel ---
const panel = ref<HTMLDialogElement | null>(null);
const panelMode = ref<'create' | 'solo'>('create');
const panelOpen = ref(false);

function openPanel(mode: 'create' | 'solo'): void {
  panelMode.value = mode;
  failed.value = false;
  panelOpen.value = true;
  panel.value?.showModal();
}

// with friends: the nickname is asked here, the settings are chosen in the lobby
const nickname = ref('');
const nicknameOk = computed(() => nickname.value.trim().length >= NICKNAME.minLength);
onMounted(() => (nickname.value = game.rememberedNickname()));

const createParty = () =>
  go(async () => {
    game.setNickname(nickname.value);
    const code = await game.createRoom(
      'private',
      {
        rounds: ROOM.defaultRounds,
        answerMode: 'text',
        scoring: 'decay',
        display: 'phones',
        roundSeconds: DEFAULT_ROUND_SECONDS,
        hints: true,
        packIds: [],
      },
      locale.value as 'fr' | 'en',
    );
    return `/play/${code}`;
  });

// big screen: this device shows the image, nobody plays on it. The first phone to join
// becomes the host and picks the settings from there.
const openScreen = () =>
  go(async () => {
    const code = await game.createRoom(
      'private',
      {
        rounds: ROOM.defaultRounds,
        answerMode: 'text',
        scoring: 'decay',
        display: 'bigscreen',
        roundSeconds: DEFAULT_ROUND_SECONDS,
        hints: true,
        packIds: [],
      },
      locale.value as 'fr' | 'en',
      'screen',
    );
    return `/screen/${code}`;
  });

// solo training
const rounds = ref<number>(ROOM.roundsOptions[0]);
const answerMode = ref<AnswerMode>('text');
const scoring = ref<ScoringMode>('decay');
const playSolo = () =>
  go(async () => {
    const settings = {
      rounds: rounds.value,
      answerMode: answerMode.value,
      scoring: scoring.value,
      display: 'phones' as const,
      roundSeconds: DEFAULT_ROUND_SECONDS,
      hints: true,
      packIds: [],
    };
    return `/play/${await game.createRoom('solo', settings, locale.value as 'fr' | 'en')}`;
  });
</script>

<template>
  <main class="home">
    <section class="curtain">
      <div class="wrap">
        <nav class="top" :aria-label="t('home.language')">
          <NuxtLink
            v-for="l in locales"
            :key="l.code"
            :to="switchLocalePath(l.code)"
            :aria-current="l.code === locale ? 'true' : undefined"
          >
            {{ l.name }}
          </NuxtLink>
          <span class="grow" />
          <NuxtLink :to="localePath('/account')">{{ t('account.short') }}</NuxtLink>
        </nav>

        <div class="hero">
          <div class="intro">
            <h1 class="display wordmark">{{ appName }}</h1>
            <p class="pitch">{{ t('home.pitch') }}</p>
          </div>

          <form class="strip" @submit.prevent="joinParty">
            <label for="code">{{ t('home.codeLabel') }}</label>
            <input
              id="code"
              :value="joinCode"
              type="text"
              class="code"
              inputmode="text"
              autocapitalize="characters"
              autocomplete="off"
              spellcheck="false"
              :maxlength="ROOM.codeLength"
              :placeholder="t('home.codePlaceholder')"
              @input="cleanCode"
              @paste="pasteCode"
            />
            <button type="submit" class="button" :disabled="busy || !joinCodeOk">
              {{ t('home.join') }}
            </button>
          </form>
        </div>
      </div>
    </section>

    <section class="tiles wrap" :aria-label="t('home.orStart')">
      <h2 class="lead">{{ t('home.orStart') }}</h2>

      <button type="button" class="tile first" :disabled="busy" @click="openPanel('create')">
        <span class="n">01</span>
        <span class="name display">{{ t('home.friends') }}</span>
        <span class="hint">{{ t('home.friendsHint') }}</span>
      </button>

      <NuxtLink class="tile" :to="localePath('/public')">
        <span class="n">02</span>
        <span class="name display">{{ t('publicGame.heading') }}</span>
        <span class="hint">{{ t('publicGame.short') }}</span>
      </NuxtLink>

      <button type="button" class="tile" :disabled="busy" @click="openPanel('solo')">
        <span class="n">03</span>
        <span class="name display">{{ t('home.solo') }}</span>
        <span class="hint">{{ t('home.soloHint') }}</span>
      </button>

      <button type="button" class="tile" :disabled="busy" @click="openScreen">
        <span class="n">04</span>
        <span class="name display">{{ t('home.bigScreen') }}</span>
        <span class="hint">{{ t('home.bigScreenHint') }}</span>
      </button>

      <p v-if="failed && !panelOpen" class="error" role="alert">{{ t('home.failed') }}</p>
    </section>

    <nav class="more wrap" :aria-label="t('home.more')">
      <NuxtLink :to="localePath('/packs')">{{ t('catalogue.short') }}</NuxtLink>
      <NuxtLink :to="localePath('/me/packs')">{{ t('myPacks.heading') }}</NuxtLink>
      <NuxtLink :to="localePath('/rankings')">{{ t('rankings.heading') }}</NuxtLink>
      <NuxtLink :to="localePath('/stats')">{{ t('stats.short') }}</NuxtLink>
      <NuxtLink :to="localePath('/contact')">{{ t('contact.heading') }}</NuxtLink>
    </nav>

    <dialog ref="panel" @close="panelOpen = false" @click.self="panel?.close()">
      <form v-if="panelMode === 'create'" class="stack" @submit.prevent="createParty">
        <h2 class="display">{{ t('home.friends') }}</h2>
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

      <form v-else class="stack" @submit.prevent="playSolo">
        <h2 class="display">{{ t('home.solo') }}</h2>

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

        <fieldset>
          <legend>{{ t('home.scoring') }}</legend>
          <label v-for="mode in SCORING_MODES" :key="mode" class="choice">
            <input v-model="scoring" type="radio" name="scoring" :value="mode" />
            <span>{{ t(`home.scoringMode.${mode}`) }}</span>
          </label>
        </fieldset>

        <button type="submit" class="button" :disabled="busy">{{ t('home.play') }}</button>
      </form>

      <p v-if="failed" class="error" role="alert">{{ t('home.failed') }}</p>
      <button type="button" class="close" @click="panel?.close()">{{ t('home.close') }}</button>
    </dialog>
  </main>
</template>

<style scoped>
.home {
  /* One page width shared by the curtain, the tiles and the foot, so that their left edges
     line up at every size. The breakpoints at the end only change this and the grids. */
  --page: 460px;
  display: flex;
  flex-direction: column;
  min-height: 100dvh;
}
.wrap {
  width: min(var(--page), 100% - 2 * var(--space-4));
  margin-inline: auto;
}

/* The booth curtain: one flat field of colour, folds barely there. Everything that matters
   sits on the strip in front of it. */
.curtain {
  padding: calc(var(--space-4) + env(safe-area-inset-top)) 0 var(--space-10);
  background-color: var(--curtain);
  background-image: var(--curtain-folds);
  color: var(--curtain-ink);
}
.top {
  display: flex;
  gap: var(--space-2);
  margin-left: calc(-1 * var(--space-2));
}
.top .grow {
  flex: 1;
}
.top a {
  display: inline-flex;
  align-items: center;
  min-height: var(--tap);
  padding: 0 var(--space-2);
  color: inherit;
  opacity: 0.75;
}
.top a[aria-current='true'] {
  font-weight: 700;
  text-decoration: none;
  opacity: 1;
}
.hero {
  display: grid;
  gap: var(--space-10);
  margin-top: var(--space-6);
}
/* The wordmark is sized on its own column, not on the window. Sized on the window, it broke
   into "Loupett / e" wherever the column stopped growing before the window did. In the
   stretched display face "Loupette" is about 7.3 em wide, so 13cqi fills the column with a
   little to spare. `anywhere` stays as the last resort for a longer CLOSEUP_DISPLAY_NAME. */
.intro {
  container-type: inline-size;
}
.wordmark {
  font-size: min(13cqi, 112px);
  overflow-wrap: anywhere;
}
.pitch {
  max-width: 30ch;
  margin-top: var(--space-3);
  font-size: 19px;
  opacity: 0.85;
}

.strip {
  display: grid;
  gap: var(--space-3);
  /* A code is five characters: past this, the field only gets emptier. */
  max-width: 440px;
  padding: var(--space-4);
  border-radius: var(--radius);
  background: var(--surface);
  box-shadow: 0 12px 32px rgb(0 0 0 / 22%);
  color: var(--ink);
}
.strip label {
  color: var(--muted);
  font-size: 15px;
}
.strip .button {
  min-height: 56px;
  font-size: 19px;
}

.tiles {
  display: grid;
  gap: var(--space-3);
  padding-block: var(--space-6);
}
.lead,
.tiles .error {
  grid-column: 1 / -1;
}
.lead {
  color: var(--muted);
  font-size: 15px;
  font-weight: 400;
}
.tile {
  display: grid;
  /* Tiles in a row share one height; without this, the extra space would push the number,
     the name and the hint apart instead of staying below the hint. */
  align-content: start;
  gap: var(--space-1);
  padding: var(--space-4);
  border: 1.5px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--ink);
  text-align: left;
  text-decoration: none;
  cursor: pointer;
  transition: border-color 120ms ease-out;
}
@media (hover: hover) {
  .tile:not(:disabled):hover {
    border-color: var(--accent);
  }
}
/* The way in that most people want, marked without a second filled colour. */
.tile.first {
  border-color: var(--ink);
  border-width: 2px;
}
.tile:disabled {
  opacity: 0.5;
  cursor: default;
}
.tile .n {
  color: var(--muted);
  font-family: var(--font-display);
  font-size: 13px;
  letter-spacing: 0.08em;
}
.tile .name {
  font-size: 21px;
  font-stretch: 140%;
  font-weight: 800;
  /* `.display` is set tight for a one-line wordmark; a name on two lines needs air. */
  line-height: 1.15;
}
.tile .hint {
  color: var(--muted);
  font-size: 15px;
}

.more {
  display: flex;
  flex-wrap: wrap;
  column-gap: var(--space-6);
  margin-top: auto;
  padding-block: var(--space-4) var(--space-6);
}
.more a {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  color: var(--muted);
  font-size: 15px;
}

/* Tablet: the same column, wider, and the tiles two by two. */
@media (min-width: 720px) {
  .home {
    --page: 720px;
  }
  .pitch {
    font-size: 21px;
  }
  .tiles {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

/* Desktop: the curtain is the left half, with the name, the pitch and the code; the four ways
   in are the four frames of a strip on the right, the other links above them. */
@media (min-width: 1080px) {
  .home {
    display: grid;
    grid-template-columns: 48vw minmax(0, 1fr);
    grid-template-rows: auto minmax(0, 1fr);
    min-height: 100dvh;
  }
  .curtain {
    grid-column: 1;
    grid-row: 1 / -1;
    display: flex;
    padding: var(--space-6) 4vw var(--space-10);
  }
  .curtain .wrap {
    display: flex;
    flex-direction: column;
    width: 100%;
    margin: 0;
  }
  .hero {
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-10);
    margin-block: auto;
  }
  .wordmark {
    font-size: min(13cqi, 176px);
  }
  .pitch {
    max-width: 30ch;
    font-size: 23px;
    text-wrap: balance;
  }
  .strip {
    max-width: 520px;
    padding: var(--space-6);
  }
  .more {
    grid-column: 2;
    grid-row: 1;
    width: auto;
    margin: 0;
    padding: var(--space-6) 4vw 0;
  }
  .tiles {
    grid-column: 2;
    grid-row: 2;
    grid-template-columns: minmax(0, 1fr);
    /* The label keeps its own height; the four tiles share the rest. */
    grid-template-rows: auto repeat(4, minmax(0, 1fr));
    width: auto;
    margin: 0;
    padding: var(--space-4) 4vw var(--space-10);
  }
  .lead {
    align-self: end;
  }
  .tile {
    grid-template-columns: auto minmax(0, 1fr);
    grid-template-rows: auto auto;
    column-gap: var(--space-6);
    align-content: center;
    padding: var(--space-4) var(--space-6);
  }
  .tile .n {
    grid-row: 1 / -1;
    align-self: center;
    color: var(--accent);
    font-size: clamp(44px, 4vw, 72px);
    font-stretch: 140%;
    font-weight: 800;
    letter-spacing: 0;
  }
  .tile .name {
    font-size: clamp(22px, 1.8vw, 32px);
  }
  .tile .hint {
    font-size: 17px;
  }
}

dialog {
  width: min(420px, calc(100vw - 2 * var(--space-4)));
  padding: var(--space-6) var(--space-4) var(--space-4);
  border: 0;
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--ink);
}
dialog::backdrop {
  background: rgb(6 10 30 / 62%);
}
dialog h2 {
  margin-bottom: var(--space-2);
  font-size: 23px;
  font-stretch: 140%;
}
.close {
  min-height: var(--tap);
  margin-top: var(--space-2);
  border: 0;
  background: none;
  color: var(--muted);
  cursor: pointer;
}

.stack {
  display: grid;
  gap: var(--space-2);
}
label,
legend {
  color: var(--muted);
  font-size: 15px;
}
input[type='text'] {
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
  min-height: 64px;
  font-family: var(--font-display);
  font-size: 30px;
  font-stretch: 140%;
  font-weight: 800;
  letter-spacing: 0.24em;
  /* Letter-spacing is added *after* the last glyph too, which pushes centred text off to the
     left. Indenting by the same amount puts it back in the middle. */
  text-indent: 0.24em;
  text-align: center;
  text-transform: uppercase;
}
input.code::placeholder {
  font-family: var(--font-text);
  font-size: 17px;
  font-stretch: normal;
  font-weight: 400;
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
</style>
