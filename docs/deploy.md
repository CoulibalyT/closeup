# Deploying closeup

One small VPS, one Docker Compose stack, one domain. Caddy is the only door: it gets the
certificate, serves the built game and passes `/api` to the API. Nothing else is exposed.

This is written for someone deploying for the first time. It takes about half an hour.

## What you need

- A VPS with **4 GB of RAM**, 2 vCPU and 40 GB of disk, running a recent Debian or Ubuntu.
  The game itself is modest: about 1.8 GB with everything running and the worker cutting crops.
  What needs room is **building the images on the machine** (the Nuxt build alone reaches 1.5 to
  2 GB), which is why 4 GB wants the swap file below. 8 GB skips that worry entirely.
- A **domain** pointing at the machine: an `A` record on the IPv4 address, and an `AAAA` record
  if the machine has IPv6. Let's Encrypt checks it, so it must resolve before you start.
  A freshly bought domain usually comes with its registrar's own records already in place, so
  expect to **change** the `A` of the bare domain and of `www` rather than create them. Caddy
  serves both names, redirecting `www` to the bare domain.
  If the zone carries an SPF record ending in `-all` (registrars add one with their mailboxes),
  remember it before setting up outgoing e-mail: the provider that sends for you must be added
  to that same record, never to a second one.
- An **SMTP account** if you want password-reset and address-confirmation e-mails to leave.
  Without one the stack runs, and those messages are simply not sent (see below).

## 1. The machine

```sh
ssh root@your-server
adduser closeup && usermod -aG sudo closeup
# Docker, from Docker's own repository (Debian/Ubuntu):
curl -fsSL https://get.docker.com | sh
usermod -aG docker closeup
```

Leave only what is needed open. With `ufw`:

```sh
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw enable
```

**On a 4 GB machine, give it swap before anything else.** Most VPS images ship without any, and
a build that runs out of memory is killed rather than slowed:

```sh
fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
# Swap is the safety net, not the plan: only lean on it under pressure.
sysctl -w vm.swappiness=10 && echo 'vm.swappiness=10' >> /etc/sysctl.conf
```

Postgres, Redis and the API are on a private Docker network and have **no published ports**:
they are not reachable from outside, and that is on purpose.

## 2. The stack

```sh
su - closeup
git clone https://github.com/CoulibalyT/closeup.git && cd closeup
cp .env.prod.example .env
```

Fill in `.env`. The two secrets are generated, not invented:

```sh
openssl rand -base64 32   # POSTGRES_PASSWORD
openssl rand -base64 32   # MEDIA_SECRET
```

`MEDIA_SECRET` signs the short-lived image URLs. The API refuses to start in production with the
development default, which is the point. Changing it later only invalidates the URLs in flight.

Then:

```sh
docker compose -f docker-compose.prod.yml up -d --build
```

The first build takes several minutes. What happens, in order: the images are built, Postgres and
Redis start, a one-shot `migrate` container applies the migrations and exits, the API starts and
becomes healthy, then the worker and Caddy. Caddy asks Let's Encrypt for a certificate on its
first start; if the domain does not resolve yet, it retries.

Watch it come up:

```sh
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f web
```

## 3. The content

The stack starts with an empty database: no cards, and no way in.

```sh
cd ~/closeup
export COMPOSE="docker compose -f docker-compose.prod.yml"

# The 22 original seed cards (drawings made for this repository, CC0).
$COMPOSE exec api node dist/seed.js

# Your own admin account. There is no default one, and no sign-up form for admins.
$COMPOSE exec -e ADMIN_EMAIL=you@example.org -e ADMIN_PASSWORD='a long passphrase' \
  api node dist/create-admin.js
```

Then open `https://your-domain/admin` and make some cards. Running `create-admin` again for the
same address resets its password and ends its sessions.

## 4. E-mail

Set `SMTP_URL` in `.env` and restart the API:

```
SMTP_URL=smtp://apikey:the-key@smtp.example.org:587
MAIL_FROM=closeup <no-reply@your-domain>
```

Without it nothing is sent: in production the API logs a warning and carries on. Players can
still sign up and play; only "forgot my password" and the address confirmation stop working,
which means an account whose password is lost cannot be recovered. Port 25 is blocked on most
VPS providers, so use the submission port (587) of a transactional provider.

