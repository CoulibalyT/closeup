/**
 * Every `/admin` page except the login form. The check that matters is the server's (each
 * `/api/admin` call goes through a guard); this one only spares a stranger an empty shell.
 */
export default defineNuxtRouteMiddleware(async () => {
  const admin = useSessionStore();
  const user = admin.user ?? (await admin.whoAmI());
  if (user?.role !== 'ADMIN') return navigateTo(useLocalePath()('/admin/login'));
});
