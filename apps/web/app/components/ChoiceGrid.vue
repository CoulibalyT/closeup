<script setup lang="ts">
import type { McqOption } from '@closeup/shared';

const props = defineProps<{
  options: McqOption[];
  wrongIds: string[];
  lockedUntil: number | null;
  disabled: boolean;
  serverNow: () => number;
}>();
const emit = defineEmits<{ pick: [optionId: string] }>();
const { t } = useI18n();

// A wrong pick locks every option for a few seconds; the countdown says for how long.
const lockLeft = ref(0);
let timer: ReturnType<typeof setInterval> | undefined;

function refresh(): void {
  lockLeft.value = props.lockedUntil ? Math.max(0, props.lockedUntil - props.serverNow()) : 0;
}

onMounted(() => (timer = setInterval(refresh, 100)));
onBeforeUnmount(() => clearInterval(timer));
watch(() => props.lockedUntil, refresh);
</script>

<template>
  <div class="choices">
    <p class="hint" role="status">
      <template v-if="lockLeft > 0">
        {{ t('play.locked', { seconds: Math.ceil(lockLeft / 1000) }) }}
      </template>
    </p>
    <div class="grid">
      <button
        v-for="option in options"
        :key="option.id"
        type="button"
        :class="{ wrong: wrongIds.includes(option.id) }"
        :disabled="disabled || lockLeft > 0 || wrongIds.includes(option.id)"
        @click="emit('pick', option.id)"
      >
        {{ option.label }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.choices {
  padding: var(--space-2) var(--space-3) calc(var(--space-3) + env(safe-area-inset-bottom));
  background: var(--surface);
}
.hint {
  min-height: 1.45em;
  margin: 0 0 var(--space-1);
  font-size: 15px;
  color: var(--danger);
}
.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-2);
}
button {
  min-height: 56px;
  padding: var(--space-2) var(--space-3);
  border: 1.5px solid var(--line);
  border-radius: var(--radius);
  background: var(--bg);
  font-weight: 600;
  line-height: 1.2;
  cursor: pointer;
}
button:disabled {
  opacity: 0.55;
  cursor: default;
}
button.wrong {
  border-color: var(--danger);
  color: var(--danger);
  text-decoration: line-through;
  opacity: 1;
}
</style>
