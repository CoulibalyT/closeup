<script setup lang="ts">
import { type Crop, ZOOM } from '@closeup/shared';

/**
 * The photo-booth strip is the zoom indicator: one frame per level, developing as the levels
 * unlock. The last frame only exists with a bonus (phase 3), so it stays an empty dashed frame.
 */
const props = defineProps<{ crops: Crop[]; mediaUrl: (path: string) => string }>();
const { t } = useI18n();

const frames = computed(() =>
  Array.from({ length: ZOOM.maxLevel + 1 }, (_, level) => ({
    level,
    crop: props.crops.find((crop) => crop.level === level),
    bonusOnly: level === ZOOM.maxLevel,
  })),
);
</script>

<template>
  <ol class="strip" :aria-label="t('play.stripLabel')">
    <li
      v-for="frame in frames"
      :key="frame.level"
      :class="{ on: frame.crop, locked: frame.bonusOnly && !frame.crop }"
    >
      <img v-if="frame.crop" :src="mediaUrl(frame.crop.url)" alt="" draggable="false" />
      <span v-else-if="frame.bonusOnly">{{ t('play.bonusFrame') }}</span>
    </li>
  </ol>
</template>

<style scoped>
.strip {
  display: grid;
  /* Its own height: as a grid item it would otherwise stretch and spread its frames apart. */
  align-self: start;
  gap: 5px;
  margin: 0;
  padding: 5px;
  list-style: none;
  border-radius: var(--radius);
  background: var(--surface);
}
li {
  position: relative;
  aspect-ratio: 1;
  overflow: hidden;
  border-radius: 2px;
  background: var(--line);
}
li.locked {
  background: transparent;
  outline: 1.5px dashed var(--muted);
  outline-offset: -2px;
}
li span {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 2px;
  font-size: 10px;
  line-height: 1.1;
  text-align: center;
  color: var(--muted);
}
img {
  display: block;
  width: 100%;
  height: 100%;
  animation: develop 1.4s ease both;
}
/* A frame "develops" like a print: the one moment of motion a new level gets. */
@keyframes develop {
  from {
    opacity: 0;
    filter: saturate(0) contrast(0.6);
  }
}
</style>
