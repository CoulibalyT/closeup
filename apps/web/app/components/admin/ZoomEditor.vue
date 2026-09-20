<script setup lang="ts">
import {
  type ImageSize,
  type Point,
  ZOOM,
  ZOOM_POINTS,
  type ZoomPointInput,
  type ZoomPointProposal,
} from '@closeup/shared';

/**
 * The picture with its zoom points on top. Everything is in pixels of the stored original: the
 * SVG overlay uses the image size as its viewBox, so a click only needs one proportion.
 *   click the picture  → a new point        drag a point → move it
 *   click a dashed one → accept a proposal  arrow keys   → nudge the selected point
 */
const props = defineProps<{
  src: string;
  image: ImageSize;
  points: ZoomPointInput[];
  selected: number;
  proposals: ZoomPointProposal[];
  /** The next two clicks are the eyes of a face, not new points. */
  eyesMode: boolean;
  defaultRadius: number;
}>();
const emit = defineEmits<{
  'update:points': [points: ZoomPointInput[]];
  'update:selected': [index: number];
  eyes: [first: Point, second: Point];
}>();
const { t } = useI18n();

const frame = ref<HTMLElement | null>(null);
/** How many original pixels one screen pixel is worth: keeps handles the same size on screen. */
const unit = ref(1);
let observer: ResizeObserver | undefined;
onMounted(() => {
  observer = new ResizeObserver(([entry]) => {
    if (entry?.contentRect.width) unit.value = props.image.width / entry.contentRect.width;
  });
  if (frame.value) observer.observe(frame.value);
});
onBeforeUnmount(() => observer?.disconnect());

const clamp = (value: number, max: number) => Math.round(Math.min(max, Math.max(0, value)));
function toImage(event: PointerEvent): Point {
  const box = frame.value!.getBoundingClientRect();
  return {
    x: clamp(((event.clientX - box.left) / box.width) * props.image.width, props.image.width),
    y: clamp(((event.clientY - box.top) / box.height) * props.image.height, props.image.height),
  };
}

const full = computed(() => props.points.length >= ZOOM_POINTS.max);
const firstEye = ref<Point | null>(null);
watch(
  () => props.eyesMode,
  () => (firstEye.value = null),
);

function onEmptyClick(event: PointerEvent): void {
  const at = toImage(event);
  if (props.eyesMode) {
    if (!firstEye.value) firstEye.value = at;
    else {
      emit('eyes', firstEye.value, at);
      firstEye.value = null;
    }
    return;
  }
  if (full.value) return;
  const point: ZoomPointInput = {
    ...at,
    baseRadius: props.defaultRadius,
    labelFr: '',
    labelEn: '',
    weight: 1,
    origin: 'MANUAL',
  };
  emit('update:points', [...props.points, point]);
  emit('update:selected', props.points.length);
}

function accept(proposal: ZoomPointProposal): void {
  if (full.value) return;
  const { x, y, baseRadius, labelFr, labelEn, weight } = proposal;
  const point: ZoomPointInput = { x, y, baseRadius, labelFr, labelEn, weight, origin: 'AUTO' };
  emit('update:points', [...props.points, point]);
  emit('update:selected', props.points.length);
}

let dragging = -1;
function startDrag(index: number, event: PointerEvent): void {
  if (props.eyesMode) return onEmptyClick(event);
  dragging = index;
  emit('update:selected', index);
  (event.currentTarget as Element).setPointerCapture(event.pointerId);
}
function move(index: number, to: Point): void {
  // Moved by hand: no longer what the detector said.
  emit(
    'update:points',
    props.points.map((point, i) => (i === index ? { ...point, ...to, origin: 'MANUAL' } : point)),
  );
}
function onDrag(event: PointerEvent): void {
  if (dragging !== -1) move(dragging, toImage(event));
}
const endDrag = () => (dragging = -1);

