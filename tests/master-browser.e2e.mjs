import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes, randomInt } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const require = createRequire(new URL('../package.json', import.meta.url));
const { chromium, expect } = require('playwright/test');
const frontend = process.env.FE_E2E_URL || 'http://localhost:5175';
const backend = (process.env.FE_E2E_API_URL || 'http://localhost:4000/api/v1').replace(/\/$/, '');
const password = process.env.FE_E2E_PASSWORD || randomBytes(24).toString('base64url');
const newPassword = randomBytes(24).toString('base64url');
const suffix = randomBytes(12).toString('hex');
const indicatorId = `CUSTOM_MASTER_${suffix}`;
const sectionCode = `1.991${randomInt(100000000, 999999999)}`;
const name = `Master browser ${suffix}`;
const data = payload => payload?.data ?? payload;
const items = payload => Array.isArray(payload) ? payload : payload.items;
const failures = [];
const requests = [];
const secrets = [password, newPassword];
let browser;
let admin;
let activePage;
let fixture;
let stage = 'rebuilt backend readiness';
let cleanupNeeded = false;
let passed = false;

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function redact(message) {
  return secrets.reduce((text, secret) => text.replaceAll(secret, '[REDACTED]'), String(message));
}

// Catalog writes reload roughly thirty real requests. Reserve the whole refresh,
// rather than retrying mutations or hiding HTTP 429 failures.
async function budget(reserve = 40) {
  for (;;) {
    const recent = requests.filter(time => Date.now() - time < 61_000);
    if (recent.length + reserve <= 110) return;
    const wait = Math.max(1, recent[recent.length + reserve - 111] + 61_000 - Date.now());
    console.log(`Respecting shared-IP 120-request window: waiting ${Math.ceil(wait / 1000)}s.`);
    await delay(wait);
  }
}

