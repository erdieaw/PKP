import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// This is the only catalogue step allowed to read frontend source.
const source = await readFile(new URL('../../src/data/indicators.ts', import.meta.url), 'utf8');
const rows = JSON.parse(source.slice(source.indexOf('= [') + 2, source.lastIndexOf(']') + 1));
const master = await readFile(new URL('../../src/services/mockState.ts', import.meta.url), 'utf8');
const block = master.slice(master.indexOf('export const INITIAL_SUB_KLASTERS:'), master.indexOf('export const INITIAL_RECOMMENDATIONS:'));
const sections = [...block.matchAll(/klasterId: (\d+), code: '([^']+)', name: '([^']+)'/g)]
  .map(([, klasterId, code, name]) => ({ code, name, klasterId: Number(klasterId), parentCode: null }));
if (sections.length !== 29) throw new Error(`Expected 29 top-level sections, got ${sections.length}`);
const byCode = new Map(sections.map(section => [section.code, section]));
const operational = rows.filter(row => /^\d/.test(row.no.trim()));
if (operational.length !== 272) throw new Error(`Expected 272 operational indicators, got ${operational.length}`);
for (const row of operational) {
  const parts = row.sectionCode.split('.');
  if (parts.length < 2 || !byCode.has(parts.slice(0, 2).join('.'))) {
    throw new Error(`Unknown top-level section for ${row.id}: ${row.sectionCode}`);
  }
  for (let depth = 3; depth <= parts.length; depth++) {
    const code = parts.slice(0, depth).join('.');
    const name = code === row.sectionCode
      ? row.section.replace(/^\s*\d+(?:\.\d+)*\.?\s*/, '').trim()
      : `Subbagian ${code}`;
    const previous = byCode.get(code);
    if (!previous || previous.name.startsWith('Subbagian ')) {
      byCode.set(code, { code, name, klasterId: row.klasterId, parentCode: parts.slice(0, depth - 1).join('.') });
    }
  }
}
const indicators = operational.map(row => ({
  id: row.id, klasterId: row.klasterId, sectionCode: row.sectionCode, no: row.no,
  kegiatan: row.kegiatan, indikator: row.indikator, satuan: row.satuan,
  targetDisplay: row.targetDisplay, targetNumeric: String(row.targetNumeric),
  totalSasaranDefault: String(row.totalSasaranDefault), targetSasaranDefault: String(row.targetSasaranDefault),
  polarity: row.polarity, scoringVersion: 'ILP_2026_V1',
  formulaRaw: row.formulaKinerjaRaw, notes: row.notes || null,
}));
if (new Set(indicators.map(row => row.id)).size !== indicators.length) throw new Error('Duplicate indicator IDs');
const sorted = [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code, 'en', { numeric: true }))
  .map((section, order) => ({ ...section, order }));
const catalogue = { scoringVersion: 'ILP_2026_V1', sections: sorted, indicators };
const output = new URL('../prisma/seed-data/catalogue.json', import.meta.url);
await writeFile(output, `${JSON.stringify(catalogue, null, 2)}\n`);
console.log(`Imported ${indicators.length} indicators and ${sorted.length} sections into ${fileURLToPath(output)}`);
