import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import type { PeriodRecap } from '@prisma/client';
import type { Actor } from '../src/core/auth.decorators';
import type { DbService } from '../src/core/db.service';
import type { SavePeriodRecapDto } from '../src/recaps/recaps.dto';
import { RecapsService } from '../src/recaps/recaps.service';
import { scoreMonthlyInput } from '../src/operations/monthly-scoring';
import { evaluateDoPeriod } from '../src/analytics/do2026/period';
import { cumulativePolicy, evaluateDoCumulative } from '../src/analytics/do2026/cumulative';
import { validateDoInput } from '../src/analytics/do2026/input-validation';
import { DO_SOURCE_HASH, getDoProfile } from '../src/analytics/do2026/profiles';
import { DO_RULES } from '../src/analytics/do2026/rules';
import { DO_REVIEW_HOLDS } from '../src/analytics/do2026/review-holds';
import { MANAGEMENT_HOLDS, MANAGEMENT_RULES } from '../src/analytics/do2026/reviewed-management';
import { CLINICAL_HOLDS, CLINICAL_RULES } from '../src/analytics/do2026/reviewed-clinical';
import { INFECTIOUS_CROSS_HOLDS, INFECTIOUS_CROSS_RULES } from '../src/analytics/do2026/reviewed-infectious-cross';
import { DO_SCORING_VERSION, scoreDo2026 } from '../src/analytics/do2026/scorer';
import source from '../src/analytics/do2026/source.json';

// These are pre-review identities and literal regression expectations, not scorer snapshots.
const oldIds = [
  'K1-R8', 'K1-R12', 'K1-R85', 'K2-R15', 'K2-R25', 'K2-R42', 'K2-R50', 'K2-R51',
  'K2-R52', 'K2-R75', 'K3-R38', 'K3-R40', 'K3-R41', 'K5-R19', 'K5-R23', 'K5-R24',
  'K5-R25', 'K5-R26', 'K5-R33', 'K5-R34', 'K5-R35', 'K5-R37', 'K5-R45',
] as const;
const ruleChunks = [MANAGEMENT_RULES, CLINICAL_RULES, INFECTIOUS_CROSS_RULES];
const holdChunks = [MANAGEMENT_HOLDS, CLINICAL_HOLDS, INFECTIOUS_CROSS_HOLDS];
const reviewedEntries = ruleChunks.flatMap(chunk => Object.entries(chunk));
const structuredIds = ['K1-R40', 'K5-R38', 'K1-R39', 'K2-R44', 'K4-R16', 'K4-R20'];
const heldEntries = holdChunks.flatMap(chunk => Object.entries(chunk));
const byId = new Map(source.map(row => [row.indicatorId, row]));
const yearMonths = Array.from({ length: 12 }, (_, index) => index + 1);
const sorted = (values: Iterable<string>) => [...values].sort();
const observation = (month: number, denominator = 100) => ({
  month, pencapaianRiil: 0, totalSasaran: denominator,
  scoringVersion: DO_SCORING_VERSION, inputBasis: 'PERIOD_ACTUAL',
});
const recap = (denominator = 100) => ({
  numerator: 0, denominator, endMonth: 12, revision: 3,
  notes: 'Independent January-December register, eligibility and deduplication reconciled.',
  confirmed: true, scoringVersion: DO_SCORING_VERSION,
});

function badRequestCode(code: string) {
  return (error: unknown) => {
    assert.ok(error instanceof BadRequestException);
    assert.equal(Reflect.get(Object(error.getResponse()), 'code'), code);
    return true;
  };
}

// Literal source coordinates and targets also act as an independent membership oracle.
const reviewedFixtures: Readonly<Record<string, readonly [sourceRef: string, target: number]>> = {
  'K1-R17': ['S1:KLASTER I!A17:H17', 100],
  'K1-R29': ['S1:KLASTER I!A29:H29', 60],
  'K1-R30': ['S1:KLASTER I!A30:H30', 100],
  'K1-R41': ['S1:KLASTER I!A41:H41', 100],
  'K1-R55': ['S1:KLASTER I!A55:H55', 100],
  'K1-R56': ['S1:KLASTER I!A56:H56', 80],
  'K1-R57': ['S1:KLASTER I!A57:H57', 100],
  'K1-R67': ['S1:KLASTER I!A68:H68', 95],
  'K1-R68': ['S1:KLASTER I!A69:H69', 100],
  'K1-R70': ['S1:KLASTER I!A71:H71', 100],
  'K1-R72': ['S1:KLASTER I!A73:H73', 100],
  'K1-R87': ['S1:KLASTER I!A88:H88', 50],
  'K1-R90': ['S1:KLASTER I!A91:H91', 90],
  'K1-R92': ['S1:KLASTER I!A93:H93', 80],
  'K1-R93': ['S1:KLASTER I!A94:H94', 25],
  'K1-R94': ['S1:KLASTER I!A95:H95', 10],
  'K1-R95': ['S1:KLASTER I!A96:H96', 35],
  'K1-R98': ['S1:KLASTER I!A99:H99', 80],
  'K1-R107': ['S1:KLASTER I!A108:H108', 60],
  'K1-R110': ['S1:KLASTER I!A111:H111', 20],
  'K1-R111': ['S1:KLASTER I!A112:H112', 50],
  'K1-R112': ['S1:KLASTER I!A113:H113', 70],
  'K1-R116': ['S1:KLASTER I!A117:H117', 100],
  'K1-R117': ['S1:KLASTER I!A118:H118', 100],
  'K1-R123': ['S1:KLASTER I!A124:H124', 100],
  'K1-R125': ['S1:KLASTER I!A126:H126', 100],
  'K2-R11': ['S1:KLASTER 2!A10:I10', 85],
  'K3-R14': ['S1:KLASTER 3!A13:I13', 13],
  'K3-R22': ['S1:KLASTER 3!A21:I21', 50],
  'K3-R26': ['S1:KLASTER 3!A25:I25', 50],
  'K3-R55': ['S1:KLASTER 3!A54:I54', 100],
  'K4-R9': ['S1:KLASTER 4!A8:J8', 90],
  'K4-R10': ['S1:KLASTER 4!A9:J9', 80],
  'K4-R11': ['S1:KLASTER 4!A10:J10', 80],
  'K4-R17': ['S1:KLASTER 4!A16:J16', 100],
  'K4-R18': ['S1:KLASTER 4!A17:J17', 80],
  'K4-R21': ['S1:KLASTER 4!A20:J20', 90],
  'K4-R26': ['S1:KLASTER 4!A25:J25', 100],
  'K4-R27': ['S1:KLASTER 4!A26:J26', 100],
  'K4-R31': ['S1:KLASTER 4!A30:J30', 70],
  'K4-R32': ['S1:KLASTER 4!A31:J31', 70],
  'K4-R34': ['S1:KLASTER 4!A33:J33', 100],
  'K4-R35': ['S1:KLASTER 4!A34:J34', 80],
  'K4-R38': ['S1:KLASTER 4!A37:J37', 70],
  'K4-R40': ['S1:KLASTER 4!A39:J39', 68],
  'K4-R41': ['S1:KLASTER 4!A40:J40', 65],
  'K5-R21': ['S1:LINTAS KLASTER!A20:I20', 80],
  'K5-R30': ['S1:LINTAS KLASTER!A29:I29', 80],
  'K5-R32': ['S1:LINTAS KLASTER!A31:I31', 100],
  'K5-R46': ['S1:LINTAS KLASTER!A45:I45', 100],
};

// Fixed populations come from the source lists, not from the rule under test.
// A target of 80% of four or 70% of twelve has no exact integer-count fixture.
type Boundary = readonly [label: string, numerator: number, measurement: number, met: boolean];
const fixedFixtures: Readonly<Record<string, { denominator: number; target: number; cases: readonly Boundary[] }>> = {
  'K1-R41': { denominator: 3, target: 100, cases: [['zero', 0, 0, false], ['below', 2, 66.66666667, false], ['target', 3, 100, true]] },
  'K1-R55': { denominator: 1, target: 100, cases: [['zero/below', 0, 0, false], ['target', 1, 100, true]] },
  'K1-R56': { denominator: 4, target: 80, cases: [['zero', 0, 0, false], ['below', 3, 75, false], ['first integer above target', 4, 100, true]] },
  'K1-R57': { denominator: 1, target: 100, cases: [['zero/below', 0, 0, false], ['target', 1, 100, true]] },
  'K1-R87': { denominator: 12, target: 50, cases: [['zero', 0, 0, false], ['below', 5, 41.66666667, false], ['target', 6, 50, true], ['above', 7, 58.33333333, true]] },
  'K1-R125': { denominator: 7, target: 100, cases: [['zero', 0, 0, false], ['below', 6, 85.71428571, false], ['target', 7, 100, true]] },
  'K4-R34': { denominator: 12, target: 100, cases: [['zero', 0, 0, false], ['below', 11, 91.66666667, false], ['target', 12, 100, true]] },
  'K4-R38': { denominator: 12, target: 70, cases: [['zero', 0, 0, false], ['below', 8, 66.66666667, false], ['first integer above target', 9, 75, true]] },
  'K5-R32': { denominator: 1, target: 100, cases: [['zero/below', 0, 0, false], ['target', 1, 100, true]] },
};

// Only reviewed percentage text is mapped; document/count narratives are not parsed.
const textTargetFixtures: Readonly<Record<string, { raw: string; target: number }>> = {
  'K1-R67': { raw: '95 %', target: 95 },
  'K4-R9': { raw: '\u2265 90%', target: 90 },
  'K4-R10': { raw: '\u2265 80%', target: 80 },
  'K4-R11': { raw: '\u2265 80%', target: 80 },
};

