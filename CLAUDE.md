# WE Auto League — architecture & conventions

A dashboard for running an auto group's service competition. Dealerships file
their numbers twice a week, the platform scores and ranks service advisors and
stores against monthly goals, and it publishes standings and mails them on
schedule.

**Status: Phases 1–8 built** and running at `auto.ethandbard.com`. Remaining
ops and follow-ups are in [TODO.md](TODO.md).

**Keep this file current.** When you add a route, table, page, or convention,
update the matching section here in the same change.

**Keep documentation minimal.** This file and the docs it points at hold facts,
rules, and constraints only — no rationale essays, no retrospectives, no
justifications for choices already made. State the rule, add at most one clause
of why if the rule is otherwise unfollowable, and stop.

---

## Read these first

| File | What it is |
|---|---|
| [README.md](README.md) | Local dev setup, scripts, troubleshooting |
| [docs/build-plan.html](docs/build-plan.html) | The original plan. Scoring model derivation, architecture, data model, 8 phases. Open in a browser. |
| [TODO.md](TODO.md) | Remaining ops and follow-ups. Read this before picking up work. |
| [docs/decisions.md](docs/decisions.md) | Nine open questions, all decided. Do not re-litigate. |
| [docs/data-corrections.md](docs/data-corrections.md) | Runbook: view and fix data — app paths first, SQL surgery rules, backup/restore. |
| [fixtures/june-2026.json](fixtures/june-2026.json) | Golden-master fixture: 6 advisors + all 8 managers, hand-verified to the cent against the scan. |
| [fixtures/june-2026-full.json](fixtures/june-2026-full.json) | All 45 advisors + all 8 managers, transcribed from a 6×-magnified render of the scan and cross-validated: every store's team score reproduces the golden fixture exactly. This is what `seed.ts` loads. |
| [fixtures/verify-fixture.mjs](fixtures/verify-fixture.mjs) | Standalone proof of the scoring formula, no app or deps. `node fixtures/verify-fixture.mjs` |
| [server/test/scoring.test.ts](server/test/scoring.test.ts) | The real golden-master test, run with `npm test`. |
| [request_assets/](request_assets/) | The client's original brief, the scanned scoreboard, 9 screenshots of the incumbent tool. |

---

## The scoring model

Verified to the cent against the client's June 2026 sheet — all 45 advisors,
all 8 managers, every store's team score. Do not reimplement from intuition —
run `npm test`.

```
advisor:  points_c = (actual_c / goal_store,c) * weight_c
          score    = Σ points_c − penalties

team:     teamScore = mean(advisor scores at that store, eligible only)

manager:  points_c = attainment_c * weight_c / 100
          score    = Σ points_c − penalty
```

Weights total 100 per scope, so on-goal in everything scores 100. Attainment is
uncapped by default (`leagues.attainmentCap`, nullable, is the escape hatch).
Manager category values arrive already expressed as percent of goal, so no goal
division happens on that board. `teamScore` feeds the manager board as its own
percentage-like number, which is what couples the two leaderboards.

| Advisor category | Weight | | Manager category | Weight |
|---|---|---|---|---|
| CSI 100's | 20 | | % CSI Goal | 30 |
| ELR | 10 | | % CP Goal | 20 |
| CP $ | 20 | | % Gross Goal | 20 |
| HPRO | 10 | | Team Score | 30 (derived) |
| Total $ | 15 | | | |
| WC | 15 | | | |
| WC Conv | 10 | | | |

Penalties: **−2** to the store per missed submission window (stacking), **−25** to
an advisor with training criteria incomplete, plus a manual ledger with reasons.

The pure functions live in `server/src/scoring/engine.ts`
(`scoreAdvisor`, `scoreTeam`, `scoreManager`, `applyPenalties`, `assignPositions`,
`weightsTotalTo100`), versioned as `ENGINE_VERSION` and stamped onto every
`scores` row. Eligibility rules (grace period, hidden/terminated exclusion,
manager minimum) are in `server/src/scoring/eligibility.ts`. The DB-facing
orchestration — reading the latest submission per store, scoring every
eligible advisor, deriving the team score, scoring the manager, storing the
result — is `server/src/scoring/compute.ts`.

---

## Stack

| Layer | Choice |
|---|---|
| Frontend | Vite 6 + React 18 + TypeScript + Tailwind CSS v4 |
| Charts | Recharts 2 |
| Backend | Node 20 + Express 4 (ESM, TypeScript via `tsx`) |
| Database | PostgreSQL 16 (local for dev; container on the VPS in production) |
| ORM / migrations | Drizzle ORM + drizzle-kit |
| Validation | Zod (every request query/body parsed before use) |
| Scheduling | node-cron + Postgres advisory locks, in-process by default |
| Email | Resend (REST) in production; Cloudflare Email Sending as an alternative; console transport locally |
| MCP | `@modelcontextprotocol/sdk`, stdio transport |
| Tests | Node's built-in `node:test`, no separate framework |

