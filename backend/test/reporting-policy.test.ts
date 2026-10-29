import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConflictException } from '@nestjs/common';
import { guardReportingPolicy, reportingPolicy } from '../src/analytics/reporting-policy';

for (const year of [2026, 2027, 2100]) {
  test(`holds new official actions in ${year} independently of the input version`, () => {
    // Given / When / Then
    assert.throws(() => guardReportingPolicy(year), ConflictException);
  });
}

test('retains the historical workflow path before 2026', () => {
  // Given / When / Then
  assert.doesNotThrow(() => guardReportingPolicy(2025));
});

test('routes 2026 reports to internal evaluation without enabling official workflow', () => {
  // Given / When
  const policy = reportingPolicy(2026);
  // Then: this mode is consumed by report exports and the application notice.
  assert.equal(policy.operatingMode, 'INTERNAL_PHASED');
  assert.equal(policy.canSubmit, false);
  assert.equal(policy.canVerify, false);
});

test('historical report presentation remains distinct from the current internal mode', () => {
  // Given / When / Then
  assert.equal(reportingPolicy(2025).operatingMode, 'HISTORICAL_COMPATIBILITY');
});
