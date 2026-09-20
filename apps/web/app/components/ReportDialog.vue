<script setup lang="ts">
import { REPORT_REASONS, type ReportReason } from '@closeup/shared';

/**
 * Reporting somebody met in a public game. Deliberately small: a reason, a few words, and it is
 * gone. What happens next is a person reading it, not a counter.
 */
const props = defineProps<{ playerId: string; nickname: string }>();
const emit = defineEmits<{ close: [] }>();
const { t } = useI18n();
const game = useGameStore();

const reason = ref<ReportReason>('harassment');
const message = ref('');
const state = ref<'idle' | 'sent' | 'failed'>('idle');
const busy = ref(false);

async function send(): Promise<void> {
  busy.value = true;
  try {
    state.value = (await game.report(props.playerId, reason.value, message.value))
      ? 'sent'
      : 'failed';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="report">
    <template v-if="state === 'sent'">
      <p class="good" role="status">{{ t('report.sent') }}</p>
      <button type="button" class="button quiet" @click="emit('close')">
        {{ t('report.close') }}
      </button>
    </template>

    <form v-else @submit.prevent="send">
      <h2>{{ t('report.title', { nickname }) }}</h2>
      <fieldset>
        <legend class="sr-only">{{ t('report.reason') }}</legend>
        <label v-for="value in REPORT_REASONS" :key="value" class="choice">
          <input v-model="reason" type="radio" name="reason" :value="value" />
          <span>{{ t(`report.reasons.${value}`) }}</span>
        </label>
      </fieldset>
      <label for="report-message">{{ t('report.message') }}</label>
      <textarea id="report-message" v-model="message" maxlength="500" rows="3" />
      <p v-if="state === 'failed'" class="error" role="alert">{{ t('report.failed') }}</p>
      <div class="actions">
        <button type="submit" class="button" :disabled="busy">{{ t('report.send') }}</button>
        <button type="button" class="button quiet" @click="emit('close')">
          {{ t('admin.eyesCancel') }}
        </button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.report {
  display: grid;
  gap: var(--space-2);
  margin-top: var(--space-3);
  padding: var(--space-3);
  border-radius: var(--radius);
  background: var(--surface);
  text-align: left;
}
h2 {
  margin: 0;
  font-size: 17px;
}
form {
  display: grid;
  gap: var(--space-2);
}
fieldset {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  border: 0;
}
.choice input {
  position: absolute;
  opacity: 0;
}
.choice span {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  padding: 0 var(--space-3);
  border: 1.5px solid var(--line);
  border-radius: var(--radius);
  cursor: pointer;
}
.choice input:checked + span {
  border-color: var(--ink);
  background: var(--ink);
  color: var(--bg);
}
.choice input:focus-visible + span {
  outline: 3px solid var(--focus);
  outline-offset: 2px;
}
textarea {
  width: 100%;
  padding: var(--space-2);
  border: 1.5px solid var(--line);
  border-radius: var(--radius);
  background: var(--bg);
  font: inherit;
  color: inherit;
  resize: vertical;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
}
</style>
