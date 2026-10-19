import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../package.json', import.meta.url));
const { chromium } = require('playwright');
const password = process.env.FE_E2E_PASSWORD;
assert.ok(password && password.length >= 12, 'FE_E2E_PASSWORD must contain at least 12 characters.');
const frontend = process.env.FE_E2E_URL || 'http://localhost:5175';
const backend = (process.env.FE_E2E_API_URL || 'http://localhost:4000/api/v1').replace(/\/$/, '');
const browser = await chromium.launch({ headless: true });
const failures = [];
let activePage;
let stage = 'startup';
const data = payload => payload?.data ?? payload;
const items = payload => Array.isArray(payload) ? payload : payload.items;

async function ready(page) {
  await page.getByLabel('Tahun anggaran', { exact: true }).waitFor();
  await page.waitForFunction(() => {
    const year = document.querySelector('select[aria-label="Tahun anggaran"]');
    const center = document.querySelector('select[aria-label="Puskesmas"]');
    return year?.value === '2026' && !year.disabled && Boolean(center?.value);
  });
  assert.equal(await page.getByRole('alert').count(), 0, 'Application must load without an error alert.');
}

async function login(username, role) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  activePage = page;
  page.setDefaultTimeout(30_000);
  page.on('pageerror', () => failures.push(`${username}: uncaught browser exception`));
  page.on('console', message => {
    if (message.type() === 'error') failures.push(`${username}: browser console error`);
  });
  page.on('response', response => {
    if (new URL(response.url()).pathname.startsWith('/api/v1/') && response.status() >= 400) {
      failures.push(`${username}: ${response.request().method()} ${new URL(response.url()).pathname} returned ${response.status()}`);
    }
  });
  await page.goto(frontend);
  assert.equal(await page.getByRole('group', { name: 'Peran akun' }).count(), 0);
  await page.getByLabel(/Username|ID Staf/).fill(username);
  await page.getByLabel('Kata sandi', { exact: true }).fill(password);
  const responsePromise = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/auth/login') && response.request().method() === 'POST');
  await page.locator('form button[type="submit"]').click();
  const response = await responsePromise;
  assert.ok(response.ok(), `${username}: login failed (${response.status()}).`);
  await ready(page);
  return { context, page };
}

async function get(page, path, authorization) {
  assert.ok(authorization?.startsWith('Bearer '), 'Expected the real browser request authorization header.');
  const response = await page.request.get(`${backend}${path}`, { headers: { authorization } });
  assert.ok(response.ok(), `Verification GET ${path.split('?')[0]} failed (${response.status()}).`);
  return data(await response.json());
}

async function monthly(page, indicator, month = '1') {
  await page.getByRole('button', { name: 'Input Capaian Bulanan', exact: true }).click();
  await page.getByLabel('Bulan evaluasi', { exact: true }).selectOption(month);
  await page.getByPlaceholder('Cari kode, indikator, atau sub-klaster...').fill(indicator.indikator);
  const code = `${indicator.sectionCode}.${indicator.no.replace('.', '')}`;
  await page.getByRole('button', { name: `Rincian indikator ${code}`, exact: true }).waitFor();
  return code;
}

