<script setup lang="ts">
import {
  type AdminCardSummary,
  type AdminPack,
  IMPORT,
  IMPORT_PRESETS,
  type ImportResult,
  type ImportSearch,
  type ImportSource,
  isPeopleSource,
  PEOPLE_PRESETS,
} from '@closeup/shared';

definePageMeta({ middleware: 'admin' });

/**
 * The Wikidata + Commons importer. It proposes, the admin picks: nothing is ticked beforehand.
 * Objects then wait for their zoom points in the editor; people come with theirs when their
 * face is clear. People only go into celebrity packs, which games never draw unless chosen.
 */
const { t, locale } = useI18n();
const localePath = useLocalePath();
const admin = useSessionStore();
const { appName } = useRuntimeConfig().public;
useHead({ title: () => t('importer.title', { appName }) });

const objectPresets = IMPORT_PRESETS.filter(
  (preset) => !(PEOPLE_PRESETS as readonly string[]).includes(preset),
);
const preset = ref<ImportSource>('animals');
const people = computed(() => isPeopleSource(preset.value));
const namesText = ref('');
const names = computed(() =>
  namesText.value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean),
);
const tooManyNames = computed(() => names.value.length > IMPORT.maxPerImport);
const search = ref<ImportSearch | null>(null);
const packs = ref<AdminPack[]>([]);
const packId = ref('');
const picked = ref(new Set<string>());
const failed = ref(false);
const importing = ref(false);
const result = ref<ImportResult | null>(null);
const resultForPeople = ref(false);
const statuses = ref<Record<string, AdminCardSummary['status']>>({});

// A search can take minutes on a bad day: it runs on the server, and this page asks after it.
let poll: ReturnType<typeof setTimeout> | undefined;
let follow: ReturnType<typeof setTimeout> | undefined;
const now = ref(Date.now());
const clock = setInterval(() => (now.value = Date.now()), 1000);
onBeforeUnmount(() => {
  clearTimeout(poll);
  clearTimeout(follow);
  clearInterval(clock);
});

const candidates = computed(() => search.value?.candidates ?? []);
const importable = computed(() => candidates.value.filter((candidate) => !candidate.rejection));
/** The first candidate of each line of a name search: where its heading goes. */
const firstOfQuery = computed(() => {
  const seen = new Set<string>();
  const first = new Set<string>();
  for (const candidate of candidates.value) {
    if (candidate.query === null || seen.has(candidate.query)) continue;
    seen.add(candidate.query);
    first.add(candidate.qid);
  }
  return first;
});
const full = computed(() => picked.value.size >= IMPORT.maxPerImport);
const waited = computed(() =>
  search.value
    ? Math.max(0, Math.round((now.value - Date.parse(search.value.startedAt)) / 1000))
    : 0,
);
/** People go into celebrity packs, everything else anywhere but there. */
const targetPacks = computed(() =>
  packs.value.filter((pack) => (pack.category === 'CELEBRITY') === people.value),
);
watch(targetPacks, (list) => {
  if (!list.some((pack) => pack.id === packId.value)) packId.value = list[0]?.id ?? '';
});
const targetTitle = computed(() => {
  const pack = packs.value.find((candidate) => candidate.id === packId.value);
  return pack ? (locale.value === 'en' ? pack.titleEn : pack.titleFr) : '';
});
/** Already in the pack chosen: ticking it would only be skipped by the server. */
const inTarget = (importedIn: string[]) =>
  Boolean(targetTitle.value) && importedIn.includes(targetTitle.value);

/** How the cards of the last import came out, once the worker has had a look at them. */
const readiness = computed(() => {
  const ids = result.value?.cardIds ?? [];
  const of = (...wanted: string[]) =>
    ids.filter((id) => wanted.includes(statuses.value[id] ?? 'PROCESSING')).length;
  return {
    processing: of('PROCESSING'),
    ready: of('READY', 'LIVE'),
    todo: of('NEEDS_POINTS', 'DRAFT'),
  };
});

