// Drizzle schema — source of truth for the database. drizzle-kit loads this
// file as CJS, so it must import nothing but drizzle itself (see CLAUDE.md
// Gotchas): no shared constants, no env.ts.
import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  numeric,
  boolean,
  jsonb,
  pgEnum,
  uniqueIndex,
  index,
  date,
  time,
  check,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const periodStatusEnum = pgEnum('period_status', ['open', 'locked', 'published']);
export const employeeRoleEnum = pgEnum('employee_role', ['advisor', 'manager', 'commissioner']);
export const participationStatusEnum = pgEnum('participation_status', ['eligible', 'hidden', 'terminated']);
export const categoryScopeEnum = pgEnum('category_scope', ['advisor', 'manager']);
export const categoryUnitEnum = pgEnum('category_unit', ['count', 'currency', 'ratio', 'percent']);
export const categoryDirectionEnum = pgEnum('category_direction', ['higher_better', 'lower_better']);
export const goalSourceEnum = pgEnum('goal_source', ['league_default', 'store_override']);
export const provenanceEnum = pgEnum('provenance', ['web', 'csv', 'api', 'mcp', 'system']);
export const penaltyKindEnum = pgEnum('penalty_kind', ['late_submission', 'training_incomplete', 'manual']);
export const scoreScopeEnum = pgEnum('score_scope', ['advisor', 'manager', 'team']);
export const announcementAudienceEnum = pgEnum('announcement_audience', ['all', 'managers', 'advisors', 'store']);
export const emailStatusEnum = pgEnum('email_status', ['queued', 'sent', 'failed']);

// ---------------------------------------------------------------- tenancy --

