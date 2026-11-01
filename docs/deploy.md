# Deploying Recommendship

Three environments, all running the same containers:

| | Where | What runs | How it updates |
|---|---|---|---|
| **Local** | Your laptop | `docker compose` (Postgres + PowerSync) and `pnpm dev` (API + web) | Live reload |
| **Staging** | Fly + a Neon branch | `recommendship-staging-api`, `recommendship-staging-sync` | Every push to `main` (after CI), then `scripts/smoke.sh` |
| **Production** | https://recommendship.app (Fly + Neon `production` branch) | `recommendship-api`, `recommendship-sync` | Actions → Deploy → Run workflow → `production` |

The API app also serves the PWA, so the site and its API share one origin (no cross-site cookies to manage).

**Custom domain (production).** `recommendship.app` is registered at Cloudflare, with DNS-only (grey cloud) records pointing at the app: `A`/`AAAA` for `@` and `www` to the IPs from `fly ips list -a recommendship-api`. Fly issues the certificates (`fly certs add recommendship.app` and `www.recommendship.app`); Cloudflare's proxy must stay off or Fly can't renew them. `BETTER_AUTH_URL` in `fly/api.toml` is the one public address: page requests on any other host redirect there, while `/api` stays reachable everywhere because PowerSync reads the JWKS from `recommendship-api.fly.dev`.

## One-time setup

### 1. Neon (Postgres)