async function load(which: ImportSource): Promise<void> {
  clearTimeout(poll);
  try {
    const answer = await admin.request<{ search: ImportSearch | null }>(
      'GET',
      `/admin/import/searches/${which}`,
    );
    if (which !== preset.value) return;
    search.value = answer.search;
    if (answer.search?.state === 'running') poll = setTimeout(() => void load(which), 2000);
  } catch {
    failed.value = true;
  }
}

async function start(): Promise<void> {
  failed.value = false;
  result.value = null;
  try {
    const answer = await admin.request<{ search: ImportSearch | null }>(
      'POST',
      '/admin/import/searches',
      preset.value === 'names' ? { preset: 'names', names: names.value } : { preset: preset.value },
    );
    search.value = answer.search;
    picked.value = new Set();
    if (answer.search?.state === 'running') poll = setTimeout(() => void load(preset.value), 2000);
  } catch {
    failed.value = true;
  }
}

watch(preset, (which) => {
  search.value = null;
  picked.value = new Set();
  result.value = null;
  void load(which);
});

onMounted(async () => {
  try {
    const all = await admin.request<AdminPack[]>('GET', '/admin/packs');
    // House packs only: a player's pack holds pictures its owner vouched for.
    packs.value = all.filter((pack) => !pack.byPlayer);
  } catch {
    failed.value = true;
  }
  await load(preset.value);
});

function toggle(qid: string): void {
  const next = new Set(picked.value);
  if (next.has(qid)) next.delete(qid);
  else if (!full.value) next.add(qid);
  picked.value = next;
}

/**
 * The most popular importable subjects not yet in the pack, up to the limit of one import. For
 * a list of names, the best-known person of each line: a namesake is ticked by hand.
 */
function pickTop(): void {
  const free = importable.value.filter((candidate) => !inTarget(candidate.importedIn));
  const lines = new Set<string>();
  const chosen = free.filter((candidate) => {
    if (candidate.query === null) return true;
    if (lines.has(candidate.query)) return false;
    lines.add(candidate.query);
    return true;
  });
  picked.value = new Set(chosen.slice(0, IMPORT.maxPerImport).map((candidate) => candidate.qid));
}

/** Follows the cards of an import until the worker is done with them, three minutes at most. */
async function followCards(id: string, until: number): Promise<void> {
  try {
    const answer = await admin.request<{ cards: AdminCardSummary[] }>('GET', `/admin/packs/${id}`);
    statuses.value = Object.fromEntries(answer.cards.map((card) => [card.id, card.status]));
  } catch {
    return;
  }
  if (readiness.value.processing && Date.now() < until) {
    follow = setTimeout(() => void followCards(id, until), 3000);
  }
}

async function run(): Promise<void> {
  importing.value = true;
  failed.value = false;
  clearTimeout(follow);
  statuses.value = {};
  try {
    resultForPeople.value = people.value;
    result.value = await admin.request<ImportResult>('POST', '/admin/import', {
      preset: preset.value,
      packId: packId.value,
      qids: [...picked.value],
    });
    picked.value = new Set();
    await load(preset.value);
    if (result.value.cardIds.length) void followCards(packId.value, Date.now() + 3 * 60_000);
  } catch {
    failed.value = true;
  } finally {
    importing.value = false;
  }
}
</script>