export const organizations = pgTable('organizations', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const leagues = pgTable('leagues', {
  id: serial('id').primaryKey(),
  organizationId: integer('organization_id').notNull().references(() => organizations.id),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  timezone: text('timezone').notNull().default('America/Los_Angeles'),
  /** ISO weekday ints, Mon=1..Sun=7. Decision #2: default Mon+Thu. */
  submissionDays: jsonb('submission_days').notNull().default(sql`'[1,4]'::jsonb`).$type<number[]>(),
  submissionCutoffTime: time('submission_cutoff_time').notNull().default('12:00:00'),
  latePenaltyValue: numeric('late_penalty_value', { precision: 12, scale: 4 }).notNull().default('2'),
  latePenaltyStacks: boolean('late_penalty_stacks').notNull().default(true),
  trainingPenaltyValue: numeric('training_penalty_value', { precision: 12, scale: 4 }).notNull().default('25'),
  eligibilityNewHireGraceDays: integer('eligibility_new_hire_grace_days').notNull().default(60),
  eligibilityMinAdvisorsForManager: integer('eligibility_min_advisors_for_manager').notNull().default(2),
  eligibilityFloaterRuleEnabled: boolean('eligibility_floater_rule_enabled').notNull().default(true),
  /** Null = uncapped, the June sheet's behaviour and the default. */
  attainmentCap: numeric('attainment_cap', { precision: 12, scale: 4 }),
  sendingDomain: text('sending_domain'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const periods = pgTable(
  'periods',
  {
    id: serial('id').primaryKey(),
    leagueId: integer('league_id').notNull().references(() => leagues.id),
    /** e.g. "2026-06" */
    label: text('label').notNull(),
    startsOn: date('starts_on').notNull(),
    endsOn: date('ends_on').notNull(),
    status: periodStatusEnum('status').notNull().default('open'),
    lockedAt: timestamp('locked_at'),
    publishedAt: timestamp('published_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('periods_league_label_uq').on(t.leagueId, t.label)],
);

export const dealerships = pgTable(
  'dealerships',
  {
    id: serial('id').primaryKey(),
    leagueId: integer('league_id').notNull().references(() => leagues.id),
    /** The brand/store name as printed on the sheet, e.g. "Toyota PA". */
    name: text('name').notNull(),
    alias: text('alias'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    archivedAt: timestamp('archived_at'),
  },
  (t) => [uniqueIndex('dealerships_league_name_uq').on(t.leagueId, t.name)],
);

export const employees = pgTable(
  'employees',
  {
    id: serial('id').primaryKey(),
    leagueId: integer('league_id').notNull().references(() => leagues.id),
    dealershipId: integer('dealership_id').references(() => dealerships.id),
    name: text('name').notNull(),
    alias: text('alias'),
    email: text('email').notNull(),
    role: employeeRoleEnum('role').notNull().default('advisor'),
    hireDate: date('hire_date'),
    /** Months this unassigned advisor has written service in a row. Reset when rostered. */
    consecutiveFloaterMonths: integer('consecutive_floater_months').notNull().default(0),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    archivedAt: timestamp('archived_at'),
  },
  (t) => [uniqueIndex('employees_league_email_uq').on(t.leagueId, t.email)],
);

/** Decision #7: manager + named delegates, scoped to their own store. */
export const delegates = pgTable(
  'delegates',
  {
    id: serial('id').primaryKey(),
    dealershipId: integer('dealership_id').notNull().references(() => dealerships.id),
    employeeId: integer('employee_id').notNull().references(() => employees.id),
    grantedBy: integer('granted_by').references(() => employees.id),
    grantedAt: timestamp('granted_at').notNull().defaultNow(),
    revokedAt: timestamp('revoked_at'),
  },
  (t) => [index('delegates_dealership_idx').on(t.dealershipId)],
);

/**
 * Who counts, per period. Decision #5: a hidden advisor is excluded from the
 * team-score mean entirely — this is a scoring input, not a UI filter.
 */
export const participation = pgTable(
  'participation',
  {
    id: serial('id').primaryKey(),
    employeeId: integer('employee_id').notNull().references(() => employees.id),
    periodId: integer('period_id').notNull().references(() => periods.id),
    status: participationStatusEnum('status').notNull().default('eligible'),
    reason: text('reason'),
    decidedBy: integer('decided_by').references(() => employees.id),
    decidedAt: timestamp('decided_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('participation_employee_period_uq').on(t.employeeId, t.periodId)],
);

// ------------------------------------------------------------- scoring config --

export const categories = pgTable(
  'categories',
  {
    id: serial('id').primaryKey(),
    leagueId: integer('league_id').notNull().references(() => leagues.id),
    /** Stable machine key, e.g. "csi100s". Never renamed once scored periods reference it. */
    key: text('key').notNull(),
    label: text('label').notNull(),
    scope: categoryScopeEnum('scope').notNull(),
    unit: categoryUnitEnum('unit').notNull(),
    direction: categoryDirectionEnum('direction').notNull().default('higher_better'),
    /** Derived category (e.g. manager's Team Score) needs no goal or manual entry. */
    isDerived: boolean('is_derived').notNull().default(false),
    activeFromPeriodId: integer('active_from_period_id').references((): AnyPgColumn => periods.id),
    activeToPeriodId: integer('active_to_period_id').references((): AnyPgColumn => periods.id),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('categories_league_key_uq').on(t.leagueId, t.key)],
);

/** Versioned per period. Constraint that weights must total 100 per scope is app-enforced. */
export const categoryWeights = pgTable(
  'category_weights',
  {
    id: serial('id').primaryKey(),
    categoryId: integer('category_id').notNull().references(() => categories.id),
    periodId: integer('period_id').notNull().references(() => periods.id),
    weight: numeric('weight', { precision: 6, scale: 2 }).notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('category_weights_category_period_uq').on(t.categoryId, t.periodId)],
);

export const goals = pgTable(
  'goals',
  {
    id: serial('id').primaryKey(),
    dealershipId: integer('dealership_id').notNull().references(() => dealerships.id),
    categoryId: integer('category_id').notNull().references(() => categories.id),
    periodId: integer('period_id').notNull().references(() => periods.id),
    /** numeric(12,4): money and metrics are never float. See CLAUDE.md. */
    value: numeric('value', { precision: 12, scale: 4 }).notNull(),
    source: goalSourceEnum('source').notNull().default('league_default'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('goals_dealership_category_period_uq').on(t.dealershipId, t.categoryId, t.periodId)],
);

// ------------------------------------------------------------------- data entry --

/**
 * One filing for one window. Decision #1: submissions carry MTD running
 * totals, so the last submission of the month is the final; earlier ones are
 * provisional only. `isFinal` is set by the scheduler when the period locks,
 * not by the submitter.
 */
export const submissions = pgTable(
  'submissions',
  {
    id: serial('id').primaryKey(),
    dealershipId: integer('dealership_id').notNull().references(() => dealerships.id),
    periodId: integer('period_id').notNull().references(() => periods.id),
    windowDate: date('window_date').notNull(),
    submittedBy: integer('submitted_by').notNull().references(() => employees.id),
    submittedAt: timestamp('submitted_at').notNull().defaultNow(),
    basis: text('basis').notNull().default('mtd'),
    isFinal: boolean('is_final').notNull().default(false),
    onTime: boolean('on_time').notNull(),
    provenance: provenanceEnum('provenance').notNull().default('web'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [index('submissions_dealership_period_idx').on(t.dealershipId, t.periodId, t.windowDate)],
);

export const metricValues = pgTable(
  'metric_values',
  {
    id: serial('id').primaryKey(),
    submissionId: integer('submission_id').notNull().references(() => submissions.id),
    /** Null for a manager/store-level row that isn't tied to one advisor. */
    employeeId: integer('employee_id').references(() => employees.id),
    categoryId: integer('category_id').notNull().references(() => categories.id),
    /** Full precision, rounded only at render. See CLAUDE.md's WC Conv trap. */
    value: numeric('value', { precision: 12, scale: 4 }).notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('metric_values_submission_employee_category_uq').on(t.submissionId, t.employeeId, t.categoryId)],
);

// ----------------------------------------------------------------- penalties --

export const penalties = pgTable(
  'penalties',
  {
    id: serial('id').primaryKey(),
    periodId: integer('period_id').notNull().references(() => periods.id),
    dealershipId: integer('dealership_id').references(() => dealerships.id),
    employeeId: integer('employee_id').references(() => employees.id),
    kind: penaltyKindEnum('kind').notNull(),
    value: numeric('value', { precision: 12, scale: 4 }).notNull(),
    reason: text('reason').notNull(),
    submissionId: integer('submission_id').references(() => submissions.id),
    /** Null for automatic penalties (late submission, training). */
    issuedBy: integer('issued_by').references(() => employees.id),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    check(
      'penalties_exactly_one_target',
      sql`(${t.dealershipId} is not null)::int + (${t.employeeId} is not null)::int = 1`,
    ),
  ],
);

// -------------------------------------------------------------------- scores --

/**
 * Computed results, stored rather than derived on read. Published standings
 * are immutable: a correction issues as a new row with `revision` incremented
 * and the old row's `supersededById` set, never an update in place.
 */
export const scores = pgTable(
  'scores',
  {
    id: serial('id').primaryKey(),
    periodId: integer('period_id').notNull().references(() => periods.id),
    scope: scoreScopeEnum('scope').notNull(),
    employeeId: integer('employee_id').references(() => employees.id),
    dealershipId: integer('dealership_id').references(() => dealerships.id),
    /** { [categoryKey]: points }, plus derived scopes carry their own keys (e.g. teamScore). */
    categoryBreakdown: jsonb('category_breakdown').notNull().default(sql`'{}'::jsonb`).$type<Record<string, number>>(),
    total: numeric('total', { precision: 12, scale: 4 }).notNull(),
    penaltyTotal: numeric('penalty_total', { precision: 12, scale: 4 }).notNull().default('0'),
    position: integer('position'),
    engineVersion: text('engine_version').notNull(),
    computedAt: timestamp('computed_at').notNull().defaultNow(),
    isPublished: boolean('is_published').notNull().default(false),
    publishedAt: timestamp('published_at'),
    revision: integer('revision').notNull().default(1),
    supersededById: integer('superseded_by_id').references((): AnyPgColumn => scores.id),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [index('scores_period_scope_idx').on(t.periodId, t.scope)],
);

// -------------------------------------------------------------- communications --

export const announcements = pgTable('announcements', {
  id: serial('id').primaryKey(),
  leagueId: integer('league_id').notNull().references(() => leagues.id),
  authorId: integer('author_id').notNull().references(() => employees.id),
  title: text('title').notNull(),
  body: text('body').notNull(),
  audience: announcementAudienceEnum('audience').notNull().default('all'),
  dealershipId: integer('dealership_id').references(() => dealerships.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const announcementReads = pgTable(
  'announcement_reads',
  {
    id: serial('id').primaryKey(),
    announcementId: integer('announcement_id').notNull().references(() => announcements.id),
    employeeId: integer('employee_id').notNull().references(() => employees.id),
    readAt: timestamp('read_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('announcement_reads_uq').on(t.announcementId, t.employeeId)],
);

export const emailLog = pgTable('email_log', {
  id: serial('id').primaryKey(),
  leagueId: integer('league_id').notNull().references(() => leagues.id),
  template: text('template').notNull(),
  periodId: integer('period_id').references(() => periods.id),
  recipientEmail: text('recipient_email').notNull(),
  /** `(template, period, recipient)` — enforced unique so a re-fired job is a no-op. */
  idempotencyKey: text('idempotency_key').notNull().unique(),
  status: emailStatusEnum('status').notNull().default('queued'),
  providerMessageId: text('provider_message_id'),
  sentAt: timestamp('sent_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// -------------------------------------------------------------------- audit --

export const auditLog = pgTable('audit_log', {
  id: serial('id').primaryKey(),
  leagueId: integer('league_id').references(() => leagues.id),
  actorId: integer('actor_id').references(() => employees.id),
  action: text('action').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: integer('entity_id'),
  before: jsonb('before'),
  after: jsonb('after'),
  provenance: provenanceEnum('provenance').notNull().default('web'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// -------------------------------------------------------------- integration seams --

/**
 * Extra inboxes CCed on league emails (a GM, the client, an accountant).
 * Soft-delete via revokedAt, same shape as api_keys.
 */
export const emailRecipients = pgTable('email_recipients', {
  id: serial('id').primaryKey(),
  leagueId: integer('league_id').notNull().references(() => leagues.id),
  dealershipId: integer('dealership_id').references(() => dealerships.id),
  label: text('label').notNull(),
  email: text('email').notNull(),
  templates: jsonb('templates').notNull().default(sql`'[]'::jsonb`).$type<string[]>(),
  createdBy: integer('created_by').notNull().references(() => employees.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  revokedAt: timestamp('revoked_at'),
});

export const apiKeys = pgTable('api_keys', {
  id: serial('id').primaryKey(),
  leagueId: integer('league_id').notNull().references(() => leagues.id),
  /** Null = league-wide key (commissioner tooling); set = scoped to one store. */
  dealershipId: integer('dealership_id').references(() => dealerships.id),
  name: text('name').notNull(),
  keyHash: text('key_hash').notNull().unique(),
  scopes: jsonb('scopes').notNull().default(sql`'[]'::jsonb`).$type<string[]>(),
  createdBy: integer('created_by').notNull().references(() => employees.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  revokedAt: timestamp('revoked_at'),
  lastUsedAt: timestamp('last_used_at'),
});

// -------------------------------------------------------------------- auth --

export const magicLinks = pgTable('magic_links', {
  id: serial('id').primaryKey(),
  employeeId: integer('employee_id').notNull().references(() => employees.id),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at').notNull(),
  consumedAt: timestamp('consumed_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const sessions = pgTable('sessions', {
  id: serial('id').primaryKey(),
  employeeId: integer('employee_id').notNull().references(() => employees.id),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  userAgent: text('user_agent'),
  ip: text('ip'),
});
