ALTER TABLE "penalties" ADD COLUMN "window_date" date;--> statement-breakpoint
-- Data migration: recover the structured window date from the prose the
-- scheduler used to dedupe on ('Missed the noon cutoff for YYYY-MM-DD'), so
-- existing late penalties are not re-issued on the first tick after deploy.
--
-- `rn = 1` keeps the earliest row of any duplicate set and leaves the rest
-- null, because a duplicate would fail the unique index below. Nulls are
-- distinct in Postgres, so those legacy rows stand outside the constraint;
-- the kept row is what dedupes future runs.
WITH parsed AS (
  SELECT
    id,
    (substring("reason" from '\d{4}-\d{2}-\d{2}'))::date AS window_date,
    row_number() OVER (
      PARTITION BY "period_id", "dealership_id", substring("reason" from '\d{4}-\d{2}-\d{2}')
      ORDER BY id
    ) AS rn
  FROM "penalties"
  WHERE "kind" = 'late_submission' AND "reason" ~ '\d{4}-\d{2}-\d{2}'
)
UPDATE "penalties" SET "window_date" = parsed.window_date
FROM parsed
WHERE "penalties".id = parsed.id AND parsed.rn = 1;--> statement-breakpoint
CREATE UNIQUE INDEX "penalties_late_window_uq" ON "penalties" USING btree ("period_id","dealership_id","kind","window_date") WHERE "penalties"."kind" = 'late_submission';
