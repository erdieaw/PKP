import source from './source.json';
import { DO_RULES } from './rules';
import { cumulativePolicy } from './cumulative';
import { DO_REVIEW_HOLDS } from './review-holds';
import { sourceAssessmentDescriptor } from './source-assessment';

export const DO_SOURCE_HASH = 'c4baf039eb460c7ffe030b419973b78ce0739e6f92778fbb41f85f5d3ea22149';
const byIndicator = new Map(source.map(row => [row.indicatorId, row]));

export function getDoProfile(indicatorId: string) {
  const row = byIndicator.get(indicatorId);
  if (!row) return undefined;
  const rule = DO_RULES[indicatorId];
  const assessment = sourceAssessmentDescriptor(indicatorId);
  const formula = assessment?.formula;
  const raw = row.target.raw;
  const targetDisplay = typeof raw === 'number' && row.target.excel_number_format.includes('%') ? `${raw * 100}%` : String(raw ?? 'Belum ditetapkan');
  return {
    definitionId: row.definitionId, sourceRef: row.sourceRef, sourceHash: DO_SOURCE_HASH,
    formulaFamily: row.formulaFamily, definition: row.definition, calculation: row.calculation, notes: row.notes,
    measurementUnit: rule?.unit ?? (formula?.operator === 'RATIO_PERCENT' ? 'PERCENT' : formula?.operator === 'COUNT' ? 'COUNT' : null),
    numeratorLabel: rule?.numeratorLabel ?? (formula && 'numerator' in formula ? formula.numerator : 'Observasi sumber'),
    denominatorLabel: rule?.denominatorLabel ?? (formula && 'denominator' in formula ? formula.denominator : 'Tidak digunakan untuk hasil gabungan'),
    targetDisplay, fixedDenominator: rule?.fixedDenominator ?? (formula && 'fixedDenominator' in formula ? formula.fixedDenominator : null),
    numeratorInput: rule ? (indicatorId === 'K1-R39' && rule.structuredInputKind === 'SEMESTER_SURVEY_ANNUAL' ? 'DECIMAL' as const : 'INTEGER' as const) : formula && 'input' in formula ? formula.input : 'INTEGER', denominatorInput: rule?.denominatorInput ?? (formula && 'input' in formula ? formula.input : null),
    annualRecapOnly: rule?.annualRecapOnly === true || assessment?.period === 'ANNUAL',
    ...(assessment ? { structuredInputKind: 'DO_SOURCE_ASSESSMENT' as const, sourceAssessment: assessment, inputAvailable: true, calculationAvailability: assessment.calculationAvailability } : {}),
    ...(assessment?.localResolution ? { localResolution: assessment.localResolution, localCalculationAvailability: 'EXPLICIT_OPT_IN_ONLY' as const } : {}),
    ...(rule?.structuredInputKind ? { structuredInputKind: rule.structuredInputKind } : {}),
    observationPeriod: assessment?.period ?? (rule?.annualRecapOnly || indicatorId === 'K3-R40' || indicatorId === 'K3-R41' ? 'CALENDAR_YEAR' as const : 'PROFILE_REVIEW_REQUIRED' as const),
    assessmentInstruction: [rule?.assessmentNote, 'Hasil hitung sementara saja. Kelengkapan angka atau skor bukan bukti kelengkapan penilaian. Periode observasi, populasi, deduplikasi, jadwal, dan kelayakan harus diperiksa terhadap DO; indikator tahunan tidak menjadi lengkap hanya karena satu bulan terisi.'].filter(Boolean).join(' '),
    status: rule ? 'IMPLEMENTED' as const : assessment?.calculationAvailability === 'AVAILABLE_WITH_CONTEXT' ? 'CONTEXTUAL' as const : assessment ? 'SOURCE_INPUT_ONLY' as const : 'UNRESOLVED_RULE' as const,
    approvalStatus: 'PROVISIONAL_SOURCE_RULE' as const,
    cumulativePolicy: cumulativePolicy(indicatorId),
    cumulativeInstruction: assessment ? assessment.periodInstruction : rule?.annualRecapOnly
      ? 'Hanya rekap tahunan Januari sampai Desember yang dikonfirmasi dari sumber independen sesuai DO. Tidak menerima input V2 bulanan atau rekap parsial, tidak menjumlahkan bulanan, dan tidak mengesahkan kelayakan maupun skor kinerja.'
      : 'Gunakan rekap terpisah Januari–akhir periode dari sumber yang direkonsiliasi. Periksa kesamaan sampel/metode, periode tidak tumpang tindih, dan deduplikasi sesuai DO. Penggabungan otomatis bulanan ditahan; konfirmasi pengguna bukan verifikasi otomatis atau pengesahan Dinkes.',
    reason: rule ? null : assessment ? assessment.unresolved.join(' ') || 'Asesmen agregat bersumber wajib; belum merupakan skor atau pengesahan aturan.' : DO_REVIEW_HOLDS[indicatorId] ?? 'Profil belum ditinjau. Tidak ada rumus pengganti; periksa sumber DO sebelum implementasi.',
  };
}