<template>
  <AdminShell :title="t('importer.heading')" :back="{ to: '/admin', label: t('admin.packs') }">
    <p class="muted intro">{{ t('importer.pitch') }}</p>
    <p v-if="failed" class="error" role="alert">{{ t('admin.failed') }}</p>

    <section class="panel">
      <div class="pair">
        <div class="field">
          <label for="preset">{{ t('importer.preset') }}</label>
          <select id="preset" v-model="preset">
            <optgroup :label="t('importer.themes')">
              <option v-for="value in objectPresets" :key="value" :value="value">
                {{ t(`importer.presets.${value}`) }}
              </option>
            </optgroup>
            <optgroup :label="t('importer.people')">
              <option v-for="value in PEOPLE_PRESETS" :key="value" :value="value">
                {{ t(`importer.presets.${value}`) }}
              </option>
              <option value="names">{{ t('importer.presets.names') }}</option>
            </optgroup>
          </select>
        </div>
        <div class="field end">
          <button
            v-if="preset === 'names' || !search || search.state === 'failed'"
            type="button"
            class="button"
            :disabled="
              preset === 'names' && (!names.length || tooManyNames || search?.state === 'running')
            "
            @click="start"
          >
            {{ t(search && preset !== 'names' ? 'importer.searchAgain' : 'importer.search') }}
          </button>
        </div>
      </div>
      <div v-if="preset === 'names'" class="field">
        <label for="names">{{ t('importer.namesLabel') }}</label>
        <textarea id="names" v-model="namesText" rows="8" spellcheck="false" />
        <small v-if="tooManyNames" class="error">
          {{ t('importer.namesTooMany', { max: IMPORT.maxPerImport }) }}
        </small>
        <small v-else class="muted">{{
          t('importer.namesHint', { max: IMPORT.maxPerImport })
        }}</small>
      </div>
      <p v-if="search?.state === 'running'" class="muted" role="status">
        {{ t('importer.running', { seconds: waited }) }}
      </p>
      <p v-else-if="search?.state === 'failed'" class="error" role="alert">
        {{ t('importer.searchFailed') }}
      </p>
      <p v-else-if="search?.state === 'done'" class="muted">
        {{ t('importer.found', { n: candidates.length, importable: importable.length }) }}
      </p>
      <p v-if="search?.state === 'done' && search.unmatched.length" class="muted">
        {{ t('importer.unmatched', { list: search.unmatched.join(', ') }) }}
      </p>
    </section>

    <section v-if="result" class="panel" role="status">
      <p class="good">
        {{
          t(resultForPeople ? 'importer.importedPeople' : 'importer.imported', {
            n: result.created,
          })
        }}
      </p>
      <template v-if="resultForPeople && result.cardIds.length">
        <p v-if="readiness.processing" class="muted">
          {{ t('importer.processing', { n: readiness.processing }) }}
        </p>
        <p v-else>{{ t('importer.readiness', readiness) }}</p>
      </template>
      <p v-if="result.skipped.length" class="muted">
        {{
          t('importer.skipped', {
            list: result.skipped
              .map((skip) => `${skip.qid} (${t(`importer.skipReasons.${skip.reason}`)})`)
              .join(', '),
          })
        }}
      </p>
      <NuxtLink v-if="packId" class="link" :to="localePath(`/admin/packs/${packId}`)">
        {{ t('importer.openPack', { pack: targetTitle }) }}
      </NuxtLink>
    </section>

    <template v-if="search?.state === 'done' && candidates.length">
      <section class="panel target">
        <div class="field">
          <label for="pack">{{ t('importer.target') }}</label>
          <select id="pack" v-model="packId">
            <option v-for="pack in targetPacks" :key="pack.id" :value="pack.id">
              {{ locale === 'en' ? pack.titleEn : pack.titleFr }}
            </option>
          </select>
          <p v-if="!targetPacks.length && people" class="muted">
            {{ t('importer.noCelebrityPack') }}
            <NuxtLink class="link" :to="localePath('/admin')">{{
              t('importer.createPack')
            }}</NuxtLink>
          </p>
          <p v-else-if="!targetPacks.length" class="muted">{{ t('importer.noPack') }}</p>
        </div>
        <div class="actions">
          <button type="button" class="button quiet small" @click="pickTop">
            {{ t('importer.pickTop', { n: IMPORT.maxPerImport }) }}
          </button>
          <button
            type="button"
            class="button quiet small"
            :disabled="!picked.size"
            @click="picked = new Set()"
          >
            {{ t('importer.clear') }}
          </button>
          <span class="muted">
            {{ t('importer.picked', { n: picked.size, max: IMPORT.maxPerImport }) }}
          </span>
          <button
            type="button"
            class="button"
            :disabled="!picked.size || !packId || importing"
            @click="run"
          >
            {{ t('importer.import', { n: picked.size }) }}
          </button>
        </div>
      </section>

      <ul class="plain candidates">
        <template v-for="candidate in candidates" :key="candidate.qid">
          <li v-if="firstOfQuery.has(candidate.qid)" class="group">
            {{ t('importer.forName', { name: candidate.query }) }}
          </li>
          <li
            class="panel"
            :class="{ off: candidate.rejection, chosen: picked.has(candidate.qid) }"
          >
            <label class="pick">
              <input
                type="checkbox"
                :checked="picked.has(candidate.qid)"
                :disabled="
                  Boolean(candidate.rejection) ||
                  inTarget(candidate.importedIn) ||
                  (full && !picked.has(candidate.qid))
                "
                @change="toggle(candidate.qid)"
              />
              <!-- From Wikimedia's servers, straight to the admin's browser; never to a player. -->
              <img
                v-if="candidate.thumbUrl"
                :src="candidate.thumbUrl"
                alt=""
                loading="lazy"
                referrerpolicy="no-referrer"
              />
              <span class="facts">
                <b>{{ candidate.answers.fr?.text ?? '—' }}</b>
                <small v-if="candidate.answers.en">{{ candidate.answers.en.text }}</small>
                <small v-if="candidate.description" class="muted">{{
                  candidate.description
                }}</small>
                <small class="muted">
                  {{ t('importer.popularity', { n: candidate.popularity }) }} ·
                  {{ t('importer.difficulty', { n: candidate.difficulty }) }}
                </small>
                <small v-if="candidate.credit" class="muted">
                  {{ candidate.credit.author }} ·
                  <a :href="candidate.credit.sourceUrl" target="_blank" rel="noopener noreferrer">
                    {{ candidate.credit.licence }}
                  </a>
                </small>
                <span v-if="candidate.rejection" class="chip">
                  {{ t(`importer.rejections.${candidate.rejection}`) }}
                </span>
                <span v-else-if="candidate.importedIn.length" class="chip public">
                  {{ t('importer.alreadyIn', { packs: candidate.importedIn.join(', ') }) }}
                </span>
              </span>
            </label>
          </li>
        </template>
      </ul>
    </template>
  </AdminShell>
