<script setup lang="ts">
import {
  type AdminCard,
  type AdminCardSummary,
  answerFromFileName,
  type MyPack,
  parallelLimit,
  QUOTA,
} from '@closeup/shared';
import { ApiError } from '~/stores/session';

/**
 * One of the player's packs: its cards, a folder of pictures dropped at once, and the way to
 * ask for it to be published.
 */
const route = useRoute();
const { t, te } = useI18n();
const localePath = useLocalePath();
const session = useSessionStore();
const game = useGameStore();
const { appName } = useRuntimeConfig().public;

const id = String(route.params.id);
const pack = ref<MyPack | null>(null);
const cards = ref<AdminCardSummary[]>([]);
const failed = ref(false);
const busy = ref(false);
const error = ref<string | null>(null);
const rights = ref(false);
useHead({ title: () => `${pack.value?.titleFr ?? t('catalogue.pack')}, ${appName}` });

const inReview = computed(() => pack.value?.visibility === 'PENDING_REVIEW');
const isPublic = computed(() => pack.value?.visibility === 'PUBLIC');
/** The owner's own account is not held to the quotas; the server agrees. */
const unlimited = computed(() => session.user?.role === 'ADMIN');

/** A folder dropped at once: the file name is the answer, the worker sets the points. */
const DROP_MAX = 50;
type Dropped = {
  name: string;
  answer: string;
  state: 'waiting' | 'creating' | 'uploading' | 'done';
  error: string | null;
  /** Once made: how the worker's verdict finds its line. */
  cardId: string | null;
};
const dropped = ref<Dropped[]>([]);
const dropRights = ref(false);
const dropping = ref(false);
const dropError = ref<'tooMany' | 'needRights' | null>(null);
const picker = ref<HTMLInputElement | null>(null);
let watching: ReturnType<typeof setTimeout> | undefined;
onBeforeUnmount(() => clearTimeout(watching));

async function load(): Promise<void> {
  try {
    const view = await session.request<{ pack: MyPack; cards: AdminCardSummary[] }>(
      'GET',
      `/me/packs/${id}`,
    );
    pack.value = view.pack;
    cards.value = view.cards;
  } catch {
    failed.value = true;
  }
}
onMounted(async () => {
  // Who is looking decides the quota line and the credit of a dropped picture.
  await session.whoAmI();
  await load();
});

async function addCard(): Promise<void> {
  busy.value = true;
  error.value = null;
  try {
    const card = await session.request<AdminCard>('POST', `/me/packs/${id}/cards`, {
      category: pack.value?.category ?? 'OBJECT',
    });
    await navigateTo(localePath(`/me/packs/cards/${card.id}`));
  } catch (failure) {
    error.value = (failure as { code?: string }).code ?? 'other';
  } finally {
    busy.value = false;
  }
}

async function act(path: string, body?: unknown): Promise<void> {
  busy.value = true;
  error.value = null;
  try {
    pack.value = await session.request<MyPack>('POST', `/me/packs/${id}/${path}`, body);
    await load();
  } catch (failure) {
    error.value = (failure as { code?: string }).code ?? 'other';
  } finally {
    busy.value = false;
  }
}

/** The files of a drop; a dropped folder is opened, its sub-folders too. */
async function filesOfDrop(transfer: DataTransfer): Promise<File[]> {
  const entries = [...transfer.items]
    .map((item) => item.webkitGetAsEntry?.())
    .filter((entry): entry is FileSystemEntry => Boolean(entry));
  if (!entries.length) return [...transfer.files];
  const files: File[] = [];
  const walk = async (entry: FileSystemEntry): Promise<void> => {
    if (entry.isFile) {
      files.push(
        await new Promise<File>((resolve, reject) =>
          (entry as FileSystemFileEntry).file(resolve, reject),
        ),
      );
      return;
    }
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    // A directory reader gives its entries a batch at a time, until an empty batch.
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
        reader.readEntries(resolve, reject),
      );
      if (!batch.length) break;
      for (const child of batch) await walk(child);
    }
  };
  for (const entry of entries) await walk(entry);
  return files;
}

function onDrop(event: DragEvent): void {
  const transfer = event.dataTransfer;
  if (transfer) void filesOfDrop(transfer).then(take);
}
function onPick(event: Event): void {
  const input = event.target as HTMLInputElement;
  void take([...(input.files ?? [])]);
  input.value = '';
}

