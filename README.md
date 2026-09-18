# closeup

Multiplayer party game for the web: everyone sees an extreme close-up that slowly zooms out, and
races to guess what it is. `closeup` is a codename; the player-facing name lives in one place
(`packages/shared/src/brand.ts`, overridable with `CLOSEUP_DISPLAY_NAME`).

- The brief: [docs/brief.md](docs/brief.md)
- The validated solo prototype: [docs/prototype/gros-plan.html](docs/prototype/gros-plan.html)

**Status: phase 0 (scaffold) done.** There is no game yet. What runs is a status page proving that
the web app, the API, Postgres, Redis, the image worker and the realtime channel all talk to each
other.

## Run it

Requirements: Docker, and for anything outside Docker Node ≥ 22.19 (`nvm use`) with pnpm through
Corepack (`corepack enable`).

```sh
cp .env.example .env        # then change any host port that is already taken on your machine
docker compose up --build
```

Open `http://localhost:3000` (or your `WEB_PORT`). You should see six rows turn to "en ligne" and
a measured clock offset. Stop Redis (`docker compose stop redis`) and the page says so within five
seconds; `GET /api/health/ready` answers 503.

Changing the game's name: set `CLOSEUP_DISPLAY_NAME=Whatever` in `.env` and run
`docker compose up -d web`. The page title, the PWA manifest and every translated string follow.

With the stack up, `pnpm smoke` checks it end to end from the host (REST, worker round trip,
web shell, manifest, WebSocket clock sync, refusal of a stale client) and exits 1 on a failure.

**Behind a corporate TLS-inspecting proxy** (Cato, Zscaler, ...) the image build fails with
`self-signed certificate in certificate chain` when Prisma downloads its schema engine. Drop the
proxy's root CA in [docker/certs](docker/certs/README.md) and rebuild. Do not disable TLS
verification.

| Service  | URL (default ports)                    |
| -------- | -------------------------------------- |
| Web      | http://localhost:3000                  |
| API      | http://localhost:3001/api/health/ready |
| Postgres | localhost:5432 (closeup / closeup)     |
| Redis    | localhost:6379                         |

### Working on the host

```sh
pnpm install
pnpm prepare:all     # build packages/shared, generate the Prisma client, prepare Nuxt types
pnpm lint
pnpm typecheck
pnpm test            # set CLOSEUP_TEST_INFRA=1 to include tests that need Postgres and Redis
pnpm --filter @closeup/web generate    # the production build: static files in .output/public
```

Source folders are bind-mounted into the containers, so edits in `apps/*/src|app` reload.
**Limit:** `packages/shared` is consumed from its build. After changing it, run
`docker compose restart api worker web` (or `pnpm build:shared` on the host).

## Layout

```
apps/web          Nuxt 4 (code in app/), Pinia, @nuxtjs/i18n (fr, en), PWA
apps/api          NestJS 12 (ESM). Two entry points: main.ts (REST + Socket.io), worker.ts (BullMQ)
  prisma/         schema and migrations
  src/game/       gateway now; the pure game engine and rooms arrive in phases 1 and 2
  src/pipeline/   the `media` queue and its processor
packages/shared   game constants, pure rules (round value, zoom level, clock sync), zod schemas
                  for the socket and REST contracts, brand, protocol version
```

REST and the socket both live under `/api` (`/api/socket.io`), so one reverse-proxy rule covers
everything. The socket namespace is `/game`; clients send `protocolVersion` in the handshake and
are refused with `PROTOCOL_MISMATCH` when it is stale.

## Decisions worth knowing

- **Nuxt 4, not 3.** Nuxt 3 reached end of life on 31 July 2026. Same Vue 3 / Pinia / i18n stack;
  application code sits in `app/`.
- **The API is ESM.** NestJS 12 ships as ESM: `module: nodenext`, relative imports end in `.js`.
- **TypeScript 6.0, not 7.** `typescript-eslint` does not support the native 7.x compiler yet.
- **Prisma is pinned to 7.10.0.** The `prisma` CLI's `latest` tag currently points at an 8.0
  release candidate. The client is generated into `apps/api/src/generated` (git-ignored).
- **pnpm's release-age guard is on** (`minimumReleaseAge: 1440`): nothing published in the last
  24 hours gets installed. Dependency ranges are kept loose so pnpm can fall back on its own.
  Build scripts are allow-listed one by one in `pnpm-workspace.yaml`.
- **BullMQ gets connection options, never a client instance** — it then owns and closes its
  connections. `QueueEvents` is the exception (see `health/worker-probe.ts`): its `close()` waits
  for a ready connection, which would hang shutdown whenever Redis is down.
- **Health checks have timeouts.** ioredis queues commands while disconnected, so a naive `PING`
  against a dead Redis never returns.
- **The web app is client rendered (`ssr: false`) and ships as static files.** Production has no
  Node process for the web, so nothing can run server side anyway. Rendering the status page on
  the server made it disagree with the browser about the language (hydration mismatches). The
  landing page will opt back into prerendering through `routeRules`. The static build relies on
  the `200.html` SPA fallback: Caddy will need `try_files {path} /200.html` (phase 9).
- **Default locale is French** (unprefixed URLs); browsers that are neither French nor English
  get English. `alwaysRedirect` is on because the PWA always starts on `/`: without it, someone
  who chose English would land on the French page at every launch.
- Bonus costs, early round end and the private mini-lens in big-screen mode were decided with the
  plan; their numbers are in `packages/shared/src/constants/game.ts`.

## Not done yet (phase 0)

- No game, no rooms, no content, no accounts, no admin: phases 1 to 10 of the brief.
- No design. The status page is deliberately bare; two design directions are presented at the
  start of phase 1 and this page goes away.
- Socket contract: only `time:ping` is wired. Other client → server payloads have schemas;
  server → client schemas come with the phase that first emits them.
- PWA: manifest and service worker registration only, with a placeholder SVG icon. Real icons,
  the offline screen and installability checks belong to phase 9.
- No production Compose file, no Caddy, no deployment guide (phase 9).
- No hot reload for `packages/shared` inside the containers (see the limit above).
- CI is written for GitHub Actions but has never run: the repository has no remote yet.
