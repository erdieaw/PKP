import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matchesMagic, MAX_UPLOAD_BYTES, validateUpload } from '../src/integrations/storage.validation';

test('upload validation sanitizes POSIX and Windows basenames and checks type and size', () => {
  assert.equal(validateUpload('../../report.pdf', 'application/pdf', 1), 'report.pdf');
  assert.equal(validateUpload('C:\\fakepath\\my report.JPG', 'image/jpeg', MAX_UPLOAD_BYTES), 'my_report.JPG');
  for (const size of [0, -1, 1.5, NaN, MAX_UPLOAD_BYTES + 1]) assert.throws(() => validateUpload('a.pdf', 'application/pdf', size));
  assert.throws(() => validateUpload('a.jpg', 'application/pdf', 10));
  assert.throws(() => validateUpload('a.exe', 'application/octet-stream', 10));
  assert.throws(() => validateUpload('pdf', 'application/pdf', 10));
});

test('magic validation accepts only the expected format prefixes', () => {
  const cases: [string, Buffer][] = [
    ['application/pdf', Buffer.from('%PDF-1.7')],
    ['image/png', Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])],
    ['image/jpeg', Buffer.from([255, 216, 255, 224])],
    ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', Buffer.from([80, 75, 3, 4])],
  ];
  for (const [type, prefix] of cases) {
    assert.equal(matchesMagic(type, prefix), true);
    assert.equal(matchesMagic(type, Buffer.from('<script>')), false);
    assert.equal(matchesMagic(type, prefix.subarray(0, 2)), false);
    for (const [other] of cases) if (other !== type) assert.equal(matchesMagic(other, prefix), false);
  }
  assert.equal(matchesMagic('application/octet-stream', Buffer.from('%PDF-')), false);
});
