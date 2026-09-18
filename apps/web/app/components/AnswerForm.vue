<script setup lang="ts">
import { FREE_TEXT } from '@closeup/shared';
import type { Feedback } from '~/stores/game';

const props = defineProps<{ feedback: Feedback; disabled: boolean }>();
const emit = defineEmits<{ guess: [text: string] }>();
const { t } = useI18n();

const text = ref('');
const input = ref<HTMLInputElement>();
const shaking = ref(false);

function submit(): void {
  const value = text.value.trim();
  if (!value || props.disabled) return;
  emit('guess', value);
}

// A wrong guess shakes the field and selects the text, ready to be typed over.
watch(
  () => props.feedback,
  (feedback) => {
    if (!feedback) return;
    shaking.value = false;
    requestAnimationFrame(() => (shaking.value = true));
    input.value?.select();
  },
);
</script>

<template>
  <form class="answer" :class="{ shaking }" @submit.prevent="submit">
    <p class="hint" role="status">
      <template v-if="feedback">{{ t(`play.feedback.${feedback}`) }}</template>
    </p>
    <div class="row">
      <input
        ref="input"
        v-model="text"
        type="text"
        enterkeyhint="send"
        autocomplete="off"
        autocapitalize="off"
        autocorrect="off"
        spellcheck="false"
        :maxlength="FREE_TEXT.maxGuessLength"
        :placeholder="t('play.placeholder')"
        :aria-label="t('play.answerLabel')"
        :disabled="disabled"
      />
      <button type="submit" class="button" :disabled="disabled || !text.trim()">
        {{ t('play.submit') }}
      </button>
    </div>
  </form>
</template>

<style scoped>
.answer {
  padding: var(--space-2) var(--space-3) calc(var(--space-3) + env(safe-area-inset-bottom));
  background: var(--surface);
}
.hint {
  min-height: 1.45em;
  margin: 0 0 var(--space-1);
  font-size: 15px;
  color: var(--danger);
}
.row {
  display: flex;
  gap: var(--space-2);
}
input {
  flex: 1;
  min-width: 0;
  min-height: var(--tap);
  padding: 0 var(--space-4);
  border: 1.5px solid var(--line);
  border-radius: var(--radius);
  background: var(--bg);
  /* 16 px minimum, or iOS Safari zooms the page when the field takes focus. */
  font-size: 17px;
}
input::placeholder {
  color: var(--muted);
}
.shaking .row {
  animation: shake 0.3s;
}
@keyframes shake {
  25% {
    transform: translateX(-6px);
  }
  75% {
    transform: translateX(6px);
  }
}
</style>
