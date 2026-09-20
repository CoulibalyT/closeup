<script setup lang="ts">
import type { AdminCard } from '@closeup/shared';

/** The same editor as the back-office, writing to the player's own pack. */
const route = useRoute();
const { t } = useI18n();
const localePath = useLocalePath();
const session = useSessionStore();
const { appName } = useRuntimeConfig().public;

const cardId = String(route.params.id);
const card = ref<AdminCard | null>(null);
const title = computed(() => card.value?.answers.fr.text || t('admin.unnamed'));
useHead({ title: () => `${title.value}, ${appName}` });

onMounted(async () => {
  // The editor needs a session; without one it would only show errors.
  if (!(await session.whoAmI())) await navigateTo(localePath('/account'));
});
</script>

<template>
  <main class="admin card-page">
    <div class="admin-main">
      <NuxtLink v-if="card" class="back" :to="localePath(`/me/packs/${card.packId}`)">
        ← {{ t('catalogue.pack') }}
      </NuxtLink>
      <h1 class="display">{{ title }}</h1>
      <CardEditor
        :card-id="cardId"
        base-path="/me/packs"
        @loaded="card = $event"
        @deleted="navigateTo(localePath(`/me/packs/${$event}`))"
      />
    </div>
  </main>
</template>

<style src="~/assets/css/editor.css"></style>

<style scoped>
/* The editor's styles come with the shared admin frame; this page only needs the frame. */
.card-page {
  min-height: 100dvh;
}
.back {
  color: var(--muted);
}
h1 {
  margin: var(--space-2) 0 var(--space-6);
  font-size: clamp(28px, 4vw, 40px);
  overflow-wrap: anywhere;
}
</style>
