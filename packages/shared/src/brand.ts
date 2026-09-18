/**
 * The game has no final name yet. `codename` is used for packages, env vars and storage keys and
 * never changes. `displayName` is the only place the player-facing name is written; the web app
 * lets `CLOSEUP_DISPLAY_NAME` override it at build time.
 */
export const brand = {
  codename: 'closeup',
  displayName: 'Closeup',
} as const;
