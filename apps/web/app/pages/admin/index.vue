<script setup lang="ts">
import { type AdminPack, CATEGORIES, type Category, PACK_VISIBILITIES } from '@closeup/shared';
import { ago, PERIODS, within } from '~/utils/since';

definePageMeta({ middleware: 'admin' });

const { t, locale } = useI18n();
const localePath = useLocalePath();
const admin = useSessionStore();
const { appName } = useRuntimeConfig().public;
useHead({ title: () => t('admin.packsTitle', { appName }) });

const packs = ref<AdminPack[]>([]);
const loading = ref(true);
const failed = ref(false);

const draft = reactive({ titleFr: '', titleEn: '', category: 'OBJECT' as Category });
const creating = ref(false);

const total = (pack: AdminPack) => Object.values(pack.cards).reduce((sum, n) => sum + (n ?? 0), 0);
const title = (pack: AdminPack) => (locale.value === 'en' ? pack.titleEn : pack.titleFr);

const SORTS = ['recent', 'added', 'name', 'cards', 'oldest'] as const;
const search = useQueryFilter('q', '');
const category = useQueryFilter<'' | Category>('cat', '', ['', ...CATEGORIES]);
const visibility = useQueryFilter<'' | AdminPack['visibility']>('vis', '', [
  '',
  ...PACK_VISIBILITIES,
]);
const since = useQueryFilter('since', 'all', PERIODS);
const sort = useQueryFilter('sort', 'recent', SORTS);

/** The last thing that happened to a pack: its own edit, or one of its cards. */
const activity = (pack: AdminPack) =>
  [pack.updatedAt, pack.lastCardChangedAt].filter(Boolean).sort().at(-1) ?? pack.updatedAt;
const time = (iso: string | null) => (iso ? Date.parse(iso) : 0);

const shown = computed(() => {
  const words = search.value.trim().toLocaleLowerCase();
  const list = packs.value.filter(
    (pack) =>
      (!words ||
        `${pack.titleFr} ${pack.titleEn} ${pack.slug ?? ''}`.toLocaleLowerCase().includes(words)) &&
      (!category.value || pack.category === category.value) &&
      (!visibility.value || pack.visibility === visibility.value) &&
      within(activity(pack), since.value),
  );
  const by = {
    recent: (a: AdminPack, b: AdminPack) => time(activity(b)) - time(activity(a)),
    added: (a: AdminPack, b: AdminPack) => time(b.lastCardAddedAt) - time(a.lastCardAddedAt),
    name: (a: AdminPack, b: AdminPack) => title(a).localeCompare(title(b), locale.value),
    cards: (a: AdminPack, b: AdminPack) => total(b) - total(a),
    oldest: () => 0,
  }[sort.value];
  return [...list].sort(by);
});
const filtered = computed(
  () => !!(search.value || category.value || visibility.value || since.value !== 'all'),
);
const router = useRouter();
function reset(): void {
  void router.replace({ query: {} });
}

async function load(): Promise<void> {
  try {
    packs.value = await admin.request<AdminPack[]>('GET', '/admin/packs');
  } catch {
    failed.value = true;
  } finally {
    loading.value = false;
  }
}
onMounted(load);

async function create(): Promise<void> {
  creating.value = true;
  try {
    const pack = await admin.request<AdminPack>('POST', '/admin/packs', { ...draft });
    await navigateTo(localePath(`/admin/packs/${pack.id}`));
  } catch {
    failed.value = true;
  } finally {
    creating.value = false;
  }
}

/**
 * The one-click switch: a disabled pack leaves running games at their next round. Switched back
 * on, a house pack plays again for everybody; a player's pack, or a locked one, comes back private
 * (a player's pack goes through review again before the catalogue).
 */
async function toggle(pack: AdminPack): Promise<void> {
  const back = !pack.byPlayer && pack.publishable ? 'PUBLIC' : 'PRIVATE';
  const visibility = pack.visibility === 'DISABLED' ? back : 'DISABLED';
  const updated = await admin.request<AdminPack>('PUT', `/admin/packs/${pack.id}/visibility`, {
    visibility,
  });
  packs.value = packs.value.map((p) => (p.id === updated.id ? updated : p));
}
</script>