1. Create a project (Postgres 17, region **AWS us-west-2** to sit near Fly's `sjc`).
2. Settings → Logical Replication → **Enable**. PowerSync needs it.
3. In the SQL editor on the `production` branch (Neon's default; older projects call it `main`), create the roles PowerSync uses (use real passwords):
   ```sql
   CREATE ROLE powersync_role WITH REPLICATION BYPASSRLS LOGIN PASSWORD '…';
   CREATE ROLE powersync_storage_user WITH LOGIN PASSWORD '…';
   CREATE DATABASE powersync_storage OWNER powersync_storage_user;
   ```
   The first API deploy runs the migrations, which create the `powersync` publication and grant `powersync_role` read access.
4. Create a **staging** branch from `production`. It gets its own copy of the roles and databases. Note its connection strings too.

### 2. Google sign-in

Google Cloud Console → APIs & Services → Credentials → OAuth client ID (Web application):

- Authorized redirect URIs:
  - `https://recommendship.app/api/auth/callback/google` (production client)
  - `https://recommendship-staging-api.fly.dev/api/auth/callback/google`

### 3. Fly

```bash
fly auth login
fly apps create recommendship-api
fly apps create recommendship-sync
fly apps create recommendship-staging-api
fly apps create recommendship-staging-sync
```

Secrets, per environment (staging shown; production is the same with the non-staging app names and the Neon `production` branch):

```bash
fly secrets set -a recommendship-staging-api \
  DATABASE_URL='postgresql://…neon.tech/recommendship?sslmode=require' \
  BETTER_AUTH_SECRET="$(openssl rand -hex 32)" \
  GOOGLE_CLIENT_ID='…' GOOGLE_CLIENT_SECRET='…' \
  ADMIN_EMAILS='you@example.com'

fly secrets set -a recommendship-staging-sync \
  PS_SOURCE_DB_URI='postgresql://powersync_role:…@…neon.tech/recommendship' \
  PS_STORAGE_DB_URI='postgresql://powersync_storage_user:…@…neon.tech/powersync_storage'
```

The first deploy of each environment, by hand, in this order (the API runs migrations; PowerSync needs the tables):

```bash
fly deploy . --config fly/api.staging.toml --ha=false
fly deploy . --config fly/sync.staging.toml --ha=false
scripts/smoke.sh https://recommendship-staging-api.fly.dev https://recommendship-staging-sync.fly.dev
```

### 4. GitHub

- Secret `FLY_API_TOKEN`, piped straight from Fly so it's never printed:
  ```bash
  fly tokens create org -o personal --name github-actions-recommendship --expiry 8760h | gh secret set FLY_API_TOKEN --repo RankWeis/recommendship
  ```
  It expires in a year; rerun to renew.
- Environments `staging` and `production`, with `production` limited to the `main` branch. (Required reviewers need a paid GitHub plan on private repos; production deploys are manual anyway: Actions → Deploy → Run workflow.)
- Variable `DEPLOY_ENABLED` = `true` once the steps above are done. Until then the Deploy workflow runs CI only.

## Costs (rough, prices checked 2026-11-01)

Fly bills per second while a machine runs. Its cheapest regions (`iad`/`ewr`) charge, per month of 24/7 running:
shared-cpu-1x 512 MB $3.69, 1 GB $6.70. A stopped machine costs $0.15/GB/month of disk. Outbound data is $0.02/GB.
`sjc` may cost a little more. Neon Launch charges $0.106 per compute-hour (0.25 CU minimum) and $0.35/GB-month storage; its free plan includes 100 CU-hours per project.

While PowerSync runs it holds a replication connection open, and Neon's compute can't sleep. Always on, that would be about $19/month of Neon compute per environment. So PowerSync **scales to zero**: it stops when no device is connected and starts (in a few seconds) on the next sync. While it's stopped, Neon sleeps too. Both APIs stay warm: PowerSync fetches the API's JWKS with a 3-second timeout, which a waking API can't meet, so a sleeping API made the first sync after a quiet spell fail. The API's connection pool closes idle connections after 10 seconds, so it doesn't keep Neon awake.

Neon deletes a replication slot that makes no progress for about 40 hours. [keepalive.yml](../.github/workflows/keepalive.yml) wakes each PowerSync app once a day so that doesn't happen. If it ever does, PowerSync has to replicate everything again, which is slow but harmless at this size.

Rough monthly cost at personal-use traffic (a couple of hours of syncing a day):

| | Fly | Neon |
|---|---|---|
| Production | API $3.69 (warm) + PowerSync ~$0.60 + stopped disks | ~$2–5 of compute, or inside the free plan's 100 CU-hours |
| Staging | API $3.69 (warm) + PowerSync ~$0.50 | ~$0–1 |
| **Total** | **~$9–10** | **~$0–6** |

These numbers grow with use. With people syncing around the clock it heads back toward always-on: about $10/month of Fly and $19/month of Neon per environment. Switching back is one line per app in `fly/sync*.toml` (`min_machines_running = 1`).

Unverified until the first real deploy: that the free plan allows logical replication, and that a daily 90-second wake is enough to keep the slot current.

Machine counts are fixed and `hard_limit` makes overload queue rather than add machines, so traffic can't grow the bill on its own. Fly has no hard spending cap, so set a billing alert too.

## Inviting people

Sign-up is invite-only. Emails in `ADMIN_EMAILS` are approved on sign-up and see an **Invites** section on the Account page to create single-use codes. Anyone else can sign in and use the app on their device, but nothing syncs until they redeem a code, or an admin presses **Approve** next to them on the Admin page.

## Watching usage

Admins get an **Admin** page (Account → Users and monitoring, or `/admin`): sign-ups today and this week, who's waiting, who's within 80% of a limit, totals stored and today's changes, with search, filters and sorting over every account. From there an admin can approve, suspend, or give one person their own limits: different numbers, or no row limit and no daily budget. The defaults (`ROW_QUOTA`, `WRITE_OPS_PER_DAY`, `MAX_NEW_USERS_PER_DAY`) apply to everyone else; the per-minute flood guard applies to everyone.

## Movie, TV and book lookup

Quick Add suggests the real title as you type (with poster, year and director, author or creators) for the Movie, TV and Book types. Books come from Open Library and need no setup. Movies and TV come from TMDB and need a free API token:

1. Create a TMDB account, then Settings → API → request a key (personal / non-commercial use).
2. Copy the **API Read Access Token** (the long one) and run `scripts/fly-secrets.sh staging --tmdb` (and `production --tmdb`). It's entered hidden and goes straight to Fly.
3. Deploy. `/api/public/config` then reports `lookup.movie: true`.

The token stays on the server: the app asks `/api/lookup`, which caches answers for a day and allows 60 lookups a minute per account. TMDB's free key is for non-commercial use; if Recommendship ever charges money or shows ads, TMDB wants a commercial agreement. Their credit line is on the Account page.

## How many people at once

Each phone or browser with the app open holds one connection to PowerSync. PowerSync's default cap is 200 per instance; `docker/powersync/service.yaml` raises it to 2,000, and Fly's proxy limit in `fly/sync*.toml` matches.

Load test (1 November 2026), PowerSync 1.27 in a container capped like the Fly machine (1 GB, 1 CPU), 200 accounts with a little data, connections arriving 50 a second:

| open connections | ready | memory | first sync, 95th percentile |
|---|---|---|---|
| 250 | all | ~170 MB | 97 ms |
| 1,000 | all | ~250 MB | 69 ms |
| 2,000 | all but 2 | ~320 MB | 76 ms |

The connections were idle; lots of people editing at once costs CPU, and Fly's shared CPU is slower under sustained load than this test's full core. Past ~2,000 at once, the next step is splitting PowerSync into one replication machine and several API machines (its all-in-one mode can only run once).
