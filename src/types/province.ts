export interface ProvinceReadOnly { readOnly: true; canWrite: false; activeYear: number | null; provinceEnabled: boolean; periodRevision: number }
export interface ProvinceConfig extends ProvinceReadOnly {
  configured: boolean;
  hasPassword: boolean;
  username?: string;
  provinceHealthCenterCode?: string;
  revision: number;
  updatedAt?: string;
  connectionStatus: 'NOT_CONFIGURED' | 'UNTESTED';
}
export interface ProvinceConfigInput {
  revision: number;
  username: string;
  password?: string;
  provinceHealthCenterCode: string;
}
export interface ProvinceConnection extends ProvinceReadOnly {
  connectionStatus: 'CONNECTED'; revision: number; provinceHealthCenterCode: string; testedAt: string;
}
export type ProvinceValue = string | number | null;
export interface ProvinceTarget {
  kd_ind: string; indikator: string; satuan: ProvinceValue; total_sasaran: ProvinceValue;
}
export interface ProvinceMonthly {
  bulan: ProvinceValue; kdindikator: string; indikator: string; target: ProvinceValue;
  sasaran: ProvinceValue; jml_sasaran: ProvinceValue; target_sasaran: ProvinceValue;
  capaian: ProvinceValue; hasil_riil: ProvinceValue; hasil_kinerja: ProvinceValue;
}
export interface ProvinceCatalog extends ProvinceReadOnly {
  revision: number; remoteYear: null; targets: ProvinceTarget[]; months: { bulan: ProvinceValue; nama: string }[];
}
export interface ProvinceMapping { indicatorId: string; provinceCode: string }
export interface ProvinceMappingsInput { revision: number; items: ProvinceMapping[] }
export interface ProvinceMappings extends ProvinceReadOnly, ProvinceMappingsInput {}
export type ProvinceLogAction = 'PROVINCE_CONFIG_SAVE' | 'PROVINCE_TEST' | 'PROVINCE_CATALOG' | 'PROVINCE_MAPPING_SAVE' | 'PROVINCE_PREVIEW';
export type ProvinceLogErrorCode = 'INVALID_REQUEST' | 'FORBIDDEN' | 'CONFLICT' | 'REMOTE_UNAVAILABLE' | 'INTERNAL_ERROR';
export interface ProvinceLog {
  id: string;
  actorId: string | null;
  action: ProvinceLogAction;
  status: 'SUCCESS' | 'FAILURE';
  timestamp: string;
  durationMs: number | null;
  errorCode: ProvinceLogErrorCode | null;
}
export interface ProvinceLogs {
  items: ProvinceLog[];
  page: number;
  limit: number;
  hasMore: boolean;
}
export type ProvinceOperation = 'TARGETS' | 'MONTHLY';
export type ProvincePreviewInput = { operation: 'TARGETS' } | { operation: 'MONTHLY'; month: number };
export interface ProvincePreview extends ProvinceReadOnly {
  revision: number; operation: ProvinceOperation; localYear: number; month: number | null; remoteYear: null;
  warnings: string[];
  items: {
    indicatorId: string; provinceCode: string;
    local: { targetPct?: ProvinceValue; totalSasaran: ProvinceValue; targetSasaran: ProvinceValue;
      pencapaianRiil?: ProvinceValue; capaianRiilPct?: ProvinceValue; nilaiKinerja?: ProvinceValue; scoringVersion?: ProvinceValue } | null;
    remote: ProvinceTarget | ProvinceMonthly | null;
    warnings: string[];
  }[];
  unmappedRemote: (ProvinceTarget | ProvinceMonthly)[];
}
