import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AnnualTarget, HealthCenter, Indicator, MonthlyRecord, PeriodStatus, Prisma, Section } from '@prisma/client';
import { DbService } from '../core/db.service';
import { calculateScore, category, mean, output2, prorated, rollup, SCORING_VERSION } from './scoring';

type Dataset = {
  healthCenter: HealthCenter; sections: (Omit<Section, 'isActive'> & { isActive?: boolean })[]; indicators: Indicator[];
  targets: AnnualTarget[]; records: MonthlyRecord[];
};
type Loaded = Dataset & { source: string; status: PeriodStatus; isOfficial: boolean };

@Injectable()
export class AnalyticsService {
  constructor(private readonly db: DbService) {}

  private async load(healthCenterId: string, year: number, periodNumber: number, isQuarter: boolean): Promise<Loaded> {
    if (!healthCenterId || !Number.isInteger(year) || year < 2000 || year > 2100 || !Number.isInteger(periodNumber) || periodNumber < 1 || periodNumber > (isQuarter ? 4 : 12)) {
      throw new BadRequestException('Explicit tenant and valid year/period required');
    }
    return this.db.$transaction(async tx => {
      const lock = await tx.periodLock.findUnique({ where: { healthCenterId_year_periodNumber_isQuarter: { healthCenterId, year, periodNumber, isQuarter } } });
      const protectedLock = lock && (lock.status === 'VERIFIED' || lock.status === 'SUBMITTED') ? lock
        : !isQuarter ? await tx.periodLock.findFirst({
          where: { healthCenterId, year, isQuarter: true, periodNumber: { gte: Math.ceil(periodNumber / 3) }, status: { in: ['SUBMITTED', 'VERIFIED'] } },
          orderBy: { periodNumber: 'asc' },
        }) : null;
      if (protectedLock) {
        // JSON snapshots serialize Decimal values as strings. Rehydrate before scoring.
        const frozen = protectedLock.snapshot as unknown as Dataset & { schemaVersion: number; period: { healthCenterId: string; year: number; periodNumber: number; isQuarter: boolean } };
        if (!frozen || frozen.schemaVersion !== 1 || frozen.healthCenter?.id !== healthCenterId ||
          frozen.period?.healthCenterId !== healthCenterId || frozen.period.year !== year || frozen.period.periodNumber !== protectedLock.periodNumber || frozen.period.isQuarter !== protectedLock.isQuarter ||
          !Array.isArray(frozen.sections) || !Array.isArray(frozen.indicators) || !Array.isArray(frozen.targets) || !Array.isArray(frozen.records) ||
          frozen.targets.some(target => target.healthCenterId !== healthCenterId || target.year !== year) || frozen.records.some(record => record.healthCenterId !== healthCenterId || record.year !== year)) {
          throw new ConflictException('Protected period has no valid tenant-scoped schema v1 snapshot');
        }
        return {
          ...frozen,
          records: isQuarter ? frozen.records : frozen.records.filter(record => record.month === periodNumber),
          indicators: frozen.indicators.map(indicator => ({ ...indicator, targetNumeric: new Prisma.Decimal(indicator.targetNumeric) })),
          source: `${protectedLock.status}${!isQuarter && protectedLock.isQuarter ? '_QUARTER' : ''}_SNAPSHOT`,
          status: protectedLock.status, isOfficial: protectedLock.status === 'VERIFIED' && protectedLock.isQuarter === isQuarter,
        };
      }
      const healthCenter = await tx.healthCenter.findUnique({ where: { id: healthCenterId } });
      if (!healthCenter) throw new NotFoundException('Health center not found');
      const sections = await tx.section.findMany({ where: { isActive: true }, orderBy: [{ order: 'asc' }, { code: 'asc' }] });
      const indicators = await tx.indicator.findMany({ where: { isActive: true }, orderBy: { id: 'asc' } });
      const targets = await tx.annualTarget.findMany({ where: { healthCenterId, year } });
      const records = await tx.monthlyRecord.findMany({ where: { healthCenterId, year, month: isQuarter ? { lte: periodNumber * 3, gte: 1 } : periodNumber } });
      return { healthCenter, sections, indicators, targets, records, source: 'LIVE_DATABASE', status: lock?.status ?? 'DRAFT', isOfficial: false };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  private evaluate(data: Loaded, months: number[]) {
    const targets = new Map(data.targets.map(target => [target.indicatorId, target]));
    const records = new Map(data.records.map(record => [`${record.indicatorId}:${record.month}`, record]));
    let populated = 0;
    const items = data.indicators.map(indicator => {
      const target = targets.get(indicator.id);
      const present = months.map(month => records.get(`${indicator.id}:${month}`)).filter((record): record is MonthlyRecord => record !== undefined);
      populated += present.length;
      const achievement = present.length ? present.reduce((sum, record) => sum.plus(record.pencapaianRiil), new Prisma.Decimal(0)).toNumber() : null;
      const hasAllMonths = present.length === months.length;
      let scored: ReturnType<typeof calculateScore> = { capaianRiilPct: null, nilaiKinerja: null, scoringVersion: indicator.scoringVersion, status: 'MISSING_DATA' };
      const denominator = target ? prorated(target.totalSasaran, months.length) : null;
      const targetSasaran = target ? prorated(target.targetSasaran, months.length) : null;
      if (target && (denominator === 0 || targetSasaran === 0 || Number(target.targetPct) === 0)) scored.status = 'NO_TARGET';
      else if (target && hasAllMonths && achievement !== null) scored = calculateScore(indicator, achievement, denominator!, Number(target.targetPct));
      else if (!target) scored.status = 'NO_TARGET';
      return { indicator, indicatorId: indicator.id, pencapaianRiil: achievement, totalSasaran: denominator, targetSasaran, ...scored, populatedMonths: present.length, expectedMonths: months.length, isComplete: hasAllMonths && scored.nilaiKinerja !== null };
    });
    const rolled = rollup(data.sections, data.indicators, new Map(items.map(item => [item.indicatorId, item.nilaiKinerja])));
    return { ...rolled, items, totalIndikator: items.length, populatedRecords: populated, completionRate: output2(items.length ? populated / (items.length * months.length) * 100 : 0) };
  }

  async sheet7(healthCenterId: string, year: number, quarter: number | 'ANNUAL') {
    const q = quarter === 'ANNUAL' ? 4 : quarter;
    const data = await this.load(healthCenterId, year, q, true);
    const result = this.evaluate(data, Array.from({ length: q * 3 }, (_, index) => index + 1));
    const isOfficial = data.isOfficial && result.isComplete;
    const rows = Array.from({ length: 5 }, (_, index) => index + 1).flatMap(id => [
      { no: `${id}.0`, name: `Klaster ${id}`, isKlasterHead: true, klasterId: id, nilaiKlaster: output2(result.klasterScores[id]!) },
      ...data.sections.filter(section => section.klasterId === id).map(section => ({ no: section.code, name: section.name, isKlasterHead: false, klasterId: id, nilaiKelompok: output2(result.sectionScores[section.code]!), isComplete: result.sectionComplete[section.code] })),
    ]);
    return {
      healthCenterId, year, quarter, periodLabel: quarter === 'ANNUAL' ? 'Tahunan' : `Triwulan ${q} (YTD)`,
      puskesmasName: data.healthCenter.name, puskesmasCode: data.healthCenter.code, code: data.healthCenter.code,
      kepalaPuskesmas: data.healthCenter.headName, nipKepalaPuskesmas: data.healthCenter.headNip, nip: data.healthCenter.headNip,
      rows, klasterScores: Object.fromEntries(Object.entries(result.klasterScores).map(([key, value]) => [key, output2(value)])),
      nilaiKinerjaPuskesmas: output2(result.nilaiKinerjaPuskesmas), kategoriPKP: category(result.nilaiKinerjaPuskesmas),
      totalIndikator: result.totalIndikator, completionRate: result.completionRate, isComplete: result.isComplete, isOfficial,
      status: result.isComplete ? data.status : 'INCOMPLETE', periodStatus: data.status,
      source: data.source, scoringVersion: SCORING_VERSION, basis: 'YTD_CUMULATIVE_ANNUAL_TARGET_PRORATED',
      aggregation: 'EQUAL_WEIGHT_SECTION_HIERARCHY_THEN_FIVE_CLUSTERS', aggregateStatus: result.isComplete ? 'COMPLETE' : 'PARTIAL',
      targetFraction: q / 4, denominatorMode: 'ANNUAL_PRORATED_BY_COVERED_MONTHS',
      indicators: result.items.map(item => ({ ...item, pencapaianRiil: output2(item.pencapaianRiil), totalSasaran: output2(item.totalSasaran), targetSasaran: output2(item.targetSasaran), capaianRiilPct: output2(item.capaianRiilPct), nilaiKinerja: output2(item.nilaiKinerja) })),
    };
  }

  private async monthly(healthCenterId: string, year: number) {
    const months = [];
    for (let month = 1; month <= 12; month++) {
      const data = await this.load(healthCenterId, year, month, false);
      months.push({ month, data, result: this.evaluate(data, [month]) });
    }
    return months;
  }

  async annualTrend(healthCenterId: string, year: number, klasterId = 0) {
    const months = await this.monthly(healthCenterId, year);
    const allSections = new Map(months.flatMap(month => month.data.sections.map(section => [section.code, section] as const)));
    const overall = months.map(({ result }) => klasterId ? result.klasterScores[klasterId]! : result.nilaiKinerjaPuskesmas);
    const completed = months.map(({ data, result }) => {
      if (!klasterId) return result.isComplete;
      const roots = data.sections.filter(section => section.klasterId === klasterId && section.parentCode === null);
      return roots.length > 0 && roots.every(section => result.sectionComplete[section.code]);
    });
    const annualAveragePKP = mean(overall.filter((_value, index) => completed[index]));
    const available = overall.flatMap((score, index) => completed[index] && score !== null ? [{ month: index + 1, name: new Date(Date.UTC(year, index)).toLocaleString('id-ID', { month: 'long', timeZone: 'UTC' }), score: output2(score) }] : []);
    return {
      healthCenterId, year, klasterId, basis: 'MONTHLY_ANNUAL_TARGET_DIVIDED_BY_12', denominatorMode: 'ANNUAL_DIVIDED_BY_12',
      aggregation: 'ARITHMETIC_MEAN_COMPLETED_MONTHS_NOT_CUMULATIVE_OFFICIAL', scoringVersion: SCORING_VERSION,
      source: months.map(month => month.data.source), isOfficial: false, isComplete: completed.every(Boolean), status: completed.every(Boolean) ? 'COMPLETE' : 'INCOMPLETE',
      aggregateStatus: completed.every(Boolean) ? 'COMPLETE' : 'PARTIAL',
      monthlyOverallScores: overall.map(output2), monthlyComplete: completed,
      monthlySubmittedCount: months.map(({ data, result }) => ['SUBMITTED', 'VERIFIED'].includes(data.status) ? result.items.filter(item => !klasterId || item.indicator.klasterId === klasterId).filter(item => item.isComplete).length : 0),
      monthlyCategories: overall.map(category), monthlyStatuses: months.map(month => month.data.status),
      annualAveragePKP: output2(annualAveragePKP), annualCategoryPKP: category(annualAveragePKP), completedMonths: completed.filter(Boolean).length,
      highestMonth: [...available].sort((a, b) => b.score! - a.score!)[0] ?? null,
      lowestMonth: [...available].sort((a, b) => a.score! - b.score!)[0] ?? null,
      klasters: Array.from({ length: 5 }, (_, index) => index + 1).filter(id => !klasterId || id === klasterId).map(id => {
        const scores = months.map(month => month.result.klasterScores[id]!);
        const average = mean(scores.filter((_score, index) => {
          const sections = months[index]!.data.sections.filter(section => section.klasterId === id && section.parentCode === null);
          return sections.length > 0 && sections.every(section => months[index]!.result.sectionComplete[section.code]);
        }));
        return { klasterId: id, name: `Klaster ${id}`, monthlyScores: scores.map(output2), annualAverage: output2(average), category: category(average) };
      }),
      subKlasters: [...allSections.values()].filter(section => !klasterId || section.klasterId === klasterId).map(section => {
        const scores = months.map(month => month.result.sectionScores[section.code] ?? null);
        const average = mean(scores.filter((_score, index) => months[index]!.result.sectionComplete[section.code]));
        return { code: section.code, name: section.name, klasterId: section.klasterId, indicatorCount: months[11]!.data.indicators.filter(indicator => indicator.sectionCode === section.code || indicator.sectionCode.startsWith(`${section.code}.`)).length, monthlyScores: scores.map(output2), annualAverage: output2(average), category: category(average) };
      }),
    };
  }

  async indicatorTrends(healthCenterId: string, year: number, klasterId = 0) {
    const months = await this.monthly(healthCenterId, year);
    const indicators = new Map(months.flatMap(month => month.data.indicators.map(indicator => [indicator.id, indicator] as const)));
    return {
      healthCenterId, year, basis: 'MONTHLY_ANNUAL_TARGET_DIVIDED_BY_12', aggregation: 'ARITHMETIC_MEAN_POPULATED_SCORED_MONTHS',
      scoringVersion: SCORING_VERSION, source: months.map(month => month.data.source), isOfficial: false,
      isComplete: months.every(month => month.result.isComplete),
      status: months.every(month => month.result.isComplete) ? 'COMPLETE' : 'INCOMPLETE',
      aggregateStatus: months.every(month => month.result.isComplete) ? 'COMPLETE' : 'PARTIAL',
      items: [...indicators.values()].filter(indicator => !klasterId || indicator.klasterId === klasterId).map(indicator => {
        const items = months.map(month => month.result.items.find(item => item.indicatorId === indicator.id));
        const scores = items.map(item => item?.nilaiKinerja ?? null);
        const pct = items.map(item => item?.capaianRiilPct ?? null);
        const average = mean(scores);
        return { indicator, monthlyValues: items.map(item => output2(item?.pencapaianRiil ?? null)), monthlyPct: pct.map(output2), monthlyScores: scores.map(output2), annualAverageScore: output2(average), annualAveragePct: output2(mean(pct)), category: category(average), isComplete: items.every(item => item?.isComplete === true), monthlyStatus: items.map(item => item?.status ?? 'MISSING_DATA'), monthlyIndicators: items.map(item => item?.indicator ?? null) };
      }),
    };
  }

  async dashboard(healthCenterId: string, year: number, quarter: number | 'ANNUAL', compare = false) {
    const summary = await this.sheet7(healthCenterId, year, quarter);
    if (!compare) return summary;
    const centers = await this.db.healthCenter.findMany({ where: { isActive: true }, select: { id: true }, orderBy: { code: 'asc' } });
    const comparison = [];
    for (const center of centers) comparison.push(center.id === healthCenterId ? summary : await this.sheet7(center.id, year, quarter));
    return { ...summary, comparison };
  }
}
