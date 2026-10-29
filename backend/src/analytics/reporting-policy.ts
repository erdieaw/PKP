import { ConflictException } from '@nestjs/common';

/** Workflow approval is not evidence that a scoring/category policy is approved. */
export function reportingPolicy(year: number) {
  return year >= 2026
    ? { status: 'PENDING_AUTHORITY' as const, operatingMode: 'INTERNAL_PHASED' as const, canSubmit: false, canVerify: false,
        reason: 'Mode operasional internal bertahap: input bulanan, rekap terkonfirmasi, pratinjau dan unduhan tetap tersedia sesuai hak akses dan kunci periode. Hasil untuk evaluasi internal, bukan penilaian resmi Dinkes. Pengajuan dan verifikasi baru 2026+ ditahan sampai kebijakan kategori, agregasi dan kelayakan disahkan.' }
    : { status: 'LEGACY_COMPATIBILITY' as const, operatingMode: 'HISTORICAL_COMPATIBILITY' as const, canSubmit: true, canVerify: true,
        reason: 'Alur kompatibilitas historis; status verifikasi aplikasi bukan pengesahan regulasi.' };
}

export function guardReportingPolicy(year: number) {
  const policy = reportingPolicy(year);
  if (!policy.canSubmit) throw new ConflictException({ code: 'PKP_POLICY_UNAPPROVED', message: policy.reason, policy });
}
