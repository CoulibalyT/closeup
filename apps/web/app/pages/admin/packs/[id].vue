<script setup lang="ts">
import {
  type AdminCard,
  type AdminCardSummary,
  type AdminPack,
  CATEGORIES,
  type Category,
  RESTRICTED_CATEGORIES,
} from '@closeup/shared';

definePageMeta({ middleware: 'admin' });

const route = useRoute();
const { t } = useI18n();
const localePath = useLocalePath();
const admin = useSessionStore();
const { appName } = useRuntimeConfig().public;

const id = String(route.params.id);
const pack = ref<AdminPack | null>(null);
const cards = ref<AdminCardSummary[]>([]);
const failed = ref(false);
const saved = ref(false);
const busy = ref(false);

const form = reactive({
  titleFr: '',
  titleEn: '',
  descriptionFr: '',
  descriptionEn: '',
  category: 'OBJECT' as Category,
  publicMatchSafe: false,
});
const newCard = reactive({ category: 'OBJECT' as Category, isPerson: false });
// Real people and fictional characters never play with strangers: the server refuses the box.
watch(
  () => form.category,
  (category) => {
    if (RESTRICTED_CATEGORIES.includes(category)) form.publicMatchSafe = false;
  },
);

useHead({ title: () => `${pack.value?.titleFr ?? t('admin.pack')}, ${appName}` });

function fill(next: AdminPack): void {
  pack.value = next;
  const { titleFr, titleEn, descriptionFr, descriptionEn, category, publicMatchSafe } = next;
  Object.assign(form, {
    titleFr,
    titleEn,
    descriptionFr,
    descriptionEn,
    category,
    publicMatchSafe,
  });
}

onMounted(async () => {
  try {
    const data = await admin.request<{ pack: AdminPack; cards: AdminCardSummary[] }>(
      'GET',
      `/admin/packs/${id}`,
    );
    fill(data.pack);
    cards.value = data.cards;
    newCard.category = data.pack.category;
    newCard.isPerson = data.pack.category === 'CELEBRITY';
  } catch {
    failed.value = true;
  }
});

async function save(): Promise<void> {
  busy.value = true;
  saved.value = false;
  try {
    fill(await admin.request<AdminPack>('PUT', `/admin/packs/${id}`, { ...form }));
    saved.value = true;
  } catch {
    failed.value = true;
  } finally {
    busy.value = false;
  }
}

async function setVisibility(visibility: 'PRIVATE' | 'PUBLIC' | 'DISABLED'): Promise<void> {
  fill(await admin.request<AdminPack>('PUT', `/admin/packs/${id}/visibility`, { visibility }));
}

async function removePack(): Promise<void> {
  if (!window.confirm(t('admin.deletePackConfirm'))) return;
  await admin.request('DELETE', `/admin/packs/${id}`);
  await navigateTo(localePath('/admin'));
}

async function addCard(): Promise<void> {
  const card = await admin.request<AdminCard>('POST', `/admin/packs/${id}/cards`, { ...newCard });
  await navigateTo(localePath(`/admin/cards/${card.id}`));
}
</script>