// Independent population/unit anchors distinguish similarly named neighbouring rows.
const reviewedLabels: Readonly<Record<string, readonly [RegExp, RegExp]>> = {
  'K1-R17': [/unit layanan atau klaster.*tindak lanjut/, /unit layanan atau klaster.*audit arsip/],
  'K1-R29': [/kegiatan pemeliharaan sarana.*sesuai jadwal/, /kegiatan pemeliharaan sarana.*dijadwalkan/],
  'K1-R30': [/alkes wajib kalibrasi.*tepat waktu/, /seluruh alkes.*wajib dikalibrasi/],
  'K1-R41': [/kegiatan utama peningkatan mutu.*seluruh komponen/, /Tiga kegiatan.*dokumen.*pengukuran.*pelaporan/],
  'K1-R55': [/Dokumen perencanaan program kerja K3.*0 atau 1/, /Satu dokumen perencanaan program K3/],
  'K1-R56': [/jenis laporan kegiatan K3.*disampaikan/, /Empat laporan.*pemeriksaan berkala.*PHBS/],
  'K1-R57': [/Laporan evaluasi kegiatan program K3.*0 atau 1/, /Satu dokumen laporan evaluasi/],
  'K1-R67': [/laporan keuangan lengkap.*diterima tepat waktu/, /laporan keuangan.*wajib disampaikan/],
  'K1-R68': [/dokumen pertanggungjawaban belanja dan penerimaan pendapatan.*sesuai regulasi/, /dokumen pertanggungjawaban.*diperiksa/],
  'K1-R70': [/laporan.*disediakan dan disampaikan tepat waktu/, /laporan.*wajib dibuat dan disampaikan/],
  'K1-R72': [/laporan keuangan semester dan tahunan.*tersusun/, /laporan keuangan semester dan tahunan.*wajib disusun/],
  'K1-R87': [/bulan.*aktivitas fisik Puskesmas/, /Dua belas bulan/],
  'K1-R90': [/calon jamaah haji.*kebugaran/, /calon jamaah haji.*terdaftar.*tahun berjalan/],
  'K1-R92': [/satuan pendidikan.*CKG, imunisasi/, /seluruh satuan pendidikan/],
  'K1-R93': [/sekolah negeri.*SMP atau SMA.*P3LP/, /seluruh sekolah negeri.*SMP atau SMA/],
  'K1-R94': [/sekolah SD, SLTP atau SLTA.*NAPZA lengkap/, /seluruh sekolah.*SD, SLTP dan SLTA/],
  'K1-R95': [/SD atau sederajat.*kebugaran jasmani/, /seluruh SD atau sederajat/],
  'K1-R98': [/tempat kerja formal dan informal.*CKG, imunisasi/, /seluruh tempat kerja formal dan informal/],
  'K1-R107': [/jejaring lintas sektor.*tribulanan pertama/, /seluruh jejaring lintas sektor/],
  'K1-R110': [/rumah tangga.*dikaji PHBS.*satu tahun/, /sasaran rumah tangga.*tahun yang sama/],
  'K1-R111': [/institusi pendidikan.*dikaji PHBS/, /sasaran institusi pendidikan/],
  'K1-R112': [/Pondok Pesantren.*dikaji PHBS/, /seluruh Pondok Pesantren/],
  'K1-R116': [/Posyandu.*intervensi PHBS.*empat kali/, /seluruh Posyandu/],
  'K1-R117': [/institusi pendidikan yang menerima intervensi PHBS minimal dua kali.*oleh Puskesmas/, /seluruh institusi pendidikan yang dikaji PHBS/],
  'K1-R123': [/Puskesmas dan jaringan.*masing-masing.*dua belas kali/, /Puskesmas, Pustu dan Ponkesdes/],
  'K1-R125': [/jenis promosi.*luar gedung/, /Tujuh jenis kegiatan promosi/],
  'K2-R11': [/ibu hamil unik KEK atau risiko KEK.*pangan lokal/, /seluruh ibu hamil unik KEK atau risiko KEK/],
  'K3-R14': [/penduduk unik semua kelompok umur.*TBC/, /penduduk wilayah kerja/],
  'K3-R22': [/hipertensi dan\/atau DM usia >=40.*EKG/, /seluruh penderita unik hipertensi dan\/atau DM usia >=40/],
  'K3-R26': [/usia >=40.*PUMA/, /seluruh penduduk usia >=40/],
  'K3-R55': [/warga negara unik usia >=60.*sesuai standar/, /seluruh warga negara usia >=60/],
  'K4-R9': [/laporan mingguan SKDR.*kelengkapan/, /seluruh kewajiban laporan mingguan SKDR/],
  'K4-R10': [/laporan mingguan SKDR.*Senin atau Selasa/, /seluruh kewajiban laporan mingguan SKDR/],
  'K4-R11': [/alert SKDR.*<24 jam/, /seluruh alert SKDR.*muncul/],
  'K4-R17': [/kasus indeks TBC terkonfirmasi.*kontak serumah dan kontak erat/, /seluruh kasus indeks TBC/],
  'K4-R18': [/kontak serumah.*eligible.*TPT/, /kontak serumah.*eligible menerima TPT/],
  'K4-R21': [/laporan bulanan online.*frambusia.*terkirim/, /laporan bulanan online.*frambusia.*seharusnya dikirim/],
  'K4-R26': [/gigitan hewan penular rabies.*cuci luka/, /seluruh kasus gigitan hewan penular rabies/],
  'K4-R27': [/gigitan hewan penular rabies terindikasi.*vaksinasi/, /seluruh kasus gigitan hewan penular rabies terindikasi vaksinasi/],
  'K4-R31': [/sarana air minum.*IKL.*fisik, kimia dan mikrobiologi/, /seluruh sarana air minum/],
  'K4-R32': [/TPP olahan siap saji.*IKL.*kapasitas.*kualitas pangan/, /seluruh TPP olahan siap saji yang terdata/],
  'K4-R34': [/bulan berbeda.*limbah.*lengkap/, /Dua belas bulan Januari-Desember/],
  'K4-R35': [/TFU terdata.*IKL dan pemeriksaan kualitas udara/, /seluruh TFU yang terdata/],
  'K4-R38': [/laporan bulanan.*Silantor.*surveilans dan intervensi/, /Dua belas bulan.*Silantor/],
  'K4-R40': [/industri rumah tangga pangan.*inspeksi kesehatan lingkungan/, /seluruh industri rumah tangga pangan yang ada/],
  'K4-R41': [/IRTP yang di-IKL.*CPPOB Level I\/II.*SPP-IRT/, /seluruh IRTP.*dilakukan IKL/],
  'K5-R21': [/review Formularium.*dilaksanakan/, /review Formularium.*direncanakan dalam RPK/],
  'K5-R30': [/kegiatan edukasi masyarakat.*sediaan farmasi dan alkes.*dilaksanakan/, /kegiatan edukasi masyarakat tentang obat.*direncanakan/],
  'K5-R32': [/SK Laboratorium Kesehatan Masyarakat.*tersedia.*tidak tersedia/, /Satu kewajiban.*SK Laboratorium Kesehatan Masyarakat/],
  'K5-R46': [/desa\/kelurahan rawan bencana.*sosialisasi/, /seluruh desa\/kelurahan rawan bencana/],
};

test('all 272 source rows partition into the unchanged 23, reviewed chunks, and specific holds', t => {
  const identities = [...oldIds, ...reviewedEntries.map(([id]) => id), ...structuredIds, ...heldEntries.map(([id]) => id)];
  assert.equal(source.length, 272);
  assert.equal(byId.size, 272);
  assert.equal(oldIds.length, 23);
  assert.deepEqual(ruleChunks.map(chunk => Object.keys(chunk).length), [26, 5, 19]);
  assert.deepEqual(holdChunks.map(chunk => Object.keys(chunk).length), [80, 80, 33]);
  assert.equal(reviewedEntries.length, 50);
  assert.equal(heldEntries.length, 193);
  assert.equal(Object.keys(DO_RULES).length, 79);
  assert.equal(new Set(identities).size, identities.length, 'no spread may silently overwrite a duplicate identity');
  assert.deepEqual(sorted(identities), sorted(byId.keys()));
  assert.deepEqual(sorted(Object.keys(DO_RULES)), sorted([...oldIds, ...reviewedEntries.map(([id]) => id), ...structuredIds]));
  assert.deepEqual(sorted(Object.keys(DO_REVIEW_HOLDS)), sorted(heldEntries.map(([id]) => id)));
  assert.deepEqual(sorted(Object.keys(reviewedFixtures)), sorted(reviewedEntries.map(([id]) => id)));
  assert.deepEqual(sorted(Object.keys(reviewedLabels)), sorted(reviewedEntries.map(([id]) => id)));
  assert.deepEqual(sorted(Object.keys(textTargetFixtures)), sorted(reviewedEntries.filter(([id]) => typeof byId.get(id)?.target.raw === 'string').map(([id]) => id)));
  assert.deepEqual(sorted(reviewedEntries.filter(([, rule]) => rule.fixedDenominator !== undefined).map(([id]) => id)), sorted(Object.keys(fixedFixtures)));
  assert.equal(Object.keys(fixedFixtures).length, 9);
  t.diagnostic(`Source ${source.length}: old ${oldIds.length}, reviewed ${reviewedEntries.length}, held ${heldEntries.length}; fixed-denominator ${Object.keys(fixedFixtures).length}.`);
});

