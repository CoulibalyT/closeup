import type {
  PlayerStats,
  PublishBlocker,
  RankingPeriod,
  Rankings,
  SessionUser,
} from '@closeup/shared';
import { defineStore } from 'pinia';

/** What the API answers when it refuses: an HTTP status, and often a code. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    readonly blockers: PublishBlocker[] = [],
  ) {
    super(code ?? `HTTP ${status}`);
  }
}

/**
 * The optional account of a player (and the owner's admin session: same cookie, same login).
 * The session lives in an httpOnly cookie: this store never sees a token, it only asks the
 * server who it is. Playing needs none of this; an account only makes the history follow you.
 */
export const useSessionStore = defineStore('session', () => {
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
      throw new ApiError(response.status, detail.code ?? null, detail.blockers);
    }
    return (response.status === 204 ? undefined : await response.json()) as T;
  }

  async function whoAmI(): Promise<SessionUser | null> {
    user.value = await request<SessionUser>('GET', '/auth/me').catch(() => null);
    checked.value = true;
    return user.value;
  }

  /** The server now plays this device as the account's player: take its nickname too. */
  function welcome(next: SessionUser): void {
    user.value = next;
    checked.value = true;
    if (next.nickname) useGameStore().setNickname(next.nickname);
  }

  async function login(email: string, password: string): Promise<void> {
    welcome(await request<SessionUser>('POST', '/auth/login', { email, password }));
  }

  async function register(email: string, password: string, locale: string): Promise<void> {
    welcome(await request<SessionUser>('POST', '/auth/register', { email, password, locale }));
  }

  const changePassword = (current: string, next: string) =>
    request<void>('POST', '/auth/password/change', { current, next });
  const forgotPassword = (email: string) =>
    request<void>('POST', '/auth/password/forgot', { email });
  const resetPassword = (token: string, password: string) =>
    request<void>('POST', '/auth/password/reset', { token, password });

  async function deleteAccount(password: string): Promise<void> {
    await request<void>('DELETE', '/auth/me', { password });
    user.value = null;
  }

  /** `null`: nothing was ever played on this device. */
  const stats = () => request<PlayerStats>('GET', '/me/stats').catch(() => null);
  const rankings = (period: RankingPeriod) =>
    request<Rankings>('GET', `/rankings?period=${period}`);

  async function logout(): Promise<void> {
    await request('POST', '/auth/logout').catch(() => undefined);
    user.value = null;
  }

  /** Card and reveal images sit behind short-lived URLs: load once, keep as a local blob. */
  async function imageBlobUrl(path: string): Promise<string> {
    const response = await fetch(apiBase + path);
    if (!response.ok) throw new ApiError(response.status, null);
    return URL.createObjectURL(await response.blob());
  }

  const mediaUrl = (path: string) => apiBase + path;

  return {
    user,
    checked,
    request,
    whoAmI,
    login,
    register,
    logout,
    changePassword,
    forgotPassword,
    resetPassword,
    deleteAccount,
    stats,
    rankings,
    imageBlobUrl,
    mediaUrl,
  };
});
