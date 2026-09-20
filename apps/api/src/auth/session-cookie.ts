import { brand } from '@closeup/shared';

export const SESSION_COOKIE = `${brand.codename}_session`;
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export const RESET_TTL_MS = 60 * 60 * 1000;

/** Per IP and per hour: sign-ups, and "forgot my password" requests (each one sends an e-mail). */
export const SIGNUP_LIMIT = { perIp: 10, windowS: 60 * 60 } as const;
export const FORGOT_LIMIT = { perIp: 10, perEmail: 3, windowS: 60 * 60 } as const;

/** Failed logins per window before the door closes. Successes do not count. */
export const LOGIN_LIMIT = { perEmail: 5, perIp: 20, windowS: 15 * 60 } as const;