for (const [id, rule] of reviewedEntries) {
  test(`${id} reviewed metadata matches its own source target and annual contract`, () => {
    const row = byId.get(id);
    assert.ok(row);
    const [sourceRef, target] = reviewedFixtures[id]!;
    assert.equal(row.sourceRef, sourceRef);
    assert.equal(rule.sourceRef, sourceRef);
    const textTarget = textTargetFixtures[id];
    if (textTarget) assert.equal(row.target.raw, textTarget.raw);
    else {
      assert.equal(typeof row.target.raw, 'number');
      assert.match(row.target.excel_number_format, /%/);
    }
    assert.equal(textTarget?.target ?? new Prisma.Decimal(row.target.raw!).mul(100).toNumber(), target);
    assert.deepEqual(rule.scoring, { kind: 'COVERAGE', target });
    assert.equal(rule.annualRecapOnly, true);
    assert.equal(rule.unit, 'PERCENT');
    assert.equal(rule.denominatorInput, 'INTEGER');
    assert.equal(rule.denominatorFactor, undefined);
    const labels = reviewedLabels[id];
    assert.ok(labels, 'each new rule needs its own independent population/unit fixtures');
    assert.match(rule.numeratorLabel, labels[0]);
    assert.match(rule.denominatorLabel, labels[1]);
    for (const label of [rule.numeratorLabel, rule.denominatorLabel, rule.assessmentNote]) {
      assert.equal(typeof label, 'string');
      assert.ok(label && label.trim().length > 15, 'specific count labels and an assessment instruction are required');
      assert.doesNotMatch(label, /^(Pembilang sesuai DO|Penyebut belum dikonfirmasi)$/);
    }
    assert.equal(DO_RULES[id], rule);
    const profile = getDoProfile(id);
    assert.ok(profile);
    assert.equal(profile.status, 'IMPLEMENTED');
    assert.equal(profile.approvalStatus, 'PROVISIONAL_SOURCE_RULE');
    assert.equal(profile.sourceHash, DO_SOURCE_HASH);
    assert.equal(profile.sourceRef, row.sourceRef);
    assert.equal(profile.definitionId, row.definitionId);
    assert.equal(profile.definition, row.definition);
    assert.equal(profile.calculation, row.calculation);
    assert.equal(profile.notes, row.notes);
    assert.equal(profile.targetDisplay, textTarget?.raw ?? `${Number(row.target.raw) * 100}%`);
    assert.equal(profile.numeratorLabel, rule.numeratorLabel);
    assert.equal(profile.denominatorLabel, rule.denominatorLabel);
    assert.equal(profile.fixedDenominator, fixedFixtures[id]?.denominator ?? null);
    assert.equal(profile.numeratorInput, 'INTEGER');
    assert.equal(profile.denominatorInput, 'INTEGER');
    assert.equal(profile.measurementUnit, 'PERCENT');
    assert.equal(profile.annualRecapOnly, true);
    assert.equal(profile.observationPeriod, 'CALENDAR_YEAR');
    assert.ok(profile.assessmentInstruction.includes(rule.assessmentNote!));
    assert.equal(profile.reason, null);
    assert.equal(profile.cumulativePolicy, 'EXPLICIT_YTD_REQUIRED');
    assert.equal(cumulativePolicy(id), 'EXPLICIT_YTD_REQUIRED');
  });

  const target = reviewedFixtures[id]![1];
  const fixed = fixedFixtures[id];
  const denominator = fixed?.denominator ?? 100;
  const cases: readonly Boundary[] = fixed?.cases ?? [
    ['zero', 0, 0, false], ['below', target - 1, target - 1, false], ['target', target, target, true],
    ...(target < 100 ? [['above within D', target + 1, target + 1, true] as const] : []),
  ];
  for (const [label, numerator, measurement, met] of cases) {
    test(`${id} independent ${label} fixture ${numerator}/${denominator}`, () => {
      if (fixed) assert.equal(target, fixed.target);
      assert.ok(numerator <= denominator);
      validateDoInput(id, { numerator, denominator });
      const result = scoreDo2026(id, { numerator, denominator, annualRecapConfirmed: true });
      assert.deepEqual(result, {
        assessmentComplete: false, completionScope: 'ARITHMETIC_ONLY', observationStatus: 'NOT_VERIFIED',
        capaianRiilPct: measurement, measurementValue: measurement, measurementUnit: 'PERCENT',
        effectiveDenominator: denominator, nilaiKinerja: null, scoringVersion: DO_SCORING_VERSION,
        status: 'UNRESOLVED_RULE', targetMet: met,
        reason: 'Pengukuran dan ketercapaian tersedia. Normalisasi terhadap target serta batas skor maksimum memerlukan kebijakan penilaian yang disahkan.',
      });
    });
  }

  test(`${id} requires explicit annual confirmation even for otherwise valid arithmetic`, () => {
    for (const annualRecapConfirmed of [undefined, false]) {
      const result = scoreDo2026(id, { numerator: 0, denominator, annualRecapConfirmed });
      assert.equal(result.status, 'ANNUAL_RECAP_REQUIRED');
      assert.equal(result.measurementValue, null);
      assert.equal(result.nilaiKinerja, null);
      assert.equal(result.targetMet, null);
      assert.equal(result.assessmentComplete, false);
    }
  });

  test(`${id} validates integer writes separately and rejects excess counts or a wrong fixed D`, () => {
    assert.throws(() => validateDoInput(id, { numerator: 0.5, denominator }), badRequestCode('INTEGER_NUMERATOR_REQUIRED'));
    assert.throws(() => validateDoInput(id, { numerator: 0, denominator: denominator + 0.5 }), badRequestCode('INTEGER_DENOMINATOR_REQUIRED'));
    assert.throws(() => scoreDo2026(id, { numerator: denominator + 1, denominator, annualRecapConfirmed: true }), BadRequestException);
    for (const invalid of [-1, NaN, Infinity]) {
      assert.throws(() => scoreDo2026(id, { numerator: invalid, denominator, annualRecapConfirmed: true }), BadRequestException);
      assert.throws(() => scoreDo2026(id, { numerator: 0, denominator: invalid, annualRecapConfirmed: true }), BadRequestException);
    }
    if (fixed) {
      assert.equal(rule.fixedDenominator, fixed.denominator);
      for (const wrong of [0, fixed.denominator + 1]) {
        assert.throws(() => scoreDo2026(id, { numerator: 0, denominator: wrong, annualRecapConfirmed: true }), BadRequestException);
      }
      const exactTargetCount = new Prisma.Decimal(fixed.denominator).mul(fixed.target).div(100);
      if (!exactTargetCount.isInteger()) {
        assert.throws(() => validateDoInput(id, { numerator: exactTargetCount, denominator }), badRequestCode('INTEGER_NUMERATOR_REQUIRED'));
        assert.throws(() => scoreDo2026(id, { numerator: exactTargetCount, denominator, annualRecapConfirmed: true }), BadRequestException);
      }
    } else {
      const result = scoreDo2026(id, { numerator: 0, denominator: 0, annualRecapConfirmed: true });
      assert.equal(result.status, 'ZERO_DENOMINATOR');
      assert.equal(result.measurementValue, null);
      assert.equal(result.targetMet, null);
      assert.equal(result.nilaiKinerja, null);
      assert.equal(result.assessmentComplete, false);
    }
  });

  test(`${id} rejects monthly V2 writes and standalone December evaluation`, () => {
    const indicator = { id, polarity: 'HIGHER_IS_BETTER', targetNumeric: new Prisma.Decimal(1), scoringVersion: 'ILP_2026_V1' } as const;
    for (const inputBasis of ['PERIOD_ACTUAL', 'YTD_ACTUAL'] as const) {
      assert.throws(() => scoreMonthlyInput(indicator, {
        indicatorId: id, pencapaianRiil: 0, totalSasaran: denominator,
        inputBasis, scoringVersion: DO_SCORING_VERSION,
      }, 2026), badRequestCode('ANNUAL_RECAP_REQUIRED'));
    }
    for (const month of [1, 12]) {
      const result = evaluateDoPeriod(id, [observation(month, denominator)], [month]);
      assert.equal(result.status, 'ANNUAL_RECAP_REQUIRED');
      assert.equal(result.measurementValue, null);
      assert.equal(result.isComplete, false);
      assert.equal(result.assessmentComplete, false);
    }
  });

  test(`${id} cannot compute any January-November recap even when confirmed`, () => {
    for (let endMonth = 1; endMonth <= 11; endMonth++) {
      const months = yearMonths.slice(0, endMonth);
      const result = evaluateDoCumulative(id, {
        months, records: months.map(month => observation(month, denominator)),
        recap: { ...recap(denominator), endMonth },
      });
      assert.equal(result.status, 'ANNUAL_RECAP_REQUIRED', `endMonth=${endMonth}`);
      assert.deepEqual([result.numerator, result.denominator, result.measurementValue, result.nilaiKinerja, result.targetMet], [null, null, null, null, null]);
      assert.equal(result.dataComplete, false);
      assert.equal(result.assessmentComplete, false);
    }
  });

  test(`${id} only accepts an exact January-December separate confirmed V2 recap`, () => {
    const valid = recap(denominator);
    for (const invalid of [
      undefined, { ...valid, confirmed: false }, { ...valid, scoringVersion: 'ILP_2026_V1' },
      { ...valid, scoringVersion: '' }, { ...valid, scoringVersion: 'OTHER' },
      ...[-1, 0, 1, 11, 11.5, 13, NaN, Infinity].map(endMonth => ({ ...valid, endMonth })),
    ]) {
      const result = evaluateDoCumulative(id, {
        months: yearMonths,
        records: [{ ...observation(12, denominator), inputBasis: 'YTD_ACTUAL' }], recap: invalid,
      });
      assert.equal(result.status, 'ANNUAL_RECAP_REQUIRED');
      assert.equal(result.numerator, null, 'a legacy YTD endpoint must not be used');
      assert.equal(result.measurementValue, null);
      assert.equal(result.dataComplete, false);
      assert.equal(result.assessmentComplete, false);
    }
    for (const months of [
      [], [12],
      Array<number>(12).fill(12), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 12],
      [...yearMonths].reverse(), yearMonths.slice(1), [...yearMonths, 12],
      ...yearMonths.flatMap((_, index) => [-1, 0, 13, NaN, Infinity, index + 1.5].map(invalid =>
        yearMonths.map((month, position) => position === index ? invalid : month))),
      ...yearMonths.slice(0, -1).map((_, index) => {
        const swapped = [...yearMonths];
        [swapped[index], swapped[index + 1]] = [swapped[index + 1]!, swapped[index]!];
        return swapped;
      }),
    ]) {
      const result = evaluateDoCumulative(id, { months, records: [], recap: valid });
      assert.equal(result.status, 'ANNUAL_RECAP_REQUIRED', JSON.stringify(months));
      assert.equal(result.measurementValue, null);
      assert.equal(result.dataComplete, false);
    }
    const records = yearMonths.map(month => ({ ...observation(month, denominator), pencapaianRiil: denominator, scoringVersion: 'ILP_2026_V1' }));
    const before = structuredClone(records);
    const result = evaluateDoCumulative(id, { months: yearMonths, records, recap: valid });
    assert.deepEqual([result.numerator, result.denominator, result.measurementValue, result.targetMet], [0, denominator, 0, false]);
    assert.equal(result.aggregationMethod, 'EXPLICIT_YTD_RECAP');
    assert.equal(result.dataComplete, true);
    assert.equal(result.scoreComplete, false);
    assert.equal(result.isComplete, false);
    assert.equal(result.assessmentComplete, false);
    assert.equal(result.nilaiKinerja, null);
    assert.equal(result.recapRevision, 3);
    assert.equal(result.recapNotes, valid.notes);
    assert.deepEqual(result.requiredMissingMonths, []);
    assert.deepEqual(result.missingMonths, yearMonths);
    assert.deepEqual(records, before, 'independent recaps never mutate historical observations');
    const recapOnly = evaluateDoCumulative(id, { months: yearMonths, records: [], recap: valid });
    assert.equal(recapOnly.dataComplete, true, 'monthly writes are not prerequisites for an independent annual recap');
    assert.equal(recapOnly.measurementValue, 0);
    assert.equal(recapOnly.assessmentComplete, false);
    const monthlyOnly = evaluateDoPeriod(id, yearMonths.map(month => observation(month, denominator)), yearMonths);
    assert.equal(monthlyOnly.status, 'ANNUAL_RECAP_REQUIRED');
    assert.equal(monthlyOnly.measurementValue, null);
  });

  test(`${id} rejects corrupted recap counts rather than falling back to complete monthly or YTD data`, () => {
    const records = yearMonths.map(month => ({ ...observation(month, denominator), pencapaianRiil: denominator }));
    records.push({ ...observation(12, denominator), pencapaianRiil: denominator, inputBasis: 'YTD_ACTUAL' });
    const before = structuredClone(records);
    for (const patch of [
      ...[-1, NaN, Infinity, -Infinity].flatMap(invalid => [{ numerator: invalid }, { denominator: invalid }]),
      { numerator: denominator + 1 },
      ...(fixed ? [{ denominator: 0 }, { denominator: denominator + 1 }, { numerator: 0.5 }] : []),
    ]) {
      assert.throws(() => evaluateDoCumulative(id, {
        months: yearMonths, records, recap: { ...recap(denominator), ...patch },
      }), BadRequestException, JSON.stringify(patch));
    }
    if (!fixed) {
      const zero = evaluateDoCumulative(id, { months: yearMonths, records, recap: recap(0) });
      assert.equal(zero.status, 'ZERO_DENOMINATOR');
      assert.equal(zero.dataComplete, false);
      assert.equal(zero.measurementValue, null);
      assert.equal(zero.nilaiKinerja, null);
      assert.equal(zero.targetMet, null);
      assert.equal(zero.assessmentComplete, false);
    }
    assert.deepEqual(records, before);
  });
}

