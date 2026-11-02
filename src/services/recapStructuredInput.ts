import type { LroaAnnualInput, RecapLedgerDraft, AnnualStructuredInput as RecapStructuredInput } from '../types/do2026';

export const structuredInputKindFor = (id: string): RecapStructuredInput['kind'] | undefined =>
  id === 'K5-R38' ? 'PME_ANNUAL' : id === 'K1-R40' ? 'RTM_ANNUAL'
    : id === 'K2-R44' ? 'LROA_ANNUAL' : id === 'K1-R39' ? 'SEMESTER_SURVEY_ANNUAL'
      : id === 'K4-R16' ? 'TB_COHORT_ANNUAL' : id === 'K4-R20' ? 'LEPROSY_COHORT_ANNUAL' : undefined;

export const normalizeLedgerId = (value: string) => value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();

export function createRecapLedgerDraft(kind: RecapStructuredInput['kind'], year: number): RecapLedgerDraft {
  switch (kind) {
    case 'PME_ANNUAL': return { kind, year, participations: [] };
    case 'RTM_ANNUAL': return { kind, year, meetings: [], recommendations: [] };
    case 'LROA_ANNUAL': return { kind, year, sourceReference: '', sourceCoverageComplete: false,
      months: Array.from({ length: 12 }, (_, i) => ({ month: (i + 1) as LroaAnnualInput['months'][number]['month'], reportStatus: '', activityCounts: {
        rehydrationCounselling: '', diarrhoeaManagement: '', communityEducation: '', dehydrationTreatment: '', threeHourObservation: '', oralitPreparation: '',
      } })) };
    case 'SEMESTER_SURVEY_ANNUAL': return { kind, year, scale: 'DOCUMENTED_100_POINT', scaleReference: '', methodCompatibilityReference: '', compatibleMethodsConfirmed: false,
      semesters: ([1, 2] as const).map(semester => ({ semester, value: '', methodReference: '', reportReference: '' })) };
    case 'TB_COHORT_ANNUAL': return { kind, year, cohort: { type: 'TB_TREATED_RECORDED_REPORTED', year: year - 1, cohortReference: '', sourceSystem: 'SITB', sourceReference: '',
      originalDenominator: '', successfulCount: '', outcomeDefinition: 'CURED_OR_TREATMENT_COMPLETED', outcomeAssessmentReference: '', complete: false,
      originalDenominatorAndOutcomeLinkageAttested: false, distinctSuccessfulPatientsAttested: false } };
    case 'LEPROSY_COHORT_ANNUAL': return { kind, year, cohorts: (['PB', 'MB'] as const).map(type => ({ type, year: year - (type === 'PB' ? 1 : 2),
      cohortReference: '', sourceSystem: 'SIPK', sourceReference: '', originalNewCaseStarts: '', completedCount: '', prescribedPeriodReference: '',
      outcomeAssessmentReference: '', matureAndComplete: false, originalDenominatorAndOutcomeLinkageAttested: false })) };
  }
}

