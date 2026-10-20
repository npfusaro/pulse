#!/usr/bin/env bash
source <(curl -fsSL https://raw.githubusercontent.com/community-scripts/ProxmoxVE/main/misc/build.func)
# Copyright (c) 2021-2026 community-scripts ORG
# Author: npfusaro
# License: MIT | https://github.com/community-scripts/ProxmoxVE/raw/main/LICENSE
# Source: https://github.com/npfusaro/pulse

# Pulse: a self-hosted WHOOP-style recovery / strain / sleep app for the Fitbit Air (Next.js + PostgreSQL).
# Installs Nick's fork, branch feat/backfill-days-and-spo2 (configurable BACKFILL_DAYS, minute-by-minute SpO2).

APP="Pulse"
var_tags="${var_tags:-health;fitness}"
var_cpu="${var_cpu:-2}"
# `pnpm build` (Next 16) peaks around 2 GB; see README.md to lower RAM after the install.
var_ram="${var_ram:-2048}"
var_disk="${var_disk:-8}"
var_os="${var_os:-debian}"
var_version="${var_version:-13}"
var_unprivileged="${var_unprivileged:-1}"

# The git source the container builds from. Override to track another fork or branch.
PULSE_REPO="${PULSE_REPO:-https://github.com/npfusaro/pulse.git}"
PULSE_BRANCH="${PULSE_BRANCH:-feat/backfill-days-and-spo2}"

header_info "$APP"
variables
color
catch_errors

function update_script() {
  header_info
  check_container_storage
  check_container_resources
  if [[ ! -d /opt/pulse/.git ]]; then
    msg_error "No ${APP} Installation Found!"
    exit
  fi

  cd /opt/pulse
  local branch
  branch="$(git rev-parse --abbrev-ref HEAD)"
  $STD git fetch --quiet origin "$branch"
  local current latest
  current="$(git rev-parse HEAD)"
  latest="$(git rev-parse "origin/$branch")"
  if [[ "$current" == "$latest" ]]; then
    msg_ok "No update required. ${APP} is already at ${latest:0:7} on ${branch}."
    exit
  fi

  msg_info "Stopping ${APP}"
  systemctl stop pulse
  msg_ok "Stopped ${APP}"

  msg_info "Backing up the database to /opt/pulse-backups"
  mkdir -p /opt/pulse-backups
  sudo -u postgres pg_dump -Fc pulse >"/opt/pulse-backups/pulse-$(date +%F-%H%M).dump"
  msg_ok "Backed up the database"

  msg_info "Updating ${APP} to ${latest:0:7}"
  $STD git reset --hard "origin/$branch"
  export COREPACK_ENABLE_DOWNLOAD_PROMPT=0 NEXT_TELEMETRY_DISABLED=1
  export NODE_OPTIONS="--max-old-space-size=1536"
  export GIT_SHA="$latest"
  $STD pnpm install --frozen-lockfile
  $STD pnpm build
  # The standalone output needs the static assets, public files and migrations beside server.js (see the Dockerfile).
  rm -rf .next/standalone/.next/static .next/standalone/public .next/standalone/drizzle
  cp -r .next/static .next/standalone/.next/static
  cp -r public .next/standalone/public
  cp -r drizzle .next/standalone/drizzle
  mkdir -p .next/standalone/scripts
  for s in reset-password.mjs:reset-password seed-demo-user.mts:seed-user; do
    $STD pnpm exec esbuild "scripts/${s%%:*}" --bundle --platform=node --format=esm --target=node24 --external:pg-native \
      --banner:js="import{createRequire}from'module';const require=createRequire(import.meta.url);" \
      --outfile=".next/standalone/scripts/${s##*:}.mjs"
  done
  chown -R pulse:pulse /opt/pulse
  echo "$latest" >/opt/pulse_version.txt
  msg_ok "Updated ${APP} to ${latest:0:7}"

  msg_info "Starting ${APP}"
  systemctl start pulse
  msg_ok "Started ${APP}"
  msg_ok "Updated Successfully"
  exit
}

start
build_container
description

msg_ok "Completed Successfully!\n"
echo -e "${CREATING}${GN}${APP} setup has been successfully initialized!${CL}"
echo -e "${INFO}${YW} Access it using the following URL:${CL}"
echo -e "${TAB}${GATEWAY}${BGN}http://${IP}:3000${CL}"
echo -e "${INFO}${YW} Demo mode is on. Credentials and the Google-mode steps are in /root/pulse.creds and /opt/pulse/.env${CL}"
