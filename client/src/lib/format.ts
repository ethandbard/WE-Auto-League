export function formatScore(value: string | number): string {
  return Number(value).toFixed(2);
}

export function formatCategoryValue(value: number, unit: string): string {
  switch (unit) {
    case 'currency':
      return `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
    case 'percent':
      return `${(value * 1).toFixed(2)}`;
    case 'ratio':
      return value.toFixed(2);
    default:
      return String(Math.round(value));
  }
}

/** Green→amber→red across a rank tier, matching the printed Victory Lane sheet's position colouring. */
export function tierForPosition(position: number, total: number): 'good' | 'warn' | 'crit' {
  const frac = total <= 1 ? 0 : (position - 1) / (total - 1);
  if (frac <= 1 / 3) return 'good';
  if (frac <= 2 / 3) return 'warn';
  return 'crit';
}

/** Four-quartile "plate" tier for the racing-theme position badge — one flat colour per quarter of
 * the field, greener at the front of the pack and redder at the back. Maps to --color-tier-1..4. */
export function plateTierForPosition(position: number, total: number): 1 | 2 | 3 | 4 {
  const frac = total <= 1 ? 0 : (position - 1) / (total - 1);
  if (frac <= 0.25) return 1;
  if (frac <= 0.5) return 2;
  if (frac <= 0.75) return 3;
  return 4;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
