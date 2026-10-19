<script setup lang="ts">
/** The time left in a round, as a thin bar across a controller: the image is on the TV. */
const props = defineProps<{ startsAt: number; endsAt: number; serverNow: () => number }>();
const left = ref(1);
let timer: ReturnType<typeof setInterval> | undefined;
function refresh(): void {
  const span = props.endsAt - props.startsAt;
  left.value = span > 0 ? Math.min(1, Math.max(0, (props.endsAt - props.serverNow()) / span)) : 0;
}
onMounted(() => {
  refresh();
  timer = setInterval(refresh, 200);
});
onBeforeUnmount(() => clearInterval(timer));
</script>

<template>
  <div class="time" aria-hidden="true">
    <span :style="{ transform: `scaleX(${left})` }" />
  </div>
</template>

<style scoped>
.time {
  height: 6px;
  background: var(--line);
}
span {
  display: block;
  height: 100%;
  background: var(--accent);
  transform-origin: left;
  transition: transform 0.2s linear;
}
</style>
