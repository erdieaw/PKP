import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const catalogue = JSON.parse(await readFile(new URL('../prisma/seed-data/catalogue.json', import.meta.url), 'utf8'));
const schema = await readFile(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');
const migration = await readFile(new URL('../prisma/migrations/20261018000000_initial/migration.sql', import.meta.url), 'utf8');

test('catalogue contains exactly 272 operational indicators and 29 top-level sections', () => {
  assert.equal(catalogue.scoringVersion, 'ILP_2026_V1');
  assert.equal(catalogue.indicators.length, 272);
  assert.equal(new Set(catalogue.indicators.map(row => row.id)).size, 272);
  assert.equal(catalogue.sections.filter(row => row.parentCode === null).length, 29);
  const sections = new Map(catalogue.sections.map(row => [row.code, row]));
  for (const section of sections.values()) {
    if (section.parentCode !== null) {
      assert.ok(sections.has(section.parentCode));
      assert.equal(sections.get(section.parentCode).klasterId, section.klasterId);
      assert.equal(section.code.split('.').slice(0, -1).join('.'), section.parentCode);
    }
  }
  for (const row of catalogue.indicators) {
    assert.match(row.no, /^\d/);
    assert.ok(sections.has(row.sectionCode));
    assert.equal(sections.get(row.sectionCode).klasterId, row.klasterId);
    assert.equal(row.scoringVersion, 'ILP_2026_V1');
    assert.ok(['HIGHER_IS_BETTER', 'LOWER_IS_BETTER', 'TIERED_BRACKETS', 'BINARY'].includes(row.polarity));
    for (const key of ['targetNumeric', 'totalSasaranDefault', 'targetSasaranDefault']) {
      assert.ok(Number.isFinite(Number(row[key])) && Number(row[key]) >= 0);
    }
    assert.equal(row.capaianTw1Raw, undefined);
  }
});

test('all mapped models, unique indexes and declared foreign keys exist in migration', () => {
  const tables = [...schema.matchAll(/@@map\("([^"]+)"\)/g)].map(match => match[1]);
  assert.equal(tables.length, 14);
  for (const table of tables) assert.ok(migration.includes(`CREATE TABLE "${table}"`), table);
  for (const model of schema.matchAll(/model \w+ \{([\s\S]*?)\n\}/g)) {
    const body = model[1];
    const table = body.match(/@@map\("([^"]+)"\)/)[1];
    for (const unique of body.matchAll(/@@unique\(\[([^\]]+)\]\)/g)) {
      const columns = unique[1].split(',').map(value => value.trim());
      assert.ok(migration.includes(`CREATE UNIQUE INDEX "${table}_${columns.join('_')}_key"`));
    }
    for (const relation of body.matchAll(/@relation\([^\n]*fields: \[([^\]]+)\]/g)) {
      assert.ok(migration.includes(`CONSTRAINT "${table}_${relation[1]}_fkey"`));
    }
  }
  assert.match(migration, /BEFORE UPDATE OR DELETE OR TRUNCATE ON "audit_logs"/);
  assert.match(migration, /CREATE TRIGGER monthly_records_identity/);
});

test('seed has no frontend dependency or monthly-history writes', async () => {
  const seed = await readFile(new URL('../prisma/seed.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(seed, /src\/data|src\/services|monthlyRecord\.(create|upsert|update)/);
  assert.match(seed, /NODE_ENV !== 'production' && process\.env\.SEED_DEMO === 'true'/);
  assert.match(seed, /argon2id/);
});
