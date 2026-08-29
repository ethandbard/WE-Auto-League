# TODO

Live at auto.ethandbard.com on `25159a8` (`master`). Migration `0001` is
applied (`email_recipients`, `employees.consecutive_floater_months`). Do not
re-run seed.

---

## 1. Turn on real email — code is done, needs a key and DNS

**Resend is wired and is now the default transport** (2026-08-27). The
Cloudflare transport is kept as an alternative but is no longer the plan:
Email Sending is gated behind Workers Paid ($5/mo) on account
`f6afef234770add442ef630ebd2e82c9`, and it is still in public beta. Resend
needs neither, and its free tier (3,000/mo, 100/day) covers this league's
volume — roughly 400–500 sends a month.

Nothing sends until a credential is set. Production `config.env` currently
has every email credential empty, so `selectTransport()` falls through to the
console transport.

To finish:

1. Create the Resend account and verify a sending domain. Resend issues the
   SPF and DKIM records; add them to the zone. Do **not** put SPF on
   `auto.ethandbard.com` — that hostname is already a CNAME. Use a
   subdomain (`mail.auto.ethandbard.com`, decision #8).
2. Check whether `_dmarc.ethandbard.com` already exists before adding one —
   the zone is shared with the other projects.
3. Set `RESEND_API_KEY`, `EMAIL_PROVIDER=resend`, and
   `EMAIL_FROM=standings@mail.auto.ethandbard.com` in both
   `~/.we-auto-league-secrets/config.env` and `/opt/we-auto-league/config.env`.
   Compare checksums first. Do not overwrite production with a local test file.
4. Recycle the app container so it picks up the env file
   (`cd /opt/we-auto-league && docker compose up -d`). No image rebuild needed.
5. In Admin → **Email & communications**, send standings for a published
   period. Confirm rows in `email_log` (with a non-null `providerMessageId`,
   which only Resend returns) and in the Resend dashboard.

**Before switching `AUTH_PROVIDER` to `session`, rate-limit
`POST /api/auth/request-link`.** It is unauthenticated, and Cloudflare Access
is the only thing in front of it today. On a public URL it is an open
email-bomb and account-enumeration vector that would also burn the sending
quota. Rate limiting must land in the same change as the auth switch, not
after it.

Sending should eventually come from the *client's* domain, not
`ethandbard.com` — that is a handoff asset, and it is what makes the mail
look like a product rather than a favour.

Use the `deploy-to-hetzner` skill.

## 1b. Collect the roster's email addresses

Blocks everything in item 1 that isn't DNS. The seeded roster has 45 advisors
and **no email addresses** — the fixture has none, because the source was a
printed scoreboard. Bulk roster import now exists to load them
(Manage → Roster → Import roster, commissioner-only, matches on email), so
this is a data-collection task, not a build task.

Open question for the client, and it may change the product: **do service
advisors have individual work email?** At a lot of dealerships they don't. If
they don't, individual advisor logins are the wrong shape and a store-level
or breakroom-display view is the right one.

## 2. Verify a backup restore — done, but it uncovered two real bugs

**Done 2026-08-25.** WE-Auto-League had **never actually been backed up**:
`agent-skills/deploy-to-hetzner/inventory.json` (the source repo) already
listed it, but the copy deployed to the VPS at
`/opt/deploy-pipeline/skill/inventory.json` was stale and didn't — so the
weekly cron silently skipped it, along with `notebox`, `ellmer-practice`, and
`admin-panel`.

Fixed:
1. `inventory.json` gained a `db_user` field per postgres app (`pokemon_crm`,
   `we_auto_league`) — `backup.sh`'s `dump_postgres` was hardcoded to
   `-U pokemon_crm`, which would have produced a broken dump for any other
   postgres app the day this ran for real.
2. `backup.sh`'s `docker compose exec -T db pg_dump ...` had no `< /dev/null`,
   so it inherited the enclosing `while read` loop's stdin — the
   process-substitution stream driving that loop — and silently swallowed
   every inventory line after the first postgres app. That's why `notebox`
   and `ellmer-practice` were missing too, independent of the stale-inventory
   bug.
3. Synced the fixed `inventory.json` and `backup.sh` to
   `/opt/deploy-pipeline/skill/` on the VPS and re-ran the backup. The latest
   snapshot (`341b1d9b`) now includes `we-auto-league`, `notebox`, and
   `ellmer-practice`.

Restore drill: restored `we-auto-league`'s dump into a scratch `postgres:16`
container (`restic-drill-pg`), compared `n_live_tup` per table against the
live `we-auto-league-db` container — all 22 tables matched exactly. Scratch
container and `/tmp/restic-drill` were cleaned up afterward.

Both fixes are committed to the `agent-skills` repo, not just the VPS copy —
reinstall (`./install.sh deploy-to-hetzner`) picks them up for other
projects too.

**Still open: the cadence is wrong for this app.** `backup.sh` runs weekly
(`0 6 * * 0`), so worst-case loss is seven days — an entire submission cycle,
for data people are paid against. The retention flags
(`--keep-daily 7`) imply a daily run that isn't scheduled. Either move the
cron to daily, or accept a 7-day RPO deliberately and write it down. Backups
also live entirely on this VPS: moving hosts re-opens this from zero.

## 3. CC extra recipients on non-standings templates — done

**Done 2026-08-25.** Added `server/src/email/recipients.ts`
(`ccExtraRecipients`) — queries `email_recipients` for rows subscribed to a
given template where `dealershipId` is null (league-wide) or matches the
send's store, and CCs each via the existing `sendOnce` idempotency path.
Wired into `scheduler/jobs.ts` (`reminder`, `late-penalty`) and
`routes/penalties.ts` (`training-flag`, scoped by the flagged employee's
`dealershipId`). Typecheck and `npm test` both pass.

## 3b. Standings export and roster import — done

**Done 2026-08-27.** Export: `GET /api/export/:periodId/standings.csv?scope=`
and `.xlsx` (three sheets), shaped by `server/src/export/standings.ts`, linked
from the Standings header. Sheets are purely tabular and carry engine version,
computed-at, and published state per row so an export stands on its own in a
pay dispute.

Roster import: `POST /api/import/roster/{preview,commit}`, commissioner-only,
CSV/TSV/XLSX or pasted text, matched on email with a per-field diff in the
preview and the commit button disabled while any row has an error. Verified
end-to-end against the dev database: a re-import of an unchanged file is a
no-op, and both writes landed in `audit_log` with `provenance=csv`.

## 4. Admin visual redesign — reviewed, nothing to fold in

**Checked 2026-08-25 in a logged-in browser.** The canvas
(https://claude.ai/design/p/dc5ed2f6-4473-48c7-b73a-5d92bb1efc40?file=WE+Auto+League.dc.html&via=share)
is one interactive prototype for all 8 screens, built by asking the client
motifs/scope/density questions first. Its own answer for
`entry_admin_theme` was **"Keep utilitarian"** — Enter, Manage, and Admin
were deliberately left plain; only Home/Standings/Board/AdvisorCard/StoreView
got the checkered banners, plate badges, podium blocks, gauges, and
racing-stripe accents.

The rendered Home artboard matches the live app almost element-for-element
(same copy, leader card, quick-link grid, stats row), and its 4-step
green→yellow→orange→red tier gradient matches `--color-tier-1..4` in
`client/src/index.css` exactly — this redesign was already folded in by
commit `4291c9c` ("Apply racing-theme redesign to Home/Standings/
AdvisorCard/StoreView"). Admin intentionally still matches the Manage tab
shell, which is the canvas's own call, not a gap. No further restyling
needed.

## 5. Deferred until the client names their DMS

`DmsAdapter` stays unimplemented. `POST /api/v1/submit` is the integration
seam today.

## 6. Deferred until there are more periods

Trend charts across periods. `GET /api/scores/advisor/:id/trend?periods=N`
was the sketched shape. `AdvisorCard` still charts one period.
