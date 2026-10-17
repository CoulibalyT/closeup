<script setup lang="ts">
import { type AdminPack, CATEGORIES, type Category } from '@closeup/shared';

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

    <ul v-else class="plain packs">
      <li v-for="pack in packs" :key="pack.id" class="panel">
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
  margin-bottom: var(--space-4);
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
