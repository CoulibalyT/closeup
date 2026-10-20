<script setup lang="ts">
import {
  type AdminCard,
  type AdminCardSummary,
  type AdminAvailablePerson,
  type AdminPack,
  CARD_STATUSES,
  CATEGORIES,
  PACK_AUDIENCES,
  type Category,
  RESTRICTED_CATEGORIES,
} from '@closeup/shared';
import { ApiError } from '~/stores/session';
import { ago, PERIODS, within } from '~/utils/since';

definePageMeta({ middleware: 'admin' });

const route = useRoute();
const { t, locale } = useI18n();
const localePath = useLocalePath();
const admin = useSessionStore();
const { appName } = useRuntimeConfig().public;

const id = String(route.params.id);
const pack = ref<AdminPack | null>(null);
const cards = ref<AdminCardSummary[]>([]);
const failed = ref(false);
const saved = ref(false);
const busy = ref(false);
const unlockRights = ref(false);
const allPacks = ref<AdminPack[]>([]);
const selectedCards = ref<string[]>([]);
const copyTargetPackId = ref('');
const copying = ref(false);
const copyNotice = ref('');
const availablePeople = ref<AdminAvailablePerson[]>([]);
const peopleSearch = ref('');
const addingPerson = ref<string | null>(null);

const form = reactive({
  titleFr: '',
  titleEn: '',
  descriptionFr: '',
  descriptionEn: '',
  category: 'OBJECT' as Category,
  publicMatchSafe: false,
  audience: 'FAMILY' as (typeof PACK_AUDIENCES)[number],
});
const SORTS = ['newest', 'changed', 'name', 'oldest'] as const;
const search = useQueryFilter('q', '');
const status = useQueryFilter<'' | AdminCardSummary['status']>('status', '', [
  '',
  ...CARD_STATUSES,
]);
const since = useQueryFilter('since', 'all', PERIODS);
const on = useQueryFilter('on', 'added', ['added', 'changed'] as const);
const sort = useQueryFilter('sort', 'newest', SORTS);

