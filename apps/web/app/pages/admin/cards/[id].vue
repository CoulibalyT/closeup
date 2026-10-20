<script setup lang="ts">
import type { AdminCard, AdminCardSummary } from '@closeup/shared';

definePageMeta({ middleware: 'admin' });

const route = useRoute();
const { t } = useI18n();
const localePath = useLocalePath();
const { appName } = useRuntimeConfig().public;

const cardId = String(route.params.id);
const card = ref<AdminCard | null>(null);
const cards = ref<AdminCardSummary[]>([]);
const editor = ref<{
  hasUnsavedChanges: () => boolean;
  saveChanges: () => Promise<boolean>;
  discardChanges: () => void;
} | null>(null);
const pendingCardId = ref<string | null>(null);
const navigating = ref(false);
const onlyMissingPoints = computed(() => route.query.points === 'missing');
const title = computed(() => card.value?.answers.fr.text || t('admin.unnamed'));
const cardIndex = computed(() => cards.value.findIndex((row) => row.id === cardId));
const previousCard = computed<AdminCardSummary | null>(() =>
  cardIndex.value > 0 ? (cards.value[cardIndex.value - 1] ?? null) : null,
);
const nextCard = computed<AdminCardSummary | null>(() =>
  cardIndex.value >= 0 && cardIndex.value < cards.value.length - 1
    ? (cards.value[cardIndex.value + 1] ?? null)
    : null,
);
const pendingCard = computed(
  () => cards.value.find((row) => row.id === pendingCardId.value) ?? null,
);
useHead({ title: () => `${title.value}, ${appName}` });

async function loadCards(packId: string): Promise<void> {
  const data = await useSessionStore().request<{ cards: AdminCardSummary[] }>(
    'GET',
    `/admin/packs/${packId}`,
  );
  cards.value = onlyMissingPoints.value ? data.cards.filter((row) => row.points === 0) : data.cards;
}

async function goToCard(target: AdminCardSummary | null): Promise<void> {
  if (!target || navigating.value) return;
  if (editor.value?.hasUnsavedChanges()) {
    pendingCardId.value = target.id;
    return;
  }
  await navigateTo(
    localePath(`/admin/cards/${target.id}${onlyMissingPoints.value ? '?points=missing' : ''}`),
  );
}

function closeNavigationPrompt(): void {
  pendingCardId.value = null;
}

async function saveAndNavigate(): Promise<void> {
  if (!pendingCardId.value || !editor.value) return;
  navigating.value = true;
  if (await editor.value.saveChanges()) {
    const target = pendingCardId.value;
    pendingCardId.value = null;
    await navigateTo(
      localePath(`/admin/cards/${target}${onlyMissingPoints.value ? '?points=missing' : ''}`),
    );
  }
  navigating.value = false;
}

async function discardAndNavigate(): Promise<void> {
  if (!pendingCardId.value) return;
  const target = pendingCardId.value;
  editor.value?.discardChanges();
  pendingCardId.value = null;
  await navigateTo(
    localePath(`/admin/cards/${target}${onlyMissingPoints.value ? '?points=missing' : ''}`),
  );
}
</script>

<template>
  <AdminShell
    :title="title"
    :back="card ? { to: `/admin/packs/${card.packId}`, label: t('admin.pack') } : undefined"
  >
    <template v-if="card">
      <nav class="card-navigation" :aria-label="t('admin.cardNavigation')">
        <button
          type="button"
          class="button small quiet"
          :disabled="!previousCard"
          @click="goToCard(previousCard)"
        >
          {{ t('admin.previousCard') }}
        </button>
        <span class="muted">{{ cardIndex + 1 }} / {{ cards.length }}</span>
        <button
          type="button"
          class="button small quiet"
          :disabled="!nextCard"
          @click="goToCard(nextCard)"
        >
          {{ t('admin.nextCard') }}
        </button>
      </nav>
    </template>
    <CardEditor
      ref="editor"
      :card-id="cardId"
      base-path="/admin"
      @loaded="
        card = $event;
        void loadCards($event.packId);
      "
      @deleted="navigateTo(localePath(`/admin/packs/${$event}`))"
    />

    <div v-if="pendingCardId" class="modal-backdrop" role="presentation">
      <section class="modal panel" role="dialog" aria-modal="true" :aria-labelledby="'nav-title'">
        <h2 id="nav-title">{{ t('admin.unsavedTitle') }}</h2>
        <p class="muted">{{ t('admin.unsavedHint') }}</p>
        <p v-if="pendingCard" class="good">{{ pendingCard.answerFr || t('admin.unnamed') }}</p>
        <div class="actions">
          <button
            type="button"
            class="button small"
            :disabled="navigating"
            @click="saveAndNavigate"
          >
            {{ t('admin.saveAndContinue') }}
          </button>
          <button
            type="button"
            class="button small quiet"
            :disabled="navigating"
            @click="discardAndNavigate"
          >
            {{ t('admin.discardAndContinue') }}
          </button>
          <button type="button" class="link" :disabled="navigating" @click="closeNavigationPrompt">
            {{ t('admin.cancelNavigation') }}
          </button>
        </div>
      </section>
    </div>
  </AdminShell>
</template>

<style scoped>
.card-navigation {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  margin-bottom: var(--space-4);
}
.modal-backdrop {
  position: fixed;
  z-index: 10;
  inset: 0;
  display: grid;
  place-items: center;
  padding: var(--space-4);
  background: rgb(0 0 0 / 45%);
}
.modal {
  width: min(100%, 520px);
  margin: 0;
}
</style>
