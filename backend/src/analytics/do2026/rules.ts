import { MANAGEMENT_RULES } from './reviewed-management';
import { CLINICAL_RULES } from './reviewed-clinical';
import { INFECTIOUS_CROSS_RULES } from './reviewed-infectious-cross';
import type { StructuredInputKind } from './structured-input';

export type LiteralBand = {
  readonly min: number; readonly max: number | null;
  readonly minInclusive: boolean; readonly maxInclusive: boolean; readonly score: number;
};
export type DoRule = {
  readonly structuredInputKind?: StructuredInputKind;
  readonly annualRecapOnly?: true;
  readonly sourceRef?: string;
  readonly assessmentNote?: string;
  readonly denominatorInput: 'INTEGER' | 'ESTIMATED';
  readonly unit: 'PERCENT' | 'ITEMS_PER_PRESCRIPTION' | 'COUNT' | 'SCORE';
  readonly numeratorLabel: string; readonly denominatorLabel: string;
  readonly fixedDenominator?: number; readonly denominatorFactor?: number;
  readonly scoring:
    | { readonly kind: 'THRESHOLD'; readonly maximum: number }
    | { readonly kind: 'BANDS'; readonly bands: readonly LiteralBand[] }
    | { readonly kind: 'COVERAGE'; readonly target: number }
    | { readonly kind: 'FREQUENCY_MINIMUM'; readonly minimum: number }
    | { readonly kind: 'ATTAINMENT'; readonly limit: number; readonly direction: 'MAX' | 'MIN' }
    | { readonly kind: 'DOCUMENT' };
};

const percent = { unit: 'PERCENT', denominatorInput: 'INTEGER', numeratorLabel: 'Pembilang sesuai DO (orang unik pada periode ini)', denominatorLabel: 'Penyebut aktual sesuai DO, bukan sasaran tahunan/12' } as const;
const upper = (maximum: number): DoRule => ({ ...percent, scoring: { kind: 'THRESHOLD', maximum } });
const bands = (bounds: readonly number[]): readonly LiteralBand[] => bounds.map<LiteralBand>((max, index) => ({
  min: index === 0 ? 0 : bounds[index - 1] ?? 0, max,
  minInclusive: index < 2, maxInclusive: index !== 0, score: [100, 75, 50, 25][index] ?? 0,
})).concat([{ min: bounds[3] ?? 0, max: null, minInclusive: false, maxInclusive: false, score: 0 }]);

const literal = (ranges: readonly (readonly [number, number | null, number])[]): readonly LiteralBand[] => ranges.map(([min, max, score]) => ({ min, max, score, minInclusive: true, maxInclusive: true }));
const checklist = (size: number, target = 100): DoRule => ({
  unit: 'PERCENT', denominatorInput: 'INTEGER', numeratorLabel: 'Jumlah komponen berbeda yang memenuhi seluruh syarat DO',
  denominatorLabel: `Jumlah komponen wajib (${size})`, fixedDenominator: size, scoring: { kind: 'COVERAGE', target },
});
const document: DoRule = { unit: 'COUNT', denominatorInput: 'INTEGER', numeratorLabel: 'Dokumen lengkap dan valid tersedia (1) atau tidak (0)', denominatorLabel: 'Satu dokumen wajib (1)', fixedDenominator: 1, scoring: { kind: 'DOCUMENT' } };
const coverage = (target: number): DoRule => ({ ...percent, scoring: { kind: 'COVERAGE', target } });