const name = (card: AdminCardSummary) => (locale.value === 'en' ? card.answerEn : card.answerFr);
const shown = computed(() => {
  const words = search.value.trim().toLocaleLowerCase();
  const list = cards.value.filter(
    (card) =>
      (!words || `${card.answerFr} ${card.answerEn}`.toLocaleLowerCase().includes(words)) &&
      (!status.value || card.status === status.value) &&
      within(on.value === 'added' ? card.createdAt : card.updatedAt, since.value),
  );
  const by = {
    newest: (a: AdminCardSummary, b: AdminCardSummary) => b.createdAt.localeCompare(a.createdAt),
    changed: (a: AdminCardSummary, b: AdminCardSummary) => b.updatedAt.localeCompare(a.updatedAt),
    name: (a: AdminCardSummary, b: AdminCardSummary) =>
      name(a).localeCompare(name(b), locale.value),
    oldest: () => 0,
  }[sort.value];
  return [...list].sort((a, b) => {
    const imagePriority = Number(Boolean(b.thumbnailUrl)) - Number(Boolean(a.thumbnailUrl));
    return imagePriority || by(a, b);
  });
});
/** How many cards of each status, for the chips that filter on it. */
const byStatus = computed(() =>
  CARD_STATUSES.map((s) => ({
    status: s,
    n: cards.value.filter((c) => c.status === s).length,
  })).filter((row) => row.n),
);
const filtered = computed(() => !!(search.value || status.value || since.value !== 'all'));
const shownPeople = computed(() => {
  const words = peopleSearch.value.trim().toLocaleLowerCase();
  return availablePeople.value.filter(
    (person) =>
      !words ||
      `${person.answerFr} ${person.answerEn} ${person.packTitle}`
        .toLocaleLowerCase()
        .includes(words),
  );
});
const router = useRouter();
function reset(): void {
  void router.replace({ query: {} });
}

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
  const { titleFr, titleEn, descriptionFr, descriptionEn, category, audience, publicMatchSafe } =
    next;
  Object.assign(form, {
    titleFr,
    titleEn,
    descriptionFr,
    descriptionEn,
    category,
    audience,
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
    allPacks.value = await admin.request<AdminPack[]>('GET', '/admin/packs');
    availablePeople.value = await admin.request<AdminAvailablePerson[]>(
      'GET',
      `/admin/packs/${id}/available-people`,
    );
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

const allShownSelected = computed(
  () =>
    shown.value.length > 0 && shown.value.every((card) => selectedCards.value.includes(card.id)),
);

function toggleCard(cardId: string): void {
  selectedCards.value = selectedCards.value.includes(cardId)
    ? selectedCards.value.filter((selected) => selected !== cardId)
    : [...selectedCards.value, cardId];
}

function toggleShown(): void {
  const shownIds = shown.value.map((card) => card.id);
  selectedCards.value = allShownSelected.value
    ? selectedCards.value.filter((selected) => !shownIds.includes(selected))
    : [...new Set([...selectedCards.value, ...shownIds])];
}

async function copySelected(): Promise<void> {
  if (!copyTargetPackId.value || !selectedCards.value.length) return;
  copying.value = true;
  copyNotice.value = '';
  try {
    const results = await Promise.allSettled(
      selectedCards.value.map((cardId) =>
        admin.request<AdminCard>('POST', `/admin/cards/${cardId}/copy`, {
          targetPackId: copyTargetPackId.value,
        }),
      ),
    );
    const copied = results.filter((result) => result.status === 'fulfilled').length;
    const duplicates = results.filter(
      (result) =>
        result.status === 'rejected' &&
        result.reason instanceof ApiError &&
        result.reason.code === 'IMAGE_ALREADY_IN_PACK',
    ).length;
    const otherFailures = results.length - copied - duplicates;
    if (otherFailures) {
      failed.value = true;
    }
    copyNotice.value = t('admin.copyResult', { copied, duplicates });
    selectedCards.value = [];
    copyTargetPackId.value = '';
  } finally {
    copying.value = false;
  }
}

async function setVisibility(visibility: 'PRIVATE' | 'PUBLIC' | 'DISABLED'): Promise<void> {
  fill(await admin.request<AdminPack>('PUT', `/admin/packs/${id}/visibility`, { visibility }));
}

/** The lock comes off only with the rights vouched for; the server writes it down. */
async function unlock(): Promise<void> {
  fill(
    await admin.request<AdminPack>('POST', `/admin/packs/${id}/unlock`, { rightsConfirmed: true }),
  );
  unlockRights.value = false;
}

async function removePack(): Promise<void> {
  if (!window.confirm(t('admin.deletePackConfirm'))) return;
  await admin.request('DELETE', `/admin/packs/${id}`);
  await navigateTo(localePath('/admin'));
}

/** One tap from the list: take a card out of play, or put it back, without opening it. */
const switching = ref<string | null>(null);
async function setLive(card: AdminCardSummary, live: boolean): Promise<void> {
  switching.value = card.id;
  try {
    const updated = await admin.request<AdminCard>('PUT', `/admin/cards/${card.id}/live`, { live });
    cards.value = cards.value.map((c) =>
      c.id === card.id ? { ...c, status: updated.status, updatedAt: updated.updatedAt } : c,
    );
  } catch {
    failed.value = true;
  } finally {
    switching.value = null;
  }
}

async function addCard(): Promise<void> {
  const card = await admin.request<AdminCard>('POST', `/admin/packs/${id}/cards`, { ...newCard });
  await navigateTo(localePath(`/admin/cards/${card.id}`));
}

async function addPerson(person: AdminAvailablePerson): Promise<void> {
  addingPerson.value = person.id;
  try {
    await admin.request<AdminCard>('POST', `/admin/cards/${person.id}/copy`, { targetPackId: id });
    availablePeople.value = availablePeople.value.filter((candidate) => candidate.id !== person.id);
  } catch {
    failed.value = true;
  } finally {
    addingPerson.value = null;
  }
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
          <span v-if="!pack.publishable" class="chip draft">{{ t('admin.locked') }}</span>
        </p>
        <template v-if="!pack.publishable">
          <p class="muted">{{ t('admin.lockedHint') }}</p>
          <label class="check">
            <input v-model="unlockRights" type="checkbox" />
            <span>{{ t('admin.unlockRights') }}</span>
          </label>
          <button
            type="button"
            class="button small quiet"
            :disabled="!unlockRights"
            @click="unlock"
          >
            {{ t('admin.unlock') }}
          </button>
        </template>
        <p class="muted">{{ t(`admin.visibilityHint.${pack.visibility}`) }}</p>
        <p v-if="pack.restricted" class="muted">{{ t('admin.restrictedHint') }}</p>
        <div class="actions">
          <button
            v-if="pack.visibility !== 'PUBLIC' && pack.publishable"
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
        <h2>{{ t('admin.peopleLibrary') }}</h2>
        <p class="muted">{{ t('admin.peopleLibraryHint') }}</p>
        <div class="field">
          <label for="people-search">{{ t('admin.searchPeople') }}</label>
          <input
            id="people-search"
            v-model="peopleSearch"
            type="search"
            :placeholder="t('admin.searchPeoplePlaceholder')"
          />
        </div>
        <p v-if="!shownPeople.length" class="muted">{{ t('admin.noPeopleAvailable') }}</p>
        <ul v-else class="plain people-library">
          <li v-for="person in shownPeople" :key="person.id">
            <img v-if="person.thumbnailUrl" :src="admin.mediaUrl(person.thumbnailUrl)" alt="" />
            <span v-else class="no-image">{{ t('admin.noImage') }}</span>
            <span class="person-name">
              <strong>{{ person.answerFr || person.answerEn }}</strong>
              <small class="muted">{{ person.packTitle }}</small>
            </span>
            <button
              type="button"
              class="button small"
              :disabled="addingPerson === person.id"
              @click="addPerson(person)"
            >
              {{ t('admin.addPerson') }}
            </button>
          </li>
        </ul>
      </section>

      <section class="panel">
        <h2>{{ t('admin.cards') }}</h2>
        <p v-if="!cards.length" class="muted">{{ t('admin.noCards') }}</p>
        <template v-else>
          <div class="copy-tools">
            <label class="check">
              <input type="checkbox" :checked="allShownSelected" @change="toggleShown" />
              <span>{{ t('admin.selectVisible') }}</span>
            </label>
            <select v-model="copyTargetPackId" :disabled="!selectedCards.length || copying">
              <option value="">{{ t('admin.copyTo') }}</option>
              <option
                v-for="target in allPacks.filter((candidate) => candidate.id !== id)"
                :key="target.id"
                :value="target.id"
              >
                {{ target.titleFr }}
              </option>
            </select>
            <button
              type="button"
              class="button small quiet"
              :disabled="!copyTargetPackId || !selectedCards.length || copying"
              @click="copySelected"
            >
              {{ t('admin.copySelected', { n: selectedCards.length }) }}
            </button>
          </div>
          <p v-if="copyNotice" class="good" role="status">{{ copyNotice }}</p>
          <div class="chips" role="group" :aria-label="t('admin.filters.status')">
            <button type="button" class="chip choice" :aria-pressed="!status" @click="status = ''">
              {{ t('admin.filters.all') }} · {{ cards.length }}
            </button>
            <button
              v-for="row in byStatus"
              :key="row.status"
              type="button"
              class="chip choice"
              :class="row.status.toLowerCase()"
              :aria-pressed="status === row.status"
              @click="status = status === row.status ? '' : row.status"
            >
              {{ t(`admin.status.${row.status}`) }} · {{ row.n }}
            </button>
          </div>
          <form class="filters" role="search" @submit.prevent>
            <div class="field grow">
              <label for="f-search">{{ t('admin.filters.search') }}</label>
              <input
                id="f-search"
                v-model="search"
                type="search"
                :placeholder="t('admin.filters.searchCards')"
              />
            </div>
            <div class="field">
              <label for="f-on">{{ t('admin.filters.activity') }}</label>
              <select id="f-on" v-model="on">
                <option value="added">{{ t('admin.filters.on.added') }}</option>
                <option value="changed">{{ t('admin.filters.on.changed') }}</option>
              </select>
            </div>
            <div class="field">
              <label for="f-since">{{ t('admin.filters.period.label') }}</label>
              <select id="f-since" v-model="since">
                <option v-for="p in PERIODS" :key="p" :value="p">
                  {{ t(`admin.filters.period.${p}`) }}
                </option>
              </select>
            </div>
            <div class="field">
              <label for="f-sort">{{ t('admin.filters.sort') }}</label>
              <select id="f-sort" v-model="sort">
                <option v-for="s in SORTS" :key="s" :value="s">
                  {{ t(`admin.filters.cardSort.${s}`) }}
                </option>
              </select>
            </div>
          </form>
          <p class="muted count" role="status">
            {{ t('admin.filters.cardCount', { n: shown.length, total: cards.length }) }}
            <button v-if="filtered" type="button" class="link" @click="reset">
              {{ t('admin.filters.reset') }}
            </button>
          </p>
        </template>
        <ul class="plain cards">
          <li v-for="card in shown" :key="card.id">
            <label class="card-select">
              <input
                type="checkbox"
                :checked="selectedCards.includes(card.id)"
                :aria-label="t('admin.selectCard', { name: card.answerFr || t('admin.unnamed') })"
                @change="toggleCard(card.id)"
              />
            </label>
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
            <button
              v-if="card.status === 'LIVE' || (card.status === 'READY' && !card.blockers.length)"
              type="button"
              class="button small"
              :class="card.status === 'LIVE' ? 'danger' : 'quiet'"
              :disabled="switching === card.id"
              @click="setLive(card, card.status !== 'LIVE')"
            >
              {{ t(card.status === 'LIVE' ? 'admin.unpublish' : 'admin.publish') }}
            </button>
            <small v-if="card.blockers.length && card.status !== 'LIVE'" class="muted">
              {{ t('admin.missing', { n: card.blockers.length }) }}
            </small>
            <small class="muted" :title="new Date(card.updatedAt).toLocaleString(locale)">
              {{
                t(on === 'changed' ? 'admin.filters.changed' : 'admin.filters.added', {
                  when: ago(on === 'changed' ? card.updatedAt : card.createdAt, locale),
                })
              }}
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
          <div class="field">
            <label for="audience">{{ t('admin.audience') }}</label>
            <select id="audience" v-model="form.audience">
              <option v-for="a in PACK_AUDIENCES" :key="a" :value="a">
                {{ t(`admin.audiences.${a}`) }}
              </option>
            </select>
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
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-bottom: var(--space-3);
}
.chips .chip + .chip {
  margin-left: 0;
}
.chip.choice {
  min-height: 36px;
  border: 1px solid var(--line);
  cursor: pointer;
  font: inherit;
  font-size: 14px;
}
.chip.choice[aria-pressed='true'] {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
.filters {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  align-items: end;
}
.filters .field {
  margin: 0;
}
.filters .grow {
  flex: 1 1 200px;
}
.count {
  margin: var(--space-3) 0;
}
.count .link {
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
  position: relative;
}
.copy-tools {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  gap: var(--space-2);
  margin-bottom: var(--space-3);
}
.people-library {
  display: grid;
  gap: var(--space-2);
  max-height: 420px;
  overflow: auto;
  margin-top: var(--space-3);
}
.people-library li {
  display: grid;
  grid-template-columns: 48px 1fr auto;
  gap: var(--space-2);
  align-items: center;
  padding: var(--space-2);
  border: 1px solid var(--line);
  border-radius: var(--radius);
}
.people-library img,
.people-library .no-image {
  width: 48px;
  height: 48px;
  object-fit: cover;
  border-radius: var(--radius);
}
.person-name {
  display: grid;
  gap: 2px;
}
.card-select {
  position: absolute;
  z-index: 1;
  top: var(--space-2);
  left: var(--space-2);
  padding: var(--space-1);
  border-radius: var(--radius);
  background: var(--panel);
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