async function api(path, token, method = 'GET', body, status = 200) {
  requests.push(Date.now());
  const response = await fetch(`${backend}${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30_000),
  });
  assert.equal(response.status, status, `${method} ${path}: unexpected HTTP ${response.status}`);
  return response.status === 204 ? undefined : data(await response.json());
}

async function ready(page, centerId = fixture.healthCenterId) {
  await page.waitForFunction(id => {
    const year = document.querySelector('select[aria-label="Tahun anggaran"]');
    const center = document.querySelector('select[aria-label="Puskesmas"]');
    return year?.value === '2026' && !year.disabled && center?.value === id;
  }, centerId);
  await expect(page.getByRole('alert')).toHaveCount(0);
}

async function login(username, role) {
  await budget(45);
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  activePage = page;
  page.setDefaultTimeout(30_000);
  page.on('pageerror', () => failures.push(`${role}: uncaught browser exception`));
  page.on('console', message => {
    if (message.type() === 'error') failures.push(redact(`${role}: browser console error: ${message.text()} (${message.location().url})`));
  });
  page.on('request', request => {
    if (new URL(request.url()).pathname.startsWith('/api/v1/')) requests.push(Date.now());
  });
  page.on('response', response => {
    const path = new URL(response.url()).pathname;
    if (path.startsWith('/api/v1/') && response.status() >= 400) failures.push(`${role}: ${response.request().method()} ${path}: HTTP ${response.status()}`);
  });
  page.on('dialog', async dialog => {
    if (dialog.type() !== 'confirm' || !dialog.message().includes('seluruh Puskesmas')) {
      failures.push(`${role}: unexpected native dialog`);
      await dialog.dismiss();
    } else await dialog.accept();
  });
  await page.goto(frontend);
  await expect(page.getByRole('group', { name: 'Peran akun' })).toHaveCount(0);
  await page.getByLabel(/Username|ID Staf/).fill(username);
  await page.getByLabel('Kata sandi', { exact: true }).fill(password);
  const responsePromise = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/auth/login') && response.request().method() === 'POST');
  await page.locator('form button[type="submit"]').click();
  const response = await responsePromise;
  assert.equal(response.status(), 200, `${role} UI login`);
  const session = data(await response.json());
  secrets.push(session.accessToken, session.refreshToken);
  assert.equal(session.user.role, role);
  await page.getByLabel('Puskesmas', { exact: true }).waitFor();
  if (role === 'DINKES_ADMIN') await page.getByLabel('Puskesmas', { exact: true }).selectOption(fixture.healthCenterId);
  await ready(page);
  await page.getByRole('button', { name: 'Pusat Data Master (CRUD)', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Kelola Master Data', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Tambah Indikator', exact: true })).toBeEnabled();
  return { page, context, token: session.accessToken };
}

async function mutation(page, path, method, click, status = 200) {
  const responsePromise = page.waitForResponse(response => new URL(response.url()).pathname === `/api/v1${path}` && response.request().method() === method);
  await click();
  const response = await responsePromise;
  assert.equal(response.status(), status, `${method} ${path} must persist on the real backend: ${response.status() === status ? '' : redact(await response.text())}`);
  const result = data(await response.json());
  await expect(page.getByRole('status').filter({ hasText: 'Katalog global berhasil diperbarui.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Muat Ulang', exact: true })).toBeEnabled();
  await ready(page);
  return result;
}

function row(page) {
  return page.getByRole('row').filter({ has: page.getByRole('cell', { name: indicatorId, exact: true }) });
}

async function persisted(token, expected) {
  const catalog = items(await api('/master/indicators?includeArchived=true', token));
  const indicator = catalog.find(entry => entry.id === indicatorId);
  assert.ok(indicator, 'Indicator retained in master catalog');
  for (const [key, value] of Object.entries(expected)) assert.equal(indicator[key], value, `Persisted ${key}`);
  return indicator;
}

try {
  assert.ok(password.length >= 12 && password.length <= 256, 'FE_E2E_PASSWORD must contain 12-256 characters.');
  const deadline = Date.now() + 120_000;
  let available = false;
  do {
    try {
      const response = await fetch(new URL('/api/docs-json', backend), { signal: AbortSignal.timeout(5000) });
      if (response.ok) {
        const docs = await response.json();
        available = Object.entries(docs.paths ?? {}).some(([path, methods]) => path.endsWith('/master/indicators') && methods.post);
      }
    } catch { /* The main process may still be rebuilding the backend. */ }
    if (!available) await delay(3000);
  } while (!available && Date.now() < deadline);
  assert.ok(available, 'Backend rebuild pending: Swagger does not expose POST /master/indicators. No fixture or browser test was run; rerun after main rebuild.');

  stage = 'isolated development fixture';
  const seeded = await promisify(execFile)(fileURLToPath(new URL('../backend/node_modules/.bin/tsx', import.meta.url)), ['scripts/seed-workflow-browser.ts'], {
    cwd: fileURLToPath(new URL('../backend/', import.meta.url)),
    env: { ...process.env, NODE_ENV: 'development', FE_E2E_PASSWORD: password },
  }).catch(() => { throw new Error('Workflow fixture seed failed (output suppressed to protect credentials).'); });
  fixture = JSON.parse(seeded.stdout.trim());
  console.log('Waiting 61s before login to avoid prior runs sharing the five-login IP window.');
  await delay(61_000);
  browser = await chromium.launch({ headless: true });
  stage = 'ADMIN UI login and global section creation';
  admin = await login(fixture.adminUsername, 'ADMIN_PUSKESMAS');
  const page = admin.page;
  try {
  await budget();
  await page.getByRole('button', { name: /^Master Klaster & Sub/ }).click();
  await page.getByRole('button', { name: 'Tambah Bagian', exact: true }).click();
  await page.getByLabel('Kode bagian', { exact: true }).fill(sectionCode);
  await page.getByLabel(/^Klaster/).selectOption('1');
  await page.getByLabel('Nama bagian', { exact: true }).fill(name);
  await page.getByLabel('Urutan', { exact: true }).fill('991');
  await expect(page.getByLabel('Induk langsung (otomatis dari kode)', { exact: false })).toHaveValue('');
  cleanupNeeded = true;
  await mutation(page, '/master/sections', 'POST', () => page.getByRole('button', { name: 'Simpan Global', exact: true }).click(), 201);
  await page.getByLabel('Cari katalog', { exact: true }).fill(sectionCode);
  await expect(page.getByRole('cell', { name, exact: true })).toBeVisible();
  const section = items(await api('/master/sections', admin.token)).find(entry => entry.code === sectionCode);
  assert.equal(section?.parentCode, null);
  assert.equal(section?.klasterId, 1);

  stage = 'ADMIN UI full indicator creation and monthly visibility';
  await budget();
  await page.getByRole('button', { name: /^Master Indikator/ }).click();
  await page.getByLabel('Cari katalog', { exact: true }).fill('');
  await page.getByRole('button', { name: 'Tambah Indikator', exact: true }).click();
  const fields = {
    'ID indikator': indicatorId, Nomor: '1', Kegiatan: `${name} activity`, Indikator: name,
    Satuan: '%', 'Tampilan target': '90%', 'Formula (metadata saja)': 'actual / target * 100',
    Catatan: `${name} notes`, 'Target numerik': '90', 'Total sasaran default': '100', 'Target sasaran default': '90',
  };
  for (const [label, value] of Object.entries(fields)) await page.getByLabel(label, { exact: true }).fill(value);
  await page.getByLabel(/^Klaster/).selectOption('1');
  await page.getByLabel(/^Bagian aktif/).selectOption(sectionCode);
  await page.getByLabel(/^Polaritas/).selectOption('HIGHER_IS_BETTER');
  await mutation(page, '/master/indicators', 'POST', () => page.getByRole('button', { name: 'Simpan Global', exact: true }).click(), 201);
  await page.getByLabel('Cari katalog', { exact: true }).fill(indicatorId);
  await expect(row(page)).toContainText(name);
  const created = await persisted(admin.token, { klasterId: 1, sectionCode, no: '1', kegiatan: fields.Kegiatan, indikator: name, satuan: '%', targetDisplay: '90%', polarity: 'HIGHER_IS_BETTER', notes: fields.Catatan });
  assert.equal(created.formulaRaw ?? created.formulaKinerjaRaw, fields['Formula (metadata saja)']);
  for (const [key, value] of Object.entries({ targetNumeric: 90, totalSasaranDefault: 100, targetSasaranDefault: 90 })) assert.equal(Number(created[key]), value, `Persisted ${key}`);
  assert.ok(items(await api('/records/monthly?year=2026&month=1', admin.token)).some(entry => entry.indicatorId === indicatorId), 'Own-center monthly API includes global indicator');
  await page.getByRole('button', { name: 'Input Capaian Bulanan', exact: true }).click();
  await page.getByPlaceholder('Cari kode, indikator, atau sub-klaster...').fill(name);
  await expect(page.getByRole('button', { name: `Rincian indikator ${sectionCode}.1`, exact: true })).toBeVisible();

  stage = 'ADMIN UI metadata edit';
  await page.getByRole('button', { name: 'Pusat Data Master (CRUD)', exact: true }).click();
  await page.getByLabel('Cari katalog', { exact: true }).fill(indicatorId);
  await budget();
  await row(page).getByRole('button', { name: 'Ubah', exact: true }).click();
  await page.getByLabel('Indikator', { exact: true }).fill(`${name} admin edited`);
  await page.getByLabel('Catatan', { exact: true }).fill('Admin metadata persisted');
  await mutation(page, `/master/indicators/${indicatorId}`, 'PATCH', () => page.getByRole('button', { name: 'Simpan Global', exact: true }).click());
  await expect(row(page)).toContainText(`${name} admin edited`);
  await persisted(admin.token, { indikator: `${name} admin edited`, notes: 'Admin metadata persisted' });

  stage = 'ADMIN UI archive and restore';
  await budget();
  await mutation(page, `/master/indicators/${indicatorId}`, 'DELETE', () => row(page).getByRole('button', { name: 'Arsipkan', exact: true }).click());
  await expect(row(page)).toHaveCount(0);
  assert.ok(!items(await api('/master/indicators', admin.token)).some(entry => entry.id === indicatorId));
  await page.getByLabel('Tampilkan arsip', { exact: true }).check();
  await expect(row(page).getByRole('cell', { name: 'Arsip', exact: true })).toBeVisible();
  await persisted(admin.token, { isActive: false });
  await budget();
  await mutation(page, `/master/indicators/${indicatorId}`, 'PATCH', () => row(page).getByRole('button', { name: 'Pulihkan', exact: true }).click());
  await expect(row(page).getByRole('cell', { name: 'Aktif', exact: true })).toBeVisible();
  await persisted(admin.token, { isActive: true });

  stage = 'Dinkes UI global metadata write and other-center catalog';
  const dinkes = await login(fixture.dinkesUsername, 'DINKES_ADMIN');
  const otherCenter = items(await api('/health-centers', dinkes.token)).find(center => center.id !== fixture.healthCenterId && center.isActive !== false);
  assert.ok(otherCenter, 'An independent center must exist to verify global catalog visibility');
  await budget(65);
  await dinkes.page.getByLabel('Puskesmas', { exact: true }).selectOption(otherCenter.id);
  await ready(dinkes.page, otherCenter.id);
  await dinkes.page.getByRole('button', { name: 'Pusat Data Master (CRUD)', exact: true }).click();
  await expect(dinkes.page.getByRole('button', { name: 'Tambah Indikator', exact: true })).toBeEnabled();
  await dinkes.page.getByLabel('Cari katalog', { exact: true }).fill(indicatorId);
  await expect(row(dinkes.page)).toContainText(`${name} admin edited`);
  await row(dinkes.page).getByRole('button', { name: 'Ubah', exact: true }).click();
  await dinkes.page.getByLabel('Indikator', { exact: true }).fill(`${name} Dinkes edited`);
  await dinkes.page.getByLabel('Catatan', { exact: true }).fill('Dinkes global metadata persisted');
  const changed = dinkes.page.waitForResponse(response => new URL(response.url()).pathname.endsWith(`/master/indicators/${indicatorId}`) && response.request().method() === 'PATCH');
  await dinkes.page.getByRole('button', { name: 'Simpan Global', exact: true }).click();
  assert.equal((await changed).status(), 200);
  await expect(dinkes.page.getByRole('status').filter({ hasText: 'Katalog global berhasil diperbarui.' })).toBeVisible();
  await expect(row(dinkes.page)).toContainText(`${name} Dinkes edited`);
  await ready(dinkes.page, otherCenter.id);
  await persisted(admin.token, { indikator: `${name} Dinkes edited`, notes: 'Dinkes global metadata persisted' });
  const monthly = items(await api(`/records/monthly?year=2026&month=1&healthCenterId=${otherCenter.id}`, dinkes.token));
  assert.ok(monthly.some(entry => entry.indicatorId === indicatorId), 'Other-center monthly API includes global indicator');
  await dinkes.page.getByRole('button', { name: 'Input Capaian Bulanan', exact: true }).click();
  await dinkes.page.getByPlaceholder('Cari kode, indikator, atau sub-klaster...').fill(`${name} Dinkes edited`);
  await expect(dinkes.page.getByRole('button', { name: `Rincian indikator ${sectionCode}.1`, exact: true })).toBeVisible();
  } catch (error) {
    console.error(redact(`FAIL at ${stage}: ${error.message}`));
    const screenshot = `/tmp/opencode/master-catalog-failure-${Date.now()}.png`;
    await activePage.locator('input[type="password"]').evaluateAll(inputs => {
      for (const input of inputs) input.value = '';
    }).catch(() => {});
    await activePage.screenshot({ path: screenshot, fullPage: true }).then(() => console.error(`Failure screenshot: ${screenshot}`)).catch(() => {});
    process.exitCode = 1;
    console.log('Continuing independent PIC reset checks; the catalog failure remains a test failure.');
  }

  stage = 'PIC fixture and initial HTTP session';
  const resetFailureStart = failures.length;
  await budget(50);
  const picUsername = `master.pic.${suffix}`;
  const picName = `Master PIC ${suffix}`;
  const pic = await api('/users/pics', admin.token, 'POST', { username: picUsername, password, name: picName, healthCenterId: fixture.healthCenterId }, 201);
  const oldSession = await api('/auth/login', null, 'POST', { username: picUsername, password });
  secrets.push(oldSession.accessToken, oldSession.refreshToken);
  assert.equal(oldSession.user.role, 'PIC');
  assert.equal((await api('/auth/me', oldSession.accessToken)).id, pic.id);

  stage = 'ADMIN UI PIC password reset and session revocation';
  activePage = page;
  // Refresh the existing ADMIN session, never log in again to discover the PIC.
  await page.reload();
  await ready(page);
  await page.getByRole('button', { name: 'Pusat Data Master (CRUD)', exact: true }).click();
  await page.getByRole('button', { name: 'Master Pengguna & Staf PIC', exact: true }).click();
  const resetButton = page.locator('div').filter({ has: page.getByText(picName, { exact: true }) }).filter({ has: page.getByRole('button', { name: 'Reset Password', exact: true }) }).last().getByRole('button', { name: 'Reset Password', exact: true });
  await resetButton.click();
  const dialog = page.getByRole('dialog', { name: `Reset password ${picName}`, exact: true });
  for (const label of ['Password baru', 'Konfirmasi password baru', 'Alasan reset password']) await expect(dialog.getByLabel(label, { exact: true })).toHaveAttribute('required', '');
  await dialog.getByLabel('Password baru', { exact: true }).fill(newPassword);
  await dialog.getByLabel('Konfirmasi password baru', { exact: true }).fill(newPassword);
  await dialog.getByLabel('Alasan reset password', { exact: true }).fill(`Browser session revocation ${suffix}`);
  await budget();
  const resetPromise = page.waitForResponse(response => new URL(response.url()).pathname.endsWith(`/users/${pic.id}/reset-password`) && response.request().method() === 'POST');
  await dialog.getByRole('button', { name: 'Reset Password dan Cabut Sesi', exact: true }).click();
  const resetResponse = await resetPromise;
  assert.equal(resetResponse.status(), 201);
  const reset = data(await resetResponse.json());
  assert.equal(reset.id, pic.id);
  assert.ok(reset.sessionsRevoked >= 1, 'Reset revokes the captured PIC session');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: `Password ${picName} berhasil direset.` })).toBeVisible();
  await ready(page);
  // Expected authentication failures stay in Node fetch, not browser error logs.
  await api('/auth/me', oldSession.accessToken, 'GET', undefined, 401);
  await api('/auth/refresh', null, 'POST', { refreshToken: oldSession.refreshToken }, 401);
  await api('/auth/login', null, 'POST', { username: picUsername, password }, 401);
  const newSession = await api('/auth/login', null, 'POST', { username: picUsername, password: newPassword });
  secrets.push(newSession.accessToken, newSession.refreshToken);
  assert.equal(newSession.user.role, 'PIC');
  assert.equal(newSession.user.id, pic.id);
  console.log('PASS: real PIC UI password reset, revoked access/refresh sessions, rejected old password, and new PIC login.');
  assert.deepEqual(failures.slice(resetFailureStart), [], 'Unexpected browser/API errors during PIC reset');
  if (!process.exitCode) assert.deepEqual(failures, [], 'Unexpected browser/API errors');
  passed = true;
} catch (error) {
  if (activePage && !activePage.isClosed()) {
    await activePage.locator('input[type="password"]').evaluateAll(inputs => {
      for (const input of inputs) input.value = '';
    }).catch(() => {});
    const screenshot = `/tmp/opencode/master-failure-${Date.now()}.png`;
    await activePage.screenshot({ path: screenshot, fullPage: true }).then(() => console.error(`Failure screenshot: ${screenshot}`)).catch(() => {});
    const labels = await activePage.locator('form label').evaluateAll(elements => elements.map(element => element.textContent)).catch(() => []);
    console.error(redact(`Visible form labels: ${JSON.stringify(labels)}`));
  }
  console.error(redact(`FAIL at ${stage}: ${error.message}`));
  if (failures.length) console.error(redact(failures.join('\n')));
  process.exitCode = 1;
} finally {
  await browser?.close();
  if (admin && cleanupNeeded) {
    try {
      await budget(8);
      const catalog = items(await api('/master/indicators?includeArchived=true', admin.token));
      if (catalog.some(entry => entry.id === indicatorId && entry.isActive !== false)) await api(`/master/indicators/${indicatorId}`, admin.token, 'DELETE');
      const sections = items(await api('/master/sections?includeArchived=true', admin.token));
      if (sections.some(entry => entry.code === sectionCode && entry.isActive !== false)) await api(`/master/sections/${sectionCode}`, admin.token, 'DELETE');
      if (catalog.some(entry => entry.id === indicatorId)) await persisted(admin.token, { isActive: false });
      const retained = items(await api('/master/sections?includeArchived=true', admin.token)).find(entry => entry.code === sectionCode);
      if (retained) assert.equal(retained.isActive, false);
      console.log('Cleanup: test indicator and section archived; fixture accounts and audit history retained.');
    } catch (error) {
      console.error(redact(`FAIL at authorized archive cleanup: ${error.message}`));
      process.exitCode = 1;
    }
  }
}
if (passed && !process.exitCode) console.log('PASS: real ADMIN/Dinkes global catalog CRUD, cross-center monthly visibility, and PIC password reset/session revocation.');
