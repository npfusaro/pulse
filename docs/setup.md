# Self-hosting Pulse with Tailscale

Pulse runs on your own machine or server: one Next.js app with its sync worker, and a Postgres database beside it.
People you invite create an account, connect their own Google account, and see only their own data (sign-up is
invite-only by default; see [Invite people](admin.md#invite-people)). This guide takes you from a demo on your laptop to your Fitbit Air data on a home server that you open from
your phone over [Tailscale](https://tailscale.com).

For other ways to reach Pulse (Cloudflare Tunnel, a reverse proxy), see [other-setups.md](other-setups.md).
Curious how it works under the hood? See [technical-details.md](technical-details.md).

## 1. Try the demo

You need Node 24, pnpm (`corepack enable` uses the version pinned in `package.json`) and Docker.

```sh
git clone https://github.com/adityaongit/pulse.git
cd pulse
pnpm install
cp .env.example .env                           # DATA_SOURCE=demo: demo mode
docker compose -f compose.dev.yaml up -d       # Postgres on localhost:5432
pnpm dev                                       # open http://localhost:3000 and "Continue with demo data"
```

A demo instance generates 180 days of deterministic data for one shared demo user. Sign-up is off. Nothing leaves
your machine.

## 2. Prepare the server

You need a machine that stays on and that you can reach over SSH: a Raspberry Pi, a NAS, a home server or a cloud
server. The commands below assume Debian or Ubuntu (`apt`).

1. Connect to the server over SSH.
2. Update it and install Git, curl and nano:

   ```sh
   sudo apt update && sudo apt upgrade -y
   sudo apt install -y git curl nano
   ```

3. Install Docker with Compose, and start it on every boot:

   ```sh
   curl -fsSL https://get.docker.com | sh
   sudo systemctl enable --now docker
   ```

   You don't need to install Postgres yourself: Pulse's `compose.yaml` runs it in its own container.

4. Clone Pulse and create your `.env`:

   ```sh
   git clone https://github.com/adityaongit/pulse.git
   cd pulse
   cp .env.example .env
   ```

## 3. Set up Tailscale

Tailscale gives the server an HTTPS address that only your own devices can open, with no ports opened to the
internet.

1. Install Tailscale on the server and sign in:

   ```sh
   curl -fsSL https://tailscale.com/install.sh | sh
   sudo tailscale up
   ```

   **Running in a Proxmox LXC container?** Tailscale needs access to `/dev/net/tun`. On the Proxmox host, add these
   two lines to `/etc/pve/lxc/<container-id>.conf`, then restart the container:

   ```
   lxc.cgroup2.devices.allow: c 10:200 rwm
   lxc.mount.entry: /dev/net/tun dev/net/tun none bind,create=file
   ```

2. In the [Tailscale admin console](https://login.tailscale.com/admin/dns), turn on **MagicDNS** and
   **HTTPS Certificates**.
3. Install the Tailscale app on your phone and sign in with the same Tailscale account.
4. Note the server's address. It looks like `https://<machine>.<tailnet>.ts.net`; `tailscale status` and the admin
   console both show it. The rest of this guide calls it `<your-host>`.

## 4. Create the Google OAuth client

Pulse reads your data through the Google Health API, so it needs an OAuth client in a Google Cloud project.

1. Open the [Google Cloud Console](https://console.cloud.google.com/) and sign in with the Google account your
   Fitbit uses.
2. In the project picker at the top left, create a new project, for example "Pulse".
3. Go to **APIs & Services › Enable APIs and Services**, search for **Google Health API**, open it and click
   **Enable**.
4. Set up the consent screen under **Google Auth Platform** (user type **External**, app name, your email). Under
   **Data access**, add `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile`, and the Google Health
   scopes listed in `SCOPES` in `src/server/sources/google/oauth.ts` (each prefixed with
   `https://www.googleapis.com/auth/googlehealth.`).
5. Under **Audience**, add yourself as a **test user**, again with the Google account your Fitbit uses.
6. Go to **Credentials › Create Credentials › OAuth client ID**:
   - **Application type**: Web application, with any name.
   - **Authorized redirect URIs**: `https://<your-host>/oauth/callback`
7. Click **Create** and copy the client ID and client secret for the next step.

> While the app is in **Testing**, Google expires the grant every 7 days and you have to connect Google again.
> Switch the audience to **In production** to avoid this. Google then shows an "unverified app" warning when you
> connect, which you can click through for your own app.

## 5. Configure Pulse

Open the `.env` file in the `pulse` directory:

```sh
nano .env
```

These are the values that matter for this setup. Leave the rest as they are, if you arent familiar with their meaning.

```sh
DATA_SOURCE=google                      # "demo" shows generated data; "google" uses your own
POSTGRES_PASSWORD=...                   # the database password: openssl rand -base64 24
BETTER_AUTH_SECRET=...                  # signs sessions: openssl rand -base64 32
ADMIN_EMAILS=you@example.com            # the email you will sign up to Pulse with
GOOGLE_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=...
APP_URL=https://<your-host>             # optional, recommended: the address you open Pulse on
BACKFILL_DAYS=180                       # optional: days of history to import on connect (1-3650)
```

Generate each secret in a second terminal and paste it in. Save with **Ctrl+O** and exit with **Ctrl+X**.

Pulse doesn't publish a port on the host by default. Tailscale runs outside Docker, so publish one on loopback
only. Create `compose.override.yaml` next to `compose.yaml`:

```yaml
services:
  pulse:
    ports:
      - "127.0.0.1:3000:3000"
```

## 6. Start Pulse

1. Build and start the containers:

   ```sh
   sudo docker compose up -d --build
   sudo docker compose logs -f pulse    # wait for "[worker] started (source: google)", then Ctrl+C
   ```

2. Serve Pulse over HTTPS on your tailnet:

   ```sh
   sudo tailscale serve --bg 3000
   ```

3. Open `https://<your-host>` and **create your account right away**, with the email from `ADMIN_EMAILS`. While the
   server has no accounts, that email needs no invite, and whoever signs up with it first owns the server.
4. Go through onboarding, then **Connect Google** and allow every permission. Pulse imports your last 180 days
   (`BACKFILL_DAYS` changes that; Google has no limit on how far back it serves, so a year is only more requests,
   about ten minutes of heart rate. Raise it later and the next sync walks the extra history in).

Your Pulse server is set up.

## 7. Use it on your phone

With Tailscale connected on your phone, open `https://<your-host>` in your browser. Use **Add to Home Screen**
(or **Install app**) to pin Pulse to your home screen like a normal app.

## Useful commands

| Command | What it does |
|---|---|
| `sudo docker ps` | Lists the running containers (`pulse` and `pulse-db`) |
| `sudo docker logs pulse` | Shows Pulse's logs |
| `sudo docker compose up -d --build` | Rebuilds and restarts Pulse after a `git pull` |
| `scripts/deploy.sh` | Updates Pulse with a database dump and automatic rollback ([admin.md](admin.md#update-pulse)) |

For backups, password resets and inviting other people, see [admin.md](admin.md).

## Troubleshooting

| Symptom | Fix |
|---|---|
| Google says `redirect_uri_mismatch` | The address you opened Pulse on has no matching redirect URI in the OAuth client. |
| "No Google Health profile" | That Google account has no Fitbit data. Settings › Data source › **Switch Google account** and pick the one in your Google Health app. |
| Grant stops working after a week | The consent screen is still in Testing; set it to In production and connect again. |
| "Too many attempts" at sign-in | Sign-in allows 5 tries a minute per IP; wait a minute. |
| Server exits at boot with `Invalid configuration` | The message lists each bad variable. `.env.example` explains every variable. |
| Server exits at boot with a database error | Postgres isn't reachable; check `sudo docker compose ps` and `sudo docker compose logs db`. |

Still stuck? Open an issue with the bug template (and no personal data).
