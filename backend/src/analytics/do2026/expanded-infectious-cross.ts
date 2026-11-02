import type { ManagementDecision } from './expanded-management';

// Source declarations consumed by source-assessment.ts for validation, execution and registration.
export type InfectiousCrossFormula = {
  readonly operator: 'RATIO_PERCENT';
  readonly numerator: string;
  readonly denominator: string;
  readonly input: 'INTEGER' | 'ESTIMATED';
  readonly numeratorSubset: boolean | 'CONTEXT_REQUIRED';
  readonly denominatorBasis: 'REGISTER' | 'ESTIMATE' | 'INVENTORY' | 'PLAN';
  readonly denominatorDerivation?: 'TB_DETECTION_TARGET_TIMES_FACTORS' | 'REGIONAL_POPULATION_ALLOCATION' | 'INDEX_CASES_TIMES_CONTACT_FACTOR';
  readonly documentedFactors?: readonly number[];
} | {
  readonly operator: 'COMPONENTS_ONLY';
  readonly components: readonly { readonly key: string; readonly label: string; readonly unit: 'SOURCE_UNRESOLVED' | 'COUNT_DOCUMENT' }[];
};

export type InfectiousCrossDecision = Omit<ManagementDecision, 'definitionId' | 'kind' | 'formula' | 'period' | 'target' | 'applicability'> & {
  readonly definitionId: `DO26-K${4 | 5}-R${number}`;
  readonly kind: 'RATIO' | 'ESTIMATED_RATIO' | 'MIXED_GRAIN_RATIO' | 'SNAPSHOT' | 'LONGITUDINAL' | 'COMPOSITE' | 'CHECKLIST';
  readonly formula: InfectiousCrossFormula;
  readonly formulaRaw: string;
  readonly period: 'ANNUAL' | 'MONTH' | 'AS_OF' | 'EXPLICIT_WINDOW' | 'COHORT_WINDOW';
  readonly target: Omit<ManagementDecision['target'], 'comparator' | 'basis'> & {
    readonly comparator: 'MIN' | 'MAX' | 'LT' | 'GT' | 'UNRESOLVED';
    readonly basis: 'TECHNICAL_MINIMUM' | 'LITERAL_MINIMUM' | 'LITERAL_MAXIMUM' | 'UNRESOLVED';
  };
  readonly calculability: 'RATIO_WITH_CONTEXT' | 'SOURCE_BLOCKED' | 'COMPONENTS_ONLY';
  readonly applicability?: 'EXCLUDE_EVIDENCED_NO_KLB' | 'MALARIA_NO_CASE_SCOPE_UNRESOLVED' | 'INPATIENT_SERVICE_REQUIRED' | 'PHYSIOTHERAPIST_AND_ROOM_REQUIRED';
};

export const EXPANDED_INFECTIOUS_CROSS_CONTRACT = {
  version: 'DO_2026_INFECTIOUS_CROSS_SOURCE_V1',
  status: 'PROVISIONAL_SOURCE_DECLARATIONS',
  authority: 'S1_RAW_DEFINITION_CALCULATION_TARGET_NOT_REVIEW_ANNOTATIONS',
  requiredContext: ['periodStart', 'periodEnd', 'territoryReference', 'sourceSnapshotReference', 'verbatimDefinitionReference', 'numeratorEvidenceReference', 'denominatorEvidenceReference', 'eligibilityReference', 'grainReference'],
  contextPolicy: 'Each row also requires all common requiredContext. Counts are finite nonnegative safe integers; derived estimates may be decimal without rounding. Evidence and decisions are attestations, not automatic verification.',
  sourcePolicy: 'formulaRaw preserves F verbatim; criteria also require E, D title, G raw/Excel target and I/J notes. SOURCE_BLOCKED never yields measurement or targetMet; typed components may still be collected. Do not execute raw text.',
  targetPolicy: 'A bare percent target uses a labelled technical minimum, not a performance score. Explicit maximum/strict comparators must never be coerced to MIN. These exact 33 sources contain percent ratios, no per-100000 rate or low-prevalence maximum; do not import either from another row.',
  factorPolicy: 'Percent ratios multiply by 100 only. TB factors 0.54 and 10 and leprosy contact factor 20 derive D, not N or target. Preserve scientific notation numerically without changing magnitude; never infer a population factor or replace D=0.',
  periodPolicy: 'MONTH means an independent month, with year/month and explicit snapshot or ledger; never sum stock, choose December, average percentages or annualize. EXPLICIT_WINDOW/AS_OF require a documented assessment reference, not a guessed annual union. No universal prorata or monthly pooling.',
  grainPolicy: 'Patients, visits, cases, new cases, prescriptions, counselling sessions, tests, repeated laboratory requests and service events are distinct. Require source grain and repeated-outcome reconciliation; no automatic unique-patient annual union or conversion to encounters.',
  exceedPolicy: 'Actual subset requires N<=D. Estimates/plans/mixed grains require reconciliation and exceedReviewReference when N>D; retain uncapped arithmetic, never silently change D or discard N. Mixed-grain percent is not patient coverage.',
  zeroPolicy: 'D must be positive for division. N=0 with D>0 is valid zero. Missing, D=0, not due and non-applicable differ. Only evidenced no-KLB exclusion is explicit here; malaria exclusion is unresolved. No 0/0=100 or inherited pasung exception.',
  scoringPolicy: 'No numeric performance score inferred. All results remain provisional, assessmentComplete=false; components-only and source-blocked rows have null targetMet. Collection does not mean all 33 formulas are executable.',
} as const;

