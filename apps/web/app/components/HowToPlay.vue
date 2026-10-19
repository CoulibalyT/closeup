<script setup lang="ts">
import { BONUS, MALUSES, SCORING, SELF_BONUSES, STEALS } from '@closeup/shared';

/**
 * How a game goes, and what the bonuses do, before a first game. `steps`: three screens a phone
 * swipes through. `board`: one page for the shared screen, read from the sofa while people join.
 * The rules quoted come from the game's own constants, so the page cannot drift from them.
 */
const props = withDefaults(defineProps<{ layout?: 'steps' | 'board' }>(), { layout: 'steps' });
const emit = defineEmits<{ done: [] }>();
const { t } = useI18n();

const helpers = SELF_BONUSES;
const attacks = [...MALUSES, ...STEALS];
const rules = {
  start: SCORING.startValue,
  end: SCORING.endValue,
  streak: BONUS.streakLength,
  players: BONUS.minPlayersForFastest,
  cap: BONUS.inventoryCap,
};

const step = ref(0);
const last = 2;
function next(): void {
  if (step.value < last) step.value += 1;
  else emit('done');
}

// A swipe moves between the screens, like any carousel on a phone.
let touchX: number | null = null;
function touchStart(event: TouchEvent): void {
  touchX = event.touches[0]?.clientX ?? null;
}
function touchEnd(event: TouchEvent): void {
  if (touchX === null) return;
  const dx = (event.changedTouches[0]?.clientX ?? touchX) - touchX;
  touchX = null;
  if (dx < -40 && step.value < last) step.value += 1;
  if (dx > 40 && step.value > 0) step.value -= 1;
}

const heading = ref<HTMLElement | null>(null);
watch(step, () => nextTick(() => heading.value?.focus()));
onMounted(() => props.layout === 'steps' && heading.value?.focus());
</script>

<template>
  <section
    v-if="layout === 'steps'"
    class="howto steps"
    @touchstart="touchStart"
    @touchend="touchEnd"
  >
    <button type="button" class="link skip" @click="emit('done')">{{ t('howto.skip') }}</button>

    <div v-if="step === 0" class="slide">
      <h2 ref="heading" class="display" tabindex="-1">{{ t('howto.find.title') }}</h2>
      <p class="muted">{{ t('howto.find.text') }}</p>
      <div class="lens" role="img" :aria-label="t('howto.find.alt')">
        <span class="photo" />
        <span class="found">{{ t('howto.find.found') }}</span>
      </div>
      <p class="points display">{{ rules.start }} → {{ rules.end }}</p>
      <p class="muted center">{{ t('howto.find.points') }}</p>
    </div>

    <div v-else-if="step === 1" class="slide">
      <h2 ref="heading" class="display" tabindex="-1">{{ t('howto.earn.title') }}</h2>
      <p class="muted">{{ t('howto.earn.text', { cap: rules.cap }) }}</p>
      <ul class="plain earn">
        <li>
          <span class="badge" aria-hidden="true">🔥</span>
          <span>
            <b>{{ t('howto.earn.streak', { n: rules.streak }) }}</b>
            {{ t('howto.earn.streakHint') }}
          </span>
        </li>
        <li>
          <span class="badge" aria-hidden="true">⚡</span>
          <span>
            <b>{{ t('howto.earn.fastest') }}</b>
            {{ t('howto.earn.fastestHint', { n: rules.players }) }}
          </span>
        </li>
        <li>
          <span class="badge" aria-hidden="true">🤝</span>
          <span>
            <b>{{ t('howto.earn.catchUp') }}</b>
            {{ t('howto.earn.catchUpHint') }}
          </span>
        </li>
      </ul>
      <p class="muted">{{ t('howto.earn.never') }}</p>
    </div>

    <div v-else class="slide">
      <h2 ref="heading" class="display" tabindex="-1">{{ t('howto.use.title') }}</h2>
      <p class="family">{{ t('howto.use.help') }}</p>
      <ul class="plain bonuses">
        <li v-for="type in helpers" :key="type">
          <BonusIcon :type="type" />
          {{ t(`bonus.name.${type}`) }}
        </li>
      </ul>
      <p class="family attack">{{ t('howto.use.attack') }}</p>
      <ul class="plain bonuses">
        <li v-for="type in attacks" :key="type" class="attack">
          <BonusIcon :type="type" />
          {{ t(`bonus.name.${type}`) }}
        </li>
      </ul>
    </div>

    <div class="foot">
      <ol class="dots" :aria-label="t('howto.progress', { n: step + 1, total: last + 1 })">
        <li v-for="n in last + 1" :key="n" :class="{ on: n - 1 === step }" />
      </ol>
      <button type="button" class="button" @click="next">
        {{ t(step === last ? 'howto.go' : 'howto.next') }}
      </button>
    </div>
  </section>

  <section v-else class="howto board">
    <h2 class="display">{{ t('howto.board.title') }}</h2>
    <p>
      {{
        t('howto.board.text', {
          start: rules.start,
          end: rules.end,
          streak: rules.streak,
        })
      }}
    </p>
    <p class="family">{{ t('howto.use.help') }}</p>
    <ul class="plain bonuses">
      <li v-for="type in helpers" :key="type">
        <BonusIcon :type="type" />
        {{ t(`bonus.name.${type}`) }}
      </li>
    </ul>
    <p class="family attack">{{ t('howto.use.attack') }}</p>
    <ul class="plain bonuses">
      <li v-for="type in attacks" :key="type" class="attack">
        <BonusIcon :type="type" />
        {{ t(`bonus.name.${type}`) }}
      </li>
    </ul>
  </section>