// Each held ID has its own independent source-conflict anchor, not a generic fallback.
const holdReasons: Readonly<Record<string, RegExp>> = {
  'K1-R9': /Januari N-1.*feedback Oktober.*November N-1/,
  'K1-R10': /kegiatan RPK.*penyerapan anggaran/,
  'K1-R11': /berakhir dengan kata dibagi.*dua belas/,
  'K1-R13': /TW1.*siklus\/applicability/,
  'K1-R15': /arsip aktif, inaktif dan vital.*tanggal acuan.*snapshot tahunan/,
  'K1-R16': /tiga jenis dokumen.*jenis versus berkas.*tidak menetapkan D=3/,
  'K1-R19': /setiap ada perubahan.*kedua aplikasi.*masa aktif SDMK/,
  'K1-R20': /roster SDMK.*kompetensi.*tanggal acuan.*versi standar/,
  'K1-R21': /masa berlaku STR\/SIP.*pemantauan SIP enam bulan.*seluruh masa pelayanan/,
  'K1-R22': /lebih dari 100 persen.*kelebihan dokter/,
  'K1-R23': /formasi RENBUT.*tanggal acuan.*versi formasi/,
  'K1-R26': /inventaris SPA.*standar ASPAK.*snapshot tahunan.*input bulanan/,
  'K1-R27': /30 Juni\/31 Desember/,
  'K1-R28': /kelayakan SPA.*tanggal acuan.*pasangan item-ruangan/,
  'K1-R31': /total pemeliharaan\/perbaikan.*tidak terjadwal.*mempersempit sumber/,
  'K1-R33': /40 nomenklatur.*stok tersedia.*tanggal acuan.*alternatif/,
  'K1-R34': /tujuh vaksin.*kalender/,
  'K1-R35': /15 jenis alkes\/BMHP.*POCT.*snapshot tahunan/,
  'K1-R38': /SOP\/register\/tindak lanjut\/publikasi/,
  'K1-R43': /lima tahunan dan tahunan.*D=5/,
  'K1-R44': /kegiatan PPI.*D jumlah total kegiatan.*terencana.*sembilan kelompok/,
  'K1-R45': /bulanan\/triwulan\/semester\/tahunan/,
  'K1-R47': /SK, rencana, KAK dan SOP/,
  'K1-R48': /manajemen risiko.*jumlah total kegiatan.*klinis\/nonklinis.*D=3/,
  'K1-R49': /identifikasi, analisis dan mitigasi.*tiga kegiatan/,
  'K1-R51': /MFK.*tepat empat berkas/,
  'K1-R52': /tujuh entri.*delapan kegiatan/,
  'K1-R53': /delapan kegiatan.*tujuh entri/,
  'K1-R59': /audit internal.*D=4/,
  'K1-R60': /jumlah total kegiatan audit internal.*empat tahapan.*penghilangan kegiatan/,
  'K1-R61': /empat tahapan.*empat dokumen/,
  'K1-R63': /laporan insiden.*nihil insiden/,
  'K1-R64': /keselamatan pasien.*jumlah total kegiatan.*tujuh langkah.*D=3\/7/,
  'K1-R65': /laporan insiden.*pengecualian otomatis/,
  'K1-R69': /BKU.*BA penutupan kas/,
  'K1-R71': /pendapatan dan belanja.*dua komponen finansial/,
  'K1-R74': /UPKD\/K\/Posyandu.*dashboard PWS.*snapshot tahunan.*kontinuitas/,
  'K1-R75': /SATU SEHAT.*elektronik/,
  'K1-R79': /pelaporan setiap bulan.*roster bertanggal aktif.*bulan terlewat/,
  'K1-R81': /Panti Sehat.*tidak menjadi pembagi/,
  'K1-R82': /hattra.*STPT.*tanggal acuan.*masa berlaku/,
  'K1-R83': /hattra.*denominator tidak tertulis/,
  'K1-R84': /Asman ber-SK.*tanggal acuan.*validitas SK.*kondisi awal, akhir/,
  'K1-R88': /Pustu.*x12 bulan/,
  'K1-R89': /sepuluh anggota.*enam bulan terakhir.*tanggal acuan/,
  'K1-R100': /Polsek, Koramil, KUA.*seluruh perkantoran/,
  'K1-R101': /Pos UKK.*x12 bulan/,
  'K1-R102': />50.*minimal 50.*GP2SP/,
  'K1-R103': /100 pekerja.*>100.*risiko tinggi/,
  'K1-R105': /empat rapat.*denominator aktual/,
  'K1-R113': /rumah tangga.*PHBS berulang.*kajian pertama, terakhir/,
  'K1-R114': /PHBS institusi pendidikan.*tiap enam bulan.*rekonsiliasi semester/,
  'K1-R115': /11-13.*tanpa Ponpes/,
  'K1-R118': /Ponpes.*dua kali.*13 indikator/,
  'K1-R119': /delapan kali setahun.*lima kader.*keadaan dengan frekuensi/,
  'K1-R120': /Poskestren.*tanpa Ponpes/,
  'K1-R121': /sekolah tanpa SBH tetap masuk D/,
  'K1-R122': /Siaga.*Purnama\/Mandiri.*tanggal acuan.*snapshot tahunan/,
  'K1-R124': /minimal sepuluh titik/,
  'K1-R126': /Poskestren atau SBH.*applicability komponen/,
  'K1-R128': /sembilan kriteria KTR fasyankes.*antarinspeksi.*inspeksi terbaik/,
  'K1-R129': /sembilan kriteria KTR sekolah.*tanggal acuan.*rekonsiliasi inspeksi/,
  'K1-R130': /KTR PAUD, TK dan taman kota.*snapshot tahunan.*sembilan kriteria/,
  'K1-R131': /KTR tempat ibadah.*sembilan kriteria.*pertama, terakhir atau terbaik/,
  'K1-R132': /KTR angkutan.*per perjalanan.*rekonsiliasi hasil tahunan/,
  'K1-R133': /KTR tempat kerja.*snapshot tahunan.*smoking area/,
  'K1-R134': /KTR pasar, supermarket.*snapshot tahunan.*smoking area/,
  'K1-R136': /ASN.*KEDATON.*mutasi.*tanggal acuan/,
  'K1-R137': /satu tahun.*dua tahun.*seluruh pegawai/,
  'K1-R138': /PAK dua tahun.*seluruh pegawai/,
  'K1-R139': /dokumen dan pegawai berbeda/,
  'K1-R141': /SEPEKAN.*bobot.*24/,
  'K1-R142': /target penyusunan laporan evaluasi SI.*melebihi target.*100 persen/,
  'K1-R143': /laporan SPM.*target penyusunan.*N dapat melebihi target/,
  'K1-R145': /RKBMD N\+1.*berformat persen/,
  'K1-R146': /nilai LRA.*uang\/desimal/,
  'K1-R147': /KIR.*pemindahan.*snapshot tahunan.*kartu-ruangan/,
  'K1-R148': /BMD.*barcode\/QR.*e-Simbada.*tanggal acuan/,
  'K1-R149': /e-Simbada Pakai Habis.*uang/,
  'K1-R150': /BA inventarisasi fisik.*kartu stok/,
  'K2-R8': /K1 murni.*<=12 minggu.*sasaran bumil.*INTEGER\/ESTIMATED.*N>D/,
  'K2-R9': /K6.*kohort persalinan/,
  'K2-R10': /TTD\/MMS minimal 180 tablet.*sasaran bumil.*INTEGER\/ESTIMATED.*N>D/,
  'K2-R12': /K1.*alternatif edukasi/,
  'K2-R13': /sasaran ibu bersalin.*periode/,
  'K2-R14': /6-48 jam.*29-42/,
  'K2-R16': /2026-2030.*HBsAg/,
  'K2-R17': /HBsAg reaktif.*tenofovir/,
  'K2-R18': /status T2\+ ibu hamil.*target bumil.*INTEGER\/ESTIMATED.*N>D/,
  'K2-R19': /EPDS\/ASSIST.*lintas status/,
  'K2-R20': /Kestrad ibu hamil\/nifas.*periode/,
  'K2-R23': /IMD.*SHK.*MTBM.*6-48 jam/,
  'K2-R24': /6-48 jam.*8-28.*kohort/,
  'K2-R26': /KN lengkap.*empat pelayanan.*lintas tahun/,
  'K2-R27': /ASI eksklusif.*5 bulan 29 hari/,
  'K2-R28': /minimal dua jenis skrining.*anak yang sama/,
  'K2-R29': /HB0.*<24 jam.*ibu hepatitis B/,
  'K2-R30': /HBIG.*<24 jam/,
  'K2-R31': /HBsAg nonreaktif.*hasil versus cakupan/,
  'K2-R32': /Anti-HBs reaktif.*HBsAg nonreaktif/,
  'K2-R34': /0-59.*12-59/,
  'K2-R35': /6-59.*tanpa N\/D/,
  'K2-R36': /12-59 bulan.*dua kali.*sasaran.*INTEGER\/ESTIMATED.*N>D/,
  'K2-R37': /-3 SD.*-2 SD.*perubahan status/,
  'K2-R38': /<6 bulan.*LiLA.*rawat inap\/jalan/,
  'K2-R39': /D\/S.*snapshot.*tidak ditetapkan/,
  'K2-R40': /1-6 tahun.*risiko.*paket/,
  'K2-R43': /oralit DAN zinc.*orang versus episode/,
  'K2-R45': /perkiraan kasus pneumonia.*parameter estimasi/,
  'K2-R47': /surviving infant.*kohort/,
  'K2-R48': /12-23.*11-23/,
  'K2-R54': /0-2 tahun.*0-23 bulan/,
  'K2-R56': /60-83 bulan.*>=8.*>=2.*sasaran.*INTEGER\/ESTIMATED.*N>D/,
  'K2-R57': /3-6 tahun.*60-83 bulan/,
  'K2-R59': /tahun ajaran 2025\/2026/,
  'K2-R60': /SMP.*SD\/MI\/SDLB.*2025\/2026/,
  'K2-R61': /2025\/2026.*lintas tahun/,
  'K2-R62': /kelas 7.*kelas 10.*periode roster/,
  'K2-R63': /26 tablet.*konsumsi.*distribusi/,
  'K2-R64': /kelas 5.*dua dosis Td.*tahun ajaran/,
  'K2-R65': /7 sampai <18.*paket/,
  'K2-R66': /7-12.*MMYS.*estimasi/,
  'K2-R67': /7-12.*penerima layanan/,
  'K2-R68': /6-12.*7-12/,
  'K2-R69': /kelas 7.*dua angkatan/,
  'K2-R71': /13-18.*MMYS.*ASSIST/,
  'K2-R72': /bumil, TBC, IMS.*tumpang tindih/,
  'K2-R73': /13-17.*13-18/,
  'K2-R74': /10-21.*bukan hanya yang diskrining/,
  'K2-R76': /6\/CAR3.*tanpa D/,
  'K3-R9': /hamil\/bersalin\/nifas.*PHQ4\/ASSIST/,
  'K3-R10': /F00-F99.*0,64 persen/,
  'K3-R11': /dua kunjungan.*Dinsos/,
  'K3-R12': /dewasa dan lansia.*hitung ganda/,
  'K3-R15': /orang.*total kunjungan/,
  'K3-R17': /gula darah sewaktu.*sasaran.*>=15.*INTEGER\/ESTIMATED.*N>D/,
  'K3-R18': /usia >=18.*IMT.*sasaran.*INTEGER\/ESTIMATED.*N>D/,
  'K3-R19': />15.*>=15.*prevalensi/,
  'K3-R20': /kunjungan terakhir.*SKI 2023/,
  'K3-R21': /usia >=15.*tekanan darah.*sasaran.*INTEGER\/ESTIMATED.*N>D/,
  'K3-R23': /bulanan.*prevalensi/,
  'K3-R24': /<140\/90.*<3 bulan.*x100/,
  'K3-R25': /dan\/atau DM.*OR versus AND/,
  'K3-R27': />=45.*gejala/,
  'K3-R28': /leher rahim perempuan 30-69.*menopause.*sasaran.*INTEGER\/ESTIMATED.*N>D/,
  'K3-R29': /payudara perempuan 30-69.*SADANIS\/USG.*sasaran.*INTEGER\/ESTIMATED.*N>D/,
  'K3-R30': /45-70.*gejala/,
  'K3-R31': /penglihatan.*tanpa penyebut/,
  'K3-R32': /pendengaran.*definisi D/,
  'K3-R34': /18-59.*penerima layanan/,
  'K3-R36': /18-59.*calon pengantin.*paket/,
  'K3-R39': /istirahat >=3 bulan.*PUS/,
  'K3-R42': /<20, >35.*<2 tahun/,
  'K3-R43': /0-42 hari.*kohort persalinan/,
  'K3-R44': /orang laki-laki dan perempuan.*pasangan/,
  'K3-R47': /60\+.*PHQ4\/ASSIST.*estimasi/,
  'K3-R48': /dua kunjungan.*Dinsos/,
  'K3-R49': /tidak repasung.*dewasa\+lansia/,
  'K3-R51': />=60.*D lansia yang menerima layanan.*periode dan deduplikasi/,
  'K3-R53': /PKG lansia.*R55/,
  'K4-R12': /KLB.*tidak ada KLB.*applicability/,
  'K4-R14': /0,54 x 10.*N>D/,
  'K4-R15': /penduduk kabupaten-kota.*pecahan/,
  'K4-R19': /20 kontak erat.*estimasi/,
  'K4-R22': /suspek.*kasus positif nol/i,
  'K4-R23': /ACT.*pasien versus kasus\/episode.*hasil pengobatan berulang.*episode lain/,
  'K4-R24': /3, 7, 14, 21 dan 28.*lintas tahun/,
  'K4-R25': /domisili pasien.*bulan berjalan.*Metode tahunan.*PE berulang/,
  'K4-R28': /sekolah SMP\/SMA.*selama bulan.*Belum ada metode tahunan.*Union sekolah/,
  'K4-R29': /PSN.*jangan dibagi dua/,
  'K4-R33': /100% SBS.*>=75%.*>=30%.*Berita Acara.*as-of\/periode.*verifikasi ulang/,
  'K4-R36': /Puskesmas.*desa\/kelurahan.*Konflik unit/,
  'K4-R37': /Puskesmas.*pasien PBL.*Konflik unit/,
  'K5-R8': /pasien karies.*pasien versus kunjungan\/episode.*lintas gigi\/diagnosis.*pernah ditatalaksana/,
  'K5-R9': /pulpa\/periradikuler.*pasien versus kunjungan\/episode.*pelayanan ulang tidak sesuai/,
  'K5-R10': /penyakit periodontal.*pasien versus kunjungan\/episode.*hasil berbeda/,
  'K5-R12': /pasien UGD.*pasien versus kedatangan\/episode.*sesuai lalu tidak sesuai.*deduplikasi/,
  'K5-R13': /GELS\/ATLS\/ACLS.*konjungsi/,
  'K5-R14': /BLS\/BCLS\/BTLS.*konjungsi/,
  'K5-R15': /<30 menit.*tepat 30 tidak memenuhi.*kedatangan kedua.*timestamp/,
  'K5-R16': /SISRUTE.*30\/80/,
  'K5-R17': /24 jam.*form versus pasien/,
  'K5-R20': /43\/2019.*pencabutan/,
  'K5-R22': /Fornas.*setiap bulan.*Desember/,
  'K5-R27': /kegiatan per resep.*N>D/,
  'K5-R28': /sesi versus pasien unik/,
  'K5-R29': /minimum 12.*melampaui rencana/,
  'K5-R36': /waktu tunggu.*kebijakan setempat/,
  'K5-R40': /applicability rawat inap/,
  'K5-R41': /Empat kelompok.*D=4/,
  'K5-R42': /rekonsiliasi obat.*mengonsumsi obat/,
  'K5-R44': /1 SK.*>1 SK/,
  'K5-R48': /bulanan.*fisioterapis.*register pelayanan/,
};

