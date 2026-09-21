/**
 * `codename` names packages, environment variables and storage keys, and never changes: it is
 * what the repository is built on. `displayName` is the only place the player-facing name is
 * written, and `CLOSEUP_DISPLAY_NAME` overrides it at build time.
 *
 * The game is called **Loupette**: it says the lens it is played through, and the miss it is
 * played for. The domain carries no accent, the name does.
 */
export const brand = {
  codename: 'closeup',
  displayName: 'Loupette',
} as const;