<template>
  <AdminShell
    :title="pack?.titleFr ?? t('admin.pack')"
    :back="{ to: '/admin', label: t('admin.packs') }"
  >
    <p v-if="failed" class="error" role="alert">{{ t('admin.failed') }}</p>

    <template v-if="pack">
      <section class="panel">
        <h2>{{ t('admin.visibilityTitle') }}</h2>
        <p>
          <span class="chip" :class="pack.visibility.toLowerCase()">
            {{ t(`admin.visibility.${pack.visibility}`) }}
          </span>
          <span v-if="pack.restricted" class="chip restricted">{{ t('admin.restricted') }}</span>
        </p>
        <p class="muted">{{ t(`admin.visibilityHint.${pack.visibility}`) }}</p>
        <p v-if="pack.restricted" class="muted">{{ t('admin.restrictedHint') }}</p>
        <div class="actions">
          <button
            v-if="pack.visibility !== 'PUBLIC'"
            type="button"
            class="button small"
            @click="setVisibility('PUBLIC')"
          >
            {{ t('admin.makePublic') }}
          </button>
          <button
            v-if="pack.visibility !== 'PRIVATE'"
            type="button"
            class="button small quiet"
            @click="setVisibility('PRIVATE')"
          >
            {{ t('admin.makePrivate') }}
          </button>
          <button
            v-if="pack.visibility !== 'DISABLED'"
            type="button"
            class="button small danger"
            @click="setVisibility('DISABLED')"
          >
            {{ t('admin.disable') }}
          </button>
        </div>
      </section>

      <section class="panel">
        <h2>{{ t('admin.cards') }}</h2>
        <p v-if="!cards.length" class="muted">{{ t('admin.noCards') }}</p>
        <ul class="plain cards">
          <li v-for="card in cards" :key="card.id">
            <NuxtLink :to="localePath(`/admin/cards/${card.id}`)">
              <img
                v-if="card.thumbnailUrl"
                :src="admin.mediaUrl(card.thumbnailUrl)"
                alt=""
                loading="lazy"
              />
              <span v-else class="no-image">{{ t('admin.noImage') }}</span>
              <span class="name">{{ card.answerFr || t('admin.unnamed') }}</span>
            </NuxtLink>
            <span class="chip" :class="card.status.toLowerCase()">
              {{ t(`admin.status.${card.status}`) }}
            </span>
            <small v-if="card.blockers.length && card.status !== 'LIVE'" class="muted">
              {{ t('admin.missing', { n: card.blockers.length }) }}
            </small>
          </li>
        </ul>

        <form class="actions" @submit.prevent="addCard">
          <div>
            <label for="card-category">{{ t('admin.category') }}</label>
            <select id="card-category" v-model="newCard.category">
              <option v-for="c in CATEGORIES" :key="c" :value="c">{{ t(`category.${c}`) }}</option>
            </select>
          </div>
          <label class="check">
            <input v-model="newCard.isPerson" type="checkbox" />
            <span>{{ t('admin.isPerson') }}</span>
          </label>
          <button type="submit" class="button small">{{ t('admin.newCard') }}</button>
        </form>
      </section>

      <form class="panel" @submit.prevent="save">
        <h2>{{ t('admin.packDetails') }}</h2>
        <div class="pair">
          <div class="field">
            <label for="title-fr">{{ t('admin.titleFr') }}</label>
            <input id="title-fr" v-model="form.titleFr" type="text" maxlength="120" required />
          </div>
          <div class="field">
            <label for="title-en">{{ t('admin.titleEn') }}</label>
            <input id="title-en" v-model="form.titleEn" type="text" maxlength="120" required />
          </div>
          <div class="field">
            <label for="description-fr">{{ t('admin.descriptionFr') }}</label>
            <textarea id="description-fr" v-model="form.descriptionFr" maxlength="600" />
          </div>
          <div class="field">
            <label for="description-en">{{ t('admin.descriptionEn') }}</label>
            <textarea id="description-en" v-model="form.descriptionEn" maxlength="600" />
          </div>
          <div class="field">
            <label for="category">{{ t('admin.category') }}</label>
            <select id="category" v-model="form.category">
              <option v-for="c in CATEGORIES" :key="c" :value="c">{{ t(`category.${c}`) }}</option>
            </select>
            <small v-if="RESTRICTED_CATEGORIES.includes(form.category)" class="muted">
              {{ t('admin.restrictedHint') }}
            </small>
          </div>
        </div>
        <label class="check">
          <input
            v-model="form.publicMatchSafe"
            type="checkbox"
            :disabled="RESTRICTED_CATEGORIES.includes(form.category)"
          />
          <span>{{ t('admin.publicMatchSafe') }}</span>
        </label>
        <div class="actions">
          <button type="submit" class="button" :disabled="busy">{{ t('admin.save') }}</button>
          <span v-if="saved" class="good" role="status">{{ t('admin.saved') }}</span>
          <!-- Only an empty pack of one's own: cards hold files, seeded packs come back. -->
          <button v-if="!cards.length && !pack.slug" type="button" class="link" @click="removePack">
            {{ t('admin.deletePack') }}
          </button>
        </div>
      </form>
    </template>
  </AdminShell>
</template>

<style scoped>
.chip + .chip {
  margin-left: var(--space-2);
}
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: var(--space-3);
  margin-bottom: var(--space-4);
}
.cards li {
  display: grid;
  gap: var(--space-1);
  justify-items: start;
}
.cards a {
  display: grid;
  gap: var(--space-1);
  width: 100%;
  color: var(--ink);
  font-weight: 600;
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
.actions select {
  min-width: 180px;
}
</style>
