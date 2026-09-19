<script setup lang="ts">
import { type BonusItem, SELF_BONUSES } from '@closeup/shared';

/**
 * The player's bonuses (three at most). A self bonus plays at once; an attack or a steal first
 * asks who it is for. Buttons say what they do, and what a self bonus costs this round.
 */
const { t } = useI18n();
const game = useGameStore();

const aiming = ref<BonusItem | null>(null);
const error = ref<string | null>(null);
const isSelf = (item: BonusItem) => (SELF_BONUSES as readonly string[]).includes(item.type);

// Who can be targeted: the others, online, and still looking (except to steal a bonus).
const targets = computed(() =>
  game.players.filter((player) => {
    if (player.id === game.you || !player.connected) return false;
    if (aiming.value?.type === 'stealBonus') return player.bonusCount > 0;
    return !game.answeredIds.includes(player.id);
  }),
);

function usable(item: BonusItem): boolean {
  if (game.stage !== 'playing' || !game.seated) return false;
  if (item.type === 'shield') return !game.shielded;
  return isSelf(item) ? !game.answered : true;
}

async function play(item: BonusItem, targetId?: string): Promise<void> {
  error.value = await game.useBonus(item.id, targetId);
  aiming.value = null;
  if (error.value) setTimeout(() => (error.value = null), 3_000);
}

function choose(item: BonusItem): void {
  error.value = null;
  if (isSelf(item)) void play(item);
  else aiming.value = aiming.value?.id === item.id ? null : item;
}
</script>

<template>
  <section v-if="game.inventory.length || game.shielded" class="bonuses">
    <p v-if="game.shielded" class="shield">{{ t('bonus.shieldUp') }}</p>

    <div class="items">
      <button
        v-for="item in game.inventory"
        :key="item.id"
        type="button"
        :class="{ attack: !isSelf(item), aiming: aiming?.id === item.id }"
        :disabled="!usable(item)"
        :aria-expanded="isSelf(item) ? undefined : aiming?.id === item.id"
        @click="choose(item)"
      >
        {{ t(`bonus.name.${item.type}`) }}
      </button>
    </div>

    <div v-if="aiming" class="targets">
      <p>{{ t('bonus.pickTarget', { bonus: t(`bonus.name.${aiming.type}`) }) }}</p>
      <p v-if="!targets.length" class="muted">{{ t('bonus.noTarget') }}</p>
      <button
        v-for="player in targets"
        :key="player.id"
        type="button"
        @click="play(aiming, player.id)"
      >
        {{ player.nickname }}
      </button>
    </div>

    <p v-if="error" class="error" role="alert">
      {{ t(`bonus.error.${error}`, t('bonus.error.other')) }}
    </p>
  </section>
</template>

<style scoped>
.bonuses {
  padding: 0 var(--space-4) var(--space-2);
}
.items,
.targets {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.targets {
  margin-top: var(--space-2);
  padding: var(--space-2);
  border-radius: var(--radius);
  background: var(--surface);
}
.targets p {
  width: 100%;
  font-size: 15px;
}
button {
  min-height: 44px;
  padding: 0 var(--space-3);
  border: 0;
  border-radius: var(--radius);
  background: var(--surface);
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
}
.targets button {
  background: var(--bg);
}
button.attack {
  background: var(--danger);
  color: var(--danger-ink);
}
button.aiming {
  outline: 3px solid var(--ink);
  outline-offset: 2px;
}
button:disabled {
  opacity: 0.45;
  cursor: default;
}
.shield {
  margin-bottom: var(--space-1);
  font-size: 14px;
  font-weight: 600;
  color: var(--good);
}
.error {
  margin-top: var(--space-1);
  font-size: 14px;
  color: var(--danger);
}
</style>
