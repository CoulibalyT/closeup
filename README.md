# closeup

Multiplayer party game for the web: everyone sees an extreme close-up that slowly zooms out, and
races to guess what it is. `closeup` is a codename; the player-facing name lives in one place
(`packages/shared/src/brand.ts`, overridable with `CLOSEUP_DISPLAY_NAME`).

- The brief: [docs/brief.md](docs/brief.md)
- The validated solo prototype: [docs/prototype/gros-plan.html](docs/prototype/gros-plan.html)

**Status: phase 1 (game engine and solo mode) done.** You can play solo training from the home
page: 22 original seed cards, free text or multiple choice, zoom-outs at 10 s and 20 s, reveal
with the zone and the credit, personal best. No multiplayer yet (phase 2).

## Run it

Requirements: Docker, and for anything outside Docker Node ≥ 22.19 (`nvm use`) with pnpm through
Corepack (`corepack enable`).

```sh
cp .env.example .env        # then change any host port that is already taken on your machine
docker compose up --build
```

Open `http://localhost:3000` (or your `WEB_PORT`), pick a number of rounds and how you answer, and
play. On first start the API seeds the cards and the worker cuts their crops (about 20 s); the
files land in `data/media/`, a plain folder you can browse. `/status` is the technical page from
phase 0: six rows that must read "en ligne"; stop Redis and it says so within five seconds.

Changing the game's name: set `CLOSEUP_DISPLAY_NAME=Whatever` in `.env` and run
`docker compose up -d web`. The page title, the PWA manifest and every translated string follow.

Scripts that check a running stack from the host:

- `pnpm smoke` — REST, worker round trip, web shell, manifest, clock sync, refusal of a stale
  client, then **a whole solo game** in multiple-choice mode (guest cookie, room, crops served and
  forged URL refused, scoring, reveal, personal best). Exits 1 on a failure.
- `node scripts/restart-check.mjs` (from `apps/api`) — restarts the API container in the middle
  of a round and expects the same round to still be playing afterwards.
- `pnpm --filter @closeup/api seed:sheet` (after a build) — contact sheet of the seed
  illustrations with their zoom points.

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
  app/stores/game.ts        everything the play screen knows, rebuilt from a server snapshot
  app/components/           LensTimer (the lens whose ring is the timer), ZoomStrip, AnswerForm,
                            ChoiceGrid, RevealPanel
  app/assets/css/main.css   the "Photomaton" design tokens, light and dark
apps/api          NestJS 12 (ESM). Entry points: main.ts (REST + Socket.io), worker.ts (BullMQ),
                  seed.ts
  prisma/         schema and migrations
  src/game/engine/    PURE, no Nest import: matching, reducer, view (the only exit to clients)
  src/game/rooms/     one actor per room: serial command queue, single timer, Redis persistence
  src/game/gateway/   Socket.io events, validated with the shared zod schemas
  src/content/        deck building, per-round card loading, multiple-choice distractors
  src/media/          storage driver, crop geometry, CropService (sharp), encrypted URL tokens
  src/identity/       guest devices (httpOnly cookie, hashed token)
  src/pipeline/       the `media` queue: `ping` and `card.process`
  src/seed/           22 illustrations drawn in code, and their cards
packages/shared   game constants, pure rules (round value, zoom level, clock sync), zod schemas
                  for the socket and REST contracts, brand, protocol version
```

How a round flows: `POST /api/identity/guest` sets the device cookie, `POST /api/rooms` creates
the room, then everything goes through the socket (`room:join`, `game:start`, `round:guess` or
`round:pick`, `reveal:skip`). The engine is a pure function
`reduce(state, command, { now, newId })`; the room actor runs it, applies its effects, persists
the state and re-arms the room's single timer. A client only ever receives what `view.ts` builds
through **strict** zod schemas, so a field that is not in the contract cannot leave the server.

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
- **Design direction: "Photomaton"** (chosen over "Tapis rouge"; both are in
  [docs/design/directions.html](docs/design/directions.html), open it in a browser). The four
  zoom levels are the four frames of a photo-booth strip: the strip is the level indicator during
  a round and prints in full on the reveal. Cool palette (sheet-metal grey, curtain blue, the
  booth's green and red lights), 4 px photo corners everywhere, the lens is the only round shape
  and is never cropped because its ring is the timer. Anybody (wide, heavy) for numbers and
  verdicts, Instrument Sans for everything that is read.
- Bonus costs, early round end and the private mini-lens in big-screen mode were decided with the
  plan; their numbers are in `packages/shared/src/constants/game.ts`.

Added in phase 1:

- **Answer matching was ported from the prototype, then tightened for short words.** The
  prototype's "one typo allowed" was validated on people's names; on objects it accepts "char"
  for "chat". Now: exact up to 4 letters, 1 typo up to 8, 2 beyond; two swapped neighbours count
  as one typo; leading articles are ignored ("l'orange"); "close" is capped at 40% of the answer
  length. A guess that is exactly _another card of the deck_ is never treated as a typo.
- **The engine does not know what a card depicts.** "Family name alone" is just an alias that
  authoring tools add for people; `isPerson` only exists for the image pipeline.
- **Media URLs are encrypted, not signed.** A signed id would be the same in every game, enough
  to build a cheat table. With AES-GCM and a random IV a crop never has the same URL twice. URLs
  live 45 s and every failure is the same 404.
- **Continuous zoom from discrete crops.** The client never has the full image. Each crop comes
  with `scaleFromPrev` and the focus point: the new level is shown scaled up to line up with the
  previous one, then eases back. The next level's URL is only sent when the server decides.
- **Set the score, never add to it.** The server broadcasts `round:end` before it acknowledges
  the answer; a client that increments on the ack counts the points twice (found in the browser).
- **Nothing waits on Redis without a timeout**, boot included: ioredis queues commands while
  disconnected. The "dependencies down" test caught both a hanging shutdown and a hanging boot.
- **Fonts are self-hosted** (`@fontsource-variable`): no request to a third party, and they work
  offline for the PWA.
- **`sharp` only loads in the worker and the seed**, never in the API process.

## Not done yet (after phase 1)

- Multiplayer: private rooms, lobby, ranking, host migration (phase 2). The engine and the view
  already handle several players and are tested that way, but nothing creates such a room.
- Bonuses, maluses, stealing (phase 3): the fourth zoom level exists as crops but no bonus reaches
  it yet, so the strip's last frame stays empty.
- Big screen (4), admin and uploads (5), accounts (6), public matchmaking (7), player packs (8),
  deployment (9), Wikimedia importer (10).
- **Not verified on a real iPhone.** The keyboard handling (`visualViewport` sets the screen
  height, 17 px input so Safari does not zoom) follows the known recipe but was only exercised in
  desktop Chromium at phone size.
- The pick of rounds and cards is uniform: difficulty and category filters are in the data model,
  not in the room settings yet.
- Nickname: solo guests are all called "Joueur"; the nickname field arrives with rooms.
- Face landmark detection is not written; the seed has no people. It belongs to phase 5.
- PWA: manifest and service worker registration only, with a placeholder SVG icon. Real icons,
  the offline screen and installability checks belong to phase 9.
- No production Compose file, no Caddy, no deployment guide (phase 9).
- No hot reload for `packages/shared` inside the containers (see the limit above).
- CI (GitHub Actions) runs lint, typecheck, the migration and every test against real Postgres
  and Redis services. It does not build the Docker image or run `pnpm smoke` yet.
