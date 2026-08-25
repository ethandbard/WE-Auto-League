# WE Auto League

A dashboard for running an auto group's service competition. Dealerships file
their numbers twice a week, the platform scores and ranks service advisors and
stores against monthly goals, and publishes standings on schedule.

- **Standings** — the Victory Lane board: Manager Ranking and Service Advisor
  Ranking, position-coloured, for any period
- **Enter** — the per-store data-entry grid, with the submission cutoff and
  late-penalty warning live
- **Manage** — roster (add, hide-with-reason, remove), monthly goals with
  carry-forward, category and weight editing with a "must total 100" guard,
  and the penalty ledger
- **Board** — announcements with read receipts
- **Admin** — compliance (who's late, who's flagged, manager-eligibility
  warnings), period lock/publish, scoped API keys

Vite + React + TypeScript + Tailwind on the front, Express + Drizzle +
PostgreSQL behind it, a scoring engine that's a golden-master-tested pure
function, node-cron for the scheduler, and an MCP server exposing the same
operations as the REST API.

## Getting started

### 1. Prerequisites

| Need | Version | Notes |
|---|---|---|
| Node.js | 20 or newer | Ships with npm 10+ |
| PostgreSQL | 14 or newer | Any local server; the app creates its own database |

### 2. Install dependencies

```bash
cd WE-Auto-League
npm install
```

If npm reports pending install scripts (esbuild, used by tsx/vite/drizzle-kit):

```bash
npm approve-scripts --allow-scripts-pending
npm install
```

### 3. Configure the database connection

```bash
cp .env.example .env
```

Edit `DATABASE_URL` (or the discrete `PG*` vars) to match your local server.
Leave `PGSSL=false` for local development.

### 4. Create, migrate, and seed

```bash
npm run setup
```

Three steps, each safe to re-run on its own:

| Step | Script | What it does |
|---|---|---|
| 1 | `npm run db:create` | Creates the `we_auto_league` database if it isn't there |
| 2 | `npm run db:migrate` | Applies the migrations in `server/drizzle/` |
| 3 | `npm run seed` | Loads the real June 2026 Victory Lane sheet as a published period, then opens the current month with the same weights and goals carried forward |

The seed exits early ("league already exists") if it's already been run — it's
not meant to be re-run against a database that already has real activity.

### 5. Run it

```bash
npm run dev
```

Web at http://localhost:5173, API at http://localhost:4000. The scheduler
(late-penalty checks, pre-deadline reminders, standings mail) runs inside the
API process by default — see `ENABLE_SCHEDULER` in `.env.example`.

Sign in as the seeded commissioner, `ethan@thebardfamily.com` — in
development, requesting a sign-in link returns it directly in the response
(no email transport is configured locally) instead of sending mail.

## Verifying the scoring engine

The scoring model is verified against the client's real June 2026 sheet —
both as a standalone script with no app or database, and as the actual test
suite:

```bash
node fixtures/verify-fixture.mjs   # standalone proof, no dependencies
npm test                            # the real engine, node:test
```

`npm test` asserts all 45 advisor rows, all 8 manager rows, every team score,
and the WC Conv precision trap (see `CLAUDE.md`) against `fixtures/june-2026.json`
and the full transcription in `fixtures/june-2026-full.json`.

## Production

Docker Compose on the VPS, mirroring `../pokemon-crm`: the app and Postgres 16,
the app joining the shared `edge` network with no host port published,
Postgres on `internal` only. `config.env` is the Compose `env_file` and is
git-ignored. Deployment itself goes through the `deploy-to-hetzner` skill,
which also owns the shared Cloudflare tunnel and nightly backups.

After the first deploy, migrate and seed from compiled JS inside the app
container. The image has no `tsx`, so `npm run db:migrate` / `npm run seed`
do not work there, and the image does not migrate or seed on start:

```bash
docker compose exec app node server/dist/db/migrate.js
docker compose exec app node server/dist/scripts/seed.js
```

### Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `database "we_auto_league" does not exist` | `db:migrate` ran before `db:create`. Run `npm run setup`. |
| `ECONNREFUSED` on any db script | PostgreSQL isn't running, or the host/port in `.env` is wrong. |
| `Cannot find module '@esbuild/...'` after install | npm 11 blocks install scripts. Run `npm approve-scripts --allow-scripts-pending && npm install`. |
| Magic-link sign-in returns `ok: true` but nothing arrives | Expected locally — `NODE_ENV` isn't `production`, so the link is returned in the response instead of emailed. |
| Port 4000 or 5173 already in use | Change `API_PORT` in `.env`; the Vite port is in `client/vite.config.ts`. |

## Scripts

| Command | Does |
|---|---|
| `npm run setup` | Create, migrate, and seed the database in one go |
| `npm run dev` | API + web dev servers together |
| `npm run build` | Typecheck and build both workspaces |
| `npm run typecheck` | Typecheck only |
| `npm test` | Golden-master scoring engine tests |
| `npm run db:create` / `db:migrate` / `db:generate` / `db:studio` | Database lifecycle |
| `npm run seed` | Load the June 2026 sheet and open the current period (idempotent — no-ops if the league already exists) |
| `npm run scheduler` (in `server/`) | Run the scheduler as its own process instead of in-process |
| `npm run mcp` (in `server/`) | Run the MCP server on stdio — needs `MCP_API_KEY` (see `docs/build-plan.html` §Integration seams) |

## Documentation

[CLAUDE.md](CLAUDE.md) covers architecture, the data model, the API surface,
and conventions. [docs/build-plan.html](docs/build-plan.html) is the original
build plan — scoring model derivation, phase breakdown, risks. [decisions.md](docs/decisions.md)
records the eight open questions from the client's brief and how each was
resolved. Keep all three to facts and rules; no rationale essays beyond what's
already there.

## License

Private. Not licensed for reuse.
