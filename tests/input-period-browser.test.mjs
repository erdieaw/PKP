import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from 'playwright';

const indicators = ['legacy', 'do'].map((id, index) => ({
  id, no: String(index + 1), sectionCode: '5.1', section: 'Bagian fixture', klasterId: 5,
  klasterName: 'Lintas Klaster', kegiatan: 'Kegiatan fixture', indikator: `Indikator ${id}`,
  satuan: 'resep', polarity: 'HIGHER_IS_BETTER', targetDisplay: '100%', targetNumeric: 100,
  ...(id === 'do' ? { do2026: { status: 'IMPLEMENTED', numeratorLabel: 'Total item obat',
    denominatorLabel: 'Jumlah resep', numeratorInput: 'INTEGER', denominatorInput: 'INTEGER',
    measurementUnit: 'ITEMS_PER_PRESCRIPTION', targetDisplay: 'Sesuai DO' } } : {}),
}));
const centers = [{ id: 'center-a', name: 'Melati Fixture' }, { id: 'center-b', name: 'Kenanga Fixture' }];
const record = (id, value) => ({ indicatorId: id, pencapaianRiil: value, totalSasaran: 100,
  capaianRiilPct: 50, nilaiKinerja: 50, notes: 'Sumber fixture tersimpan', evidenceId: null, isMissing: false,
  scoringVersion: id === 'do' ? 'DO_2026_V2' : 'ILP_2026_V1',
  inputBasis: id === 'do' ? 'PERIOD_ACTUAL' : 'MONTHLY_DELTA',
  ...(id === 'do' ? { measurementValue: 2.5, measurementUnit: 'ITEMS_PER_PRESCRIPTION' } : {}),
});

