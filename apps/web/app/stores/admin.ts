import type { PublishBlocker, SessionUser } from '@closeup/shared';
import { defineStore } from 'pinia';

/** What the back-office API answers when it refuses: an HTTP status, and often a code. */
export class AdminApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    readonly blockers: PublishBlocker[] = [],
  ) {
    super(code ?? `HTTP ${status}`);
  }
}

/**
 * The owner's session and the one way to talk to `/api/admin`. The session lives in an httpOnly
 * cookie: this store never sees a token, it only asks the server who it is.
 */
export const useAdminStore = defineStore('admin', () => {
  const { apiBase } = useRuntimeConfig().public;
  const user = ref<SessionUser | null>(null);
  /** `false` until the server has been asked once. */
  const checked = ref(false);

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const form = body instanceof FormData;
    const response = await fetch(`${apiBase}/api${path}`, {
      method,
      credentials: 'include',
      headers: body === undefined || form ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : form ? body : JSON.stringify(body),
    });
    if (response.status === 401 && !path.startsWith('/auth/')) user.value = null;
    if (!response.ok) {
      const detail = (await response.json().catch(() => ({}))) as {
        code?: string;
        blockers?: PublishBlocker[];
      };
      throw new AdminApiError(response.status, detail.code ?? null, detail.blockers);
    }
    return (response.status === 204 ? undefined : await response.json()) as T;
  }

  async function whoAmI(): Promise<SessionUser | null> {
    user.value = await request<SessionUser>('GET', '/auth/me').catch(() => null);
    checked.value = true;
    return user.value;
  }

  async function login(email: string, password: string): Promise<void> {
    user.value = await request<SessionUser>('POST', '/auth/login', { email, password });
    checked.value = true;
  }

  async function logout(): Promise<void> {
    await request('POST', '/auth/logout').catch(() => undefined);
    user.value = null;
  }

  /** Card and reveal images sit behind short-lived URLs: load once, keep as a local blob. */
  async function imageBlobUrl(path: string): Promise<string> {
    const response = await fetch(apiBase + path);
    if (!response.ok) throw new AdminApiError(response.status, null);
    return URL.createObjectURL(await response.blob());
  }

  const mediaUrl = (path: string) => apiBase + path;

  return { user, checked, request, whoAmI, login, logout, imageBlobUrl, mediaUrl };
});
