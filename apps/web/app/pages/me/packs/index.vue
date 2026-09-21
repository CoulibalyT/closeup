<script setup lang="ts">
import { CATEGORIES, type Category, type MyPack, type MyQuota } from '@closeup/shared';

/** A player's own packs. An account is needed: a pack outlives the browser that made it. */
const { t } = useI18n();
const localePath = useLocalePath();
const session = useSessionStore();
const { appName } = useRuntimeConfig().public;
useHead({ title: () => t('myPacks.title', { appName }) });

const packs = ref<MyPack[]>([]);
const quota = ref<MyQuota | null>(null);
const loading = ref(true);
const failed = ref(false);
const draft = reactive({ titleFr: '', titleEn: '', category: 'OBJECT' as Category });
const creating = ref(false);
const quotaReached = computed(() => quota.value && quota.value.packs.used >= quota.value.packs.max);

async function load(): Promise<void> {
  try {
    const mine = await session.request<{ packs: MyPack[]; quota: MyQuota }>('GET', '/me/packs');
    packs.value = mine.packs;
    quota.value = mine.quota;
  } catch {
    failed.value = true;
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  await session.whoAmI();
  if (session.user) await load();
  else loading.value = false;
});

async function create(): Promise<void> {
  creating.value = true;
  try {
    const pack = await session.request<MyPack>('POST', '/me/packs', { ...draft });
    await navigateTo(localePath(`/me/packs/${pack.id}`));
  } catch {
    failed.value = true;
  } finally {
    creating.value = false;
  }
}
</script>

<template>
  <PageShell wide :title="t('myPacks.heading')">
    <p v-if="loading" class="muted">{{ t('admin.loading') }}</p>

    <template v-else-if="!session.user">
      <p>{{ t('myPacks.needAccount') }}</p>
      <NuxtLink class="button start" :to="localePath('/account')">
        {{ t('account.createAccount') }}
      </NuxtLink>
    </template>

    <template v-else>
      <p class="muted">{{ t('myPacks.pitch') }}</p>
      <p v-if="failed" class="error" role="alert">{{ t('admin.failed') }}</p>

      <!-- On a computer, the packs on the left and the form for a new one on the right. -->
      <div class="workspace">
        <ul v-if="packs.length" class="plain packs">
          <li v-for="pack in packs" :key="pack.id" class="block">
            <NuxtLink :to="localePath(`/me/packs/${pack.id}`)">
              <b>{{ pack.titleFr }}</b>
            </NuxtLink>
            <p class="muted">
              {{ t(`myPacks.state.${pack.visibility}`) }} ·
              {{ t('myPacks.playable', { n: pack.playableCards }) }}
            </p>
            <p v-if="pack.reviewNote" class="note">
              {{ t('myPacks.reviewNote', { note: pack.reviewNote }) }}
            </p>
          </li>
        </ul>

        <form class="block" @submit.prevent="create">
          <h2>{{ t('myPacks.newPack') }}</h2>
          <p v-if="quota" class="muted">
            {{ t('myPacks.quotaPacks', { used: quota.packs.used, max: quota.packs.max }) }}
          </p>
          <label for="title-fr">{{ t('admin.titleFr') }}</label>
          <input id="title-fr" v-model="draft.titleFr" type="text" maxlength="120" required />
          <label for="title-en">{{ t('admin.titleEn') }}</label>
          <input id="title-en" v-model="draft.titleEn" type="text" maxlength="120" required />
          <label for="category">{{ t('admin.category') }}</label>
          <select id="category" v-model="draft.category">
            <option v-for="value in CATEGORIES" :key="value" :value="value">
              {{ t(`category.${value}`) }}
            </option>
          </select>
          <button type="submit" class="button" :disabled="creating || Boolean(quotaReached)">
            {{ t('myPacks.create') }}
          </button>
        </form>
      </div>
    </template>
  </PageShell>
</template>

<style scoped>
.start {
  align-self: flex-start;
  margin-top: var(--space-4);
}
.packs li b {
  font-size: 18px;
}
.packs a {
  color: var(--ink);
}
.note {
  margin-top: var(--space-2);
  padding: var(--space-2);
  border-left: 3px solid var(--danger);
  font-size: 15px;
}
input[type='text'],
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
.workspace {
  display: contents;
}
/* Computer: the packs as a grid, the new-pack form in a column of its own that stays on the
   right even while there is no pack yet. */
@media (min-width: 1080px) {
  .workspace {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 380px;
    gap: var(--space-6);
    align-items: start;
    margin-top: var(--space-4);
  }
  .packs {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: var(--space-3);
  }
  .packs li,
  .workspace > form {
    margin-top: 0;
  }
  .workspace > form {
    grid-column: 2;
  }
}
</style>
