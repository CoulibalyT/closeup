<script setup lang="ts">
/** Frame of every back-office page: where you are, and the way out. */
defineProps<{ title: string; back?: { to: string; label: string } }>();

const { t } = useI18n();
const localePath = useLocalePath();
const admin = useSessionStore();
const { appName } = useRuntimeConfig().public;

// The back-office is nobody's business but the owner's: keep it out of every index.
useHead({ meta: [{ name: 'robots', content: 'noindex, nofollow' }] });

async function logout(): Promise<void> {
  await admin.logout();
  await navigateTo(localePath('/admin/login'));
}
</script>

<template>
  <div class="admin">
    <header class="admin-bar">
      <NuxtLink class="display brand" :to="localePath('/admin')">{{ appName }}</NuxtLink>
      <span class="muted">{{ t('admin.backOffice') }}</span>
      <span class="grow" />
      <span v-if="admin.user" class="muted who">{{ admin.user.email }}</span>
      <button type="button" class="link" @click="logout">{{ t('admin.logout') }}</button>
    </header>
    <main class="admin-main">
      <NuxtLink v-if="back" class="back" :to="localePath(back.to)">← {{ back.label }}</NuxtLink>
      <h1 class="display">{{ title }}</h1>
      <slot />
    </main>
  </div>
</template>

<style src="~/assets/css/editor.css"></style>
