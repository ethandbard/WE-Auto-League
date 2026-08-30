# TODO

Live at auto.ethandbard.com on `25159a8` (`master`). Migration `0001` is
applied (`email_recipients`, `employees.consecutive_floater_months`). Do not
re-run seed.

The next deploy applies `0002` (email controls, pauses the league) and `0003`
(`penalties.window_date` plus its partial unique index, backfilled from the
existing late penalties' reason text). After it runs, check that no late
penalty was left with a null `window_date`:

```sql
select id, period_id, dealership_id, reason from penalties
where kind = 'late_submission' and window_date is null;
```

A row here is either a duplicate the backfill deliberately skipped or a
reason the parser could not read. Neither breaks anything — the scheduler
dedupes on the sibling row that does carry the date — but a lone unreadable
row means that window can be charged a second time, so set its date by hand.

---

## 1. Turn on real email — DONE (2026-08-29)

**Resend is live in production.** `mail.auto.ethandbard.com` is a verified
sending domain on the `thebardfamily` Resend account, region `us-east-1`,
custom return-path `send`. Production `config.env` carries
`EMAIL_PROVIDER=resend`, `EMAIL_FROM=standings@mail.auto.ethandbard.com`,
and `RESEND_API_KEY` (key `we-auto-league-prod`, **Sending access**, scoped
to all domains — tighten to this one when a second domain is added). The
Cloudflare transport stays in the code as an alternative but is not the plan:
Email Sending needs Workers Paid and is still in public beta.

Four DNS records on the `ethandbard.com` zone, all `DNS only`:

| Type | Name | Content |
|---|---|---|
| TXT | `resend._domainkey.mail.auto` | the 218-char `p=…` DKIM key |
| MX | `send.mail.auto` | `feedback-smtp.us-east-1.amazonses.com`, priority 10 |
| TXT | `send.mail.auto` | `v=spf1 include:amazonses.com ~all` |
| TXT | `_dmarc.mail.auto` | `v=DMARC1; p=none;` |

Two deliberate departures from what the Resend dashboard hands you. Its
inbound MX (`mail.auto` → `inbound-smtp.us-east-1.amazonaws.com`) is **not**
added — this app only sends. And DMARC is scoped to `_dmarc.mail.auto`, not
the apex `_dmarc`: the zone is shared with notebox, pokemon-crm, and the
homepage, and an apex record sets policy for all of them.

Do **not** use Resend's "Auto configure" button. It takes an OAuth grant with
write access to the whole zone.

Verified end to end: a `sendOnce()` call from inside the production container
delivered to `ethan@thebardfamily.com` and wrote an `email_log` row with a
non-null `providerMessageId`. That field is the tell — only Resend returns
one, so any row with a null id was written by the console or Cloudflare
transport.

**Rate limiting `POST /api/auth/request-link` is done** (5 per 15 min per
client IP, `server/src/rateLimit.ts`), so the switch to `AUTH_PROVIDER=session`
is no longer blocked on it. What remains is working email for the roster.

Sending should eventually come from the *client's* domain, not
`ethandbard.com` — that is a handoff asset, and it is what makes the mail
look like a product rather than a favour.

## 1a. The scheduler now mails placeholder addresses

Turning the transport on made a dormant problem live. `seed.ts` gives every
seeded employee an address at `@weauto.local`, a TLD that does not exist. 53
of the 55 rows are placeholders; only `ethan@thebardfamily.com` is real.

Published-standings mail is safe: its idempotency key is `standings:<scope>`
plus the period, and those rows are already logged `sent` from the
console-transport era, so `sendOnce` short-circuits them.

Reminders and late penalties are **not** safe. Their keys carry the window
date (`reminder:<windowDate>`, `late-penalty:<windowDate>`), so every new
window is a new key and a real send — 8 managers, twice a week, all hard
bouncing on a two-day-old sending domain.

**Handled in the app as of the phase 1 email controls.** Migration `0002`
brings the league up with `emailPaused` set, so the scheduler still applies
late-submission penalties while every send is logged `suppressed` instead of
delivered. `ENABLE_SCHEDULER=false` is no longer the lever to reach for — it
would stop penalties being *applied*, a scoring change rather than a mail
change. What remains is item 1b: load real addresses, then resume sending in
**Admin → Email**, one template at a time if you like.

**Mitigated 2026-08-30.** Production `config.env` now pins
`EMAIL_PROVIDER=console`: the scheduler still runs and still applies
penalties, but no mail leaves the box (console-transport "sends" are logged
in `email_log` with a null `providerMessageId`). This is deliberately a
third option — `ENABLE_SCHEDULER=false` was rejected because it changes
scoring. Restore `EMAIL_PROVIDER=resend` only after the in-app email pause
(hardening plan phase 1) is deployed and the league is paused there, so
mail control moves to the Admin screen. Real sending to the roster stays
gated on item 1b regardless.

## 1b. Collect the roster's email addresses

Now urgent — see item 1a. The seeded roster has 45 advisors and **no real
email addresses**: `seed.ts` synthesizes `<alias>@weauto.local` for everyone,
because the fixture's source was a printed scoreboard. Bulk roster import now
exists to load them (Manage → Roster → Import roster, commissioner-only,
matches on email), so this is a data-collection task, not a build task.

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

**Cadence fixed 2026-08-30.** The cron is now daily (`0 6 * * *`), matching
the `--keep-daily 7` retention that always implied it. Worst-case loss is now
about 24 hours. The change is reflected in the `agent-skills` repo
(`deploy-to-hetzner` README/SKILL/references and `finish-vps.ps1`, so a VPS
rebuild reinstalls daily, not weekly) and the skill was reinstalled. The
day-to-day view/fix/restore procedures are documented in
[docs/data-corrections.md](docs/data-corrections.md). Still true: backups
live entirely on this VPS — moving hosts re-opens this from zero.

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
