import { api, ApiError } from './apiClient';
import { pkpStore } from './apiStore';
import type { ProvinceCatalog, ProvinceConfig, ProvinceConfigInput, ProvinceConnection, ProvinceLogs, ProvinceMappings, ProvinceMappingsInput, ProvincePreview, ProvincePreviewInput } from '../types/province';

export const provinceBridge = {
  config: (signal: AbortSignal) => api.request<ProvinceConfig>('/bridge/config', { signal }),
  mappings: (signal: AbortSignal) => api.request<ProvinceMappings>('/bridge/mappings', { signal }),
  logs: (page: number, signal: AbortSignal) => api.request<ProvinceLogs>(`/bridge/logs?page=${page}&limit=20`, { signal }),
  catalog: (signal: AbortSignal) => api.request<ProvinceCatalog>('/bridge/catalog', { signal }),
  test: (signal: AbortSignal) => api.request<ProvinceConnection>('/bridge/test', { method: 'POST', signal }),
  preview: (body: ProvincePreviewInput, signal: AbortSignal) => api.request<ProvincePreview>('/bridge/preview', { method: 'POST', body, signal }),
  saveConfig: (body: ProvinceConfigInput) => pkpStore.runOwnTenantWrite(signal => api.request<ProvinceConfig>('/bridge/config', { method: 'PUT', body, signal })),
  saveMappings: (body: ProvinceMappingsInput) => pkpStore.runOwnTenantWrite(signal => api.request<ProvinceMappings>('/bridge/mappings', { method: 'PUT', body, signal })),
};

export function provinceError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 503) {
      const stage = error.message.split(':', 1)[0];
      const messages: Record<string, string> = {
        BROWSER_UNAVAILABLE: 'Browser integrasi tidak dapat dijalankan di server. Hubungi pengelola untuk memeriksa runtime Chromium.',
        PORTAL_LOGIN_FAILED: 'Login portal provinsi belum berhasil. Periksa kredensial tersimpan; portal mungkin memerlukan tindakan operator atau sedang tidak dapat diakses.',
        IDENTITY_MISMATCH: 'Identitas akun provinsi tidak sesuai atau kode Puskesmas tidak tersedia. Periksa kode Puskesmas pada pengaturan integrasi.',
        READ_FAILED: 'Login telah dilewati, tetapi pembacaan data provinsi belum berhasil. Portal mungkin berubah atau sedang tidak tersedia.',
      };
      if (messages[stage]) return messages[stage];
    }
    if (error.status === 503) return 'Integrasi provinsi belum tersedia. Kunci enkripsi server mungkin belum dikonfigurasi atau layanan portal sedang tidak tersedia/sibuk. Hubungi pengelola atau coba lagi nanti.';
    if (error.status === 409) return 'Periode aktif, konfigurasi atau pemetaan berubah di sesi lain, atau akses provinsi dinonaktifkan Dinkes. Muat ulang konfigurasi sebelum mencoba lagi; perubahan formulir belum disimpan.';
    if (error.status === 400) return 'Data belum valid. Periksa kredensial tersimpan, indikator lokal aktif, dan kode provinsi yang harus cocok persis serta tidak duplikat.';
    if (error.status === 403) return 'Akses integrasi hanya untuk administrator Puskesmas sendiri.';
    if (error.status === 401) return 'Sesi berakhir. Silakan masuk kembali.';
  }
  return 'Operasi integrasi gagal. Periksa koneksi dan coba lagi. Status koneksi belum terverifikasi.';
}

const warnings: Record<string, string> = {
  REMOTE_YEAR_UNKNOWN: 'Tahun data provinsi tidak diketahui. Data lokal menggunakan tahun aktif Dinkes.',
  FORMULA_EQUIVALENCE_UNVERIFIED: 'Kesetaraan rumus lokal dan provinsi belum diverifikasi.',
  LOCAL_INDICATOR_INACTIVE: 'Indikator lokal sudah tidak aktif.',
  LOCAL_RECORD_MISSING: 'Belum ada rekaman lokal tersimpan untuk periode ini.',
  REMOTE_RECORD_MISSING: 'Rekaman provinsi tidak ditemukan.',
  REMOTE_RECORD_AMBIGUOUS: 'Terdapat beberapa rekaman provinsi dengan kode yang sama; data tidak dibandingkan.',
};
export const provinceWarning = (code: string) => warnings[code] ?? 'Peringatan tambahan dari layanan provinsi; perlu ditinjau pengelola.';