const entrySource = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { AppLayout } from '/src/components/layout/AppLayout.tsx';
import { api } from '/src/services/apiClient.ts';
import { pkpStore } from '/src/services/apiStore.ts';
import '/src/index.css';
const role = new URLSearchParams(location.search).get('role') || 'ADMIN_PUSKESMAS';
const user = { id: 'fixture-user', name: 'Petugas Fixture', role, healthCenterId: 'center-a', roleLabel: role };
api.setSession({ accessToken: 'fixture-access', refreshToken: 'fixture-refresh' });
await pkpStore.initialize(user);
const root = createRoot(document.getElementById('root'));
function FixtureLayout() {
  React.useSyncExternalStore(pkpStore.subscribe, pkpStore.getSnapshot, pkpStore.getServerSnapshot);
  return React.createElement(AppLayout, { currentUser: pkpStore.getCurrentUser(), onLogout() {} });
}
root.render(React.createElement(FixtureLayout));
window.periodFixture = { store: pkpStore };
`;

const dashboardSource = `
import React from 'react';
export function ExecutiveDashboard() {
  return React.createElement('section', { 'aria-label': 'Dashboard fixture' }, 'Dashboard fixture');
}
`;
const stubs = new Map([
  ['ExecutiveDashboard', dashboardSource],
  ...['TargetSettingView', 'PicAssignmentModal', 'RecommendationView', 'DinkesSupervisionView',
    'YearPeriodModal', 'StaffManagementModal', 'ExportReportModal', 'MasterDataHub',
    'ChangePasswordModal', 'OfficialPerformanceSheet7', 'AnnualTrendDashboard'].map(name =>
    [name, `export const ${name === 'PicAssignmentModal' ? 'PicAssignmentView' : name} = () => null;`]),
]);

test('input period through real AppLayout, Header, grid and drawer (isolated API fixtures)', { timeout: 180000 }, async t => {
  const cacheDir = await mkdtemp('/tmp/opencode/input-period-vite-');
  let server, browser;
  try {
    server = await createServer({
      root: fileURLToPath(new URL('..', import.meta.url)), configFile: false, envFile: false, cacheDir,
      plugins: [{
        name: 'input-period-browser-fixture', enforce: 'pre',
        resolveId(id) {
          if (id === '/input-period-fixture.jsx') return '\0input-period-fixture.jsx';
          const name = id.split('/').at(-1).replace(/\.tsx$/, '');
          if (stubs.has(name)) return '\0period-stub:' + name;
        },
        load(id) {
          if (id === '\0input-period-fixture.jsx') return entrySource;
          if (id.startsWith('\0period-stub:')) return stubs.get(id.slice('\0period-stub:'.length));
        },
        configureServer(vite) {
          vite.middlewares.use('/input-period-test', async (_req, res) => {
            res.setHeader('Content-Type', 'text/html');
            res.end(await vite.transformIndexHtml('/input-period-test', '<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/input-period-fixture.jsx"></script></body></html>'));
          });
        },
      }, react()],
      server: { host: '127.0.0.1', port: 0 },
      optimizeDeps: { noDiscovery: true, include: ['react', 'react-dom/client', 'react/jsx-dev-runtime', 'lucide-react'] },
      define: { 'import.meta.env.VITE_API_BASE_URL': JSON.stringify('/api/v1') },
    });
    await server.listen();
    browser = await chromium.launch({ headless: true });
    const origin = new URL(server.resolvedUrls.local[0]).origin;

    async function fixture(options = {}) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
      const page = await context.newPage();
      page.setDefaultTimeout(10000);
      await page.clock.setFixedTime(new Date('2026-11-15T12:00:00Z'));
      const requests = [], unexpected = [], exceptions = [];
      const control = { failActive: false, holdActive: null, role: options.role || 'ADMIN_PUSKESMAS', unassigned: false };
      page.on('pageerror', error => exceptions.push(error.message));
      // Every request, including requests from a misconfigured API base, fails closed.
      await context.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url());
        if (url.origin !== origin) { unexpected.push(request.url()); return route.abort(); }
        if (!url.pathname.startsWith('/api/')) return route.continue();
        const path = url.pathname.slice('/api/v1'.length), query = url.searchParams;
        requests.push({ path, query: Object.fromEntries(query), method: request.method() });
        if (request.method() !== 'GET' || request.headers().authorization !== 'Bearer fixture-access') {
          unexpected.push(`${request.method()} ${path}`);
          return route.fulfill({ status: 500, json: { message: 'Unexpected fixture write or session' } });
        }
        let data;
        if (path === '/auth/me') data = { id: 'fixture-user', name: 'Petugas Fixture', role: control.role, healthCenterId: 'center-a' };
        else if (path === '/master/indicators') data = indicators;
        else if (path === '/master/sections') data = [{ id: 'section', code: '5.1', name: 'Bagian fixture', klasterId: 5 }];
        else if (path === '/master/years') data = [2025, 2026].map(year => ({ year, isLocked: false }));
        else if (path === '/health-centers') data = centers;
        else if (path === '/master/active-year') {
          if (control.holdActive) await control.holdActive;
          if (control.failActive) return route.fulfill({ status: 503, json: { message: 'Fixture scope unavailable' } });
          data = { year: 2026, provinceEnabled: false, revision: 1 };
        } else if (path.startsWith('/targets/annual/')) data = indicators.map(ind => ({ indicatorId: ind.id,
          targetSasaran: 1200, totalSasaran: 1200, targetPct: 100 }));
        else if (path === '/pic-assignments') data = indicators.map(ind => ({ indicatorId: ind.id,
          picUserId: control.unassigned ? 'another-pic' : 'fixture-user' }));
        else if (path === '/workflow/periods') data = options.locked
          ? [{ year: 2026, periodNumber: 8, isQuarter: false, status: 'VERIFIED' }] : [];
        else if (path === '/recommendations' || path === '/audit-logs' || path === '/analytics/indicator-trends') data = { items: [] };
        else if (path.startsWith('/users/')) data = { items: [], total: 0 };
        else if (path === '/records/monthly') {
          const scopeOffset = (query.get('year') === '2025' ? 100 : 0) + (query.get('healthCenterId') === 'center-b' ? 200 : 0);
          data = { month: Number(query.get('month')), items: indicators.map(ind =>
            record(ind.id, (Number(query.get('month')) === 8 ? 808 : 17) + scopeOffset)) };
        }
         else if (path === '/analytics/annual-trend') data = { subKlasters: [{ code: '5.1',
           monthlyScores: Array(12).fill(50), indicatorCount: indicators.length }] };
         else if (path === '/analytics/period-recap') data = { items: [{
           indicatorId: 'do', indicator: indicators[1], numerator: 250, denominator: 100,
           measurementValue: 2.5, measurementUnit: 'ITEMS_PER_PRESCRIPTION', nilaiKinerja: 100,
           dataComplete: true, scoreComplete: true, availableMonths: [1, 2, 3], missingMonths: [],
           aggregationMethod: 'EXPLICIT_YTD_RECAP', status: 'AVAILABLE', recapRevision: 0,
         }] };
        else if (path === '/analytics/sheet7') data = { year: Number(query.get('year')), quarter: Number(query.get('quarter')),
          periodLabel: 'Fixture cumulative', klasterScores: {}, rows: [{ no: '5.1', nilaiKelompok: 73, isKlasterHead: false }],
          indicators: indicators.map(ind => record(ind.id, Number(query.get('quarter')) === 1 ? 321 : 654)),
          reportingPolicy: { canSubmit: false, canVerify: false, operatingMode: 'INTERNAL_PHASED', reason: 'Evaluasi internal fixture' } };
        else {
          unexpected.push(path);
          return route.fulfill({ status: 500, json: { message: 'Unexpected fixture endpoint' } });
        }
        return route.fulfill({ json: { data } });
      });
      try {
        const params = new URLSearchParams({ role: control.role });
        await page.goto(`${origin}/input-period-test?${params}`);
        await page.waitForFunction(() => window.periodFixture);
        await page.getByRole('combobox', { name: 'Bulan evaluasi', exact: true }).selectOption('8');
        return { page, requests, control, async close() {
          try {
            assert.deepEqual(exceptions, [], 'No browser exceptions');
            assert.deepEqual(unexpected, [], 'No unhandled endpoints, writes or external requests');
          } finally { await context.close(); }
        } };
      } catch (error) { await context.close(); throw error; }
    }
    const monthSelect = page => page.getByRole('combobox', { name: 'Bulan evaluasi', exact: true });
    const yearSelect = page => page.getByRole('combobox', { name: 'Tahun anggaran', exact: true });
    const centerSelect = page => page.getByRole('combobox', { name: 'Puskesmas', exact: true });
    const drawer = page => page.getByRole('dialog', { name: 'Rincian indikator', exact: true });
    const details = (page, code = '5.1.1') => page.getByRole('button', { name: `Rincian indikator ${code}`, exact: true });
    async function grid(page, month = 'Agustus', year = 2026, center = 'Melati Fixture') {
      await page.getByRole('button', { name: 'Input Capaian Bulanan', exact: true }).click();
      await page.getByRole('status').filter({ hasText: `${center} / ${month} ${year}` }).waitFor();
    }
    async function ready(page) {
      await page.waitForFunction(() => !window.periodFixture.store.getLoadState().loading);
      assert.equal(await page.locator('main').getAttribute('aria-busy'), 'false');
    }
    async function confirm(page, accept, action) {
      let count = 0;
      const handler = async dialog => {
        count++;
        await (accept ? dialog.accept() : dialog.dismiss());
      };
      const event = page.waitForEvent('dialog');
      page.on('dialog', handler);
      try {
        await action();
        const dialog = await event;
        assert.equal(dialog.type(), 'confirm');
        assert.match(dialog.message(), /perubahan capaian yang belum disimpan/);
        assert.equal(count, 1, 'One discard confirmation per navigation');
      } finally { page.off('dialog', handler); }
    }
    async function activate(locator, input) {
      if (input === 'click') await locator.click();
      else { await locator.focus(); await locator.press(input); }
    }
    async function assertQuarter(page) {
      const panel = drawer(page);
      await panel.getByText('Kumulatif Januari sampai Maret 2026 (TW 1)', { exact: true }).waitFor();
      await panel.getByRole('status').filter({ hasText: /rincian kumulatif triwulan/ }).waitFor();
      assert.equal(await panel.locator('input, textarea').count(), 0);
      assert.equal(await panel.getByRole('button', { name: /Simpan|Edit capaian/ }).count(), 0);
      // The annual trend may still display August; only the inspection/input context is TW1.
      assert.equal(await panel.getByText('Agustus 2026', { exact: true }).count(), 0);
      assert.equal(await monthSelect(page).inputValue(), '8', 'TW inspection must not mutate the global month');
    }

    await t.test('grid filtering keeps an unrelated recap draft without a discard prompt', async () => {
      const f = await fixture();
      try {
        const { page } = f;
        await grid(page);
        await page.getByText('Rekap Kumulatif & Tahunan', { exact: true }).click();
        await page.getByText('Isi atau perbarui rekap terpisah', { exact: true }).click();
        const numerator = page.getByRole('spinbutton', { name: 'Total item obat', exact: true });
        await numerator.fill('888');
        const dialogs = [];
        const unexpectedDialog = dialog => { dialogs.push(dialog.message()); return dialog.dismiss(); };
        page.on('dialog', unexpectedDialog);
        await page.getByPlaceholder('Cari kode, indikator, atau sub-klaster...').fill('legacy');
        assert.equal(await numerator.inputValue(), '888');
        await details(page).click();
        await drawer(page).getByRole('button', { name: 'Tutup rincian indikator', exact: true }).click();
        assert.deepEqual(dialogs, []);
        page.off('dialog', unexpectedDialog);
        await confirm(page, false, () => monthSelect(page).selectOption('9'));
        assert.equal(await monthSelect(page).inputValue(), '8');
        assert.equal(await numerator.inputValue(), '888');
      } finally { await f.close(); }
    });

    await t.test('August 2026 to TW1 opens March cumulative, including head-child click/Enter/Space', async () => {
      const f = await fixture();
      try {
        const { page } = f;
        await grid(page);
        await page.getByRole('button', { name: 'Mode Triwulanan (TW)', exact: true }).click();
        await page.getByRole('button', { name: 'Triwulan 1: Januari - Maret 2026, hanya baca', exact: true }).click();
        for (const input of ['click', 'Enter', 'Space']) {
          await activate(details(page), input);
          await assertQuarter(page);
          assert.equal(await drawer(page).locator('dl div').filter({ has: page.locator('dt', { hasText: 'Realisasi kumulatif (N)' }) }).locator('dd').innerText(), '321');
          await drawer(page).getByRole('button', { name: 'Tutup rincian indikator', exact: true }).click();
          await activate(page.getByRole('button', { name: 'Rincian head 5.1', exact: true }), input);
          await assertQuarter(page);
          assert.equal(await drawer(page).getByText('Rerata Skor', { exact: true }).locator('..').locator('p').innerText(), '73');
          await activate(drawer(page).getByRole('button', { name: 'Rincian indikator 5.1.2', exact: true }), input);
          await drawer(page).getByRole('heading', { name: 'Indikator do', exact: true }).waitFor();
          await assertQuarter(page);
          assert.equal(await drawer(page).getByText('321', { exact: true }).count(), 1);
          await drawer(page).getByRole('button', { name: 'Tutup rincian indikator', exact: true }).click();
        }
        await page.getByRole('button', { name: 'Mode Bulanan', exact: true }).click();
        await details(page).click();
        await drawer(page).getByText('Agustus 2026', { exact: true }).waitFor();
        assert.equal(await drawer(page).getByRole('spinbutton', { name: 'Realisasi fisik', exact: true }).inputValue(), '808');
      } finally { await f.close(); }
    });

    await t.test('selected August survives real year/tenant scope remounts and labels include year and month', async () => {
      const f = await fixture({ role: 'DINKES_ADMIN' });
      try {
        const { page } = f;
        await grid(page);
        await details(page).click();
        await drawer(page).waitFor();
        await yearSelect(page).selectOption('2025');
        await ready(page);
        assert.equal(await drawer(page).count(), 0, 'Year scope remount must close the previous drawer');
        assert.equal(await monthSelect(page).inputValue(), '8');
        await page.getByRole('status').filter({ hasText: 'Melati Fixture / Agustus 2025' }).waitFor();
        await centerSelect(page).selectOption('center-b');
        await ready(page);
        assert.equal(await monthSelect(page).inputValue(), '8');
        await page.getByRole('status').filter({ hasText: 'Kenanga Fixture / Agustus 2025' }).waitFor();
        await details(page).click();
        await drawer(page).getByText('Agustus 2025', { exact: true }).waitFor();
        await drawer(page).getByText('Puskesmas: Kenanga Fixture', { exact: true }).waitFor();
        assert.equal(await drawer(page).getByRole('spinbutton', { name: 'Realisasi fisik', exact: true }).isDisabled(), true);
        assert.equal(await drawer(page).getByRole('spinbutton', { name: 'Realisasi fisik', exact: true }).inputValue(), '1108');
        assert.ok(f.requests.some(r => r.path === '/records/monthly' && r.query.year === '2025' && r.query.healthCenterId === 'center-b' && r.query.month === '8'));
      } finally { await f.close(); }
    });

    await t.test('global month/year/tab cancellation preserves a real dirty legacy cell; accepting discards without saving', async () => {
      for (const destination of ['month', 'year', 'tab']) {
        const f = await fixture();
        try {
          const { page } = f;
          await grid(page);
          await page.getByRole('button', { name: 'Edit realisasi 5.1.1, Agustus 2026, Melati Fixture', exact: true }).click();
          const input = page.getByRole('spinbutton', { name: 'Realisasi 5.1.1, Agustus 2026, Melati Fixture', exact: true });
          await input.fill('919');
          const before = f.requests.length;
          const action = () => destination === 'month' ? monthSelect(page).selectOption('3')
            : destination === 'year' ? yearSelect(page).selectOption('2025')
              : page.getByRole('button', { name: 'Dashboard Kinerja PKP', exact: true }).click();
          await confirm(page, false, action);
          assert.equal(await input.inputValue(), '919', destination);
          assert.equal(await monthSelect(page).inputValue(), '8');
          assert.equal(await yearSelect(page).inputValue(), '2026');
          assert.equal(f.requests.length, before, 'Cancelled navigation must not load another scope');
          assert.equal(await page.evaluate(() => window.periodFixture.store.getMonthlyRecord('legacy', 8).pencapaianRiil), 808);
          await confirm(page, true, action);
          await input.waitFor({ state: 'detached' });
          if (destination === 'month') {
            await page.getByRole('status').filter({ hasText: 'Melati Fixture / Maret 2026' }).waitFor();
          } else if (destination === 'year') {
            await ready(page);
            await page.getByRole('status').filter({ hasText: 'Melati Fixture / Agustus 2025' }).waitFor();
          } else await page.getByRole('region', { name: 'Dashboard fixture', exact: true }).waitFor();
          if (destination === 'tab') await grid(page);
          if (destination === 'month') await monthSelect(page).selectOption('8');
          if (destination === 'year') { await yearSelect(page).selectOption('2026'); await ready(page); }
          await page.getByRole('button', { name: 'Edit realisasi 5.1.1, Agustus 2026, Melati Fixture', exact: true }).click();
          assert.equal(await input.inputValue(), '808', 'Discarded draft is not resurrected');
        } finally { await f.close(); }
      }
    });

    await t.test('DO Escape cancellation retains N/D/source/file; accepted close discards the draft', async () => {
      const f = await fixture();
      try {
        const { page } = f;
        await grid(page);
        await page.getByRole('button', { name: 'Edit realisasi 5.1.2, Agustus 2026, Melati Fixture', exact: true }).click();
        const editor = page.getByRole('dialog', { name: 'Input DO 2026', exact: true });
        await editor.getByText('Agustus 2026', { exact: true }).waitFor();
        await editor.getByLabel('Total item obat', { exact: true }).fill('919');
        await editor.getByLabel('Jumlah resep', { exact: true }).fill('400');
        await editor.getByRole('textbox', { name: /^Catatan sumber data/ }).fill('Draft sumber Agustus');
        await editor.getByLabel('Lampirkan bukti dukung', { exact: true }).setInputFiles({ name: 'draft.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-fixture') });
        await confirm(page, false, () => page.keyboard.press('Escape'));
        assert.equal(await editor.getByLabel('Total item obat', { exact: true }).inputValue(), '919');
        assert.equal(await editor.getByLabel('Jumlah resep', { exact: true }).inputValue(), '400');
        assert.equal(await editor.getByRole('textbox', { name: /^Catatan sumber data/ }).inputValue(), 'Draft sumber Agustus');
        await editor.getByText('Bukti dipilih: draft.pdf', { exact: true }).waitFor();
        assert.equal(await monthSelect(page).inputValue(), '8');
        await confirm(page, true, () => page.keyboard.press('Escape'));
        await editor.waitFor({ state: 'detached' });
        await page.getByRole('button', { name: 'Edit realisasi 5.1.2, Agustus 2026, Melati Fixture', exact: true }).click();
        assert.equal(await editor.getByLabel('Total item obat', { exact: true }).inputValue(), '808');
        assert.equal(await editor.getByLabel('Jumlah resep', { exact: true }).inputValue(), '100');
        assert.equal(await editor.getByRole('textbox', { name: /^Catatan sumber data/ }).inputValue(), 'Sumber fixture tersimpan');
        assert.equal(await editor.getByLabel('Lampirkan bukti dukung', { exact: true }).inputValue(), '');
        assert.equal(await editor.getByText('Bukti dipilih: draft.pdf', { exact: true }).count(), 0);
      } finally { await f.close(); }
    });

    await t.test('tenant cancellation preserves a legacy draft after a live role refresh; accepting remounts scope', async () => {
      const f = await fixture();
      try {
        const { page } = f;
        await grid(page);
        await details(page).click();
        const draft = drawer(page).getByRole('spinbutton', { name: 'Realisasi fisik', exact: true });
        await draft.fill('919');
        // Dinkes cannot create drafts. Exercise an existing admin draft after the
        // session/catalog refresh grants review-only, cross-tenant navigation.
        f.control.role = 'DINKES_ADMIN';
        await page.evaluate(() => window.periodFixture.store.refreshCatalog());
        await ready(page);
        assert.equal(await centerSelect(page).isEnabled(), true);
        assert.equal(await draft.isDisabled(), true, 'Role refresh must not leave write permission behind');
        const before = f.requests.length;
        await confirm(page, false, () => centerSelect(page).selectOption('center-b'));
        assert.equal(await centerSelect(page).inputValue(), 'center-a');
        assert.equal(await draft.inputValue(), '919');
        assert.equal(f.requests.length, before);
        await confirm(page, true, () => centerSelect(page).selectOption('center-b'));
        await ready(page);
        await drawer(page).waitFor({ state: 'detached' });
        assert.equal(await centerSelect(page).inputValue(), 'center-b');
        assert.equal(await monthSelect(page).inputValue(), '8');
        await details(page).click();
        assert.equal(await draft.inputValue(), '1008', 'New tenant data must replace the old tenant draft and record');
        await drawer(page).getByText('Puskesmas: Kenanga Fixture', { exact: true }).waitFor();
      } finally { await f.close(); }
    });

    await t.test('role, assignment and locked periods keep actual drawer controls read-only', async () => {
      for (const options of [{ role: 'DINKES_ADMIN' }, { role: 'PIC' }, { locked: true }]) {
        const f = await fixture(options);
        try {
          const { page } = f;
          if (options.role === 'PIC') {
            await page.locator('[data-indicator-id="do"]').getByRole('button', { name: 'Ubah isian', exact: true }).click();
            await drawer(page).waitFor();
            assert.equal(await drawer(page).getByRole('button', { name: 'Edit capaian dan bukti dukung', exact: true }).isEnabled(), true);
            f.control.unassigned = true;
            await page.evaluate(() => window.periodFixture.store.refreshScope());
            await drawer(page).getByRole('status').filter({ hasText: 'indikator ini tidak ditugaskan kepada Anda' }).waitFor();
          } else {
            await grid(page);
            assert.equal(await page.getByRole('button', { name: /^Realisasi 5\.1\.2,/ }).getAttribute('aria-disabled'), 'true');
            await details(page, '5.1.2').click();
          }
          assert.equal(await drawer(page).getByRole('button', { name: 'Edit capaian dan bukti dukung', exact: true }).isDisabled(), true);
          assert.equal(await page.getByRole('dialog', { name: 'Input DO 2026', exact: true }).count(), 0);
        } finally { await f.close(); }
      }
    });

    await t.test('scope refresh loading/error blocks navigation and editing while keeping loaded content', async () => {
      const f = await fixture();
      let release;
      try {
        const { page } = f;
        await grid(page);
        await details(page).click();
        await drawer(page).waitFor();
        f.control.holdActive = new Promise(resolve => { release = resolve; });
        await page.evaluate(() => { window.periodFixture.store.refreshScope().catch(() => {}); });
        await page.waitForFunction(() => window.periodFixture.store.getLoadState().loading);
        for (const select of [monthSelect(page), yearSelect(page), centerSelect(page)]) assert.equal(await select.isDisabled(), true);
        assert.equal(await page.locator('main').getAttribute('aria-busy'), 'true');
        assert.equal(await drawer(page).getByRole('spinbutton', { name: 'Realisasi fisik', exact: true }).isDisabled(), true);
        f.control.failActive = true;
        release();
        await page.waitForFunction(() => !!window.periodFixture.store.getLoadState().error);
        await page.getByRole('alert').filter({ hasText: 'Data terakhir tetap ditampilkan' }).waitFor();
        assert.equal(await monthSelect(page).isDisabled(), true);
        assert.equal(await drawer(page).getByRole('spinbutton', { name: 'Realisasi fisik', exact: true }).isDisabled(), true);
        assert.equal(await drawer(page).getByRole('spinbutton', { name: 'Realisasi fisik', exact: true }).inputValue(), '808');
        f.control.holdActive = null;
        f.control.failActive = false;
        await page.getByRole('button', { name: 'Coba Lagi', exact: true }).click();
        await ready(page);
        assert.equal(await monthSelect(page).isEnabled(), true);
        assert.equal(await drawer(page).getByRole('spinbutton', { name: 'Realisasi fisik', exact: true }).isEnabled(), true);
      } finally { release?.(); await f.close(); }
    });
  } finally {
    await browser?.close();
    await server?.close();
    await rm(cacheDir, { recursive: true, force: true });
  }
});
