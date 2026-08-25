# TODO

Live at auto.ethandbard.com on `8df91a8` (`master`). Migration `0001` is
applied (`email_recipients`, `employees.consecutive_floater_months`). Do not
re-run seed. Do not re-fix `email/send.ts` — the path is already
`/email/sending/send`.

---

## 1. Onboard Cloudflare Email Sending — blocked on plan, not permissions

Console transport is still live. Production `config.env` has `CF_EMAIL_FROM`
set and `CF_EMAIL_ACCOUNT_ID` / `CF_EMAIL_API_TOKEN` empty.

**Checked 2026-08-25 in the dashboard, not just via the API:** the
Unauthorized [code: 2036] error isn't a token-permission gap — Email Sending
(`/email-service/sending`) is gated behind the **Workers Paid** plan on
account `f6afef234770add442ef630ebd2e82c9`, and this account is still on the
free tier. The dashboard's only next step is "Purchase Workers Paid." That's
a subscription purchase, so it needs the account owner to buy it directly —
not something to do from an agent session. Ethan chose to hold off for now.

Once Workers Paid is purchased, resume here:

1. Confirm Email Sending is enabled on account `f6afef234770add442ef630ebd2e82c9`.
2. Check whether `_dmarc.ethandbard.com` or `_dmarc.auto.ethandbard.com` already
   exists — the zone is shared.
3. Onboard `mail.auto.ethandbard.com` with `npx wrangler email sending enable`
   or `POST /zones/{zone_id}/email/sending/subdomains`
   (`"name": "mail.auto.ethandbard.com"`). That adds SPF TXT and DKIM CNAME.
   Do not put SPF on `auto.ethandbard.com` — that hostname is already a CNAME.
4. Add a DMARC TXT at `_dmarc.auto.ethandbard.com` if none exists.
5. Create an API token scoped to Email Sending.
6. Set `CF_EMAIL_ACCOUNT_ID`, `CF_EMAIL_API_TOKEN`, and
   `CF_EMAIL_FROM=standings@mail.auto.ethandbard.com`. Write both
   `~/.we-auto-league-secrets/config.env` and `/opt/we-auto-league/config.env`.
   Compare checksums first. Do not overwrite production with a local test file.
7. Recycle the app container so it picks up the env file
   (`cd /opt/we-auto-league && docker compose up -d`). No image rebuild needed.
8. In Admin → **Email & communications**, send standings for a published
   period. Confirm rows in `email_log` and in Cloudflare Email Sending
   analytics.

Until this lands, do not switch production `AUTH_PROVIDER` off
`cloudflare-access`. Magic-link sign-in needs working mail.

Use the `cloudflare-email-service` and `deploy-to-hetzner` skills.

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

## 3. CC extra recipients on non-standings templates — done

**Done 2026-08-25.** Added `server/src/email/recipients.ts`
(`ccExtraRecipients`) — queries `email_recipients` for rows subscribed to a
given template where `dealershipId` is null (league-wide) or matches the
send's store, and CCs each via the existing `sendOnce` idempotency path.
Wired into `scheduler/jobs.ts` (`reminder`, `late-penalty`) and
`routes/penalties.ts` (`training-flag`, scoped by the flagged employee's
`dealershipId`). Typecheck and `npm test` both pass.

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
