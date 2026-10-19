import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../package.json', import.meta.url));
const { chromium } = require('playwright');
const password = process.env.FE_E2E_PASSWORD;
assert.ok(password && password.length >= 12, 'FE_E2E_PASSWORD must contain at least 12 characters.');
const frontend = process.env.FE_E2E_URL || 'http://localhost:5175';
const backend = (process.env.FE_E2E_API_URL || 'http://localhost:4000/api/v1').replace(/\/$/, '');
const data = payload => payload?.data ?? payload;
const items = payload => Array.isArray(payload) ? payload : payload.items;
const failures = [];
let browser;
let activePage;
let stage = 'isolated development fixture';
let fixture;

async function api(path, token, method = 'GET', body) {
  const response = await fetch(`${backend}${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  assert.ok(response.ok, `${method} ${path}: HTTP ${response.status}`);
  return data(await response.json());
}

async function ready(page) {
  await page.waitForFunction(centerId => {
    const year = document.querySelector('select[aria-label="Tahun anggaran"]');
    const center = document.querySelector('select[aria-label="Puskesmas"]');
    return year?.value === '2026' && !year.disabled && center?.value === centerId;
  }, fixture.healthCenterId);
  assert.equal(await page.getByRole('alert').count(), 0, 'Scope must load without errors.');
}

async function login(username, role) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const page = await context.newPage();
  activePage = page;
  page.setDefaultTimeout(30_000);
  page.on('pageerror', () => failures.push(`${role}: uncaught browser exception`));
  page.on('console', message => { if (message.type() === 'error') failures.push(`${role}: browser console error`); });
  page.on('response', response => {
    const path = new URL(response.url()).pathname;
    if (path.startsWith('/api/v1/') && response.status() >= 400) failures.push(`${role}: ${response.request().method()} ${path}: HTTP ${response.status()}`);
  });
  await page.goto(frontend);
  assert.equal(await page.getByRole('group', { name: 'Peran akun' }).count(), 0);
  await page.getByLabel(/Username|ID Staf/).fill(username);
  await page.getByLabel('Kata sandi', { exact: true }).fill(password);
  const loggedIn = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/auth/login') && response.request().method() === 'POST');
  await page.locator('form button[type="submit"]').click();
  const response = await loggedIn;
  assert.equal(response.status(), 200, `${role} browser login failed.`);
  const token = data(await response.json()).accessToken;
  await page.getByLabel('Puskesmas', { exact: true }).waitFor();
  if (role === 'Dinkes') {
    await page.getByLabel('Puskesmas', { exact: true }).selectOption(fixture.healthCenterId);
  }
  await ready(page);
  return { page, context, token };
}

async function sheet(page) {
  await page.getByRole('button', { name: 'Nilai Kinerja Resmi (Sheet 7)', exact: true }).click();
  await page.getByRole('button', { name: 'Triwulan I', exact: true }).click();
}

async function workflow(page, action, click) {
  const changed = page.waitForResponse(response => new URL(response.url()).pathname.endsWith(`/workflow/${action}`) && response.request().method() === 'POST');
  await click();
  const response = await changed;
  assert.equal(response.status(), 201, `${action} must persist through the real backend.`);
  const period = data(await response.json());
  assert.equal(period.healthCenterId, fixture.healthCenterId);
  assert.equal(period.periodNumber, 1);
  assert.equal(period.isQuarter, true);
  return period;
}

async function serverPeriod(token, expected) {
  const periods = items(await api(`/workflow/periods?year=2026&healthCenterId=${fixture.healthCenterId}`, token));
  const period = periods.find(row => row.isQuarter && row.periodNumber === 1);
  assert.equal(period?.status, expected);
  return period;
}

async function monthlyEditable(page, indicator, editable) {
  await page.getByRole('button', { name: 'Input Capaian Bulanan', exact: true }).click();
  await page.getByLabel('Bulan evaluasi', { exact: true }).selectOption('3');
  await page.getByPlaceholder('Cari kode, indikator, atau sub-klaster...').fill(indicator.indikator);
  const code = `${indicator.sectionCode}.${indicator.no.replace('.', '')}`;
  await page.getByRole('button', { name: `Rincian indikator ${code}`, exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Rincian indikator', exact: true });
  assert.equal(await drawer.getByLabel('Realisasi fisik', { exact: true }).isDisabled(), !editable);
  assert.equal(await drawer.getByRole('button', { name: 'Simpan Capaian', exact: true }).isDisabled(), !editable);
  await drawer.getByRole('button', { name: 'Tutup rincian indikator', exact: true }).click();
}

try {
  const seeded = await promisify(execFile)(fileURLToPath(new URL('../backend/node_modules/.bin/tsx', import.meta.url)), ['scripts/seed-workflow-browser.ts'], {
    cwd: fileURLToPath(new URL('../backend/', import.meta.url)), env: { ...process.env, NODE_ENV: 'development' },
  }).catch(() => { throw new Error('Isolated workflow fixture seed failed (details suppressed to protect credentials).'); });
  fixture = JSON.parse(seeded.stdout.trim());
  console.log(`Fixture: ${fixture.code} (${fixture.healthCenterId})`);
  stage = 'HTTP target and monthly preparation';
  const setup = await api('/auth/login', null, 'POST', { username: fixture.adminUsername, password });
  const catalogue = items(await api('/master/indicators', setup.accessToken));
  assert.equal(catalogue.length, 272);
  await api('/targets/annual/2026/bulk', setup.accessToken, 'PUT', {
    targets: catalogue.map(indicator => ({ indicatorId: indicator.id, totalSasaran: 120, targetPct: 100, targetSasaran: 120 })),
  });
  assert.equal(items(await api('/targets/annual/2026', setup.accessToken)).length, 272);
  for (const month of [1, 2, 3]) {
    await api('/records/monthly', setup.accessToken, 'PUT', {
      year: 2026, month, records: catalogue.map(indicator => ({ indicatorId: indicator.id, pencapaianRiil: 0 })),
    });
    const records = items(await api(`/records/monthly?year=2026&month=${month}`, setup.accessToken));
    assert.equal(records.length, 272);
    assert.ok(records.every(record => !record.isMissing && Number(record.pencapaianRiil) === 0), 'Explicit zero records must be persisted, not missing.');
  }

  browser = await chromium.launch({ headless: true });
  stage = 'Admin UI quarter submission';
  const admin = await login(fixture.adminUsername, 'Admin PKM');
  await monthlyEditable(admin.page, catalogue[0], true);
  await sheet(admin.page);
  await admin.page.getByRole('button', { name: 'Ajukan Laporan ke Dinkes', exact: true }).click();
  const submitted = await workflow(admin.page, 'submit', () => admin.page.getByRole('dialog', { name: 'Ajukan laporan kinerja', exact: true })
    .getByRole('button', { name: 'Ya, Ajukan & Kunci Data', exact: true }).click());
  assert.equal(submitted.status, 'SUBMITTED');
  await ready(admin.page);
  await sheet(admin.page);
  await admin.page.getByText('STATUS: MENUNGGU VERIFIKASI DINAS KESEHATAN', { exact: true }).waitFor();
  await serverPeriod(admin.token, 'SUBMITTED');
  await monthlyEditable(admin.page, catalogue[0], false);

  stage = 'Dinkes UI verification';
  const dinkes = await login(fixture.dinkesUsername, 'Dinkes');
  await sheet(dinkes.page);
  await dinkes.page.getByText('STATUS: MENUNGGU VERIFIKASI DINAS KESEHATAN', { exact: true }).waitFor();
  const verified = await workflow(dinkes.page, 'verify', () => dinkes.page.getByRole('button', { name: 'Sahkan & Kunci Nilai', exact: true }).click());
  assert.equal(verified.status, 'VERIFIED');
  assert.ok(verified.revision > submitted.revision);
  await ready(dinkes.page);
  await sheet(dinkes.page);
  await dinkes.page.getByText('STATUS: DIVERIFIKASI & DIKUNCI OLEH DINAS KESEHATAN', { exact: true }).waitFor();
  await serverPeriod(dinkes.token, 'VERIFIED');
  // Scope refreshes load all twelve months. Respect the real shared-IP limiter.
  console.log('Waiting 61 seconds for the backend request-rate window before further scope reloads.');
  await new Promise(resolve => setTimeout(resolve, 61_000));
  await admin.page.reload();
  await ready(admin.page);
  await monthlyEditable(admin.page, catalogue[0], false);

  stage = 'real worker XLSX and PDF exports';
  activePage = dinkes.page;
  for (const [format, button, extension, signature] of [
    ['excel', 'Unduh Excel (Sheet 7)', 'xlsx', 'PK'],
    ['pdf', 'Unduh PDF Resmi', 'pdf', '%PDF-'],
  ]) {
    await dinkes.page.getByRole('button', { name: 'Ekspor laporan', exact: true }).click();
    const modal = dinkes.page.getByRole('dialog', { name: 'Ekspor laporan PKP', exact: true });
    await modal.getByLabel('Periode laporan ekspor', { exact: true }).selectOption('1');
    const queued = dinkes.page.waitForResponse(response => new URL(response.url()).pathname.endsWith(`/export/${format}/sheet7`) && response.request().method() === 'POST');
    const completed = dinkes.page.waitForResponse(async response => {
      if (!/\/export\/jobs\/[^/]+$/.test(new URL(response.url()).pathname) || !response.ok()) return false;
      return data(await response.json()).status === 'COMPLETED';
    }, { timeout: 120_000 });
    await modal.getByRole('button', { name: button, exact: true }).click();
    const queuedResponse = await queued;
    assert.equal(queuedResponse.status(), 202);
    const jobId = data(await queuedResponse.json()).jobId;
    const completedResponse = await completed;
    assert.ok(new URL(completedResponse.url()).pathname.endsWith(`/${jobId}`));
    const link = modal.getByRole('link', { name: /^Unduh sheet7-/ });
    await link.waitFor();
    const downloading = dinkes.page.waitForEvent('download');
    await link.click();
    const download = await downloading;
    assert.equal(await download.failure(), null);
    const chunks = [];
    for await (const chunk of await download.createReadStream()) chunks.push(chunk);
    const bytes = Buffer.concat(chunks);
    assert.ok(bytes.length > 1000, `${extension} download must contain a real document.`);
    assert.equal(bytes.subarray(0, signature.length).toString(), signature);
    await download.saveAs(`/tmp/opencode/workflow-${fixture.code}.${extension}`);
    await modal.getByRole('button', { name: 'Tutup ekspor laporan', exact: true }).click();
  }

  stage = 'Dinkes UI reopen with explicit reason';
  const reason = `Workflow browser correction ${fixture.code}`;
  const promptHandled = new Promise((resolve, reject) => dinkes.page.once('dialog', async dialog => {
    try {
      assert.equal(dialog.type(), 'prompt');
      assert.equal(dialog.message(), 'Alasan membuka kunci revisi (wajib):');
      await dialog.accept(reason);
      resolve();
    } catch (error) { await dialog.dismiss().catch(() => {}); reject(error); }
  }));
  const reopened = await workflow(dinkes.page, 'reopen', () => dinkes.page.getByRole('button', { name: 'Buka Kunci Revisi', exact: true }).click());
  await promptHandled;
  assert.equal(reopened.status, 'REVISION_REQUIRED');
  assert.equal(reopened.revisionNote, reason);
  assert.ok(reopened.revision > verified.revision);
  assert.equal((await serverPeriod(dinkes.token, 'REVISION_REQUIRED')).revisionNote, reason);
  await ready(dinkes.page);
  await sheet(dinkes.page);
  await dinkes.page.getByText('STATUS: PERLU REVISI OLEH PUSKESMAS', { exact: true }).waitFor();
  activePage = admin.page;
  await admin.page.reload();
  await ready(admin.page);
  await monthlyEditable(admin.page, catalogue[0], true);

  stage = 'mobile navigation and overflow';
  activePage = admin.page;
  await admin.page.setViewportSize({ width: 390, height: 844 });
  await admin.page.getByRole('button', { name: 'Buka navigasi', exact: true }).click();
  await admin.page.getByRole('button', { name: 'Dashboard Kinerja PKP', exact: true }).click();
  await admin.page.getByRole('button', { name: 'Buka navigasi', exact: true }).waitFor();
  await admin.page.waitForFunction(() => document.documentElement.scrollWidth <= window.innerWidth);
  assert.ok(await admin.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Mobile dashboard must not overflow horizontally.');
  await admin.page.screenshot({ path: `/tmp/opencode/workflow-mobile-${fixture.code}.png`, fullPage: true });
  assert.deepEqual(failures, [], 'Browser/API errors were observed.');
  console.log('PASS: isolated HTTP fixtures, UI submit/verify/reopen, persisted locks, worker XLSX/PDF downloads, and mobile navigation.');
} catch (error) {
  if (activePage && !activePage.isClosed()) {
    await activePage.locator('input[type="password"]').fill('').catch(() => {});
    const screenshot = `/tmp/opencode/workflow-failure-${Date.now()}.png`;
    await activePage.screenshot({ path: screenshot, fullPage: true }).catch(() => {});
    console.error(`Failure screenshot: ${screenshot}`);
  }
  console.error(`FAIL at ${stage}: ${String(error.message).replaceAll(password, '[REDACTED]')}`);
  if (failures.length) console.error(failures.join('\n'));
  process.exitCode = 1;
} finally {
  await browser?.close();
}
