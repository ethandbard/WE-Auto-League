# Viewing and correcting data

How to inspect the data the league runs on, and how to fix a mistake. Prefer
the app; fall back to SQL only when no route exists, and follow the safety
rules in that section.

Two invariants shape every correction:

- **Published standings are immutable.** A correction produces a new labelled
  revision. It never edits a board that has been mailed.
- **Every write is attributed.** App and API writes land in `audit_log`
  automatically. SQL writes do not — record them by hand (see
  [Correct with SQL](#correct-with-sql)).

## View data

| What | Where |
|---|---|
| Standings, any period, any revision state | **Standings** page, or `GET /api/scores/:periodId/standings` |
| One advisor's breakdown | **Standings → advisor row**, or `GET /api/scores/:periodId/advisor/:employeeId` |
| Last-filed numbers for a store | **Enter** (loads the latest submission), or `GET /api/submissions/current` |
| Goals, weights, roster, penalties | **Manage** tabs |
| Late submissions, training flags, eligibility warnings | **Admin → Overview** (compliance), or `GET /api/admin/compliance` |
| Every email the system sent, with status | **Admin → Email**, or `GET /api/admin/email-log`. Status `suppressed` = the pause switch or a template toggle stopped it; the row records what would have gone out. |
| Dispute-grade export | **Standings → Export** (`.csv` / `.xlsx`), rows carry engine version and publish state |
| The audit trail | SQL only — `audit_log` is not exposed in the UI or API yet |
| Any table, dev machine | `npm run db:studio` in `server/` (Drizzle Studio, browser UI) |
| Any table, production | `psql` inside the db container — see the next section |

### Open a production SQL session

```bash
ssh hetzner 'cd /opt/we-auto-league && docker compose exec db psql -U we_auto_league we_auto_league'
```

Useful inspection queries:

```sql
-- The audit trail, newest first
select created_at, action, entity_type, entity_id, actor_id, provenance
from audit_log order by created_at desc limit 50;

-- Every filing for a store in a period
select id, window_date, submitted_at, on_time, is_final, provenance
from submissions where dealership_id = $1 and period_id = $2
order by submitted_at desc;

-- The numbers inside one submission
select mv.employee_id, c.key, mv.value
from metric_values mv join categories c on c.id = mv.category_id
where mv.submission_id = $1;

-- All penalties in a period
select id, kind, dealership_id, employee_id, value, reason
from penalties where period_id = $1;

-- Score revisions for one advisor (highest revision is current)
select revision, total, penalty_total, position, is_published, superseded_by_id
from scores where period_id = $1 and employee_id = $2 order by revision;
```

## Correct through the app

Use these paths first. Each one writes the audit log and respects the
scoring invariants.

| Mistake | Fix |
|---|---|
| Wrong numbers filed, period still open | Re-file the grid on **Enter**. Submissions are full MTD snapshots — the newest one supersedes the old completely. Then **recompute** to refresh the provisional board. |
| Wrong goal | **Manage → Goals**, edit, then recompute. |
| Wrong category weights | **Manage → Categories**. The scope must total exactly 100. Recompute after saving. |
| Advisor should not count this month | **Manage → Roster → Hide**, with a reason. This is a scoring input: it removes them from the team mean. Do not archive them for this. |
| Advisor left mid-month | Same hide flow, status `terminated`. |
| Roster fact wrong (name, store, role, email, hire date) | **Manage → Roster** edit, or a roster import (matches on email, previews a per-field diff). |
| Manual penalty entered in error | **Manage → Penalties → delete**. Only `manual` penalties can be deleted here — for the other kinds see [Correct with SQL](#correct-with-sql). |
| A score needs a discretionary deduction | Add a manual penalty with a reason. Values are positive-only; the ledger has no credits. To *restore* points, zero an existing penalty with SQL instead. |
| Automated mail is going out when it should not | **Admin → Email → Pause all sending**, or turn off the one template. Suppressed sends are logged, not dropped, and the same recipient still gets a real copy once mail resumes. |
| Automated mail says the wrong thing | **Admin → Email → Edit draft** on that template. Preview and send-test-to-me before saving; **Revert to default** puts the built-in text back. |
| Published board is wrong | Fix the underlying input (rows in this table, or SQL if the period is no longer open), then `POST /api/periods/:id/recompute` and `POST /api/periods/:id/publish`. This creates revision N+1 and links each old row to its replacement. |

Two things the app cannot do today:

- **Reopen a period.** `lock` and `publish` are one-way; no unlock route
  exists. Reopening takes SQL.
- **Re-mail a corrected board.** The email idempotency key is
  `(template, period, recipient)` and ignores revisions, so recipients of
  revision 1 are skipped when you mail revision 2. Announce corrections on
  the board, or clear the relevant `email_log` rows first (see the next
  section).

## Correct with SQL

For anything the table in the last section marks as SQL, work inside the db
container. Three rules, every time:

1. **Dump first.** A pre-surgery snapshot costs seconds:

   ```bash
   ssh hetzner 'cd /opt/we-auto-league && docker compose exec -T db pg_dump -U we_auto_league -Fc we_auto_league < /dev/null > backups/pre-fix-$(date -u +%Y%m%dT%H%M%SZ).dump'
   ```

2. **Wrap in a transaction.** `begin;` … inspect with `select` … `commit;`
   or `rollback;`.

3. **Write the audit row yourself.** SQL bypasses `writeAudit`, so record
   what you did in the same transaction:

   ```sql
   insert into audit_log (league_id, actor_id, action, entity_type, entity_id, after, provenance)
   values (1, <your employee id>, 'manual_sql_fix', '<table>', <row id>,
           jsonb_build_object('note', '<what and why>'), 'system');
   ```

After any change to submissions, metric values, penalties, goals, or
participation: recompute the period so the standings reflect it.

### Fix one metric value

```sql
update metric_values set value = 123.4567 where id = <id>;
```

Store the full-precision figure, not the 2dp display value — a rounded input
scores wrong (the WC Conv trap in `CLAUDE.md`).

### Waive a late-submission penalty

Do **not** delete the row, and do **not** edit its reason. The scheduler's
duplicate check is "a `late_submission` row for this store and period whose
reason matches this exact text" — delete the row or change one character of
the reason, and the penalty comes back at full value on the next 15-minute
tick. Zero the value and leave the reason untouched:

```sql
update penalties set value = 0
where id = <id> and kind = 'late_submission';
```

Put the why in the audit row from rule 3 — that is the only safe place for
it. The durable fix (dedupe on store + window date, not prose) is on the
books.

### Remove a training penalty

`training_incomplete` penalties are issued by a person, not the scheduler,
so deleting the row is safe:

```sql
delete from penalties where id = <id> and kind = 'training_incomplete';
```

### Delete a bad submission

For a filing made against the wrong store or period:

```sql
delete from metric_values where submission_id = <id>;
delete from submissions where id = <id>;
```

If this removes a store's only filing before a past cutoff, the scheduler
will issue a late penalty for that window on its next tick. That is usually
correct; zero it (as earlier in this section) if it is not.

### Reopen a locked or published period

```sql
update periods set status = 'open', locked_at = null where id = <id>;
```

Consequences to accept before running it:

- Published `scores` rows stay published — that is by design. After the
  correction, lock and publish again; the recompute writes the next revision.
- `is_final` flags on submissions stay set; the next lock re-marks the
  latest filing per store, so stale flags are harmless.
- While the period is open, managers can file again.

### Re-send a corrected standings email

Only for a genuine correction, and only for the affected recipients — this
defeats the double-send guard:

```sql
delete from email_log
where template like 'standings:%' and period_id = <id> and to_email = '<email>';
```

Then **Admin → send standings now** (or `POST /api/periods/:id/mail-standings`).

## Backups

- **Cadence:** daily, 06:00 UTC, from cron on the VPS. Moved from weekly on
  2026-08-30, so the worst-case loss window is about 24 hours.
- **What:** a `pg_dump -Fc` of the database (plus every other stateful app
  on the host), snapshotted to the R2 bucket `ethandbard-vps-backups` with
  restic. Retention: 7 daily, 4 weekly, 6 monthly.
- **Verify a run:** `ssh hetzner 'tail -3 /var/log/restic-backup.log'` — a
  healthy run ends `OK <timestamp>`.
- **Restore:** see the `deploy-to-hetzner` skill's `references/restore.md`.
  A full restore drill was verified 2026-08-25 (all 22 tables matched the
  live database).

Backups are a property of the VPS, not the app. Moving hosts means
re-establishing them.

## Known gaps

Corrections that currently require SQL, kept here so they can become routes:

- No unlock route for a period.
- No credit entries in the penalty ledger, and no in-app edit for
  non-manual penalties.
- `audit_log` has no UI or API read path.
- No submission delete or edit route; the grid supersedes, nothing removes.
- Late-penalty deduplication keys on the reason string, which makes zeroing
  (not deleting) the only safe waiver.
