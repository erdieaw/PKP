import type { ProvinceMapping } from '../types/province';

export const lastSyncText = 'Sinkron terakhir: Belum tersedia';

// Legacy flags and read/test timestamps are not evidence of a remote write.
export function epSyncStatus(syncStatus?: string): string {
  return syncStatus === 'SYNCED' ? 'Status belum terverifikasi' : 'Belum disinkronkan';
}

export function mappingStatus(indicatorId: string, draft: readonly ProvinceMapping[], saved: readonly ProvinceMapping[]): string {
  const current = draft.filter(mapping => mapping.indicatorId === indicatorId);
  const persisted = saved.filter(mapping => mapping.indicatorId === indicatorId);
  if (!current.length && !persisted.length) return 'Belum dipetakan';
  return current.length === 1 && persisted.length === 1 && !!current[0].provinceCode && current[0].provinceCode === persisted[0].provinceCode
    ? 'Pemetaan tersimpan' : 'Pemetaan belum disimpan';
}