function onKey(event: KeyboardEvent): void {
  const point = props.points[props.selected];
  const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[
    event.key
  ];
  if (!point || !step) return;
  event.preventDefault();
  const size = (event.shiftKey ? 10 : 2) * unit.value;
  move(props.selected, {
    x: clamp(point.x + step[0]! * size, props.image.width),
    y: clamp(point.y + step[1]! * size, props.image.height),
  });
}

// What a player sees first (level 1) and the widest view (level 4), as in the game.
const first = (point: ZoomPointInput) => point.baseRadius * ZOOM.levelMultipliers[0]!;
const widest = (point: ZoomPointInput) => point.baseRadius * ZOOM.levelMultipliers[ZOOM.maxLevel]!;
</script>

<template>
  <div
    ref="frame"
    class="frame"
    :class="{ eyes: eyesMode, full }"
    :style="{ '--aspect': image.width / image.height }"
    tabindex="0"
    :aria-label="t('admin.editorLabel')"
    @pointerdown="onEmptyClick"
    @keydown="onKey"
  >
    <img :src="src" alt="" draggable="false" />
    <svg :viewBox="`0 0 ${image.width} ${image.height}`" preserveAspectRatio="none">
      <g v-for="proposal in proposals" :key="proposal.zone" class="proposal">
        <circle
          :cx="proposal.x"
          :cy="proposal.y"
          :r="proposal.baseRadius * ZOOM.levelMultipliers[0]!"
          @pointerdown.stop="accept(proposal)"
        />
      </g>

      <g v-for="(point, index) in points" :key="index" :class="{ on: index === selected }">
        <rect
          v-if="index === selected"
          class="widest"
          :x="point.x - widest(point)"
          :y="point.y - widest(point)"
          :width="widest(point) * 2"
          :height="widest(point) * 2"
        />
        <circle class="halo" :cx="point.x" :cy="point.y" :r="first(point)" />
        <circle
          class="mark"
          :cx="point.x"
          :cy="point.y"
          :r="first(point)"
          @pointerdown.stop="startDrag(index, $event)"
          @pointermove="onDrag"
          @pointerup="endDrag"
          @pointercancel="endDrag"
        />
        <circle class="dot" :cx="point.x" :cy="point.y" :r="4 * unit" />
        <text :x="point.x" :y="point.y - first(point) - 6 * unit" :font-size="15 * unit">
          {{ index + 1 }}
        </text>
      </g>

      <circle v-if="firstEye" class="dot eye" :cx="firstEye.x" :cy="firstEye.y" :r="6 * unit" />
    </svg>
  </div>
</template>

<style scoped>
.frame {
  position: relative;
  /* A tall portrait must not push the preview of its levels off the screen. */
  width: min(100%, calc(72vh * var(--aspect, 1)));
  margin: 0 auto;
  border-radius: var(--radius);
  background: var(--surface);
  line-height: 0;
  cursor: crosshair;
  touch-action: none;
  user-select: none;
}
.frame.full:not(.eyes) {
  cursor: default;
}
img {
  width: 100%;
  border-radius: var(--radius);
  -webkit-user-drag: none;
}
svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
}
circle,
rect {
  fill: none;
  vector-effect: non-scaling-stroke;
}
.halo {
  stroke: #ffffff;
  stroke-width: 6;
  pointer-events: none;
}
.mark {
  fill: transparent;
  stroke: var(--muted);
  stroke-width: 3;
  cursor: grab;
}
.on .mark {
  stroke: var(--accent);
}
.widest {
  stroke: var(--accent);
  stroke-width: 1.5;
  stroke-dasharray: 6 5;
  pointer-events: none;
}
.dot {
  fill: #ffffff;
  stroke: var(--ink);
  stroke-width: 1.5;
  pointer-events: none;
}
.dot.eye {
  fill: var(--accent);
}
.proposal circle {
  fill: transparent;
  stroke: var(--good);
  stroke-width: 2.5;
  stroke-dasharray: 5 4;
  cursor: copy;
}
text {
  fill: #ffffff;
  stroke: var(--ink);
  stroke-width: 3;
  paint-order: stroke;
  font-family: var(--font-text);
  font-weight: 700;
  text-anchor: middle;
  pointer-events: none;
}
</style>