test('every held identity has an independent specific reason fixture, never an unreviewed fallback', () => {
  assert.deepEqual(sorted(Object.keys(holdReasons)), sorted(heldEntries.map(([id]) => id)));
  assert.equal(new Set(heldEntries.map(([, reason]) => reason)).size, heldEntries.length);
});

for (const [id, pattern] of Object.entries(holdReasons)) {
  test(`${id} retains its source caveat and cannot use unstructured N/D`, () => {
    const reason = DO_REVIEW_HOLDS[id];
    assert.ok(reason);
    assert.match(reason, pattern);
    assert.equal(DO_RULES[id], undefined);
    const profile = getDoProfile(id);
    assert.equal(profile?.status, profile?.calculationAvailability === 'AVAILABLE_WITH_CONTEXT' ? 'CONTEXTUAL' : 'SOURCE_INPUT_ONLY');
    assert.equal(profile?.inputAvailable, true);
    assert.equal(profile?.structuredInputKind, 'DO_SOURCE_ASSESSMENT');
    assert.equal(profile?.cumulativePolicy, 'EXPLICIT_SOURCE_ASSESSMENT_REQUIRED');
    assert.equal(profile?.sourceRef, byId.get(id)?.sourceRef);
    for (const [numerator, denominator] of [[0, 0], [0, 100], [100, 100], [101, 100], [1, 0]] as const) {
      const result = scoreDo2026(id, { numerator, denominator, annualRecapConfirmed: true });
      assert.equal(result.status, 'SOURCE_ASSESSMENT_REQUIRED');
      assert.equal(result.nilaiKinerja, null);
      assert.equal(result.measurementValue, null);
      assert.equal(result.targetMet, null);
      assert.equal(result.assessmentComplete, false);
    }
    for (const months of [[1], [12], yearMonths]) {
      const records = months.map(month => ({ ...observation(month), pencapaianRiil: 100 }));
      const period = evaluateDoPeriod(id, records, months);
      assert.equal(period.status, 'SOURCE_ASSESSMENT_REQUIRED');
      assert.equal(period.measurementValue, null);
      assert.equal(period.isComplete, false);
      const result = evaluateDoCumulative(id, {
        months, records: [...records, { ...observation(12), pencapaianRiil: 100, inputBasis: 'YTD_ACTUAL' }],
        recap: { ...recap(), numerator: 100, endMonth: Math.max(...months) },
      });
      assert.equal(result.status, 'SOURCE_ASSESSMENT_REQUIRED');
      assert.equal(result.measurementValue, null);
      assert.equal(result.targetMet, null);
      assert.equal(result.dataComplete, false);
      assert.equal(result.assessmentComplete, false);
    }
  });
}

