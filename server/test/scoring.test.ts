// Golden-master test: proves the scoring engine reproduces the client's real
// June 2026 Victory Lane sheet to the cent. This is the highest-risk part of
// the system — see CLAUDE.md and docs/build-plan.html §Scoring model. A
// change that breaks this test would break a published, paid-against standing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { scoreAdvisor, scoreManager, scoreTeam, applyPenalties, weightsTotalTo100 } from '../src/scoring/engine.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, '../../fixtures');

const strict = JSON.parse(readFileSync(join(fixturesDir, 'june-2026.json'), 'utf8'));
const full = JSON.parse(readFileSync(join(fixturesDir, 'june-2026-full.json'), 'utf8'));

const { points: PT, score: ST } = strict.tolerance;
const closeTo = (got: number, want: number, tol: number) => Math.abs(got - want) <= tol;

test('advisor scoring matches the printed sheet, per category (strict 6-row fixture)', () => {
  for (const row of strict.advisors.rows) {
    const goals = strict.goals[row.brand];
    const { breakdown, total } = scoreAdvisor(row.actual, goals, strict.weights.advisor);
    for (const [cat, expected] of Object.entries(row.expectedPoints)) {
      assert.ok(
        closeTo(breakdown[cat], expected as number, PT),
        `${row.alias} ${cat}: got ${breakdown[cat]} want ${expected}`,
      );
    }
    assert.ok(closeTo(total, row.printedScore, ST), `${row.alias} total: got ${total} want ${row.printedScore}`);
  }
});

test('team score is the mean of eligible advisor scores (strict fixture cases)', () => {
  for (const c of strict.teamScores.cases) {
    const got = scoreTeam(c.advisorScores);
    assert.ok(closeTo(got, c.expected, ST), `${c.brand}: got ${got} want ${c.expected}`);
  }
});

test('manager scoring matches the printed sheet, including the one penalised store', () => {
  for (const row of strict.managers.rows) {
    const { breakdown, total: preP } = scoreManager(row.actual, strict.weights.manager);
    for (const [cat, expected] of Object.entries(row.expectedPoints)) {
      assert.ok(
        closeTo(breakdown[cat], expected as number, PT),
        `${row.alias} ${cat}: got ${breakdown[cat]} want ${expected}`,
      );
    }
    const { total } = applyPenalties(preP, row.penalty ? [row.penalty] : []);
    assert.ok(closeTo(total, row.printedScore, ST), `${row.alias} total: got ${total} want ${row.printedScore}`);
  }
});

test('category weights total 100 per scope', () => {
  assert.ok(weightsTotalTo100(strict.weights.advisor));
  assert.ok(weightsTotalTo100(strict.weights.manager));
});

test('full 45-advisor transcription: every store team score matches the golden sheet', () => {
  const byBrand = new Map<string, number[]>();
  for (const a of full.advisors) {
    const scored = scoreAdvisor(a.actual, full.goals[a.brand], full.weights.advisor).total;
    assert.ok(
      closeTo(scored, a.printedScore, ST),
      `${a.alias} (${a.brand}): engine got ${scored}, sheet printed ${a.printedScore}`,
    );
    if (!byBrand.has(a.brand)) byBrand.set(a.brand, []);
    byBrand.get(a.brand)!.push(scored);
  }
  assert.equal(
    [...byBrand.values()].reduce((n, arr) => n + arr.length, 0),
    45,
    'all 45 advisors accounted for',
  );
  for (const [brand, expected] of Object.entries(full.verification)) {
    if (brand === '_comment') continue;
    const got = scoreTeam(byBrand.get(brand)!);
    assert.ok(closeTo(got, expected as number, ST), `${brand} team score: got ${got} want ${expected}`);
  }
});

test('full transcription: all 8 manager rows match, teamScore correctly coupled from the advisor pass', () => {
  const byBrand = new Map<string, number[]>();
  for (const a of full.advisors) {
    const scored = scoreAdvisor(a.actual, full.goals[a.brand], full.weights.advisor).total;
    if (!byBrand.has(a.brand)) byBrand.set(a.brand, []);
    byBrand.get(a.brand)!.push(scored);
  }
  for (const m of full.managers) {
    const teamScore = scoreTeam(byBrand.get(m.brand)!);
    const actual = { ...m.actual, teamScore };
    const { total: preP } = scoreManager(actual, full.weights.manager);
    const { total } = applyPenalties(preP, m.penalty ? [m.penalty] : []);
    assert.ok(closeTo(total, m.printedScore, ST), `${m.alias} (${m.brand}): got ${total} want ${m.printedScore}`);
  }
});

test('the WC Conv precision trap: rounding the input to its displayed 2dp produces a wrong score', () => {
  // Quiet Storm's wcConv prints as 0.67 but the true input is 0.665.
  const goal = strict.goals['Nissan SP'];
  const trueInput = scoreAdvisor({ wcConv: 0.665 }, goal, { wcConv: 10 }).breakdown.wcConv;
  const roundedInput = scoreAdvisor({ wcConv: 0.67 }, goal, { wcConv: 10 }).breakdown.wcConv;
  assert.equal(trueInput, 6.65, 'full-precision input scores correctly');
  assert.notEqual(roundedInput, trueInput, 'a 2dp-rounded input silently scores wrong — this is why numeric(12,4) exists');
});

test('a hidden advisor is excluded from the team-score mean, not averaged in at a partial value', () => {
  const withThreeEligible = scoreTeam([100, 90, 80]);
  const sameThreeMinusOneHidden = scoreTeam([100, 90]);
  assert.notEqual(withThreeEligible, sameThreeMinusOneHidden);
  assert.equal(sameThreeMinusOneHidden, 95);
});
