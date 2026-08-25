// Loads the client's real June 2026 Victory Lane sheet (fixtures/june-2026-full.json,
// transcribed and cross-validated against fixtures/june-2026.json — see
// server/test/scoring.test.ts) into the database as a published historical
// period, then opens a fresh current period carrying the same weights and
// goals forward. Safe to re-run: exits early if the league already exists.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { eq } from 'drizzle-orm';
import { db, pool } from '../db/client.js';
import { organizations, leagues, periods, dealerships, employees, categories, categoryWeights, goals, submissions, metricValues, penalties } from '../db/schema.js';
import { computePeriodScores, publishPeriodScores } from '../scoring/compute.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, '../../../fixtures/june-2026-full.json'), 'utf8'));

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
const emailFor = (alias: string) => `${slugify(alias)}@weauto.local`;

const ADVISOR_LABELS: Record<string, string> = {
  csi100s: "CSI 100's",
  elr: 'ELR',
  cpDollars: 'CP $',
  hpro: 'HPRO',
  totalDollars: 'Total $',
  wc: 'WC',
  wcConv: 'WC Conv',
};
const ADVISOR_UNITS: Record<string, 'count' | 'currency' | 'ratio' | 'percent'> = {
  csi100s: 'count',
  elr: 'currency',
  cpDollars: 'currency',
  hpro: 'ratio',
  totalDollars: 'currency',
  wc: 'count',
  wcConv: 'percent',
};
const MANAGER_LABELS: Record<string, string> = {
  csiGoalPct: '% CSI Goal',
  cpGoalPct: '% CP Goal',
  grossGoalPct: '% Gross Goal',
  teamScore: 'Team Score',
};

