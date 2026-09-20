# closeup

Multiplayer party game for the web: everyone sees an extreme close-up that slowly zooms out, and
races to guess what it is. `closeup` is a codename; the player-facing name lives in one place
(`packages/shared/src/brand.ts`, overridable with `CLOSEUP_DISPLAY_NAME`).

- The brief: [docs/brief.md](docs/brief.md)
- The validated solo prototype: [docs/prototype/gros-plan.html](docs/prototype/gros-plan.html)

**Status: phase 5 (back-office and image pipeline) done.** `/admin` is where the owner makes
the game's content: packs and cards, image upload (checked, stripped of EXIF, resized, original
kept private), zoom points placed by hand with a live preview of the four levels, or proposed
from face landmarks for people, credits that are required before anything goes live, and a
one-click switch that takes a pack out of running games. That comes on top of the big screen
with phones as controllers, private rooms, solo training, the eleven bonuses, maluses and steals,
and the choice between decaying and **fixed points**. 22 original seed cards.

## Run it

Requirements: Docker, and for anything outside Docker Node ≥ 22.19 (`nvm use`) with pnpm through
Corepack (`corepack enable`).

```sh
cp .env.example .env        # then change any host port that is already taken on your machine
docker compose up --build
```

Open `http://localhost:3000` (or your `WEB_PORT`), pick a number of rounds and how you answer, and
play. For a party around one screen, open the site on the TV or the laptop and choose "Use this
device as the screen": it shows a QR code, and the first phone to join holds the room. A host
who already has a room can also pick "On a big screen" in the lobby and open the address shown. On first start the API seeds the cards and the worker cuts their crops (about 20 s); the
files land in `data/media/`, a plain folder you can browse. `/status` is the technical page from
phase 0: six rows that must read "en ligne"; stop Redis and it says so within five seconds.

**The back-office** has no default account and no sign-up form. Create the owner's admin once
the stack is up, then open `/admin`:

```sh
docker compose exec -e ADMIN_EMAIL=you@example.org -e ADMIN_PASSWORD='a long passphrase' \
  api pnpm --filter @closeup/api admin:create
```

Running it again for the same address resets the password and ends its sessions. A pack made
there is private until you make it public; a card goes live only with an image, two to five zoom
points, answers in both languages and a credit.

Changing the game's name: set `CLOSEUP_DISPLAY_NAME=Whatever` in `.env` and run
`docker compose up -d web`. The page title, the PWA manifest and every translated string follow.

Scripts that check a running stack from the host:

- `pnpm smoke` — REST, worker round trip, web shell, manifest, clock sync, refusal of a stale
  client, then **a whole solo game** in multiple-choice mode (guest cookie, room, crops served and
  forged URL refused, scoring, reveal, personal best). Exits 1 on a failure.
  It then plays **a two-player party**: lobby, host-only settings, a synced round, a dropped
  connection that resumes in the same round, early end, ranking, play again; a three-player
  round where the fastest earns a bonus and plays it; and **a big-screen game**: room opened from
  the screen, first phone holds it, no start without a screen, image to the screen only.
  With `SMOKE_ADMIN_EMAIL` and `SMOKE_ADMIN_PASSWORD` in `.env` it also checks **the
  back-office**: login, the guard, an upload through the worker, crops, the credit rule.
- `pnpm --filter @closeup/api face:check portrait.jpg` (after a build) — what the face detector
  finds on one image and the zoom points it would propose. Keep such images out of the repo.
- `pnpm bot AB2CD [nickname] [how many]` — stand-in players that join a room by its code, to try
  a game with friends on your own. They answer by themselves in multiple-choice rooms; in
  typed-answer rooms they cannot know and let the clock run. Ctrl+C makes them leave. With
  `--host`, in a room they are the first to enter (one opened from a big screen), the bot that
  holds the room picks multiple choice and starts: enough to watch `/screen/CODE` on your own.
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

