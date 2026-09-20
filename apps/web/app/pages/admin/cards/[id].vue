<script setup lang="ts">
import {
  type AdminCard,
  CATEGORIES,
  type Category,
  checkUpload,
  FACE,
  fromEyes,
  type Point,
  UPLOAD,
  ZOOM_POINTS,
  type ZoomPointInput,
  type ZoomPointProposal,
} from '@closeup/shared';
import { ApiError } from '~/stores/session';

definePageMeta({ middleware: 'admin' });

const route = useRoute();
const { t } = useI18n();
const localePath = useLocalePath();
const admin = useSessionStore();
const { appName } = useRuntimeConfig().public;

const id = String(route.params.id);
const card = ref<AdminCard | null>(null);
const failed = ref(false);

const title = computed(() => card.value?.answers.fr.text || t('admin.unnamed'));
useHead({ title: () => `${title.value}, ${appName}` });

// ---- details: answers, credit, difficulty ----

const form = reactive({
  category: 'OBJECT' as Category,
  difficulty: 2,
  isPerson: false,
  fr: { text: '', aliases: '' },
  en: { text: '', aliases: '' },
  credit: { author: '', licence: '', sourceUrl: '' },
});
const saving = ref(false);
const saved = ref(false);
const formError = ref(false);

const listOf = (text: string) =>
  text
    .split(',')
    .map((alias) => alias.trim())
    .filter(Boolean);

function fillForm(next: AdminCard): void {
  Object.assign(form, {
    category: next.category,
    difficulty: next.difficulty,
    isPerson: next.isPerson,
    fr: { text: next.answers.fr.text, aliases: next.answers.fr.aliases.join(', ') },
    en: { text: next.answers.en.text, aliases: next.answers.en.aliases.join(', ') },
    credit: { ...next.credit },
  });
}

async function saveDetails(): Promise<void> {
  saving.value = true;
  saved.value = false;
  formError.value = false;
  try {
    card.value = await admin.request<AdminCard>('PUT', `/admin/cards/${id}`, {
      category: form.category,
      difficulty: form.difficulty,
      isPerson: form.isPerson,
      answers: {
        fr: { text: form.fr.text, aliases: listOf(form.fr.aliases) },
        en: { text: form.en.text, aliases: listOf(form.en.aliases) },
      },
      credit: form.credit,
    });
    saved.value = true;
  } catch {
    formError.value = true;
  } finally {
    saving.value = false;
  }
}

// ---- image ----

const blobUrl = ref('');
const file = ref<File | null>(null);
const rights = ref(false);
const uploadError = ref<string | null>(null);
const uploading = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);

/** True between an upload and the end of its ingestion: the picture on screen is about to change. */
let imageChanging = false;

async function loadImage(): Promise<void> {
  const previous = blobUrl.value;
  blobUrl.value = card.value?.image ? await admin.imageBlobUrl(card.value.image.url) : '';
  // Only once nothing shows it any more: the editor and the previews share this URL.
  if (previous) await nextTick(() => URL.revokeObjectURL(previous));
}

function pickFile(event: Event): void {
  file.value = (event.target as HTMLInputElement).files?.[0] ?? null;
  uploadError.value = null;
}

async function upload(): Promise<void> {
  if (!file.value) return;
  // The same first gate as the server, to answer before 15 MB have travelled.
  const head = new Uint8Array(await file.value.slice(0, 16).arrayBuffer());
  uploadError.value = checkUpload({ size: file.value.size, head, rightsConfirmed: rights.value });
  if (uploadError.value) return;

  uploading.value = true;
  try {
    const body = new FormData();
    body.set('file', file.value);
    body.set('rightsConfirmed', 'true');
    imageChanging = true;
    apply(await admin.request<AdminCard>('POST', `/admin/cards/${id}/image`, body));
    file.value = null;
    if (fileInput.value) fileInput.value.value = '';
  } catch (failure) {
    imageChanging = false;
    const known = failure instanceof ApiError ? failure : null;
    uploadError.value = known?.status === 413 ? 'TOO_LARGE' : (known?.code ?? 'FAILED');
  } finally {
    uploading.value = false;
  }
}

