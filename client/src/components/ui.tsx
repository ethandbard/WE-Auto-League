import type { ReactNode } from 'react';

export function Card({ children, className = '', ...rest }: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`rounded-lg border border-hairline bg-surface ${className}`} {...rest}>
      {children}
    </div>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-10 justify-center text-ink-3 text-sm">
      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-hairline-strong border-t-brand" />
      {label}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-lg border border-crit/30 bg-crit-wash px-4 py-6 text-center">
      <p className="text-sm text-crit">{message}</p>
      {onRetry && (
        <button onClick={onRetry} className="mt-3 text-sm font-medium text-brand hover:underline">
          Try again
        </button>
      )}
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-dashed border-hairline-strong px-4 py-10 text-center">
      <p className="font-display text-sm font-semibold text-ink-2">{title}</p>
      {hint && <p className="mt-1 text-sm text-ink-3">{hint}</p>}
    </div>
  );
}

const TIER_CLASSES: Record<'good' | 'warn' | 'crit', string> = {
  good: 'bg-good-wash text-good',
  warn: 'bg-warn-wash text-warn',
  crit: 'bg-crit-wash text-crit',
};

/** Position badge; the #1 spot carries the app's one signature flourish — see index.css .checker-corner. */
export function PositionBadge({ position, tier }: { position: number; tier: 'good' | 'warn' | 'crit' }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded px-2 py-0.5 font-mono text-xs font-semibold ${TIER_CLASSES[tier]}`}>
      {position === 1 && <span className="checker-corner" aria-hidden />}#{position}
    </span>
  );
}

export function StatusChip({ status }: { status: 'eligible' | 'hidden' | 'terminated' }) {
  const styles: Record<string, string> = {
    eligible: 'bg-good-wash text-good',
    hidden: 'bg-warn-wash text-warn',
    terminated: 'bg-crit-wash text-crit',
  };
  return <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide ${styles[status]}`}>{status}</span>;
}

export function Button({
  children,
  variant = 'primary',
  className = '',
  ...rest
}: { children: ReactNode; variant?: 'primary' | 'secondary' | 'danger' } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const base = 'inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
  const variants: Record<string, string> = {
    primary: 'bg-brand text-white hover:bg-brand-strong',
    secondary: 'border border-hairline-strong bg-surface text-ink hover:bg-surface-2',
    danger: 'border border-crit/30 bg-crit-wash text-crit hover:bg-crit/10',
  };
  return (
    <button className={`${base} ${variants[variant]} ${className}`} {...rest}>
      {children}
    </button>
  );
}