// These 55 former candidates must not silently return to annual COVERAGE.
const movedHoldFixtures: Readonly<Record<string, string>> = {
  'K1-R15': 'S1:KLASTER I!A15:H15',
  'K1-R16': 'S1:KLASTER I!A16:H16',
  'K1-R19': 'S1:KLASTER I!A19:H19',
  'K1-R20': 'S1:KLASTER I!A20:H20',
  'K1-R21': 'S1:KLASTER I!A21:H21',
  'K1-R23': 'S1:KLASTER I!A23:H23',
  'K1-R26': 'S1:KLASTER I!A26:H26',
  'K1-R28': 'S1:KLASTER I!A28:H28',
  'K1-R31': 'S1:KLASTER I!A31:H31',
  'K1-R33': 'S1:KLASTER I!A33:H33',
  'K1-R35': 'S1:KLASTER I!A35:H35',
  'K1-R44': 'S1:KLASTER I!A44:H44',
  'K1-R48': 'S1:KLASTER I!A48:H48',
  'K1-R60': 'S1:KLASTER I!A60:H60',
  'K1-R64': 'S1:KLASTER I!A64:H64',
  'K1-R74': 'S1:KLASTER I!A75:H75',
  'K1-R79': 'S1:KLASTER I!A80:H80',
  'K1-R82': 'S1:KLASTER I!A83:H83',
  'K1-R84': 'S1:KLASTER I!A85:H85',
  'K1-R89': 'S1:KLASTER I!A90:H90',
  'K1-R113': 'S1:KLASTER I!A114:H114',
  'K1-R114': 'S1:KLASTER I!A115:H115',
  'K1-R119': 'S1:KLASTER I!A120:H120',
  'K1-R122': 'S1:KLASTER I!A123:H123',
  'K1-R128': 'S1:KLASTER I!A129:H129',
  'K1-R129': 'S1:KLASTER I!A130:H130',
  'K1-R130': 'S1:KLASTER I!A131:H131',
  'K1-R131': 'S1:KLASTER I!A132:H132',
  'K1-R132': 'S1:KLASTER I!A133:H133',
  'K1-R133': 'S1:KLASTER I!A134:H134',
  'K1-R134': 'S1:KLASTER I!A135:H135',
  'K1-R136': 'S1:KLASTER I!A137:H137',
  'K1-R142': 'S1:KLASTER I!A143:H143',
  'K1-R143': 'S1:KLASTER I!A144:H144',
  'K1-R147': 'S1:KLASTER I!A148:H148',
  'K1-R148': 'S1:KLASTER I!A149:H149',
  'K2-R8': 'S1:KLASTER 2!A7:I7',
  'K2-R10': 'S1:KLASTER 2!A9:I9',
  'K2-R18': 'S1:KLASTER 2!A17:I17',
  'K2-R36': 'S1:KLASTER 2!A35:I35',
  'K2-R56': 'S1:KLASTER 2!A55:I55',
  'K3-R17': 'S1:KLASTER 3!A16:I16',
  'K3-R18': 'S1:KLASTER 3!A17:I17',
  'K3-R21': 'S1:KLASTER 3!A20:I20',
  'K3-R28': 'S1:KLASTER 3!A27:I27',
  'K3-R29': 'S1:KLASTER 3!A28:I28',
  'K4-R23': 'S1:KLASTER 4!A22:J22',
  'K4-R25': 'S1:KLASTER 4!A24:J24',
  'K4-R28': 'S1:KLASTER 4!A27:J27',
  'K4-R33': 'S1:KLASTER 4!A32:J32',
  'K5-R8': 'S1:LINTAS KLASTER!A7:I7',
  'K5-R9': 'S1:LINTAS KLASTER!A8:I8',
  'K5-R10': 'S1:LINTAS KLASTER!A9:I9',
  'K5-R12': 'S1:LINTAS KLASTER!A11:I11',
  'K5-R15': 'S1:LINTAS KLASTER!A14:I14',
};

test('the independent audit holds exactly 55 former candidates: 36 management, 10 clinical and 9 infectious/cross', () => {
  assert.equal(Object.keys(movedHoldFixtures).length, 55);
  assert.deepEqual(holdChunks.map(chunk => Object.keys(movedHoldFixtures).filter(id => id in chunk).length), [36, 10, 9]);
});

for (const [id, sourceRef] of Object.entries(movedHoldFixtures)) {
  test(`${id} preserves its source identity and rejects a confirmed recap without source assessment`, async () => {
    assert.equal(byId.get(id)?.sourceRef, sourceRef);
    assert.equal(getDoProfile(id)?.sourceRef, sourceRef);
    assert.ok(DO_REVIEW_HOLDS[id]);
    assert.ok(holdReasons[id]);
    assert.equal(DO_RULES[id], undefined);
    assert.equal(reviewedFixtures[id], undefined);
    assert.equal(fixedFixtures[id], undefined);
    assert.equal(reviewedLabels[id], undefined);
    assert.equal(textTargetFixtures[id], undefined);
    const f = serviceFixture(id);
    await assert.rejects(() => f.service.save(f.actor, { ...f.dto, numerator: 100 }),
      (error: unknown) => error instanceof BadRequestException && (error.getResponse() as { code?: string }).code === 'SOURCE_ASSESSMENT_REQUIRED');
    assert.deepEqual(f.writes, []);
    assert.deepEqual(f.audits, []);
  });
}

for (const [id, sourcePattern, numerator, denominator] of [
  ['K1-R16', /3 jenis dokumen[\s\S]*Pencatatan dan pelaporan[\s\S]*jumlah dokumen yang seharusnya ada/, 3, 3],
  ['K1-R21', /STR & SIP[\s\S]*6 bulan[\s\S]*STR dan SIP Aktif/, 100, 100],
  ['K1-R33', /tingkat ketersediaan tertinggi[\s\S]*dibagi 40/, 36, 40],
  ['K1-R35', /Jumlah alkes dan BMHP yang tersedia dibagi 15[\s\S]*POCT lipid panel/, 12, 15],
  ['K1-R142', /\(Jumlah dokumen laporan evaluasi SI yang tersusun dan disahkan \/ Target penyusunan laporan\) x 100%/, 11, 10],
  ['K1-R143', /\(Jumlah dokumen laporan SPM yang tersusun dan disahkan \/ Target penyusunan laporan\) x 100%/, 11, 10],
  ['K2-R8', /12 minggu[\s\S]*sasaran ibu hamil/i, 101, 100],
  ['K3-R21', /tekanan darah[\s\S]*sasaran.*15/i, 101, 100],
  ['K5-R8', /K02\.0[\s\S]*K04\.01[\s\S]*jumlah total pasien.*karies/i, 1, 1],
  ['K5-R9', /K04\.02[\s\S]*K04\.82[\s\S]*pulpa dan periradikuler/i, 1, 1],
  ['K5-R10', /K06\.1[\s\S]*jumlah total pasien.*periodontal/i, 1, 1],
  ['K5-R12', /KMK 1936\/2022[\s\S]*Jumlah total pasien.*Gawat Darurat/i, 1, 1],
  ['K5-R15', /depan pintu[\s\S]*respon time < 30 menit/i, 1, 1],
  ['K4-R23', /Penderita malaria[\s\S]*Plasmodium dibagi jumlah kasus Malaria/, 1, 1],
  ['K4-R25', /domisili pasien[\s\S]*kurun waktu bulan berjalan[\s\S]*penderita Malaria[\s\S]*jumlah kasus Malaria/, 1, 1],
  ['K4-R28', /SMP dan SMA[\s\S]*selama bulan pada kurun waktu tertentu/, 1, 1],
  ['K4-R33', /100% Stop[\s\S]*75%[\s\S]*30%[\s\S]*Berita Acara[\s\S]*periode tertentu[\s\S]*periode yang sama/, 20, 100],
] as const) {
  test(`${id} bare N/D cannot become a best snapshot, goal cap, unique-patient union or annualized monthly ratio`, () => {
    const row = byId.get(id)!;
    assert.match([row.definition, row.calculation, row.notes ?? ''].join('\n'), sourcePattern);
    const expected = [null, null, null, false, 'ARITHMETIC_ONLY', 'NOT_VERIFIED'];
    const score = scoreDo2026(id, { numerator, denominator, annualRecapConfirmed: true });
    const annual = evaluateDoCumulative(id, {
      months: yearMonths,
      records: yearMonths.map(month => ({ ...observation(month, denominator), pencapaianRiil: numerator })),
      recap: { ...recap(denominator), numerator },
    });
    for (const result of [score, annual]) {
      assert.equal(result.status, 'SOURCE_ASSESSMENT_REQUIRED');
      assert.deepEqual([result.measurementValue, result.nilaiKinerja, result.targetMet,
        result.assessmentComplete, result.completionScope, result.observationStatus], expected);
    }
    assert.equal(annual.numerator, null);
    assert.equal(annual.denominator, null);
    assert.equal(annual.dataComplete, false);
  });
}

test('K1-R117 preserves intervention recipients in N and assessed institutions in D without adding a numerator restriction', () => {
  const row = byId.get('K1-R117')!;
  assert.equal(row.sourceRef, 'S1:KLASTER I!A118:H118');
  assert.equal(row.calculation, 'Jumlah institusi pendidikan yang telah mendapatkan intervensi PHBS minimal 2 kali dalam 1 tahun oleh Puskesmas dibagi jumlah seluruh institusi pendidikan yang dikaji PHBS di wilayah kerja Puskesmas, dikali 100%.');
  assert.doesNotMatch(DO_RULES['K1-R117']!.numeratorLabel, /dikaji/);
  assert.match(DO_RULES['K1-R117']!.denominatorLabel, /seluruh institusi pendidikan yang dikaji PHBS/);
  assert.match(DO_RULES['K1-R117']!.assessmentNote!, /jangan menambah syarat kajian pada N atau memotong N agar tidak melebihi D/);
});

