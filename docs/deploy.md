# Deploying Loupette

One small VPS, one Docker Compose stack, one domain. Caddy is the only door: it gets the
certificate, serves the built game and passes `/api` to the API. Nothing else is exposed.

This is written for someone deploying for the first time. It takes about half an hour.

## What you need

- A VPS with **4 GB of RAM**, 2 vCPU and 40 GB of disk, running a recent Debian or Ubuntu.
  The game itself is modest: about 1.8 GB with everything running and the worker cutting crops.
  What needs room is **building the images on the machine** (the Nuxt build alone reaches 1.5 to
  2 GB), which is why 4 GB wants the swap file below. 8 GB skips that worry entirely.
- **SSH access by key.** If the provider delivered the machine with a password, put your key on
  it first (`ssh-copy-id you@the-ip`), check that it works, and only then turn password login
  off. A server with a password and port 22 open is found by scanners within the hour.
- A **domain** pointing at the machine: an `A` record on the IPv4 address, and an `AAAA` record
  if the machine has IPv6. Let's Encrypt checks it, so it must resolve before you start.
  A freshly bought domain usually comes with its registrar's own records already in place, so
  expect to **change** the `A` of the bare domain and of `www` rather than create them. Caddy
  serves both names, redirecting `www` to the bare domain.
  If you add a `CAA` record — and you should — allow **both** authorities Caddy uses, or you
  lose its fallback without noticing:

  ```
  loupette.fr.  CAA  0 issue "letsencrypt.org"
  loupette.fr.  CAA  0 issue "sectigo.com"
  ```

  Caddy asks Let's Encrypt first and falls back to ZeroSSL, which issues through Sectigo. With
  only the first line, the day Let's Encrypt is unreachable the fallback is refused by your own
  DNS. Nothing breaks while Let's Encrypt answers, which is exactly what makes it easy to miss.

  If the zone carries an SPF record ending in `-all` (registrars add one with their mailboxes),
  remember it before setting up outgoing e-mail: the provider that sends for you must be added
  to that same record, never to a second one.

- An **SMTP account** if you want password-reset and address-confirmation e-mails to leave.
  Without one the stack runs, and those messages are simply not sent (see below).

## 1. The machine

Log in as whatever account the provider gave you. Most disable direct `root` login and deliver a
user with `sudo`: `ubuntu` on Ubuntu images, `debian` on Debian ones. Everything below runs as
that user, which is why it says `sudo`.

```sh
ssh ubuntu@your-server-ip
```

**Swap first, before anything else.** On a 4 GB machine a build that runs out of memory is killed
rather than slowed, and most VPS images ship with no swap at all:

```sh
sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
# Swap is the safety net, not the plan: only lean on it under pressure.
sudo sysctl -w vm.swappiness=10
# A drop-in, not /etc/sysctl.conf: recent Ubuntu images no longer ship that file.
echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/99-swappiness.conf
```

Then Docker, and an account for the game so that it does not run out of your own home:

```sh
curl -fsSL https://get.docker.com | sudo sh
sudo adduser --disabled-password --gecos '' closeup
sudo usermod -aG docker closeup
# Your key, so you can reach that account directly:
sudo install -d -m 700 -o closeup -g closeup /home/closeup/.ssh
sudo cp ~/.ssh/authorized_keys /home/closeup/.ssh/
sudo chown closeup:closeup /home/closeup/.ssh/authorized_keys
```

Leave only what is needed open:

```sh
sudo ufw allow OpenSSH && sudo ufw allow 80 && sudo ufw allow 443 && sudo ufw enable
```

Then, **from a second terminal that is already logged in with your key**, turn password login off.
Keep that session open until a fresh `ssh` works: it is your way back if something is wrong,
along with the provider's web console.

```sh
printf 'PasswordAuthentication no\nKbdInteractiveAuthentication no\nPermitRootLogin no\n' \
  | sudo tee /etc/ssh/sshd_config.d/99-hardening.conf
sudo sshd -t && sudo systemctl reload ssh
```

Postgres, Redis and the API are on a private Docker network and have **no published ports**:
they are not reachable from outside, and that is on purpose.

## 2. The stack

The repository is private, so the machine needs its own read-only access. Make a deploy key on
the server and hand GitHub the public half:

```sh
su - closeup
ssh-keygen -t ed25519 -f ~/.ssh/github_deploy -N ''
cat ~/.ssh/github_deploy.pub
printf 'Host github.com\n  IdentityFile ~/.ssh/github_deploy\n' >> ~/.ssh/config
```

