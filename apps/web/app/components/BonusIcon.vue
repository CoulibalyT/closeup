<script setup lang="ts">
import type { BonusType } from '@closeup/shared';

/**
 * A bonus shown by what it does, on a drawing anyone recognises (a cat): it zooms out, blurs,
 * turns upside down, freezes… in a loop. Still frames for those who asked for less motion.
 */
defineProps<{ type: BonusType }>();
const { t } = useI18n();
</script>

<template>
  <span class="icon" :class="`is-${type}`" aria-hidden="true">
    <span
      v-if="
        ['initials', 'category', 'removeTwo', 'shield', 'stealBonus', 'stealPoints'].includes(type)
      "
      class="glyph"
    >
      <template v-if="type === 'initials'"><b class="letters" /></template>
      <template v-else-if="type === 'category'"
        ><b class="tag">{{ t('category.ANIMAL') }}</b></template
      >
      <template v-else-if="type === 'removeTwo'"><i /><i /><i /></template>
      <template v-else-if="type === 'shield'"><i class="crest" /></template>
      <template v-else-if="type === 'stealBonus'"><i class="loot" /><i class="hand" /></template>
      <template v-else><b class="minus">−30 %</b></template>
    </span>
    <span v-else class="cat" />
  </span>
</template>

<style scoped>
.icon {
  position: relative;
  display: block;
  width: var(--icon-size, 48px);
  aspect-ratio: 1;
  overflow: hidden;
  border-radius: 50%;
  background: color-mix(in srgb, var(--accent) 16%, var(--surface));
}
.cat,
.glyph {
  position: absolute;
  inset: 8%;
  border-radius: 50%;
}
.cat {
  background: url('/howto/cat.svg') center / cover;
}
/* The left eye of the drawing, where the zoom starts. */
.cat {
  transform-origin: 38% 53%;
}
.is-zoomOut .cat {
  animation: zoom-out 2.4s ease-in-out infinite;
}
.is-secondZone .cat {
  animation: second-zone 2.4s steps(1) infinite;
}
.is-blur .cat {
  animation: blur 2.4s ease-in-out infinite;
}
.is-flip .cat {
  animation: flip 2.4s ease-in-out infinite;
}
.is-freeze::after {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background:
    radial-gradient(circle at 30% 30%, #ffffff 0 8%, transparent 9%),
    radial-gradient(circle at 70% 62%, #ffffff 0 6%, transparent 7%), rgb(127 184 216 / 0.75);
  content: '';
  animation: frost 2.4s ease-in-out infinite;
}
.letters::after {
  content: 'C···';
  animation: letters 2.4s steps(1) infinite;
}
.glyph {
  display: grid;
  place-items: center;
  font-family: var(--font-display);
  font-weight: 800;
  color: var(--accent);
}
.letters {
  font-size: calc(var(--icon-size, 48px) * 0.3);
}
.tag {
  padding: 0.2em 0.4em;
  border-radius: 6px;
  background: var(--accent);
  color: #ffffff;
  font-family: var(--font-text);
  font-size: calc(var(--icon-size, 48px) * 0.19);
  animation: tag 2.4s ease-in-out infinite;
}
.is-removeTwo .glyph {
  align-content: center;
  gap: 12%;
}
.is-removeTwo i {
  position: relative;
  display: block;
  width: 70%;
  height: 0.18em;
  min-height: 5px;
  border-radius: 3px;
  background: color-mix(in srgb, var(--accent) 35%, var(--surface));
}
.is-removeTwo i:nth-child(odd)::after {
  position: absolute;
  top: 45%;
  left: -6%;
  width: 0;
  height: 2px;
  background: var(--ink);
  content: '';
  animation: strike 2.4s ease-out infinite;
}
.crest {
  width: 62%;
  height: 72%;
  background: var(--good);
  clip-path: polygon(50% 0, 100% 18%, 92% 65%, 50% 100%, 8% 65%, 0 18%);
  animation: pulse 1.6s ease-in-out infinite;
}
.is-stealBonus .glyph {
  grid-template-columns: auto auto;
  justify-content: center;
  gap: 8%;
}
.loot {
  width: calc(var(--icon-size, 48px) * 0.28);
  aspect-ratio: 1;
  border-radius: 4px;
  background: var(--accent);
  animation: steal 2.4s ease-in-out infinite;
}
.hand {
  width: calc(var(--icon-size, 48px) * 0.26);
  height: calc(var(--icon-size, 48px) * 0.5);
  border-radius: 999px;
  background: var(--ink);
}
.minus {
  color: var(--danger);
  font-size: calc(var(--icon-size, 48px) * 0.24);
  animation: points 2.4s ease-in-out infinite;
}
.is-blur,
.is-flip,
.is-freeze,
.is-stealBonus,
.is-stealPoints {
  background: color-mix(in srgb, var(--danger) 14%, var(--surface));
}

@keyframes zoom-out {
  0%,
  20% {
    transform: scale(2.6);
  }
  60%,
  100% {
    transform: scale(1);
  }
}
@keyframes second-zone {
  0%,
  49% {
    transform: scale(2.6);
    transform-origin: 38% 53%;
  }
  50%,
  100% {
    transform: scale(2.6);
    transform-origin: 50% 70%;
  }
}
@keyframes blur {
  0%,
  20%,
  100% {
    filter: blur(0);
  }
  50%,
  80% {
    filter: blur(3px);
  }
}
@keyframes flip {
  0%,
  20% {
    transform: rotate(0);
  }
  50%,
  80% {
    transform: rotate(180deg);
  }
  100% {
    transform: rotate(360deg);
  }
}
@keyframes frost {
  0%,
  20% {
    opacity: 0;
    transform: scale(1.3);
  }
  50%,
  85% {
    opacity: 1;
    transform: scale(1);
  }
  100% {
    opacity: 0;
  }
}
@keyframes letters {
  0%,
  30% {
    content: '····';
  }
  31%,
  100% {
    content: 'C···';
  }
}
@keyframes tag {
  0%,
  15% {
    transform: translateY(160%);
  }
  40%,
  100% {
    transform: translateY(0);
  }
}
@keyframes strike {
  0%,
  25% {
    width: 0;
  }
  55%,
  100% {
    width: 112%;
  }
}
@keyframes pulse {
  0%,
  100% {
    transform: scale(0.9);
  }
  50% {
    transform: scale(1.08);
    filter: brightness(1.2);
  }
}
@keyframes steal {
  0%,
  25% {
    transform: translateX(0);
  }
  60%,
  100% {
    transform: translateX(70%);
  }
}
@keyframes points {
  0%,
  20%,
  100% {
    transform: translateY(0);
    opacity: 1;
  }
  70% {
    transform: translateY(-60%);
    opacity: 0;
  }
  71% {
    transform: translateY(60%);
    opacity: 0;
  }
}

/* Less motion: each icon holds the frame that says what it does. */
@media (prefers-reduced-motion: reduce) {
  .icon *,
  .icon::after {
    animation: none !important;
  }
  .is-blur .cat {
    filter: blur(2px);
  }
  .is-flip .cat {
    transform: rotate(180deg);
  }
  .is-freeze::after {
    opacity: 1;
  }
  .is-removeTwo i:nth-child(odd)::after {
    width: 112%;
  }
}
</style>
