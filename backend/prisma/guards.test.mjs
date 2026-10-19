import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const sql = await readFile(new URL('./migrations/20261018000000_initial/migration.sql', import.meta.url), 'utf8');
const functionBody = name => {
  const match = sql.match(new RegExp(`CREATE FUNCTION ${name}\\([^]*?AS \\$\\$([^]*?)\\$\\$;`));
  assert.ok(match, `Missing SQL function ${name}`);
  return match[1];
};

test('upload identity excludes finalization fields and includes immutable metadata', () => {
  const trigger = sql.match(/CREATE TRIGGER uploads_identity[^\n]+/)[0];
  for (const field of ['id', 'healthCenterId', 'userId', 'year', 'month', 'filename', 'mimeType', 'sizeBytes']) {
    assert.ok(trigger.includes(`'${field}'`));
  }
  assert.doesNotMatch(trigger, /'objectKey'|'etag'/);
  const body = functionBody('protect_upload_finalization');
  assert.match(body, /OLD\."status" = 'PENDING' AND NEW\."status" = 'READY'/);
  assert.match(body, /OLD\."status" = 'READY' AND NEW\."status" = 'ATTACHED'/);
  assert.match(body, /NEW\."objectKey" IS DISTINCT FROM OLD\."objectKey" OR NEW\."etag" IS DISTINCT FROM OLD\."etag"/);
});

test('period guard locks year before periods and treats quarter as YTD', () => {
  const body = functionBody('assert_period_writable');
  const yearLock = body.indexOf('FROM "year_periods" WHERE "year" = period_year FOR UPDATE');
  const periods = body.indexOf('FROM "period_locks"');
  assert.ok(yearLock >= 0 && periods > yearLock);
  assert.match(body, /IF year_locked THEN/);
  assert.match(body, /"status" IN \('SUBMITTED', 'VERIFIED'\)/);
  assert.match(body, /NOT "isQuarter" AND "periodNumber" = period_month/);
  assert.match(body, /"isQuarter" AND period_month BETWEEN 1 AND "periodNumber" \* 3/);
  assert.match(sql, /monthly_records_guard BEFORE INSERT OR UPDATE OR DELETE/);
  const monthly = functionBody('protect_monthly_record_period');
  assert.match(monthly, /assert_period_writable\(OLD\."healthCenterId", OLD\."year", OLD\."month"\)/);
  assert.match(monthly, /assert_period_writable\(NEW\."healthCenterId", NEW\."year", NEW\."month"\)/);
});

test('annual targets reject locked edits but permit a lock-only transition', () => {
  const body = functionBody('protect_annual_target_period');
  assert.ok(body.indexOf('FOR UPDATE') < body.indexOf('IF OLD."isLocked"'));
  assert.match(body, /IF OLD\."isLocked" THEN\s+RAISE EXCEPTION/);
  assert.match(body, /IF NEW\."isLocked" AND/);
  assert.match(body, /\(to_jsonb\(NEW\) - 'isLocked' - 'updatedAt'\) = \(to_jsonb\(OLD\) - 'isLocked' - 'updatedAt'\)/);
  assert.match(body, /assert_period_writable\(OLD\."healthCenterId", OLD\."year", NULL\)/);
  assert.match(sql, /annual_targets_guard BEFORE INSERT OR UPDATE OR DELETE/);
});

test('assignment user validation checks role, active status and tenant under a row lock', () => {
  const body = functionBody('validate_pic_assignment_user');
  assert.match(body, /"id" = NEW\."picUserId"/);
  assert.match(body, /"healthCenterId" = NEW\."healthCenterId" AND "role" = 'PIC' AND "status" = 'ACTIVE'/);
  assert.match(body, /FOR SHARE/);
  assert.match(sql, /pic_assignments_user_check BEFORE INSERT OR UPDATE/);
});
