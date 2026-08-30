# Hardening plan

Work plan for the findings in the 2026-08-30 diligence review and the gaps in
[data-corrections.md](data-corrections.md). Phases 1, 2, and 4 can run in
parallel on separate branches. Phase 3 starts after phase 1 merges — both
touch `scheduler/jobs.ts` and the migration sequence.

Status legend: `done` / `in progress` / `queued` / `user action`.

## Phase 0 — stop the placeholder mail (done 2026-08-30)

Production `config.env` pins `EMAIL_PROVIDER=console`. The scheduler still
runs and still applies late penalties; no mail leaves the box. Revert to
`EMAIL_PROVIDER=resend` only after phase 1 deploys with sending paused in-app
and the roster carries real addresses (TODO 1b).

## Phase 1 — email scheduler controls (branch `agent/email-controls`, built 2026-08-30)

An Admin → Email surface that controls automated mail without config edits.
Built as described below; migration `0002` carries it, and the deploy order is
in CLAUDE.md § Production.

- **Pause switch.** A league-level `emailPaused` flag, enforced in `sendOnce`
  so every template funnel respects it. Suppressed sends are logged with a
  distinct status so the email log shows what would have gone. Magic-link
  mail is exempt (it is not scheduler mail). The migration sets the existing
  league to paused.
- **Per-template toggles** for `reminder`, `late-penalty`, `standings`, and
  `training-flag`.
- **Template drafting.** Editable subject and body per template with
  placeholder substitution, falling back to the code default when no
  override exists. Preview, and a send-test-to-me action.
- **Timing.** Reminder lead time (hours before cutoff, default 2) as a
  setting instead of the hardcoded constant. A toggle for auto-mailing
  standings on publish. Submission days and cutoff already live in league
  settings.

## Phase 2 — security hardening (branch `agent/security-hardening`)

- Verify the Cloudflare Access JWT (`Cf-Access-Jwt-Assertion`) against the
  team's public keys instead of trusting the plain email header. New env:
  team domain and audience tag; required when `AUTH_PROVIDER=cloudflare-access`.
- Rate-limit `POST /api/auth/request-link` and `/verify` hard, and the rest
  of `/api` gently. Key on the client IP Cloudflare forwards.
- Refuse to boot in production with the default `AUTH_SECRET`.
- Standard security headers.
- Store-scoped API keys: `GET /api/v1/standings` returns only the key's
  store when the key is scoped.
- Run the container as a non-root user.

## Phase 3 — data integrity and correction routes (branch `agent/data-integrity`, built 2026-08-30)

Built as described below. Migration `0003` carries the penalty column and its
backfill; the deploy note is in CLAUDE.md § Production.

- Make `recordSubmission` transactional: no orphan submission row when
  validation fails mid-write (the silent late-penalty bypass).
- Dedupe late penalties on structured data: a `windowDate` column and a
  unique index on `(periodId, dealershipId, kind, windowDate)`, not the
  reason string. Backfill existing rows from their reason text.
- Validate that submitted advisor values belong to the filing store's roster.
- Correction routes, closing the SQL-only gaps in data-corrections.md:
  period unlock, penalty waive (zero, with a reason, any kind), submission
  delete, and a read API plus Admin tab for `audit_log`.

What phase 3 did not close, and is still on data-corrections.md's list: no
penalty credits, no submission edit, no re-mail of a corrected board, and no
buttons for unlock / waive / submission delete — those three are API calls.

## Phase 4 — tests and CI (branch `agent/integration-tests`)

- DB-backed integration tests (local Postgres, separate test database) for:
  `recordSubmission`, `canWriteForDealership`, magic-link issue/consume/
  expiry, and `applyMissedWindowPenalties` idempotency.
- CI: a Postgres service container so those tests run on push, plus
  `npm audit --omit=dev` as a non-blocking report.
- HTTP-level route tests are deferred until phases 1–3 merge.

## Phase 5 — operations and business (user actions)

- Collect real roster email addresses, or decide store-level access
  (TODO 1b; blocks unpausing reminders).
- Move sending to the client's domain at handoff.
- Continuity contract: license grant or escrow, transferable credentials,
  named support (diligence report conditions).
- Monitoring beyond the healthcheck: error notification and
  scheduler-failure alerts. Queued; small enough to fold into a later phase.
- Daily backups: done 2026-08-30 (see TODO item 2).
