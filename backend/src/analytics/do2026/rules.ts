export type LiteralBand = {
  readonly min: number; readonly max: number | null;
  readonly minInclusive: boolean; readonly maxInclusive: boolean; readonly score: number;
};
export type DoRule = {
  readonly denominatorInput: 'INTEGER' | 'ESTIMATED';
  readonly unit: 'PERCENT' | 'ITEMS_PER_PRESCRIPTION' | 'COUNT' | 'SCORE';
  readonly numeratorLabel: string; readonly denominatorLabel: string;
  readonly fixedDenominator?: number; readonly denominatorFactor?: number;
  readonly scoring:
    | { readonly kind: 'THRESHOLD'; readonly maximum: number }
    | { readonly kind: 'BANDS'; readonly bands: readonly LiteralBand[] }
    | { readonly kind: 'COVERAGE'; readonly target: number }
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
