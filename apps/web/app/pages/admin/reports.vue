<script setup lang="ts">
import type { AdminReport } from '@closeup/shared';

definePageMeta({ middleware: 'admin' });

const { t } = useI18n();
const session = useSessionStore();
const { appName } = useRuntimeConfig().public;
useHead({ title: () => t('admin.reportsTitle', { appName }) });

const reports = ref<AdminReport[]>([]);
const scope = ref<'open' | 'all'>('open');
const loading = ref(true);
const failed = ref(false);
/** The report whose ban form is open. */
const banning = ref<string | null>(null);
const reason = ref('');

async function load(): Promise<void> {
  loading.value = true;
  failed.value = false;
  try {
    reports.value = await session.request<AdminReport[]>(
      'GET',
      `/admin/reports?status=${scope.value}`,
    );
  } catch {
    failed.value = true;
  } finally {
    loading.value = false;
  }
}
watch(scope, load);
onMounted(load);

async function decide(report: AdminReport, status: 'RESOLVED' | 'DISMISSED'): Promise<void> {
  await session.request('PUT', `/admin/reports/${report.id}`, { status, note: '' });
  await load();
}

async function ban(report: AdminReport): Promise<void> {
  if (!report.targetId || !reason.value.trim()) return;
  await session.request('POST', '/admin/bans', {
    playerId: report.targetId,
    reason: reason.value.trim(),
    reportId: report.id,
  });
  banning.value = null;
  reason.value = '';
  await load();
}

async function unban(report: AdminReport): Promise<void> {
  if (!report.targetId) return;
  await session.request('POST', '/admin/bans/lift', { playerId: report.targetId });
  await load();
}
</script>

<template>
  <AdminShell :title="t('admin.reports')" :back="{ to: '/admin', label: t('admin.packs') }">
    <div class="scope">
      <button type="button" :aria-pressed="scope === 'open'" @click="scope = 'open'">
        {{ t('admin.reportsOpen') }}
      </button>
      <button type="button" :aria-pressed="scope === 'all'" @click="scope = 'all'">
        {{ t('admin.reportsAll') }}
      </button>
    </div>

    <p v-if="failed" class="error" role="alert">{{ t('admin.failed') }}</p>
    <p v-else-if="loading" class="muted">{{ t('admin.loading') }}</p>
    <p v-else-if="!reports.length" class="panel">{{ t('admin.reportsEmpty') }}</p>

    <ul v-else class="plain reports">
      <li v-for="report in reports" :key="report.id" class="panel">
        <div class="head">
          <b>{{ report.targetLabel }}</b>
          <span class="chip">{{ t(`report.reasons.${report.reason}`, report.reason) }}</span>
          <span v-if="report.status !== 'OPEN'" class="chip">
            {{ t(`admin.reportStatus.${report.status}`) }}
          </span>
          <span v-if="report.banned?.user || report.banned?.devices" class="chip disabled">
            {{ t('admin.bannedNow') }}
          </span>
        </div>
        <p v-if="report.message" class="message">{{ report.message }}</p>
        <p class="muted small">
          {{ new Date(report.createdAt).toLocaleString() }}
          <template v-if="report.alsoReported">
            · {{ t('admin.alsoReported', { n: report.alsoReported }) }}
          </template>
        </p>

        <form v-if="banning === report.id" class="ban" @submit.prevent="ban(report)">
          <label :for="`reason-${report.id}`">{{ t('admin.banReason') }}</label>
          <input
            :id="`reason-${report.id}`"
            v-model="reason"
            type="text"
            maxlength="200"
            required
          />
          <div class="actions">
            <button type="submit" class="button small danger">{{ t('admin.banConfirm') }}</button>
            <button type="button" class="link" @click="banning = null">
              {{ t('admin.eyesCancel') }}
            </button>
          </div>
        </form>
        <div v-else class="actions">
          <button
            v-if="report.banned && !report.banned.user && !report.banned.devices"
            type="button"
            class="button small danger"
            @click="banning = report.id"
          >
            {{ t('admin.ban') }}
          </button>
          <button
            v-else-if="report.banned"
            type="button"
            class="button small quiet"
            @click="unban(report)"
          >
            {{ t('admin.unban') }}
          </button>
          <template v-if="report.status === 'OPEN'">
            <button type="button" class="button small quiet" @click="decide(report, 'RESOLVED')">
              {{ t('admin.reportResolve') }}
            </button>
            <button type="button" class="link" @click="decide(report, 'DISMISSED')">
              {{ t('admin.reportDismiss') }}
            </button>
          </template>
        </div>
      </li>
    </ul>
  </AdminShell>
</template>

<style scoped>
.scope {
  display: flex;
  gap: var(--space-2);
  margin-bottom: var(--space-4);
}
.scope button {
  min-height: 44px;
  padding: 0 var(--space-4);
  border: 1.5px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
  font-weight: 600;
  cursor: pointer;
}
.scope button[aria-pressed='true'] {
  border-color: var(--ink);
  background: var(--ink);
  color: var(--bg);
}
.reports {
  display: grid;
  gap: var(--space-3);
}
.reports li {
  margin: 0;
}
.head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}
.message {
  margin: var(--space-2) 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.small {
  font-size: 14px;
}
.ban {
  margin-top: var(--space-2);
}
</style>
