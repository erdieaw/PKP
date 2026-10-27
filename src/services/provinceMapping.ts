import type { ProvinceMapping } from '../types/province';
import { compareNumericCodes } from './indicatorOrder';

export function compareLocalEpRank(a: string, b: string, ranks: ReadonlyMap<string, number>): number {
  return (ranks.get(a) ?? Infinity) - (ranks.get(b) ?? Infinity) || compareNumericCodes(a, b);
}

export function mappingDisplayRows(mappings: readonly ProvinceMapping[], ranks: ReadonlyMap<string, number>) {
  return mappings.map((mapping, index) => ({ mapping, index }))
    .sort((a, b) => compareLocalEpRank(a.mapping.indicatorId, b.mapping.indicatorId, ranks) || a.index - b.index);
}

type LocalIndicator = {
  id: string;
  sectionCode?: string;
  no?: string;
  isHead?: boolean;
  isTableArtifact?: boolean;
  isActive?: boolean;
};

export function provinceCandidateCode(indicator: LocalIndicator): string | null {
  if (indicator.isHead || indicator.isTableArtifact || indicator.isActive === false) return null;
  if (typeof indicator.sectionCode !== 'string' || indicator.sectionCode.trim() !== indicator.sectionCode || !/^[1-5](?:\.\d+){0,3}$/.test(indicator.sectionCode)) return null;
  const levels = indicator.sectionCode.split('.').map(Number);
  if (levels.some(level => !Number.isInteger(level) || level < 1 || level > 99)) return null;
  if (typeof indicator.no !== 'string' || indicator.no.trim() !== indicator.no || !/^\d+(?:\.|\.0+)?$/.test(indicator.no)) return null;
  const ordinal = Number(indicator.no.replace(/\.$/, ''));
  if (!Number.isInteger(ordinal) || ordinal < 1 || ordinal > 99) return null;
  while (levels.length < 4) levels.push(1);
  return [...levels, ordinal].map((level, index) => index === 0 ? String(level) : String(level).padStart(2, '0')).join('.');
}

export function suggestProvinceMappings(
  indicators: readonly LocalIndicator[],
  targets: readonly { kd_ind: string }[],
  current: readonly ProvinceMapping[],
) {
  const counts = { proposed: 0, added: 0, unmatched: 0, ambiguous: 0, occupied: 0, invalid: 0 };
  const candidates = indicators.map(indicator => ({ indicator, code: provinceCandidateCode(indicator) }));
  const localCodes = new Map<string, number>();
  const localIds = new Map<string, number>();
  const remoteCodes = new Map<string, number>();
  for (const { indicator, code } of candidates) {
    localIds.set(indicator.id, (localIds.get(indicator.id) ?? 0) + 1);
    if (code !== null) localCodes.set(code, (localCodes.get(code) ?? 0) + 1);
  }
  for (const { kd_ind } of targets) remoteCodes.set(kd_ind, (remoteCodes.get(kd_ind) ?? 0) + 1);
  const usedIds = new Set(current.map(mapping => mapping.indicatorId));
  const usedCodes = new Set(current.map(mapping => mapping.provinceCode));
  const additions: ProvinceMapping[] = [];
  for (const { indicator, code } of candidates) {
    if (code === null || !indicator.id) { counts.invalid++; continue; }
    counts.proposed++;
    if (localCodes.get(code) !== 1 || localIds.get(indicator.id) !== 1 || (remoteCodes.get(code) ?? 0) > 1) { counts.ambiguous++; continue; }
    if (!remoteCodes.has(code)) { counts.unmatched++; continue; }
    if (usedIds.has(indicator.id) || usedCodes.has(code)) { counts.occupied++; continue; }
    additions.push({ indicatorId: indicator.id, provinceCode: code });
    usedIds.add(indicator.id); usedCodes.add(code);
    counts.added++;
  }
  // Existing pairs, including incomplete or conflicting manual drafts, are never replaced.
  return { mappings: [...current, ...additions], additions, counts };
}
