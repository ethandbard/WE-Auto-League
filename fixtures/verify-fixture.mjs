// Runnable proof of the Victory Lane scoring model against the June 2026 sheet.
//
// This is deliberately standalone - no app, no database, no dependencies - so the
// fixture can be checked before any of the system exists. The real golden-master
// test lands in Phase 2 and asserts the actual engine; this file exists so that
// test has something known-good to be written against.
//
//   node fixtures/verify-fixture.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const fx = JSON.parse(readFileSync(join(here, "june-2026.json"), "utf8"));

const round2 = (n) => Math.round(n * 100) / 100;
const { points: PT, score: ST } = fx.tolerance;

let failures = 0;
const check = (label, got, want, tol) => {
  const ok = Math.abs(got - want) <= tol;
  if (!ok) failures++;
  console.log(`  ${ok ? "pass" : "FAIL"}  ${label.padEnd(34)} got ${got.toFixed(2)}  want ${want.toFixed(2)}`);
};

// advisor: points = (actual / store goal) * weight, score = sum of points
console.log("\nAdvisor scoring");
for (const row of fx.advisors.rows) {
  console.log(` ${row.alias} (${row.brand})`);
  const goals = fx.goals[row.brand];
  let total = 0;
  for (const [cat, weight] of Object.entries(fx.weights.advisor)) {
    const pts = round2((row.actual[cat] / goals[cat]) * weight);
    check(cat, pts, row.expectedPoints[cat], PT);
    total += pts;
  }
  check("SCORE", round2(total), row.printedScore, ST);
}

// team score = arithmetic mean of that store's advisor scores
console.log("\nTeam score");
for (const c of fx.teamScores.cases) {
  const mean = c.advisorScores.reduce((a, b) => a + b, 0) / c.advisorScores.length;
  check(`${c.brand} (n=${c.advisorScores.length})`, round2(mean), c.expected, ST);
}

// manager: points = attainment% * weight / 100, score = sum of points - penalty
console.log("\nManager scoring");
for (const row of fx.managers.rows) {
  console.log(` ${row.alias} (${row.brand})${row.penalty ? `  penalty -${row.penalty}` : ""}`);
  let total = 0;
  for (const [cat, weight] of Object.entries(fx.weights.manager)) {
    const pts = round2((row.actual[cat] * weight) / 100);
    check(cat, pts, row.expectedPoints[cat], PT);
    total += pts;
  }
  check("SCORE", round2(total - row.penalty), row.printedScore, ST);
}

// weights must total 100 per scope - the same invariant the admin UI enforces
console.log("\nInvariants");
for (const [scope, weights] of Object.entries(fx.weights)) {
  check(`${scope} weights total`, Object.values(weights).reduce((a, b) => a + b, 0), 100, 0);
}

console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
