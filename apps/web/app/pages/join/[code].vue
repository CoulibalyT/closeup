<script setup lang="ts">
import { NICKNAME, roomCodeSchema, type RoomSummary } from '@closeup/shared';

/** Where a shared link or a scanned QR code lands: who invites, then a nickname, then in. */
const route = useRoute();
const { t } = useI18n();
const localePath = useLocalePath();
const game = useGameStore();
const { appName } = useRuntimeConfig().public;

useHead({ title: () => t('join.title', { appName }) });

const code = ref('');
const summary = ref<RoomSummary | null>(null);
const state = ref<'loading' | 'ready' | 'missing'>('loading');
const nickname = ref('');
const joining = ref(false);
const failed = ref(false);

const full = computed(() => (summary.value?.playerCount ?? 0) >= (summary.value?.maxPlayers ?? 1));
const over = computed(() => summary.value?.phase === 'ended');
const valid = computed(() => nickname.value.trim().length >= NICKNAME.minLength);

onMounted(async () => {
  const parsed = roomCodeSchema.safeParse(route.params.code);
  if (!parsed.success) {
    state.value = 'missing';
    return;
  }
  code.value = parsed.data;
  nickname.value = game.rememberedNickname();
  summary.value = await game.fetchSummary(code.value).catch(() => null);
  state.value = summary.value ? 'ready' : 'missing';
});

async function join(): Promise<void> {
  if (!valid.value) return;
  joining.value = true;
  failed.value = false;
  try {
    game.setNickname(nickname.value);
    await game.ensureGuest();
    await navigateTo(localePath(`/play/${code.value}`));
  } catch {
    failed.value = true;
  } finally {
    joining.value = false;
  }
}
</script>

<template>
  <main class="join">
    <p v-if="state === 'loading'" class="muted">{{ t('join.loading') }}</p>

    <template v-else-if="state === 'missing'">
      <h1 class="display">{{ t('join.missingTitle') }}</h1>
      <p>{{ t('join.missing') }}</p>
      <NuxtLink class="button" :to="localePath('/')">{{ t('play.home') }}</NuxtLink>
    </template>

    <template v-else-if="summary">
      <header class="invitation">
        <p class="muted">{{ t('join.room', { code }) }}</p>
        <!-- A room opened from a big screen has no host until its first player: that is them. -->
        <h1 class="display">
          {{
            summary.hostNickname
              ? t('join.invites', { host: summary.hostNickname })
              : t('join.firstIn')
          }}
        </h1>
        <p class="muted">
          {{
            t('join.details', {
              players: summary.playerCount,
              rounds: summary.rounds,
              mode: t(summary.answerMode === 'text' ? 'lobby.modeText' : 'lobby.modeMcq'),
            })
          }}
        </p>
      </header>

      <p v-if="over" role="alert">{{ t('join.over') }}</p>
      <p v-else-if="full" role="alert">{{ t('join.full') }}</p>
      <form v-else class="form" @submit.prevent="join">
        <label for="nickname">{{ t('join.nickname') }}</label>
        <input
          id="nickname"
          v-model="nickname"
          type="text"
          autocomplete="nickname"
          enterkeyhint="go"
          :maxlength="NICKNAME.maxLength"
          :placeholder="t('join.nicknamePlaceholder')"
        />
        <p v-if="summary.phase !== 'lobby'" class="muted">{{ t('join.started') }}</p>
        <p v-if="failed" class="error" role="alert">{{ t('home.failed') }}</p>
        <button type="submit" class="button" :disabled="!valid || joining">
          {{ t('join.submit') }}
        </button>
      </form>
    </template>
  </main>
</template>

<style scoped>
.join {
  display: grid;
  gap: var(--space-3);
  align-content: start;
  min-height: 100dvh;
  max-width: 460px;
  margin: 0 auto;
  padding: calc(var(--space-10) + env(safe-area-inset-top)) var(--space-4) var(--space-6);
}
h1 {
  /* In the stretched display face a long French word ("introuvable") is about 9.3 em wide:
     10vw split it across two lines on a 390 px phone. The same step as PageShell. */
  font-size: clamp(28px, 8.5vw, 44px);
  overflow-wrap: anywhere;
}
.form {
  display: grid;
  gap: var(--space-2);
  margin-top: var(--space-6);
  padding: var(--space-4);
  border-radius: var(--radius);
  background: var(--surface);
}
label {
  font-size: 15px;
  color: var(--muted);
}
input {
  min-height: var(--tap);
  padding: 0 var(--space-4);
  border: 1.5px solid var(--line);
  border-radius: var(--radius);
  background: var(--bg);
  /* 16 px minimum, or iOS Safari zooms the page when the field takes focus. */
  font-size: 17px;
}
.error {
  color: var(--danger);
}
.invitation {
  display: contents;
}
/* Computer: who invites, in the curtain band; the one field centred under it. */
@media (min-width: 1080px) {
  .join {
    max-width: none;
    align-content: start;
    padding: 0 0 var(--space-10);
  }
  .invitation {
    display: grid;
    gap: var(--space-3);
    padding: var(--space-10) max(var(--space-10), (100% - 1208px) / 2);
    background-color: var(--curtain);
    background-image: var(--curtain-folds);
    color: var(--curtain-ink);
    container-type: inline-size;
  }
  .invitation .muted {
    color: inherit;
    font-size: 19px;
  }
  /* A twelve-letter word is about 10.5 em wide: 9.5cqi keeps it whole on the band. */
  .invitation h1 {
    font-size: min(96px, 9.5cqi);
    line-height: 1.08;
  }
  /* Without an invitation (loading, a room that does not exist) there is no band: one step,
     centred in the window, as before. */
  .join:not(:has(.invitation)) {
    align-content: center;
    padding-top: var(--space-10);
  }
  /* 488 px of column: 44 px keeps a twelve-letter word ("introuvable") on one line. */
  .join > h1 {
    font-size: 44px;
  }
  .join > :not(.invitation) {
    width: min(520px, 100% - 2 * var(--space-10));
    margin-inline: auto;
  }
}
</style>