try {
  stage = 'admin login and targets';
  const { context: adminContext, page: admin } = await login('fe.admin', 'Admin PKM');
  const centerId = await admin.getByLabel('Puskesmas', { exact: true }).inputValue();
  assert.equal(await admin.getByLabel('Puskesmas', { exact: true }).isDisabled(), true);
  assert.equal(await admin.getByLabel('Puskesmas', { exact: true }).locator('option').count(), 1);
  assert.match(await admin.getByLabel('Puskesmas', { exact: true }).textContent(), /FE-E2E-001/);
  // Observe a genuine scope reload rather than logging in a second time for API checks.
  const targetRead = admin.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/targets/annual/2026' && response.request().method() === 'GET');
  await admin.reload();
  const targetResponse = await targetRead;
  assert.ok(targetResponse.ok());
  let authorization = await targetResponse.request().headerValue('authorization');
  await ready(admin);
  const targets = items(data(await targetResponse.json()));
  assert.equal(targets.length, 272);
  const catalogue = items(await get(admin, '/master/indicators', authorization));
  assert.equal(catalogue.length, 272);
  const indicator = [...catalogue].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)[0];
  const assignments = await get(admin, `/pic-assignments?year=2026&healthCenterId=${centerId}`, authorization);
  const assignment = assignments.find(row => row.indicatorId === indicator.id);
  assert.ok(assignment, 'First indicator must have the seeded PIC assignment.');
  const code = `${indicator.sectionCode}.${indicator.no.replace('.', '')}`;
  // Keep target editing separate from monthly history: the API correctly forbids
  // rescoring an indicator once monthly records exist, including on repeat runs.
  const targetIndicator = [...catalogue].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)[1];
  const targetCode = `${targetIndicator.sectionCode}.${targetIndicator.no.replace('.', '')}`;
  const target = targets.find(row => row.indicatorId === targetIndicator.id);
  assert.ok(target && !target.isLocked, 'Fixture target must be editable; never unlock targets from this test.');
  await admin.getByRole('button', { name: 'Target Sasaran Tahunan', exact: true }).click();
  await admin.getByPlaceholder('Cari indikator...').fill(targetIndicator.indikator);
  const row = admin.getByRole('row').filter({ has: admin.getByText(targetCode, { exact: true }) });
  await row.getByRole('button', { name: 'Ubah Sasaran', exact: true }).click();
  await admin.getByLabel(`Target persen ${targetCode}`, { exact: true }).fill(String(Number(target.targetPct)));
  // Vary the denominator so a repeat run verifies an actual persisted change.
  const denominator = Number(target.totalSasaran) === 121 ? 120 : 121;
  await admin.getByLabel(`Total sasaran ${targetCode}`, { exact: true }).fill(String(denominator));
  const savedTarget = admin.waitForResponse(response => new URL(response.url()).pathname.endsWith('/targets/annual/2026/bulk') && response.request().method() === 'PUT');
  await row.getByRole('button', { name: 'Simpan', exact: true }).click();
  const targetWrite = await savedTarget;
  assert.ok(targetWrite.ok(), 'Target PUT failed.');
  authorization = await targetWrite.request().headerValue('authorization');
  const persistedTargets = items(await get(admin, `/targets/annual/2026?healthCenterId=${centerId}`, authorization));
  assert.equal(Number(persistedTargets.find(item => item.indicatorId === targetIndicator.id).totalSasaran), denominator);

  stage = 'monthly save and evidence';
  await monthly(admin, indicator);
  await admin.getByRole('button', { name: `Edit realisasi ${code}`, exact: true }).click();
  await admin.getByLabel(`Realisasi ${code}`, { exact: true }).fill('7');
  const monthlySaved = admin.waitForResponse(response => new URL(response.url()).pathname.endsWith('/records/monthly') && response.request().method() === 'PUT');
  await admin.getByRole('button', { name: `Simpan realisasi ${code}`, exact: true }).click();
  const monthlyWrite = await monthlySaved;
  assert.ok(monthlyWrite.ok(), 'Monthly PUT failed.');
  await admin.getByRole('button', { name: `Simpan realisasi ${code}`, exact: true }).waitFor({ state: 'hidden' });
  authorization = await monthlyWrite.request().headerValue('authorization');
  const recordPath = `/records/monthly?year=2026&month=1&healthCenterId=${centerId}`;
  let records = items(await get(admin, recordPath, authorization));
  assert.equal(Number(records.find(record => record.indicatorId === indicator.id).pencapaianRiil), 7);
  await admin.getByRole('button', { name: `Rincian indikator ${code}`, exact: true }).click();
  const drawer = admin.getByRole('dialog', { name: 'Rincian indikator', exact: true });
  await drawer.getByLabel('Realisasi fisik', { exact: true }).fill('7');
  await drawer.getByLabel('Catatan lapangan', { exact: true }).fill('FE E2E browser evidence');
  const finalized = admin.waitForResponse(response => /\/storage\/uploads\/[^/]+\/finalize$/.test(new URL(response.url()).pathname) && response.request().method() === 'POST');
  await drawer.getByLabel('Lampirkan bukti dukung', { exact: true }).setInputFiles({
    name: 'fe-e2e-evidence.png', mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=', 'base64'),
  });
  assert.ok((await finalized).ok(), 'Evidence finalize failed.');
  await drawer.getByText(/Bukti: fe-e2e-evidence\.png/).waitFor();
  const evidenceSaved = admin.waitForResponse(response => new URL(response.url()).pathname.endsWith('/records/monthly') && response.request().method() === 'PUT');
  await drawer.getByRole('button', { name: 'Simpan Capaian', exact: true }).click();
  assert.ok((await evidenceSaved).ok(), 'Evidence attachment PUT failed.');
  await drawer.getByText('Data capaian bulan 1 tersimpan di server.', { exact: true }).waitFor();
  records = items(await get(admin, recordPath, authorization));
  const record = records.find(item => item.indicatorId === indicator.id);
  assert.ok(record.evidenceId, 'Server must persist the attached evidence ID.');
  assert.equal(record.notes, 'FE E2E browser evidence');
  await drawer.getByRole('button', { name: 'Siapkan unduhan bukti', exact: true }).click();
  const link = drawer.getByRole('link', { name: 'Unduh bukti dukung', exact: true });
  await link.waitFor();
  const evidence = await admin.request.get(await link.getAttribute('href'));
  assert.ok(evidence.ok(), 'Presigned evidence download failed.');
  assert.equal((await evidence.body()).length, 68);

  stage = 'admin session restore';
  await admin.reload();
  await ready(admin);
  assert.equal(await admin.getByLabel('Puskesmas', { exact: true }).inputValue(), centerId);
  assert.equal(await admin.getByLabel('Puskesmas', { exact: true }).isDisabled(), true);
  await monthly(admin, indicator);
  await admin.getByRole('button', { name: `Rincian indikator ${code}`, exact: true }).click();
  assert.equal(await admin.getByLabel('Realisasi fisik', { exact: true }).inputValue(), '7');
  assert.equal(await admin.getByLabel('Catatan lapangan', { exact: true }).inputValue(), 'FE E2E browser evidence');
  await adminContext.close();

  stage = 'PIC permissions';
  const { context: picContext, page: pic } = await login('fe.pic', 'Staf PIC');
  assert.equal(await pic.getByRole('button', { name: 'Target Sasaran Tahunan', exact: true }).count(), 0);
  assert.equal(await pic.getByRole('button', { name: 'Pusat Data Master (CRUD)', exact: true }).count(), 0);
  assert.equal(await pic.getByRole('button', { name: 'Setting / Penugasan PIC', exact: true }).count(), 0);
  await pic.getByRole('heading', { name: 'Indikator Saya', exact: true }).waitFor();
  assert.equal(await pic.locator('nav button').count(), 2);
  assert.equal(await pic.getByRole('button', { name: 'Input Capaian Bulanan', exact: true }).count(), 0);
  await pic.getByLabel('Bulan evaluasi', { exact: true }).selectOption('1');
  const assignedRows = pic.locator('[data-indicator-id]');
  const expectedIds = assignments.filter(row => row.picUserId === assignment.picUserId).map(row => row.indicatorId).sort();
  assert.deepEqual((await assignedRows.evaluateAll(rows => rows.map(row => row.dataset.indicatorId))).sort(), expectedIds);
  await pic.locator(`[data-indicator-id="${indicator.id}"]`).getByRole('button', { name: 'Ubah isian', exact: true }).click();
  assert.equal(await pic.getByLabel('Realisasi fisik', { exact: true }).isDisabled(), false);
  await pic.getByLabel('Realisasi fisik', { exact: true }).fill('0');
  const picSaved = pic.waitForResponse(response => new URL(response.url()).pathname.endsWith('/records/monthly') && response.request().method() === 'PUT');
  await pic.getByRole('button', { name: 'Simpan Capaian', exact: true }).click();
  const picWrite = await picSaved;
  assert.ok(picWrite.ok(), 'Assigned PIC must be able to save zero realization.');
  const picAuthorization = await picWrite.request().headerValue('authorization');
  const picRecords = items(await get(pic, recordPath, picAuthorization));
  assert.equal(Number(picRecords.find(row => row.indicatorId === indicator.id).pencapaianRiil), 0);
  await pic.getByText('Data capaian bulan 1 tersimpan di server.', { exact: true }).waitFor();
  await pic.getByRole('button', { name: 'Tutup rincian indikator', exact: true }).click();
  await pic.getByRole('button', { name: /^Sudah diisi \(/ }).click();
  assert.equal(await pic.locator(`[data-indicator-id="${indicator.id}"]`).count(), 1, 'Zero is a completed input.');
  await pic.locator(`[data-indicator-id="${indicator.id}"]`).getByRole('button', { name: 'Ubah isian', exact: true }).click();
  await pic.getByLabel('Realisasi fisik', { exact: true }).fill('7');
  const picRestored = pic.waitForResponse(response => new URL(response.url()).pathname.endsWith('/records/monthly') && response.request().method() === 'PUT');
  await pic.getByRole('button', { name: 'Simpan Capaian', exact: true }).click();
  assert.ok((await picRestored).ok());
  await pic.getByText('Data capaian bulan 1 tersimpan di server.', { exact: true }).waitFor();
  await pic.getByRole('button', { name: 'Tutup rincian indikator', exact: true }).click();
  const unassigned = catalogue.find(item => item.id !== indicator.id && !assignments.some(a => a.indicatorId === item.id));
  assert.ok(unassigned, 'Expected an unassigned indicator for the negative permission assertion.');
  assert.equal(await pic.locator(`[data-indicator-id="${unassigned.id}"]`).count(), 0);
  await pic.getByRole('button', { name: /^Belum diisi \(/ }).click();
  assert.equal(await pic.locator(`[data-indicator-id="${indicator.id}"]`).count(), 0);
  await pic.getByRole('button', { name: /^Sudah diisi \(/ }).click();
  assert.equal(await pic.locator(`[data-indicator-id="${indicator.id}"]`).count(), 1);
  await pic.setViewportSize({ width: 390, height: 844 });
  assert.equal(await pic.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'PIC mobile must not overflow horizontally.');
  await pic.locator(`[data-indicator-id="${indicator.id}"]`).getByRole('button', { name: 'Ubah isian', exact: true }).click();
  assert.equal(await pic.getByLabel('Lampirkan bukti dukung', { exact: true }).isDisabled(), false);
  await picContext.close();

  stage = 'Dinkes tenant isolation';
  const { context: dinkesContext, page: dinkes } = await login('fe.dinkes', 'Dinkes');
  await dinkes.getByLabel('Puskesmas', { exact: true }).selectOption({ label: 'Puskesmas FE-E2E-001' });
  await ready(dinkes);
  await monthly(dinkes, indicator);
  await dinkes.getByRole('button', { name: `Rincian indikator ${code}`, exact: true }).click();
  assert.equal(await dinkes.getByLabel('Realisasi fisik', { exact: true }).inputValue(), '7');
  assert.equal(await dinkes.getByLabel('Realisasi fisik', { exact: true }).isDisabled(), true);
  await dinkes.getByRole('button', { name: 'Tutup rincian indikator', exact: true }).click();
  const switched = dinkes.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname.endsWith('/records/monthly') && url.searchParams.get('month') === '1' && url.searchParams.get('healthCenterId') !== centerId;
  });
  await dinkes.getByLabel('Puskesmas', { exact: true }).selectOption({ label: 'Puskesmas FE-E2E-002' });
  const secondTenant = await switched;
  assert.ok(secondTenant.ok());
  await ready(dinkes);
  const secondRecords = items(data(await secondTenant.json()));
  assert.equal(secondRecords.length, 272);
  assert.ok(secondRecords.every(record => record.isMissing && record.pencapaianRiil === null), 'Second isolated tenant must have no fabricated monthly history.');
  await monthly(dinkes, indicator);
  await dinkes.getByRole('button', { name: `Rincian indikator ${code}`, exact: true }).click();
  assert.equal(await dinkes.getByLabel('Realisasi fisik', { exact: true }).inputValue(), '');
  assert.equal(await dinkes.getByLabel('Catatan lapangan', { exact: true }).inputValue(), '');
  await dinkesContext.close();
  assert.deepEqual(failures, [], 'Browser or API errors were observed.');
  console.log('PASS: real-browser login, target persistence, monthly persistence, evidence upload/download, session restore, PIC permissions, and Dinkes tenant isolation.');
} catch (error) {
  const screenshot = `/tmp/opencode/frontend-e2e-failure-${Date.now()}.png`;
  if (activePage && !activePage.isClosed()) {
    // Clear any login fields before capturing a failed login screen.
    await activePage.locator('input[type="password"]').fill('').catch(() => {});
    await activePage.screenshot({ path: screenshot, fullPage: true }).catch(() => {});
    console.error(`Failure screenshot: ${screenshot}`);
  }
  console.error(`FAIL at ${stage}: ${String(error.message).replaceAll(password, '[REDACTED]')}`);
  if (failures.length) console.error(failures.join('\n'));
  process.exitCode = 1;
} finally {
  await browser.close();
}