Paste that public key into **GitHub → the repository → Settings → Deploy keys → Add deploy key**,
and leave "Allow write access" **unticked**: the server only ever reads. A deploy key is scoped to
one repository, which a personal access token is not.

```sh
git clone git@github.com:CoulibalyT/closeup.git && cd closeup
cp .env.prod.example .env
```

Fill in every line of `.env`. Four of them decide whether the stack starts at all:

| Setting              | What it is                                                     |
| -------------------- | -------------------------------------------------------------- |
| `CLOSEUP_DOMAIN`     | The domain Caddy answers on, and asks a certificate for        |
| `CLOSEUP_ACME_EMAIL` | Where Let's Encrypt writes if a certificate is about to expire |
| `POSTGRES_PASSWORD`  | Generated, see below                                           |
| `MEDIA_SECRET`       | Generated, see below                                           |

The two secrets are generated, not invented:

```sh
openssl rand -hex 32      # POSTGRES_PASSWORD
openssl rand -base64 32   # MEDIA_SECRET
```

**Hex for the database password, not base64.** It ends up inside `DATABASE_URL`, and base64
contains `/` and `+`: the URL no longer parses, and the `migrate` container fails with
`P1013: invalid port number`. If that already happened, the password is baked into the
database volume on its first start, so changing `.env` is not enough — on a fresh install with
nothing to lose, `docker compose -f docker-compose.prod.yml down -v` and start again.

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

Then open `https://loupette.fr/admin` and make some cards. Running `create-admin` again for the
same address resets its password and ends its sessions.

If you script these steps instead of typing them (`ssh server 'bash -s' < steps.sh`), add
`-T` and `< /dev/null` to every `exec`: `docker compose exec` reads its standard input, and in a
piped script that input _is the rest of the script_. It swallows every line after it, and the
script ends early without an error.

## 4. E-mail

Set `SMTP_URL` in `.env` and restart the API:

```
SMTP_URL=smtp://apikey:the-key@smtp.example.org:587
MAIL_FROM=Loupette <no-reply@loupette.fr>
```

Without it nothing is sent: in production the API logs a warning and carries on. Players can
still sign up and play; only "forgot my password" and the address confirmation stop working,
which means an account whose password is lost cannot be recovered. Port 25 is blocked on most
VPS providers, so use the submission port (587) of a transactional provider.

Add the provider to the SPF record (and DKIM, which they will give you) or the messages land in
spam. If the zone already has an SPF — registrars add one for their own mailboxes — fold the
provider into **that** record; a second SPF record breaks both:

```
loupette.fr.  TXT  "v=spf1 include:mx.ovh.com include:spf.your-provider.example -all"
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
# Both stream to stdout and are written by this shell, as `closeup`. Mounting ~/backups into
# the container instead fails: it runs as `node`, which cannot write to a folder it does not own.
$C exec -T postgres pg_dump -U closeup closeup < /dev/null | gzip > "$HOME/backups/db-$STAMP.sql.gz"
$C run --rm --no-deps -T --entrypoint sh api -c 'tar czf - -C /data media' \
  < /dev/null > "$HOME/backups/media-$STAMP.tar.gz"
# Keep a fortnight here; the copy that matters is the one somewhere else.
find "$HOME/backups" -name '*.gz' -mtime +14 -delete
SH
chmod +x ~/backup.sh
~/backup.sh && ls -lh ~/backups   # once by hand: a backup that was never run is a guess
# `|| true`: on the first install the crontab is empty, grep finds nothing and exits 1.
{ crontab -l 2>/dev/null | grep -v backup.sh || true
  echo '15 4 * * * $HOME/backup.sh >> $HOME/backups/cron.log 2>&1'; } | crontab -
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
curl -s https://loupette.fr/api/health/ready | jq    # Postgres and Redis, seen from the API
```

The status page at `https://loupette.fr/status` says the same thing in the browser, including
whether the worker is consuming its queue.

A few failures that look like bugs and are not:

| What you see                                  | What it is                                                   |
| --------------------------------------------- | ------------------------------------------------------------ |
| Caddy retries the certificate                 | The domain does not resolve to this machine yet              |
| `MEDIA_SECRET must be set to a private value` | `.env` still has the development default                     |
| Cards stay in "processing"                    | The worker is down, or out of memory. Its log says which     |
| Nobody can log in, 503                        | Redis is down: the login limiter refuses rather than opening |
| Images 404 immediately                        | The media volume is empty — restore it, or re-seed           |
