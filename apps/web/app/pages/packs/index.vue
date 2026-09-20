<script setup lang="ts">
import { CATEGORIES, type CataloguePack, type Category } from '@closeup/shared';

/** Everything published, made by the house or by players. Restricted packs are never listed. */
const { t, locale } = useI18n();
const localePath = useLocalePath();
const game = useGameStore();
const { appName } = useRuntimeConfig().public;
useHead({ title: () => t('catalogue.title', { appName }) });

const packs = ref<CataloguePack[]>([]);
const category = ref<Category | ''>('');
const loading = ref(true);
const failed = ref(false);

async function load(): Promise<void> {
  loading.value = true;
  failed.value = false;
  try {
    const query = category.value ? `?category=${category.value}` : '';
    const response = await fetch(`${game.apiBase}/api/packs${query}`, {
      headers: { 'accept-language': locale.value },
    });
    if (!response.ok) throw new Error('catalogue');
    packs.value = (await response.json()) as CataloguePack[];
  } catch {
    failed.value = true;
  } finally {
    loading.value = false;
  }
}
watch(category, load);
onMounted(load);
</script>

<template>
  <PageShell :title="t('catalogue.heading')">
    <p class="muted">{{ t('catalogue.pitch') }}</p>

    <div class="filters">
      <label for="category" class="sr-only">{{ t('admin.category') }}</label>
      <select id="category" v-model="category">
        <option value="">{{ t('catalogue.allCategories') }}</option>
        <option v-for="value in CATEGORIES" :key="value" :value="value">
          {{ t(`category.${value}`) }}
        </option>
      </select>
    </div>

    <p v-if="failed" class="error" role="alert">{{ t('admin.failed') }}</p>
    <p v-else-if="loading" class="muted">{{ t('admin.loading') }}</p>
    <p v-else-if="!packs.length" class="block">{{ t('catalogue.empty') }}</p>

    <ul v-else class="plain packs">
      <li v-for="pack in packs" :key="pack.id">
        <NuxtLink :to="localePath(`/packs/${pack.id}`)">
          <img v-if="pack.coverUrl" :src="game.mediaUrl(pack.coverUrl)" alt="" loading="lazy" />
          <span v-else class="no-cover" />
          <b>{{ pack.title }}</b>
        </NuxtLink>
        <p class="muted">
          {{ t('catalogue.cards', { n: pack.cards }) }} · {{ t(`category.${pack.category}`) }}
          <template v-if="pack.authorNickname">
            · {{ t('catalogue.by', { author: pack.authorNickname }) }}
          </template>
        </p>
      </li>
    </ul>

    <p class="block">
      {{ t('catalogue.makeYours') }}
      <NuxtLink :to="localePath('/me/packs')">{{ t('myPacks.heading') }}</NuxtLink>
    </p>
  </PageShell>
</template>

<style scoped>
.filters {
  margin: var(--space-3) 0;
}
select {
  min-height: var(--tap);
  padding: 0 var(--space-3);
  border: 1.5px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
  font: inherit;
  color: inherit;
}
.packs {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: var(--space-4);
}
.packs li {
  display: grid;
  gap: var(--space-1);
}
.packs a {
  display: grid;
  gap: var(--space-2);
  color: var(--ink);
}
.packs img,
.no-cover {
  width: 100%;
  aspect-ratio: 1;
  border-radius: 50%;
  background: var(--surface);
  object-fit: cover;
}
.packs p {
  font-size: 14px;
}
.block a {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
}
</style>
