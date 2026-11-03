import type { OfficialIndicator } from './pkp';

export type ObservationKind = 'NOTE' | 'NUMBER' | 'RATIO' | 'DOCUMENT';
export type ObservationStatus = 'RECORDED' | 'NOT_DUE' | 'NOT_AVAILABLE';
export interface MonthlyObservationInput {
  indicatorId: string;
  revision: number;
  kind: ObservationKind;
  status: ObservationStatus;
  value: number | null;
  denominator: number | null;
  documentAvailable: boolean | null;
  unit: string | null;
  notes: string | null;
  sourceReference: string | null;
  evidenceId?: string | null;
}
export interface MonthlyObservation extends MonthlyObservationInput {
  id: string;
  healthCenterId: string;
  year: number;
  month: number;
  updatedAt: string;
}

export function defaultsToObservation(indicator: OfficialIndicator) {
  const profile = indicator.do2026;
  return Boolean(profile && (profile.status !== 'IMPLEMENTED' || profile.annualRecapOnly || profile.structuredInputKind));
}

export function defaultObservationKind(indicator: OfficialIndicator): ObservationKind {
  const profile = indicator.do2026;
  if (profile?.formulaFamily === 'DOCUMENT_EXISTENCE' || profile?.sourceAssessment?.kind === 'DOCUMENT') return 'DOCUMENT';
  return indicator.satuan?.trim() ? 'NUMBER' : 'NOTE';
}

export function observationText(row: MonthlyObservation) {
  if (row.status === 'NOT_DUE') return 'Belum jatuh jadwal';
  if (row.status === 'NOT_AVAILABLE') return 'Data belum tersedia';
  if (row.kind === 'DOCUMENT') return row.documentAvailable ? 'Dokumen tersedia' : 'Dokumen belum tersedia';
  if (row.kind === 'NOTE') return row.notes ?? 'Catatan';
  return `${row.value}${row.kind === 'RATIO' ? ` / ${row.denominator}` : ''} ${row.unit ?? ''}`;
}