// ---- zoom points ----

const points = ref<ZoomPointInput[]>([]);
const selected = ref(-1);
const dirty = ref(false);
const eyesMode = ref(false);
const savingPoints = ref(false);

const current = computed(() => points.value[selected.value] ?? null);
const image = computed(() => card.value?.image ?? null);
const shorterSide = computed(() =>
  image.value ? Math.min(image.value.width, image.value.height) : 0,
);
// A face sets the scale for every point; otherwise 4 % of the picture is a fair first guess.
const defaultRadius = computed(() =>
  Math.round(
    card.value?.detection?.eyeDistancePx
      ? card.value.detection.eyeDistancePx / 2
      : shorterSide.value * 0.04,
  ),
);
const proposals = computed(() => {
  const taken = (p: Point) =>
    points.value.some((point) => Math.hypot(point.x - p.x, point.y - p.y) < point.baseRadius / 2);
  return (card.value?.detection?.proposals ?? []).filter((proposal) => !taken(proposal));
});

/** Only what the server takes back: a proposal has a zone, a saved point an id. */
function asInput(
  point: Omit<ZoomPointInput, 'origin'>,
  origin: ZoomPointInput['origin'],
): ZoomPointInput {
  const { x, y, baseRadius, labelFr, labelEn, weight } = point;
  return { x, y, baseRadius, labelFr, labelEn, weight, origin };
}

function setPoints(next: ZoomPointInput[]): void {
  points.value = next;
  dirty.value = true;
}
function patchCurrent(patch: Partial<ZoomPointInput>): void {
  setPoints(
    points.value.map((point, i) => (i === selected.value ? { ...point, ...patch } : point)),
  );
}
function removePoint(index: number): void {
  setPoints(points.value.filter((_, i) => i !== index));
  selected.value = Math.min(selected.value, points.value.length - 1);
}

/** Up to five points: the eyes first, the forehead is the one that is left out. */
function useProposals(all: ZoomPointProposal[]): void {
  setPoints(
    all
      .filter((proposal) => proposal.zone !== 'brow')
      .slice(0, ZOOM_POINTS.max)
      .map((proposal) => asInput(proposal, 'AUTO')),
  );
  selected.value = 0;
}
function onEyes(first: Point, second: Point): void {
  eyesMode.value = false;
  useProposals(fromEyes(first, second));
}

async function savePoints(): Promise<void> {
  savingPoints.value = true;
  try {
    apply(
      await admin.request<AdminCard>('PUT', `/admin/cards/${id}/zoom-points`, {
        points: points.value,
      }),
    );
  } catch {
    failed.value = true;
  } finally {
    savingPoints.value = false;
  }
}

// ---- publication ----

async function setLive(live: boolean): Promise<void> {
  try {
    card.value = await admin.request<AdminCard>('PUT', `/admin/cards/${id}/live`, { live });
  } catch (failure) {
    if (failure instanceof ApiError && failure.status === 409) await refresh();
    else failed.value = true;
  }
}

async function remove(): Promise<void> {
  if (!card.value || !window.confirm(t('admin.deleteConfirm'))) return;
  const { packId } = card.value;
  await admin.request('DELETE', `/admin/cards/${id}`);
  await navigateTo(localePath(`/admin/packs/${packId}`));
}

// ---- keeping up with the worker ----

let poll: ReturnType<typeof setTimeout> | undefined;

/** Takes a card from the server. Local zoom points are only replaced when the server's changed. */
function apply(next: AdminCard): void {
  const before = card.value;
  card.value = next;
  if (!before || !dirty.value || next.status === 'PROCESSING' || before.status === 'PROCESSING') {
    points.value = next.zoomPoints.map((point) => asInput(point, point.origin));
    selected.value = points.value.length
      ? Math.min(Math.max(selected.value, 0), points.value.length - 1)
      : -1;
    dirty.value = false;
  }
  // Cutting crops also goes through PROCESSING, but leaves the picture as it was.
  const settled = next.status !== 'PROCESSING';
  if (settled && (imageChanging || (next.image && !blobUrl.value))) {
    imageChanging = false;
    void loadImage();
  }

  clearTimeout(poll);
  if (next.status === 'PROCESSING') poll = setTimeout(() => void refresh(), 1_500);
}