</template>

<style scoped>
.howto h2 {
  margin: 0 0 var(--space-2);
  outline: none;
}
.steps {
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: min(640px, 100%);
  gap: var(--space-2);
}
.skip {
  align-self: flex-end;
  min-height: var(--tap);
  border: 0;
  background: none;
  color: var(--muted);
  font: inherit;
  text-decoration: underline;
  cursor: pointer;
}
.plain {
  margin: 0;
  padding: 0;
  list-style: none;
}
.slide {
  flex: 1;
}
.center {
  text-align: center;
}
.lens {
  position: relative;
  width: min(220px, 60vw);
  aspect-ratio: 1;
  margin: var(--space-3) auto;
  overflow: hidden;
  border: 6px solid var(--accent);
  border-radius: 50%;
  background: #bfe3d0;
}
.photo {
  position: absolute;
  inset: 0;
  background: url('/howto/cat.svg') center / cover;
  transform-origin: 38% 53%;
  animation: unzoom 6s ease-in-out infinite;
}
.found {
  position: absolute;
  bottom: 10px;
  left: 50%;
  padding: 3px 10px;
  border-radius: 20px;
  background: var(--good);
  color: #ffffff;
  font-weight: 700;
  font-size: 14px;
  opacity: 0;
  translate: -50% 0;
  animation: found 6s infinite;
}
.points {
  margin: 0;
  font-size: 34px;
  text-align: center;
}
.earn {
  display: grid;
  gap: var(--space-2);
  margin: var(--space-3) 0;
}
.earn li {
  display: flex;
  gap: var(--space-3);
  align-items: center;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
}
.earn b {
  display: block;
}
.badge {
  display: grid;
  flex: none;
  place-items: center;
  width: 42px;
  height: 42px;
  border-radius: 12px;
  background: color-mix(in srgb, var(--accent) 16%, var(--surface));
  font-size: 22px;
}
.family {
  margin: var(--space-3) 0 var(--space-2);
  color: var(--muted);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.family.attack {
  color: var(--danger);
}
.bonuses {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-2);
}
.bonuses li {
  display: grid;
  gap: 4px;
  justify-items: center;
  padding: var(--space-2) 4px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
  font-size: 13px;
  font-weight: 600;
  text-align: center;
}
.bonuses li.attack {
  border-color: color-mix(in srgb, var(--danger) 30%, var(--line));
}
.foot {
  display: grid;
  gap: var(--space-3);
}
.dots {
  display: flex;
  justify-content: center;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.dots li {
  width: 8px;
  height: 8px;
  border-radius: 4px;
  background: var(--line);
  transition: width 0.2s;
}
.dots li.on {
  width: 22px;
  background: var(--accent);
}

/* The shared screen: read from across the room, every bonus at once. */
.board {
  --icon-size: clamp(44px, 6vmin, 76px);
  font-size: clamp(15px, 1.9vmin, 24px);
}
.board h2 {
  font-size: 1.8em;
}
.board .bonuses {
  grid-template-columns: repeat(auto-fill, minmax(clamp(96px, 12vmin, 150px), 1fr));
}
.board .bonuses li,
.board .family {
  font-size: 0.8em;
}

@keyframes unzoom {
  0%,
  15% {
    transform: scale(4.2);
  }
  35% {
    transform: scale(2.4);
  }
  55% {
    transform: scale(1.35);
  }
  75%,
  100% {
    transform: scale(1);
  }
}
@keyframes found {
  0%,
  80%,
  100% {
    opacity: 0;
  }
  86%,
  97% {
    opacity: 1;
  }
}
@media (prefers-reduced-motion: reduce) {
  .photo,
  .found {
    animation: none;
  }
  .found {
    opacity: 1;
  }
}
</style>
