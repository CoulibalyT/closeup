<script setup lang="ts">
import { PASSWORD } from '@closeup/shared';

const route = useRoute();
const { t } = useI18n();
const localePath = useLocalePath();
const session = useSessionStore();
const { appName } = useRuntimeConfig().public;

useHead({
  title: () => t('account.resetTitle', { appName }),
  meta: [{ name: 'robots', content: 'noindex' }],
});

// With a token in the address: choose the new password. Without: ask for the link.
const token = computed(() => (typeof route.query.token === 'string' ? route.query.token : ''));
const email = ref('');
const password = ref('');
const state = ref<'idle' | 'sent' | 'done' | 'invalid' | 'failed'>('idle');
const busy = ref(false);

async function ask(): Promise<void> {
  busy.value = true;
  try {
    await session.forgotPassword(email.value);
    state.value = 'sent';
  } catch {
    state.value = 'failed';
  } finally {
    busy.value = false;
  }
}

async function choose(): Promise<void> {
  busy.value = true;
  try {
    await session.resetPassword(token.value, password.value);
    state.value = 'done';
  } catch {
    state.value = 'invalid';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <PageShell :title="t('account.resetHeading')">
    <section class="block">
      <template v-if="state === 'done'">
        <p class="good" role="status">{{ t('account.resetDone') }}</p>
        <NuxtLink class="button" :to="localePath('/account')">{{ t('account.login') }}</NuxtLink>
      </template>

      <form v-else-if="token" @submit.prevent="choose">
        <label for="password">{{ t('account.newPassword') }}</label>
        <input
          id="password"
          v-model="password"
          type="password"
          autocomplete="new-password"
          :minlength="PASSWORD.minLength"
          required
        />
        <small class="muted">{{ t('account.passwordRule', { n: PASSWORD.minLength }) }}</small>
        <p v-if="state === 'invalid'" class="error" role="alert">{{ t('account.resetInvalid') }}</p>
        <button type="submit" class="button" :disabled="busy">{{ t('admin.save') }}</button>
      </form>

      <!-- The same sentence whether the address has an account or not. -->
      <p v-else-if="state === 'sent'" role="status">{{ t('account.resetSent') }}</p>

      <form v-else @submit.prevent="ask">
        <p class="muted">{{ t('account.resetHint') }}</p>
        <label for="email">{{ t('admin.email') }}</label>
        <input id="email" v-model="email" type="email" autocomplete="username" required />
        <p v-if="state === 'failed'" class="error" role="alert">{{ t('account.error.failed') }}</p>
        <button type="submit" class="button" :disabled="busy">{{ t('account.resetSend') }}</button>
      </form>
    </section>
  </PageShell>
</template>