export const EXPANDED_INFECTIOUS_CROSS_DECISIONS = {
  'K4-R12': {
    definitionId: 'DO26-K4-R11', sourceRef: 'S1:KLASTER 4!A11:J11', kind: 'RATIO', readiness: 'CONTEXT_REQUIRED', calculability: 'RATIO_WITH_CONTEXT',
    formula: { operator: 'RATIO_PERCENT', numerator: 'Kejadian KLB direspon lengkap sesuai standar dalam <=7 hari', denominator: 'Seluruh kejadian KLB/Wabah wilayah Puskesmas pada periode sama', input: 'INTEGER', numeratorSubset: true, denominatorBasis: 'REGISTER' },
    formulaRaw: 'Jumlah kejadian KLB yang dilakukan respon awal sesuai standart dalam waktu  \u2264 7hari dibagi Jumlah kejadian KLB/Wabah di wilayah puskesmas dikali 100%\n\nKeterangan :\nTidak dihitung  sebagai indikator pembagi bila tidak ada KLB',
    target: { raw: 0.55, excelNumberFormat: '0%', value: 55, unit: 'PERCENT', comparator: 'MIN', basis: 'TECHNICAL_MINIMUM' }, period: 'EXPLICIT_WINDOW', applicability: 'EXCLUDE_EVIDENCED_NO_KLB',
    criteria: ['Satu kejadian, bukan alert/kunjungan; ketujuh unsur E11 wajib: inisiasi TGC, PE lengkap, laboratorium, tatalaksana, pengendalian risiko, komunikasi risiko/masyarakat, koordinasi/advokasi.', 'Tepat tujuh hari memenuhi; tanggal awal dan pemenuhan paket harus tertaut. Tidak ada KLB hanya dikecualikan dengan register nihil lengkap dan bukti, bukan skor 100.'],
    thresholds: { maximumResponseDaysInclusive: 7, requiredComponents: 7 }, requiredContext: ['klbEventRegister', 'onsetAndResponseDates', 'sevenComponentEvidence', 'completeNoKlbEvidence', 'crossBoundaryObservationReference'], unresolved: [],
  },
  'K4-R14': {
    definitionId: 'DO26-K4-R13', sourceRef: 'S1:KLASTER 4!A13:J13', kind: 'ESTIMATED_RATIO', readiness: 'CONTEXT_REQUIRED', calculability: 'RATIO_WITH_CONTEXT',
    formula: { operator: 'RATIO_PERCENT', numerator: 'Orang terduga dari skrining TBC mendapat pelayanan sesuai standar setahun', denominator: 'Target penemuan Puskesmas x 0.54 x 10', input: 'ESTIMATED', numeratorSubset: false, denominatorBasis: 'ESTIMATE', denominatorDerivation: 'TB_DETECTION_TARGET_TIMES_FACTORS', documentedFactors: [0.54, 10] },
    formulaRaw: 'Jumlah orang terduga TBC (yang didapatkan dari skrining TBC) mendapatkan pelayanan TBC sesuai standar di fasyankes dalam kurun waktu satu tahun dibagi Jumlah perkiraan (estimasi) orang terduga TBC dalam kurun waktu satu tahun dikali 100% \n\nKeterangan:\nPerhitungan estimasi orang terduga TBC di wilayah puskesmas = target penemuan puskesmas  x 54% x 10',
    target: { raw: 1, excelNumberFormat: '0%', value: 100, unit: 'PERCENT', comparator: 'MIN', basis: 'TECHNICAL_MINIMUM' }, period: 'ANNUAL',
    criteria: ['Orang, bukan jumlah skrining/tes; pemeriksaan klinis minimal sekali setahun, penunjang, edukasi risiko/pencegahan, rujukan jika perlu dan etika batuk.', 'D estimasi bukan terduga aktual; target penemuan sumber harus satu tahun/wilayah. D pecahan dan N>D tidak dipotong atau dibulatkan.'],
    requiredContext: ['year', 'detectionTargetReference', 'detectionTargetValue', 'estimationYearAndTerritory', 'distinctSuspectServiceRegister', 'fiveServiceCriteriaEvidence', 'exceedReviewReference'], unresolved: [],
  },
  'K4-R15': {
    definitionId: 'DO26-K4-R14', sourceRef: 'S1:KLASTER 4!A14:J14', kind: 'ESTIMATED_RATIO', readiness: 'CONTEXT_REQUIRED', calculability: 'RATIO_WITH_CONTEXT',
    formula: { operator: 'RATIO_PERCENT', numerator: 'Kasus TBC ditemukan, dicatat dan dilaporkan', denominator: 'Penduduk Puskesmas / penduduk kab-kota x estimasi kasus TBC kab-kota', input: 'ESTIMATED', numeratorSubset: false, denominatorBasis: 'ESTIMATE', denominatorDerivation: 'REGIONAL_POPULATION_ALLOCATION' },
    formulaRaw: 'Jumlah kasus TBC yang ditemukan, dicatat dan dilaporkan dibagi target penemuan kasus TBC di wilayah puskesmas dikali 100%_x000b__x000b_Keterangan: \ntarget penemuan kasus TBC di wilayah puskesmas adalah jumlah penduduk di wilayah puskesmas  dibagi jumlah penduduk kab/kota dikali estimasi kasus TBC di kab/kota',
    target: { raw: 0.9, excelNumberFormat: '0%', value: 90, unit: 'PERCENT', comparator: 'MIN', basis: 'TECHNICAL_MINIMUM' }, period: 'EXPLICIT_WINDOW',
    criteria: ['Ketiga status ditemukan/dicatat/dilaporkan tertaut pada kasus sama; bukan jumlah notifikasi ulang atau hanya keberhasilan pengobatan.', 'Penduduk kab-kota positif; alokasi memakai versi/tahun populasi dan estimasi sama. Tidak mengalikan D dengan target 90% lagi. F14 tidak membatasi ke kasus baru: jangan menambahkan syarat baru dari kohort kusta.'],
    requiredContext: ['pkmPopulation', 'districtPopulation', 'districtEstimatedTbCases', 'populationAndEstimateVersionReferences', 'allocationPeriodReference', 'caseIdentityAndNotificationRegister', 'exceedReviewReference'], unresolved: [],
  },
  'K4-R19': {
    definitionId: 'DO26-K4-R18', sourceRef: 'S1:KLASTER 4!A18:J18', kind: 'ESTIMATED_RATIO', readiness: 'CONTEXT_REQUIRED', calculability: 'RATIO_WITH_CONTEXT',
    formula: { operator: 'RATIO_PERCENT', numerator: 'Kontak erat diperiksa dan diberi kemoprofilaksis', denominator: 'Jumlah indeks kasus kusta x 20 kontak erat', input: 'ESTIMATED', numeratorSubset: false, denominatorBasis: 'ESTIMATE', denominatorDerivation: 'INDEX_CASES_TIMES_CONTACT_FACTOR', documentedFactors: [20] },
    formulaRaw: 'Jumlah kontak erat yang diberi kemoprofilaksis DIBAGI (jumlah indek kasus x 20 orang kontak erat) DIKALI 100%',
    target: { raw: 0.8, excelNumberFormat: '0%', value: 80, unit: 'PERCENT', comparator: 'MIN', basis: 'TECHNICAL_MINIMUM' }, period: 'EXPLICIT_WINDOW',
    criteria: ['D sasaran estimasi per indeks, bukan semua kontak aktual atau jumlah kasus baru mulai pengobatan pada R20.', 'Tautkan pemeriksaan, kemoprofilaksis dan indeks; satu kontak terkait beberapa indeks perlu aturan pengulangan sumber, bukan union pasien tahunan atau dosis sebagai orang. N boleh melampaui estimasi hanya setelah rekonsiliasi eksplisit.'],
    requiredContext: ['indexCaseRegister', 'indexCount', 'contactToIndexLinks', 'examinationAndProphylaxisEvidence', 'repeatedContactGrainDecisionReference', 'exceedReviewReference'], unresolved: [],
  },
  'K4-R22': {
    definitionId: 'DO26-K4-R21', sourceRef: 'S1:KLASTER 4!A21:J21', kind: 'RATIO', readiness: 'SOURCE_CONFLICT', calculability: 'SOURCE_BLOCKED',
    formula: { operator: 'RATIO_PERCENT', numerator: 'Suspek malaria diperiksa sediaan darah laboratorium', denominator: 'Suspek malaria ditemukan', input: 'INTEGER', numeratorSubset: true, denominatorBasis: 'REGISTER' },
    formulaRaw: 'Jumlah suspek Malaria yang diperiksa SD secara laboratorium dibagi jumlah suspek Malaria yang ditemukan dikali 100%\nCatatan: tidak dihitung sebagai pembagi bila  tidak ada  kasus Malaria',
    target: { raw: 1, excelNumberFormat: '0%', value: 100, unit: 'PERCENT', comparator: 'UNRESOLVED', basis: 'UNRESOLVED' }, period: 'EXPLICIT_WINDOW', applicability: 'MALARIA_NO_CASE_SCOPE_UNRESOLVED',
    criteria: ['Koleksi suspek ditemukan, diperiksa dan kasus positif terpisah. Nol positif tidak membuktikan nol suspek atau seluruh pemeriksaan terpenuhi.'],
    requiredContext: ['suspectRegister', 'bloodSlideTestLinks', 'positiveCaseCount', 'noCaseExclusionScopeDecisionReference'], unresolved: ['F21 mengecualikan bila tidak ada kasus, tetapi rasio memakai suspek. Jangan memilih definisi kasus positif versus suspek atau mewariskan pengecualian ke R23-R25.'],
  },
  'K4-R23': {
    definitionId: 'DO26-K4-R22', sourceRef: 'S1:KLASTER 4!A22:J22', kind: 'MIXED_GRAIN_RATIO', readiness: 'CONTEXT_REQUIRED', calculability: 'RATIO_WITH_CONTEXT',
    formula: { operator: 'RATIO_PERCENT', numerator: 'Penderita malaria terkonfirmasi positif mendapat ACT sesuai Plasmodium/berat badan', denominator: 'Jumlah kasus malaria', input: 'INTEGER', numeratorSubset: 'CONTEXT_REQUIRED', denominatorBasis: 'REGISTER' },
    formulaRaw: 'Jumlah penderita Malaria yang mendapat pengobatan ACT sesuai jenis Plasmodium dibagi jumlah kasus Malaria dikali 100 %',
    target: { raw: 1, excelNumberFormat: '0%', value: 100, unit: 'PERCENT', comparator: 'MIN', basis: 'TECHNICAL_MINIMUM' }, period: 'EXPLICIT_WINDOW',
    criteria: ['E22 mencantumkan ACT/DHP dan primaquin sesuai berat badan/Plasmodium; bukan sekadar pernah menerima obat.', 'N penderita versus D kasus harus direkonsiliasi dengan keputusan grain. Satu pasien dua episode berbeda hasil tidak dijadikan satu pasien pernah sesuai. Jangan menambahkan syarat selesai pengobatan atau pengecualian nihil R22.'],
    requiredContext: ['patientCaseGrainDecisionReference', 'positiveLaboratoryCaseLinks', 'plasmodiumAndWeight', 'treatmentEvidence', 'repeatEpisodeOutcomeReference', 'crossBoundaryReference'], unresolved: [],
  },
  'K4-R24': {
    definitionId: 'DO26-K4-R23', sourceRef: 'S1:KLASTER 4!A23:J23', kind: 'LONGITUDINAL', readiness: 'CONTEXT_REQUIRED', calculability: 'RATIO_WITH_CONTEXT',
    formula: { operator: 'RATIO_PERCENT', numerator: 'Kasus malaria memenuhi follow-up hari 3,7,14,21,28 sampai hasil laboratorium negatif', denominator: 'Seluruh kasus malaria pada kohort asal sama', input: 'INTEGER', numeratorSubset: true, denominatorBasis: 'REGISTER' },
    formulaRaw: 'Jumlah kasus malaria yang telah dilakukan follow up pengobatan pada hari ke 3, 7, 14, 21 dan 28 sampai hasil pemeriksaan laboratoriumnya negatif  dibagi jumlah kasus malaria dikali 100 %',
    target: { raw: 1, excelNumberFormat: '0%', value: 100, unit: 'PERCENT', comparator: 'MIN', basis: 'TECHNICAL_MINIMUM' }, period: 'COHORT_WINDOW',
    criteria: ['Unit kasus, bukan lima kunjungan atau lima tes. Jadwal dan hasil harus tertaut per kasus, termasuk lintas tahun.', 'Perlu referensi kematangan/cut-off dan aturan berhenti saat negatif versus seluruh jadwal; jangan menganggap negatif hari 3 otomatis paket lengkap atau mengisi tes masa depan nol.'],
    thresholds: { followUpDays: [3, 7, 14, 21, 28] }, requiredContext: ['caseCohortReference', 'referenceEventDate', 'followUpDatesAndResults', 'negativeEndpointPolicyReference', 'maturityAndCutoffReference', 'crossYearPolicyReference'], unresolved: [],
  },
  'K4-R25': {
    definitionId: 'DO26-K4-R24', sourceRef: 'S1:KLASTER 4!A24:J24', kind: 'MIXED_GRAIN_RATIO', readiness: 'CONTEXT_REQUIRED', calculability: 'RATIO_WITH_CONTEXT',
    formula: { operator: 'RATIO_PERCENT', numerator: 'Penderita malaria domisili wilayah yang dilakukan PE bulan berjalan', denominator: 'Kasus malaria pada wilayah dan bulan sama', input: 'INTEGER', numeratorSubset: 'CONTEXT_REQUIRED', denominatorBasis: 'REGISTER' },
    formulaRaw: 'Jumlah penderita Malaria yang dilakukan Penyelidikan Epidemiologi dibagi jumlah kasus Malaria dikali 100 %',
    target: { raw: 1, excelNumberFormat: '0%', value: 100, unit: 'PERCENT', comparator: 'MIN', basis: 'TECHNICAL_MINIMUM' }, period: 'MONTH',
    criteria: ['Domisili pasien, bukan lokasi pemeriksaan. Pasien versus kasus/episode memerlukan keputusan grain dan PE berulang; jangan union tahunan atau menjumlah bulan.', 'Tautkan PE ke kasus asal dan bulan berjalan; PE di bulan berbeda perlu keputusan sumber sebelum dipindahkan ke N.'],
    requiredContext: ['year', 'month', 'domicileEvidence', 'patientCaseGrainDecisionReference', 'caseMonthAndPeLinks', 'repeatPeOutcomeReference', 'crossMonthPolicyReference'], unresolved: [],
  },
  'K4-R28': {
    definitionId: 'DO26-K4-R27', sourceRef: 'S1:KLASTER 4!A27:J27', kind: 'RATIO', readiness: 'CONTEXT_REQUIRED', calculability: 'RATIO_WITH_CONTEXT',
    formula: { operator: 'RATIO_PERCENT', numerator: 'Sekolah SMP/SMA sederajat mendapat penyuluhan HIV/AIDS pada bulan lingkup', denominator: 'Seluruh SMP/SMA sederajat wilayah pada bulan lingkup sama', input: 'INTEGER', numeratorSubset: true, denominatorBasis: 'REGISTER' },
    formulaRaw: 'Jumlah  sekolah (SMP dan SMA/sederajat)  yang mendapatkan penyuluhan HIV/AIDS dibagi jumlah seluruh sekolah (SMP dan SMA/sederajat) di wilayah kerja Puskesmas dikali 100%',
    target: { raw: 1, excelNumberFormat: '0%', value: 100, unit: 'PERCENT', comparator: 'MIN', basis: 'TECHNICAL_MINIMUM' }, period: 'MONTH',
    criteria: ['Satu sekolah per lingkup bulan, bukan peserta/sesi; sekolah yang disuluh Januari bukan pemenuhan Februari.', 'Roster dan acuan buka/tutup sekolah harus sesuai bulan sumber; bukan union sekolah pernah dilayani setahun.'],
    requiredContext: ['year', 'month', 'schoolRosterReference', 'schoolOpeningClosureReference', 'schoolCounsellingEvidence'], unresolved: [],
  },
  'K4-R29': {
    definitionId: 'DO26-K4-R28', sourceRef: 'S1:KLASTER 4!A28:J28', kind: 'COMPOSITE', readiness: 'SOURCE_CONFLICT', calculability: 'COMPONENTS_ONLY',
    formula: { operator: 'COMPONENTS_ONLY', components: [{ key: 'epidemiologyOrDetection', label: 'Capaian PE dan/atau penemuan kasus', unit: 'SOURCE_UNRESOLVED' }, { key: 'psn', label: 'Capaian PSN 3M Plus', unit: 'SOURCE_UNRESOLVED' }] },
    formulaRaw: 'Total perhitungan capaian hasil kegiatan penyelidikan epidemiologi & atau penemuan kasus serta capaian hasil PSN 3M Plus *Apabila puskesmas tidak ada laporan kasus Dengue, maka hasilnya melihat dari capaian PSN saja dan tidak dibagi dua',
    target: { raw: 0.8, excelNumberFormat: '0%', value: 80, unit: 'PERCENT', comparator: 'UNRESOLVED', basis: 'UNRESOLVED' }, period: 'EXPLICIT_WINDOW',
    criteria: ['Simpan capaian komponen beserta unit/metode dan status laporan kasus. Tanpa laporan kasus hanya PSN, tidak dibagi dua; bukan otomatis 100.', 'Bahkan cabang PSN memerlukan definisi pengukurannya; tidak mengasumsikan ABJ, mean 50:50 atau satu N/D.'],
    requiredContext: ['dengueCaseReportingStatus', 'caseReportingCompletenessReference', 'peDetectionMethodAndUnitReference', 'psnMethodAndUnitReference', 'compositionDecisionReference'], unresolved: ['N/D komponen, bobot dan penggabungan saat ada kasus tidak ditentukan cukup tegas; koleksi komponen tidak menghasilkan nilai gabungan/targetMet.'],
  },
  'K4-R33': {
    definitionId: 'DO26-K4-R32', sourceRef: 'S1:KLASTER 4!A32:J32', kind: 'SNAPSHOT', readiness: 'CONTEXT_REQUIRED', calculability: 'RATIO_WITH_CONTEXT',
    formula: { operator: 'RATIO_PERCENT', numerator: 'Desa/kelurahan terverifikasi seluruh syarat lima pilar STBM', denominator: 'Desa/kelurahan wilayah dan periode penilaian sama', input: 'INTEGER', numeratorSubset: true, denominatorBasis: 'REGISTER' },
    formulaRaw: 'Jumlah Desa/Kelurahan yang telah terverifikasi 100% SBS, minimal 75% melaksanakan pilar 2,3,4 dan minimal 30% melaksanakan pilar 5 diwilayah dan pada periode tertentu dibagi jumlah desa/kelurahan diwilayah dan pada periode yang sama dikali 100%',
    target: { raw: 0.2, excelNumberFormat: '0%', value: 20, unit: 'PERCENT', comparator: 'MIN', basis: 'TECHNICAL_MINIMUM' }, period: 'AS_OF',
    criteria: ['Pilar 1 SBS 100%; masing-masing pilar 2 CTPS,3 PAMMRT,4 PSRT >=75%; pilar 5 PALDRT >=30%, dibuktikan BA verifikasi.', 'Seluruh pilar/KK pada penilaian sama; bukan mean pilar atau union pernah lulus. As-of adalah kontrak pengamatan eksplisit, bukan penetapan 31 Desember atau hitungan verifikasi baru tahun itu.'],
    thresholds: { pillar1Percent: 100, pillar2To4MinimumPercent: 75, pillar5MinimumPercent: 30 }, requiredContext: ['asOf', 'assessmentBasisDecisionReference', 'villageAndHouseholdRosters', 'fivePillarsSameAssessment', 'verificationMinutesReferences', 'reverificationValidityReference'], unresolved: [],
  },
  'K4-R36': {
    definitionId: 'DO26-K4-R35', sourceRef: 'S1:KLASTER 4!A35:J35', kind: 'RATIO', readiness: 'SOURCE_CONFLICT', calculability: 'SOURCE_BLOCKED',
    formula: { operator: 'RATIO_PERCENT', numerator: 'Desa/kelurahan dibina adaptasi perubahan iklim bidang kesehatan', denominator: 'Seluruh desa/kelurahan yang ada', input: 'INTEGER', numeratorSubset: true, denominatorBasis: 'REGISTER' },
    formulaRaw: 'Jumlah Desa/Kelurahan yang telah dilakukan pembinaan terkait aksi Adaptasi Perubahan Iklim Bidang Kesehatan dibagi jumlah Desa/Kelurahan yang ada dikali 100%',
    target: { raw: 0.2, excelNumberFormat: '0%', value: 20, unit: 'PERCENT', comparator: 'UNRESOLVED', basis: 'UNRESOLVED' }, period: 'EXPLICIT_WINDOW',
    criteria: ['Koleksi desa yang dibina dan roster desa terpisah dari indikator jumlah Puskesmas.'], requiredContext: ['villageRoster', 'climateCoachingEvidence', 'titlePopulationDecisionReference'], unresolved: ['D35 berjudul persentase Puskesmas, E35/F35 menghitung desa/kelurahan; jangan memilih populasi diam-diam.'],
  },
  'K4-R37': {
    definitionId: 'DO26-K4-R36', sourceRef: 'S1:KLASTER 4!A36:J36', kind: 'RATIO', readiness: 'SOURCE_CONFLICT', calculability: 'SOURCE_BLOCKED',
    formula: { operator: 'RATIO_PERCENT', numerator: 'Pasien PBL dikonseling DAN dilakukan intervensi lingkungan', denominator: 'Seluruh pasien PBL wilayah Puskesmas', input: 'INTEGER', numeratorSubset: true, denominatorBasis: 'REGISTER' },
    formulaRaw: 'Jumlah pasien PBL yang dikonseling dan dilakukan intervensi  dibagi dengan jumlah Pasien PBL di wilayah Puskesmas dikali 100 % ',
    target: { raw: 0.2, excelNumberFormat: '0%', value: 20, unit: 'PERCENT', comparator: 'UNRESOLVED', basis: 'UNRESOLVED' }, period: 'EXPLICIT_WINDOW',
    criteria: ['E36: ISPA,TBC,DBD,malaria,chikungunya,flu burung,filariasis,diare,kecacingan,kulit,keracunan makanan/pestisida; kedua layanan harus tertaut, bukan salah satu.', 'Jangan mempersempit D hanya pasien yang dirujuk konseling atau menghitung sesi sebagai pasien.'],
    requiredContext: ['pblPatientRoster', 'counsellingAndEnvironmentInterventionLinks', 'repeatPatientGrainReference', 'titlePopulationDecisionReference'], unresolved: ['D36 berjudul persentase Puskesmas, E36/F36 rasio pasien. Target dan konstruksi belum diselaraskan oleh sumber.'],
  },
  'K5-R8': {
    definitionId: 'DO26-K5-R7', sourceRef: 'S1:LINTAS KLASTER!A7:I7', kind: 'RATIO', readiness: 'CONTEXT_REQUIRED', calculability: 'RATIO_WITH_CONTEXT',
    formula: { operator: 'RATIO_PERCENT', numerator: 'Pasien karies mendapat tatalaksana sesuai indikasi', denominator: 'Seluruh pasien karies berkunjung ke unit gigi', input: 'INTEGER', numeratorSubset: true, denominatorBasis: 'REGISTER' },
    formulaRaw: 'Jumlah pasien yang mendapatkan tata laksana (konseling, edukasi, pengobatan, tindakan klinis, dan rujukan) karies dibagi dengan jumlah total pasien yang menderita karies yang berkunjung ke unit pelayanan gigi Puskesmas dikali 100%',
    target: { raw: 0.8, excelNumberFormat: '0%', value: 80, unit: 'PERCENT', comparator: 'MIN', basis: 'TECHNICAL_MINIMUM' }, period: 'EXPLICIT_WINDOW',
    criteria: ['Seluruh diagnosis E7: K02.0,K02.3,K02.51,K02.61,K02.52,K02.62,K02.53,K02.63,K02.7,K04.01.', 'Tatalaksana konseling/edukasi/obat/tindakan/rujukan sesuai indikasi, bukan memaksakan semua tindakan. Pasien bukan gigi, diagnosis atau kunjungan; hasil kunjungan berbeda tidak dilebur menjadi pernah terlayani.'],
    requiredContext: ['dentalPatientGrainDecisionReference', 'diagnosisToothAndVisitLinks', 'completeE7DiagnosisScope', 'indicatedTreatmentEvidence', 'repeatOutcomeDecisionReference'], unresolved: [],
  },
  'K5-R9': {
    definitionId: 'DO26-K5-R8', sourceRef: 'S1:LINTAS KLASTER!A8:I8', kind: 'RATIO', readiness: 'CONTEXT_REQUIRED', calculability: 'RATIO_WITH_CONTEXT',
    formula: { operator: 'RATIO_PERCENT', numerator: 'Pasien pulpa/periradikuler ditatalaksana sesuai indikasi', denominator: 'Seluruh pasien pulpa/periradikuler berkunjung ke unit gigi', input: 'INTEGER', numeratorSubset: true, denominatorBasis: 'REGISTER' },
    formulaRaw: 'Jumlah pasien yang mendapatkan tatalaksana (konseling, edukasi, pengobatan, tindakan klinis, dan rujukan) penyakit/kelainan pulpa dan periradikuler dibagi dengan jumlah total pasien yang menderita penyakit/kelainan pulpa dan periradikuler yang berkunjung ke unit pelayanan gigi Puskesmas dikali 100%',
    target: { raw: 0.8, excelNumberFormat: '0%', value: 80, unit: 'PERCENT', comparator: 'MIN', basis: 'TECHNICAL_MINIMUM' }, period: 'EXPLICIT_WINDOW',
    criteria: ['E8 lengkap: K04.02,K04.1,K04.2,K04.3,K04.4,K04.5,K04.6,K04.60,K04.61,K04.62,K04.63,K04.7,K04.8,K04.80,K04.81,K04.82; bukan hanya pulpitis atau karies umum.', 'Patient/tooth/diagnosis/visit links dan keputusan pengulangan diperlukan; pelayanan pertama sesuai tidak menutupi pelayanan ulang tidak sesuai.'],
    requiredContext: ['dentalPatientGrainDecisionReference', 'diagnosisToothAndVisitLinks', 'completeE8DiagnosisScope', 'indicatedTreatmentEvidence', 'repeatOutcomeDecisionReference'], unresolved: [],
  },
  'K5-R10': {
    definitionId: 'DO26-K5-R9', sourceRef: 'S1:LINTAS KLASTER!A9:I9', kind: 'RATIO', readiness: 'CONTEXT_REQUIRED', calculability: 'RATIO_WITH_CONTEXT',
    formula: { operator: 'RATIO_PERCENT', numerator: 'Pasien periodontal ditatalaksana sesuai indikasi', denominator: 'Seluruh pasien periodontal berkunjung ke unit gigi', input: 'INTEGER', numeratorSubset: true, denominatorBasis: 'REGISTER' },
    formulaRaw: 'Jumlah pasien penyakit periodontal yang mendapatkan tatalaksana (konseling, edukasi, pengobatan, tindakan klinis, dan rujukan) dibagi dengan jumlah total pasien yang menderita penyakit periodontal yang berkunjung ke unit pelayanan gigi Puskesmas dikali 100%',
    target: { raw: 0.8, excelNumberFormat: '0%', value: 80, unit: 'PERCENT', comparator: 'MIN', basis: 'TECHNICAL_MINIMUM' }, period: 'EXPLICIT_WINDOW',
    criteria: ['Seluruh daftar diagnosis/subkode periodontal E9 wajib dipertahankan, termasuk gingiva, resesi lokal/general dan periodontitis akut/kronis; jangan mengganti dengan semua penyakit gigi.', 'Unit pasien sesuai keputusan sumber, bukan otomatis encounter atau pasien unik tahunan; rekonsiliasi hasil berulang per gigi/diagnosis.'],
    requiredContext: ['dentalPatientGrainDecisionReference', 'diagnosisToothAndVisitLinks', 'completeE9DiagnosisScope', 'indicatedTreatmentEvidence', 'repeatOutcomeDecisionReference'], unresolved: [],
  },
  'K5-R12': {
    definitionId: 'DO26-K5-R11', sourceRef: 'S1:LINTAS KLASTER!A11:I11', kind: 'RATIO', readiness: 'CONTEXT_REQUIRED', calculability: 'RATIO_WITH_CONTEXT',
    formula: { operator: 'RATIO_PERCENT', numerator: 'Pasien UGD ditangani segera, tepat dan sesuai PPK KMK1936/2022', denominator: 'Seluruh pasien masuk UGD', input: 'INTEGER', numeratorSubset: true, denominatorBasis: 'REGISTER' },
    formulaRaw: 'Jumlah pasien yang masuk Ruang Pelayanan Gawat Darurat yang mendapatkan pelayanan sesuai tatalaksana Kegawatdaruratan dengan penanganan segera yang tepat dan sesuai dengan PPK (KMK 1936/2022) / Jumlah total pasien yang masuk Ruang Pelayanan Gawat Darurat dikali 100%',
    target: { raw: 1, excelNumberFormat: '0%', value: 100, unit: 'PERCENT', comparator: 'MIN', basis: 'TECHNICAL_MINIMUM' }, period: 'EXPLICIT_WINDOW',
    criteria: ['Tidak menyamakan pelayanan sesuai PPK dengan hanya waktu tanggap R15. Tautkan diagnosis dan bukti penanganan.', 'Keputusan pasien versus kedatangan/episode dan hasil berulang wajib; deduplikasi tidak boleh menghapus kedatangan tidak sesuai.'],
    requiredContext: ['ugdPatientGrainDecisionReference', 'completeAdmissionRegister', 'ppkVersionReference', 'treatmentEvidence', 'repeatOutcomeDecisionReference'], unresolved: [],
  },
  'K5-R13': {
    definitionId: 'DO26-K5-R12', sourceRef: 'S1:LINTAS KLASTER!A12:I12', kind: 'SNAPSHOT', readiness: 'SOURCE_CONFLICT', calculability: 'SOURCE_BLOCKED',
    formula: { operator: 'RATIO_PERCENT', numerator: 'Dokter umum UGD bersertifikat GELS, ATLS dan ACLS sesuai F12', denominator: 'Seluruh dokter umum bertugas UGD', input: 'INTEGER', numeratorSubset: true, denominatorBasis: 'REGISTER' },
    formulaRaw: 'Jumlah dokter umum yang bertugas di Ruang Pelayanan Gawat Darurat mempunyai sertifikat GELS, ATLS dan ACLS dibagi jumlah dokter umum yang bertugas di Ruang Pelayanan Gawat Darurat dikali 100%',
    target: { raw: 1, excelNumberFormat: '0%', value: 100, unit: 'PERCENT', comparator: 'UNRESOLVED', basis: 'UNRESOLVED' }, period: 'AS_OF',
    criteria: ['E12 juga mensyaratkan SIP di Puskesmas dan sertifikat masih berlaku. Identitas dokter berbeda, bukan jumlah sertifikat atau union pegawai sepanjang tahun.'],
    requiredContext: ['asOf', 'ugdDoctorAssignmentRoster', 'sipAndCertificateValidity', 'certificateConjunctionOrAlternativeDecisionReference'], unresolved: ['E12 diantaranya GELS/ATLS/ACLS versus F12 dan: alternatif/konjungsi dan kesetaraan belum ditetapkan.'],
  },
  'K5-R14': {
    definitionId: 'DO26-K5-R13', sourceRef: 'S1:LINTAS KLASTER!A13:I13', kind: 'SNAPSHOT', readiness: 'SOURCE_CONFLICT', calculability: 'SOURCE_BLOCKED',
    formula: { operator: 'RATIO_PERCENT', numerator: 'Perawat UGD bersertifikat BLS, BCLS dan BTLS sesuai F13', denominator: 'Seluruh perawat bertugas UGD', input: 'INTEGER', numeratorSubset: true, denominatorBasis: 'REGISTER' },
    formulaRaw: 'Jumlah perawat yang bertugas di Ruang Pelayanan Gawat Darurat mempunyai sertifikat BLS, BCLS dan BTLS dibagi jumlah perawat yang bertugas di Ruang Pelayanan Gawat Darurat dikali 100%',
    target: { raw: 1, excelNumberFormat: '0%', value: 100, unit: 'PERCENT', comparator: 'UNRESOLVED', basis: 'UNRESOLVED' }, period: 'AS_OF',
    criteria: ['E13 Emergency Nursing BLS/BCLS/BTLS/dll, bukan daftar tertutup tiga sertifikat yang boleh diputuskan dari kode. Roster penugasan dan bukti berlaku pada acuan sama.'],
    requiredContext: ['asOf', 'ugdNurseAssignmentRoster', 'certificateValidityReferences', 'certificateConjunctionOrAlternativeDecisionReference'], unresolved: ['E13 daftar contoh/dll versus F13 dan; kesetaraan dan konjungsi belum ditetapkan.'],
  },
  'K5-R15': {
    definitionId: 'DO26-K5-R14', sourceRef: 'S1:LINTAS KLASTER!A14:I14', kind: 'RATIO', readiness: 'CONTEXT_REQUIRED', calculability: 'RATIO_WITH_CONTEXT',
    formula: { operator: 'RATIO_PERCENT', numerator: 'Pasien UGD mendapat penanganan medis awal <30 menit sejak tiba di depan pintu', denominator: 'Seluruh pasien UGD', input: 'INTEGER', numeratorSubset: true, denominatorBasis: 'REGISTER' },
    formulaRaw: 'Jumlah pasien Ruang Pelayanan Gawat Darurat yang ditangani dengan respon time < 30 menit dibagi jumlah pasien Ruang Pelayanan Gawat Darurat dikali 100%',
    target: { raw: 0.8, excelNumberFormat: '0%', value: 80, unit: 'PERCENT', comparator: 'MIN', basis: 'TECHNICAL_MINIMUM' }, period: 'EXPLICIT_WINDOW',
    criteria: ['Mulai tiba di pintu UGD, bukan triase/registrasi; akhir penanganan medis awal, bukan selesai layanan. Tepat 30 menit tidak memenuhi.', 'Pasien versus kedatangan harus diputuskan; timestamp hilang bukan tepat waktu atau alasan mengurangi D. Hasil ulang terlambat tidak ditutupi pernah tepat waktu.'],
    thresholds: { responseMinutesExclusive: 30 }, requiredContext: ['ugdPatientGrainDecisionReference', 'doorArrivalAndInitialMedicalTimestamps', 'completeAdmissionRegister', 'missingTimestampReference', 'repeatOutcomeDecisionReference'], unresolved: [],
  },
  'K5-R16': {
    definitionId: 'DO26-K5-R15', sourceRef: 'S1:LINTAS KLASTER!A15:I15', kind: 'COMPOSITE', readiness: 'SOURCE_CONFLICT', calculability: 'SOURCE_BLOCKED',
    formula: { operator: 'RATIO_PERCENT', numerator: 'Pasien rujukan diperiksa, distabilisasi dan dipastikan diterima FKRTL sesuai standar', denominator: 'Seluruh pasien masuk UGD yang dirujuk', input: 'INTEGER', numeratorSubset: true, denominatorBasis: 'REGISTER' },
    formulaRaw: 'Jumlah pasien gawat darurat yang perlu dirujuk ke FKRTL diperiksa dan distabilisasi terlebih dahulu sesuai dengan kemampuan Puskesmas dan dipastikan dapat diterima di FKRTL (SISRUTE) sesuai dengan kebijakan, pedoman dan prosedur yang ditetapkan / Jumlah total pasien yang masuk UGD yang di rujuk x 100%\n\nPasien gawat darurat dirujuk tidak diinput melalui SISRUTE = 0\nPasien gawat darurat dirujuk diinput melalui SISRUTE <30 % = 30 \nPasien gawat darurat dirujuk diinput melalui SISRUTE <30 - 80 % = 80 \nPasien gawat darurat dirujuk diinput melalui SISRUTE >80 % = 100 ',
    target: { raw: 0.3, excelNumberFormat: '0%', value: 30, unit: 'PERCENT', comparator: 'UNRESOLVED', basis: 'UNRESOLVED' }, period: 'EXPLICIT_WINDOW',
    criteria: ['Koleksi paket klinis dan penggunaan SISRUTE terpisah. Rujukan harus terhubung stabilisasi/penerimaan; unggah SISRUTE saja bukan paket lengkap.'],
    requiredContext: ['referralPatientGrainReference', 'referralRoster', 'stabilizationAndAcceptanceEvidence', 'sisruteEntryLinks', 'sisruteRubricDecisionReference'], unresolved: ['Rentang literal <30 - 80% dan batas 30/80 tidak tegas; tidak memilih skor 0/30/80/100 atau MIN30 sebagai fallback target klinis.'],
  },
  'K5-R17': {
    definitionId: 'DO26-K5-R16', sourceRef: 'S1:LINTAS KLASTER!A16:I16', kind: 'MIXED_GRAIN_RATIO', readiness: 'SOURCE_CONFLICT', calculability: 'SOURCE_BLOCKED',
    formula: { operator: 'RATIO_PERCENT', numerator: 'Informed consent pasien UGD diisi lengkap', denominator: 'Seluruh pasien masuk pelayanan gawat darurat', input: 'INTEGER', numeratorSubset: 'CONTEXT_REQUIRED', denominatorBasis: 'REGISTER' },
    formulaRaw: 'Jumlah informed consent pasien UGD yang diisi lengkap dibagi jumlah pasien yang masuk pelayanan gawat darurat dikali 100%',
    target: { raw: 1, excelNumberFormat: '0%', value: 100, unit: 'PERCENT', comparator: 'UNRESOLVED', basis: 'UNRESOLVED' }, period: 'EXPLICIT_WINDOW',
    criteria: ['Identitas; diagnosis/tata cara, tujuan, alternatif/risiko, komplikasi, prognosis, biaya; tanda tangan saksi dan pemberi layanan.', 'D seluruh pasien UGD, bukan hanya pasien dengan indikasi consent. Form ganda tidak otomatis beberapa pasien.'],
    requiredContext: ['completeUgdPatientRoster', 'consentToPatientLinks', 'consentCompletenessChecklist', 'formPatientGrainDecisionReference', 'twentyFourHourOriginAndEndpointDecisionReference'], unresolved: ['Judul D16 menyebut 24 jam tanpa awal/akhir; F16 form versus pasien belum menetapkan paket/kardinalitas. Jangan mengarang jendela 24 jam atau mengubah D.'],
  },
  'K5-R20': {
    definitionId: 'DO26-K5-R19', sourceRef: 'S1:LINTAS KLASTER!A19:I19', kind: 'SNAPSHOT', readiness: 'CONTEXT_REQUIRED', calculability: 'RATIO_WITH_CONTEXT',
    formula: { operator: 'RATIO_PERCENT', numerator: 'Sarana/prasarana farmasi tersedia sesuai inventaris wajib', denominator: 'Sarana/prasarana pelayanan farmasi standar pada versi/acuan sama', input: 'INTEGER', numeratorSubset: true, denominatorBasis: 'INVENTORY' },
    formulaRaw: 'jumlah sarana prasarana yang dimiliki dibagi jumlah sarana prasarana pelayanan kefarmasian standar dikali 100%',
    target: { raw: 0.8, excelNumberFormat: '0%', value: 80, unit: 'PERCENT', comparator: 'MIN', basis: 'TECHNICAL_MINIMUM' }, period: 'AS_OF',
    criteria: ['E19 menyebut pallet,rak,lemari obat/narkotika-psikotropika,lemari es,APAR,pengatur suhu,thermohigrometer,kartu stok dan sarana farmasi klinik. Contoh bukan D tetap.', 'I19 merujuk PMK43/2019 yang dicabut; wajib rujukan standar/keberlakuan untuk 2026, tidak mengganti daftar diam-diam.'],
    requiredContext: ['asOf', 'standardVersionAndApplicabilityReference', 'requiredItemInventoryAndQuantities', 'itemGrainReference', 'availabilityEvidence'], unresolved: [],
  },
  'K5-R22': {
    definitionId: 'DO26-K5-R21', sourceRef: 'S1:LINTAS KLASTER!A21:I21', kind: 'SNAPSHOT', readiness: 'CONTEXT_REQUIRED', calculability: 'RATIO_WITH_CONTEXT',
    formula: { operator: 'RATIO_PERCENT', numerator: 'Item obat tersedia yang sesuai Fornas FKTP', denominator: 'Seluruh item obat tersedia di Puskesmas pada snapshot bulan sama', input: 'INTEGER', numeratorSubset: true, denominatorBasis: 'INVENTORY' },
    formulaRaw: 'Jumlah obat yang sesuai dengan formularium nasional dibagi total jumlah obat yang tersedia di puskesmas dikali 100%',
    target: { raw: 0.8, excelNumberFormat: '0%', value: 80, unit: 'PERCENT', comparator: 'MIN', basis: 'TECHNICAL_MINIMUM' }, period: 'MONTH',
    criteria: ['Evaluasi setiap bulan sesuai E21; tahun/bulan, waktu snapshot dan versi Fornas FKTP wajib.', 'Unit item obat, bukan tablet/merek/nominal stok tanpa keputusan item. D seluruh item tersedia, bukan seluruh daftar Fornas. Januari 80% dan Februari 100% tidak menjadi tahunan 90% atau dipilih Desember.'],
    requiredContext: ['year', 'month', 'asOf', 'monthlySnapshotMethodReference', 'fornasVersionReference', 'availableDrugItemInventory', 'drugItemGrainReference', 'matchingEvidence'], unresolved: [],
  },
  'K5-R27': {
    definitionId: 'DO26-K5-R26', sourceRef: 'S1:LINTAS KLASTER!A26:I26', kind: 'MIXED_GRAIN_RATIO', readiness: 'SOURCE_CONFLICT', calculability: 'SOURCE_BLOCKED',
    formula: { operator: 'RATIO_PERCENT', numerator: 'Kegiatan pengkajian resep, pelayanan resep dan informasi obat terdokumentasi', denominator: 'Seluruh resep masuk bulan sama', input: 'INTEGER', numeratorSubset: false, denominatorBasis: 'REGISTER' },
    formulaRaw: 'Jumlah kegiatan pengkajian resep ,pelayanan resep dan pemberian informasi obat yang terdokumentasi dibagi jumlah resep yang masuk setiap bulan dikali 100%.',
    target: { raw: 0.8, excelNumberFormat: '0%', value: 80, unit: 'PERCENT', comparator: 'UNRESOLVED', basis: 'UNRESOLVED' }, period: 'MONTH',
    criteria: ['Koleksi ketiga kegiatan dan tautan resep; bukan otomatis satu paket lengkap per resep atau tiga kegiatan yang dibagi D resep sebagai cakupan.', 'Resep ulang baru tidak disamakan dengan salinan catatan resep sama; pasien bukan denominator resep.'],
    requiredContext: ['year', 'month', 'prescriptionRegister', 'threeActivityToPrescriptionLinks', 'activityVersusBundleDecisionReference', 'repeatedPrescriptionReference'], unresolved: ['E26/F26 kegiatan versus resep belum menentukan satu paket atau beberapa kegiatan; N>D tidak boleh disembunyikan dengan subset/deduplikasi buatan.'],
  },
  'K5-R28': {
    definitionId: 'DO26-K5-R27', sourceRef: 'S1:LINTAS KLASTER!A27:I27', kind: 'MIXED_GRAIN_RATIO', readiness: 'SOURCE_CONFLICT', calculability: 'SOURCE_BLOCKED',
    formula: { operator: 'RATIO_PERCENT', numerator: 'Sesi konseling pasien kronis terdokumentasi di dalam/luar gedung', denominator: 'Pasien kronis DM/HT/TB/HIV-AIDS/ODGJ', input: 'INTEGER', numeratorSubset: false, denominatorBasis: 'REGISTER' },
    formulaRaw: 'Jumlah konseling yang dilakukan pada pasien kronis ( penderita DM/Hipertensi/TB/ HIV/AIDS/ ODGJ) yang terdokumentasi dibagi jumlah pasien kronis( penderita DM/ Hipertensi/TB/ HIV/AIDS/ ODGJ) dikali 100%',
    target: { raw: 0.05, excelNumberFormat: '0%', value: 5, unit: 'PERCENT', comparator: 'UNRESOLVED', basis: 'UNRESOLVED' }, period: 'EXPLICIT_WINDOW',
    criteria: ['I27 meminta penetapan pasien konseling terlebih dahulu; simpan roster terpilih serta seluruh pasien kronis terpisah.', 'Sesi bukan pasien unik. Lintas diagnosis, kunjungan rumah dan konseling berulang tidak boleh diberi bobot orang tanpa keputusan.'],
    requiredContext: ['allChronicPatientRoster', 'preselectedCounsellingRoster', 'sessionToPatientAndDiagnosisLinks', 'sessionPatientDenominatorDecisionReference', 'repeatCounsellingReference'], unresolved: ['D seluruh pasien versus pasien ditetapkan serta N sesi versus pasien belum selaras; target 5% tidak menyelesaikan grain.'],
  },
  'K5-R29': {
    definitionId: 'DO26-K5-R28', sourceRef: 'S1:LINTAS KLASTER!A28:I28', kind: 'COMPOSITE', readiness: 'MEASUREMENT_ONLY', calculability: 'RATIO_WITH_CONTEXT',
    formula: { operator: 'RATIO_PERCENT', numerator: 'Pelayanan informasi obat terdokumentasi', denominator: 'Kegiatan pelayanan informasi obat direncanakan', input: 'INTEGER', numeratorSubset: false, denominatorBasis: 'PLAN' },
    formulaRaw: 'Jumlah pelayanan informasi obat yang terdokumentasi dibagi dengan jumlah kegiatan pelayanan informasi obat (Kegiatan menyebarkan informasi dan edukasi kepada pasien secara proaktif dan pasir; menjawab pertanyaan dari pasien maupun tenaga kesehatan; membuat buletin, leaflet, label obat, poster, majalah dinding; melakukan kegiatan penyuluhan; melakukan pendidikan dan/atau pelatihan bagi tenaga kefarmasian dan tenaga kesehatan lainnya terkait obat; serta melakukan penelitian penggunaan obat) yang direncanakan dikali 100%',
    target: { raw: 0.8, excelNumberFormat: '0%', value: 80, unit: 'PERCENT', comparator: 'UNRESOLVED', basis: 'UNRESOLVED' }, period: 'ANNUAL',
    criteria: ['E28 pelayanan oleh Apoteker: informasi akurat,jelas,terkini untuk profesi/pasien/pihak luar; lingkup kegiatan F28 harus dipetakan ke rencana.', 'I28 target minimal 12 kegiatan setahun wajib dicatat terpisah. D rencana bukan otomatis 12, tambahan realisasi tidak dipotong, rencana tidak dikurangi setelah pelaksanaan.'],
    thresholds: { minimumAnnualActivities: 12 }, requiredContext: ['year', 'plannedActivityRosterAndVersion', 'documentedActivityRegister', 'pharmacistEvidence', 'minimumTwelveActivityEvidence', 'minimumAndRatioDecisionReference', 'exceedReviewReference'], unresolved: ['Pengukuran rasio dapat dicatat tetapi kombinasi target80% dan minimum12 belum menetapkan targetMet tunggal; tanpa keputusan tetap null.'],
  },
  'K5-R36': {
    definitionId: 'DO26-K5-R35', sourceRef: 'S1:LINTAS KLASTER!A35:I35', kind: 'RATIO', readiness: 'CONTEXT_REQUIRED', calculability: 'RATIO_WITH_CONTEXT',
    formula: { operator: 'RATIO_PERCENT', numerator: 'Pasien menerima hasil diekspertisi dalam waktu sesuai jenis pemeriksaan/kebijakan', denominator: 'Seluruh pasien diperiksa laboratorium', input: 'INTEGER', numeratorSubset: true, denominatorBasis: 'REGISTER' },
    formulaRaw: 'Jumlah pasien dengan waktu tunggu penyerahan hasil pelayanan laboratorium sesuai jenis pemeriksaan dan kebijakan dibagi jumlah seluruh pasien yang diperiksa dikali 100%',
    target: { raw: 1, excelNumberFormat: '0%', value: 100, unit: 'PERCENT', comparator: 'MIN', basis: 'TECHNICAL_MINIMUM' }, period: 'EXPLICIT_WINDOW',
    criteria: ['Awal sampel diambil, akhir pasien menerima hasil yang sudah diekspertisi; waktu validasi alat saja bukan penyerahan.', 'Batas lokal per jenis, operator dan versi masa berlaku wajib; tidak mengarang ambang30/60 menit. Pasien bukan jumlah tes/panel/permintaan ulang. Keputusan saat satu pasien beberapa tes/permintaan berbeda hasil wajib; tidak otomatis semua, pertama, terakhir atau pernah tepat waktu.'],
    requiredContext: ['laboratoryPatientGrainDecisionReference', 'completePatientAndRequestRegister', 'patientTestAndRepeatedRequestLinks', 'testSpecificWaitPolicyWithOperators', 'policyVersionAndValidityReference', 'sampleExpertiseAndReceiptTimestamps', 'multipleResultOutcomeDecisionReference'], unresolved: [],
  },
  'K5-R40': {
    definitionId: 'DO26-K5-R39', sourceRef: 'S1:LINTAS KLASTER!A39:I39', kind: 'RATIO', readiness: 'CONTEXT_REQUIRED', calculability: 'RATIO_WITH_CONTEXT',
    formula: { operator: 'RATIO_PERCENT', numerator: 'Pasien rawat inap dilayani sesuai SOP/standar dan bukti pelaksanaan', denominator: 'Seluruh pasien rawat inap', input: 'INTEGER', numeratorSubset: true, denominatorBasis: 'REGISTER' },
    formulaRaw: 'Jumlah pasien rawat inap yang diberikan pelayanan sesuai standar/ Jumlah Total pasien Rawat Inap dikali 100%',
    target: { raw: 1, excelNumberFormat: '0%', value: 100, unit: 'PERCENT', comparator: 'MIN', basis: 'TECHNICAL_MINIMUM' }, period: 'EXPLICIT_WINDOW', applicability: 'INPATIENT_SERVICE_REQUIRED',
    criteria: ['Termasuk gawat darurat,rujukan klaster,observasi diagnostik/rujukan,pasca persalinan,perawatan tuntas/sementara stabilisasi sesuai E39.', 'Gate penyelenggaraan rawat inap terstruktur sebelum rasio; tidak menyelenggarakan berbeda dari nol pasien/missing. Pasien, admission, patient-days tidak dipertukarkan; hasil readmission perlu keputusan.'],
    requiredContext: ['inpatientApplicabilityAndServiceReference', 'inpatientPatientGrainDecisionReference', 'admissionDischargeAndRepeatLinks', 'completeInpatientRegister', 'sopAndServiceStandardVersion', 'patientServiceEvidence'], unresolved: [],
  },
  'K5-R41': {
    definitionId: 'DO26-K5-R40', sourceRef: 'S1:LINTAS KLASTER!A40:I40', kind: 'CHECKLIST', readiness: 'CONTEXT_REQUIRED', calculability: 'RATIO_WITH_CONTEXT',
    formula: { operator: 'RATIO_PERCENT', numerator: 'Dokumen perencanaan,pelaksanaan,pencatatan,pelaporan dibuat lengkap', denominator: 'Seluruh dokumen wajib sesuai Panduan Ruang Rawat Inap', input: 'INTEGER', numeratorSubset: true, denominatorBasis: 'INVENTORY' },
    formulaRaw: 'Jumlah dokumen perencanaan, pelaksanaan kegiatan,  pencatatan dan pelaporan yang dibuat lengkap dibagi jumlah dokumen sesuai Panduan Ruang Rawat Inap dikali 100%',
    target: { raw: 1, excelNumberFormat: '0%', value: 100, unit: 'PERCENT', comparator: 'MIN', basis: 'TECHNICAL_MINIMUM' }, period: 'AS_OF', applicability: 'INPATIENT_SERVICE_REQUIRED',
    criteria: ['Panduan versi berlaku menetapkan jenis,jumlah dan lingkup per pasien/periode; empat kelompok bukan D=4.', 'E40 juga pelaksanaan evaluasi dan rekam medis tiap pasien; satu panduan/dokumen berulang tidak menggantikan seluruh kewajiban.'],
    requiredContext: ['asOf', 'inpatientApplicabilityAndServiceReference', 'inpatientGuideVersionReference', 'requiredDocumentInventoryAndQuantities', 'perPatientDocumentObligations', 'documentCompletenessEvidence'], unresolved: [],
  },
  'K5-R42': {
    definitionId: 'DO26-K5-R41', sourceRef: 'S1:LINTAS KLASTER!A41:I41', kind: 'RATIO', readiness: 'SOURCE_CONFLICT', calculability: 'SOURCE_BLOCKED',
    formula: { operator: 'RATIO_PERCENT', numerator: 'Pasien mengonsumsi obat sesuai perintah dokter rawat inap menurut F41', denominator: 'Seluruh pasien ruang rawat inap', input: 'INTEGER', numeratorSubset: true, denominatorBasis: 'REGISTER' },
    formulaRaw: 'Jumlah pasien yang mengkonsumsi obat sesuai perintah dokter Pelayanan Rawat Inap dibadi jumlah pasien Ruang Pelayanan Rawat Inap dikali 100%.',
    target: { raw: 1, excelNumberFormat: '0%', value: 100, unit: 'PERCENT', comparator: 'UNRESOLVED', basis: 'UNRESOLVED' }, period: 'EXPLICIT_WINDOW', applicability: 'INPATIENT_SERVICE_REQUIRED',
    criteria: ['Simpan bukti rekonsiliasi daftar obat/resep/suplemen herbal dan bukti konsumsi sesuai perintah dokter secara terpisah; bukan konstruk sama.'],
    requiredContext: ['inpatientApplicabilityAndServiceReference', 'completeInpatientRegister', 'medicineReconciliationEvidence', 'medicationConsumptionEvidence', 'reconciliationVersusConsumptionDecisionReference'], unresolved: ['E41/D41 rekonsiliasi pencegahan medication error; F41 kepatuhan konsumsi. Tidak menyebut rasio konsumsi sebagai pengukuran rekonsiliasi.'],
  },
  'K5-R44': {
    definitionId: 'DO26-K5-R43', sourceRef: 'S1:LINTAS KLASTER!A43:I43', kind: 'COMPOSITE', readiness: 'SOURCE_CONFLICT', calculability: 'COMPONENTS_ONLY',
    formula: { operator: 'COMPONENTS_ONLY', components: [{ key: 'skCount', label: 'SK Tim Penanggulangan Bencana/Krisis/TGC berlaku', unit: 'COUNT_DOCUMENT' }, { key: 'sopCount', label: 'SOP penanggulangan bencana/krisis berlaku', unit: 'COUNT_DOCUMENT' }] },
    formulaRaw: 'Jumlah SK Tim Penanggulangan Bencana dan atau krisis kesehatan/ Tim Gerak Cepat (TGC) di Puskesmas serta SOP penanggulangan bencana dan atau krisis kesehatan. \nMempunyai >1 SK dan 1 SOP = 100%',
    target: { raw: 1, excelNumberFormat: '0%', value: 100, unit: 'PERCENT', comparator: 'UNRESOLVED', basis: 'UNRESOLVED' }, period: 'AS_OF',
    criteria: ['Koleksi SK dan SOP berbeda, nomor/versi/keberlakuan pada acuan sama. Tidak menjumlah menjadi N/2 atau otomatis satu paket bernilai100.'],
    requiredContext: ['asOf', 'skAndSopInventory', 'documentValidityReferences', 'minimumSkOperatorDecisionReference'], unresolved: ['E43 sekurang-kurangnya1 SK dan1 SOP versus F43 >1 SK dan1 SOP=100%; tidak memilih >=1 atau >1, tidak mengarang skor ketidaktersediaan.'],
  },
  'K5-R48': {
    definitionId: 'DO26-K5-R47', sourceRef: 'S1:LINTAS KLASTER!A47:I47', kind: 'RATIO', readiness: 'CONTEXT_REQUIRED', calculability: 'RATIO_WITH_CONTEXT',
    formula: { operator: 'RATIO_PERCENT', numerator: 'Pelayanan fisioterapi terdokumentasi dalam rekam medis', denominator: 'Seluruh pelayanan fisioterapi bulan sama', input: 'INTEGER', numeratorSubset: true, denominatorBasis: 'REGISTER' },
    formulaRaw: 'Jumlah pelayanan fisioterapi  yang terdokumentasi dalam rekam medis dibagi jumlah pelayanan fisioterapi setiap bulan dikali 100%.',
    target: { raw: 1, excelNumberFormat: '0%', value: 100, unit: 'PERCENT', comparator: 'MIN', basis: 'TECHNICAL_MINIMUM' }, period: 'MONTH', applicability: 'PHYSIOTHERAPIST_AND_ROOM_REQUIRED',
    criteria: ['E47: tenaga fisioterapis dan ruang dapat digunakan untuk terapi fisik,okupasi,wicara; bukti status layanan/tenaga/ruang wajib, bukan asumsi karena ada N.', 'Unit pelayanan, bukan pasien unik: dua pelayanan pada satu pasien tetap dua kewajiban dokumentasi. Duplikat pencatatan pelayanan sama bukan layanan baru. Tanpa tenaga/ruang tidak otomatis N/A atau 100%.'],
    requiredContext: ['year', 'month', 'physiotherapyApplicabilityReference', 'physiotherapistAssignmentAndQualification', 'physicalOccupationalSpeechRoomEvidence', 'completeServiceEventRegister', 'medicalRecordServiceLinks'], unresolved: [],
  },
} as const satisfies Readonly<Record<string, InfectiousCrossDecision>>;
