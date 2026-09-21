<script setup lang="ts">
import {
  type AdminPack,
  IMPORT,
  IMPORT_PRESETS,
  type ImportPreset,
  type ImportResult,
  type ImportSearch,
} from '@closeup/shared';

definePageMeta({ middleware: 'admin' });

/**
 * The Wikidata + Commons importer. It proposes, the admin picks: nothing is ticked beforehand,
 * and every card imported still goes through the editor for its zoom points before it plays.
 */
const { t, locale } = useI18n();
const localePath = useLocalePath();
const admin = useSessionStore();
const { appName } = useRuntimeConfig().public;
useHead({ title: () => t('importer.title', { appName }) });

const preset = ref<ImportPreset>('animals');
const search = ref<ImportSearch | null>(null);
const packs = ref<AdminPack[]>([]);
const packId = ref('');
const picked = ref(new Set<string>());
const failed = ref(false);
const importing = ref(false);
const result = ref<ImportResult | null>(null);

// A search can take minutes on a bad day: it runs on the server, and this page asks after it.
let poll: ReturnType<typeof setTimeout> | undefined;
const now = ref(Date.now());
const clock = setInterval(() => (now.value = Date.now()), 1000);
onBeforeUnmount(() => {
  clearTimeout(poll);
  clearInterval(clock);
});

const candidates = computed(() => search.value?.candidates ?? []);
const importable = computed(() => candidates.value.filter((candidate) => !candidate.rejection));
const full = computed(() => picked.value.size >= IMPORT.maxPerImport);
const waited = computed(() =>
  search.value
    ? Math.max(0, Math.round((now.value - Date.parse(search.value.startedAt)) / 1000))
    : 0,
);
const targetTitle = computed(() => {
  const pack = packs.value.find((candidate) => candidate.id === packId.value);
  return pack ? (locale.value === 'en' ? pack.titleEn : pack.titleFr) : '';
});
/** Already in the pack chosen: ticking it would only be skipped by the server. */
const inTarget = (importedIn: string[]) =>
  Boolean(targetTitle.value) && importedIn.includes(targetTitle.value);

async function load(which: ImportPreset): Promise<void> {
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
      { preset: preset.value },
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
    packId.value = packs.value[0]?.id ?? '';
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

/** The most popular importable subjects not yet in the pack, up to the limit of one import. */
function pickTop(): void {
  picked.value = new Set(
    importable.value
      .filter((candidate) => !inTarget(candidate.importedIn))
      .slice(0, IMPORT.maxPerImport)
      .map((candidate) => candidate.qid),
  );
}

async function run(): Promise<void> {
  importing.value = true;
  failed.value = false;
  try {
    result.value = await admin.request<ImportResult>('POST', '/admin/import', {
      preset: preset.value,
      packId: packId.value,
      qids: [...picked.value],
    });
    picked.value = new Set();
    await load(preset.value);
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
            <option v-for="value in IMPORT_PRESETS" :key="value" :value="value">
              {{ t(`importer.presets.${value}`) }}
            </option>
          </select>
        </div>
        <div class="field end">
          <button
            v-if="!search || search.state === 'failed'"
            type="button"
            class="button"
            @click="start"
          >
            {{ t(search ? 'importer.searchAgain' : 'importer.search') }}
          </button>
        </div>
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
    </section>

    <section v-if="result" class="panel" role="status">
      <p class="good">{{ t('importer.imported', { n: result.created }) }}</p>
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
            <option v-for="pack in packs" :key="pack.id" :value="pack.id">
              {{ locale === 'en' ? pack.titleEn : pack.titleFr }}
            </option>
          </select>
          <p v-if="!packs.length" class="muted">{{ t('importer.noPack') }}</p>
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
        <li
          v-for="candidate in candidates"
          :key="candidate.qid"
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
