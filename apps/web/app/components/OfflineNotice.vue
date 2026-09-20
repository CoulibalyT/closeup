<script setup lang="ts">
/**
 * The honest version of an offline screen: this game is other people and a server, so there is
 * nothing to play without a network. The shell loads from the cache, and says so.
 */
const { t } = useI18n();
const online = ref(true);

const update = () => (online.value = navigator.onLine);
onMounted(() => {
  update();
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
});
onBeforeUnmount(() => {
  window.removeEventListener('online', update);
  window.removeEventListener('offline', update);
});
</script>

<template>
  <p v-if="!online" class="offline" role="status">{{ t('offline') }}</p>
</template>

<style scoped>
.offline {
  position: fixed;
  left: 50%;
  bottom: calc(var(--space-3) + env(safe-area-inset-bottom));
  z-index: 10;
  transform: translateX(-50%);
  max-width: min(92vw, 420px);
  padding: var(--space-2) var(--space-4);
  border-radius: var(--radius);
  background: var(--ink);
  color: var(--bg);
  font-size: 15px;
  font-weight: 600;
  text-align: center;
}
</style>