async function take(all: File[]): Promise<void> {
  const files = all.filter((file) => file.type.startsWith('image/'));
  dropError.value = null;
  if (!files.length || dropping.value) return;
  if (!dropRights.value) {
    dropError.value = 'needRights';
    return;
  }
  if (files.length > DROP_MAX) {
    dropError.value = 'tooMany';
    return;
  }
  dropped.value = files.map((file) => ({
    name: file.name,
    answer: answerFromFileName(file.name),
    state: 'waiting',
    error: null,
    cardId: null,
  }));
  dropping.value = true;
  // Two at a time: enough to keep the line moving, not enough to flood the worker.
  await parallelLimit(files, 2, importOne);
  dropping.value = false;
  await load();
  watchProcessing(Date.now() + 3 * 60_000);
}

/** One file: a card, its answer and credit, then the picture with automatic points. */
async function importOne(file: File, index: number): Promise<void> {
  const row = dropped.value[index]!;
  if (!row.answer) {
    row.error = 'noAnswer';
    return;
  }
  const category = pack.value?.category ?? 'OBJECT';
  const isPerson = category === 'CELEBRITY';
  try {
    row.state = 'creating';
    const card = await session.request<AdminCard>('POST', `/me/packs/${id}/cards`, {
      category,
      isPerson,
    });
    row.cardId = card.id;
    await session.request('PUT', `/me/packs/cards/${card.id}`, {
      category,
      difficulty: 2,
      isPerson,
      answers: {
        fr: { text: row.answer, aliases: [] },
        en: { text: row.answer, aliases: [] },
      },
      credit: {
        author: session.user?.nickname ?? '—',
        licence: t('myPacks.drop.licence'),
        sourceUrl: '',
      },
    });
    row.state = 'uploading';
    const body = new FormData();
    body.set('file', file, file.name);
    body.set('rightsConfirmed', 'true');
    body.set('auto', 'true');
    await session.request('POST', `/me/packs/cards/${card.id}/image`, body);
    row.state = 'done';
  } catch (failure) {
    row.error = failure instanceof ApiError ? (failure.code ?? `HTTP ${failure.status}`) : 'other';
    // An empty card would only take a place in the pack: it goes.
    if (row.cardId) {
      await session.request('DELETE', `/me/packs/cards/${row.cardId}`).catch(() => undefined);
      row.cardId = null;
    }
  }
}

/** The worker refused some pictures (too small, unreadable…): each line says why. */
async function showRefusals(): Promise<void> {
  const byId = new Map(cards.value.map((card) => [card.id, card]));
  for (const row of dropped.value) {
    if (!row.cardId || row.error || byId.get(row.cardId)?.status !== 'DRAFT') continue;
    const card = await session
      .request<AdminCard>('GET', `/me/packs/cards/${row.cardId}`)
      .catch(() => null);
    row.error = card?.processingError ?? 'FAILED';
  }
}

/** The worker is at the pictures: the list refreshes until none is processing. */
function watchProcessing(until: number): void {
  clearTimeout(watching);
  void showRefusals();
  if (Date.now() > until || !cards.value.some((card) => card.status === 'PROCESSING')) return;
  watching = setTimeout(() => void load().then(() => watchProcessing(until)), 3000);
}

/** What to say about a file that failed: the upload's word, the quota's, or a shrug. */
function dropErrorLabel(code: string): string {
  if (te(`myPacks.drop.${code}`)) return t(`myPacks.drop.${code}`);
  if (te(`admin.uploadError.${code}`)) return t(`admin.uploadError.${code}`);
  if (te(`myPacks.error.${code}`)) return t(`myPacks.error.${code}`);
  return t('myPacks.error.other');
}

async function remove(): Promise<void> {
  if (!window.confirm(t('myPacks.deleteConfirm'))) return;
  try {
    await session.request('DELETE', `/me/packs/${id}`);
    await navigateTo(localePath('/me/packs'));
  } catch (failure) {
    error.value = (failure as { code?: string }).code ?? 'other';
  }
}
</script>