type OldFixture = readonly [id: string, n: number, d: number, value: number, score: number | null, met: boolean | null, unit: string, effective: number];
const oldScoring: readonly OldFixture[] = [
  ['K1-R8', 1, 1, 1, 100, true, 'COUNT', 1],
  ['K1-R12', 80, 100, 80, null, true, 'PERCENT', 100],
  ['K1-R85', 3, 1, 3, null, true, 'COUNT', 1],
  ['K2-R15', 30, 1000, 15, null, false, 'PERCENT', 200],
  ['K2-R25', 30, 800, 25, null, false, 'PERCENT', 120],
  ['K2-R42', 30, 1000, 65.93406593, null, false, 'PERCENT', 45.5],
  ['K2-R50', 1504, 10000, 15.04, 100, true, 'PERCENT', 10000],
  ['K2-R51', 14, 100, 14, 100, true, 'PERCENT', 100],
  ['K2-R52', 8, 100, 8, 100, true, 'PERCENT', 100],
  ['K2-R75', 114, 1000, 11.4, null, true, 'PERCENT', 1000],
  ['K3-R38', 80, 100, 80, 80, null, 'PERCENT', 100],
  ['K3-R40', 425, 2000, 21.25, 25, null, 'PERCENT', 2000],
  ['K3-R41', 9, 100, 9, 25, null, 'PERCENT', 100],
  ['K5-R19', 1, 2, 50, null, false, 'PERCENT', 2],
  ['K5-R23', 20, 100, 20, 100, null, 'PERCENT', 100],
  ['K5-R24', 8, 100, 8, 100, null, 'PERCENT', 100],
  ['K5-R25', 1, 100, 1, 100, null, 'PERCENT', 100],
  ['K5-R26', 250, 100, 2.5, 100, null, 'ITEMS_PER_PRESCRIPTION', 100],
  ['K5-R33', 3, 4, 75, null, false, 'PERCENT', 4],
  ['K5-R34', 3, 5, 60, null, true, 'PERCENT', 5],
  ['K5-R35', 54, 108, 50, null, true, 'PERCENT', 108],
  ['K5-R37', 30, 100, 30, null, true, 'PERCENT', 100],
  ['K5-R45', 0, 1, 0, 0, false, 'COUNT', 1],
];

// Literal pre-review metadata includes both count and estimated-denominator exceptions.
const oldMetadata = [
  ['K1-R8', 'S1:KLASTER I!A8:H8', 1, null, 'INTEGER', 'DOCUMENT'],
  ['K1-R12', 'S1:KLASTER I!A12:H12', null, null, 'INTEGER', 'COVERAGE'],
  ['K1-R85', 'S1:KLASTER I!A86:H86', 1, null, 'INTEGER', 'ATTAINMENT'],
  ['K2-R15', 'S1:KLASTER 2!A14:I14', null, 0.2, 'ESTIMATED', 'COVERAGE'],
  ['K2-R25', 'S1:KLASTER 2!A24:I24', null, 0.15, 'ESTIMATED', 'COVERAGE'],
  ['K2-R42', 'S1:KLASTER 2!A41:I41', null, 0.0455, 'ESTIMATED', 'COVERAGE'],
  ['K2-R50', 'S1:KLASTER 2!A49:I49', null, null, 'INTEGER', 'THRESHOLD'],
  ['K2-R51', 'S1:KLASTER 2!A50:I50', null, null, 'INTEGER', 'THRESHOLD'],
  ['K2-R52', 'S1:KLASTER 2!A51:I51', null, null, 'INTEGER', 'THRESHOLD'],
  ['K2-R75', 'S1:KLASTER 2!A74:I74', null, null, 'INTEGER', 'ATTAINMENT'],
  ['K3-R38', 'S1:KLASTER 3!A37:I37', null, null, 'INTEGER', 'BANDS'],
  ['K3-R40', 'S1:KLASTER 3!A39:I39', null, null, 'INTEGER', 'BANDS'],
  ['K3-R41', 'S1:KLASTER 3!A40:I40', null, null, 'INTEGER', 'BANDS'],
  ['K5-R19', 'S1:LINTAS KLASTER!A18:I18', 2, null, 'INTEGER', 'COVERAGE'],
  ['K5-R23', 'S1:LINTAS KLASTER!A22:I22', null, null, 'INTEGER', 'BANDS'],
  ['K5-R24', 'S1:LINTAS KLASTER!A23:I23', null, null, 'INTEGER', 'BANDS'],
  ['K5-R25', 'S1:LINTAS KLASTER!A24:I24', null, null, 'INTEGER', 'BANDS'],
  ['K5-R26', 'S1:LINTAS KLASTER!A25:I25', null, null, 'INTEGER', 'BANDS'],
  ['K5-R33', 'S1:LINTAS KLASTER!A32:I32', 4, null, 'INTEGER', 'COVERAGE'],
  ['K5-R34', 'S1:LINTAS KLASTER!A33:I33', 5, null, 'INTEGER', 'COVERAGE'],
  ['K5-R35', 'S1:LINTAS KLASTER!A34:I34', 108, null, 'INTEGER', 'COVERAGE'],
  ['K5-R37', 'S1:LINTAS KLASTER!A36:I36', null, null, 'INTEGER', 'COVERAGE'],
  ['K5-R45', 'S1:LINTAS KLASTER!A44:I44', 1, null, 'INTEGER', 'DOCUMENT'],
] as const;

test('independent old scorer and metadata fixtures cover each of the original 23 exactly once', () => {
  assert.deepEqual(sorted(oldScoring.map(([id]) => id)), sorted(oldIds));
  assert.deepEqual(sorted(oldMetadata.map(([id]) => id)), sorted(oldIds));
});

for (const [id, n, d, value, score, met, unit, effective] of oldScoring) {
  test(`${id} retains its independent pre-review scorer and cumulative fixture`, () => {
    const expected = [value, score, met, unit, effective, false, 'ARITHMETIC_ONLY', 'NOT_VERIFIED'];
    for (const annualRecapConfirmed of [undefined, false, true]) {
      const result = scoreDo2026(id, { numerator: n, denominator: d, annualRecapConfirmed });
      assert.deepEqual([result.measurementValue, result.nilaiKinerja, result.targetMet, result.measurementUnit,
        result.effectiveDenominator, result.assessmentComplete, result.completionScope, result.observationStatus], expected);
      assert.equal(result.status, score === null ? 'UNRESOLVED_RULE' : 'SCORED');
    }
    const result = evaluateDoCumulative(id, {
      months: [1, 2], records: [], recap: { ...recap(d), numerator: n, endMonth: 2 },
    });
    assert.deepEqual([result.measurementValue, result.nilaiKinerja, result.targetMet, result.measurementUnit,
      result.effectiveDenominator, result.assessmentComplete, result.completionScope, result.observationStatus], expected);
    assert.equal(result.aggregationMethod, 'EXPLICIT_YTD_RECAP');
    assert.equal(result.dataComplete, true);
  });
}

for (const [id, sourceRef, fixedDenominator, factor, denominatorInput, kind] of oldMetadata) {
  test(`${id} retains its independent pre-review metadata fixture`, () => {
    const profile = getDoProfile(id);
    assert.ok(profile);
    assert.equal(profile.sourceRef, sourceRef);
    assert.equal(profile.definitionId, `DO26-${sourceRef.startsWith('S1:KLASTER I!') ? 'K1' : id.split('-')[0]}-R${sourceRef.match(/!A(\d+):/)![1]}`);
    assert.equal(profile.sourceHash, 'c4baf039eb460c7ffe030b419973b78ce0739e6f92778fbb41f85f5d3ea22149');
    assert.equal(profile.fixedDenominator, fixedDenominator);
    assert.equal(DO_RULES[id]?.denominatorFactor ?? null, factor);
    assert.equal(profile.denominatorInput, denominatorInput);
    assert.equal(profile.numeratorInput, 'INTEGER');
    assert.equal(DO_RULES[id]?.scoring.kind, kind);
    assert.equal(profile.annualRecapOnly, false);
    assert.equal(DO_RULES[id]?.annualRecapOnly, undefined);
    assert.equal(profile.observationPeriod, ['K3-R40', 'K3-R41'].includes(id) ? 'CALENDAR_YEAR' : 'PROFILE_REVIEW_REQUIRED');
    assert.equal(profile.approvalStatus, 'PROVISIONAL_SOURCE_RULE');
    assert.equal(profile.status, 'IMPLEMENTED');
    assert.equal(profile.cumulativePolicy, 'EXPLICIT_YTD_REQUIRED');
    assert.equal(profile.reason, null);
  });
}

for (const [id, n, d, message] of [
  ['K3-R38', 90, 100, /tumpang tindih/], ['K3-R38', 70.5, 100, /celah rubrik/],
  ['K5-R23', 20.5, 100, /celah rubrik/], ['K5-R24', 8.5, 100, /celah rubrik/],
  ['K5-R25', 1.5, 100, /celah rubrik/], ['K5-R26', 2.65, 1, /celah rubrik/],
  ['K5-R26', 4.5, 1, /celah rubrik/], ['K5-R26', 7.5, 1, /celah rubrik/],
] as const) {
  test(`${id} preserves the original unresolved rubric at ${n}/${d}`, () => {
    const result = scoreDo2026(id, { numerator: n, denominator: d });
    assert.equal(result.nilaiKinerja, null);
    assert.equal(result.status, 'UNRESOLVED_RULE');
    assert.match(result.reason!, message);
    assert.equal(result.assessmentComplete, false);
  });
}

