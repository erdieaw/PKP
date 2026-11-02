import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { evaluateSourceAssessment, SOURCE_ASSESSMENT_DECISIONS, type SourceAssessmentInput } from './source-assessment';

export type PmeAnnualInput = {
  kind: 'PME_ANNUAL'; year: number;
  participations: { eventId: string; date: string; organizer: string; program: string; evidenceReference: string }[];
};
export type RtmAnnualInput = {
  kind: 'RTM_ANNUAL'; year: number;
  meetings: { meetingId: string; date: string; minutesReference: string }[];
  recommendations: {
    recommendationId: string; meetingId: string; description: string;
    followUpStatus: 'COMPLETED' | 'NOT_COMPLETED'; followUpDate?: string; followUpReference?: string;
  }[];
};
export type LroaAnnualInput = {
  kind: 'LROA_ANNUAL'; year: number; sourceReference: string; sourceCoverageComplete: true;
  months: {
    month: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
    reportStatus: 'COMPLETE' | 'INCOMPLETE' | 'ABSENT'; reportReference?: string;
    activityCounts: {
      rehydrationCounselling: number; diarrhoeaManagement: number; communityEducation: number;
      dehydrationTreatment: number; threeHourObservation: number; oralitPreparation: number;
    };
  }[];
};
export type SemesterSurveyAnnualInput = {
  kind: 'SEMESTER_SURVEY_ANNUAL'; year: number; scale: 'DOCUMENTED_100_POINT';
  scaleReference: string; methodCompatibilityReference: string; compatibleMethodsConfirmed: true;
  semesters: { semester: 1 | 2; value: number; methodReference: string; reportReference: string }[];
};
export type TbCohortAnnualInput = {
  kind: 'TB_COHORT_ANNUAL'; year: number;
  cohort: {
    type: 'TB_TREATED_RECORDED_REPORTED'; year: number; cohortReference: string;
    sourceSystem: 'SITB'; sourceReference: string; originalDenominator: number; successfulCount: number;
    outcomeDefinition: 'CURED_OR_TREATMENT_COMPLETED'; outcomeAssessmentReference: string;
    complete: true; originalDenominatorAndOutcomeLinkageAttested: true; distinctSuccessfulPatientsAttested: true;
  };
};
export type LeprosyCohortAnnualInput = {
  kind: 'LEPROSY_COHORT_ANNUAL'; year: number;
  cohorts: {
    type: 'PB' | 'MB'; year: number; cohortReference: string; sourceSystem: 'SIPK'; sourceReference: string;
    originalNewCaseStarts: number; completedCount: number; prescribedPeriodReference: string;
    outcomeAssessmentReference: string; matureAndComplete: true; originalDenominatorAndOutcomeLinkageAttested: true;
  }[];
};
export type RecapStructuredInput = PmeAnnualInput | RtmAnnualInput | LroaAnnualInput
  | SemesterSurveyAnnualInput | TbCohortAnnualInput | LeprosyCohortAnnualInput | SourceAssessmentInput;
export type StructuredInputKind = RecapStructuredInput['kind'];

// Identity, not mutable catalogue metadata or a client-supplied kind, selects the contract.
export const structuredInputKindFor = (id: string): StructuredInputKind | undefined =>
  id === 'K5-R38' ? 'PME_ANNUAL' : id === 'K1-R40' ? 'RTM_ANNUAL'
    : id === 'K2-R44' ? 'LROA_ANNUAL' : id === 'K1-R39' ? 'SEMESTER_SURVEY_ANNUAL'
      : id === 'K4-R16' ? 'TB_COHORT_ANNUAL' : id === 'K4-R20' ? 'LEPROSY_COHORT_ANNUAL'
        : Object.hasOwn(SOURCE_ASSESSMENT_DECISIONS, id) ? 'DO_SOURCE_ASSESSMENT' : undefined;

function invalid(message: string): never {
  throw new BadRequestException({ code: 'INVALID_STRUCTURED_INPUT', message });
}

