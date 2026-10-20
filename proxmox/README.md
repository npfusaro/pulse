# Pulse on Proxmox VE

An LXC installer for the Pulse server (recovery, strain and sleep from a Fitbit Air; Next.js + PostgreSQL), in the
style of the [community-scripts](https://community-scripts.org) helpers. It installs **natively** — PostgreSQL 17,
Node 24, the app built from git and run by systemd — no Docker inside the container. It builds Nick's fork at
`https://github.com/npfusaro/pulse`, branch `feat/backfill-days-and-spo2` (configurable `BACKFILL_DAYS`,
minute-by-minute SpO2), and starts in **demo mode**.

```
ct/pulse.sh              host side: creates the container (community-scripts convention), holds update_script()
install/pulse-install.sh inside the container: PostgreSQL, Node, build, .env, systemd service
standalone/pulse-lxc.sh  host side, self-contained: `pct` only, runs the same install script with a shim
```

## Run it

### A. Self-contained (recommended for a personal fork)

From the Proxmox host shell, with nothing installed beyond what Proxmox ships (no git needed):

```sh
bash -c "$(wget -qLO - https://raw.githubusercontent.com/npfusaro/pulse/feat/backfill-days-and-spo2/proxmox/standalone/pulse-lxc.sh)"
```

It fetches `install/pulse-install.sh` from the same branch and needs nothing from community-scripts. From a checkout
of this folder, `bash standalone/pulse-lxc.sh` works the same way.

Defaults: next free CTID, hostname `pulse`, Debian 12, 2 vCPU, 2048 MB, 8 GB on `local-lvm`, DHCP on `vmbr0`,
unprivileged. Override with environment variables:

```sh
CTID=120 STORAGE=local-zfs BRIDGE=vmbr0 IP=192.168.1.50/24 GW=192.168.1.1 RAM=3072 bash standalone/pulse-lxc.sh
```

### B. Community-scripts style

`ct/pulse.sh` follows the community-scripts convention (it sources their `build.func`, which builds the container and
then fetches `install/pulse-install.sh` **from a raw GitHub URL relative to the script repository**). So the two files
have to be hosted together in a repository with the same layout (`ct/`, `install/`), and the loader has to be told
to use that repository instead of `community-scripts/ProxmoxVE`:

```sh
# On the Proxmox host. COMMUNITY_SCRIPTS_URL is the raw-content base the loader fetches install/<app>-install.sh from;
# this folder lives at proxmox/ in the pulse fork, so that base has to end in /proxmox.
export COMMUNITY_SCRIPTS_URL=https://raw.githubusercontent.com/npfusaro/pulse/feat/backfill-days-and-spo2/proxmox
bash -c "$(wget -qLO - https://raw.githubusercontent.com/npfusaro/pulse/feat/backfill-days-and-spo2/proxmox/ct/pulse.sh)"
```

The variable name comes from community-scripts' [Script Origin](https://community-scripts.org/docs/guides/source_origin)
guide; their loader is being split into a "Core" and a scripts repository, so check that page if the override is
ignored. Option A avoids the question entirely and is the one to use.

`PULSE_REPO` and `PULSE_BRANCH` (both scripts) point the build at another fork or branch.

## What it creates

| Where | What |
|---|---|
| `/opt/pulse` | the git checkout; `.next/standalone` is what runs (static assets, `public/`, `drizzle/` migrations and the bundled admin scripts copied in, as the repo's Dockerfile does) |
| `/opt/pulse/.env` | the configuration (mode 600, owner `pulse`) |
| `/root/pulse.creds` | the PostgreSQL password and the session secret |
| `pulse.service` | systemd unit, user `pulse`, `EnvironmentFile=/opt/pulse/.env`, port 3000, restarts on failure |
| PostgreSQL 17 (PGDG) | role `pulse`, database `pulse`, small buffers as in the repo's `compose.yaml` |
| `/opt/pulse_version.txt` | the git commit built |

Migrations run when the service starts (`src/instrumentation.ts`); the app refuses to start if they fail, and
`journalctl -u pulse -e` says why. Health check: `curl http://<ip>:3000/healthz`.

Demo mode: open `http://<ip>:3000` and **Continue with demo data** (`demo@pulse.local` / `pulse-demo-generated-data`).

## Switch to your own Fitbit data (Google mode)

Google's OAuth needs an **HTTPS hostname** your phone can open (no raw IP, no plain http), so first give the container
one: a reverse proxy with a certificate (Caddy, nginx, Nginx Proxy Manager — forward `X-Forwarded-For` and
`X-Forwarded-Proto`, and turn off response buffering for `/api/coach`), or Tailscale (`tailscale serve --bg 3000`
inside the container; in an unprivileged LXC add `lxc.cgroup2.devices.allow: c 10:200 rwm` and the `/dev/net/tun`
mount entry to the container's config on the host). Details: `/opt/pulse/docs/setup.md` §3 and
`/opt/pulse/docs/other-setups.md`.

Then create the Google OAuth client (`/opt/pulse/docs/setup.md` §4: a Cloud project, enable **Google Health API**,
the consent screen with the scopes listed there, yourself as a test user, audience **In production**, a **Web
application** client with redirect URI `https://<your-host>/oauth/callback`), and edit `/opt/pulse/.env`:

```sh
nano /opt/pulse/.env
```

```sh
DATA_SOURCE=google
ADMIN_EMAILS=you@example.com                  # the email you will sign up with; the first account owns the server
GOOGLE_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=...
APP_URL=https://<your-host>
BACKFILL_DAYS=365                             # optional, 1-3650, default 180; raise it later and the next sync fills in
```

```sh
systemctl restart pulse
```

Open `https://<your-host>`, **sign up right away** with the `ADMIN_EMAILS` address, go through onboarding, then
Settings → **Connect Google** and allow everything. On the phone, open the address in Chrome → **Add to Home screen**.

## Update

From the Proxmox host, run the ct script again and choose **Update** (community-scripts convention), or inside the
container do what `update_script()` does:

```sh
pct enter <ctid>
cd /opt/pulse && git fetch origin && git reset --hard origin/feat/backfill-days-and-spo2
export NODE_OPTIONS=--max-old-space-size=1536 GIT_SHA=$(git rev-parse HEAD) NEXT_TELEMETRY_DISABLED=1
pnpm install --frozen-lockfile && pnpm build
rm -rf .next/standalone/.next/static .next/standalone/public .next/standalone/drizzle
cp -r .next/static .next/standalone/.next/static && cp -r public .next/standalone/public && cp -r drizzle .next/standalone/drizzle
chown -R pulse:pulse /opt/pulse && systemctl restart pulse
```

`update_script()` also takes a `pg_dump` into `/opt/pulse-backups` first. For regular backups:
`sudo -u postgres pg_dump -Fc pulse > pulse-$(date +%F).dump` (restore with `pg_restore -U pulse -d pulse`).

## Admin scripts

As in the Docker setup (`/opt/pulse/docs/admin.md`), bundled copies live next to the server:

```sh
cd /opt/pulse/.next/standalone
sudo -u pulse env $(grep -v '^#' /opt/pulse/.env | xargs) node scripts/reset-password.mjs <email-or-username>
sudo -u pulse env $(grep -v '^#' /opt/pulse/.env | xargs) node scripts/seed-user.mjs <username>
```

## Sizing

`pnpm build` is the heavy step: Next 16 peaks near 2 GB. The scripts cap V8 at 1.5 GB (`NODE_OPTIONS`), and the
standalone script gives the container 512 MB of swap. If the build is killed, raise RAM for the install
(`RAM=3072` / `var_ram=3072`) and lower it afterwards: at runtime Pulse idles around 100–150 MB and PostgreSQL under
100 MB, so `pct set <ctid> --memory 1024` is plenty.
