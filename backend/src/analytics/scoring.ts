import { BadRequestException } from '@nestjs/common';
import { Polarity, Prisma } from '@prisma/client';

export const SCORING_VERSION = 'ILP_2026_V1';
export const round4 = (value: number): number => new Prisma.Decimal(value).toDecimalPlaces(4).toNumber();
export const output2 = (value: number | null): number | null => value === null ? null : new Prisma.Decimal(value).toDecimalPlaces(2).toNumber();

export function prorated(value: Prisma.Decimal.Value, months: number): number {
  return new Prisma.Decimal(value).mul(months).div(12).toDecimalPlaces(4).toNumber();
}

export function calculateScore(
  indicator: { id: string; polarity: Polarity; targetNumeric: Prisma.Decimal | number; scoringVersion: string },
  achievement: number, denominator: number, target: number,
): { capaianRiilPct: number | null; nilaiKinerja: number | null; scoringVersion: string; status: string } {
  const numeric = Number(indicator.targetNumeric);
  if ([achievement, denominator, target, numeric].some(value => !Number.isFinite(value) || value < 0)) {
    throw new BadRequestException('Scoring inputs must be finite and nonnegative');
  }
  if (indicator.scoringVersion !== SCORING_VERSION) throw new BadRequestException('Unsupported scoring version');
  const brackets: Record<string, number[]> = {
    'K3-R40': [15, 17.5, 20, 22.5], 'K3-R41': [3.5, 4.5, 7.5, 10],
    'K5-R23': [20, 40, 60, 80], 'K5-R24': [8, 20, 40, 60],
    'K5-R25': [1, 10, 20, 30], 'K5-R26': [2.6, 4, 7, 9],
  };
  if (indicator.polarity === Polarity.TIERED_BRACKETS && !brackets[indicator.id]) throw new BadRequestException('Unknown tiered indicator');
  if (!Object.values(Polarity).includes(indicator.polarity)) throw new BadRequestException('Unknown polarity');
  if (denominator === 0 || target === 0) return { capaianRiilPct: null, nilaiKinerja: null, scoringVersion: indicator.scoringVersion, status: 'NO_TARGET' };
  const ratio = new Prisma.Decimal(achievement).div(denominator);
  const pct = ratio.mul(100);
  let score: number;
  switch (indicator.polarity) {
    case Polarity.HIGHER_IS_BETTER:
      score = Prisma.Decimal.min(100, pct.div(target).mul(100)).toNumber();
      break;
    case Polarity.LOWER_IS_BETTER: {
      const threshold = indicator.id === 'K2-R50' ? new Prisma.Decimal('15.04')
        : indicator.id === 'K2-R52' ? new Prisma.Decimal(8) : new Prisma.Decimal(indicator.targetNumeric).mul(100);
      score = pct.lte(threshold) ? 100 : 0;
      break;
    }
    case Polarity.TIERED_BRACKETS: {
      const value = indicator.id === 'K5-R26' ? ratio : pct;
      const thresholds = brackets[indicator.id]!;
      const strictFirst = indicator.id === 'K3-R40' || indicator.id === 'K3-R41';
      const index = thresholds.findIndex((boundary, i) => i === 0 && strictFirst ? value.lt(boundary) : value.lte(boundary));
      score = index === -1 ? 0 : [100, 75, 50, indicator.id === 'K3-R40' ? 22.5 : 25][index]!;
      break;
    }
    case Polarity.BINARY:
      score = achievement >= target ? 100 : 0;
      break;
  }
  const capaianRiilPct = pct.toDecimalPlaces(4).toNumber();
  if (!Number.isFinite(capaianRiilPct)) throw new BadRequestException('Scoring result exceeds numeric range');
  return { capaianRiilPct, nilaiKinerja: round4(Math.max(0, Math.min(100, score))), scoringVersion: indicator.scoringVersion, status: 'SCORED' };
}

export function mean(values: (number | null)[]): number | null {
  const present = values.filter((value): value is number => value !== null);
  return present.length ? round4(present.reduce((sum, value) => sum + value, 0) / present.length) : null;
}

export function category(score: number | null): 'Kinerja Baik' | 'Kinerja Cukup' | 'Kinerja Kurang' | null {
  return score === null ? null : score >= 91 ? 'Kinerja Baik' : score >= 81 ? 'Kinerja Cukup' : 'Kinerja Kurang';
}

export function rollup(
  sections: { code: string; parentCode: string | null; klasterId: number }[],
  indicators: { id: string; sectionCode: string }[], scores: Map<string, number | null>,
) {
  const sectionScores: Record<string, number | null> = {};
  const complete: Record<string, boolean> = {};
  const visiting = new Set<string>();
  const visit = (code: string): number | null => {
    if (code in sectionScores) return sectionScores[code]!;
    if (visiting.has(code)) throw new BadRequestException('Cyclic section hierarchy');
    visiting.add(code);
    const direct = indicators.filter(indicator => indicator.sectionCode === code).map(indicator => scores.get(indicator.id) ?? null);
    const children = sections.filter(section => section.parentCode === code);
    const childScores = children.map(child => visit(child.code));
    const groups = [...(direct.length ? [mean(direct)] : []), ...childScores];
    sectionScores[code] = mean(groups);
    complete[code] = groups.length > 0 && direct.every(value => value !== null) && children.every(child => complete[child.code]) && groups.every(value => value !== null);
    visiting.delete(code);
    return sectionScores[code]!;
  };
  sections.forEach(section => visit(section.code));
  const klasterScores: Record<number, number | null> = {};
  const clusterComplete: boolean[] = [];
  for (let id = 1; id <= 5; id++) {
    const roots = sections.filter(section => section.klasterId === id && section.parentCode === null);
    klasterScores[id] = mean(roots.map(section => sectionScores[section.code]!));
    clusterComplete.push(roots.length > 0 && roots.every(section => complete[section.code]));
  }
  const isComplete = clusterComplete.every(Boolean) && indicators.every(indicator => sections.some(section => section.code === indicator.sectionCode) && scores.get(indicator.id) != null);
  return { sectionScores, sectionComplete: complete, klasterScores, nilaiKinerjaPuskesmas: mean(Object.values(klasterScores)), isComplete };
}
