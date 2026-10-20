#!/usr/bin/env bash
# Self-contained alternative to ct/pulse.sh: creates the LXC with `pct` and runs install/pulse-install.sh inside it,
# with a small shim standing in for the community-scripts helper functions. Needs nothing from any other repository
# and nothing installed on the host beyond what Proxmox ships (pct, wget or curl): run it straight from GitHub,
#
#   bash -c "$(wget -qLO - https://raw.githubusercontent.com/npfusaro/pulse/feat/backfill-days-and-spo2/proxmox/standalone/pulse-lxc.sh)"
#
# or from a checkout of this folder: `bash standalone/pulse-lxc.sh`. Override the defaults below with environment
# variables: CTID=120 STORAGE=local-zfs BRIDGE=vmbr0 RAM=2048 bash -c "$(wget ...)". Run from GitHub, the install
# script is fetched from the same branch (INSTALL_URL overrides where).
#
# Network: DHCP on the bridge by default; IP=192.168.1.50/24 GW=192.168.1.1 for a static address.
set -Eeuo pipefail

CTID="${CTID:-$(pvesh get /cluster/nextid)}"
HOSTNAME_CT="${HOSTNAME_CT:-pulse}"
STORAGE="${STORAGE:-local-lvm}"
TEMPLATE_STORAGE="${TEMPLATE_STORAGE:-local}"
BRIDGE="${BRIDGE:-vmbr0}"
CPU="${CPU:-2}"
RAM="${RAM:-2048}"
DISK="${DISK:-8}"
IP="${IP:-dhcp}"
GW="${GW:-}"
UNPRIVILEGED="${UNPRIVILEGED:-1}"
PULSE_REPO="${PULSE_REPO:-https://github.com/npfusaro/pulse.git}"
PULSE_BRANCH="${PULSE_BRANCH:-feat/backfill-days-and-spo2}"

command -v pct >/dev/null || { echo "run this on a Proxmox VE host (pct not found)" >&2; exit 1; }

# The install script: next to this one in a checkout, else fetched from the branch being installed (a `bash -c
# "$(wget ...)"` run has no file of its own, so BASH_SOURCE is empty and the lookup falls through to the download).
here="$(cd "$(dirname "${BASH_SOURCE[0]:-.}")" && pwd)"
install_script="${INSTALL_SCRIPT:-$here/../install/pulse-install.sh}"
if [[ ! -f "$install_script" ]]; then
  INSTALL_URL="${INSTALL_URL:-https://raw.githubusercontent.com/npfusaro/pulse/${PULSE_BRANCH}/proxmox/install/pulse-install.sh}"
  install_script="$(mktemp)"
  echo "➤ Fetching the install script from ${INSTALL_URL}"
  if command -v wget >/dev/null; then wget -qO "$install_script" "$INSTALL_URL"; else curl -fsSL -o "$install_script" "$INSTALL_URL"; fi
  [[ -s "$install_script" ]] || { echo "could not fetch the install script from $INSTALL_URL" >&2; exit 1; }
fi

echo "➤ Debian 12 template"
template="$(pveam available --section system | awk '/debian-12-standard/ {print $2}' | sort -V | tail -1)"
[[ -n "$template" ]] || { echo "no debian-12-standard template listed by pveam (run pveam update)" >&2; exit 1; }
pveam list "$TEMPLATE_STORAGE" | grep -q "$template" || pveam download "$TEMPLATE_STORAGE" "$template"

net="name=eth0,bridge=${BRIDGE},ip=${IP}"
[[ "$IP" != "dhcp" && -n "$GW" ]] && net="${net},gw=${GW}"

echo "➤ Creating container ${CTID} (${HOSTNAME_CT}, ${CPU} vCPU, ${RAM} MB, ${DISK} GB on ${STORAGE})"
pct create "$CTID" "${TEMPLATE_STORAGE}:vztmpl/${template}" \
  --hostname "$HOSTNAME_CT" --cores "$CPU" --memory "$RAM" --swap 512 \
  --rootfs "${STORAGE}:${DISK}" --net0 "$net" \
  --unprivileged "$UNPRIVILEGED" --features nesting=1 --onboot 1 \
  --tags "health;fitness" >/dev/null
pct start "$CTID"

echo "➤ Waiting for the network"
for _ in $(seq 1 60); do
  pct exec "$CTID" -- bash -c 'getent hosts deb.debian.org >/dev/null 2>&1' && break
  sleep 2
done

# The helper functions install/pulse-install.sh expects from community-scripts' install.func, reduced to what it uses.
shim="$(cat <<'SHIM'
color() { :; }
verb_ip6() { :; }
catch_errors() { set -Eeuo pipefail; trap 'echo "✖ failed at line $LINENO: $BASH_COMMAND" >&2' ERR; }
setting_up_container() { export DEBIAN_FRONTEND=noninteractive; }
network_check() { :; }
update_os() { apt-get update >/dev/null 2>&1; apt-get -y upgrade >/dev/null 2>&1; }
msg_info() { echo "➤ $*"; }
msg_ok() { echo "✔ $*"; }
msg_error() { echo "✖ $*" >&2; }
motd_ssh() { :; }
customize() { :; }
silent() { "$@" >/dev/null 2>&1; }
STD=silent
SHIM
)"

echo "➤ Installing Pulse inside the container (a few minutes: PostgreSQL, Node, the build)"
shim_file="$(mktemp)"
printf '%s\n' "$shim" >"$shim_file"
pct push "$CTID" "$shim_file" /root/pulse-shim.func
pct push "$CTID" "$install_script" /root/pulse-install.sh
rm -f "$shim_file"
pct exec "$CTID" -- env "PULSE_REPO=$PULSE_REPO" "PULSE_BRANCH=$PULSE_BRANCH" \
  bash -c 'export FUNCTIONS_FILE_PATH="$(cat /root/pulse-shim.func)"; bash /root/pulse-install.sh'
pct exec "$CTID" -- rm -f /root/pulse-shim.func /root/pulse-install.sh

ip="$(pct exec "$CTID" -- hostname -I | awk '{print $1}')"
echo
echo "✔ Pulse is running: http://${ip}:3000  (demo mode; sign in with 'Continue with demo data')"
echo "  Credentials: pct exec ${CTID} -- cat /root/pulse.creds"
echo "  Config:      pct exec ${CTID} -- nano /opt/pulse/.env   then: systemctl restart pulse"
