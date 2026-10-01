<script setup lang="ts">
import type { McqOption } from '@closeup/shared';

const props = defineProps<{
  options: McqOption[];
  wrongIds: string[];
  /** Taken off the table by the "remove two options" bonus. */
  removedIds: string[];
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
        :class="{
          wrong: wrongIds.includes(option.id),
          removed: removedIds.includes(option.id),
        }"
        :disabled="
          disabled || lockLeft > 0 || wrongIds.includes(option.id) || removedIds.includes(option.id)
        "
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
button.removed {
  text-decoration: line-through;
  opacity: 0.35;
}
button.wrong {
  border-color: var(--danger);
  color: var(--danger);
  text-decoration: line-through;
  opacity: 1;
}

/* Computer: one answer per line, lettered A to D, in the column beside the lens. */
@media (min-width: 1080px) {
  .choices {
    padding: 0;
    background: none;
  }
  .grid {
    grid-template-columns: minmax(0, 1fr);
    counter-reset: choice;
  }
  button {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    min-height: 64px;
    padding: var(--space-2) var(--space-4);
    background: var(--surface);
    font-size: 19px;
    text-align: left;
    counter-increment: choice;
  }
  button::before {
    content: counter(choice, upper-alpha);
    color: var(--accent);
    font: 800 17px/1 var(--font-display);
    font-stretch: 140%;
  }
}
</style>
