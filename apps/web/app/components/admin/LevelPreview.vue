<script setup lang="ts">
import { cropPlan, type ImageSize, type ZoomPointGeometry } from '@closeup/shared';

/**
 * The four zoom levels of one point, as players will see them. Drawn with the very function the
 * worker cuts the real crops with (`cropPlan`), from the image already loaded: no request, so it
 * follows the point while it is being dragged.
 */
const props = defineProps<{ src: string; image: ImageSize; point: ZoomPointGeometry }>();
const { t } = useI18n();

// Where to put the background so that `offset` is the first visible pixel.
const position = (offset: number, room: number) => (room <= 0 ? 0 : (offset / room) * 100);

const levels = computed(() =>
  cropPlan(props.image, props.point).map((crop) => ({
    level: crop.level,
    side: crop.side,
    style: {
      backgroundImage: `url(${props.src})`,
      backgroundSize: `${(props.image.width / crop.side) * 100}% ${(props.image.height / crop.side) * 100}%`,
      backgroundPosition: `${position(crop.left, props.image.width - crop.side)}% ${position(crop.top, props.image.height - crop.side)}%`,
    },
  })),
);
</script>

<template>
  <ol class="levels">
    <li v-for="item in levels" :key="item.level">
      <div
        class="glass"
        :style="item.style"
        role="img"
        :aria-label="t('admin.level', { n: item.level + 1 })"
      />
      <small class="muted">
        {{ t('admin.level', { n: item.level + 1 }) }}
        <template v-if="item.level === 3"> · {{ t('play.bonusFrame') }}</template>
        <br />{{ item.side }} px
      </small>
    </li>
  </ol>
</template>

<style scoped>
.levels {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--space-3);
  margin: 0;
  padding: 0;
  list-style: none;
  text-align: center;
}
/* Round, like the lens it will be shown in. */
.glass {
  aspect-ratio: 1;
  border: 3px solid var(--ring);
  border-radius: 50%;
  background-color: var(--bg);
  background-repeat: no-repeat;
}
small {
  display: block;
  margin-top: var(--space-1);
  font-size: 12px;
  line-height: 1.3;
}
</style>
