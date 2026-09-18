<script setup lang="ts">
import type { Crop, RoundEnd } from '@closeup/shared';

const props = defineProps<{
  reveal: RoundEnd;
  you: number;
  crops: Crop[];
  mediaUrl: (path: string) => string;
}>();
defineEmits<{ next: [] }>();
const { t } = useI18n();

const found = computed(() => props.you > 0);
// The circle marks what the first zoom level showed. `r` is a fraction of the image width.
const zone = computed(() => {
  const { cx, cy, r } = props.reveal.reveal.zone;
  return { cx: cx * 100, cy: cy * 100, r: r * 100 };
});
</script>

<template>
  <section class="reveal">
    <h1 class="display verdict" :class="{ found }">
      {{ found ? t('reveal.found', { points: you }) : t('reveal.missed') }}
    </h1>
    <p class="answer">{{ t('reveal.answer', { answer: reveal.reveal.answer }) }}</p>
    <p v-if="reveal.reveal.zoneLabel" class="muted">
      {{ t('reveal.zone', { zone: reveal.reveal.zoneLabel }) }}
    </p>

    <div class="print">
      <ZoomStrip :crops="crops" :media-url="mediaUrl" />
      <figure>
        <div class="photo">
          <img :src="mediaUrl(reveal.reveal.imageUrl)" :alt="reveal.reveal.answer" />
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <circle :cx="zone.cx" :cy="zone.cy" :r="zone.r" class="halo" />
            <circle :cx="zone.cx" :cy="zone.cy" :r="zone.r" class="mark" />
          </svg>
        </div>
        <figcaption class="muted">
          {{
            t('reveal.credit', {
              author: reveal.reveal.credit.author,
              licence: reveal.reveal.credit.licence,
            })
          }}
        </figcaption>
      </figure>
    </div>

    <button type="button" class="button next" @click="$emit('next')">
      {{ reveal.isLast ? t('reveal.seeResult') : t('reveal.next') }}
    </button>
  </section>
</template>

<style scoped>
.reveal {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  padding: var(--space-4) var(--space-4) calc(var(--space-4) + env(safe-area-inset-bottom));
}
.verdict {
  font-size: clamp(28px, 9vw, 40px);
  color: var(--muted);
}
.verdict.found {
  color: var(--good);
}
.answer {
  margin-top: var(--space-2);
  font-size: 21px;
  font-weight: 600;
}
.print {
  display: grid;
  grid-template-columns: 52px minmax(0, 1fr);
  gap: var(--space-3);
  align-items: start;
  margin-top: var(--space-4);
}
figure {
  margin: 0;
}
.photo {
  position: relative;
  padding: 6px;
  border-radius: var(--radius);
  background: var(--surface);
}
.photo img {
  display: block;
  width: 100%;
  border-radius: 2px;
}
.photo svg {
  position: absolute;
  inset: 6px;
  width: calc(100% - 12px);
  height: calc(100% - 12px);
  overflow: visible;
}
circle {
  fill: none;
  vector-effect: non-scaling-stroke;
}
.halo {
  stroke: #ffffff;
  stroke-width: 7;
}
.mark {
  stroke: var(--accent);
  stroke-width: 3.5;
}
figcaption {
  margin-top: var(--space-2);
  font-size: 13px;
}
.next {
  margin-top: auto;
  width: 100%;
}
</style>