/** References are user attestations, not proof that external documents exist or are valid. */
export function evaluateStructuredInput(indicatorId: string, value: unknown, year: number | undefined, endMonth?: number) {
  const kind = structuredInputKindFor(indicatorId);
  if (kind === 'DO_SOURCE_ASSESSMENT') return evaluateSourceAssessment(indicatorId, value, year, endMonth);
  if (!kind) invalid('Indikator ini tidak menerima structuredInput.');
  if (value === undefined || value === null) {
    throw new BadRequestException({ code: 'STRUCTURED_INPUT_REQUIRED', message: 'Ledger tahunan terstruktur wajib diisi; konfirmasi dan N/D saja tidak cukup.' });
  }
  const object = (input: unknown, required: string[], optional: string[] = []): Record<string, unknown> => {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.getPrototypeOf(input) !== Object.prototype) invalid('Objek ledger tidak valid.');
    const row = input as Record<string, unknown>;
    if (required.some(key => !Object.hasOwn(row, key)) || Object.keys(row).some(key => !required.includes(key) && !optional.includes(key))) invalid('Field ledger hilang atau tidak dikenal.');
    return row;
  };
  const text = (input: unknown, max = 500): string => {
    if (typeof input !== 'string' || !input.trim() || input.length > max || /[\u0000-\u001f\u007f]/.test(input)) invalid('Teks ledger wajib terisi dan tidak boleh melebihi batas atau memuat karakter kontrol.');
    return input.trim();
  };
  const normalized = (input: string) => input.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
  const date = (input: unknown): string => {
    if (typeof input !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input) || Number(input.slice(0, 4)) !== year) invalid('Tanggal harus YYYY-MM-DD dalam tahun rekap, tanpa carryover.');
    const parsed = new Date(`${input}T00:00:00.000Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== input) invalid('Tanggal kalender tidak valid.');
    return input;
  };
  const list = (input: unknown): unknown[] => {
    if (!Array.isArray(input) || input.length > 1000) invalid('Ledger harus berupa daftar maksimal 1000 entri.');
    return Array.from(input);
  };
  const unique = (seen: Set<string>, key: string) => {
    if (seen.has(key)) invalid('ID atau kegiatan/rapat duplikat setelah normalisasi.');
    seen.add(key);
  };
  const count = (input: unknown): number => {
    // Decimal(14,4) has ten integer digits; reject rather than round/truncate.
    if (typeof input !== 'number' || !Number.isSafeInteger(input) || input < 0 || input > 9_999_999_999) invalid('Count harus bilangan bulat nonnegatif, maksimal 9999999999, tanpa koersi.');
    return input;
  };
  const rootFields: Record<Exclude<StructuredInputKind, 'DO_SOURCE_ASSESSMENT'>, string[]> = {
    PME_ANNUAL: ['kind', 'year', 'participations'], RTM_ANNUAL: ['kind', 'year', 'meetings', 'recommendations'],
    LROA_ANNUAL: ['kind', 'year', 'sourceReference', 'sourceCoverageComplete', 'months'],
    SEMESTER_SURVEY_ANNUAL: ['kind', 'year', 'scale', 'scaleReference', 'methodCompatibilityReference', 'compatibleMethodsConfirmed', 'semesters'],
    TB_COHORT_ANNUAL: ['kind', 'year', 'cohort'], LEPROSY_COHORT_ANNUAL: ['kind', 'year', 'cohorts'],
  };
  const root = object(value, rootFields[kind]);
  if (root.kind !== kind || !Number.isInteger(year) || year! < 2026 || year! > 9999 || root.year !== year) invalid('Jenis ledger dan tahun harus sama dengan indikator dan lingkup rekap.');
  const ids = new Set<string>();
  const events = new Set<string>();
  if (kind === 'LROA_ANNUAL') {
    if (root.sourceCoverageComplete !== true) invalid('Cakupan sumber setahun penuh harus dikonfirmasi.');
    const months = list(root.months).map<LroaAnnualInput['months'][number]>(entry => {
      const row = object(entry, ['month', 'reportStatus', 'activityCounts'], ['reportReference']);
      const month = count(row.month);
      if (month < 1 || month > 12) invalid('Bulan harus 1 sampai 12.');
      unique(ids, String(month));
      if (row.reportStatus !== 'COMPLETE' && row.reportStatus !== 'INCOMPLETE' && row.reportStatus !== 'ABSENT') invalid('Status laporan LROA tidak valid.');
      const reportReference = Object.hasOwn(row, 'reportReference') ? text(row.reportReference, 1000) : undefined;
      if (row.reportStatus === 'COMPLETE' && !reportReference) invalid('Laporan lengkap wajib memiliki referensi.');
      const activities = object(row.activityCounts, ['rehydrationCounselling', 'diarrhoeaManagement', 'communityEducation', 'dehydrationTreatment', 'threeHourObservation', 'oralitPreparation']);
      const activityCounts = {
        rehydrationCounselling: count(activities.rehydrationCounselling), diarrhoeaManagement: count(activities.diarrhoeaManagement),
        communityEducation: count(activities.communityEducation), dehydrationTreatment: count(activities.dehydrationTreatment),
        threeHourObservation: count(activities.threeHourObservation), oralitPreparation: count(activities.oralitPreparation),
      };
      return { month: month as LroaAnnualInput['months'][number]['month'], reportStatus: row.reportStatus, ...(reportReference ? { reportReference } : {}), activityCounts };
    });
    if (months.length !== 12) invalid('Tepat dua belas slot bulan unik wajib diisi, termasuk laporan tidak lengkap/tidak ada.');
    const qualifies = (month: number) => months.some(row => row.month === month && row.reportStatus === 'COMPLETE' && Object.values(row.activityCounts).filter(value => value > 0).length >= 2);
    const numerator = [0, 1, 2, 3].filter(quarter => [1, 2, 3].every(offset => qualifies(quarter * 3 + offset))).length;
    const structuredInput: LroaAnnualInput = { kind, year: year!, sourceReference: text(root.sourceReference, 1000), sourceCoverageComplete: true, months };
    return { structuredInput, numerator, denominator: 4, prerequisiteMet: true };
  }
  if (kind === 'SEMESTER_SURVEY_ANNUAL') {
    if (root.scale !== 'DOCUMENTED_100_POINT' || root.compatibleMethodsConfirmed !== true) invalid('Skala 100 poin terdokumentasi dan kompatibilitas metode wajib dikonfirmasi; tanpa konversi otomatis.');
    const semesters = list(root.semesters).map<SemesterSurveyAnnualInput['semesters'][number]>(entry => {
      const row = object(entry, ['semester', 'value', 'methodReference', 'reportReference']);
      if (row.semester !== 1 && row.semester !== 2) invalid('Semester harus 1 atau 2.');
      unique(ids, String(row.semester));
      if (typeof row.value !== 'number' || !Number.isFinite(row.value) || row.value < 0 || row.value > 100 || new Prisma.Decimal(row.value).decimalPlaces() > 4) invalid('Nilai survei harus angka 0-100 dengan maksimal empat desimal, tanpa koersi/pembulatan.');
      return { semester: row.semester, value: row.value, methodReference: text(row.methodReference, 1000), reportReference: text(row.reportReference, 1000) };
    });
    if (semesters.length !== 2) invalid('Tepat dua semester unik dengan nilai dan bukti wajib diisi.');
    const structuredInput: SemesterSurveyAnnualInput = { kind, year: year!, scale: 'DOCUMENTED_100_POINT', scaleReference: text(root.scaleReference, 1000), methodCompatibilityReference: text(root.methodCompatibilityReference, 1000), compatibleMethodsConfirmed: true, semesters };
    const numerator = semesters.reduce((sum, row) => sum.plus(row.value), new Prisma.Decimal(0)).toNumber();
    return { structuredInput, numerator, denominator: 2, prerequisiteMet: true };
  }
  if (kind === 'TB_COHORT_ANNUAL') {
    const row = object(root.cohort, ['type', 'year', 'cohortReference', 'sourceSystem', 'sourceReference', 'originalDenominator', 'successfulCount', 'outcomeDefinition', 'outcomeAssessmentReference', 'complete', 'originalDenominatorAndOutcomeLinkageAttested', 'distinctSuccessfulPatientsAttested']);
    if (row.type !== 'TB_TREATED_RECORDED_REPORTED' || row.year !== year! - 1 || row.sourceSystem !== 'SITB' || row.outcomeDefinition !== 'CURED_OR_TREATMENT_COMPLETED' || row.complete !== true || row.originalDenominatorAndOutcomeLinkageAttested !== true || row.distinctSuccessfulPatientsAttested !== true) invalid('Kohort SITB tahun Y-1, hasil sembuh atau pengobatan lengkap, ketertautan denominator awal dan pasien berhasil berbeda wajib dikonfirmasi.');
    const originalDenominator = count(row.originalDenominator), successfulCount = count(row.successfulCount);
    if (successfulCount > originalDenominator) invalid('Pasien berhasil tidak boleh melebihi denominator awal kohort.');
    const structuredInput: TbCohortAnnualInput = { kind, year: year!, cohort: {
      type: row.type, year: row.year as number, cohortReference: text(row.cohortReference, 1000), sourceSystem: row.sourceSystem,
      sourceReference: text(row.sourceReference, 1000), originalDenominator, successfulCount, outcomeDefinition: row.outcomeDefinition,
      outcomeAssessmentReference: text(row.outcomeAssessmentReference, 1000), complete: true, originalDenominatorAndOutcomeLinkageAttested: true, distinctSuccessfulPatientsAttested: true,
    } };
    return { structuredInput, numerator: successfulCount, denominator: originalDenominator, prerequisiteMet: true };
  }
  if (kind === 'LEPROSY_COHORT_ANNUAL') {
    const cohorts = list(root.cohorts).map<LeprosyCohortAnnualInput['cohorts'][number]>(entry => {
      const row = object(entry, ['type', 'year', 'cohortReference', 'sourceSystem', 'sourceReference', 'originalNewCaseStarts', 'completedCount', 'prescribedPeriodReference', 'outcomeAssessmentReference', 'matureAndComplete', 'originalDenominatorAndOutcomeLinkageAttested']);
      if ((row.type !== 'PB' && row.type !== 'MB') || row.year !== year! - (row.type === 'PB' ? 1 : 2) || row.sourceSystem !== 'SIPK' || row.matureAndComplete !== true || row.originalDenominatorAndOutcomeLinkageAttested !== true) invalid('Kohort SIPK PB Y-1 dan MB Y-2 harus matang/lengkap dan tertaut pada denominator awal.');
      unique(ids, row.type);
      const originalNewCaseStarts = count(row.originalNewCaseStarts), completedCount = count(row.completedCount);
      if (completedCount > originalNewCaseStarts) invalid('Hasil selesai tidak boleh melebihi kasus baru awal pada setiap kohort.');
      return { type: row.type, year: row.year as number, cohortReference: text(row.cohortReference, 1000), sourceSystem: row.sourceSystem,
        sourceReference: text(row.sourceReference, 1000), originalNewCaseStarts, completedCount,
        prescribedPeriodReference: text(row.prescribedPeriodReference, 1000), outcomeAssessmentReference: text(row.outcomeAssessmentReference, 1000), matureAndComplete: true, originalDenominatorAndOutcomeLinkageAttested: true };
    });
    if (cohorts.length !== 2) invalid('Tepat satu kohort PB dan satu MB wajib diisi, termasuk komponen nihil eksplisit.');
    const structuredInput: LeprosyCohortAnnualInput = { kind, year: year!, cohorts };
    return { structuredInput, numerator: count(cohorts.reduce((sum, row) => sum + row.completedCount, 0)), denominator: count(cohorts.reduce((sum, row) => sum + row.originalNewCaseStarts, 0)), prerequisiteMet: true };
  }
  if (kind === 'PME_ANNUAL') {
    const participations = list(root.participations).map(entry => {
      const row = object(entry, ['eventId', 'date', 'organizer', 'program', 'evidenceReference']);
      const eventId = text(row.eventId, 100), eventDate = date(row.date);
      const organizer = text(row.organizer), program = text(row.program);
      unique(ids, normalized(eventId));
      unique(events, JSON.stringify([eventDate, normalized(organizer), normalized(program)]));
      return { eventId, date: eventDate, organizer, program, evidenceReference: text(row.evidenceReference, 1000) };
    });
    const structuredInput: PmeAnnualInput = { kind, year: year!, participations };
    return { structuredInput, numerator: participations.length, denominator: 2, prerequisiteMet: true };
  }
  const meetingDates = new Map<string, string>();
  const meetings = list(root.meetings).map(entry => {
    const row = object(entry, ['meetingId', 'date', 'minutesReference']);
    const meetingId = text(row.meetingId, 100), meetingDate = date(row.date), minutesReference = text(row.minutesReference, 1000);
    const key = normalized(meetingId);
    unique(ids, key);
    unique(events, JSON.stringify([meetingDate, normalized(minutesReference)]));
    meetingDates.set(key, meetingDate);
    return { meetingId, date: meetingDate, minutesReference };
  });
  ids.clear();
  const recommendations = list(root.recommendations).map<RtmAnnualInput['recommendations'][number]>(entry => {
    const row = object(entry, ['recommendationId', 'meetingId', 'description', 'followUpStatus'], ['followUpDate', 'followUpReference']);
    const recommendationId = text(row.recommendationId, 100), meetingId = text(row.meetingId, 100);
    unique(ids, normalized(recommendationId));
    const meetingDate = meetingDates.get(normalized(meetingId));
    if (!meetingDate) invalid('Rekomendasi harus terhubung ke rapat pada ledger tahun yang sama.');
    const description = text(row.description, 2000);
    if (row.followUpStatus !== 'COMPLETED' && row.followUpStatus !== 'NOT_COMPLETED') invalid('Status tindak lanjut tidak valid.');
    if (row.followUpStatus === 'NOT_COMPLETED') {
      if (Object.hasOwn(row, 'followUpDate') || Object.hasOwn(row, 'followUpReference')) invalid('Rekomendasi belum selesai tidak boleh memuat bukti/tanggal selesai.');
      return { recommendationId, meetingId, description, followUpStatus: row.followUpStatus };
    }
    const followUpDate = date(row.followUpDate);
    if (followUpDate < meetingDate) invalid('Tindak lanjut tidak boleh mendahului rapat.');
    return { recommendationId, meetingId, description, followUpStatus: row.followUpStatus, followUpDate, followUpReference: text(row.followUpReference, 1000) };
  });
  const structuredInput: RtmAnnualInput = { kind, year: year!, meetings, recommendations };
  return { structuredInput, numerator: recommendations.filter(row => row.followUpStatus === 'COMPLETED').length, denominator: recommendations.length, prerequisiteMet: meetings.length >= 2 };
}

export function assertStructuredCounts(derived: { numerator: number; denominator: number }, input: { numerator: Prisma.Decimal.Value; denominator: Prisma.Decimal.Value }) {
  try {
    if (new Prisma.Decimal(input.numerator).eq(derived.numerator) && new Prisma.Decimal(input.denominator).eq(derived.denominator)) return;
  } catch { /* Malformed stored counts also fail closed. */ }
  throw new BadRequestException({ code: 'STRUCTURED_COUNT_MISMATCH', message: 'N/D wajib sama dengan hasil ledger terstruktur; server menghitungnya dari entri, bukan angka agregat.' });
}
