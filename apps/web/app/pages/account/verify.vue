<script setup lang="ts">
/** The link from the e-mail lands here: one request, then back to the account page. */
const route = useRoute();
const { t } = useI18n();
const localePath = useLocalePath();
const session = useSessionStore();
const { appName } = useRuntimeConfig().public;

useHead({
  title: () => t('account.verifyTitle', { appName }),
  meta: [{ name: 'robots', content: 'noindex' }],
});

const state = ref<'checking' | 'done' | 'invalid'>('checking');

onMounted(async () => {
  const token = typeof route.query.token === 'string' ? route.query.token : '';
  if (!token) return (state.value = 'invalid');
  try {
    await session.request('POST', '/auth/email/verify', { token });
    await session.whoAmI();
    state.value = 'done';
  } catch {
    state.value = 'invalid';
  }
});
</script>

<template>
  <PageShell :title="t('account.verifyHeading')">
    <section class="block">
      <p v-if="state === 'checking'" class="muted">{{ t('admin.loading') }}</p>
      <p v-else-if="state === 'done'" class="good" role="status">{{ t('account.verifyDone') }}</p>
      <p v-else class="error" role="alert">{{ t('account.verifyInvalid') }}</p>
      <NuxtLink class="button quiet" :to="localePath('/account')">
        {{ t('account.heading') }}
      </NuxtLink>
    </section>
  </PageShell>
</template>

<style scoped>
.button {
  margin-top: var(--space-3);
}
</style>
