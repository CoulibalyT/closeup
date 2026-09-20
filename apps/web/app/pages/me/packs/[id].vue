<script setup lang="ts">
import { type AdminCard, type AdminCardSummary, type MyPack, QUOTA } from '@closeup/shared';

/** One of the player's packs: its cards, and the way to ask for it to be published. */
const route = useRoute();
const { t } = useI18n();
const localePath = useLocalePath();
const session = useSessionStore();
const game = useGameStore();
const { appName } = useRuntimeConfig().public;

const id = String(route.params.id);
const pack = ref<MyPack | null>(null);
const cards = ref<AdminCardSummary[]>([]);
const failed = ref(false);
const busy = ref(false);
const error = ref<string | null>(null);
const rights = ref(false);
useHead({ title: () => `${pack.value?.titleFr ?? t('catalogue.pack')}, ${appName}` });

const inReview = computed(() => pack.value?.visibility === 'PENDING_REVIEW');
const isPublic = computed(() => pack.value?.visibility === 'PUBLIC');

async function load(): Promise<void> {
  try {
    const view = await session.request<{ pack: MyPack; cards: AdminCardSummary[] }>(
      'GET',
      `/me/packs/${id}`,
    );
    pack.value = view.pack;
    cards.value = view.cards;
  } catch {
    failed.value = true;
  }
}
onMounted(load);

async function addCard(): Promise<void> {
  busy.value = true;
  error.value = null;
  try {
    const card = await session.request<AdminCard>('POST', `/me/packs/${id}/cards`, {
      category: pack.value?.category ?? 'OBJECT',
    });
    await navigateTo(localePath(`/me/packs/cards/${card.id}`));
  } catch (failure) {
    error.value = (failure as { code?: string }).code ?? 'other';
  } finally {
    busy.value = false;
  }
}

async function act(path: string, body?: unknown): Promise<void> {
  busy.value = true;
  error.value = null;
  try {
    pack.value = await session.request<MyPack>('POST', `/me/packs/${id}/${path}`, body);
    await load();
  } catch (failure) {
    error.value = (failure as { code?: string }).code ?? 'other';
  } finally {
    busy.value = false;
  }
}

async function remove(): Promise<void> {
  if (!window.confirm(t('myPacks.deleteConfirm'))) return;
  try {
    await session.request('DELETE', `/me/packs/${id}`);
    await navigateTo(localePath('/me/packs'));
  } catch (failure) {
    error.value = (failure as { code?: string }).code ?? 'other';
  }
}
</script>

<template>
  <PageShell :title="pack?.titleFr ?? t('catalogue.pack')">
    <p v-if="failed" class="error" role="alert">{{ t('admin.failed') }}</p>

    <template v-if="pack">
      <p class="muted">
        {{ t(`myPacks.state.${pack.visibility}`) }} ·
        {{ t('myPacks.playable', { n: pack.playableCards }) }}
      </p>
      <p v-if="pack.reviewNote" class="note">
        {{ t('myPacks.reviewNote', { note: pack.reviewNote }) }}
      </p>
      <p v-if="error" class="error" role="alert">
        {{ t(`myPacks.error.${error}`, t('myPacks.error.other')) }}
      </p>

      <section class="block">
        <h2>{{ t('admin.cards') }}</h2>
        <p v-if="!cards.length" class="muted">{{ t('myPacks.noCards') }}</p>
        <ul v-else class="plain cards">
          <li v-for="card in cards" :key="card.id">
            <NuxtLink :to="localePath(`/me/packs/cards/${card.id}`)">
              <img
                v-if="card.thumbnailUrl"
                :src="game.mediaUrl(card.thumbnailUrl)"
                alt=""
                loading="lazy"
              />
              <span v-else class="no-image">{{ t('admin.noImage') }}</span>
              <span>{{ card.answerFr || t('admin.unnamed') }}</span>
            </NuxtLink>
            <small class="muted">{{ t(`admin.status.${card.status}`) }}</small>
          </li>
        </ul>
        <button
          type="button"
          class="button quiet"
          :disabled="busy || inReview || cards.length >= QUOTA.cardsPerPack"
          @click="addCard"
        >
          {{ t('admin.newCard') }}
        </button>
        <p class="muted small">
          {{ t('myPacks.quotaCards', { used: cards.length, max: QUOTA.cardsPerPack }) }}
        </p>
      </section>

      <section class="block">
        <h2>{{ t('myPacks.publishTitle') }}</h2>

        <template v-if="isPublic">
          <p>{{ t('myPacks.isPublic') }}</p>
          <NuxtLink class="link" :to="localePath(`/packs/${pack.id}`)">
            {{ t('myPacks.seeInCatalogue') }}
          </NuxtLink>
          <button type="button" class="button quiet" :disabled="busy" @click="act('withdraw')">
            {{ t('myPacks.withdraw') }}
          </button>
        </template>

        <template v-else-if="inReview">
          <p>{{ t('myPacks.inReview') }}</p>
          <button type="button" class="button quiet" :disabled="busy" @click="act('withdraw')">
            {{ t('myPacks.cancelSubmission') }}
          </button>
        </template>

        <template v-else>
          <p class="muted">{{ t('myPacks.publishHint') }}</p>
          <label class="check">
            <input v-model="rights" type="checkbox" />
            <span>{{ t('myPacks.rights') }}</span>
          </label>
          <button
            type="button"
            class="button"
            :disabled="busy || !rights || !pack.playableCards"
            @click="act('submit', { rightsConfirmed: true })"
          >
            {{ t('myPacks.submit') }}
          </button>
          <button type="button" class="link danger" @click="remove">
            {{ t('myPacks.delete') }}
          </button>
        </template>
      </section>
    </template>
  </PageShell>
</template>

<style scoped>
.note {
  margin-top: var(--space-2);
  padding: var(--space-2);
  border-left: 3px solid var(--danger);
  font-size: 15px;
}
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
  gap: var(--space-3);
  margin-bottom: var(--space-3);
}
.cards a {
  display: grid;
  gap: var(--space-1);
  color: var(--ink);
  font-weight: 600;
  font-size: 15px;
}
.cards img,
.no-image {
  display: grid;
  place-items: center;
  width: 100%;
  aspect-ratio: 1;
  border-radius: var(--radius);
  background: var(--bg);
  object-fit: cover;
  font-size: 13px;
  font-weight: 400;
  color: var(--muted);
}
.check {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  min-height: 44px;
  margin: var(--space-2) 0;
  font-weight: 400;
}
.check input {
  width: 20px;
  height: 20px;
  margin-top: 2px;
  flex: none;
}
.small {
  font-size: 14px;
}
.block .button,
.block .link {
  margin-top: var(--space-2);
}
</style>
