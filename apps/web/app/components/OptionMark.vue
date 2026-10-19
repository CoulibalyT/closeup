<script setup lang="ts">
/**
 * The shape of an option's position, shared by the big screen and the phones: a player matches
 * the button in their hand to the answer on the TV at a glance. Decorative: the label says it.
 */
defineProps<{ index: number }>();
</script>

<template>
  <span class="mark" :class="`at-${index % 4}`" aria-hidden="true" />
</template>

<style scoped>
.mark {
  display: inline-block;
  flex: none;
  width: var(--mark-size, 1em);
  height: var(--mark-size, 1em);
  background: #ffffff;
}
/* Triangle, diamond, circle, square. */
.at-0 {
  clip-path: polygon(50% 0, 100% 100%, 0 100%);
}
.at-1 {
  clip-path: polygon(50% 0, 100% 50%, 50% 100%, 0 50%);
}
.at-2 {
  border-radius: 50%;
}
.at-3 {
  border-radius: 12%;
}
</style>
