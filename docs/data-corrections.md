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
| The audit trail | **Admin → Audit log**, or `GET /api/admin/audit-log` (newest first, paginated, optional `entityType` / `action` filters). The full `before`/`after` payloads are SQL-only |
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
| Manual penalty entered in error | **Manage → Penalties → delete**. Only `manual` penalties can be deleted here; waive the other kinds instead (next row). |
| A penalty of any kind should not stand | `POST /api/penalties/:id/waive` with a `reason`. It zeroes the value and records the why in `audit_log`; the row's own `reason` column, which says why it was *issued*, is left alone. A waived late penalty is not re-issued — the scheduler dedupes on the window date. |
| A score needs a discretionary deduction | Add a manual penalty with a reason. Values are positive-only; the ledger has no credits. To *restore* points, waive an existing penalty. |
| Wrong store or period on a filing | `DELETE /api/submissions/:id` (commissioner-only) removes the filing and its metric values together, then re-file on **Enter**. Deleting a store's only filing before a past cutoff lets the scheduler charge that window; waive it if that is wrong. |
| A period was locked or published too early | `POST /api/periods/:id/unlock` returns it to open. Published `scores` rows stay published; after the correction, lock and publish again and the recompute writes the next revision. |
| Automated mail is going out when it should not | **Admin → Email → Pause all sending**, or turn off the one template. Suppressed sends are logged, not dropped, and the same recipient still gets a real copy once mail resumes. |
| Automated mail says the wrong thing | **Admin → Email → Edit draft** on that template. Preview and send-test-to-me before saving; **Revert to default** puts the built-in text back. |
| Published board is wrong | Fix the underlying input (rows in this table, or SQL if the period is no longer open), then `POST /api/periods/:id/recompute` and `POST /api/periods/:id/publish`. This creates revision N+1 and links each old row to its replacement. |

One thing the app cannot do today:

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

### Waive a penalty

Use `POST /api/penalties/:id/waive` — it zeroes the value, writes the audit
row, and works on any kind. Only reach for SQL if the API is unreachable:

```sql
update penalties set value = 0 where id = <id>;
```

Zero the value; do **not** delete a `late_submission` row. The scheduler
dedupes on `penalties.window_date`, so a zeroed row still marks the window as
charged and the penalty does not come back on the next 15-minute tick.
Deleting it does bring it back at full value, which is occasionally what you
want.

Leave the `reason` column alone. It records why the penalty was *issued*;
rewording it no longer affects deduplication, but the row is the ledger entry
and rewriting history in place is not a correction. Put the why of the waiver
in the audit row from rule 3.

A `late_submission` row with a null `window_date` predates migration `0003`
and is a duplicate the backfill could not claim — the sibling row carrying
the date is the one the scheduler dedupes on.

### Delete a bad submission

Use `DELETE /api/submissions/:id` for a filing made against the wrong store
or period. It removes the metric values with it, in one transaction, and
audits the full before payload. The SQL equivalent, if the API is
unreachable:

```sql
delete from metric_values where submission_id = <id>;
delete from submissions where id = <id>;
```

If this removes a store's only filing before a past cutoff, the scheduler
will issue a late penalty for that window on its next tick. That is usually
correct; waive it (as earlier in this section) if it is not.

### Reopen a locked or published period

Use `POST /api/periods/:id/unlock`. The SQL equivalent, if the API is
unreachable:

```sql
update periods set status = 'open', locked_at = null where id = <id>;
```

Consequences either way:

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

- No credit entries in the penalty ledger. A penalty can be waived to zero
  but never taken below it, so points cannot be granted, only withheld.
- No submission *edit* route — the grid supersedes and `DELETE
  /api/submissions/:id` removes, but nothing amends one filing in place.
- No route re-mails a corrected board: the email idempotency key ignores
  revisions, so re-sending still means clearing `email_log` rows by hand.
- Unlock, waive, submission delete, and the audit-log read have no buttons of
  their own yet — they are API calls, and only the audit log has a UI.
