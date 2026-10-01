<script setup lang="ts">
import type { Crop, RoundEnd } from '@closeup/shared';

const props = defineProps<{
  reveal: RoundEnd;
  /** The viewer's player id. */
  you: string;
  /** Whether the viewer decides when to move on (the host, or a solo player). */
  canSkip: boolean;
  /** Several players: show who scored what, and the countdown to the next round. */
  party: boolean;
  crops: Crop[];
  serverNow: () => number;
  mediaUrl: (path: string) => string;
}>();
defineEmits<{ next: [] }>();
const { t } = useI18n();

const gains = computed(() =>
  Object.fromEntries(props.reveal.results.map((result) => [result.playerId, result.points])),
);
const yourPoints = computed(() => gains.value[props.you] ?? 0);
// Someone who joined mid-round has no line in the results: neither found nor missed.
const played = computed(() => props.reveal.results.some((r) => r.playerId === props.you));

// The circle marks what the first zoom level showed. `r` is a fraction of the image width.
const zone = computed(() => {
  const { cx, cy, r } = props.reveal.reveal.zone;
  return { cx: cx * 100, cy: cy * 100, r: r * 100 };
});

const secondsLeft = ref(0);
let timer: ReturnType<typeof setInterval> | undefined;
function refresh(): void {
  const { nextAt } = props.reveal;
  secondsLeft.value = nextAt ? Math.max(0, Math.ceil((nextAt - props.serverNow()) / 1000)) : 0;
}
onMounted(() => {
  refresh();
  timer = setInterval(refresh, 250);
});
onBeforeUnmount(() => clearInterval(timer));
</script>

<template>
  <section class="reveal">
    <h1 class="display verdict" :class="{ found: yourPoints > 0 }">
      <template v-if="yourPoints > 0">{{ t('reveal.found', { points: yourPoints }) }}</template>
      <template v-else-if="played">{{ t('reveal.missed') }}</template>
      <template v-else>{{ t('reveal.watched') }}</template>
    </h1>
    <p class="answer">{{ t('reveal.answer', { answer: reveal.reveal.answer }) }}</p>
    <p v-if="reveal.reveal.zoneLabel" class="muted zone">
      {{ t('reveal.zone', { zone: reveal.reveal.zoneLabel }) }}
    </p>

    <div class="print" :class="{ party }">
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
          <CreditLine
            :author="reveal.reveal.credit.author"
            :licence="reveal.reveal.credit.licence"
          />
        </figcaption>
      </figure>
    </div>

    <RankingList v-if="party" class="scores" :players="reveal.ranking" :you="you" :gains="gains" />

    <div class="foot">
      <p v-if="party && secondsLeft > 0" class="muted">
        {{
          reveal.isLast
            ? t('reveal.resultIn', { seconds: secondsLeft })
            : t('reveal.nextIn', { seconds: secondsLeft })
        }}
      </p>
      <button v-if="canSkip" type="button" class="button" @click="$emit('next')">
        {{ reveal.isLast ? t('reveal.seeResult') : t('reveal.next') }}
      </button>
    </div>
  </section>
</template>

<style scoped>
.reveal {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  padding: var(--space-4) var(--space-4) calc(var(--space-4) + env(safe-area-inset-bottom));
  overflow-y: auto;
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
/* With a ranking to fit underneath, the photo gives up some room. */
.print.party {
  max-width: 300px;
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
.scores {
  margin-top: var(--space-4);
  font-size: 17px;
}
.foot {
  display: grid;
  gap: var(--space-2);
  margin-top: auto;
  padding-top: var(--space-4);
}

/* Computer: in the cabin, the complete strip on the curtain, the whole photo in the middle, and
   the verdict, the answer, the scores and the button in the column on the right. The custom
   properties come from the play page. Same breakpoint as useWideScreen. */
@media (min-width: 1080px) {
  .reveal {
    display: grid;
    grid-template-columns: var(--panel, 21vw) minmax(0, 1fr) var(--side, 400px);
    grid-template-rows: auto auto auto minmax(0, 1fr) auto;
    grid-template-areas:
      'strip print verdict'
      'strip print answer'
      'strip print zone'
      'strip print scores'
      'strip print foot';
    column-gap: var(--gutter, 48px);
    padding: var(--space-6) var(--gutter, 48px) var(--space-10) 0;
  }
  .print,
  .print.party {
    display: contents;
  }
  .strip {
    grid-area: strip;
    align-self: center;
    justify-self: center;
    width: min(var(--panel, 21vw) * 0.5, (var(--viewport-height) - 220px) / 4);
  }
  figure {
    grid-area: print;
    align-self: center;
    justify-self: center;
    min-width: 0;
  }
  /* The photo shrinks to fit the height, and the box around it shrinks with it: the circle
     that marks the zone is drawn over that box, so the two must stay the same size. */
  .photo {
    width: fit-content;
    max-width: 100%;
  }
  .photo img {
    width: auto;
    max-width: 100%;
    max-height: calc(var(--viewport-height) - 170px);
  }
  /* "terminée" is the longest word a verdict holds: about 8.6 em of column per em of type. */
  .verdict {
    grid-area: verdict;
    font-size: calc(var(--side, 400px) / 8.6);
  }
  .answer {
    grid-area: answer;
    font-size: 26px;
  }
  .zone {
    grid-area: zone;
  }
  .scores {
    grid-area: scores;
    margin-top: var(--space-6);
    overflow-y: auto;
  }
  .foot {
    grid-area: foot;
    margin-top: 0;
  }
  .foot .button {
    min-height: 64px;
    font-size: 19px;
  }
}
</style>
