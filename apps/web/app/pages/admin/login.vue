<script setup lang="ts">
import { AdminApiError } from '~/stores/admin';

const { t } = useI18n();
const localePath = useLocalePath();
const admin = useAdminStore();
const { appName } = useRuntimeConfig().public;

useHead({
  title: () => t('admin.loginTitle', { appName }),
  meta: [{ name: 'robots', content: 'noindex, nofollow' }],
});

const email = ref('');
const password = ref('');
const busy = ref(false);
const error = ref<'invalid' | 'locked' | 'failed' | null>(null);

onMounted(async () => {
  if ((await admin.whoAmI())?.role === 'ADMIN') await navigateTo(localePath('/admin'));
});

async function submit(): Promise<void> {
  busy.value = true;
  error.value = null;
  try {
    await admin.login(email.value, password.value);
    await navigateTo(localePath('/admin'));
  } catch (failure) {
    const status = failure instanceof AdminApiError ? failure.status : 0;
    error.value = status === 401 ? 'invalid' : status === 429 ? 'locked' : 'failed';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <main class="admin login">
    <form class="panel" @submit.prevent="submit">
      <h1 class="display">{{ appName }}</h1>
      <p class="muted">{{ t('admin.backOffice') }}</p>

      <div class="field">
        <label for="email">{{ t('admin.email') }}</label>
        <input id="email" v-model="email" type="email" autocomplete="username" required />
      </div>
      <div class="field">
        <label for="password">{{ t('admin.password') }}</label>
        <input
          id="password"
          v-model="password"
          type="password"
          autocomplete="current-password"
          required
        />
      </div>
      <p v-if="error" class="error" role="alert">{{ t(`admin.loginError.${error}`) }}</p>
      <button type="submit" class="button" :disabled="busy">{{ t('admin.login') }}</button>
    </form>
  </main>
</template>

<style scoped>
.login {
  display: grid;
  place-items: center;
  padding: var(--space-4);
}
form {
  display: grid;
  gap: var(--space-2);
  width: min(100%, 380px);
}
h1 {
  font-size: 32px;
}
</style>
