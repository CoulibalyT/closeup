import { brand } from '@closeup/shared';

export const SESSION_COOKIE = `${brand.codename}_session`;
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Failed logins per window before the door closes. Successes do not count. */
export const LOGIN_LIMIT = { perEmail: 5, perIp: 20, windowS: 15 * 60 } as const;