// Validate the wire shape as well as values: never discard unknown stored fields on save.
export function validateRecapLedger(value: unknown, kind: RecapStructuredInput['kind'], year: number): asserts value is RecapStructuredInput {
  function object(input: unknown, required: string[], optional: string[] = []): Record<string, unknown> {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.getPrototypeOf(input) !== Object.prototype) {
      throw new Error('Format ledger tidak dikenal. Muat ulang rekap; data tersimpan tidak diubah.');
    }
    const row = input as Record<string, unknown>;
    if (required.some(key => !Object.prototype.hasOwnProperty.call(row, key)) || Object.keys(row).some(key => !required.includes(key) && !optional.includes(key))) {
      throw new Error('Field ledger hilang atau tidak dikenal. Muat ulang rekap; data tersimpan tidak diubah.');
    }
    return row;
  }
  function text(input: unknown, label: string, max = 500): string {
    if (typeof input !== 'string' || !input.trim() || input.length > max || /[\u0000-\u001f\u007f]/.test(input)) {
      throw new Error(`${label} wajib terisi, maksimal ${max} karakter, tanpa karakter kontrol.`);
    }
    return input.trim();
  }
  function date(input: unknown, label: string): string {
    if (typeof input !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input) || Number(input.slice(0, 4)) !== year) {
      throw new Error(`${label} harus tanggal kalender dalam tahun rekap ${year}, tanpa carryover.`);
    }
    const parsed = new Date(`${input}T00:00:00.000Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== input) throw new Error(`${label} tidak valid.`);
    return input;
  }
  function list(input: unknown): unknown[] {
    if (!Array.isArray(input) || input.length > 1000) throw new Error('Setiap daftar ledger maksimal 1000 entri.');
    return Array.from(input);
  }
  function unique(seen: Set<string>, key: string, label: string) {
    if (seen.has(key)) throw new Error(`${label} duplikat setelah normalisasi. Periksa pencatatan ganda.`);
    seen.add(key);
  }
  function count(input: unknown): number {
    if (typeof input !== 'number' || !Number.isSafeInteger(input) || input < 0 || input > 9_999_999_999) throw new Error('Count harus bilangan bulat nonnegatif, maksimal 9999999999. Kosong bukan nol.');
    return input;
  }
  const rootFields: Record<RecapStructuredInput['kind'], string[]> = {
    PME_ANNUAL: ['kind', 'year', 'participations'], RTM_ANNUAL: ['kind', 'year', 'meetings', 'recommendations'],
    LROA_ANNUAL: ['kind', 'year', 'sourceReference', 'sourceCoverageComplete', 'months'],
    SEMESTER_SURVEY_ANNUAL: ['kind', 'year', 'scale', 'scaleReference', 'methodCompatibilityReference', 'compatibleMethodsConfirmed', 'semesters'],
    TB_COHORT_ANNUAL: ['kind', 'year', 'cohort'], LEPROSY_COHORT_ANNUAL: ['kind', 'year', 'cohorts'],
  };
  const root = object(value, rootFields[kind]);
  if (root.kind !== kind || root.year !== year || !Number.isInteger(year) || year < 2026 || year > 9999) {
    throw new Error('Jenis ledger dan tahun harus sesuai profil serta tahun rekap. Muat ulang rekap.');
  }
  const ids = new Set<string>(), events = new Set<string>();
  if (kind === 'LROA_ANNUAL') {
    text(root.sourceReference, 'Referensi sumber LROA', 1000);
    if (root.sourceCoverageComplete !== true) throw new Error('Konfirmasi cakupan sumber setahun penuh wajib diisi.');
    const months = list(root.months);
    months.forEach(entry => {
      const row = object(entry, ['month', 'reportStatus', 'activityCounts'], ['reportReference']);
      const month = count(row.month);
      if (month < 1 || month > 12) throw new Error('Bulan harus 1 sampai 12.');
      unique(ids, String(month), 'Bulan');
      if (!['COMPLETE', 'INCOMPLETE', 'ABSENT'].includes(row.reportStatus as string)) throw new Error('Status laporan LROA tidak valid.');
      if (Object.prototype.hasOwnProperty.call(row, 'reportReference')) text(row.reportReference, 'Referensi laporan', 1000);
      if (row.reportStatus === 'COMPLETE' && !row.reportReference) throw new Error('Laporan lengkap wajib memiliki referensi.');
      const activities = object(row.activityCounts, ['rehydrationCounselling', 'diarrhoeaManagement', 'communityEducation', 'dehydrationTreatment', 'threeHourObservation', 'oralitPreparation']);
      Object.values(activities).forEach(count);
    });
    if (months.length !== 12) throw new Error('Tepat dua belas slot bulan unik wajib diisi.');
    return;
  }
  if (kind === 'SEMESTER_SURVEY_ANNUAL') {
    if (root.scale !== 'DOCUMENTED_100_POINT' || root.compatibleMethodsConfirmed !== true) throw new Error('Skala 100 poin terdokumentasi dan kompatibilitas metode wajib dikonfirmasi; tanpa konversi otomatis.');
    text(root.scaleReference, 'Referensi skala', 1000);
    text(root.methodCompatibilityReference, 'Referensi kompatibilitas metode', 1000);
    const semesters = list(root.semesters);
    semesters.forEach(entry => {
      const row = object(entry, ['semester', 'value', 'methodReference', 'reportReference']);
      if (row.semester !== 1 && row.semester !== 2) throw new Error('Semester harus 1 atau 2.');
      unique(ids, String(row.semester), 'Semester');
      if (typeof row.value !== 'number' || !Number.isFinite(row.value) || row.value < 0 || row.value > 100 || !/^\d+(?:\.\d{1,4})?$/.test(String(row.value))) throw new Error('Nilai survei harus angka 0-100 dengan maksimal empat desimal, tanpa pembulatan.');
      text(row.methodReference, 'Referensi metode semester', 1000);
      text(row.reportReference, 'Referensi laporan semester', 1000);
    });
    if (semesters.length !== 2) throw new Error('Tepat dua semester unik wajib diisi.');
    return;
  }
  if (kind === 'TB_COHORT_ANNUAL') {
    const row = object(root.cohort, ['type', 'year', 'cohortReference', 'sourceSystem', 'sourceReference', 'originalDenominator', 'successfulCount', 'outcomeDefinition', 'outcomeAssessmentReference', 'complete', 'originalDenominatorAndOutcomeLinkageAttested', 'distinctSuccessfulPatientsAttested']);
    if (row.type !== 'TB_TREATED_RECORDED_REPORTED' || row.year !== year - 1 || row.sourceSystem !== 'SITB' || row.outcomeDefinition !== 'CURED_OR_TREATMENT_COMPLETED' || row.complete !== true || row.originalDenominatorAndOutcomeLinkageAttested !== true || row.distinctSuccessfulPatientsAttested !== true) throw new Error('Kohort SITB tahun Y-1, kelengkapan, ketertautan denominator awal dan pasien berhasil berbeda wajib dikonfirmasi.');
    if (count(row.successfulCount) > count(row.originalDenominator)) throw new Error('Pasien berhasil tidak boleh melebihi denominator awal kohort.');
    for (const key of ['cohortReference', 'sourceReference', 'outcomeAssessmentReference']) text(row[key], 'Referensi kohort/hasil TBC', 1000);
    return;
  }
  if (kind === 'LEPROSY_COHORT_ANNUAL') {
    const cohorts = list(root.cohorts);
    let numerator = 0, denominator = 0;
    cohorts.forEach(entry => {
      const row = object(entry, ['type', 'year', 'cohortReference', 'sourceSystem', 'sourceReference', 'originalNewCaseStarts', 'completedCount', 'prescribedPeriodReference', 'outcomeAssessmentReference', 'matureAndComplete', 'originalDenominatorAndOutcomeLinkageAttested']);
      if ((row.type !== 'PB' && row.type !== 'MB') || row.year !== year - (row.type === 'PB' ? 1 : 2) || row.sourceSystem !== 'SIPK' || row.matureAndComplete !== true || row.originalDenominatorAndOutcomeLinkageAttested !== true) throw new Error('Kohort SIPK PB Y-1 dan MB Y-2 harus matang/lengkap dan tertaut denominator awal.');
      unique(ids, row.type, 'Jenis kohort');
      if (count(row.completedCount) > count(row.originalNewCaseStarts)) throw new Error('Hasil selesai tidak boleh melebihi kasus baru awal pada setiap kohort.');
      numerator += count(row.completedCount); denominator += count(row.originalNewCaseStarts);
      for (const key of ['cohortReference', 'sourceReference', 'prescribedPeriodReference', 'outcomeAssessmentReference']) text(row[key], 'Referensi kohort/periode/hasil kusta', 1000);
    });
    if (cohorts.length !== 2) throw new Error('Tepat satu kohort PB dan satu MB wajib diisi, termasuk nihil eksplisit.');
    count(numerator); count(denominator);
    return;
  }
  if (kind === 'PME_ANNUAL') {
    list(root.participations).forEach((entry, index) => {
      const label = `Kegiatan ${index + 1}`;
      const row = object(entry, ['eventId', 'date', 'organizer', 'program', 'evidenceReference']);
      unique(ids, normalizeLedgerId(text(row.eventId, `${label}: ID`, 100)), 'ID kegiatan');
      const eventDate = date(row.date, `${label}: tanggal`);
      const organizer = text(row.organizer, `${label}: penyelenggara`), program = text(row.program, `${label}: program`);
      text(row.evidenceReference, `${label}: referensi sertifikat/hasil`, 1000);
      unique(events, JSON.stringify([eventDate, normalizeLedgerId(organizer), normalizeLedgerId(program)]), 'Kegiatan');
    });
    return;
  }
  const meetingDates = new Map<string, string>();
  list(root.meetings).forEach((entry, index) => {
    const label = `Rapat ${index + 1}`;
    const row = object(entry, ['meetingId', 'date', 'minutesReference']);
    const id = normalizeLedgerId(text(row.meetingId, `${label}: ID`, 100));
    const meetingDate = date(row.date, `${label}: tanggal`), reference = text(row.minutesReference, `${label}: referensi notulen`, 1000);
    unique(ids, id, 'ID rapat');
    unique(events, JSON.stringify([meetingDate, normalizeLedgerId(reference)]), 'Rapat');
    meetingDates.set(id, meetingDate);
  });
  ids.clear();
  list(root.recommendations).forEach((entry, index) => {
    const label = `Rekomendasi ${index + 1}`;
    const row = object(entry, ['recommendationId', 'meetingId', 'description', 'followUpStatus'], ['followUpDate', 'followUpReference']);
    unique(ids, normalizeLedgerId(text(row.recommendationId, `${label}: ID`, 100)), 'ID rekomendasi');
    const meetingDate = meetingDates.get(normalizeLedgerId(text(row.meetingId, `${label}: rapat`, 100)));
    if (!meetingDate) throw new Error(`${label}: pilih rapat yang ada pada ledger tahun yang sama.`);
    text(row.description, `${label}: uraian`, 2000);
    if (row.followUpStatus === 'NOT_COMPLETED') {
      if (Object.prototype.hasOwnProperty.call(row, 'followUpDate') || Object.prototype.hasOwnProperty.call(row, 'followUpReference')) throw new Error(`${label}: belum selesai tidak boleh memuat tanggal atau referensi selesai.`);
    } else if (row.followUpStatus === 'COMPLETED') {
      const followUpDate = date(row.followUpDate, `${label}: tanggal tindak lanjut`);
      if (followUpDate < meetingDate) throw new Error(`${label}: tindak lanjut tidak boleh mendahului rapat.`);
      text(row.followUpReference, `${label}: referensi tindak lanjut`, 1000);
    } else throw new Error(`${label}: status tindak lanjut tidak dikenal.`);
  });
}

export function recapLedgerCounts(ledger: RecapStructuredInput) {
  switch (ledger.kind) {
    case 'PME_ANNUAL': return { numerator: ledger.participations.length, denominator: 2 };
    case 'RTM_ANNUAL': return { numerator: ledger.recommendations.filter(row => row.followUpStatus === 'COMPLETED').length, denominator: ledger.recommendations.length };
    case 'LROA_ANNUAL': return { numerator: [0, 1, 2, 3].filter(quarter => [1, 2, 3].every(offset => ledger.months.some(row => row.month === quarter * 3 + offset && row.reportStatus === 'COMPLETE' && Object.values(row.activityCounts).filter(value => value > 0).length >= 2))).length, denominator: 4 };
    // Sum four-place integers before dividing, avoiding binary 0.1 + 0.2 artifacts in the payload.
    case 'SEMESTER_SURVEY_ANNUAL': return { numerator: ledger.semesters.reduce((sum, row) => sum + Math.round(row.value * 10000), 0) / 10000, denominator: 2 };
    case 'TB_COHORT_ANNUAL': return { numerator: ledger.cohort.successfulCount, denominator: ledger.cohort.originalDenominator };
    case 'LEPROSY_COHORT_ANNUAL': return { numerator: ledger.cohorts.reduce((sum, row) => sum + row.completedCount, 0), denominator: ledger.cohorts.reduce((sum, row) => sum + row.originalNewCaseStarts, 0) };
  }
}

export function parseRecapLedgerDraft(draft: RecapLedgerDraft): RecapStructuredInput {
  function scalar(value: number | string) {
    if (typeof value === 'number') return value;
    if (!/^\d+(?:\.\d{1,4})?$/.test(value)) throw new Error('Isi angka nonnegatif, maksimal empat desimal. Kosong bukan nol; nilai draft dipertahankan.');
    return Number(value);
  }
  const value: unknown = draft.kind === 'LROA_ANNUAL' ? { ...draft, months: draft.months.map(row => ({ ...row, activityCounts: Object.fromEntries(Object.entries(row.activityCounts).map(([key, count]) => [key, scalar(count)])) })) }
    : draft.kind === 'SEMESTER_SURVEY_ANNUAL' ? { ...draft, semesters: draft.semesters.map(row => ({ ...row, value: scalar(row.value) })) }
      : draft.kind === 'TB_COHORT_ANNUAL' ? { ...draft, cohort: { ...draft.cohort, originalDenominator: scalar(draft.cohort.originalDenominator), successfulCount: scalar(draft.cohort.successfulCount) } }
        : draft.kind === 'LEPROSY_COHORT_ANNUAL' ? { ...draft, cohorts: draft.cohorts.map(row => ({ ...row, originalNewCaseStarts: scalar(row.originalNewCaseStarts), completedCount: scalar(row.completedCount) })) } : draft;
  validateRecapLedger(value, draft.kind, draft.year);
  return value;
}
