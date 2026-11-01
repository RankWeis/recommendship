# Recommendship

Log who recommends what to you (movies, books, restaurants, podcasts…), rate things once you've tried them, and let each person's track record with you predict how much you'll like their pending picks. Everything recommended goes on **The Put List**, which sorts itself by that prediction.

> "Sam's movie picks run +0.5 for you, so his new one goes near the top. Pat's restaurant picks run −0.3, so hers sink."

## Status

**Weekend 1 (done): local-only.** Everything runs on the device. There's no server or account yet.

- Quick Add: title + who, category chips, sticky recommender (10 min), duplicate detection that attaches new recommenders to an existing item, optional hype level and note. Press `n` anywhere to open it.
- The Put List, per category, sorted by **Best guess**, **Safe bets** (lower bound), newest or oldest. Tap a prediction to see why.
- Rate with half stars; the toast shows how that person's record moved.
- People leaderboard and per-person pages (per-category scores, hit rate, best/worst picks, pending list).
- Item pages (edit title/category, remove a recommender, move between states).
- `/stats/model`: leave-one-out check of the model against naive baselines, with the shrinkage knobs to play with.
- Installable PWA with a service worker for offline loading (production builds only).

**Weekend 2 (done): accounts and sync.**

- Sign in (Google in production; email + password locally) and everything syncs between your devices through PowerSync. What you added before signing in uploads to your account.
- Capture still works with no signal: changes queue on the device and upload when it's back online (end-to-end tested).
- Invite-only: new accounts can use the app on their device but don't sync until they redeem a single-use code. Admins create codes on the Account page.
- The write API checks ownership, references, columns and quotas on every synced change.
- Local stack in Docker; Fly configs for staging and production; GitHub Actions run CI, deploy `main` to staging, and deploy production on demand. See [docs/deploy.md](docs/deploy.md).

**Next:** Weekend 3 adds TMDB / Open Library lookup, a share target, merge suggestions for duplicates, nudges and polish.

## How it works

- **Local-first.** The real database is SQLite (WASM) in the browser, persisted to OPFS, managed by the [PowerSync](https://www.powersync.com/) web SDK. Every save is a local write, so capture works with no signal. Writes queue for upload and go through `POST /api/write`; changes stream back down from Postgres.
- **Scoring** ([packages/score](packages/score/src/index.ts)) is a baseline predictor with shrinkage: `predicted = μ_c + b_r + b_rc`, where each offset is pulled toward zero until there's evidence. It runs on the device and rewrites two local-only tables after every change.
- **Schema** ([packages/schema](packages/schema/src)) is defined in Drizzle twice, as SQLite for the device and Postgres for the server, with a test that keeps their columns identical.
- **Server** ([apps/server](apps/server/src)): Hono + Better Auth on Node. Better Auth's JWT plugin issues the tokens PowerSync verifies, so one sign-in covers the API and sync.

```
apps/web          SvelteKit 3 + Svelte 5 static SPA/PWA
apps/server       Hono API: auth, invites, write endpoint; serves the PWA in production
packages/schema   Drizzle schema (SQLite + Postgres), enums, seed categories
packages/score    Pure scoring model + leave-one-out evaluator (Vitest)
docker/           Postgres init and PowerSync config (sync streams)
fly/              Fly configs for staging and production
e2e/              Playwright: two devices, offline capture, sync
```

## Running it

Needs Node 20+ (the repo pins 23 in `.nvmrc`), pnpm 10 and Docker (Colima works).

```bash
nvm use
pnpm install
cp apps/server/.env.example apps/server/.env   # then fill BETTER_AUTH_SECRET: openssl rand -hex 32
pnpm stack        # Postgres + PowerSync in Docker, plus migrations
pnpm dev          # API on :3000, web on http://localhost:5173
```

Sign in on the Account page (the dot at the top right) with the local dev account noted in `.env.example`.

```bash
pnpm test         # scoring, schema parity, API write and invite rules
pnpm test:e2e     # two devices + offline capture against the local stack
pnpm check        # typecheck everything
pnpm build        # static site in apps/web/build
```

Use a normal browser window: private windows may block OPFS storage. On the empty Put List, **Load sample data** adds about 40 believable items so you can see the sorting work.
