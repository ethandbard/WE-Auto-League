# TODO

Live at auto.ethandbard.com on `8df91a8` (`master`). Migration `0001` is
applied (`email_recipients`, `employees.consecutive_floater_months`). Do not
re-run seed. Do not re-fix `email/send.ts` — the path is already
`/email/sending/send`.

---

## 1. Onboard Cloudflare Email Sending — blocked on permissions

Console transport is still live. Production `config.env` has `CF_EMAIL_FROM`
set and `CF_EMAIL_ACCOUNT_ID` / `CF_EMAIL_API_TOKEN` empty.

Wrangler and the Cloudflare API both return **Unauthorized [code: 2036]** for
Email Sending with the current account token. A human must add Email Sending
permission (or mint a scoped token) before any of these steps work.

1. Confirm Email Sending is allowed on account `f6afef234770add442ef630ebd2e82c9`.
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

## 2. Verify a backup restore

Operational only. No code.

Restore a nightly restic snapshot to a scratch Postgres instance and diff
row counts against production. See the `deploy-to-hetzner` restore reference.

## 3. CC extra recipients on non-standings templates

`email_recipients.templates` accepts `standings`, `reminder`, `late-penalty`,
and `training-flag`. Only `standings` is sent today
(`server/src/email/standingsMail.ts`). Wire the other three in
`scheduler/jobs.ts` and `routes/penalties.ts`. Honour `dealershipId` when set.

## 4. Fold in the Admin visual redesign if wanted

A Claude Design canvas was requested and could not be opened from a
sandboxed browser. Admin currently matches the Manage tab shell.

Canvas:
https://claude.ai/design/p/dc5ed2f6-4473-48c7-b73a-5d92bb1efc40?file=WE+Auto+League.dc.html&via=share

Keep the six-tab functional scope. Restyle only after viewing the canvas in
a logged-in browser.

## 5. Deferred until the client names their DMS

`DmsAdapter` stays unimplemented. `POST /api/v1/submit` is the integration
seam today.

## 6. Deferred until there are more periods

Trend charts across periods. `GET /api/scores/advisor/:id/trend?periods=N`
was the sketched shape. `AdvisorCard` still charts one period.