Add an SPF record (and DKIM, which your provider will give you) or the messages land in spam:

```
your-domain.  TXT  "v=spf1 include:spf.your-provider.example ~all"
```

## 5. Backups

Two things matter, and neither is the disk image: **the database** and **the media folder**.
Everything else is rebuilt from the repository.

```sh
# A dump and a copy of the images, nightly.
mkdir -p ~/backups
cat > ~/backup.sh <<'SH'
#!/bin/sh
set -eu
cd "$HOME/closeup"
C="docker compose -f docker-compose.prod.yml"
STAMP=$(date +%F)
$C exec -T postgres pg_dump -U closeup closeup | gzip > "$HOME/backups/db-$STAMP.sql.gz"
$C run --rm -v "$HOME/backups:/backup" --entrypoint sh api -c \
  "tar czf /backup/media-$STAMP.tar.gz -C /data media"
# Keep a fortnight here; the copy that matters is the one somewhere else.
find "$HOME/backups" -name '*.gz' -mtime +14 -delete
SH
chmod +x ~/backup.sh
(crontab -l 2>/dev/null; echo "15 4 * * * $HOME/backup.sh") | crontab -
```

**A backup on the same machine is not a backup.** Send `~/backups` somewhere else — a storage
box over SSH with `restic` or `borg`, or your provider's object storage. Test a restore before
you need one:

```sh
gunzip -c ~/backups/db-2026-09-20.sql.gz | \
  docker compose -f docker-compose.prod.yml exec -T postgres psql -U closeup closeup
```

Redis holds the rooms and the queue. Losing it ends the games in progress and nothing else, so
it does not need a backup.

## 6. Updating

```sh
cd ~/closeup && git pull
docker compose -f docker-compose.prod.yml up -d --build
```

On a 4 GB machine, build with the stack stopped: `docker compose -f docker-compose.prod.yml down`
first, then the command above. It costs a few minutes of downtime and removes any chance of the
build being killed while Postgres and the worker hold their memory. Pick an hour when nobody is
playing — this is an evening game.

The `migrate` container applies any new migration before the API starts. Rooms live in Redis and
are recovered at boot, so a deploy in the middle of an evening interrupts the games for the few
seconds the API takes to come back, and they resume where they were.

Clean up old images now and then, or a 40 GB disk fills up faster than you would think: each
build leaves a layer behind. `docker system prune -f` after a deploy, and `docker system df` to
see where the space went.

## What this deployment assumes

- **One API process.** Rooms are held in memory and persisted to Redis, with one timer each.
  Running two API containers would give a room two owners. Several instances would need the
  Socket.io Redis adapter and a lock per room — worth doing when one machine is no longer
  enough, not before.
- **One machine.** Postgres, Redis, the worker and the web server share it. The worker is the
  hungry one; if cards stop being cut, look at memory first.
- **Caddy in front.** `TRUST_PROXY=1` is set in the production compose so that the per-IP limits
  count the visitor and not Caddy. Never set it if you expose the API directly: the header can
  be written by anybody.

## When something is wrong

```sh
C="docker compose -f docker-compose.prod.yml"
$C ps                        # who is up, who is restarting
$C logs --tail 100 api       # the server
$C logs --tail 100 worker    # images, crops, face detection
$C logs --tail 100 web       # Caddy, certificates
curl -s https://your-domain/api/health/ready | jq    # Postgres and Redis, seen from the API
```

The status page at `https://your-domain/status` says the same thing in the browser, including
whether the worker is consuming its queue.

A few failures that look like bugs and are not:

| What you see                                  | What it is                                                   |
| --------------------------------------------- | ------------------------------------------------------------ |
| Caddy retries the certificate                 | The domain does not resolve to this machine yet              |
| `MEDIA_SECRET must be set to a private value` | `.env` still has the development default                     |
| Cards stay in "processing"                    | The worker is down, or out of memory. Its log says which     |
| Nobody can log in, 503                        | Redis is down: the login limiter refuses rather than opening |
| Images 404 immediately                        | The media volume is empty — restore it, or re-seed           |
