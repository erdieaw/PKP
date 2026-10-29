import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AnnualTarget, Indicator, MonthlyRecord, Section } from '@prisma/client';
import { calculateScore, output2, prorated, rollup, SCORING_VERSION } from './scoring';
import { evaluateDoPeriod } from './do2026/period';
import { DO_SCORING_VERSION } from './do2026/scorer';
import { getDoProfile } from './do2026/profiles';
import { evaluateDoCumulative, type DoRecap } from './do2026/cumulative';

type EvaluationData = {
  readonly indicators: readonly Indicator[]; readonly targets: readonly AnnualTarget[];
  readonly records: readonly MonthlyRecord[];
  readonly recaps?: readonly (DoRecap & { readonly indicatorId: string })[];
  readonly sections: (Omit<Section, 'isActive'> & { isActive?: boolean })[];
};

export function evaluateDataset(data: EvaluationData, months: number[]) {
  const targets = new Map(data.targets.map(target => [target.indicatorId, target]));
  const records = new Map(data.records.map(record => [`${record.indicatorId}:${record.month}`, record]));
  let populated = 0;
  const items = data.indicators.map(indicator => {
    const target = targets.get(indicator.id);
    const present = months.map(month => records.get(`${indicator.id}:${month}`)).filter((record): record is MonthlyRecord => record !== undefined);
    populated += present.length;
    const recap = months.every((month, index) => month === index + 1) ? data.recaps?.find(row => row.indicatorId === indicator.id && row.endMonth === months.length) : undefined;
    if (recap) return { indicator, indicatorId: indicator.id, ...evaluateDoCumulative(indicator.id, { records: present, months, recap }), do2026: getDoProfile(indicator.id) ?? null };
    if (present.some(record => record.scoringVersion === DO_SCORING_VERSION)) {
      return { indicator, indicatorId: indicator.id, ...evaluateDoPeriod(indicator.id, present, months), do2026: getDoProfile(indicator.id) ?? null };
    }
    if (present.some(record => record.scoringVersion && record.scoringVersion !== SCORING_VERSION)) throw new ConflictException('Unsupported record scoring version');
    const achievement = present.length ? present.reduce((sum, record) => sum.plus(record.pencapaianRiil), new Prisma.Decimal(0)).toNumber() : null;
    const hasAllMonths = present.length === months.length;
    let scored: ReturnType<typeof calculateScore> = { capaianRiilPct: null, nilaiKinerja: null, scoringVersion: indicator.scoringVersion, status: 'MISSING_DATA' };
    const denominator = target ? prorated(target.totalSasaran, months.length) : null;
    const targetSasaran = target ? prorated(target.targetSasaran, months.length) : null;
    if (target && (denominator === 0 || targetSasaran === 0 || Number(target.targetPct) === 0)) scored.status = 'NO_TARGET';
    else if (target && hasAllMonths && achievement !== null && denominator !== null) scored = calculateScore(indicator, achievement, denominator, Number(target.targetPct));
    else if (!target) scored.status = 'NO_TARGET';
    return {
      indicator, indicatorId: indicator.id, pencapaianRiil: achievement, totalSasaran: denominator, targetSasaran,
      ...scored, measurementValue: scored.capaianRiilPct, measurementUnit: 'PERCENT', reason: null,
      targetMet: null, inputBasis: 'MONTHLY_DELTA', do2026: null,
      effectiveDenominator: denominator,
      populatedMonths: present.length, expectedMonths: months.length, isComplete: hasAllMonths && scored.nilaiKinerja !== null,
    };
  });
  const containsDo = items.some(item => item.scoringVersion === DO_SCORING_VERSION);
  const rolled = rollup(data.sections, [...data.indicators], new Map(items.map(item => [item.indicatorId, item.nilaiKinerja])));
  return {
    ...rolled, containsDo, items, totalIndikator: items.length, populatedRecords: populated,
    completionRate: output2(items.length ? items.reduce((sum, item) => sum + item.populatedMonths / item.expectedMonths, 0) / items.length * 100 : 0),
  };
}
