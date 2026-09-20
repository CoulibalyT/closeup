<script setup lang="ts">
import type { AdminCard } from '@closeup/shared';

definePageMeta({ middleware: 'admin' });

const route = useRoute();
const { t } = useI18n();
const localePath = useLocalePath();
const { appName } = useRuntimeConfig().public;

const cardId = String(route.params.id);
const card = ref<AdminCard | null>(null);
const title = computed(() => card.value?.answers.fr.text || t('admin.unnamed'));
useHead({ title: () => `${title.value}, ${appName}` });
</script>

<template>
  <AdminShell
    :title="title"
    :back="card ? { to: `/admin/packs/${card.packId}`, label: t('admin.pack') } : undefined"
  >
    <CardEditor
      :card-id="cardId"
      base-path="/admin"
      @loaded="card = $event"
      @deleted="navigateTo(localePath(`/admin/packs/${$event}`))"
    />
  </AdminShell>
</template>