async function main() {
  const [existing] = await db.select().from(leagues).where(eq(leagues.slug, 'we-auto-league')).limit(1);
  if (existing) {
    console.log('[seed] league "we-auto-league" already exists — skipping. Nothing to do.');
    return;
  }

  const [org] = await db.insert(organizations).values({ name: 'WE Auto Group', slug: 'we-auto-group' }).returning();
  const [league] = await db
    .insert(leagues)
    .values({ organizationId: org!.id, name: 'WE Auto League', slug: 'we-auto-league' })
    .returning();
  console.log(`[seed] league #${league!.id}`);

  // Commissioner account — the operator running the league.
  const [commissioner] = await db
    .insert(employees)
    .values({ leagueId: league!.id, name: 'Ethan Bard', alias: 'Commissioner', email: 'ethan@thebardfamily.com', role: 'commissioner' })
    .returning();
  console.log(`[seed] commissioner ${commissioner!.email}`);

  // ---- categories + June weights ----
  const categoryByKey = new Map<string, typeof categories.$inferSelect>();
  for (const [key, label] of Object.entries(ADVISOR_LABELS)) {
    const [row] = await db.insert(categories).values({ leagueId: league!.id, key, label, scope: 'advisor', unit: ADVISOR_UNITS[key]! }).returning();
    categoryByKey.set(key, row!);
  }
  for (const [key, label] of Object.entries(MANAGER_LABELS)) {
    const [row] = await db
      .insert(categories)
      .values({ leagueId: league!.id, key, label, scope: 'manager', unit: key === 'teamScore' ? 'percent' : 'percent', isDerived: key === 'teamScore' })
      .returning();
    categoryByKey.set(key, row!);
  }

  // ---- June 2026: published historical period ----
  const [junePeriod] = await db
    .insert(periods)
    .values({ leagueId: league!.id, label: fixture.period, startsOn: '2026-06-01', endsOn: '2026-06-30', status: 'open' })
    .returning();

  for (const [key, weight] of Object.entries(fixture.weights.advisor as Record<string, number>)) {
    await db.insert(categoryWeights).values({ categoryId: categoryByKey.get(key)!.id, periodId: junePeriod!.id, weight: String(weight) });
  }
  for (const [key, weight] of Object.entries(fixture.weights.manager as Record<string, number>)) {
    await db.insert(categoryWeights).values({ categoryId: categoryByKey.get(key)!.id, periodId: junePeriod!.id, weight: String(weight) });
  }

  // ---- dealerships ----
  const brandNames = Object.keys(fixture.goals).filter((k) => k !== '_comment');
  const dealershipByName = new Map<string, typeof dealerships.$inferSelect>();
  for (const name of brandNames) {
    const [row] = await db.insert(dealerships).values({ leagueId: league!.id, name }).returning();
    dealershipByName.set(name, row!);
  }

  // ---- goals (advisor-scope only; manager categories arrive as % already) ----
  for (const brand of brandNames) {
    const goalSet = fixture.goals[brand] as Record<string, number>;
    const dealership = dealershipByName.get(brand)!;
    for (const [key, value] of Object.entries(goalSet)) {
      await db.insert(goals).values({ dealershipId: dealership.id, categoryId: categoryByKey.get(key)!.id, periodId: junePeriod!.id, value: String(value), source: 'league_default' });
    }
  }

  // ---- managers (one per store) ----
  const managerByBrand = new Map<string, typeof employees.$inferSelect>();
  for (const m of fixture.managers as Array<{ alias: string; brand: string }>) {
    const dealership = dealershipByName.get(m.brand)!;
    const [row] = await db
      .insert(employees)
      .values({ leagueId: league!.id, dealershipId: dealership.id, name: m.alias, alias: m.alias, email: emailFor(m.alias), role: 'manager' })
      .returning();
    managerByBrand.set(m.brand, row!);
  }

  // ---- advisors ----
  const advisorByAlias = new Map<string, typeof employees.$inferSelect>();
  for (const a of fixture.advisors as Array<{ alias: string; brand: string }>) {
    const dealership = dealershipByName.get(a.brand)!;
    const [row] = await db
      .insert(employees)
      .values({ leagueId: league!.id, dealershipId: dealership.id, name: a.alias, alias: a.alias, email: emailFor(`${a.brand}-${a.alias}`), role: 'advisor' })
      .returning();
    advisorByAlias.set(`${a.brand}:${a.alias}`, row!);
  }
  console.log(`[seed] ${dealershipByName.size} dealerships, ${managerByBrand.size} managers, ${advisorByAlias.size} advisors`);

  // ---- June's final submission, per store, from the real transcribed sheet ----
  const advisorsByBrand = new Map<string, Array<{ alias: string; actual: Record<string, number> }>>();
  for (const a of fixture.advisors as Array<{ alias: string; brand: string; actual: Record<string, number> }>) {
    if (!advisorsByBrand.has(a.brand)) advisorsByBrand.set(a.brand, []);
    advisorsByBrand.get(a.brand)!.push(a);
  }
  const managersByBrand = new Map((fixture.managers as Array<{ brand: string; actual: Record<string, number> }>).map((m) => [m.brand, m]));

  for (const [brand, dealership] of dealershipByName) {
    const manager = managerByBrand.get(brand)!;
    const [submission] = await db
      .insert(submissions)
      .values({
        dealershipId: dealership.id,
        periodId: junePeriod!.id,
        windowDate: '2026-06-30',
        submittedBy: manager.id,
        basis: 'mtd',
        isFinal: true,
        onTime: true,
        provenance: 'web',
        submittedAt: new Date('2026-06-30T20:00:00Z'),
      })
      .returning();

    const rows: (typeof metricValues.$inferInsert)[] = [];
    for (const a of advisorsByBrand.get(brand) ?? []) {
      const advisor = advisorByAlias.get(`${brand}:${a.alias}`)!;
      for (const [key, value] of Object.entries(a.actual)) {
        rows.push({ submissionId: submission!.id, employeeId: advisor.id, categoryId: categoryByKey.get(key)!.id, value: String(value) });
      }
    }
    const managerActual = managersByBrand.get(brand)!.actual;
    for (const key of ['csiGoalPct', 'cpGoalPct', 'grossGoalPct']) {
      rows.push({ submissionId: submission!.id, employeeId: null, categoryId: categoryByKey.get(key)!.id, value: String(managerActual[key]) });
    }
    await db.insert(metricValues).values(rows);
  }
  console.log('[seed] June submissions loaded');

  // Manual penalty: BHoosiers (Nissan SP) carries -5, of unclear origin per the sheet — see decisions.md #3.
  const nissanSp = dealershipByName.get('Nissan SP')!;
  await db.insert(penalties).values({
    periodId: junePeriod!.id,
    dealershipId: nissanSp.id,
    kind: 'manual',
    value: '5',
    reason: 'Commissioner adjustment, per the printed June sheet — origin not on record. See decisions.md #3.',
    issuedBy: commissioner!.id,
  });

  const computeResult = await computePeriodScores(junePeriod!.id);
  await publishPeriodScores(junePeriod!.id);
  await db.update(periods).set({ status: 'published', publishedAt: new Date() }).where(eq(periods.id, junePeriod!.id));
  console.log(`[seed] June 2026 scored and published: ${computeResult.advisorsScored} advisors across ${computeResult.dealershipsScored} stores`);

  // ---- August 2026 (the app's "today"): an open period, weights and goals carried forward ----
  const [augustPeriod] = await db
    .insert(periods)
    .values({ leagueId: league!.id, label: '2026-08', startsOn: '2026-08-01', endsOn: '2026-08-31', status: 'open' })
    .returning();
  const juneWeights = await db.select().from(categoryWeights).where(eq(categoryWeights.periodId, junePeriod!.id));
  await db.insert(categoryWeights).values(juneWeights.map((w) => ({ categoryId: w.categoryId, periodId: augustPeriod!.id, weight: w.weight })));
  const juneGoals = await db.select().from(goals).where(eq(goals.periodId, junePeriod!.id));
  await db.insert(goals).values(juneGoals.map((g) => ({ dealershipId: g.dealershipId, categoryId: g.categoryId, periodId: augustPeriod!.id, value: g.value, source: g.source })));
  console.log(`[seed] opened ${augustPeriod!.label} with June's weights and goals carried forward`);

  console.log('[seed] done');
}

main()
  .catch((err) => {
    console.error('[seed] failed', err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
