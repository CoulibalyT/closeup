<script setup lang="ts">
import { type Crop, type Malus, ROUND, roundValue, type ScoringMode } from '@closeup/shared';

/**
 * The one bold element of the interface: a round lens whose ring is the timer. The server sends
 * discrete crops; each new level arrives scaled up so that it lines up with the previous one,
 * then eases back to its real size, which reads as a continuous zoom-out.
 */
const props = defineProps<{
  crops: Crop[];
  startsAt: number;
  endsAt: number;
  penalty: number;
  scoring: ScoringMode;
  /** How many players already found: what "fixed points" rooms pay depends on it. */
  foundBefore: number;
  /** A blur or a flip thrown by another player. Freeze acts on the input, not on the lens. */
  malus: Malus | null;
  frozen: boolean;
  serverNow: () => number;
  mediaUrl: (path: string) => string;
}>();

const emit = defineEmits<{ value: [points: number] }>();
const { t } = useI18n();

const HOT_MS = 10_000;
const progress = ref(1);
const hot = ref(false);
const shown = ref<Crop | null>(null);
const zooming = ref(false);
let frame = 0;

function tick(): void {
  const now = props.serverNow();
  const left = Math.max(0, props.endsAt - now);
  if (!props.frozen) {
    progress.value = Math.min(1, left / ROUND.durationMs);
    hot.value = left < HOT_MS;
    emit(
      'value',
      roundValue({
        scoring: props.scoring,
        elapsedMs: now - props.startsAt,
        foundBefore: props.foundBefore,
        penalty: props.penalty,
      }),
    );
  }
  frame = requestAnimationFrame(tick);
}

// Swap only once the next crop is decoded, so the lens never flashes empty.
watch(
  () => props.crops.at(-1),
  (next) => {
    if (!next || next.url === shown.value?.url) return;
    const image = new Image();
    image.onload = () => {
      zooming.value = false;
      shown.value = next;
      if (next.scaleFromPrev) requestAnimationFrame(() => (zooming.value = true));
    };
    image.src = props.mediaUrl(next.url);
  },
  { immediate: true },
);

const imageStyle = computed(() => {
  const crop = shown.value;
  if (!crop) return {};
  const from = crop.scaleFromPrev ?? 1;
  return {
    transformOrigin: `${crop.focus.x * 100}% ${crop.focus.y * 100}%`,
    transform: `scale(${zooming.value || !crop.scaleFromPrev ? 1 : from})`,
    transition: zooming.value ? 'transform 0.9s cubic-bezier(0.22, 0.8, 0.2, 1)' : 'none',
  };
});

onMounted(() => (frame = requestAnimationFrame(tick)));
onBeforeUnmount(() => cancelAnimationFrame(frame));
</script>

<template>
  <div class="lens" :class="{ hot }" :style="{ '--p': progress }">
    <div class="glass" :class="malus">
      <img
        v-if="shown"
        :key="shown.url"
        :src="mediaUrl(shown.url)"
        :alt="t('play.lensAlt')"
        :style="imageStyle"
        draggable="false"
      />
    </div>
  </div>
</template>

<style scoped>
.lens {
  --p: 1;
  aspect-ratio: 1;
  padding: 9px;
  border-radius: 50%;
  background: conic-gradient(var(--ring) calc(var(--p) * 360deg), var(--ring-track) 0);
}
.lens.hot {
  --ring: var(--danger);
}
.glass {
  width: 100%;
  height: 100%;
  overflow: hidden;
  border-radius: 50%;
  background: var(--surface);
  transition: rotate 0.35s;
}
/* A malus landing is one of the few things allowed to move. The blur sits on the image, inside
   the clipped glass, so the edge of the lens and the timer ring stay sharp. */
.glass.blur img {
  filter: blur(16px);
}
.glass.flip {
  rotate: 180deg;
}
img {
  display: block;
  width: 100%;
  height: 100%;
  transition: filter 0.25s;
  user-select: none;
  -webkit-user-drag: none;
}
</style>