Added in phase 2:

- **Joining again is how a player reconnects.** Same id, same seat, same score: there is no
  separate "reconnect" path to get wrong. A player is offline when their _last_ socket in the
  room closes (two tabs), keeps their seat for 60 s, then the lobby frees it while a running game
  keeps their score and lets them back later.
- **The host role goes to the longest-present connected player** once the host has been gone
  for 60 s, or at once if they leave on purpose.
- **Offline players never hold a round.** The early end waits for the connected players of that
  round only; someone who joins mid-round watches it and plays from the next one.
- **The deck is drawn when the game starts**, not when the room is created: the lobby can still
  change the number of rounds.
- **The nickname is asked when creating or joining a room**, stored on the player and in
  `localStorage` so it is prefilled next time. Two players never read the same in a ranking
  ("Awa", "Awa 2"): the first free suffix is used, whatever order they arrive in.
- **Lobby settings are sent as a whole from a local draft.** Built from the store, two quick
  choices overwrote each other, because the echo of the first had not come back yet.
- **The QR code is an `<img>` with a data URL**, not injected markup.

Added in phase 3:

- **Bonuses are earned, never bought with score**: every third correct answer in a row, being the
  fastest of a round (from three players), being last at the end of a round (from the second
  round, from three players, and only if someone is ahead). Three at most per player. Every
  number is in `packages/shared/src/constants/game.ts`, draw weights included.
- **Using a self bonus lowers what the current round is worth for that player** (owner's
  decision, as in the prototype): zoom out 150, second zone 100, initials 200, category 100,
  remove two 150. Points already scored are never touched. Shield, maluses and steals are free.
- **The draw leaves out what makes no sense in the room**: attacks and steals in solo training,
  "remove two" when answers are typed.
- **A refused bonus stays in the inventory** (busy target, nothing to steal, already at the widest
  view). The order is check, spend, apply: a stolen bonus needs the room that spending the steal
  just made.
- **One malus per target at a time; freeze is enforced on the server** (`FROZEN`), not just greyed
  out in the browser. The shield stays armed across rounds until it absorbs a malus or a steal,
  and takes the attacker's bonus with it.
- **Stealing points moves 30%** of what the victim scores this round, rounded to 10; it is
  announced when it is set up and again, with the amount, when the victim scores.
- **Only the _count_ of someone's bonuses is public.** Items, hints and a bought zoom level go
  through a per-player Socket.io channel (`room:CODE:player:ID`). Hints are derived in `view.ts`
  from secrets that stay on the server: the initials bonus sends `T···  E·····`, never the answer.
  Private events name their recipient twice (on the effect and by their type), so a forgotten
  `to` cannot broadcast one.
- **A zoom-out keeps its owner one level ahead of the room**, up to the fourth level, which only
  a bonus reaches. The client keeps crops sorted and shows the widest: the room's narrower level
  still arrives afterwards.
- **The second lens sits beside the value, never over the main lens**, whose ring is the timer.
- **Sabotage is public on purpose**: a one-line feed says who did what to whom. It always uses
  nicknames, the viewer's included, which avoids a second set of sentences per language.