<template>
  <PageShell wide :title="pack?.titleFr ?? t('catalogue.pack')">
    <p v-if="failed" class="error" role="alert">{{ t('admin.failed') }}</p>

    <template v-if="pack">
      <p class="muted">
        {{ t(`myPacks.state.${pack.visibility}`) }} ·
        {{ t('myPacks.playable', { n: pack.playableCards }) }}
      </p>
      <p v-if="pack.reviewNote" class="note">
        {{ t('myPacks.reviewNote', { note: pack.reviewNote }) }}
      </p>
      <p v-if="error" class="error" role="alert">
        {{ t(`myPacks.error.${error}`, t('myPacks.error.other')) }}
      </p>

      <section class="block">
        <h2>{{ t('admin.cards') }}</h2>
        <p v-if="!cards.length" class="muted">{{ t('myPacks.noCards') }}</p>
        <ul v-else class="plain cards">
          <li v-for="card in cards" :key="card.id">
            <NuxtLink :to="localePath(`/me/packs/cards/${card.id}`)">
              <img
                v-if="card.thumbnailUrl"
                :src="game.mediaUrl(card.thumbnailUrl)"
                alt=""
                loading="lazy"
              />
              <span v-else class="no-image">{{ t('admin.noImage') }}</span>
              <span>{{ card.answerFr || t('admin.unnamed') }}</span>
            </NuxtLink>
            <small class="muted">{{ t(`admin.status.${card.status}`) }}</small>
          </li>
        </ul>
        <button
          type="button"
          class="button quiet"
          :disabled="busy || inReview || (!unlimited && cards.length >= QUOTA.cardsPerPack)"
          @click="addCard"
        >
          {{ t('admin.newCard') }}
        </button>
        <p class="muted small">
          {{
            unlimited
              ? t('myPacks.drop.unlimited', { used: cards.length })
              : t('myPacks.quotaCards', { used: cards.length, max: QUOTA.cardsPerPack })
          }}
        </p>
      </section>

      <section class="block drop" @dragover.prevent @drop.prevent="onDrop">
        <h2>{{ t('myPacks.drop.title') }}</h2>
        <p class="muted">{{ t('myPacks.drop.hint', { max: DROP_MAX }) }}</p>
        <input
          ref="picker"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          hidden
          @change="onPick"
        />
        <label class="check">
          <input v-model="dropRights" type="checkbox" />
          <span>{{ t('myPacks.rights') }}</span>
        </label>
        <button
          type="button"
          class="button quiet"
          :disabled="!dropRights || dropping || inReview"
          @click="picker?.click()"
        >
          {{ t('myPacks.drop.choose') }}
        </button>
        <p v-if="dropError" class="error" role="alert">
          {{ t(`myPacks.drop.${dropError}`, { max: DROP_MAX }) }}
        </p>
        <ol v-if="dropped.length" class="plain files" aria-live="polite">
          <li v-for="(f, i) in dropped" :key="`${i}-${f.name}`">
            <span>{{ f.answer || f.name }}</span>
            <small :class="f.error ? 'error' : 'muted'">
              {{ f.error ? dropErrorLabel(f.error) : t(`myPacks.drop.state.${f.state}`) }}
            </small>
          </li>
        </ol>
      </section>

      <section class="block">
        <h2>{{ t('myPacks.publishTitle') }}</h2>

        <template v-if="isPublic">
          <p>{{ t('myPacks.isPublic') }}</p>
          <NuxtLink class="link" :to="localePath(`/packs/${pack.id}`)">
            {{ t('myPacks.seeInCatalogue') }}
          </NuxtLink>
          <button type="button" class="button quiet" :disabled="busy" @click="act('withdraw')">
            {{ t('myPacks.withdraw') }}
          </button>
        </template>

        <template v-else-if="inReview">
          <p>{{ t('myPacks.inReview') }}</p>
          <button type="button" class="button quiet" :disabled="busy" @click="act('withdraw')">
            {{ t('myPacks.cancelSubmission') }}
          </button>
        </template>

        <template v-else>
          <p class="muted">{{ t('myPacks.publishHint') }}</p>
          <label class="check">
            <input v-model="rights" type="checkbox" />
            <span>{{ t('myPacks.rights') }}</span>
          </label>
          <button
            type="button"
            class="button"
            :disabled="busy || !rights || !pack.playableCards"
            @click="act('submit', { rightsConfirmed: true })"
          >
            {{ t('myPacks.submit') }}
          </button>
          <button type="button" class="link danger" @click="remove">
            {{ t('myPacks.delete') }}
          </button>
        </template>
      </section>
    </template>
  </PageShell>
</template>

<style scoped>
.note {
  margin-top: var(--space-2);
  padding: var(--space-2);
  border-left: 3px solid var(--danger);
  font-size: 15px;
}
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
  gap: var(--space-3);
  margin-bottom: var(--space-3);
}
.cards a {
  display: grid;
  gap: var(--space-1);
  color: var(--ink);
  font-weight: 600;
  font-size: 15px;
}
.cards img,
.no-image {
  display: grid;
  place-items: center;
  width: 100%;
  aspect-ratio: 1;
  border-radius: var(--radius);
  background: var(--bg);
  object-fit: cover;
  font-size: 13px;
  font-weight: 400;
  color: var(--muted);
}
.check {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  min-height: 44px;
  margin: var(--space-2) 0;
  font-weight: 400;
}
.check input {
  width: 20px;
  height: 20px;
  margin-top: 2px;
  flex: none;
}
.small {
  font-size: 14px;
}
.drop {
  border: 2px dashed var(--line);
}
.files {
  display: grid;
  gap: var(--space-1);
  margin-top: var(--space-3);
  font-size: 15px;
}
.files li {
  display: flex;
  justify-content: space-between;
  gap: var(--space-3);
}
.block .button,
.block .link {
  margin-top: var(--space-2);
}
</style>
