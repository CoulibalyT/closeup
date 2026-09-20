<script setup lang="ts">
import { PASSWORD } from '@closeup/shared';
import { ApiError } from '~/stores/session';

const { t, locale } = useI18n();
const localePath = useLocalePath();
const session = useSessionStore();
const { appName } = useRuntimeConfig().public;

useHead({
  title: () => t('account.title', { appName }),
  meta: [{ name: 'robots', content: 'noindex' }],
});

const mode = ref<'register' | 'login'>('register');
const email = ref('');
const password = ref('');
const busy = ref(false);
const error = ref<string | null>(null);

onMounted(() => void session.whoAmI());

async function submit(): Promise<void> {
  busy.value = true;
  error.value = null;
  try {
    if (mode.value === 'register')
      await session.register(email.value, password.value, locale.value);
    else await session.login(email.value, password.value);
    password.value = '';
  } catch (failure) {
    const known = failure instanceof ApiError ? failure : null;
    error.value =
      known?.code === 'EMAIL_TAKEN'
        ? 'taken'
        : known?.status === 401
          ? 'invalid'
          : known?.status === 429
            ? 'locked'
            : known?.status === 400
              ? 'weak'
              : 'failed';
  } finally {
    busy.value = false;
  }
}

// ---- once logged in ----

const current = ref('');
const next = ref('');
const changed = ref<'done' | 'wrong' | 'failed' | null>(null);
async function changePassword(): Promise<void> {
  changed.value = null;
  try {
    await session.changePassword(current.value, next.value);
    current.value = next.value = '';
    changed.value = 'done';
  } catch (failure) {
    changed.value =
      failure instanceof ApiError && failure.code === 'WRONG_PASSWORD' ? 'wrong' : 'failed';
  }
}

// The address is not proven until the link in the e-mail is followed. Nothing waits for it.
const resent = ref(false);
async function resendVerification(): Promise<void> {
  await session.request('POST', '/auth/email/resend').catch(() => undefined);
  resent.value = true;
}

const confirming = ref(false);
const confirmPassword = ref('');
const deleteError = ref(false);
async function deleteAccount(): Promise<void> {
  deleteError.value = false;
  try {
    await session.deleteAccount(confirmPassword.value);
    confirming.value = false;
    confirmPassword.value = '';
  } catch {
    deleteError.value = true;
  }
}
</script>

<template>
  <PageShell :title="t('account.heading')">
    <p v-if="!session.checked" class="muted">{{ t('admin.loading') }}</p>

    <template v-else-if="!session.user">
      <p>{{ t('account.pitch') }}</p>

      <section class="block">
        <div class="tabs" role="group" :aria-label="t('account.heading')">
          <button type="button" :aria-pressed="mode === 'register'" @click="mode = 'register'">
            {{ t('account.register') }}
          </button>
          <button type="button" :aria-pressed="mode === 'login'" @click="mode = 'login'">
            {{ t('account.login') }}
          </button>
        </div>

        <form @submit.prevent="submit">
          <label for="email">{{ t('admin.email') }}</label>
          <input id="email" v-model="email" type="email" autocomplete="username" required />
          <label for="password">{{ t('admin.password') }}</label>
          <input
            id="password"
            v-model="password"
            type="password"
            :autocomplete="mode === 'register' ? 'new-password' : 'current-password'"
            :minlength="mode === 'register' ? PASSWORD.minLength : undefined"
            required
          />
          <small v-if="mode === 'register'" class="muted">
            {{ t('account.passwordRule', { n: PASSWORD.minLength }) }}
          </small>
          <p v-if="error" class="error" role="alert">{{ t(`account.error.${error}`) }}</p>
          <button type="submit" class="button" :disabled="busy">
            {{ t(mode === 'register' ? 'account.createAccount' : 'account.login') }}
          </button>
        </form>
        <NuxtLink v-if="mode === 'login'" :to="localePath('/account/reset')">
          {{ t('account.forgot') }}
        </NuxtLink>
      </section>
      <p class="muted note">{{ t('account.keepsHistory') }}</p>
    </template>

    <template v-else>
      <section class="block">
        <h2>{{ session.user.email }}</h2>
        <p v-if="session.user.nickname" class="muted">
          {{ t('account.playingAs', { nickname: session.user.nickname }) }}
        </p>
        <p v-if="!session.user.emailVerified" class="unverified">
          {{ t('account.unverified') }}
          <button v-if="!resent" type="button" class="link" @click="resendVerification">
            {{ t('account.resendVerification') }}
          </button>
          <span v-else class="good">{{ t('account.verificationSent') }}</span>
        </p>
        <p>
          <NuxtLink :to="localePath('/stats')">{{ t('stats.heading') }}</NuxtLink>
        </p>
        <p>
          <NuxtLink :to="localePath('/rankings')">{{ t('rankings.heading') }}</NuxtLink>
        </p>
        <button type="button" class="button quiet" @click="session.logout">
          {{ t('admin.logout') }}
        </button>
        <p class="muted note">{{ t('account.logoutHint') }}</p>
      </section>

      <section class="block">
        <h2>{{ t('account.changePassword') }}</h2>
        <form @submit.prevent="changePassword">
          <!-- For password managers: which account this password belongs to. -->
          <input type="email" autocomplete="username" :value="session.user.email" readonly hidden />
          <label for="current">{{ t('account.currentPassword') }}</label>
          <input
            id="current"
            v-model="current"
            type="password"
            autocomplete="current-password"
            required
          />
          <label for="next">{{ t('account.newPassword') }}</label>
          <input
            id="next"
            v-model="next"
            type="password"
            autocomplete="new-password"
            :minlength="PASSWORD.minLength"
            required
          />
          <p v-if="changed === 'done'" class="good" role="status">{{ t('account.changed') }}</p>
          <p v-else-if="changed" class="error" role="alert">{{ t(`account.error.${changed}`) }}</p>
          <button type="submit" class="button quiet">{{ t('admin.save') }}</button>
        </form>
      </section>

      <section class="block">
        <h2>{{ t('account.deleteTitle') }}</h2>
        <p class="muted">{{ t('account.deleteHint') }}</p>
        <button v-if="!confirming" type="button" class="link danger" @click="confirming = true">
          {{ t('account.delete') }}
        </button>
        <form v-else @submit.prevent="deleteAccount">
          <!-- For password managers: which account this password belongs to. -->
          <input type="email" autocomplete="username" :value="session.user.email" readonly hidden />
          <label for="confirm">{{ t('account.deleteConfirm') }}</label>
          <input
            id="confirm"
            v-model="confirmPassword"
            type="password"
            autocomplete="current-password"
            required
          />
          <p v-if="deleteError" class="error" role="alert">{{ t('account.error.wrong') }}</p>
          <button type="submit" class="button danger">{{ t('account.delete') }}</button>
          <button type="button" class="link" @click="confirming = false">
            {{ t('admin.eyesCancel') }}
          </button>
        </form>
      </section>
    </template>
  </PageShell>
</template>

<style scoped>
.tabs {
  margin-bottom: var(--space-4);
}
.note {
  margin-top: var(--space-3);
  font-size: 15px;
}
.unverified {
  margin-top: var(--space-2);
  padding: var(--space-2);
  border-left: 3px solid var(--danger);
  font-size: 15px;
}
.block p + p,
.block p + .button {
  margin-top: var(--space-2);
}
.button.danger {
  background: var(--danger);
  color: var(--danger-ink);
}
form + a {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  margin-top: var(--space-2);
}
</style>