<template>
  <AdminShell :title="t('admin.packs')">
    <p class="tools">
      <NuxtLink :to="localePath('/admin/reports')">{{ t('admin.reports') }}</NuxtLink>
      <NuxtLink :to="localePath('/admin/import')">{{ t('importer.heading') }}</NuxtLink>
    </p>
    <p v-if="failed" class="error" role="alert">{{ t('admin.failed') }}</p>
    <p v-if="loading" class="muted">{{ t('admin.loading') }}</p>

    <template v-else>
      <form class="panel filters" role="search" @submit.prevent>
        <div class="field grow">
          <label for="f-search">{{ t('admin.filters.search') }}</label>
          <input
            id="f-search"
            v-model="search"
            type="search"
            :placeholder="t('admin.filters.searchPacks')"
          />
        </div>
        <div class="field">
          <label for="f-category">{{ t('admin.category') }}</label>
          <select id="f-category" v-model="category">
            <option value="">{{ t('admin.filters.all') }}</option>
            <option v-for="c in CATEGORIES" :key="c" :value="c">{{ t(`category.${c}`) }}</option>
          </select>
        </div>
        <div class="field">
          <label for="f-visibility">{{ t('admin.visibilityTitle') }}</label>
          <select id="f-visibility" v-model="visibility">
            <option value="">{{ t('admin.filters.all') }}</option>
            <option v-for="v in PACK_VISIBILITIES" :key="v" :value="v">
              {{ t(`admin.visibility.${v}`) }}
            </option>
          </select>
        </div>
        <div class="field">
          <label for="f-since">{{ t('admin.filters.activity') }}</label>
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
              {{ t(`admin.filters.packSort.${s}`) }}
            </option>
          </select>
        </div>
      </form>
      <p class="muted count" role="status">
        {{ t('admin.filters.packCount', { n: shown.length, total: packs.length }) }}
        <button v-if="filtered" type="button" class="link" @click="reset">
          {{ t('admin.filters.reset') }}
        </button>
      </p>

      <ul class="plain packs">
        <li v-for="pack in shown" :key="pack.id" class="panel">
          <div class="head">
            <NuxtLink class="name" :to="localePath(`/admin/packs/${pack.id}`)">
              {{ title(pack) }}
            </NuxtLink>
            <span class="chip" :class="pack.visibility.toLowerCase()">
              {{ t(`admin.visibility.${pack.visibility}`) }}
            </span>
            <span v-if="pack.restricted" class="chip">{{ t('admin.restricted') }}</span>
            <span v-if="!pack.publishable" class="chip draft">{{ t('admin.locked') }}</span>
          </div>
          <p class="muted">
            {{ t(`category.${pack.category}`) }} ·
            {{ t('admin.cardCount', { live: pack.cards.LIVE ?? 0, total: total(pack) }) }}
          </p>
          <p class="muted when">
            <span>{{ t('admin.filters.changed', { when: ago(activity(pack), locale) }) }}</span>
            <span v-if="pack.lastCardAddedAt">
              {{ t('admin.filters.lastAdded', { when: ago(pack.lastCardAddedAt, locale) }) }}
            </span>
          </p>
          <button
            type="button"
            class="button small"
            :class="pack.visibility === 'DISABLED' ? 'quiet' : 'danger'"
            @click="toggle(pack)"
          >
            {{ t(pack.visibility === 'DISABLED' ? 'admin.enable' : 'admin.disable') }}
          </button>
        </li>
      </ul>
    </template>

    <form class="panel new" @submit.prevent="create">
      <h2>{{ t('admin.newPack') }}</h2>
      <div class="pair">
        <div class="field">
          <label for="title-fr">{{ t('admin.titleFr') }}</label>
          <input id="title-fr" v-model="draft.titleFr" type="text" maxlength="120" required />
        </div>
        <div class="field">
          <label for="title-en">{{ t('admin.titleEn') }}</label>
          <input id="title-en" v-model="draft.titleEn" type="text" maxlength="120" required />
        </div>
        <div class="field">
          <label for="category">{{ t('admin.category') }}</label>
          <select id="category" v-model="draft.category">
            <option v-for="c in CATEGORIES" :key="c" :value="c">{{ t(`category.${c}`) }}</option>
          </select>
        </div>
      </div>
      <button type="submit" class="button" :disabled="creating">{{ t('admin.createPack') }}</button>
    </form>
  </AdminShell>
</template>

<style scoped>
.tools {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4);
  margin-bottom: var(--space-4);
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
  flex: 1 1 220px;
}
.count {
  margin: var(--space-3) 0;
}
.count .link {
  margin-left: var(--space-2);
}
.when {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-3);
  font-size: 13px;
}
.tools a {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
}
.packs {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: var(--space-4);
}
/* Tiles of a grid, not stacked panels: no top margin between them. */
.packs li.panel {
  display: grid;
  gap: var(--space-2);
  align-content: start;
  margin: 0;
}
.head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}
.name {
  font-size: 19px;
  font-weight: 700;
  color: var(--ink);
}
.button.small {
  justify-self: start;
}
.new {
  margin-top: var(--space-6);
}
</style>
