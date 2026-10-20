#!/usr/bin/env bash

# Copyright (c) 2021-2026 community-scripts ORG
# Author: npfusaro
# License: MIT | https://github.com/community-scripts/ProxmoxVE/raw/main/LICENSE
# Source: https://github.com/npfusaro/pulse

# Installs Pulse natively (no Docker): PostgreSQL 17 from PGDG, Node 24 from NodeSource, pnpm via corepack, the app
# built from git into its Next.js standalone output and run by systemd as the `pulse` user. Production is assembled the
# way the repo's Dockerfile assembles it: .next/standalone + .next/static + public + drizzle (migrations run at boot
# from src/instrumentation.ts) + the esbuild-bundled admin scripts.

source /dev/stdin <<<"$FUNCTIONS_FILE_PATH"
color
verb_ip6
catch_errors
setting_up_container
network_check
update_os

PULSE_REPO="${PULSE_REPO:-https://github.com/npfusaro/pulse.git}"
PULSE_BRANCH="${PULSE_BRANCH:-feat/backfill-days-and-spo2}"
PG_VERSION="${PG_VERSION:-17}"
NODE_VERSION="${NODE_VERSION:-24}"

msg_info "Installing Dependencies"
$STD apt-get install -y curl git ca-certificates gnupg openssl sudo build-essential python3
msg_ok "Installed Dependencies"

msg_info "Installing PostgreSQL ${PG_VERSION}"
install -d -m 0755 /usr/share/keyrings
curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /usr/share/keyrings/postgresql.gpg
echo "deb [signed-by=/usr/share/keyrings/postgresql.gpg] http://apt.postgresql.org/pub/repos/apt $(. /etc/os-release && echo "$VERSION_CODENAME")-pgdg main" >/etc/apt/sources.list.d/pgdg.list
$STD apt-get update
$STD apt-get install -y "postgresql-${PG_VERSION}"
systemctl enable -q --now postgresql
msg_ok "Installed PostgreSQL ${PG_VERSION}"

msg_info "Setting up the database"
# Hex, not base64: the password goes into a postgres:// URL, where + / = would need escaping.
PG_PASS="$(openssl rand -hex 16)"
$STD sudo -u postgres psql -v ON_ERROR_STOP=1 -c "CREATE ROLE pulse WITH LOGIN PASSWORD '${PG_PASS}';"
$STD sudo -u postgres psql -v ON_ERROR_STOP=1 -c "CREATE DATABASE pulse WITH OWNER pulse ENCODING 'UTF8' TEMPLATE template0;"
# Small buffers for a home server, as compose.yaml sets them; Pulse is one app with a pool of 10.
$STD sudo -u postgres psql -v ON_ERROR_STOP=1 -c "ALTER SYSTEM SET shared_buffers = '64MB';" -c "ALTER SYSTEM SET max_connections = 30;" -c "ALTER SYSTEM SET work_mem = '4MB';"
systemctl restart postgresql
msg_ok "Set up the database"

msg_info "Installing Node.js ${NODE_VERSION}"
curl -fsSL "https://deb.nodesource.com/setup_${NODE_VERSION}.x" | $STD bash -
$STD apt-get install -y nodejs
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
# Node 24 still ships corepack (Node 25 dropped it); install it from npm when a newer Node is picked.
command -v corepack >/dev/null 2>&1 || $STD npm install -g corepack
$STD corepack enable
msg_ok "Installed Node.js $(node -v)"

msg_info "Creating the pulse user"
useradd --system --home-dir /opt/pulse --shell /usr/sbin/nologin pulse 2>/dev/null || true
msg_ok "Created the pulse user"

msg_info "Fetching ${PULSE_BRANCH} of ${PULSE_REPO}"
$STD git clone --branch "$PULSE_BRANCH" "$PULSE_REPO" /opt/pulse
cd /opt/pulse
GIT_SHA="$(git rev-parse HEAD)"
echo "$GIT_SHA" >/opt/pulse_version.txt
msg_ok "Fetched Pulse ${GIT_SHA:0:7}"

msg_info "Building Pulse (this takes a few minutes)"
export NEXT_TELEMETRY_DISABLED=1
# Keeps V8 under the container's memory during the build; raise var_ram if the build is killed (README).
export NODE_OPTIONS="--max-old-space-size=1536"
export GIT_SHA
# package.json pins pnpm (packageManager); corepack fetches that version on first use. patches/ holds the pnpm
# dependency patches (pnpm-workspace.yaml patchedDependencies); the install needs them, and the clone has them.
$STD pnpm install --frozen-lockfile
$STD pnpm build
# Assemble the standalone output as the Dockerfile does: static assets, public files and migrations beside server.js.
cp -r .next/static .next/standalone/.next/static
cp -r public .next/standalone/public
cp -r drizzle .next/standalone/drizzle
# The admin scripts run outside the Next server, so each gets its own bundle with its dependencies inside.
mkdir -p .next/standalone/scripts
for s in reset-password.mjs:reset-password seed-demo-user.mts:seed-user; do
  $STD pnpm exec esbuild "scripts/${s%%:*}" --bundle --platform=node --format=esm --target=node24 --external:pg-native \
    --banner:js="import{createRequire}from'module';const require=createRequire(import.meta.url);" \
    --outfile=".next/standalone/scripts/${s##*:}.mjs"
