import { useMemo, useState } from 'react';
import { useApi } from './useApi';
import type { Period } from './types';

/** Periods newest-first, with a selection defaulting to the most recent one. */
export function usePeriods() {
  const { data, loading, error, refetch } = useApi<{ periods: Period[] }>('/api/periods');
  const periods = data?.periods ?? [];
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const selected = useMemo(() => periods.find((p) => p.id === selectedId) ?? periods[0] ?? null, [periods, selectedId]);
  return { periods, selected, selectedId: selected?.id ?? null, setSelectedId, loading, error, refetch };
}