async function refresh(): Promise<void> {
  try {
    apply(await admin.request<AdminCard>('GET', `/admin/cards/${id}`));
  } catch {
    failed.value = true;
  }
}

onMounted(async () => {
  await refresh();
  if (card.value) fillForm(card.value);
});
onBeforeUnmount(() => {
  clearTimeout(poll);
  if (blobUrl.value) URL.revokeObjectURL(blobUrl.value);
});
</script>

<template>
  <AdminShell
    :title="title"
    :back="card ? { to: `/admin/packs/${card.packId}`, label: t('admin.pack') } : undefined"
  >
    <p v-if="failed" class="error" role="alert">{{ t('admin.failed') }}</p>

    <div v-if="card" class="editor">
      <section class="left">
        <div class="panel">
          <h2>{{ t('admin.zoomPoints') }}</h2>

          <p v-if="card.status === 'PROCESSING'" class="muted" role="status">
            {{ t('admin.working') }}
          </p>
          <template v-else-if="image && blobUrl">
            <p class="muted hint">{{ t(eyesMode ? 'admin.eyesHint' : 'admin.editorHint') }}</p>
            <AdminZoomEditor
              v-model:selected="selected"
              :src="blobUrl"
              :image="image"
              :points="points"
              :proposals="proposals"
              :eyes-mode="eyesMode"
              :default-radius="defaultRadius"
              @update:points="setPoints"
              @eyes="onEyes"
            />

            <div
              v-if="card.detection"
              class="detection"
              :class="{ warn: card.detection.verdict !== 'ok' }"
              role="status"
            >
              <p>
                {{
                  t(`admin.detection.${card.detection.verdict}`, {
                    n: card.detection.faces,
                    px: card.detection.eyeDistancePx ?? 0,
                    min: FACE.minEyeDistancePx,
                  })
                }}
              </p>
              <button
                v-if="card.detection.proposals.length"
                type="button"
                class="button small quiet"
                @click="useProposals(card.detection.proposals)"
              >
                {{ t('admin.useProposals') }}
              </button>
            </div>

            <div class="actions">
              <button
                type="button"
                class="button small quiet"
                :aria-pressed="eyesMode"
                @click="eyesMode = !eyesMode"
              >
                {{ t(eyesMode ? 'admin.eyesCancel' : 'admin.eyesStart') }}
              </button>
              <button
                type="button"
                class="button small"
                :disabled="!dirty || savingPoints"
                @click="savePoints"
              >
                {{ t('admin.savePoints') }}
              </button>
              <span v-if="dirty" class="muted">{{ t('admin.unsavedPoints') }}</span>
            </div>
          </template>
          <p v-else class="muted">{{ t('admin.needImage') }}</p>
        </div>

        <div v-if="image && blobUrl && card.status !== 'PROCESSING'" class="panel">
          <h2>{{ t('admin.pointList', { n: points.length, max: ZOOM_POINTS.max }) }}</h2>
          <ul class="plain points">
            <li v-for="(point, index) in points" :key="index" :class="{ on: index === selected }">
              <button type="button" class="pick" @click="selected = index">
                {{ index + 1 }}. {{ point.labelFr || t('admin.unlabelled') }}
                <small class="muted">{{ t(`admin.origin.${point.origin}`) }}</small>
              </button>
              <button type="button" class="link" @click="removePoint(index)">
                {{ t('admin.removePoint') }}
              </button>
            </li>
          </ul>

          <template v-if="current">
            <div class="pair">
              <div class="field">
                <label for="label-fr">{{ t('admin.labelFr') }}</label>
                <input
                  id="label-fr"
                  type="text"
                  maxlength="40"
                  :value="current.labelFr"
                  :placeholder="t('admin.labelPlaceholderFr')"
                  @input="patchCurrent({ labelFr: ($event.target as HTMLInputElement).value })"
                />
              </div>
              <div class="field">
                <label for="label-en">{{ t('admin.labelEn') }}</label>
                <input
                  id="label-en"
                  type="text"
                  maxlength="40"
                  :value="current.labelEn"
                  :placeholder="t('admin.labelPlaceholderEn')"
                  @input="patchCurrent({ labelEn: ($event.target as HTMLInputElement).value })"
                />
              </div>
            </div>
            <div class="pair">
              <div class="field">
                <label for="radius">{{
                  t('admin.radius', { px: Math.round(current.baseRadius) })
                }}</label>
                <input
                  id="radius"
                  type="range"
                  :min="Math.max(4, Math.round(shorterSide * 0.005))"
                  :max="Math.round(shorterSide * 0.12)"
                  :value="current.baseRadius"
                  @input="
                    patchCurrent({ baseRadius: Number(($event.target as HTMLInputElement).value) })
                  "
                />
              </div>
              <div class="field">
                <label for="weight">{{ t('admin.weight') }}</label>
                <input
                  id="weight"
                  type="number"
                  min="1"
                  max="9"
                  :value="current.weight"
                  @input="
                    patchCurrent({ weight: Number(($event.target as HTMLInputElement).value) || 1 })
                  "
                />
              </div>
            </div>
            <h2>{{ t('admin.preview') }}</h2>
            <AdminLevelPreview :src="blobUrl" :image="image" :point="current" />
          </template>
        </div>
      </section>

      <section class="right">
        <div class="panel">
          <h2>{{ t('admin.publication') }}</h2>
          <p>
            <span class="chip" :class="card.status.toLowerCase()">
              {{ t(`admin.status.${card.status}`) }}
            </span>
          </p>
          <ul v-if="card.blockers.length" class="blockers">
            <li v-for="blocker in card.blockers" :key="blocker">
              {{ t(`admin.blocker.${blocker}`) }}
            </li>
          </ul>
          <p v-else-if="card.status !== 'LIVE'" class="good">{{ t('admin.publishable') }}</p>
          <div class="actions">
            <button
              v-if="card.status !== 'LIVE'"
              type="button"
              class="button small"
              :disabled="card.blockers.length > 0"
              @click="setLive(true)"
            >
              {{ t('admin.publish') }}
            </button>
            <button v-else type="button" class="button small quiet" @click="setLive(false)">
              {{ t('admin.unpublish') }}
            </button>
            <button v-if="card.source !== 'SEED'" type="button" class="link danger" @click="remove">
              {{ t('admin.deleteCard') }}
            </button>
          </div>
        </div>

        <form class="panel" @submit.prevent="upload">
          <h2>{{ t(card.image ? 'admin.replaceImage' : 'admin.addImage') }}</h2>
          <p class="muted">
            {{
              t('admin.imageRules', { mb: UPLOAD.maxBytes / 1024 / 1024, min: UPLOAD.minSidePx })
            }}
          </p>
          <input
            ref="fileInput"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            :aria-label="t('admin.chooseFile')"
            @change="pickFile"
          />
          <label class="check">
            <input v-model="rights" type="checkbox" />
            <span>{{ t('admin.rights') }}</span>
          </label>
          <p v-if="uploadError" class="error" role="alert">
            {{ t(`admin.uploadError.${uploadError}`) }}
          </p>
          <p v-else-if="card.processingError" class="error" role="alert">
            {{ t(`admin.uploadError.${card.processingError}`) }}
          </p>
          <button
            type="submit"
            class="button small"
            :disabled="!file || !rights || uploading || card.status === 'PROCESSING'"
          >
            {{ t('admin.upload') }}
          </button>
        </form>

        <form class="panel" @submit.prevent="saveDetails">
          <h2>{{ t('admin.answers') }}</h2>
          <div class="field">
            <label for="answer-fr">{{ t('admin.answerFr') }}</label>
            <input id="answer-fr" v-model="form.fr.text" type="text" maxlength="80" />
          </div>
          <div class="field">
            <label for="aliases-fr">{{ t('admin.aliasesFr') }}</label>
            <input id="aliases-fr" v-model="form.fr.aliases" type="text" />
          </div>
          <div class="field">
            <label for="answer-en">{{ t('admin.answerEn') }}</label>
            <input id="answer-en" v-model="form.en.text" type="text" maxlength="80" />
          </div>
          <div class="field">
            <label for="aliases-en">{{ t('admin.aliasesEn') }}</label>
            <input id="aliases-en" v-model="form.en.aliases" type="text" />
            <small class="muted">{{ t('admin.aliasesHint') }}</small>
          </div>

          <h2>{{ t('admin.credit') }}</h2>
          <p class="muted">{{ t('admin.creditHint') }}</p>
          <div class="field">
            <label for="author">{{ t('admin.creditAuthor') }}</label>
            <input id="author" v-model="form.credit.author" type="text" maxlength="120" />
          </div>
          <div class="field">
            <label for="licence">{{ t('admin.creditLicence') }}</label>
            <input
              id="licence"
              v-model="form.credit.licence"
              type="text"
              maxlength="120"
              placeholder="CC BY-SA 4.0"
            />
          </div>
          <div class="field">
            <label for="source">{{ t('admin.creditSource') }}</label>
            <input id="source" v-model="form.credit.sourceUrl" type="url" placeholder="https://" />
          </div>

          <h2>{{ t('admin.sorting') }}</h2>
          <div class="pair">
            <div class="field">
              <label for="category">{{ t('admin.category') }}</label>
              <select id="category" v-model="form.category">
                <option v-for="c in CATEGORIES" :key="c" :value="c">
                  {{ t(`category.${c}`) }}
                </option>
              </select>
            </div>
            <div class="field">
              <label for="difficulty">{{ t('admin.difficulty') }}</label>
              <select id="difficulty" v-model.number="form.difficulty">
                <option v-for="n in 3" :key="n" :value="n">
                  {{ t(`admin.difficultyLevel.${n}`) }}
                </option>
              </select>
            </div>
          </div>
          <label class="check">
            <input v-model="form.isPerson" type="checkbox" />
            <span>{{ t('admin.isPersonLong') }}</span>
          </label>

          <div class="actions">
            <button type="submit" class="button small" :disabled="saving">
              {{ t('admin.save') }}
            </button>
            <span v-if="saved" class="good" role="status">{{ t('admin.saved') }}</span>
            <span v-if="formError" class="error" role="alert">{{ t('admin.formError') }}</span>
          </div>
        </form>
      </section>
    </div>
  </AdminShell>