// Explicit catalogue identities; DO row numbers are not API IDs. No rule is inferred from labels.
export const DO_RULES: Readonly<Record<string, DoRule>> = {
  ...MANAGEMENT_RULES,
  ...CLINICAL_RULES,
  ...INFECTIOUS_CROSS_RULES,
  'K2-R44': {
    annualRecapOnly: true, structuredInputKind: 'LROA_ANNUAL',
    sourceRef: 'S1:KLASTER 2!A43:I43', unit: 'PERCENT', denominatorInput: 'INTEGER', fixedDenominator: 4,
    numeratorLabel: 'Triwulan dengan tiga bulan laporan lengkap dan minimal dua kategori kegiatan positif setiap bulan',
    denominatorLabel: 'Empat triwulan tahun rekap (4)',
    assessmentNote: 'Interpretasi teknis provisional dari narasi sumber: hanya TW4 lengkap berarti 25%, bukan rubrik skor resmi. Dua belas slot bulan dan keenam count layanan wajib eksplisit, termasuk bila laporan tidak ada; tidak mengarang nol. threeHourObservation hanya menghitung observasi penderita dehidrasi ringan-sedang paling sedikit tiga jam; dehydrationTreatment juga untuk dehidrasi ringan-sedang. Referensi SIHEPI/laporan PISP dan kelayakan layanan adalah attestasi, bukan validasi bukti atau identitas pasien.',
    scoring: { kind: 'COVERAGE', target: 100 },
  },
  'K1-R39': {
    annualRecapOnly: true, structuredInputKind: 'SEMESTER_SURVEY_ANNUAL',
    sourceRef: 'S1:KLASTER I!A39:H39', unit: 'SCORE', denominatorInput: 'INTEGER', fixedDenominator: 2,
    numeratorLabel: 'Jumlah desimal nilai survei semester I dan II pada skala 100 poin terdokumentasi',
    denominatorLabel: 'Dua semester lengkap (2), bukan jumlah sampel',
    assessmentNote: 'Rerata dua semester tanpa pembobotan sampel, konversi skala atau fallback bulanan. Skala 100 poin dan metode kompatibel wajib terattestasi dengan referensi; target 78 bukan bukti skala instrumen. Nilai maksimal empat desimal agar tersimpan tanpa pembulatan; hasil ukur poin bukan skor kinerja.',
    scoring: { kind: 'ATTAINMENT', limit: 78, direction: 'MIN' },
  },
  'K4-R16': {
    annualRecapOnly: true, structuredInputKind: 'TB_COHORT_ANNUAL',
    sourceRef: 'S1:KLASTER 4!A15:J15', unit: 'PERCENT', denominatorInput: 'INTEGER',
    numeratorLabel: 'Pasien kohort TBC Y-1 sembuh atau pengobatan lengkap, dihitung sekali',
    denominatorLabel: 'Denominator awal semua pasien kohort Y-1 diobati, dicatat dan dilaporkan dalam SITB',
    assessmentNote: 'Kohort Y-1 dan ketertautan hasil pada denominator awal wajib lengkap/terattestasi. Tanpa identitas pasien, penjumlahan hasil tahun berjalan atau fallback bulanan. D nol tetap unavailable, bukan nihil terverifikasi atau N/A; tidak ada skor kinerja.',
    scoring: { kind: 'COVERAGE', target: 90 },
  },
  'K4-R20': {
    annualRecapOnly: true, structuredInputKind: 'LEPROSY_COHORT_ANNUAL',
    sourceRef: 'S1:KLASTER 4!A19:J19', unit: 'PERCENT', denominatorInput: 'INTEGER',
    numeratorLabel: 'Jumlah selesai pengobatan sesuai periode dari kohort PB Y-1 dan MB Y-2',
    denominatorLabel: 'Jumlah kasus baru mulai pengobatan pada kohort PB Y-1 dan MB Y-2 dalam SIPK',
    assessmentNote: 'Dua komponen kohort matang/lengkap dengan hasil tertaut denominator awal. Jumlah N dibagi jumlah D, bukan mean dua persentase. Nol per komponen harus eksplisit; D gabungan nol tetap unavailable. Periode terapi dan referensi adalah attestasi, bukan validasi pasien/dokumen; tidak ada skor kinerja.',
    scoring: { kind: 'COVERAGE', target: 90 },
  },
  'K5-R38': {
    annualRecapOnly: true, structuredInputKind: 'PME_ANNUAL',
    sourceRef: 'S1:LINTAS KLASTER!A37:I37', unit: 'PERCENT', denominatorInput: 'INTEGER', fixedDenominator: 2,
    numeratorLabel: 'Jumlah keikutsertaan PME berbeda dengan referensi sertifikat/hasil dalam tahun rekap',
    denominatorLabel: 'Minimum dua keikutsertaan PME setahun (2), bukan checklist atau jumlah kegiatan aktual',
    assessmentNote: 'Ledger Januari-Desember wajib; daftar kosong adalah pernyataan nihil pada sumber/catatan terkonfirmasi, bukan data hilang. Referensi bukti adalah attestasi petugas, bukan validasi dokumen. Capaian dapat melebihi 100%; skor tetap null.',
    scoring: { kind: 'FREQUENCY_MINIMUM', minimum: 2 },
  },
  'K1-R40': {
    annualRecapOnly: true, structuredInputKind: 'RTM_ANNUAL',
    sourceRef: 'S1:KLASTER I!A40:H40', unit: 'PERCENT', denominatorInput: 'INTEGER',
    numeratorLabel: 'Jumlah rekomendasi RTM selesai dengan tanggal dan referensi tindak lanjut pada tahun yang sama',
    denominatorLabel: 'Seluruh rekomendasi RTM dari ledger rapat tahun yang sama, bukan jumlah rapat',
    assessmentNote: 'Minimal dua rapat berbeda setahun merupakan prasyarat terpisah dari rasio rekomendasi. Tidak memakai carryover atau tenggat buatan. Ledger kosong adalah attestasi nihil pada sumber/catatan; D nol tetap unavailable. Referensi bukan validasi bukti eksternal.',
    scoring: { kind: 'COVERAGE', target: 100 },
  },
  'K2-R50': { ...upper(15.04), numeratorLabel: 'Balita 0–59 bulan pendek/sangat pendek', denominatorLabel: 'Balita 0–59 bulan yang diukur PB/TB pada periode yang sama' },
  'K2-R51': { ...upper(14), numeratorLabel: 'Balita 0–59 bulan dengan BB kurang/sangat kurang', denominatorLabel: 'Balita 0–59 bulan yang ditimbang BB pada periode yang sama' },
  'K2-R52': { ...upper(8), numeratorLabel: 'Balita 0–59 bulan gizi kurang/buruk', denominatorLabel: 'Balita 0–59 bulan yang ditimbang BB dan diukur PB/TB pada periode yang sama' },
  'K2-R75': { ...percent, numeratorLabel: 'Perokok usia 10–21 tahun dari hasil skrining', denominatorLabel: 'Penduduk usia 10–21 tahun yang diskrining pada periode yang sama', scoring: { kind: 'ATTAINMENT', limit: 11.4, direction: 'MAX' } },
  'K3-R40': { ...percent, numeratorLabel: 'Peserta berhenti alokon, tidak termasuk ganti cara', denominatorLabel: 'Peserta KB metode modern (mCPR) pada periode yang sama', scoring: { kind: 'BANDS', bands: bands([15, 17.5, 20, 22.5]) } },
  'K3-R41': { ...percent, numeratorLabel: 'Peserta KB mengalami komplikasi (deduplikasi per metode sesuai DO)', denominatorLabel: 'Jumlah peserta KB aktif pada periode yang sama', scoring: { kind: 'BANDS', bands: bands([3.5, 4.5, 7.5, 10]) } },
  'K3-R38': { ...percent, numeratorLabel: 'Jumlah peserta KB aktif pada periode yang sama', denominatorLabel: 'Jumlah PUS pada periode yang sama', scoring: { kind: 'BANDS', bands: literal([[65, 70, 100], [71, 75, 90], [76, 80, 80], [81, 85, 70], [86, 90, 60], [90, 100, 50]]) } },
  'K5-R23': { ...percent, numeratorLabel: 'Kasus sampel ISPA nonpneumonia diberi antibiotik', denominatorLabel: 'Seluruh kasus dalam sampel ISPA nonpneumonia yang sama', scoring: { kind: 'BANDS', bands: [...literal([[0, 20, 100], [21, 40, 75], [41, 60, 50], [61, 80, 25]]), { min: 80, max: null, minInclusive: false, maxInclusive: false, score: 0 }] } },
  'K5-R24': { ...percent, numeratorLabel: 'Kasus sampel diare nonspesifik diberi antibiotik', denominatorLabel: 'Seluruh kasus dalam sampel diare nonspesifik yang sama', scoring: { kind: 'BANDS', bands: [...literal([[0, 8, 100], [9, 20, 75], [21, 40, 50], [41, 60, 25]]), { min: 60, max: null, minInclusive: false, maxInclusive: false, score: 0 }] } },
  'K5-R25': { ...percent, numeratorLabel: 'Kasus sampel myalgia diberi injeksi', denominatorLabel: 'Seluruh kasus dalam sampel myalgia yang sama', scoring: { kind: 'BANDS', bands: [...literal([[0, 1, 100], [2, 10, 75], [11, 20, 50], [21, 30, 25]]), { min: 30, max: null, minInclusive: false, maxInclusive: false, score: 0 }] } },
  'K5-R26': { unit: 'ITEMS_PER_PRESCRIPTION', denominatorInput: 'INTEGER', numeratorLabel: 'Total item obat dari resep sampel yang sama', denominatorLabel: 'Jumlah resep sampel yang sama', scoring: { kind: 'BANDS', bands: [...literal([[0, 2.6, 100], [2.7, 4, 75], [5, 7, 50], [8, 9, 25]]), { min: 9, max: null, minInclusive: false, maxInclusive: false, score: 0 }] } },
  'K1-R8': document,
  'K5-R45': document,
  'K5-R19': checklist(2),
  'K5-R33': checklist(4),
  'K5-R34': checklist(5, 60),
  'K5-R35': checklist(108, 50),
  'K1-R12': { ...coverage(80), numeratorLabel: 'Rekomendasi lokmin tribulanan yang sudah ditindaklanjuti', denominatorLabel: 'Rekomendasi yang wajib ditindaklanjuti lintas sektor' },
  'K5-R37': { ...coverage(30), numeratorLabel: 'Hari dilakukan kontrol QC sebelum sampel pasien', denominatorLabel: 'Hari kerja pelayanan laboratorium pada periode yang sama' },
  'K2-R15': { ...coverage(100), denominatorInput: 'ESTIMATED', denominatorFactor: 0.2, numeratorLabel: 'Komplikasi kebidanan yang ditangani sesuai DO', denominatorLabel: 'Jumlah sasaran ibu hamil (D dihitung 20% × bumil)' },
  'K2-R25': { ...coverage(100), denominatorInput: 'ESTIMATED', denominatorFactor: 0.15, numeratorLabel: 'Komplikasi neonatus yang ditangani sesuai DO', denominatorLabel: 'Jumlah kelahiran hidup (D dihitung 15% × lahir hidup)' },
  'K2-R42': { ...coverage(100), denominatorInput: 'ESTIMATED', denominatorFactor: 0.0455, numeratorLabel: 'Balita diare yang ditangani sesuai DO', denominatorLabel: 'Jumlah balita 0–59 bulan (D = 70% × 6,5% × balita)' },
  'K1-R85': { unit: 'COUNT', denominatorInput: 'INTEGER', numeratorLabel: 'Jumlah kelompok Asman berbeda yang berpartisipasi sesuai DO', denominatorLabel: 'Isi 1; jumlah kelompok dibandingkan langsung dengan minimum 3', fixedDenominator: 1, scoring: { kind: 'ATTAINMENT', limit: 3, direction: 'MIN' } },
};
