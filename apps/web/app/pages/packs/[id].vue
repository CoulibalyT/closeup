<script setup lang="ts">
import type { PackCredits } from '@closeup/shared';

/** The credits page every published pack owes its images, and the way to report it. */
const route = useRoute();
const { t, locale } = useI18n();
const localePath = useLocalePath();
const game = useGameStore();
const { appName } = useRuntimeConfig().public;

const pack = ref<PackCredits | null>(null);
const missing = ref(false);
useHead(() => ({
  title: pack.value ? `${pack.value.title}, ${appName}` : appName,
  // Packs about real people or characters stay out of search engines (the brief).
  meta: pack.value?.restricted ? [{ name: 'robots', content: 'noindex' }] : [],
}));

const reporting = ref(false);
const reason = ref<'rights' | 'inappropriate' | 'wrong_answer' | 'other'>('rights');
const message = ref('');
const reportState = ref<'idle' | 'sent' | 'failed'>('idle');

onMounted(async () => {
  const response = await fetch(`${game.apiBase}/api/packs/${route.params.id}/credits`, {
    headers: { 'accept-language': locale.value },
  });
  if (!response.ok) return (missing.value = true);
  pack.value = (await response.json()) as PackCredits;
});

async function report(): Promise<void> {
  const response = await fetch(`${game.apiBase}/api/reports`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      targetType: 'PACK',
      targetId: route.params.id,
      reason: reason.value,
      message: message.value,
    }),
  });
  reportState.value = response.ok ? 'sent' : 'failed';
}
</script>

<template>
  <PageShell wide :title="pack?.title ?? t('catalogue.pack')">
    <p v-if="missing" class="block">{{ t('catalogue.missing') }}</p>

    <template v-else-if="pack">
      <p v-if="pack.description" class="description">{{ pack.description }}</p>
      <p v-if="pack.authorNickname" class="muted">
        {{ t('catalogue.by', { author: pack.authorNickname }) }}
      </p>

      <section class="block">
        <h2>{{ t('catalogue.credits') }}</h2>
        <p class="muted">{{ t('catalogue.creditsHint') }}</p>
        <ul class="plain credits">
          <li v-for="(credit, index) in pack.cards" :key="index">
            <b>{{ credit.answer }}</b>
            <span class="muted">
              <CreditLine :author="credit.author" :licence="credit.licence" />
              <a v-if="credit.sourceUrl" :href="credit.sourceUrl" rel="noopener nofollow">
                {{ t('catalogue.source') }}
              </a>
            </span>
          </li>
        </ul>
      </section>

      <section class="block">
        <template v-if="reportState === 'sent'">
          <p class="good" role="status">{{ t('report.sent') }}</p>
        </template>
        <template v-else-if="reporting">
          <h2>{{ t('catalogue.reportTitle') }}</h2>
          <form @submit.prevent="report">
            <label for="reason">{{ t('report.reason') }}</label>
            <select id="reason" v-model="reason">
              <option value="rights">{{ t('catalogue.reasons.rights') }}</option>
              <option value="inappropriate">{{ t('catalogue.reasons.inappropriate') }}</option>
              <option value="wrong_answer">{{ t('catalogue.reasons.wrong_answer') }}</option>
              <option value="other">{{ t('report.reasons.other') }}</option>
            </select>
            <label for="message">{{ t('report.message') }}</label>
            <textarea id="message" v-model="message" maxlength="500" rows="3" />
            <p v-if="reportState === 'failed'" class="error" role="alert">
              {{ t('report.failed') }}
            </p>
            <button type="submit" class="button quiet">{{ t('report.send') }}</button>
          </form>
        </template>
        <template v-else>
          <button type="button" class="link" @click="reporting = true">
            {{ t('catalogue.report') }}
          </button>
          <p class="muted takedown">
            {{ t('catalogue.rightsHolder') }}
            <NuxtLink :to="localePath('/contact')">{{ t('contact.heading') }}</NuxtLink>
          </p>
        </template>
      </section>
    </template>
  </PageShell>
</template>

<style scoped>
.credits li {
  padding: var(--space-2) 0;
  border-top: 1px solid var(--line);
}
.credits b {
  display: block;
}
.credits span {
  font-size: 14px;
}
select,
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
  min-height: 76px;
}
.takedown {
  margin-top: var(--space-2);
  font-size: 15px;
}
.takedown a {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
}
/* Computer: the credits in columns; prose and the report form keep a readable measure. */
@media (min-width: 1080px) {
  .credits {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    column-gap: var(--space-6);
  }
  .description {
    max-width: 70ch;
  }
  form {
    max-width: 560px;
  }
}
</style>
