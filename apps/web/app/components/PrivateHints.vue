<script setup lang="ts">
/**
 * On a controller, what this player's own bonuses revealed, seen by nobody else: the wider view
 * a zoom-out bought, the other zone, the initials, the category.
 */
const { t } = useI18n();
const game = useGameStore();
// A controller only ever receives the crops it paid for: the widest is the last one.
const view = computed(() => game.crops.at(-1)?.url ?? game.hints.secondZone?.url ?? null);
const shown = computed(() => !!(view.value || game.hints.initials || game.hints.category));
</script>

<template>
  <aside v-if="shown" class="private">
    <img v-if="view" :src="game.mediaUrl(view)" :alt="t('play.privateViewAlt')" />
    <div>
      <b>{{ t('play.privateTitle') }}</b>
      <p v-if="game.hints.initials" class="display initials">{{ game.hints.initials }}</p>
      <p v-if="game.hints.category">
        {{ t('play.categoryHint', { category: t(`category.${game.hints.category}`) }) }}
      </p>
    </div>
  </aside>
</template>

<style scoped>
.private {
  display: flex;
  gap: var(--space-3);
  align-items: center;
  margin: 0 var(--space-3);
  padding: var(--space-2) var(--space-3);
  border: 1.5px dashed var(--accent);
  border-radius: var(--radius);
  background: var(--surface);
  font-size: 14px;
}
img {
  flex: none;
  width: 64px;
  height: 64px;
  border: 2px solid var(--accent);
  border-radius: 50%;
  object-fit: cover;
}
b {
  color: var(--accent);
}
p {
  margin: 2px 0 0;
}
.initials {
  font-size: 18px;
  letter-spacing: 0.08em;
}
</style>
