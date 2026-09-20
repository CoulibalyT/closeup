<script setup lang="ts">
/** Frame of every back-office page: where you are, and the way out. */
defineProps<{ title: string; back?: { to: string; label: string } }>();

const { t } = useI18n();
const localePath = useLocalePath();
const admin = useSessionStore();
const { appName } = useRuntimeConfig().public;

// The back-office is nobody's business but the owner's: keep it out of every index.
useHead({ meta: [{ name: 'robots', content: 'noindex, nofollow' }] });

async function logout(): Promise<void> {
  await admin.logout();
  await navigateTo(localePath('/admin/login'));
}
</script>

<template>
  <div class="admin">
    <header class="admin-bar">
      <NuxtLink class="display brand" :to="localePath('/admin')">{{ appName }}</NuxtLink>
      <span class="muted">{{ t('admin.backOffice') }}</span>
      <span class="grow" />
      <span v-if="admin.user" class="muted who">{{ admin.user.email }}</span>
      <button type="button" class="link" @click="logout">{{ t('admin.logout') }}</button>
    </header>
    <main class="admin-main">
      <NuxtLink v-if="back" class="back" :to="localePath(back.to)">← {{ back.label }}</NuxtLink>
      <h1 class="display">{{ title }}</h1>
      <slot />
    </main>
  </div>
</template>

<!-- Not scoped: form controls, chips and tables are shared by every back-office page. -->
<style>
.admin {
  min-height: 100dvh;
}
.admin-bar {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-3) var(--space-6);
  border-bottom: 1px solid var(--line);
  background: var(--surface);
}
.admin-bar .brand {
  color: var(--ink);
  font-size: 20px;
  text-decoration: none;
}
.admin-bar .grow {
  flex: 1;
}
.admin-bar .who {
  font-size: 14px;
}
.admin-main {
  max-width: 1180px;
  margin: 0 auto;
  padding: var(--space-6);
}
.admin-main > h1 {
  margin: var(--space-2) 0 var(--space-6);
  font-size: clamp(28px, 4vw, 40px);
  overflow-wrap: anywhere;
}
.admin .back {
  color: var(--muted);
}
.admin .link {
  min-height: 44px;
  padding: 0 var(--space-2);
  border: 0;
  background: none;
  color: var(--accent);
  text-decoration: underline;
  cursor: pointer;
}
.admin .panel {
  padding: var(--space-4);
  border-radius: var(--radius);
  background: var(--surface);
}
.admin .panel + .panel {
  margin-top: var(--space-4);
}
.admin h2 {
  margin: 0 0 var(--space-3);
  font-size: 17px;
}
.admin label,
.admin legend {
  display: block;
  margin-bottom: var(--space-1);
  font-size: 14px;
  font-weight: 600;
}
.admin input[type='text'],
.admin input[type='email'],
.admin input[type='password'],
.admin input[type='url'],
.admin input[type='number'],
.admin select,
.admin textarea {
  width: 100%;
  min-height: 44px;
  padding: var(--space-2) var(--space-3);
  border: 1.5px solid var(--line);
  border-radius: var(--radius);
  background: var(--bg);
  font: inherit;
  color: inherit;
}
.admin textarea {
  min-height: 76px;
  resize: vertical;
}
.admin .field {
  margin-bottom: var(--space-3);
}
.admin .pair {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: var(--space-3);
}
.admin .check {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  min-height: 44px;
  font-weight: 400;
}
.admin .check input {
  width: 20px;
  height: 20px;
  margin-top: 2px;
  flex: none;
}
.admin .actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
  margin-top: var(--space-3);
}
.admin .button.danger {
  background: var(--danger);
  color: var(--danger-ink);
}
.admin .button.small {
  min-height: 44px;
  padding: 0 var(--space-4);
  font-size: 15px;
}
.admin .error {
  color: var(--danger);
  font-weight: 600;
}
.admin .good {
  color: var(--good);
  font-weight: 600;
}
.admin .chip {
  display: inline-block;
  padding: 2px var(--space-2);
  border: 1.5px solid currentColor;
  border-radius: var(--radius);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  white-space: nowrap;
}
.admin .chip.live,
.admin .chip.public {
  color: var(--good);
}
.admin .chip.disabled,
.admin .chip.draft {
  color: var(--danger);
}
.admin .chip.processing,
.admin .chip.needs_points,
.admin .chip.ready,
.admin .chip.private,
.admin .chip.pending_review {
  color: var(--muted);
}
.admin ul.plain {
  margin: 0;
  padding: 0;
  list-style: none;
}
</style>
