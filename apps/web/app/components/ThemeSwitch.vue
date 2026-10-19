<script setup lang="ts">
/**
 * A small button that opens the four themes. Kept apart from the account: a guest chooses too,
 * and the choice stays on the device.
 */
const { t } = useI18n();
const { theme, setTheme } = useTheme();
const open = ref(false);
const root = ref<HTMLElement | null>(null);

function choose(next: Theme): void {
  setTheme(next);
  open.value = false;
}
function onOutside(event: PointerEvent): void {
  if (open.value && root.value && !root.value.contains(event.target as Node)) open.value = false;
}
function onKey(event: KeyboardEvent): void {
  if (event.key === 'Escape') open.value = false;
}
onMounted(() => {
  document.addEventListener('pointerdown', onOutside);
  document.addEventListener('keydown', onKey);
});
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onOutside);
  document.removeEventListener('keydown', onKey);
});
</script>

<template>
  <div ref="root" class="theme-switch">
    <button
      type="button"
      class="toggle"
      :aria-expanded="open"
      :aria-label="t('theme.label')"
      :title="t('theme.label')"
      @click="open = !open"
    >
      <span class="dot" aria-hidden="true" />
    </button>
    <ul v-if="open" class="menu" role="menu">
      <li v-for="option in THEMES" :key="option" role="none">
        <button
          type="button"
          role="menuitemradio"
          :aria-checked="theme === option"
          :class="['option', option]"
          @click="choose(option)"
        >
          <span class="swatch" aria-hidden="true" />
          {{ t(`theme.${option}`) }}
        </button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.theme-switch {
  position: relative;
  display: inline-flex;
}
.toggle {
  display: inline-grid;
  place-items: center;
  width: 44px;
  height: 44px;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  cursor: pointer;
}
/* Half the current background, half its ink: reads as "colours" in every theme. */
.dot {
  width: 20px;
  height: 20px;
  border: 2px solid currentColor;
  border-radius: 50%;
  background: linear-gradient(90deg, currentColor 50%, transparent 50%);
}
.menu {
  position: absolute;
  top: 100%;
  right: 0;
  z-index: 20;
  display: grid;
  min-width: 168px;
  margin: 0;
  padding: var(--space-1);
  border: 1.5px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
  box-shadow: 0 8px 24px rgb(0 0 0 / 14%);
  list-style: none;
}
.option {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  min-height: 44px;
  padding: 0 var(--space-3);
  border: 0;
  border-radius: var(--radius);
  background: none;
  color: var(--ink);
  font: inherit;
  font-size: 15px;
  text-align: left;
  cursor: pointer;
}
.option:hover,
.option[aria-checked='true'] {
  background: var(--bg);
}
.option[aria-checked='true'] {
  font-weight: 700;
}
.swatch {
  width: 16px;
  height: 16px;
  border: 1.5px solid var(--line);
  border-radius: 50%;
}
.auto .swatch {
  background: linear-gradient(90deg, #e9edf3 50%, #0c1130 50%);
}
.light .swatch {
  background: #e9edf3;
}
.rose .swatch {
  background: #f6e8ea;
  border-color: #a93d65;
}
.dark .swatch {
  background: #0c1130;
}
</style>
