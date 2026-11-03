import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('..', import.meta.url));
const { stdout } = await promisify(execFile)(process.execPath, ['--import', 'tsx', '../tests/monthly-observation-fixtures.ts'], { cwd: root + '/backend', maxBuffer: 8 * 1024 * 1024 });
const catalogue = JSON.parse(stdout);
assert.equal(catalogue.indicators.length, 272);
const entry = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { AppLayout } from '/src/components/layout/AppLayout.tsx';
import { pkpStore } from '/src/services/apiStore.ts';
import { api } from '/src/services/apiClient.ts';
import { defaultsToObservation } from '/src/types/monthlyObservation.ts';
import '/src/index.css';
const role = new URLSearchParams(location.search).get('role') || 'ADMIN_PUSKESMAS';
api.setSession({ accessToken: 'fixture-access', refreshToken: 'fixture-refresh' });
await pkpStore.initialize({ id: 'fixture-user', name: 'Petugas Uji', role, healthCenterId: 'center-a' });
function Workspace() {
  React.useSyncExternalStore(pkpStore.subscribe, pkpStore.getSnapshot, pkpStore.getServerSnapshot);
  if (!pkpStore.getSessionUser()) return React.createElement('p', null, 'Sesi fixture berakhir');
  return React.createElement(AppLayout, { currentUser: pkpStore.getCurrentUser(), onLogout: () => pkpStore.logout() });
}
createRoot(document.getElementById('root')).render(React.createElement(Workspace));
window.fixture = { store: pkpStore, defaultsToObservation };
`;
const stubs = new Map(['ExecutiveDashboard', 'TargetSettingView', 'PicAssignmentModal', 'RecommendationView', 'DinkesSupervisionView',
  'YearPeriodModal', 'StaffManagementModal', 'ExportReportModal', 'MasterDataHub', 'ChangePasswordModal',
  'OfficialPerformanceSheet7', 'AnnualTrendDashboard'].map(name => [name, `export const ${name === 'PicAssignmentModal' ? 'PicAssignmentView' : name} = () => null;`]));

test('monthly observations through the real store and workspace, isolated API only', { timeout: 180000 }, async t => {
  const cacheDir = await mkdtemp('/tmp/opencode/monthly-observations-vite-');
  let server, browser;
  try {
    server = await createServer({ root, configFile: false, envFile: false, cacheDir,
      plugins: [{ name: 'observation-fixture', enforce: 'pre',
        resolveId(id) {
          if (id === '/observations-fixture.jsx') return '\0observations-fixture';
          const name = id.split('/').at(-1).replace(/\.tsx$/, '');
          if (stubs.has(name)) return '\0stub:' + name;
        },
        load(id) { if (id === '\0observations-fixture') return entry; if (id.startsWith('\0stub:')) return stubs.get(id.slice(6)); },
        configureServer(vite) { vite.middlewares.use('/observations-test', async (_req, res) => {
          res.setHeader('Content-Type', 'text/html');
          res.end(await vite.transformIndexHtml('/observations-test', '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/observations-fixture.jsx"></script></body></html>'));
        }); },
      }, react()], server: { host: '127.0.0.1', port: 0 },
      optimizeDeps: { noDiscovery: true, include: ['react', 'react-dom/client', 'react/jsx-dev-runtime', 'lucide-react'] },
      define: { 'import.meta.env.VITE_API_BASE_URL': JSON.stringify('/api/v1') },
    });
    await server.listen();
    browser = await chromium.launch({ headless: true });
    const origin = new URL(server.resolvedUrls.local[0]).origin;
    async function fixture(options, run) {
      const context = await browser.newContext({ viewport: options.mobile ? { width: 375, height: 850 } : { width: 1440, height: 1000 }, serviceWorkers: 'block' });
      const page = await context.newPage(); page.setDefaultTimeout(12000);
      await page.clock.setFixedTime(new Date('2026-11-15T12:00:00Z'));
      const rows = new Map(), writes = [], unexpected = [], errors = [], reads = [];
      const control = { conflict: false, hold: null, holdRead: options.holdRead ?? null, holdUpload: null, failWrite: false, failUpload: false, failRead: options.failRead ?? false, locked: options.locked, assigned: !options.unassigned, role: options.role ?? 'ADMIN_PUSKESMAS' };
      const key = (year, month, id, center = 'center-a') => [center, year, month, id].join(':');
      for (const row of options.observations ?? []) rows.set(key(row.year, row.month, row.indicatorId, row.healthCenterId), row);
      const evidenceId = '11111111-1111-4111-8111-111111111111';
      page.on('pageerror', error => errors.push(error.message));
      await context.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url()), method = request.method();
        if (url.origin !== origin) { unexpected.push(url.href); return route.abort(); }
        if (!url.pathname.startsWith('/api/')) return route.continue();
        const path = url.pathname.slice('/api/v1'.length), q = url.searchParams;
        if (method === 'GET') reads.push(path);
        const reply = data => route.fulfill({ json: { data } });
        if (path === '/records/monthly-observations') {
          if (method === 'GET') {
            if (control.failRead) return route.fulfill({ status: 503, json: { message: 'Fixture read failure' } });
            const items = [...rows.values()].filter(row => row.year === +q.get('year') && row.month === +q.get('month') && row.healthCenterId === q.get('healthCenterId'));
            if (control.holdRead) await control.holdRead;
            return reply({ items });
          }
          const body = request.postDataJSON(); writes.push({ path, body });
          if (control.hold) await control.hold;
          if (control.failWrite) return route.fulfill({ status: 503, json: { message: 'Fixture write failure' } });
          const record = body.records[0], previous = rows.get(key(body.year, body.month, record.indicatorId));
          if (control.conflict || record.revision !== (previous?.revision ?? 0)) return route.fulfill({ status: 409, json: { message: 'Observation revision changed' } });
          assert.equal('healthCenterId' in body, false);
          assert.equal('scoringVersion' in record, false);
          const saved = { ...record, id: record.indicatorId, year: body.year, month: body.month, healthCenterId: 'center-a',
            evidenceId: record.evidenceId === undefined ? previous?.evidenceId ?? null : record.evidenceId,
            revision: record.revision + 1, updatedAt: '2026-11-15T12:00:00Z' };
          rows.set(key(body.year, body.month, record.indicatorId), saved);
          return reply({ items: [saved] });
        }
        if (path === '/storage/uploads' && method === 'POST') { writes.push({ path, body: request.postDataJSON() }); return reply({ uploadId: evidenceId }); }
        if (path === `/storage/uploads/${evidenceId}/content`) {
          writes.push({ path }); if (control.holdUpload) await control.holdUpload;
          return route.fulfill({ status: control.failUpload ? 503 : 204 });
        }
        if (path === `/storage/uploads/${evidenceId}/finalize`) { writes.push({ path }); return reply({ id: evidenceId, status: 'READY' }); }
        if (path === '/storage/download') return route.fulfill({ contentType: 'application/pdf', headers: { 'Content-Disposition': 'attachment; filename="bukti-observasi.pdf"' }, body: '%PDF-1.4 observation fixture' });
        if (path === '/auth/logout') return reply({});
        if (method !== 'GET') { unexpected.push(`${method} ${path}`); return route.fulfill({ status: 500 }); }
        if (path === '/master/indicators') return reply(catalogue.indicators);
        if (path === '/master/sections') return reply(catalogue.sections);
        if (path === '/master/years') return reply([{ year: 2026, isLocked: false }, { year: 2025, isLocked: false }]);
        if (path === '/master/active-year') return reply({ year: 2026, revision: 1, provinceEnabled: false });
        if (path === '/health-centers') return reply([{ id: 'center-a', name: 'Melati Uji' }, { id: 'center-b', name: 'Kenanga Uji' }]);
        if (path.startsWith('/targets/annual/')) return reply({ items: [] });
        if (path === '/pic-assignments') return reply(catalogue.indicators.map(ind => ({ indicatorId: ind.id, picUserId: control.assigned ? 'fixture-user' : 'other-user' })));
        if (path === '/workflow/periods') return reply(control.locked ? [{ year: 2026, periodNumber: 8, isQuarter: false, status: 'VERIFIED' }] : []);
        if (path.startsWith('/users/')) return reply({ items: options.roster && path === '/users/pics' ? [{ id: 'fixture-user', name: 'Petugas Uji', phone: '08123456789', role: 'PIC' }] : [], total: options.roster ? 1 : 0 });
        if (path === '/records/monthly') return reply({ month: +q.get('month'), items: [
          { indicatorId: 'K5-R26', pencapaianRiil: 250, totalSasaran: 100, scoringVersion: 'DO_2026_V2', inputBasis: 'PERIOD_ACTUAL', measurementValue: 2.5, measurementUnit: 'ITEMS_PER_PRESCRIPTION', nilaiKinerja: 100 },
          ...(options.legacyRestricted ? [{ indicatorId: 'K1-R9', pencapaianRiil: 7, scoringVersion: 'ILP_2026_V1', inputBasis: 'MONTHLY_DELTA', notes: 'Histori V1 dipertahankan', nilaiKinerja: 50 }] : []),
        ] });
        if (path === '/analytics/annual-trend') return reply({ subKlasters: [] });
        if (path === '/analytics/sheet7') return reply({ rows: [], indicators: [], reportingPolicy: { canSubmit: false, canVerify: false } });
        if (path.startsWith('/master/indicators/') && path.includes('/definition')) return reply({ definitionId: 'fixture', definition: 'Sumber fixture', calculation: 'Tidak ada hitung observasi', version: 'DO_2026_V2' });
        if (['/recommendations', '/audit-logs', '/analytics/indicator-trends', '/analytics/period-recap'].includes(path)) return reply({ items: [] });
        unexpected.push(path); return route.fulfill({ status: 500 });
      });
      try {
        await page.goto(`${origin}/observations-test?role=${control.role}`);
        await page.waitForFunction(() => window.fixture && !window.fixture.store.getLoadState().loading);
        await page.getByRole('combobox', { name: 'Bulan evaluasi', exact: true }).selectOption('8');
        if (control.role !== 'PIC') {
          if (options.mobile) await page.getByRole('button', { name: 'Buka navigasi', exact: true }).click();
          await page.getByRole('button', { name: 'Input Capaian Bulanan', exact: true }).click();
        }
        if (!options.unassigned) await page.getByRole('button', { name: 'Observasi bulanan K1-R9', exact: true }).waitFor();
        if (!options.holdRead) await page.waitForFunction(() => ['loaded', 'error'].includes(window.fixture.store.getMonthlyObservationsLoad(8)?.status));
        await run({ page, rows, writes, reads, control, key, evidenceId });
        assert.deepEqual(unexpected, []); assert.deepEqual(errors, []);
      } finally { await context.close(); }
    }
    const editor = page => page.getByRole('dialog', { name: 'Observasi bulanan', exact: true });
    async function open(page, id = 'K1-R9') {
      await page.getByRole('button', { name: `Observasi bulanan ${id}`, exact: true }).click();
      await editor(page).getByRole('button', { name: 'Muat ulang', exact: true }).waitFor();
      await page.waitForFunction(() => !document.querySelector('dialog[open]')?.textContent.includes('Memuat observasi tersimpan...'));
      return editor(page);
    }
    async function save(page) {
      await editor(page).getByRole('button', { name: 'Simpan observasi', exact: true }).click();
      await editor(page).getByRole('status').filter({ hasText: 'Observasi bulanan berhasil disimpan.' }).waitFor();
    }
    const observedRow = (id = 'K1-R9', month = 8, center = 'center-a') => ({ indicatorId: id, year: 2026, month, healthCenterId: center,
      revision: 1, kind: 'DOCUMENT', status: 'RECORDED', documentAvailable: false, notes: '', value: null, denominator: null, unit: null });
    await t.test('PIC primary Ubah isian routes a restricted V1 record to independent observations; legacy editing is explicit', () => fixture({ role: 'PIC', legacyRestricted: true }, async ({ page, writes }) => {
      const row = page.locator('li[data-indicator-id="K1-R9"]');
      await row.getByRole('button', { name: 'Ubah isian', exact: true }).click();
      const drawer = page.getByRole('dialog', { name: 'Rincian indikator', exact: true });
      assert.equal(await drawer.getByLabel('Realisasi fisik', { exact: true }).count(), 0);
      await drawer.getByRole('button', { name: 'Catat observasi dan bukti bulanan', exact: true }).click();
      const dialog = editor(page);
      await dialog.getByLabel('Ketersediaan dokumen').selectOption('false'); await save(page);
      assert.deepEqual(writes.map(write => write.path), ['/records/monthly-observations']);
      assert.equal(await page.evaluate(() => window.fixture.store.getMonthlyRecord('K1-R9', 8).pencapaianRiil), 7);
      await dialog.getByRole('button', { name: 'Tutup', exact: true }).click();
      await drawer.getByRole('button', { name: 'Editor perhitungan lama', exact: true }).click();
      const input = drawer.getByLabel('Realisasi fisik', { exact: true });
      assert.equal(await input.inputValue(), '7');
      assert.equal(await input.isEnabled(), true);
      assert.equal(await drawer.getByRole('button', { name: 'Simpan Capaian', exact: true }).isEnabled(), true);
    }));
    await t.test('PIC reload automatically restores observation-only filled counts and filters without an editor or manual load', () => fixture({ role: 'PIC', observations: [observedRow()] }, async ({ page, writes }) => {
      await page.reload(); await page.waitForFunction(() => window.fixture && !window.fixture.store.getLoadState().loading);
      await page.getByRole('combobox', { name: 'Bulan evaluasi', exact: true }).selectOption('8');
      await page.getByRole('button', { name: 'Sudah diisi (2)', exact: true }).waitFor();
      await page.locator('li[data-indicator-id="K1-R9"]').getByText('Observasi dicatat', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'Belum diisi (270)', exact: true }).click();
      assert.equal(await page.locator('li[data-indicator-id="K1-R9"]').count(), 0);
      await page.getByRole('button', { name: 'Sudah diisi (2)', exact: true }).click();
      assert.equal(await page.locator('li[data-indicator-id="K1-R9"]').count(), 1);
      assert.equal(await editor(page).count(), 0); assert.equal(writes.length, 0);
    }));
    await t.test('read-only Dinkes automatically sees saved observations after reload', () => fixture({ role: 'DINKES_ADMIN', observations: [observedRow()] }, async ({ page, writes }) => {
      await page.reload(); await page.waitForFunction(() => window.fixture && !window.fixture.store.getLoadState().loading);
      await page.getByRole('combobox', { name: 'Bulan evaluasi', exact: true }).selectOption('8');
      await page.getByRole('button', { name: 'Input Capaian Bulanan', exact: true }).click();
      await page.getByText(/Observasi: Dokumen belum tersedia/).waitFor();
      const dialog = await open(page);
      assert.equal(await dialog.getByLabel('Ketersediaan dokumen').inputValue(), 'false');
      assert.equal(await dialog.getByRole('button', { name: 'Simpan observasi', exact: true }).isDisabled(), true);
      assert.equal(writes.length, 0);
    }));
    await t.test('loading and failed automatic reads keep PIC counts unknown and numeric editing available; retry restores counts', async () => {
      let release; const holdRead = new Promise(resolve => { release = resolve; });
      await fixture({ role: 'PIC', holdRead, observations: [observedRow()] }, async ({ page, control }) => {
        await page.getByRole('button', { name: 'Sudah diisi (?)', exact: true }).waitFor();
        assert.equal(await page.getByRole('button', { name: 'Belum diisi (?)', exact: true }).isDisabled(), true);
        const numeric = page.locator('li[data-indicator-id="K5-R26"]');
        assert.equal(await numeric.getByRole('button', { name: 'Ubah isian', exact: true }).isEnabled(), true);
        control.holdRead = null; release();
        await page.getByRole('button', { name: 'Sudah diisi (2)', exact: true }).waitFor();
        control.failRead = true;
        await page.getByRole('button', { name: 'Muat observasi bulan ini', exact: true }).click();
        await page.getByRole('alert').filter({ hasText: /Observasi gagal dimuat.*Status pengisian belum dapat dipastikan/ }).waitFor();
        assert.equal(await page.getByRole('button', { name: 'Sudah diisi (?)', exact: true }).isDisabled(), true);
        assert.equal(await page.evaluate(() => window.fixture.store.getLoadState().error), null);
        await numeric.getByRole('button', { name: 'Ubah isian', exact: true }).click();
        const drawer = page.getByRole('dialog', { name: 'Rincian indikator', exact: true });
        await drawer.getByRole('button', { name: 'Edit capaian dan bukti dukung', exact: true }).click();
        const old = page.getByRole('dialog', { name: 'Input DO 2026', exact: true });
        assert.equal(await old.getByRole('spinbutton').first().isEnabled(), true);
        await old.getByRole('button', { name: 'Batal', exact: true }).click();
        await drawer.getByRole('button', { name: 'Tutup rincian indikator', exact: true }).click();
        control.failRead = false;
        await page.getByRole('button', { name: 'Muat observasi bulan ini', exact: true }).click();
        await page.getByRole('button', { name: 'Sudah diisi (2)', exact: true }).waitFor();
      });
    });
    await t.test('admin reminders wait for observations and stay absent when all raw rows are filled', () => fixture({ roster: true, observations: catalogue.indicators.map(indicator => observedRow(indicator.id)) }, async ({ page, control }) => {
      let release; control.holdRead = new Promise(resolve => { release = resolve; });
      await page.getByRole('button', { name: 'Pemantauan PIC', exact: true }).click();
      await page.getByLabel('Pilih PIC:', { exact: true }).selectOption('fixture-user');
      await page.getByText('Status pengisian belum diketahui', { exact: true }).waitFor();
      assert.equal(await page.getByRole('link', { name: 'Ingatkan lewat WhatsApp', exact: true }).count(), 0);
      control.holdRead = null; release();
      await page.getByText('100% Terisi', { exact: true }).waitFor();
      assert.equal(await page.getByRole('link', { name: 'Ingatkan lewat WhatsApp', exact: true }).count(), 0);
      control.failRead = true; await page.getByRole('button', { name: 'Muat observasi bulan ini', exact: true }).click();
      await page.getByRole('alert').filter({ hasText: 'Observasi gagal dimuat' }).waitFor();
      assert.equal(await page.getByRole('link', { name: 'Ingatkan lewat WhatsApp', exact: true }).count(), 0);
      control.failRead = false;
    }));
    await t.test('initial automatic read failure does not disable legacy numeric controls or claim missing observations', () => fixture({ role: 'PIC', legacyRestricted: true, failRead: true }, async ({ page, control }) => {
      await page.getByRole('alert').filter({ hasText: 'Observasi gagal dimuat' }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Belum diisi (?)', exact: true }).isDisabled(), true);
      await page.locator('li[data-indicator-id="K2-R8"]').getByText('Status pengisian belum diketahui', { exact: true }).waitFor();
      await page.locator('li[data-indicator-id="K1-R9"]').getByRole('button', { name: 'Ubah isian', exact: true }).click();
      const drawer = page.getByRole('dialog', { name: 'Rincian indikator', exact: true });
      await drawer.getByRole('button', { name: 'Editor perhitungan lama', exact: true }).click();
      assert.equal(await drawer.getByLabel('Realisasi fisik', { exact: true }).isEnabled(), true);
      assert.equal(await drawer.getByRole('button', { name: 'Simpan Capaian', exact: true }).isEnabled(), true);
      control.failRead = false;
    }));
    await t.test('automatic reads follow month, year and tenant without late load-state or observation leakage', () => fixture({ role: 'DINKES_ADMIN', observations: [observedRow(), { ...observedRow('K1-R9', 9), documentAvailable: true }] }, async ({ page, control }) => {
      let release; control.holdRead = new Promise(resolve => { release = resolve; });
      const request = page.waitForRequest(request => request.url().includes('/records/monthly-observations') && new URL(request.url()).searchParams.get('month') === '8');
      await page.getByRole('button', { name: 'Muat observasi bulan ini', exact: true }).click(); await request;
      control.holdRead = null;
      await page.getByRole('combobox', { name: 'Bulan evaluasi', exact: true }).selectOption('9');
      await page.getByText(/Observasi: Dokumen tersedia/).waitFor();
      release();
      await page.waitForFunction(() => window.fixture.store.getMonthlyObservationsLoad(8)?.status === 'loaded');
      assert.equal(await page.evaluate(() => window.fixture.store.getMonthlyObservationsLoad(9).status), 'loaded');
      assert.equal(await page.getByText(/Observasi: Dokumen belum tersedia/).count(), 0);
      await page.getByRole('combobox', { name: 'Puskesmas', exact: true }).selectOption('center-b');
      await page.waitForFunction(() => window.fixture.store.getSelectedHealthCenterId() === 'center-b' && window.fixture.store.getMonthlyObservationsLoad(9)?.status === 'loaded');
      assert.equal(await page.getByText(/Observasi: Dokumen tersedia/).count(), 0);
      await page.getByRole('combobox', { name: 'Tahun pelaporan', exact: true }).selectOption('2025');
      await page.waitForFunction(() => window.fixture.store.getCurrentYear() === 2025 && window.fixture.store.getMonthlyObservationsLoad(9)?.status === 'loaded');
      assert.equal(await page.evaluate(() => window.fixture.store.getMonthlyObservation('K1-R9', 9)), undefined);
    }));
    await t.test('all 272 have monthly actions; formerly blocked cell opens observations and old editor remains available', () => fixture({}, async ({ page, reads }) => {
      assert.equal(await page.getByRole('button', { name: /^Observasi bulanan / }).count(), 272);
      assert.equal(await page.evaluate(() => window.fixture.store.getIndicators().filter(indicator => !window.fixture.defaultsToObservation(indicator)).length), 23, 'The original 23 monthly calculation editors remain primary');
      assert.equal(reads.includes('/records/monthly-observations'), true, 'Visible month loads observations automatically');
      await page.getByRole('button', { name: /^Input observasi 1\.1\.2,/ }).click();
      await editor(page).getByRole('combobox', { name: 'Jenis observasi' }).waitFor();
      assert.equal(await editor(page).getByRole('combobox', { name: 'Jenis observasi' }).inputValue(), 'DOCUMENT');
      await editor(page).getByRole('button', { name: 'Tutup', exact: true }).click();
      const row = page.locator('tr').filter({ has: page.getByRole('button', { name: 'Observasi bulanan K1-R9', exact: true }) });
      assert.equal(await row.getByRole('button', { name: 'Editor perhitungan lama' }).count(), 0);
      await page.getByRole('button', { name: 'Tampilkan rincian penilaian', exact: true }).click();
      await row.getByRole('button', { name: 'Editor perhitungan lama' }).click();
      await page.getByRole('dialog', { name: 'Input DO 2026', exact: true }).waitFor();
      assert.equal(await page.getByRole('dialog', { name: 'Input DO 2026', exact: true }).getByRole('button', { name: 'Simpan', exact: true }).isDisabled(), true);
    }));
    for (const mobile of [false, true]) {
      await t.test(`monthly input keeps essential columns and reveals secondary details on ${mobile ? 'mobile' : 'desktop'}`, () => fixture({ mobile }, async ({ page, writes }) => {
        const table = page.getByRole('table', { name: 'Input capaian bulanan', exact: true });
        assert.equal(await table.getByRole('columnheader').count(), 5);
        assert.equal(await page.getByRole('button', { name: 'Sinkronkan Semua ke Provinsi', exact: true }).count(), 0);
        assert.equal(await page.getByRole('button', { name: 'Ajukan Laporan ke Dinkes', exact: true }).count(), 0);
        assert.equal(await page.getByText('Status Sinkronisasi SIPKP Provinsi Jatim', { exact: true }).count(), 0);
        const guidance = page.locator('details').filter({ has: page.locator('summary', { hasText: 'Panduan input dan status penilaian' }) });
        assert.equal(await guidance.getAttribute('open'), null);
        await guidance.locator('summary').focus(); await page.keyboard.press('Enter');
        assert.equal(await guidance.getByText('Integrasi SIPKP Provinsi belum tersedia. Tidak ada pengiriman dari layar ini.', { exact: true }).isVisible(), true);
        await guidance.locator('summary').click();
        const toggle = page.getByRole('button', { name: 'Tampilkan rincian penilaian', exact: true });
        assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
        await toggle.focus(); await page.keyboard.press('Enter');
        assert.equal(await table.getByRole('columnheader').count(), 10);
        assert.equal(await table.getByRole('columnheader', { name: 'Nilai Kinerja', exact: true }).isVisible(), true);
        assert.equal(await table.getByRole('columnheader', { name: 'PIC Program', exact: true }).isVisible(), true);
        assert.equal(await table.getByRole('columnheader', { name: 'Sinkronisasi Jatim', exact: true }).count(), 0);
        assert.equal(await table.locator('tbody tr').evaluateAll(rows => rows.every(row => row.children.length === 10)), true);
        await page.getByRole('button', { name: 'Sembunyikan rincian penilaian', exact: true }).click();
        assert.equal(await table.locator('tbody tr').evaluateAll(rows => rows.every(row => row.children.length === 5)), true);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
        assert.equal(await page.getByRole('button', { name: /^Observasi bulanan / }).count(), 272);
        assert.equal(writes.length, 0, 'Presentation changes never save or convert input');
        if (process.env.PKP_INPUT_SCREENSHOTS) {
          await page.locator('main').evaluate(el => { el.scrollTop = 0; });
          await page.screenshot({ path: `/tmp/opencode/monthly-input-${mobile ? 'mobile' : 'desktop'}.png` });
        }
      }));
    }
    await t.test('document false is saved separately, revisions persist across page reload and do not change scores', () => fixture({}, async ({ page, writes, reads }) => {
      assert.equal(await page.getByRole('status').filter({ hasText: 'Observasi bulan ini sudah dimuat. Catatan ini tidak mengubah skor.' }).isVisible(), true);
      let dialog = await open(page);
      assert.equal(await dialog.getByText('Catat angka, ketersediaan dokumen, atau keterangan bulan ini. Observasi tidak menghasilkan skor, menetapkan indikator tidak berlaku, atau melengkapi penilaian tahunan. Data tidak dijumlahkan otomatis ke rekap.', { exact: true }).isVisible(), true);
      await dialog.getByRole('button', { name: 'Simpan observasi', exact: true }).click();
      await dialog.getByRole('alert').waitFor(); assert.equal(writes.length, 0);
      await dialog.getByLabel('Ketersediaan dokumen').selectOption('false');
      await save(page);
      assert.equal(writes[0].body.records[0].documentAvailable, false);
      assert.equal(writes[0].body.records[0].value, null);
      await dialog.getByRole('button', { name: 'Tutup', exact: true }).click();
      await page.getByText(/Observasi: Dokumen belum tersedia/).waitFor();
      const analyticsReads = reads.filter(path => path.startsWith('/analytics/')).length;
      dialog = await open(page); await dialog.getByLabel('Ketersediaan dokumen').selectOption('true'); await save(page);
      assert.equal(writes[1].body.records[0].revision, 1);
      assert.equal(reads.filter(path => path.startsWith('/analytics/')).length, analyticsReads);
      await page.reload(); await page.waitForFunction(() => window.fixture && !window.fixture.store.getLoadState().loading);
      await page.getByRole('combobox', { name: 'Bulan evaluasi', exact: true }).selectOption('8');
      await page.getByRole('button', { name: 'Input Capaian Bulanan', exact: true }).click();
      await page.getByText(/Observasi: Dokumen tersedia/).waitFor();
      dialog = await open(page); assert.equal(await dialog.getByLabel('Ketersediaan dokumen').inputValue(), 'true');
      assert.equal(await page.evaluate(() => window.fixture.store.getMonthlyRecord('K5-R26', 8).nilaiKinerja), 100);
    }));
    await t.test('annual-only numbers, ratio zero denominator, missing, not due and original23 note preserve independent kinds', () => fixture({}, async ({ page, writes }) => {
      let dialog = await open(page, 'K2-R8');
      assert.equal(await dialog.getByLabel('Jenis observasi').inputValue(), 'NUMBER');
      await dialog.getByLabel('Nilai observasi').fill('0'); await save(page);
      assert.equal(writes.at(-1).body.records[0].value, 0);
      await dialog.getByLabel('Jenis observasi').selectOption('RATIO');
      await dialog.getByLabel('Penyebut (D)').fill('0'); await save(page);
      assert.equal(writes.at(-1).body.records[0].denominator, 0);
      await dialog.getByLabel('Status bulan ini').selectOption('NOT_AVAILABLE');
      await dialog.getByRole('button', { name: 'Simpan observasi' }).click(); await dialog.getByRole('alert').waitFor();
      await dialog.getByRole('textbox', { name: /^Catatan/ }).fill('Register belum tersedia'); await save(page);
      assert.equal(writes.at(-1).body.records[0].value, null);
      await dialog.getByLabel('Status bulan ini').selectOption('NOT_DUE'); await save(page);
      assert.equal(writes.at(-1).body.records[0].status, 'NOT_DUE');
      await dialog.getByRole('button', { name: 'Tutup', exact: true }).click();
      dialog = await open(page, 'K5-R26'); await dialog.getByLabel('Jenis observasi').selectOption('NOTE');
      await dialog.getByRole('textbox', { name: /^Catatan/ }).fill('Sampel diperiksa bulan ini'); await save(page);
      assert.equal(writes.at(-1).body.records[0].unit, null);
      assert.equal(await page.evaluate(() => window.fixture.store.getMonthlyRecord('K5-R26', 8).pencapaianRiil), 250);
      await dialog.getByRole('button', { name: 'Tutup', exact: true }).click();
      await page.getByRole('button', { name: /^Edit realisasi 5\.3\.8,/ }).click();
      await page.getByRole('dialog', { name: 'Input DO 2026', exact: true }).waitFor();
    }));
    await t.test('conflict never auto-overwrites; explicit reload loads new revision; unchanged evidence is omitted', () => fixture({}, async ({ page, rows, writes, control, key, evidenceId }) => {
      const stored = { indicatorId: 'K1-R9', revision: 4, kind: 'DOCUMENT', status: 'RECORDED', documentAvailable: false, value: null, denominator: null, unit: null, notes: '', sourceReference: '', evidenceId, year: 2026, month: 8, healthCenterId: 'center-a' };
      rows.set(key(2026, 8, 'K1-R9'), stored);
      const dialog = await open(page); await dialog.getByLabel('Ketersediaan dokumen').selectOption('true');
      rows.set(key(2026, 8, 'K1-R9'), { ...stored, revision: 5 });
      await dialog.getByRole('button', { name: 'Simpan observasi' }).click();
      await dialog.getByRole('alert').filter({ hasText: 'Data telah berubah atau periode dikunci saat formulir ini terbuka. Isian Anda belum disimpan. Muat ulang untuk melihat data terbaru, lalu periksa dan isi kembali.' }).waitFor();
      assert.equal(writes.length, 1); assert.equal(await dialog.getByRole('button', { name: 'Simpan observasi' }).isDisabled(), true);
      page.once('dialog', dialog => dialog.accept()); await dialog.getByRole('button', { name: 'Muat ulang', exact: true }).click();
      await dialog.getByLabel('Ketersediaan dokumen').selectOption('true'); await save(page);
      assert.equal(writes[1].body.records[0].revision, 5); assert.equal('evidenceId' in writes[1].body.records[0], false);
      assert.equal(rows.get(key(2026, 8, 'K1-R9')).evidenceId, evidenceId);
      control.failRead = true; await dialog.getByRole('button', { name: 'Muat ulang', exact: true }).click();
      await dialog.getByRole('alert').waitFor();
    }));
    await t.test('stored observation evidence downloads only on demand, without observation or score writes', () => fixture({}, async ({ page, rows, writes, reads, key, evidenceId }) => {
      rows.set(key(2026, 8, 'K1-R9'), { indicatorId: 'K1-R9', revision: 1, kind: 'DOCUMENT', status: 'RECORDED', documentAvailable: true, evidenceId, year: 2026, month: 8, healthCenterId: 'center-a' });
      const dialog = await open(page);
      assert.equal(reads.includes('/storage/download'), false);
      const download = page.waitForEvent('download');
      await dialog.getByRole('button', { name: 'Unduh bukti observasi tersimpan' }).click();
      assert.equal((await download).suggestedFilename(), 'bukti-observasi.pdf');
      assert.equal(reads.filter(path => path === '/storage/download').length, 1);
      assert.equal(writes.length, 0);
    }));
    await t.test('pending write blocks close, month/year switches; dirty drafts guard navigation and scopes do not leak', () => fixture({}, async ({ page, control, writes }) => {
      const dialog = await open(page); await dialog.getByLabel('Ketersediaan dokumen').selectOption('false');
      page.once('dialog', dialog => dialog.dismiss()); await dialog.getByRole('button', { name: 'Tutup', exact: true }).click();
      assert.equal(await dialog.isVisible(), true);
      let release; control.hold = new Promise(resolve => { release = resolve; });
      await dialog.getByRole('button', { name: 'Simpan observasi' }).click();
      await page.waitForFunction(() => window.fixture.store.isMutating());
      assert.equal(await dialog.getByRole('button', { name: 'Tutup', exact: true }).isDisabled(), true);
      await page.keyboard.press('Escape'); assert.equal(await dialog.isVisible(), true);
      assert.equal(await page.getByRole('combobox', { name: 'Bulan evaluasi', exact: true }).isDisabled(), true);
      assert.equal(await page.evaluate(async () => { try { await window.fixture.store.setCurrentYear(2025); return false; } catch { return true; } }), true);
      release(); await dialog.getByRole('status').filter({ hasText: 'Observasi bulanan berhasil disimpan.' }).waitFor();
      await dialog.getByRole('button', { name: 'Tutup', exact: true }).click();
      await page.getByRole('combobox', { name: 'Bulan evaluasi', exact: true }).selectOption('9');
      const next = await open(page); assert.equal(await next.getByLabel('Ketersediaan dokumen').inputValue(), '');
      assert.equal(writes.length, 1);
      await next.getByRole('button', { name: 'Tutup', exact: true }).click();
      await page.getByRole('combobox', { name: 'Tahun pelaporan', exact: true }).selectOption('2025');
      await page.waitForFunction(() => !window.fixture.store.getLoadState().loading);
      assert.equal(await page.evaluate(() => window.fixture.store.getMonthlyObservation('K1-R9', 8)), undefined);
    }));
    await t.test('late reads cannot overwrite a committed observation or cross year/tenant/session scope', () => fixture({}, async ({ page, control }) => {
      const dialog = await open(page); await dialog.getByLabel('Ketersediaan dokumen').selectOption('false');
      let release; control.holdRead = new Promise(resolve => { release = resolve; });
      const staleRequest = page.waitForRequest(request => request.url().includes('/records/monthly-observations'));
      await page.evaluate(() => {
        window.lateObservation = window.fixture.store.fetchMonthlyObservations(2026, 8).then(() => 'accepted', () => 'rejected');
      });
      await staleRequest; await save(page); release(); control.holdRead = null;
      assert.equal(await page.evaluate(() => window.lateObservation), 'rejected');
      assert.equal(await page.evaluate(() => window.fixture.store.getMonthlyObservation('K1-R9', 8).revision), 1);
      await dialog.getByRole('button', { name: 'Tutup', exact: true }).click();
      for (const change of ['year', 'tenant', 'session']) {
        control.holdRead = new Promise(resolve => { release = resolve; });
        const request = page.waitForRequest(request => request.url().includes('/records/monthly-observations'));
        await page.evaluate(() => {
          window.lateObservation = window.fixture.store.fetchMonthlyObservations(window.fixture.store.getCurrentYear(), 8).then(() => 'accepted', () => 'rejected');
        });
        await request;
        if (change === 'year') await page.evaluate(() => window.fixture.store.setCurrentYear(2025));
        else if (change === 'tenant') await page.evaluate(() => window.fixture.store.initialize({ id: 'fixture-reviewer', name: 'Reviewer', role: 'DINKES_ADMIN' }).then(() => window.fixture.store.selectHealthCenter('center-b')));
        else await page.evaluate(() => window.fixture.store.clear());
        release(); control.holdRead = null;
        assert.equal(await page.evaluate(() => window.lateObservation), 'rejected');
        assert.equal(await page.evaluate(() => window.fixture.store.getMonthlyObservation('K1-R9', 8)), undefined);
      }
    }));
    await t.test('dirty observation cancellation preserves values across real month/tab navigation', () => fixture({}, async ({ page }) => {
      const dialog = await open(page); await dialog.getByLabel('Ketersediaan dokumen').selectOption('false');
      // Programmatic events exercise the workspace guard while the native dialog makes the background inert.
      for (const target of ['month', 'tab']) {
        page.once('dialog', prompt => prompt.dismiss());
        if (target === 'month') await page.getByRole('combobox', { name: 'Bulan evaluasi', exact: true }).evaluate(select => {
          select.value = '9'; select.dispatchEvent(new Event('change', { bubbles: true }));
        });
        else await page.getByRole('button', { name: 'Pemantauan PIC', exact: true }).evaluate(button => button.click());
        assert.equal(await dialog.getByLabel('Ketersediaan dokumen').inputValue(), 'false');
        assert.equal(await page.getByRole('combobox', { name: 'Bulan evaluasi', exact: true }).inputValue(), '8');
      }
      page.once('dialog', prompt => prompt.accept());
      await page.getByRole('combobox', { name: 'Bulan evaluasi', exact: true }).evaluate(select => {
        select.value = '9'; select.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await dialog.waitFor({ state: 'hidden' });
      const next = await open(page); assert.equal(await next.getByLabel('Ketersediaan dokumen').inputValue(), '');
    }));
    await t.test('initial read failure blocks writes; failed upload and failed save retain a retryable draft without duplicate finalized uploads', () => fixture({}, async ({ page, writes, control }) => {
      control.failRead = true;
      const dialog = await open(page); await dialog.getByRole('alert').waitFor();
      assert.equal(await dialog.getByRole('button', { name: 'Simpan observasi' }).isDisabled(), true);
      control.failRead = false; await dialog.getByRole('button', { name: 'Muat ulang', exact: true }).click();
      await dialog.getByLabel('Ketersediaan dokumen').selectOption('false');
      await dialog.getByText('Sumber dan bukti (opsional)', { exact: true }).click();
      await dialog.getByLabel('Bukti observasi', { exact: true }).setInputFiles({ name: 'bukti.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 fixture') });
      control.failUpload = true; await dialog.getByRole('button', { name: 'Simpan observasi' }).click();
      await dialog.getByRole('alert').waitFor();
      assert.equal(writes.some(write => write.path.endsWith('/finalize')), false);
      assert.equal(writes.some(write => write.path === '/records/monthly-observations'), false);
      control.failUpload = false; control.failWrite = true;
      await dialog.getByRole('button', { name: 'Simpan observasi' }).click();
      await dialog.getByRole('alert').filter({ hasText: 'Fixture write failure' }).waitFor();
      const uploadCount = writes.filter(write => write.path === '/storage/uploads').length;
      control.failWrite = false; await save(page);
      assert.equal(writes.filter(write => write.path === '/storage/uploads').length, uploadCount);
      assert.equal(writes.filter(write => write.path.endsWith('/finalize')).length, 1);
      await dialog.getByLabel('Ketersediaan dokumen').selectOption('true');
      assert.equal(await dialog.getByRole('status').filter({ hasText: 'Observasi bulanan berhasil disimpan.' }).count(), 0);
    }));
    await t.test('pending upload prevents close, duplicate submit and scope changes; session expiry never saves late evidence', () => fixture({}, async ({ page, writes, control }) => {
      const dialog = await open(page); await dialog.getByLabel('Ketersediaan dokumen').selectOption('false');
      await dialog.getByText('Sumber dan bukti (opsional)', { exact: true }).click();
      await dialog.getByLabel('Bukti observasi', { exact: true }).setInputFiles({ name: 'bukti.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 fixture') });
      let release; control.holdUpload = new Promise(resolve => { release = resolve; });
      const content = page.waitForRequest(request => request.url().endsWith('/content'));
      await dialog.getByRole('button', { name: 'Simpan observasi' }).click(); await content;
      assert.equal(await dialog.getByRole('button', { name: 'Tutup', exact: true }).isDisabled(), true);
      assert.equal(await page.getByRole('combobox', { name: 'Bulan evaluasi', exact: true }).isDisabled(), true);
      await dialog.locator('form').evaluate(form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
      assert.equal(writes.filter(write => write.path === '/storage/uploads').length, 1);
      await page.evaluate(() => window.fixture.store.clear()); release();
      await page.waitForFunction(() => !window.fixture.store.isMutating());
      assert.equal(writes.some(write => write.path === '/records/monthly-observations'), false);
    }));
    for (const options of [{ role: 'DINKES_ADMIN' }, { locked: true }, { role: 'PIC', unassigned: true }]) {
      await t.test('permission guard ' + JSON.stringify(options), () => fixture(options, async ({ page, writes }) => {
        if (options.unassigned) {
          await page.getByText('Belum ada indikator yang ditugaskan kepada Anda.', { exact: false }).waitFor();
          assert.equal(await page.evaluate(async () => {
            try { await window.fixture.store.saveMonthlyObservation(2026, 8, { indicatorId: 'K1-R9', revision: 0, kind: 'DOCUMENT', status: 'RECORDED', documentAvailable: false }); return false; }
            catch { return true; }
          }), true);
          assert.equal(writes.length, 0); return;
        }
        const dialog = await open(page);
        assert.equal(await dialog.getByRole('button', { name: 'Simpan observasi' }).isDisabled(), true);
        await dialog.locator('form').evaluate(form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
        assert.equal(writes.length, 0);
      }));
    }
    await t.test('PIC mobile drawer observation and finalized upload use the same isolated path', () => fixture({ role: 'PIC', mobile: true }, async ({ page, writes, evidenceId }) => {
      let dialog = await open(page); await dialog.getByLabel('Ketersediaan dokumen').selectOption('false');
      await dialog.getByText('Sumber dan bukti (opsional)', { exact: true }).click();
      await dialog.getByLabel('Referensi sumber').fill('Register RUK bulan Agustus');
      await dialog.getByLabel('Bukti observasi', { exact: true }).setInputFiles({ name: 'bukti.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 fixture') });
      await save(page);
      assert.equal(writes.at(-1).body.records[0].evidenceId, evidenceId);
      assert.equal(writes.find(write => write.path === '/storage/uploads').body.month, 8);
      assert.equal(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth), true);
      await dialog.getByRole('button', { name: 'Tutup', exact: true }).click();
      const row = page.locator('li[data-indicator-id="K1-R9"]');
      await row.getByText('Observasi dicatat', { exact: true }).waitFor();
      await row.getByRole('button', { name: 'Isi indikator', exact: true }).click();
      const drawer = page.getByRole('dialog', { name: 'Rincian indikator', exact: true });
      await drawer.getByRole('button', { name: 'Catat observasi dan bukti bulanan', exact: true }).click();
      dialog = editor(page); await dialog.getByLabel('Ketersediaan dokumen').waitFor();
      assert.equal(await dialog.getByLabel('Ketersediaan dokumen').inputValue(), 'false');
    }));
  } finally { await browser?.close(); await server?.close(); await rm(cacheDir, { recursive: true, force: true }); }
});
