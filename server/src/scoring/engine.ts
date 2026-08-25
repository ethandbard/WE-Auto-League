// The scoring model, as pure functions with no I/O. Verified to the cent
// against the client's June 2026 sheet — see server/test/scoring.test.ts and
// fixtures/june-2026.json. Do not reimplement from intuition; run the test.
//
// Versioned because `scores.engineVersion` is stored on every computed row:
// a formula change must not silently reinterpret an already-published board.
export const ENGINE_VERSION = '2026.1';

const round2 = (n: number): number => Math.round(n * 100) / 100;

export interface ScoreBreakdown {
  breakdown: Record<string, number>;
  /** Sum of the rounded per-category points, matching how the printed sheet totals. */
  total: number;
}

export interface ScoringOptions {
  /** Attainment cap as a percent (e.g. 150 = 150%). Null/undefined = uncapped, the June sheet's behaviour. */
  attainmentCap?: number | null;
}

/**
 * points_c = (actual_c / goal_store,c) * weight_c; score = sum(points_c).
 * A category with no goal or no actual value contributes 0 rather than NaN —
 * callers that need to distinguish "not entered" from "on a 0 goal" should
 * check upstream; the engine only turns complete inputs into points.
 */
export function scoreAdvisor(
  actual: Record<string, number | null | undefined>,
  goal: Record<string, number | null | undefined>,
  weights: Record<string, number>,
  opts: ScoringOptions = {},
): ScoreBreakdown {
  const breakdown: Record<string, number> = {};
  let total = 0;
  for (const [key, weight] of Object.entries(weights)) {
    const g = goal[key];
    const a = actual[key];
    if (g == null || g === 0 || a == null) {
      breakdown[key] = 0;
      continue;
    }
    let attainment = a / g;
    if (opts.attainmentCap != null) attainment = Math.min(attainment, opts.attainmentCap / 100);
    const pts = round2(attainment * weight);
    breakdown[key] = pts;
    total += pts;
  }
  return { breakdown, total: round2(total) };
}

/** teamScore = mean(advisor scores at that store, eligible only). Empty roster scores 0. */
export function scoreTeam(eligibleAdvisorScores: number[]): number {
  if (eligibleAdvisorScores.length === 0) return 0;
  const mean = eligibleAdvisorScores.reduce((a, b) => a + b, 0) / eligibleAdvisorScores.length;
  return round2(mean);
}

/**
 * points_c = attainment_c * weight_c / 100; score = sum(points_c).
 * Manager category values (including `teamScore`, fed in from {@link scoreTeam})
 * arrive already expressed as percent-of-goal, so there is no goal division here
 * — that's what distinguishes this from {@link scoreAdvisor}.
 */
export function scoreManager(
  actualPct: Record<string, number | null | undefined>,
  weights: Record<string, number>,
  opts: ScoringOptions = {},
): ScoreBreakdown {
  const breakdown: Record<string, number> = {};
  let total = 0;
  for (const [key, weight] of Object.entries(weights)) {
    const a = actualPct[key];
    if (a == null) {
      breakdown[key] = 0;
      continue;
    }
    let value = a;
    if (opts.attainmentCap != null) value = Math.min(value, opts.attainmentCap);
    const pts = round2((value * weight) / 100);
    breakdown[key] = pts;
    total += pts;
  }
  return { breakdown, total: round2(total) };
}

/** score - sum(penalty values). Penalties are always positive numbers subtracted here. */
export function applyPenalties(score: number, penaltyValues: number[]): { total: number; penaltyTotal: number } {
  const penaltyTotal = round2(penaltyValues.reduce((a, b) => a + b, 0));
  return { total: round2(score - penaltyTotal), penaltyTotal };
}

/** The admin UI's "must total 100" guard, shared with the engine so both sides agree. */
export function weightsTotalTo100(weights: Record<string, number>, tolerance = 0.001): boolean {
  const sum = Object.values(weights).reduce((a, b) => a + b, 0);
  return Math.abs(sum - 100) <= tolerance;
}

/** Assigns dense 1-based positions from a list already sorted best-first. Ties share a position (competition ranking, 1-2-2-4). */
export function assignPositions<T>(sortedDescending: T[], scoreOf: (item: T) => number): Array<T & { position: number }> {
  const out: Array<T & { position: number }> = [];
  let lastScore: number | null = null;
  let lastPosition = 0;
  sortedDescending.forEach((item, index) => {
    const score = scoreOf(item);
    const position = lastScore !== null && score === lastScore ? lastPosition : index + 1;
    lastScore = score;
    lastPosition = position;
    out.push({ ...item, position });
  });
  return out;
}