function serviceFixture(indicatorId: string) {
  const healthCenterId = '11111111-1111-4111-8111-111111111111';
  const actor: Actor = { id: 'admin', name: 'Admin', role: Role.ADMIN_PUSKESMAS, healthCenterId, sessionId: 'session', tokenVersion: 0 };
  const state = { assignedTo: 'pic', activeYear: 2026, yearLocked: false, lockedMonth: 0, active: true, transactions: 0 };
  let saved: PeriodRecap | null = null;
  const writes: string[] = [];
  const audits: unknown[] = [];
  const checkedMonths: number[] = [];
  const tx = {
    $queryRaw: async (strings: TemplateStringsArray) => strings.join('').includes('period_settings')
      ? [{ activeYear: state.activeYear, revision: 1 }]
      : [{ year: 2026, isLocked: state.yearLocked, cutoffDay: 10 }],
    periodLock: { findFirst: async (query: { where: { healthCenterId: string; year: number; OR: { periodNumber: number | { gte: number } }[] } }) => {
      assert.equal(query.where.healthCenterId, healthCenterId);
      assert.equal(query.where.year, 2026);
      const month = query.where.OR[0]!.periodNumber;
      assert.equal(typeof month, 'number');
      checkedMonths.push(month as number);
      return month === state.lockedMonth ? { id: 'protected' } : null;
    } },
    indicator: { findFirst: async (query: unknown) => {
      assert.deepEqual(query, { where: { id: indicatorId, isActive: true, section: { isActive: true } } });
      return state.active ? { id: indicatorId } : null;
    } },
    picAssignment: { findUnique: async (query: unknown) => {
      assert.deepEqual(query, { where: { healthCenterId_indicatorId_year: { healthCenterId, indicatorId, year: 2026 } } });
      return { picUserId: state.assignedTo };
    } },
    periodRecap: {
      findUnique: async (query: unknown) => {
        assert.deepEqual(query, { where: { healthCenterId_indicatorId_year_endMonth: { healthCenterId, indicatorId, year: 2026, endMonth: 12 } } });
        return saved;
      },
      create: async ({ data }: { data: Omit<PeriodRecap, 'id' | 'createdAt' | 'updatedAt' | 'numerator' | 'denominator' | 'structuredInput'> & { numerator: number; denominator: number; structuredInput: Prisma.InputJsonValue | typeof Prisma.DbNull } }) => {
        assert.equal(saved, null);
        writes.push('create');
        saved = { ...data, structuredInput: data.structuredInput === Prisma.DbNull ? null : data.structuredInput as Prisma.JsonValue, id: 'recap', numerator: new Prisma.Decimal(data.numerator), denominator: new Prisma.Decimal(data.denominator), createdAt: new Date('2026-12-31T00:00:00Z'), updatedAt: new Date('2026-12-31T00:00:00Z') };
        return saved;
      },
      update: async ({ data }: { data: Pick<PeriodRecap, 'notes' | 'confirmed' | 'scoringVersion' | 'updatedBy' | 'revision'> & { numerator: number; denominator: number; structuredInput: Prisma.InputJsonValue | typeof Prisma.DbNull } }) => {
        assert.ok(saved);
        writes.push('update');
        saved = { ...saved, ...data, structuredInput: data.structuredInput === Prisma.DbNull ? null : data.structuredInput as Prisma.JsonValue, numerator: new Prisma.Decimal(data.numerator), denominator: new Prisma.Decimal(data.denominator) };
        return saved;
      },
    },
    auditLog: { create: async (query: unknown) => { audits.push(query); return query; } },
    monthlyRecord: { create: () => assert.fail('annual recaps must not write monthly history'), update: () => assert.fail('annual recaps must not update monthly history') },
  };
  const db = { $transaction: async (run: (client: typeof tx) => unknown) => { state.transactions++; return run(tx); } } as unknown as DbService;
  const dto: SavePeriodRecapDto = { indicatorId, year: 2026, endMonth: 12, numerator: 0, denominator: fixedFixtures[indicatorId]?.denominator ?? 100, confirmed: true, expectedRevision: 0, notes: '  Independent full-year source register and deduplication attestation.  ' };
  return { service: new RecapsService(db), actor, dto, state, writes, audits, checkedMonths, healthCenterId };
}

for (const [id] of reviewedEntries) {
  test(`${id} recap service rejects every partial confirmed period and unconfirmed December before persistence`, async () => {
    const f = serviceFixture(id);
    for (let endMonth = 1; endMonth <= 11; endMonth++) {
      await assert.rejects(() => f.service.save(f.actor, { ...f.dto, endMonth }), badRequestCode('ANNUAL_RECAP_REQUIRED'));
    }
    // Deliberately bypass DTO validation: the service must also enforce confirmation.
    await assert.rejects(() => f.service.save(f.actor, { ...f.dto, confirmed: false } as unknown as SavePeriodRecapDto), badRequestCode('ANNUAL_RECAP_REQUIRED'));
    assert.deepEqual(f.writes, []);
    assert.deepEqual(f.audits, []);
  });

  test(`${id} recap service rejects corrupted counts before persistence or audit`, async () => {
    const f = serviceFixture(id);
    for (const [patch, expected] of [
      [{ numerator: 0.5 }, badRequestCode('INTEGER_NUMERATOR_REQUIRED')],
      [{ denominator: f.dto.denominator + 0.5 }, badRequestCode('INTEGER_DENOMINATOR_REQUIRED')],
      [{ numerator: -1 }, BadRequestException],
      [{ denominator: -1 }, BadRequestException],
      [{ numerator: NaN }, badRequestCode('INTEGER_NUMERATOR_REQUIRED')],
      [{ denominator: Infinity }, badRequestCode('INTEGER_DENOMINATOR_REQUIRED')],
      [{ numerator: f.dto.denominator + 1 }, BadRequestException],
      ...(fixedFixtures[id] ? [[{ denominator: f.dto.denominator + 1 }, BadRequestException] as const] : []),
    ] as const) {
      await assert.rejects(() => f.service.save(f.actor, { ...f.dto, ...patch }), expected);
      assert.deepEqual(f.writes, []);
      assert.deepEqual(f.audits, []);
    }
  });

  test(`${id} recap service accepts December independently, audits revisions, and rejects stale writes`, async () => {
    const f = serviceFixture(id);
    const first = await f.service.save(f.actor, f.dto);
    assert.equal(first.revision, 1);
    assert.equal(first.scoringVersion, 'DO_2026_V2');
    assert.equal(first.endMonth, 12);
    assert.equal(first.confirmed, true);
    assert.equal(first.healthCenterId, f.healthCenterId);
    assert.equal(first.notes, f.dto.notes.trim());
    assert.deepEqual(f.checkedMonths, yearMonths);
    await assert.rejects(() => f.service.save(f.actor, f.dto), ConflictException);
    const second = await f.service.save(f.actor, { ...f.dto, expectedRevision: 1, numerator: 1 });
    assert.equal(second.revision, 2);
    assert.equal(second.numerator.toNumber(), 1);
    assert.deepEqual(f.writes, ['create', 'update']);
    assert.equal(f.audits.length, 2);
    const events = f.audits as { data: { action: string; healthCenterId: string; details: { previous: null | { revision: number; numerator: string }; value: { revision: number; numerator: string } } } }[];
    assert.equal(events[0]!.data.action, 'PERIOD_RECAP_SAVED');
    assert.equal(events[0]!.data.healthCenterId, f.healthCenterId);
    assert.equal(events[0]!.data.details.previous, null);
    assert.equal(events[1]!.data.details.previous?.revision, 1);
    assert.equal(events[1]!.data.details.previous?.numerator, '0');
    assert.equal(events[1]!.data.details.value.revision, 2);
    assert.equal(events[1]!.data.details.value.numerator, '1');
  });
}

test('recap service enforces PIC assignment, tenant scope, and read-only Dinkes role with mocks only', async () => {
  const f = serviceFixture('K4-R17');
  const pic = { ...f.actor, id: 'pic', role: Role.PIC };
  f.state.assignedTo = 'another-pic';
  await assert.rejects(() => f.service.save(pic, f.dto), ForbiddenException);
  assert.deepEqual(f.writes, []);
  f.state.assignedTo = pic.id;
  const saved = await f.service.save(pic, f.dto);
  assert.equal(saved.updatedBy, pic.id);
  const transactions = f.state.transactions;
  assert.throws(() => f.service.save(f.actor, { ...f.dto, healthCenterId: '22222222-2222-4222-8222-222222222222' }), ForbiddenException);
  assert.throws(() => f.service.save({ ...f.actor, role: Role.DINKES_ADMIN }, { ...f.dto, healthCenterId: f.healthCenterId }), ForbiddenException);
  assert.equal(f.state.transactions, transactions, 'role and tenant checks precede transactions');
  assert.deepEqual(f.writes, ['create']);
});

test('annual recap service still validates count precision, fixed D, excess N, active year and protected months', async () => {
  for (const [id, patch, expected] of [
    ['K4-R17', { numerator: 0.5 }, badRequestCode('INTEGER_NUMERATOR_REQUIRED')],
    ['K4-R17', { denominator: 100.5 }, badRequestCode('INTEGER_DENOMINATOR_REQUIRED')],
    ['K4-R17', { numerator: 101 }, BadRequestException],
    ['K1-R55', { denominator: 4 }, BadRequestException],
  ] as const) {
    const f = serviceFixture(id);
    await assert.rejects(() => f.service.save(f.actor, { ...f.dto, ...patch }), expected);
    assert.deepEqual(f.writes, []);
    assert.deepEqual(f.audits, []);
  }
  for (const patch of [{ activeYear: 2027 }, { yearLocked: true }, { lockedMonth: 1 }]) {
    const f = serviceFixture('K4-R17');
    Object.assign(f.state, patch);
    await assert.rejects(() => f.service.save(f.actor, f.dto), ConflictException);
    assert.deepEqual(f.writes, []);
    assert.deepEqual(f.audits, []);
  }
  const inactive = serviceFixture('K4-R17');
  inactive.state.active = false;
  await assert.rejects(() => inactive.service.save(inactive.actor, inactive.dto), BadRequestException);
  assert.deepEqual(inactive.writes, []);
  const held = serviceFixture('K1-R9');
  await assert.rejects(() => held.service.save(held.actor, held.dto), BadRequestException);
  assert.deepEqual(held.writes, []);
});

test('reviewed integration never evaluates source narratives as JavaScript or substitutes a generic rule', async () => {
  for (const name of ['rules', 'reviewed-management', 'reviewed-clinical', 'reviewed-infectious-cross', 'review-holds', 'profiles', 'scorer', 'cumulative', 'period', 'input-validation']) {
    const text = await readFile(join(__dirname, '..', 'src', 'analytics', 'do2026', `${name}.ts`), 'utf8');
    assert.doesNotMatch(text, /\beval\s*\(|\b(?:new\s+)?Function\s*\(|\bvm\b.*(?:runIn|compileFunction)/);
  }
  const unknown = scoreDo2026('UNREVIEWED-UNKNOWN', { numerator: 100, denominator: 100, annualRecapConfirmed: true });
  assert.equal(unknown.status, 'UNRESOLVED_RULE');
  assert.equal(unknown.measurementValue, null);
  assert.equal(unknown.nilaiKinerja, null);
});
