<script setup lang="ts">
import { type Crop, ZOOM } from '@closeup/shared';

/**
 * The photo-booth strip is the zoom indicator: one frame per level, developing as the levels
 * unlock, by the clock or sooner with the "zoom out" bonus.
 */
const props = defineProps<{ crops: Crop[]; mediaUrl: (path: string) => string }>();
const { t } = useI18n();

const frames = computed(() =>
  Array.from({ length: ZOOM.maxLevel + 1 }, (_, level) => ({
    level,
    crop: props.crops.find((crop) => crop.level === level),
  })),
);
</script>

<template>
  <ol class="strip" :aria-label="t('play.stripLabel')">
    <li v-for="frame in frames" :key="frame.level" :class="{ on: frame.crop }">
      <img v-if="frame.crop" :src="mediaUrl(frame.crop.url)" alt="" draggable="false" />
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

/* Computer: the frames are numbered like a booth strip, 01 to 04. Same breakpoint as
   useWideScreen. */
@media (min-width: 1080px) {
  .strip {
    gap: 8px;
    padding: 8px;
    counter-reset: frame;
  }
  li {
    counter-increment: frame;
  }
  li::after {
    content: counter(frame, decimal-leading-zero) / '';
    position: absolute;
    left: 6px;
    bottom: 6px;
    padding: 2px 6px;
    border-radius: 2px;
    background: var(--surface);
    color: var(--ink);
    font: 800 12px/1 var(--font-display);
    font-stretch: 140%;
  }
}
</style>
