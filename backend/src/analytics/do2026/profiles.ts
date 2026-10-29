import source from './source.json';
import { DO_RULES } from './rules';
import { cumulativePolicy } from './cumulative';

export const DO_SOURCE_HASH = 'c4baf039eb460c7ffe030b419973b78ce0739e6f92778fbb41f85f5d3ea22149';
const byIndicator = new Map(source.map(row => [row.indicatorId, row]));

export function getDoProfile(indicatorId: string) {
  const row = byIndicator.get(indicatorId);
  if (!row) return undefined;
  const rule = DO_RULES[indicatorId];
  const raw = row.target.raw;
  const targetDisplay = typeof raw === 'number' && row.target.excel_number_format.includes('%') ? `${raw * 100}%` : String(raw ?? 'Belum ditetapkan');
  return {
    definitionId: row.definitionId, sourceRef: row.sourceRef, sourceHash: DO_SOURCE_HASH,
    formulaFamily: row.formulaFamily, definition: row.definition, calculation: row.calculation, notes: row.notes,
    measurementUnit: rule?.unit ?? null, numeratorLabel: rule?.numeratorLabel ?? 'Pembilang sesuai DO',
    denominatorLabel: rule?.denominatorLabel ?? 'Penyebut belum dikonfirmasi',
    targetDisplay, fixedDenominator: rule?.fixedDenominator ?? null,
    numeratorInput: rule ? 'INTEGER' as const : null, denominatorInput: rule?.denominatorInput ?? null,
    observationPeriod: indicatorId === 'K3-R40' || indicatorId === 'K3-R41' ? 'CALENDAR_YEAR' as const : 'PROFILE_REVIEW_REQUIRED' as const,
    assessmentInstruction: 'Hasil hitung sementara saja. Kelengkapan angka atau skor bukan bukti kelengkapan penilaian. Periode observasi, populasi, deduplikasi, jadwal, dan kelayakan harus diperiksa terhadap DO; indikator tahunan tidak menjadi lengkap hanya karena satu bulan terisi.',
    status: rule ? 'IMPLEMENTED' as const : 'UNRESOLVED_RULE' as const,
    approvalStatus: 'PROVISIONAL_SOURCE_RULE' as const,
    cumulativePolicy: cumulativePolicy(indicatorId),
    cumulativeInstruction: 'Gunakan rekap terpisah Januari–akhir periode dari sumber yang direkonsiliasi. Periksa kesamaan sampel/metode, periode tidak tumpang tindih, dan deduplikasi sesuai DO. Penggabungan otomatis bulanan ditahan; konfirmasi pengguna bukan verifikasi otomatis atau pengesahan Dinkes.',
    reason: rule ? null : 'Profil ini belum diimplementasikan dan ditinjau untuk penghitungan V2. Periksa kontrak pengukuran, waktu, rubrik dan pengecualian pada sumber DO. Tidak ada fallback ke rumus persentase.',
  };
}
