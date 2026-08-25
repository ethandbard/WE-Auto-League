# Decisions of record

Nine questions the client's brief left open. Each is **decided** so the build can
proceed; none is load-bearing enough that reversing it is expensive. Every one is
implemented as a league setting or a toggle rather than a hardcoded rule, so
changing a decision is a configuration change.

Raise these with the client when convenient. Do not wait on them.

| # | Question | Decision | Where it lives |
|---|---|---|---|
| 1 | Do twice-weekly submissions carry MTD totals or increments? | **MTD running totals** | `submissions.basis` |
| 2 | Which days, which timezone? | **Mon + Thu, 12:00, America/Los_Angeles** | `leagues.submission_days`, `leagues.timezone` |
| 3 | Does the late penalty stack? | **Yes, per missed window** | `leagues.late_penalty_stacks` |
| 4 | Do the handwritten categories add or replace? | **Add; admin rebalances weights on activation** | `category_weights` |
| 5 | Hidden advisor mid-month — store impact? | **Excluded from the team-score mean** | `participation.status` |
| 6 | Do the incumbent's eligibility rules carry over? | **Yes, all three, defaulted on** | `leagues.eligibility_rules` |
| 7 | Who may enter data for a store? | **Manager + named delegates, own store only** | `employees.role`, `delegates` |
| 8 | Sending domain and winner verification? | **`mail.auto.ethandbard.com`; verification stays manual** | `CF_EMAIL_FROM` |
| 9 | Standings email: own row or full ranking? | **Full ranking table, plus the recipient's row when they have one** | `email/templates.ts` |

---

## 1 — Submissions carry MTD running totals

Managers pull these figures from a DMS report that is already month-to-date.
Asking for per-period increments would make them do subtraction by hand twice a
week, which is where errors enter.

Each submission is stored as a full snapshot. The last submission of the month
*is* the final; earlier ones drive the provisional leaderboard and the on-time
check but never score. This also means a corrected resubmission simply supersedes
its predecessor rather than needing a delta applied.

## 2 — Monday and Thursday, noon, America/Los_Angeles

The brief says "twice per week" and "by noon" without naming either. The
incumbent's notices are timestamped PST, so the client's people already work to a
Pacific clock. Mon/Thu splits the week about evenly and puts a deadline on either
side of the weekend.

Store the timezone as an IANA name, not an offset — the deadline must hold across
a DST boundary. Compute cutoffs in the league's zone, store instants in UTC.

## 3 — The late penalty stacks per missed window

Two misses in a month costs 4 points, not 2. A non-stacking penalty makes every
miss after the first one free, which inverts the incentive the rule exists to
create.

This does not reconstruct BHoosiers' −5 on the June sheet, which is not a multiple
of 2. That figure is most likely a discretionary adjustment by a commissioner —
which is why penalties are a ledger with a reason string rather than a counter.
Worth asking the client about, since it is direct evidence about how they actually
run the rule.

## 4 — New categories add, and force a rebalance

The margin notes add `C/P RO's YOY` and `Video MPI eSurveys` to the manager board
and `Video Sent %` and `Video Viewed %` to the advisor board. Whether these
replace existing categories is genuinely unclear — the note reading "4th category"
sits beside a board that already has four.

Rather than guess: categories are data, weights are versioned per period, and the
admin UI enforces that each scope totals 100. Activating a new category therefore
*forces* whoever activates it to restate the weights. The system defers the
decision to the person who owns it instead of encoding a guess.

## 5 — A hidden advisor is excluded from the team-score mean

Because team score is a mean, this is not a display decision — it moves the
store's manager score and its rank.

Full exclusion for any period in which the advisor is hidden. Including their
partial numbers would drag the store's mean down, which is the exact harm the
hide feature exists to prevent. This matches the incumbent's rule that an advisor
off the drive for two or more weeks is removed from the month.

The exclusion is recorded in `participation` with a reason and an author, not as a
boolean on the employee row, so a disputed standing can be reconstructed.

## 6 — The incumbent's eligibility rules carry over

Three rules from their published rulebook, none mentioned in the brief, all
sensible, all implemented as league toggles defaulted on:

- New advisors are not scored for their first **60 days**.
- A floater advisor writing service for two consecutive months must be entered by
  their third.
- A manager needs at least **two** scored advisors to be eligible to win.

The third one interacts with decision 5: hiding advisors can drop a store below
the minimum, which must be surfaced to the manager before the month closes rather
than discovered at publication.

## 7 — Managers plus named delegates, scoped to their own store

Anything narrower breaks the first time a manager takes leave. Anything wider
makes the audit trail meaningless.

Commissioners may enter for any store; every write is attributed regardless of
who made it. Advisors have read access to their own card and the published
standings, and no write access at all.

## 8 — Prototype mails from a sending subdomain; verification stays human

Sends from `mail.auto.ethandbard.com`. The app hostname is already a CNAME to
the Cloudflare tunnel, and a hostname cannot hold both a CNAME and the SPF TXT
record Email Sending needs. Production would move to the client's domain, which
is their DNS to change, not ours.

Their rules require the monthly winner to submit DMS reports as proof of figures.
That stays a human process — the platform stores the attachments against the
period and flags whether they arrived. Automating verification would mean parsing
DMS exports we have never seen.

## 9 — Standings emails carry the full ranking

The brief says to email the full ranking, not only the recipient's own row. Each
standings send includes the complete board as a table under the personal line.
A copy sent to someone with no row on that board (a manager's copy of the
advisor board, or an extra recipient) omits the personal line and still includes
the table.

---

## Also settled, for the avoidance of re-litigation

- **Scoring model** is weighted goal attainment, per the client's own Victory Lane
  sheet — *not* the rank-sum method visible in the incumbent's screenshots. See
  the build plan for the evidence.
- **Attainment is uncapped.** The June sheet has advisors at 183% of a category
  goal. A cap is available as a league setting, defaulted off.
- **Raw values store at full precision**, rounded only at render. See
  `fixtures/june-2026.json` — `wcConv` is printed at 2dp but scored at 3, and a
  2dp column silently produces wrong scores.
- **Published standings are immutable.** Corrections issue as a new labelled
  revision; they never rewrite a board that has already been mailed.
