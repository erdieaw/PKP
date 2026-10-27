import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true } });
try {
  const { compareIndicators, compareNumericCodes, indicatorOrdinal } = await server.ssrLoadModule('/src/services/indicatorOrder.ts');
  const { mappingDisplayRows, suggestProvinceMappings } = await server.ssrLoadModule('/src/services/provinceMapping.ts');
  const { mappingStatus, epSyncStatus, lastSyncText } = await server.ssrLoadModule('/src/services/integrationStatus.ts');
  const indicators = [
    { id: 'ten', sectionCode: '1.1', no: '10.' },
    { id: 'three', sectionCode: '1.1', no: '3.' },
    { id: 'section-ten', sectionCode: '1.10', no: '1.' },
    { id: 'two', sectionCode: '1.1', no: '2.' },
    { id: 'section-two', sectionCode: '1.2', no: '1.' },
    { id: 'one', sectionCode: '1.1', no: '1.0' },
  ];
  const original = structuredClone(indicators);
  const sorted = [...indicators].sort(compareIndicators);
  assert.deepEqual(sorted.map(i => i.id), ['one', 'two', 'three', 'ten', 'section-two', 'section-ten']);
  assert.deepEqual(indicators, original);
  for (const no of ['1', '1.', '1.0', '1.000']) assert.equal(indicatorOrdinal(no), '1');
  for (const no of ['1.2', '1junk', '1e1', '1..', ' 1.', '1.\n']) assert.equal(indicatorOrdinal(no), null);
  assert.ok(compareIndicators({ id: 'a', sectionCode: '1.1', no: '1.' }, { id: 'b', sectionCode: '1.1', no: '1.0' }) < 0);
  assert.deepEqual(['1.10', '1.2', '1.1.3', '1.1.1', '1.1.2'].sort(compareNumericCodes), ['1.1.1', '1.1.2', '1.1.3', '1.2', '1.10']);
  const ranks = new Map(sorted.map((i, index) => [i.id, index]));
  const mappings = [{ indicatorId: 'ten', provinceCode: '10' }, { indicatorId: 'one', provinceCode: '1' }, { indicatorId: 'two', provinceCode: '2' }];
  const rows = mappingDisplayRows(mappings, ranks);
  assert.deepEqual(rows.map(row => row.index), [1, 2, 0]);
  const editIndex = rows[0].index;
  assert.deepEqual(mappings.map((m, index) => index === editIndex ? { ...m, provinceCode: 'changed' } : m).map(m => m.provinceCode), ['10', 'changed', '2']);
  assert.deepEqual(mappings.filter((_, index) => index !== rows[2].index).map(m => m.indicatorId), ['one', 'two']);
  assert.equal(mappingStatus('three', mappings, mappings), 'Belum dipetakan');
  assert.equal(mappingStatus('one', mappings, mappings), 'Pemetaan tersimpan');
  assert.equal(mappingStatus('one', [], mappings), 'Pemetaan belum disimpan');
  assert.equal(mappingStatus('one', mappings, []), 'Pemetaan belum disimpan');
  assert.equal(epSyncStatus('SYNCED'), 'Status belum terverifikasi');
  assert.equal(epSyncStatus('PENDING_SYNC'), 'Belum disinkronkan');
  assert.equal(lastSyncText, 'Sinkron terakhir: Belum tersedia');
  const proposed = suggestProvinceMappings(indicators, [{ kd_ind: '1.01.01.01.10' }, { kd_ind: '1.01.01.01.01' }], []);
  assert.deepEqual(proposed.additions.map(m => m.indicatorId), ['ten', 'one'], 'Automatic mapping retains input order');
  const { pkpStore } = await server.ssrLoadModule('/src/services/apiStore.ts');
  pkpStore.state = { ...pkpStore.state, indicators };
  assert.deepEqual(pkpStore.getIndicators().map(i => i.id), sorted.map(i => i.id));
  assert.notEqual(pkpStore.getIndicators(true), indicators);
  assert.equal(pkpStore.getAllIndicatorsRaw(), indicators, 'Raw getter retains source identity and order');
  assert.deepEqual(indicators, original);
  console.log('EP ordering/status helpers passed: strict ordinals, hierarchical order, deterministic IDs, copies/raw invariants, original mapping indices and truthful statuses.');
} finally {
  await server.close();
}