</template>

<style scoped>
.editor {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(300px, 1fr);
  gap: var(--space-4);
  align-items: start;
}
@media (max-width: 860px) {
  .editor {
    grid-template-columns: minmax(0, 1fr);
  }
}
.hint {
  margin-bottom: var(--space-2);
  font-size: 14px;
}
.detection {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
  margin-top: var(--space-3);
  padding: var(--space-2) var(--space-3);
  border: 1.5px solid var(--good);
  border-radius: var(--radius);
}
.detection.warn {
  border: 1.5px dashed var(--ink);
}
.detection p {
  flex: 1 1 240px;
}
.points li {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid var(--line);
}
.points li.on .pick {
  color: var(--accent);
  font-weight: 700;
}
.pick {
  flex: 1;
  min-height: 44px;
  border: 0;
  background: none;
  text-align: left;
  cursor: pointer;
}
.pick small {
  margin-left: var(--space-2);
}
.points + .pair {
  margin-top: var(--space-4);
}
input[type='range'] {
  width: 100%;
  min-height: 44px;
}
input[type='file'] {
  max-width: 100%;
  min-height: 44px;
}
.blockers {
  margin: 0;
  padding-left: 1.2em;
}
.link.danger {
  color: var(--danger);
}
h2:not(:first-child) {
  margin-top: var(--space-4);
}
</style>
