<script setup lang="ts">
import type { RoundHint } from '@closeup/shared';

/** The room's hint, on a phone or the shared screen: the written hint, or category and initials. */
defineProps<{ hint: RoundHint }>();
const { t } = useI18n();
</script>

<template>
  <p class="room-hint" role="status">
    <span class="label">{{ t('play.hint') }}</span>
    <template v-if="hint.text">{{ hint.text }}</template>
    <template v-else>
      <template v-if="hint.category">{{ t(`category.${hint.category}`) }} · </template>
      <span v-if="hint.initials" class="initials">{{ hint.initials }}</span>
    </template>
  </p>
</template>

<style scoped>
.room-hint {
  margin: var(--space-2) 0;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius);
  background: var(--surface);
  font-weight: 600;
}
.label {
  margin-right: var(--space-2);
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--accent);
}
/* The masked letters must read as letters to come: a plain face, spaced out. */
.initials {
  font-family: ui-monospace, monospace;
  letter-spacing: 0.2em;
  white-space: pre;
}
</style>
