const compareText = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

export function compareNumericCodes(a: string, b: string): number {
  const valid = (value: string) => /^\d+(?:\.\d+)*$/.test(value);
  if (!valid(a) || !valid(b)) return Number(valid(b)) - Number(valid(a)) || compareText(a, b);
  const left = a.split('.');
  const right = b.split('.');
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    const x = left[i].replace(/^0+(?=\d)/, '');
    const y = right[i].replace(/^0+(?=\d)/, '');
    const difference = x.length - y.length || compareText(x, y);
    if (difference) return difference;
  }
  return left.length - right.length;
}

export function indicatorOrdinal(no: string): string | null {
  return typeof no === 'string' && /^\d+(?:\.|\.0+)?$/.test(no) ? no.replace(/\.(?:0*)$/, '') : null;
}

export function indicatorDisplayCode(indicator: { sectionCode: string; no: string }): string {
  return `${indicator.sectionCode}.${indicatorOrdinal(indicator.no) ?? indicator.no}`;
}

export function compareIndicators(a: { sectionCode: string; no: string; id: string }, b: { sectionCode: string; no: string; id: string }): number {
  const left = indicatorOrdinal(a.no);
  const right = indicatorOrdinal(b.no);
  return compareNumericCodes(a.sectionCode, b.sectionCode)
    || (left !== null && right !== null ? compareNumericCodes(left, right) : Number(right !== null) - Number(left !== null) || compareText(a.no, b.no))
    || compareText(a.id, b.id);
}
