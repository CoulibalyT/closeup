<script setup lang="ts">
/** Takedown requests and anything else about content. No account, no cookie: rights holders
 * do not play here. */
const { t, locale } = useI18n();
const game = useGameStore();
const { appName } = useRuntimeConfig().public;
useHead({ title: () => t('contact.title', { appName }) });

const about = ref('');
const contactEmail = ref('');
const message = ref('');
const state = ref<'idle' | 'sent' | 'failed'>('idle');
const busy = ref(false);

async function send(): Promise<void> {
  busy.value = true;
  try {
    const response = await fetch(`${game.apiBase}/api/takedown`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        about: about.value,
        contactEmail: contactEmail.value,
        message: message.value,
        locale: locale.value,
      }),
    });
    state.value = response.ok ? 'sent' : 'failed';
  } catch {
    state.value = 'failed';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <PageShell :title="t('contact.heading')">
    <p>{{ t('contact.pitch') }}</p>

    <section class="block">
      <p v-if="state === 'sent'" class="good" role="status">{{ t('contact.sent') }}</p>
      <form v-else @submit.prevent="send">
        <label for="about">{{ t('contact.about') }}</label>
        <input id="about" v-model="about" type="text" maxlength="500" required />
        <small class="muted">{{ t('contact.aboutHint') }}</small>

        <label for="email">{{ t('contact.email') }}</label>
        <input id="email" v-model="contactEmail" type="email" required />

        <label for="message">{{ t('contact.message') }}</label>
        <textarea id="message" v-model="message" maxlength="2000" rows="5" required />

        <p v-if="state === 'failed'" class="error" role="alert">{{ t('contact.failed') }}</p>
        <button type="submit" class="button" :disabled="busy">{{ t('contact.send') }}</button>
      </form>
    </section>
  </PageShell>
</template>

<style scoped>
input[type='text'],
input[type='email'],
textarea {
  width: 100%;
  min-height: var(--tap);
  padding: var(--space-2) var(--space-3);
  border: 1.5px solid var(--line);
  border-radius: var(--radius);
  background: var(--bg);
  font: inherit;
  color: inherit;
}
textarea {
  min-height: 120px;
  resize: vertical;
}
</style>