- **Fixed points** (owner's request): 1000, 800, 600, then 500 by order of arrival, whatever the
  clock says. Penalties and the floor of 100 still apply. A host setting next to the rounds and
  the answer mode; the live value then shows what the _next_ finder gets.

Added in phase 4:

- **A shared screen is a spectator, not a player.** It joins with `role: 'screen'`, never reaches
  the game engine, needs no nickname, and every game command from its socket is refused. The
  engine still does not know what a screen is; the display mode only changes who receives what.
- **The image goes to the screens only.** In big-screen mode `round:start` and `round:level` are
  built twice, with the crop for `room:CODE:screens` and without it for `room:CODE:players`. The
  phone payload is built without the crop, never stripped of it afterwards. This is the contract
  of the mode, not a secret: anyone with the code may open a screen.
- **`display` is a lobby setting** like the rounds, so a host can create a room on their phone
  and move it to the TV afterwards. A big-screen game does not start without a connected screen
  (`NO_SCREEN`, checked on the server and shown in the lobby), and a controller says so when the
  screen drops mid-game. Up to four screens per room.
- **A room can be opened from the screen itself** (addition to the brief, easy to remove: see
  `openedBy` in `POST /api/rooms`). Nobody plays on that device, so the room starts without a
  host and **the first player to join holds it**. Its empty lobby survives 15 minutes (the TV
  still shows the code) where a normal room is dropped at once; when it is dropped the screen
  hears `room:closed` and offers to open another. Without this, a host creating the room on the
  laptop became a player on the laptop, which is the one device they do not want to play on.
- **Private visual bonuses show in a small lens on the phone** (owner's decision): a zoom-out
  puts its owner one level ahead in their own lens while the shared screen keeps the room's
  level. The controller's lens is otherwise empty and only keeps time.
- **Maluses hit the controls**: on a controller, blur and flip apply to the answer input or the
  option grid, never to the shared screen. Freeze was already enforced on the server.
- **The ranking is live**: the scorer's new total (and the thief's) is broadcast when the answer
  lands, not only at the reveal. Found by looking at the big screen, where a "+630" next to a
  total of 0 was plain to see.
- The screen asks for a wake lock (a TV that sleeps mid-round ends the party) and offers full
  screen. `PROTOCOL_VERSION` is now 2: a cached client from before gets "reload".

Added in phase 5:

- **Admin accounts before player accounts.** `User`, `Session` and the argon2id login are the
  real thing, used by the owner only for now; phase 6 opens them to players instead of replacing
  a throwaway. Sessions work like device tokens: an opaque token in an httpOnly `SameSite=Lax`
  cookie, only its hash in the database. No default admin exists; `admin:create` is the way in.
- **A login never says which half was wrong**, costs the same time for an unknown address (a
  decoy hash is verified), and is counted in Redis: 5 failures per address, 20 per IP, per
  quarter of an hour. Without Redis there is no counter, so the door stays shut (503).
- **Every `/api/admin` route is behind one guard** (live session, role, not banned). It also
  refuses a change whose `Origin` is another site: a file upload is the one request a foreign
  form can send without a preflight.
- **An upload has two gates.** The API only checks what is cheap (size, first bytes of the file,
  rights confirmed), parks the file under a private key and queues a job. The worker does the
  real test, decoding it: bounded pixel count (decompression bombs), JPEG/PNG/WebP only, no
  animation, at least 600 px. It stores an upright copy of at most 4096 px **without any
  metadata** (no GPS, no camera serial), and deletes the uploaded bytes. `sharp` still never
  loads in the API.
- **A job that fails for good releases its card** with a message. Found by a test: the Compose
  worker took a test's job and the card stayed in "processing" for ever. Tests now use their own
  queue prefix (`QUEUE_PREFIX`), and the failure path exists for real crashes.
- **Face landmarks: `@vladmandic/face-api` on the tfjs WASM backend**, behind a
  `FaceLandmarkDetector` interface. Same models as the prototype, so the same feel; no native
  binding (`tfjs-node` has no Node 22 binary and breaks on Apple Silicon), no Python sidecar
  (MediaPipe has no Node support); models and `.wasm` files come from the npm packages, nothing
  from a CDN. About 200 ms per image on a laptop, models loaded on first use. Known limit: the
  face-api repository is archived; `@vladmandic/human` is the planned replacement if needed.
- **Detection proposes, the admin disposes.** No face, several faces or a face under 70 px
  between the eyes are warnings, never refusals; proposals are stored next to the card, not as
  zoom points. When detection fails, "place from the eyes" rebuilds the six zones from two clicks
  with the prototype's ratios (`fromEyes`, shared by the worker and the admin).
- **The preview is the crop.** `cropPlan` moved to `packages/shared`: the worker cuts the real
  crops with it and the admin draws the four levels with it, from the image already loaded, so
  it follows a point while it is dragged.
- **One publication rule for every producer** (`publishBlockers`, shared): image, rights
  confirmed for uploads, author and licence, answers in French and English, two to five zoom
  points with all their crops. The seed asks to go live when done; an admin card waits in
  "ready" until published, and leaves the game by itself if its credit or an answer is removed.
- **Disabling a pack is immediate** because every round re-checks the pack of its card before
  it starts (phase 1). Celebrity and character packs are created `restricted`.
- **Who did what** is written to `AuditLog`. The back-office pages are `noindex`.

## Not done yet (after phase 5)

- Back-office: driven in desktop Chromium only. The zoom editor takes pointer events, so it
  should work on a tablet, but it was not tried; on a phone it is usable, not pleasant.
- Face detection was checked on one public-domain portrait (a painting) and on pictures without
  a face. **Not measured on the target VPS**: memory with the models loaded is about 300 MB in
  the worker, and speed on a small shared CPU is unknown.
- A public pack's cards join one global deck: rooms cannot choose packs, categories or
  difficulty yet, so a pack made public is in everybody's games at once.
- No credits page per pack yet (it comes with the public catalogue in phase 8), no moderation
  queue (nothing can be submitted or reported before phases 7 and 8).
- No password reset by e-mail (phase 6, with the SMTP setting): `admin:create` resets it.
- `request.ip` is the proxy's address behind Caddy until "trust proxy" is set in phase 9; the
  per-IP login limit then counts everybody together (the per-address limit still works).

- Big screen: driven by script and bots in desktop Chromium (1280×720 for the screen, phone size
  for a controller). **Not tried on a real TV**, through a cast, or with real phones; text sizes
  use viewport units and were only judged on a laptop screen.
- The host's controls stay on their phone: the shared screen has no "start" or "skip" button,
  on purpose (nobody holds the TV's mouse). A keyboard shortcut on the screen could come later.
- The "category" bonus is always in the draw: rooms cannot be limited to one category yet, which
  is the only case where it should be left out.
- Bonus UI was driven by script in desktop Chromium at phone size, with bots as opponents: not
  yet played by several humans, nor on a real phone.

- Games are not written to the database yet (`Game`, `GameParticipant`): nothing reads them
  before stats and rankings in phase 6. Only the solo personal best is stored.
- No nickname filter, reports or bans: phase 7, with public matchmaking.
- The room language is the host's at creation time and cannot be changed in the lobby; packs,
  categories and difficulty are not host settings yet (the seed has three small packs).
- A room lives in one API process. That is the intended v1 deployment (one small VPS); several
  instances would need the Socket.io Redis adapter and a lock per room.
- Seen once while driving the browser by script and not reproduced since: a game that started
  without a scripted click, and a "play again" click with no effect. Both server paths are
  covered by `pnpm smoke`; worth keeping an eye on during review.
- Accounts (6), public matchmaking (7), player packs (8), deployment (9), Wikimedia importer
  (10).
- **Not verified on a real iPhone.** The keyboard handling (`visualViewport` sets the screen
  height, 17 px input so Safari does not zoom) follows the known recipe but was only exercised in
  desktop Chromium at phone size.
- The pick of rounds and cards is uniform: difficulty and category filters are in the data model,
  not in the room settings yet.
- PWA: manifest and service worker registration only, with a placeholder SVG icon. Real icons,
  the offline screen and installability checks belong to phase 9.
- No production Compose file, no Caddy, no deployment guide (phase 9).
- No hot reload for `packages/shared` inside the containers (see the limit above).
- CI (GitHub Actions) runs lint, typecheck, the migration and every test against real Postgres
  and Redis services. It does not build the Docker image or run `pnpm smoke` yet.