done
msg_ok "Built Pulse"

msg_info "Writing /opt/pulse/.env"
AUTH_SECRET="$(openssl rand -hex 32)"
cat <<EOF >/opt/pulse/.env
# Pulse configuration. Every variable is explained in /opt/pulse/.env.example. Restart after a change:
#   systemctl restart pulse
#
# demo: generated data for one shared demo user (no Google account needed).
# google: your own Fitbit data from the Google Health API. Switching needs an HTTPS hostname that your phone can
# open (a reverse proxy with a certificate, or Tailscale: see /opt/pulse/docs/setup.md section 3 and
# /opt/pulse/docs/other-setups.md), a Google Cloud OAuth client (docs/setup.md section 4) with the redirect URI
# https://<your-host>/oauth/callback, and the four GOOGLE_* / ADMIN_EMAILS / APP_URL lines below filled in.
DATA_SOURCE=demo

# The PostgreSQL role and database this installer created (password also in /root/pulse.creds).
DATABASE_URL=postgres://pulse:${PG_PASS}@127.0.0.1:5432/pulse

# Signs sessions. Generated by the installer.
BETTER_AUTH_SECRET=${AUTH_SECRET}

# Google mode: the email you will sign up with (the first account owns the server), the OAuth client, your HTTPS
# address, and how many days of history to import on connect (1-3650; default 180; raising it later re-walks the
# history in on the next sync).
# ADMIN_EMAILS=you@example.com
# GOOGLE_CLIENT_ID=...apps.googleusercontent.com
# GOOGLE_CLIENT_SECRET=...
# APP_URL=https://pulse.example.com
# BACKFILL_DAYS=365

# Optional (see .env.example): SUPPORT_EMAIL, SIGNUP, COACH_LOCAL_URL / COACH_LOCAL_MODEL, VAPID_* for push, ANDROID_*.
PORT=3000
EOF
chmod 600 /opt/pulse/.env
chown -R pulse:pulse /opt/pulse
{
  echo "Pulse credentials"
  echo "PostgreSQL role: pulse"
  echo "PostgreSQL password: ${PG_PASS}"
  echo "BETTER_AUTH_SECRET: ${AUTH_SECRET}"
  echo "Demo sign-in: demo@pulse.local / pulse-demo-generated-data (DATA_SOURCE=demo only)"
} >>~/pulse.creds
chmod 600 ~/pulse.creds
msg_ok "Wrote /opt/pulse/.env"

msg_info "Creating the systemd service"
cat <<EOF >/etc/systemd/system/pulse.service
[Unit]
Description=Pulse (recovery, strain and sleep from your Fitbit)
After=network-online.target postgresql.service
Wants=network-online.target
Requires=postgresql.service

[Service]
Type=simple
User=pulse
Group=pulse
WorkingDirectory=/opt/pulse/.next/standalone
# Mirrors the Dockerfile: production, bind every interface, small malloc arenas and V8 young generation (idle ~100 MB).
Environment=NODE_ENV=production
Environment=NEXT_TELEMETRY_DISABLED=1
Environment=HOSTNAME=0.0.0.0
Environment=MALLOC_ARENA_MAX=2
Environment=NODE_OPTIONS=--max-old-space-size=512 --max-semi-space-size=2
EnvironmentFile=/opt/pulse/.env
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=5
# The app refuses to run when migrations fail (instrumentation.ts); on-failure restarts cover a Postgres still starting.

[Install]
WantedBy=multi-user.target
EOF
systemctl enable -q --now pulse
msg_ok "Created the systemd service"

msg_info "Waiting for Pulse to come up"
for _ in $(seq 1 60); do
  if curl -fsS -o /dev/null http://127.0.0.1:3000/healthz; then
    break
  fi
  sleep 2
done
if curl -fsS -o /dev/null http://127.0.0.1:3000/healthz; then
  msg_ok "Pulse answers on port 3000"
else
  msg_error "Pulse did not answer /healthz within two minutes: journalctl -u pulse -e"
fi

motd_ssh
customize

msg_info "Cleaning up"
$STD apt-get -y autoremove
$STD apt-get -y autoclean
msg_ok "Cleaned"