npm workspaces: `server` and `client`, driven from the repo root. This mirrors
`../pokemon-crm` — same Dockerfile/compose shape, same env-loading split
between `src/env.ts` and `drizzle.config.ts` (see Gotchas).

Deployment: multi-stage Docker image, app + Postgres on `edge` and `internal`
networks, published at `auto.ethandbard.com` through the shared Cloudflare
named tunnel. Container names `we-auto-league` / `we-auto-league-db`, database
`we_auto_league`, app port 4000.

---

## Rules that are easy to get wrong

**Money and metrics are `numeric`, never float.** Every metric/goal/score
column is `numeric(12,4)`. `WC Conv` is displayed at 2dp but scored at 3 — a
2dp column produces silently wrong scores. `server/test/scoring.test.ts`
pins this ("the WC Conv precision trap" test).

**Round only at render.** The sheet sums rounded per-category points, so the
engine rounds each category to 2dp and sums those — see `round2` in
`engine.ts`. Assert against rounded points with a 0.011 tolerance, not
full-precision products.

**Hiding an advisor is a scoring input, not a UI filter.** Team score is a
mean, so excluding somebody changes their manager's score and the store's
rank. It lives in `participation` with an author and a timestamp — set via
`PUT /api/employees/:id/participation`, never a boolean on `employees`.

