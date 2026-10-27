import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true } });
try {
  const { provinceCandidateCode: candidate, suggestProvinceMappings: suggest } = await server.ssrLoadModule('/src/services/provinceMapping.ts');
  const local = (id, sectionCode = '1.1', no = '1.', extra = {}) => ({ id, sectionCode, no, ...extra });
  for (const [section, no, expected] of [
    ['1.1', '1.', '1.01.01.01.01'], ['1.5.6', '1.0', '1.05.06.01.01'],
    ['1.8.1.2', '3.', '1.08.01.02.03'], ['2.2.1', '10.', '2.02.01.01.10'],
    ['5', '99.000', '5.01.01.01.99'], ['1.1', '1', '1.01.01.01.01'],
  ]) assert.equal(candidate(local('K1-R8', section, no)), expected);
  for (const no of ['1.1', '1junk', '1.0junk', '1..', '1.00.', '-1', '0', '100', '1e1', ' 1.', '1.\n', '']) {
    assert.equal(candidate(local('id', '1.1', no)), null, no);
  }
  for (const section of ['0.1', '6.1', '1.0', '1.100', '1.1.1.1.1', '1..1', '1.a', '01.1', '1.1.', '']) {
    assert.equal(candidate(local('id', section)), null, section);
  }
  for (const extra of [{ isHead: true }, { isTableArtifact: true }, { isActive: false }]) assert.equal(candidate(local('id', '1.1', '1.', extra)), null);
  const indicators = [local('K1-R8'), local('second', '1.5.6', '1.0'), local('missing', '1.10'), local('duplicate-a', '2.1'), local('duplicate-b', '2.1'), local('remote-duplicate', '3.1'), local('occupied-id', '4.1'), local('occupied-code', '5.1'), local('head', '1.2', '1.', { isHead: true })];
  const targets = indicators.map(i => ({ kd_ind: candidate(i) })).filter(t => t.kd_ind && !t.kd_ind.startsWith('1.10'));
  targets.push({ kd_ind: candidate(indicators[5]) });
  const current = [{ indicatorId: 'occupied-id', provinceCode: '001-A' }, { indicatorId: 'manual', provinceCode: candidate(indicators[7]) }, { indicatorId: '', provinceCode: '' }];
  const original = structuredClone({ indicators, targets, current });
  const result = suggest(indicators, targets, current);
  assert.deepEqual(result.counts, { proposed: 8, added: 2, unmatched: 1, ambiguous: 3, occupied: 2, invalid: 1 });
  assert.deepEqual(result.mappings.slice(0, current.length), current);
  assert.deepEqual(result.additions, [{ indicatorId: 'K1-R8', provinceCode: '1.01.01.01.01' }, { indicatorId: 'second', provinceCode: '1.05.06.01.01' }]);
  assert.deepEqual({ indicators, targets, current }, original, 'Inputs are not mutated');
  assert.equal(suggest(indicators, targets, result.mappings).counts.added, 0, 'Rerun is idempotent');
  assert.equal(suggest([local('same'), local('same', '2.1')], [{ kd_ind: '1.01.01.01.01' }, { kd_ind: '2.01.01.01.01' }], []).counts.ambiguous, 2);
  assert.equal(suggest([local('id')], [{ kd_ind: ' 1.01.01.01.01' }, { kd_ind: '1.1.1.1.1' }], []).counts.unmatched, 1, 'Remote codes are not normalized');
  console.log('Province mapping helper: conversion, validation, uniqueness, preservation, exact matching and idempotence passed.');
} finally {
  await server.close();
}