</template>

<style scoped>
.intro {
  max-width: 70ch;
  margin-bottom: var(--space-4);
}
select {
  width: 100%;
  min-height: var(--tap);
  padding: 0 var(--space-3);
  border: 1.5px solid var(--line);
  border-radius: var(--radius);
  background: var(--bg);
  font: inherit;
  color: inherit;
}
.field.end {
  align-self: end;
}
.target .actions {
  flex-wrap: wrap;
  align-items: center;
}
.candidates {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: var(--space-3);
  margin-top: var(--space-4);
}
/* A line of a name search: its namesakes follow. */
.candidates li.group {
  grid-column: 1 / -1;
  margin-top: var(--space-2);
  font-weight: 700;
}
.candidates li {
  margin: 0;
  padding: var(--space-2);
}
.candidates li.off {
  opacity: 0.55;
}
.candidates li.chosen {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}
.pick {
  display: grid;
  gap: var(--space-2);
  cursor: pointer;
}
.pick input {
  justify-self: start;
  width: 20px;
  height: 20px;
}
.pick img {
  width: 100%;
  aspect-ratio: 4 / 3;
  border-radius: var(--radius);
  background: var(--bg);
  object-fit: cover;
}
.facts {
  display: grid;
  gap: 2px;
  font-weight: 400;
}
.facts b {
  font-size: 17px;
}
.facts small {
  font-size: 13px;
  overflow-wrap: anywhere;
}
.facts .chip {
  justify-self: start;
  margin-top: var(--space-1);
}
</style>