**Scheduled jobs must be idempotent.** This scheduler applies point penalties
and mails standings people are paid against. Every run takes a Postgres
advisory lock (`server/src/scheduler/lock.ts`); every send carries an
idempotency key of `(template, period, recipient)` that `email_log` enforces
(`server/src/email/send.ts`'s `sendOnce`). A redeploy firing a job twice must
be a no-op, not a double penalty. The scheduler runs **in-process** inside the
API server by default (`ENABLE_SCHEDULER` in `.env`); `npm run scheduler` runs
it standalone, and the lock makes running both safe simultaneously.

**Published standings are immutable.** `scores` rows are append-only:
`computePeriodScores` never updates a published row, it inserts a new
`revision` and links the prior published row's `supersededById`. Reads always
resolve to the highest revision per `(scope, employeeId, dealershipId)` via
`currentScoresFor` — never query `scores` directly for "the" current score.

**Categories are data, not columns.** Six more are already pencilled in the
client's margins. Adding one is `POST /api/categories`, an admin action
against `categories` and `category_weights`, never a migration. Activating one
forces a weight restatement — `PUT /api/categories/weights` rejects any save
where the scope doesn't total exactly 100.

**Auth sits behind an interface.** `server/src/auth.ts`'s `resolveActor`
switches on `AUTH_PROVIDER`: app-native magic-link sessions (`session`,
default) for the prototype, or a trusted `Cf-Access-Authenticated-User-Email`
header (`cloudflare-access`) for an enterprise deployment — no route code
changes either way.

**All writes land in `audit_log`**, whatever path they arrive by — web form,
CSV import, REST, or MCP. Call `writeAudit()` from `server/src/audit.ts`
inside the same handler that performs the write, with the right `provenance`.

---

## Ingestion

Manual entry is one implementation of an interface, not the only way in:

```
MetricSource.submit(period, store, rows[]) → ValidationResult
```

Implemented as `recordSubmission()` in `server/src/routes/submissions.ts`,
shared by all four entry paths — they differ only in the `provenance` they
pass:

- **Web grid** (`POST /api/submissions`) — provenance `web`. The grid also
  accepts a paste of a copied spreadsheet range (see § Frontend conventions);
  the paste still ends at this same endpoint, once the manager reviews and
  clicks Save.
- **CSV import** (`POST /api/import/preview`, `/commit`) — provenance `csv`.
- **Scoped REST API** (`POST /api/v1/submit`) — provenance `api`, authenticated
  by a hashed key from `api_keys` (`server/src/routes/apiKeys.ts`,
  `external.ts`)
- **MCP server** (`submit_metrics` tool) — provenance `mcp`,
  `server/src/mcp/server.ts`, authenticated by the same API key mechanism via
  `MCP_API_KEY`

**Name/category matching for tabular input is its own shared module**,
`server/src/ingestion/tabular.ts` (`parseTabular`, `resolveTabularRows`) —
not folded into a route handler. `parseTabular` auto-detects comma vs. tab
delimiter (a browser paste from Excel/Sheets delivers TSV), and
`resolveTabularRows` matches rows against the roster by name/alias and
columns against `categories` by label/key, case-insensitive. `routes/import.ts`
(CSV and XLSX) and the entry grid's paste handler both call it; a future integration —
an MCP tool that accepts a raw pasted block, a Slack bot, whatever — calls
the same two functions directly rather than reimplementing matching or going
through HTTP. XLSX files are reduced to `ParsedTable` by
`ingestion/workbook.ts` (first sheet, via `exceljs`) before the same matcher
runs.

**Roster import is a separate matcher from metric import.**
`server/src/ingestion/roster.ts` splits the same way tabular.ts does — pure
`parseRoster` (header aliases, email/role validation, per-row errors) and
DB-facing `resolveRoster` (store matching, diff against the existing roster).
It cannot reuse `parseTabular`, which coerces every non-identifier cell to a
number. Rows match on **email**, so a re-import of an unchanged file is a
no-op rather than a duplicate. `POST /api/import/roster/{preview,commit}` is
commissioner-only: a roster file can move somebody between stores, and
`PATCH /api/employees/:id` already restricts that to a commissioner.

**An absent column states no opinion; a blank cell states a value.** A file
with no Role column leaves every role alone — it does not default them to
advisor — and no Store column leaves everybody rostered where they are. A
present column's blank cell is a real value: a blank Alias clears it and a
blank Store means floater. Role and Hire Date have no meaningful blank, so
those cells are treated as unstated. Fields carry `undefined` for unstated
through `ParsedRosterRow`, and the commit only `set`s what was stated. Without
this, the Name+Email file that TODO item 1b calls for would demote every
manager and un-roster every advisor.

`resolveRoster` reads **archived employees too**, because
`employees_league_email_uq` ignores `archived_at` — treating an archived
address as new inserts straight into a unique violation. An archived row
resolves to a restore, shown in the preview as its own change. Hire dates are
normalized to `YYYY-MM-DD` at parse time (ISO, an `.xlsx` date cell's full
timestamp, or `M/D/YYYY`); anything else is a row error, since the column is a
Postgres `date` and a bad cell would otherwise fail at insert. Commit runs in
one transaction so a partial roster can't land, and `writeAudit` takes that
transaction as its second argument so a rollback drops the audit rows with it.

A `DmsAdapter` stub is not yet built — it stays unimplemented until somebody
names the client's DMS, per the build plan.

---

## Export

`GET /api/export/:periodId/standings.csv?scope=` and `.xlsx`. Shaping lives in
`server/src/export/standings.ts`, not the route, so the two formats cannot
drift — both serialize the same `Sheet[]`.

Sheets stay **purely tabular**: header on row 1, no title banner, no merged
metadata. These files get re-imported, diffed, and pivoted; period identity
rides in the filename instead. Every row carries `Engine Version`,
`Computed At`, and `Published` so an export is self-describing in a pay
dispute. Category columns are read off the rows rather than a fixed list —
categories are data — and come out in the same order the Standings table
shows them. CSV is written with a UTF-8 BOM and CRLF, because Excel is where
these land.

---

## Folder structure

```
WE-Auto-League/
├── .env                       # local credentials — git-ignored
├── .env.example                # committed template
├── config.env.example          # Compose env_file template (config.env itself is git-ignored)
├── Dockerfile                   # multi-stage Node 20 image; serves client/dist
├── docker-compose.yml           # app + Postgres 16 on edge + internal
├── CLAUDE.md                    # this file
├── TODO.md                      # remaining ops and follow-ups
├── README.md                    # local dev walkthrough
├── package.json                 # workspace root; dev/build/seed/test scripts
├── .github/workflows/ci.yml     # typecheck + golden-master tests on push/PR to master
├── docs/
│   ├── build-plan.html          # the original plan (historical — do not edit)
│   └── decisions.md             # nine decided open questions
├── fixtures/
│   ├── june-2026.json           # strict golden-master fixture (6 advisors + 8 managers)
│   ├── june-2026-full.json      # full 45-advisor transcription, seed's source
│   └── verify-fixture.mjs       # standalone proof
├── server/
│   ├── drizzle/                 # generated SQL migrations (committed)
│   ├── drizzle.config.ts        # drizzle-kit config (standalone — see Gotchas)
│   ├── test/
│   │   ├── scoring.test.ts      # golden-master test, `npm test`
│   │   └── roster.test.ts       # floater-widened roster does not double-count
│   └── src/
│       ├── index.ts             # Express app, route mounting, in-process scheduler, shutdown
│       ├── env.ts                # dotenv loading + typed env access
│       ├── auth.ts               # magic-link + Cloudflare Access auth interface
│       ├── middleware.ts         # attachActor, requireAuth, requireRole, requireStoreWrite
│       ├── audit.ts              # writeAudit — every write's single funnel
│       ├── http.ts               # HttpError, asyncHandler, pagination, error middleware
│       ├── league.ts             # currentLeague() — single-league-per-deployment helper
│       ├── validation.ts         # shared Zod schemas (idParam, paginationQuery)
│       ├── db/
│       │   ├── schema.ts         # Drizzle table definitions — source of truth, 22 tables
│       │   ├── client.ts         # pg Pool + drizzle instance
│       │   ├── create.ts         # CREATE DATABASE if missing
│       │   └── migrate.ts        # applies drizzle/ migrations
│       ├── roster.ts             # store employees + unassigned floater advisors
│       ├── scoring/
│       │   ├── engine.ts         # pure scoring functions, versioned
│       │   ├── eligibility.ts    # grace period, hidden/terminated, manager minimum, floater counters
│       │   ├── compute.ts        # DB orchestration: score a period, rank, publish
│       │   └── standings.ts      # fullStandingsFor + decorateScores — shared by the API and mail
│       ├── scheduling/
│       │   └── windows.ts        # submission-window/cutoff math (luxon, IANA-zone-safe)
│       ├── ingestion/
│       │   ├── tabular.ts        # parseTabular + resolveTabularRows — shared by CSV import, XLSX, and grid paste
│       │   ├── roster.ts         # parseRoster + resolveRoster — people, not metrics; matches on email
│       │   └── workbook.ts       # workbookToTsv + parseWorkbookSheet — first sheet of an .xlsx
│       ├── export/
│       │   └── standings.ts      # Sheet[] shaping + CSV/XLSX serializers — shared by both export routes
│       ├── scheduler/
│       │   ├── lock.ts           # Postgres advisory lock wrapper
│       │   └── jobs.ts           # missed-window penalties, reminders, standings mail
│       ├── email/
│       │   ├── send.ts           # EmailTransport (Cloudflare REST / console), sendOnce idempotency
│       │   ├── templates.ts      # standings (full ranking table), reminder, late-penalty, training-flag
│       │   └── standingsMail.ts  # mailStandingsForPeriod — scheduler + POST /mail-standings
│       ├── mcp/
│       │   └── server.ts         # MCP tools: submit_metrics, get_standings, post_announcement
│       ├── routes/
│       │   ├── auth.ts           # request-link, verify, logout, me
│       │   ├── periods.ts        # list/create/lock/publish/recompute
│       │   ├── dealerships.ts    # CRUD + archive/restore
│       │   ├── employees.ts      # roster CRUD + participation (hide/restore)
│       │   ├── categories.ts     # list/create + weight editing with the totals-100 guard
│       │   ├── goals.ts          # per-store goals + carry-forward
│       │   ├── submissions.ts    # entry grid read + write; exports recordSubmission()
│       │   ├── import.ts         # CSV + XLSX preview/commit, plus roster import — thin wrapper over ingestion/
│       │   ├── export.ts         # standings CSV + XLSX download
│       │   ├── scores.ts         # standings, advisor card, store view
│       │   ├── penalties.ts      # manual penalties + training flag (mails trainingFlagEmail)
│       │   ├── announcements.ts  # message board + read receipts
│       │   ├── admin.ts          # compliance view, workspace overview, email log
│       │   ├── apiKeys.ts        # scoped key issuance/revocation
│       │   ├── leagues.ts        # GET/PUT /api/leagues/current
│       │   ├── emailRecipients.ts # extra standings/reminder recipients
│       │   └── external.ts       # /api/v1 — the scoped-key REST surface
│       └── scripts/
│           ├── seed.ts           # loads fixtures/june-2026-full.json as a published period
│           ├── run-scheduler.ts  # standalone scheduler process
│           └── run-mcp.ts        # standalone MCP server process
└── client/
    ├── vite.config.ts            # React + Tailwind plugins, /api dev proxy
    └── src/
        ├── main.tsx               # React root + BrowserRouter + CurrentUserProvider
        ├── App.tsx                # sidebar layout + routes
        ├── index.css              # Tailwind import + design tokens (@theme)
        ├── components/
        │   ├── Sidebar.tsx        # role-gated nav
        │   ├── PageHeader.tsx
        │   └── ui.tsx             # Card, Loading, ErrorState, EmptyState, PositionBadge, StatusChip, Button
        ├── lib/
        │   ├── api.ts             # fetch wrapper, ApiError, toQueryString
        │   ├── useApi.ts          # useApi (fetch + loading/error), useDebounced
        │   ├── usePeriods.ts      # periods list + selection, defaults to most recent
        │   ├── useCurrentUser.tsx # actor context: requestLink, verify, signOut
        │   ├── types.ts           # hand-written API response shapes
        │   └── format.ts          # score/date formatting, tierForPosition (green→amber→red)
        └── pages/
            ├── Home.tsx
            ├── SignIn.tsx          # also mounted at /auth/verify — see Gotchas
            ├── Standings.tsx       # the Victory Lane board — both leaderboards
            ├── AdvisorCard.tsx     # /standings/advisor/:employeeId
            ├── StoreView.tsx       # /standings/store/:dealershipId
            ├── Enter.tsx           # the data-entry grid
            ├── Manage.tsx          # tab shell for roster/goals/categories/penalties
            ├── manage/
            │   ├── RosterTab.tsx
            │   ├── RosterImport.tsx  # commissioner-only bulk roster preview/commit
            │   ├── GoalsTab.tsx
            │   ├── CategoriesTab.tsx
            │   └── PenaltiesTab.tsx
            ├── Announcements.tsx
            ├── Admin.tsx           # tab shell: overview, settings, teams, employees, email, API keys
            └── admin/
                ├── OverviewTab.tsx
                ├── LeagueSettingsTab.tsx
                ├── TeamsTab.tsx
                ├── EmailTab.tsx
                └── ApiKeysTab.tsx
```

### Routes (client)

| Path | Page |
|---|---|
| `/` | Home |
| `/sign-in` | Request a magic link |
| `/auth/verify` | Consumes `?token=` — the magic-link email points here, mounted with the same `SignIn` component |
| `/standings` | Victory Lane board — period selector, Manager + Advisor rankings |
| `/standings/advisor/:employeeId` | Advisor card — position, gap to next, category chart |
| `/standings/store/:dealershipId` | Store view — manager score, team score, roster |
| `/enter` | Data entry grid, scoped to the acting user's store (commissioner picks any) |
| `/manage` | Roster / Goals / Categories / Penalties tabs — commissioner + manager |
| `/announcements` | Message board with read receipts |
| `/admin` | League control centre — commissioner only |

Anything unmatched redirects to `/`.

---

## Data model

22 tables in `server/src/db/schema.ts`. Fifteen were in the original plan;
`delegates`, `announcement_reads`, `api_keys`, `magic_links`, and `sessions`
were added during Phase 1 because the plan's prose already implied them
(roles + delegates, read receipts, scoped keys, magic-link sessions) without
tabulating them. `email_recipients` was added so extra inboxes can be CCed on
league mail.

| Table | Holds | Notes |
|---|---|---|
| `organizations` | Tenant boundary | Every league belongs to one |
| `leagues` | A competition + its settings | Timezone, submission days/cutoff, penalty values, eligibility toggles, `attainmentCap` |
| `periods` | Contest months | `status`: open → locked → published |
| `dealerships` | Store, brand, alias | |
| `employees` | Advisors, managers, commissioners | `role` enum; `dealershipId` null for commissioners and floaters; `consecutiveFloaterMonths` tracks unassigned advisors |
| `delegates` | Who else may write for a store | Decision #7 — manager + named delegates |
| `participation` | Who counts, per period | eligible / hidden / terminated + reason + who decided |
| `categories` | Scoring categories | `scope`, `unit`, `isDerived` (true only for manager's `teamScore`) |
| `category_weights` | Weight, versioned per period | App-enforced: must total 100 per `(scope, period)` |
| `goals` | Target per store/category/period | `source`: league_default vs store_override |
| `submissions` | One filing for one window | `windowDate`, `onTime`, `isFinal`, `provenance` |
| `metric_values` | The numbers | `employeeId` null = store-level (manager board) row |
| `penalties` | Point adjustments | `late_submission` / `training_incomplete` / `manual`; check constraint: exactly one of `dealershipId`/`employeeId` |
| `scores` | Computed results | Append-only, `revision` + `supersededById`; see § Rules |
| `announcements` / `announcement_reads` | Message board | |
| `email_log` | Every send | `idempotencyKey` unique — see § Rules |
| `email_recipients` | Extra inboxes CCed on league mail | Soft-delete via `revokedAt`; `templates` jsonb |
| `audit_log` | Every write | `actorId` nullable (API/MCP writes attribute to the key's creator instead — see `external.ts`) |
| `api_keys` | Scoped REST/MCP credentials | `keyHash` only, never the raw key after issuance |
| `magic_links` / `sessions` | Auth | Hashed tokens, 15-min link expiry, `AUTH_SESSION_DAYS` session expiry |

The `participation` table is the one that's easy to get wrong — see § Rules.

---

## API

All routes are under `/api`. Responses are JSON; errors are
`{ error: string, details?: […] }`. Session auth is a cookie
(`wal_session`), attached by `attachActor()` on every request; routes that
need it call `requireAuth()` / `requireRole(...)` / `requireStoreWrite(...)`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Liveness + DB round trip |
| POST | `/api/auth/request-link` | Issues a magic link; in dev, returns it directly instead of emailing. 400 when `AUTH_PROVIDER=cloudflare-access`. |
| POST | `/api/auth/verify` | Consumes the token, sets the session cookie. 400 when `AUTH_PROVIDER=cloudflare-access`. |
| POST | `/api/auth/logout` | Revokes the session cookie. In Access mode also returns `accessLogoutUrl` (`/cdn-cgi/access/logout`). |
| GET | `/api/auth/me` | `{ actor, authProvider }`. `actor` is null when unsigned-in. |
| GET/POST | `/api/periods` | List / create (with optional carry-forward from another period) |
| POST | `/api/periods/:id/lock` | Marks the latest submission per store final, computes scores |
| POST | `/api/periods/:id/publish` | Publishes the current revision — immutable from here |
| POST | `/api/periods/:id/recompute` | Recomputes without publishing (provisional/live leaderboard) |
| POST | `/api/periods/:id/mail-standings` | Commissioner-only; 400 unless published. Returns `{recipientCount, sent, alreadySent, failed}` |
| GET/POST | `/api/dealerships` | List / create; `POST /:id/archive`, `/:id/restore` |
| GET/POST | `/api/employees` | Roster list / create; `PATCH /:id`, `/:id/archive`, `/:id/restore` |
| PUT | `/api/employees/:id/participation` | Set eligible/hidden/terminated for a period; returns a `warning` if it drops the store below the manager-eligibility minimum |
| GET/POST | `/api/categories` | List (with `?periodId=` for weights) / create |
| PUT | `/api/categories/weights` | Set every category's weight in a scope at once — rejects unless the scope totals exactly 100 |
| GET/PUT | `/api/goals` | Read / bulk-set per store+period; `POST /carry-forward` |
| GET | `/api/submissions/current` | Entry-grid data: roster, categories, last-filed values, window/cutoff info |
| POST | `/api/submissions` | File a window — the web grid's write path |
| POST | `/api/import/preview`, `/commit` | CSV import — same write path, provenance `csv` |
| POST | `/api/import/preview-xlsx`, `/commit-xlsx` | XLSX import — multipart `file` plus dealershipId/periodId |
| POST | `/api/import/roster/preview`, `/commit` | Roster import — commissioner-only; `file` (csv/xlsx) or `text`. Matches on email: known address updates, new one is created |
| GET | `/api/import/roster/template` | The accepted column labels, so the import UI holds no copy of them |
| GET | `/api/export/:periodId/standings.csv` | One scope as CSV — `?scope=advisor\|manager\|team` |
| GET | `/api/export/:periodId/standings.xlsx` | All three scopes as one workbook |
| GET | `/api/scores/:periodId/standings` | Both leaderboards, decorated with names |
| GET | `/api/scores/:periodId/advisor/:employeeId` | Advisor card: breakdown, gap to next position |
| GET | `/api/scores/:periodId/dealership/:dealershipId` | Store view: manager + team + roster scores |
| GET/POST | `/api/penalties` | List / manual penalty; `DELETE /:id` (manual only); `POST /training-flag` |
| GET/POST | `/api/announcements` | List (with `read` flag for the acting user) / post; `POST /:id/read` |
| GET | `/api/admin/compliance` | Late submissions, training flags, manager-eligibility and floater warnings for a period |
| GET | `/api/admin/overview` | Workspace counts |
| GET | `/api/admin/email-log` | Recent `email_log` rows, paginated |
| GET/PUT | `/api/leagues/current` | League settings; PUT is commissioner-only |
| GET/POST | `/api/email-recipients` | Extra recipients; `PATCH /:id`, `POST /:id/revoke` |
| GET/POST | `/api/api-keys` | List (no hash) / create (raw key returned once); `POST /:id/revoke` |
| POST | `/api/v1/submit` | Scoped-key submit — `Authorization: Bearer <key>` |
| GET | `/api/v1/standings` | Scoped-key read |

### Conventions

- **Every request body/query is Zod-parsed** at the top of the handler.
  `ZodError` becomes 400 via `errorHandler` in `http.ts`.
- **Async handlers wrap in `asyncHandler`**; throw `HttpError` (via
  `notFound`/`badRequest`/`forbidden`/`unauthorized`/`conflict`) for expected
  failures.
- **A unique-index violation is a 409, not a 500.** `errorHandler` maps
  SQLSTATE `23505` for every route. A handler that can name the colliding
  field should still pre-check and throw `conflict()` with a message an admin
  can act on — the global branch is only the backstop for a lost race.
- **Write authorization is `canWriteForDealership`** (`middleware.ts`):
  commissioner always; a manager or delegate only for their own store.
  `requireStoreWrite(key, source)` reads the dealership id from `req.params`
  or `req.body`.
- **API-key writes (`external.ts`, `mcp/server.ts`) attribute to the key's
  `createdBy`** — there's no session employee for those provenances, so
  `submittedBy`/`issuedBy` fall back to whoever created the key.
- **Scores are never queried directly for "current."** Always go through
  `currentScoresFor(periodId, scope?)`, which resolves the highest revision
  per `(scope, employeeId, dealershipId)`.

---

## Frontend conventions

- **Data fetching** goes through `useApi(path)` — `{ data, loading, error,
  refetch }`, discards stale responses on rapid path changes. Pass `null` to
  skip fetching.
- **Period selection** goes through `usePeriods()`, which defaults to the
  most recent period (periods are returned newest-first).
- **API paths are relative** (`/api/...`); Vite proxies to `localhost:4000` in
  dev (`client/vite.config.ts`).
- **The acting user** is `useCurrentUser()`'s `actor`, sourced from
  `GET /api/auth/me` on mount (`{ actor, authProvider }`). Nothing reads or
  writes a header for attribution client-side. In `session` mode the cookie
  does that; in `cloudflare-access` mode Sign out navigates to
  `/cdn-cgi/access/logout` (team-wide — every Access app on this account,
  not only this origin).
- **Design tokens** live in `client/src/index.css` under Tailwind v4's
  `@theme`. Three type roles: `--font-display` (Archivo, nav/headers),
  `--font-body` (system sans, copy/forms), `--font-mono` (IBM Plex Mono, every
  score/number). The one signature flourish is `.checker-corner` — a tiny
  checkered-flag mark, used only on a leaderboard's #1 position
  (`PositionBadge` in `components/ui.tsx`). Don't spend it anywhere else.
- **Racing-theme rail elements** — the checkered Victory Lane banner
  (`Standings`), section band titles, and the sidebar/Home accent strips —
  paint on `--color-rail` (`#14171b`, invariant) via `.checker-strip`, never
  `--color-ink`. `--color-ink` is body text and flips light in dark mode;
  using it for a "dark panel" background washes out to unreadable there.
- **Position colouring for ranked boards** goes through `PlateBadge` +
  `plateTierForPosition` (`lib/format.ts`) — a flat four-quartile palette
  (`--color-tier-1..4`, green→red) rendered as a solid mono "license plate",
  used by `Standings`' table + podium, `AdvisorCard`, and `StoreView`. The
  three-tier wash (`tierForPosition`/`PositionBadge`, good/warn/crit) is kept
  only for one-off status chips (`StatusChip`), not ranked positions.
- **`Gauge`** (`components/ui.tsx`) is the semicircular score arc on
  `AdvisorCard` and `StoreView`'s position cards — inline SVG, coloured by
  plate tier when one applies. It's separate from the Recharts convention
  below, which is for the category breakdown chart only.
- **Charts** (`AdvisorCard`'s category breakdown) use Recharts with
  `isAnimationActive={false}` for deterministic rendering, coloured from
  `--color-brand`, not a categorical palette — there's one series.
- **`Enter`'s grid accepts a paste of a copied spreadsheet range** — an
  `onPaste` on the grid's `Card` calls `POST /api/import/preview` (the same
  matching CSV import uses) and merges the result into local state; nothing
  is submitted until the manager reviews and clicks Save. A single-cell paste
  (no `\n` in the clipboard text) falls through to normal input behaviour.
  **Upload spreadsheet** (`POST /api/import/preview-xlsx`) uses the same
  preview-then-Save flow.
- **The entry grid navigates with arrow keys and Enter**, like a spreadsheet
  — `handleGridKeyDown` in `Enter.tsx`. Left/Right always move cell-to-cell
  rather than checking cursor position, because `type="number"` inputs don't
  expose `selectionStart`/`selectionEnd` in Chrome (always `null`) — a
  boundary check there silently never fires.

---

## Local development

See [README.md](README.md) for the full walkthrough. Short version:

```bash
npm install
cp .env.example .env      # then edit DATABASE_URL if needed
npm run setup             # db:create → db:migrate → seed
npm run dev                # API on :4000, web on :5173
npm test                   # golden-master scoring tests
```

### Gotchas

- **`drizzle.config.ts` and `db/schema.ts` must not import `src/env.ts` or
  anything but drizzle itself.** drizzle-kit bundles both as CJS, which can't
  load ESM-only `import.meta.url`. `drizzle.config.ts` reads `.env` directly;
  keep any var both need in step by hand.
- **`/auth/verify` must be a registered client route, not just an API one.**
  The magic-link email points at `${APP_BASE_URL}/auth/verify?token=...`
  (`server/src/auth.ts`); if that path isn't in `App.tsx`'s `<Routes>`, it
  falls through to the catch-all redirect and the token is silently dropped.
  It's mounted with the same `SignIn` component as `/sign-in` — that page
  reads `?token=` regardless of which path rendered it.
- **The MCP server and the external REST API share one API-key table and one
  hash function** (`hashApiKey` in `routes/apiKeys.ts`). A key created via
  `POST /api/api-keys` works for both `MCP_API_KEY` and
  `Authorization: Bearer` — there's no separate MCP credential.
- **`npm ci`/`npm install` may block esbuild's postinstall** (needed by
  tsx/vite/drizzle-kit). `npm approve-scripts --allow-scripts-pending`.
- **The local Postgres uses `trust` auth on localhost** (matching
  `../pokemon-crm`), so `.env`'s `PGPASSWORD` is empty. A host that requires
  TLS needs `PGSSL=true`.
- **Never rewrite a source file with PowerShell `Set-Content`** — it writes
  the wrong codepage. Use the editing tools.

---

## Production

Hostname `auto.ethandbard.com`, containers `we-auto-league` /
`we-auto-league-db`, database `we_auto_league`, port 4000, `edge`/`internal`
networks. Origin is up at `/opt/we-auto-league`; `.deployed-sha` is the
commit that is running. Ingress, DNS, and the Access app `auto` (reusable
`allow-emails` policy) all use this hostname. Deployment, the shared
tunnel, Access, and backups go through the `deploy-to-hetzner` skill.

Backups are **daily** (moved from weekly 2026-08-30): `backup.sh` runs from
cron at `0 6 * * *`, snapshotting a Postgres dump to the R2 bucket
`ethandbard-vps-backups` via restic, retention
`--keep-daily 7 --keep-weekly 4 --keep-monthly 6`. Worst-case data loss is
about 24 hours. Backups are a property of this VPS, not of the app: moving
hosts means re-establishing them. Viewing and fixing data (including safe
SQL surgery) is [docs/data-corrections.md](docs/data-corrections.md).

Production `AUTH_PROVIDER` is `cloudflare-access`. Two gates, not one:

1. Cloudflare Access (`allow-emails`) is the front door — a PIN for
   `ethan@thebardfamily.com` (and whoever else is on that policy).
2. The origin then maps `Cf-Access-Authenticated-User-Email` onto
   `employees.email`. The seed commissioner is `ethan@thebardfamily.com`.
   Matching that row is what makes someone a commissioner in the app.

Do not clear only the client actor on Sign out — Access still has a JWT,
`/api/auth/me` will restore them, and the magic-link form cannot email.
Sign out must send the browser to `/cdn-cgi/access/logout`. That revoke
is team-wide (pokemon-crm, notebox, and the other Access apps too).
`/sign-in` in this mode is a reload prompt, not an email form.
`request-link` / `verify` return 400.

Magic-link sessions stay the local default. Do not switch production back
to `session` until Cloudflare Email Sending is configured.

The production image has no `tsx`. Migrate and seed with compiled JS, not
the npm scripts. Migration `0001` is already applied. Do not re-run seed:

```
docker compose exec app node server/dist/db/migrate.js
docker compose exec app node server/dist/scripts/seed.js
```

`migrate.ts` resolves `drizzle/` from the file's location, not CWD. The
runtime image copies `fixtures/` because `seed.js` reads
`fixtures/june-2026-full.json` from the repo root.

**Email transport is chosen at boot** by `selectTransport()` in
`email/send.ts`: `EMAIL_PROVIDER` pins one explicitly (`resend` /
`cloudflare` / `console`), otherwise the first configured credential wins,
Resend first. No credential means the console transport — nothing is sent.
`EMAIL_FROM` is shared by every transport (`CF_EMAIL_FROM` is the old name,
still read as a fallback).

Resend is the production default: no Workers Paid plan, no sending-subdomain
onboarding, and generally available rather than in beta. It is the only
transport that returns a real provider message id, so `email_log`'s
`providerMessageId` is null on the others. Cloudflare's send path is
`/email/sending/send`; a `permanent_bounces` hit counts as `failed`.

Resend is live in production as of 2026-08-29. Mail sends from
`standings@mail.auto.ethandbard.com`, a verified sending domain whose DKIM,
SPF, and DMARC records sit on the `ethandbard.com` zone under
`mail.auto`. **Never put SPF or DKIM on `auto.ethandbard.com`** — that
hostname is a proxied tunnel CNAME. DMARC is scoped to `_dmarc.mail.auto`,
not the apex: the zone is shared with the other projects, and an apex record
sets policy for all of them.

The seeded roster is still 53 placeholder `@weauto.local` addresses, so the
scheduler's reminder and late-penalty mail now hard-bounces. See
[TODO.md](TODO.md) item 1a before the next submission window.

Moving `AUTH_PROVIDER` off `cloudflare-access` is no longer gated on email;
it is gated on rate-limiting `POST /api/auth/request-link` — TODO item 1.

---

## Not yet built

See [TODO.md](TODO.md) for the live list. The two items that stay deferred
on purpose:

- **`DmsAdapter`** — until the client names their DMS. `POST /api/v1/submit`
  is the seam today.
- **Trend charts across periods** — `AdvisorCard` still charts one period.
