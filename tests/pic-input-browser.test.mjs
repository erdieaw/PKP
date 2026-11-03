import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from 'playwright';

// Real dashboard/recap components, with no session, environment file or backend.
const storeSource = `
const listeners = new Set();
let revision = 0;
export const state = { role: 'PIC', year: 2026, month: 3, active: true, activeYear: 2026,
  locked: false, lockedMonths: [], center: 'fixture-center', homeCenter: 'fixture-center',
  pendingWrites: 0, rosterEmpty: false, assignments: null, recapIds: ['actual'], saveRecaps: false, view: 'dashboard' };
let sessionUser = { id: 'fixture-pic', role: state.role, healthCenterId: state.homeCenter };
const profile = { status: 'IMPLEMENTED', numeratorLabel: 'Total item obat', denominatorLabel: 'Jumlah resep',
  numeratorInput: 'INTEGER', denominatorInput: 'INTEGER', targetDisplay: 'Sesuai DO', measurementUnit: 'ITEMS_PER_PRESCRIPTION' };
const indicators = ['actual', 'ytd', 'legacy', 'estimated', 'zero', 'missing'].map((id, index) => ({
  id, no: String(index + 1), sectionCode: '5.1', section: 'Bagian uji', kegiatan: 'Kegiatan uji',
  indikator: 'Indikator ' + id, satuan: 'resep', polarity: 'HIGHER_IS_BETTER', targetDisplay: '100%',
  ...(id === 'legacy' ? {} : { do2026: id === 'estimated' ? { ...profile, denominatorLabel: 'Populasi dasar' } : profile }),
}));
const actual = { scoringVersion: 'DO_2026_V2', inputBasis: 'PERIOD_ACTUAL', pencapaianRiil: 250,
  totalSasaran: 100, measurementValue: 2.5, measurementUnit: 'ITEMS_PER_PRESCRIPTION', nilaiKinerja: 100, isMissing: false };
const records = {
  actual, ytd: { ...actual, inputBasis: 'YTD_ACTUAL', pencapaianRiil: 900, totalSasaran: 300 },
  legacy: { scoringVersion: 'ILP_2026_V1', inputBasis: 'MONTHLY_DELTA', pencapaianRiil: 50,
    capaianRiilPct: 50, nilaiKinerja: 50, isMissing: false },
  estimated: { ...actual, pencapaianRiil: 30, totalSasaran: 1000, effectiveDenominator: 45.5 },
  zero: { ...actual, pencapaianRiil: 0, totalSasaran: 0 },
  missing: { ...actual, pencapaianRiil: null, totalSasaran: null, nilaiKinerja: null, isMissing: true },
};
export const requests = [], opened = [], writes = [];
const savedRecaps = new Map();
export const pkpStore = {
  subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
  getSnapshot: () => revision, getServerSnapshot: () => revision,
  getSessionUser: () => sessionUser,
  getCurrentUser: () => sessionUser,
  getCurrentYear: () => state.year, getLoadState: () => ({ loading: false, error: null }),
  getSelectedHealthCenterId: () => state.center,
  getSelectedHealthCenter: () => state.center ? { id: state.center, name: state.center === 'fixture-center' ? 'Melati Uji' : 'Kenanga Uji' } : undefined,
  getActivePeriod: () => state.activeYear == null ? null : { year: state.activeYear },
  isActiveYear: (year = state.year) => state.active && year === state.activeYear,
  canInputOwnPeriod: (year = state.year) => pkpStore.isActiveYear(year) && sessionUser.role !== 'DINKES_ADMIN' &&
    Boolean(state.center) && state.center === sessionUser.healthCenterId,
  isPeriodLocked: (year, month) => year === state.year && (state.locked || state.lockedMonths.includes(month)),
  isMutating: () => state.pendingWrites > 0,
  getPics: () => state.rosterEmpty ? [] : [{ id: 'fixture-pic', name: 'PIC Uji', role: 'PJ program' }],
  getIndicators: () => indicators,
  getAssignments: () => state.assignments ?? Object.fromEntries(indicators.map(indicator => [indicator.id, 'fixture-pic'])),
  getPicForIndicator: id => pkpStore.getPics().find(pic => pic.id === pkpStore.getAssignments()[id]),
  getAnnualTargets: () => Object.fromEntries(indicators.map(indicator => [indicator.id, { targetSasaran: 12000 }])),
  getMonthlyRecord: id => records[id],
  getMonthlyObservation: () => undefined,
  getMonthlyObservationsLoad: () => ({ status: 'loaded', error: null }),
  fetchMonthlyObservations: async () => { requests.push('/records/monthly-observations'); return []; },
  updateMonthlyInput: (...args) => { writes.push(args); throw new Error('Monthly write not expected'); },
  saveRecord: (...args) => { writes.push(args); throw new Error('Monthly write not expected'); },
  savePeriodRecap: async recap => {
    writes.push([recap]);
    if (!state.saveRecaps) throw new Error('Recap write not expected');
    configure({ pendingWrites: state.pendingWrites + 1 });
    try {
      savedRecaps.set([state.center, recap.year, recap.endMonth, recap.indicatorId].join(':'), {
        numerator: recap.numerator, denominator: recap.denominator, recapNotes: recap.notes,
        recapRevision: recap.expectedRevision + 1,
      });
    } finally { configure({ pendingWrites: state.pendingWrites - 1 }); }
  },
};
export function configure(options) {
  Object.assign(state, options);
  if (sessionUser.role !== state.role || sessionUser.healthCenterId !== state.homeCenter) {
    sessionUser = { ...sessionUser, role: state.role, healthCenterId: state.homeCenter };
  }
  revision++;
  listeners.forEach(listener => listener());
}
export class ApiError extends Error {}
export const api = { request: async path => {
  requests.push(path);
  if (!path.startsWith('/analytics/period-recap?')) throw new Error('Unexpected fixture request: ' + path);
  const params = new URL(path, 'http://fixture.invalid').searchParams;
  return { items: state.recapIds.map(id => ({ indicatorId: id, indicator: indicators.find(indicator => indicator.id === id), numerator: 250, denominator: 100,
    measurementValue: 2.5, measurementUnit: 'ITEMS_PER_PRESCRIPTION', nilaiKinerja: 100,
    dataComplete: true, scoreComplete: true, availableMonths: [1, 2, 3], missingMonths: [],
    aggregationMethod: 'EXPLICIT_YTD_RECAP', status: 'AVAILABLE', recapRevision: 0,
    ...savedRecaps.get([params.get('healthCenterId'), params.get('year'), params.get('endMonth'), id].join(':')) })) };
} };
`;

const entrySource = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { PicDashboard } from '/src/components/dashboard/PicDashboard.tsx';
import { PeriodRecapPanel } from '/src/components/data-entry/PeriodRecapPanel.tsx';
import { Do2026Editor } from '/src/components/data-entry/Do2026Editor.tsx';
import { state, configure, requests, opened, writes, pkpStore } from 'virtual:pic-store';
import '/src/index.css';
const root = createRoot(document.getElementById('root'));
function render(options = {}) {
  configure(options);
  root.render(state.view === 'recap'
    ? React.createElement(PeriodRecapPanel, { year: 2026, month: 3 })
    : state.view === 'do-editor'
      ? React.createElement(Do2026Editor, { indicator: pkpStore.getIndicators()[0], record: pkpStore.getMonthlyRecord('actual'),
        year: 2026, month: 3, canEdit: true, onClose: () => { root.render(null); } })
      : React.createElement(PicDashboard, { selectedMonth: state.month, onOpenDrawer: indicator => opened.push(indicator.id) }));
}
window.picFixture = { render, configure, requests, opened, writes };
render();
`;

test('PIC dashboard period and input-basis presentation with an isolated store', async t => {
  const cacheDir = await mkdtemp('/tmp/opencode/pic-input-vite-');
  let server, browser;
  try {
    server = await createServer({
      root: fileURLToPath(new URL('..', import.meta.url)), configFile: false, envFile: false, cacheDir,
      plugins: [{
        name: 'pic-input-test-fixture', enforce: 'pre',
        resolveId(id) {
          if (id === '/pic-input-fixture.jsx') return '\0pic-input-fixture.jsx';
          if (id === 'virtual:pic-store' || /(?:^|\/)(?:apiStore|apiClient)(?:\.ts)?$/.test(id)) return '\0pic-store';
        },
        load(id) {
          if (id === '\0pic-input-fixture.jsx') return entrySource;
          if (id === '\0pic-store') return storeSource;
        },
        configureServer(vite) {
          vite.middlewares.use('/pic-input-test', async (_req, res) => {
            res.setHeader('Content-Type', 'text/html');
            res.end(await vite.transformIndexHtml('/pic-input-test', '<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/pic-input-fixture.jsx"></script></body></html>'));
          });
        },
      }, react()],
      server: { host: '127.0.0.1', port: 0 },
      optimizeDeps: { noDiscovery: true, include: ['react', 'react-dom/client', 'react/jsx-dev-runtime', 'lucide-react'] },
    });
    await server.listen();
    browser = await chromium.launch({ headless: true });
    const origin = new URL(server.resolvedUrls.local[0]).origin;
    async function fixture(options = {}, width = 1280) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      page.setDefaultTimeout(15000);
      const exceptions = [], unexpectedRequests = [];
      page.on('pageerror', error => exceptions.push(error.message));
      await page.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin !== origin || url.pathname.startsWith('/api/')) {
          unexpectedRequests.push(url.pathname);
          return route.abort();
        }
        return route.continue();
      });
      await page.goto(origin + '/pic-input-test');
      await page.waitForFunction(() => window.picFixture);
      await page.getByText('Periode data: Maret 2026', { exact: true }).waitFor();
      await page.evaluate(options => window.picFixture.render(options), options);
      if (options.view === 'do-editor') await page.getByRole('dialog', { name: 'Input DO 2026', exact: true }).waitFor();
      else if (options.view === 'recap') await page.getByText('Rekap Kumulatif & Tahunan', { exact: true }).waitFor();
      else await page.getByText('Periode data: Maret 2026', { exact: true }).waitFor();
      return { page, exceptions, unexpectedRequests };
    }

    async function openRecap(page, edit = false) {
      await page.getByText('Rekap Kumulatif & Tahunan', { exact: true }).click();
      await page.getByRole('region', { name: 'Hasil rekap indikator' }).waitFor();
      if (edit) await page.getByText('Isi atau perbarui rekap terpisah', { exact: true }).click();
    }

    async function makeRecapDirty(page) {
      await page.getByRole('spinbutton', { name: 'Total item obat', exact: true }).fill('321');
      await page.getByRole('textbox', { name: 'Sumber dan cara menyusun rekap (wajib)', exact: true }).fill('Register Januari sampai Maret, sampel sama tanpa duplikasi.');
      await page.getByRole('checkbox').check();
    }

    async function discardDialog(page, accept, action) {
      const dialogHandled = new Promise((resolve, reject) => page.once('dialog', async dialog => {
        try {
          assert.equal(dialog.type(), 'confirm');
          assert.match(dialog.message(), /perubahan capaian yang belum disimpan/);
          await (accept ? dialog.accept() : dialog.dismiss());
          resolve();
        } catch (error) { reject(error); }
      }));
      await action();
      await dialogHandled;
    }

    for (const role of ['PIC', 'ADMIN_PUSKESMAS', 'DINKES_ADMIN']) {
      await t.test(role + ' displays actual denominators, YTD scope and V1-only prorata', async () => {
        const { page, exceptions, unexpectedRequests } = await fixture({ role });
        try {
          await page.getByText('Puskesmas: Melati Uji', { exact: true }).waitFor();
          const actual = page.locator('[data-indicator-id="actual"]');
          const denominator = row => role === 'PIC' ? row.locator('dd').first() : row.locator('td').nth(3);
          assert.match(await actual.innerText(), /Aktual Maret 2026 saja \(PERIOD_ACTUAL\), bukan kumulatif/);
          assert.match(await actual.innerText(), /Penyebut aktual \(D\)/);
          assert.match(await denominator(actual).innerText(), /^100(?:\s|$)/);
          assert.doesNotMatch(await actual.innerText(), /prorata|tahunan \/ 12/i);
          const ytd = page.locator('[data-indicator-id="ytd"]');
          assert.match(await ytd.innerText(), /Histori kumulatif Januari sampai Maret 2026 \(YTD_ACTUAL\)/);
          assert.match(await ytd.innerText(), /Hanya baca; koreksi melalui rekap terpisah/);
          assert.match(await denominator(ytd).innerText(), /^300(?:\s|$)/);
          assert.equal(await ytd.getByRole('button', { name: 'Lihat indikator', exact: true }).count(), 1);
          const legacy = page.locator('[data-indicator-id="legacy"]');
          assert.match(await legacy.innerText(), /V1: realisasi Maret 2026; target prorata tahunan \/ 12/);
          assert.match(await denominator(legacy).innerText(), /^1(?:\.|\s)?000(?:,0|\.0)?(?:\s|$)/);
          assert.match(await page.locator('[data-indicator-id="estimated"]').innerText(), /D efektif: 45,5/);
          const zero = page.locator('[data-indicator-id="zero"]');
          assert.match(await denominator(zero).innerText(), /^0(?:\s|$)/);
          assert.match(await denominator(page.locator('[data-indicator-id="missing"]')).innerText(), /^Belum diisi/);
          if (role !== 'PIC') {
            assert.match(await actual.innerText(), /2,5 item\/resep/);
            assert.match(await actual.innerText(), /100 poin/);
            assert.doesNotMatch(await actual.innerText(), /2,5%|250%/);
          }
          if (role === 'DINKES_ADMIN') await page.getByRole('status').filter({ hasText: 'Akun Dinkes hanya dapat membaca capaian.' }).waitFor();
          await ytd.getByRole('button', { name: 'Lihat indikator', exact: true }).click();
          assert.deepEqual(await page.evaluate(() => window.picFixture.opened), ['ytd']);
          assert.deepEqual(await page.evaluate(() => window.picFixture.writes), []);
          assert.deepEqual(unexpectedRequests, []);
          assert.deepEqual(exceptions, []);
        } finally { await page.close(); }
      });
    }

    await t.test('PIC reaches the real cumulative recap with the selected scope on mobile', async () => {
      const { page, exceptions, unexpectedRequests } = await fixture({}, 375);
      try {
        await page.getByText('Rekap Kumulatif & Tahunan', { exact: true }).click();
        await page.getByRole('region', { name: 'Hasil rekap indikator' }).waitFor();
        assert.equal(await page.getByLabel('Akhir periode rekap').inputValue(), '3');
        assert.deepEqual(await page.evaluate(() => window.picFixture.requests), [
          '/records/monthly-observations',
          '/analytics/period-recap?year=2026&endMonth=3&healthCenterId=fixture-center',
        ]);
        await page.getByText('Isi atau perbarui rekap terpisah', { exact: true }).click();
        assert.equal(await page.getByRole('spinbutton', { name: 'Total item obat' }).isEnabled(), true);
        await page.evaluate(() => window.picFixture.render({ month: 6, year: 2025, active: false, center: 'other-center' }));
        await page.getByText('Periode data: Juni 2025', { exact: true }).waitFor();
        await page.getByText('Puskesmas: Kenanga Uji', { exact: true }).waitFor();
        const panel = page.locator('details').filter({ has: page.locator('summary', { hasText: /^Rekap Kumulatif/ }) });
        assert.equal(await panel.getAttribute('open'), null);
        await page.getByText('Rekap Kumulatif & Tahunan', { exact: true }).click();
        await page.getByRole('region', { name: 'Hasil rekap indikator' }).waitFor();
        assert.equal(await page.getByLabel('Akhir periode rekap').inputValue(), '6');
        assert.equal((await page.evaluate(() => window.picFixture.requests)).at(-1),
          '/analytics/period-recap?year=2025&endMonth=6&healthCenterId=other-center');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        assert.deepEqual(await page.evaluate(() => window.picFixture.writes), []);
        assert.deepEqual(unexpectedRequests, []);
        assert.deepEqual(exceptions, []);
      } finally { await page.close(); }
    });

    await t.test('inactive years and locks have distinct read-only explanations for every role', async () => {
      for (const role of ['PIC', 'ADMIN_PUSKESMAS', 'DINKES_ADMIN']) {
        const { page, exceptions } = await fixture({ role });
        try {
          await page.evaluate(() => window.picFixture.render({ year: 2025, active: false }));
          await page.getByText('Periode data: Maret 2025', { exact: true }).waitFor();
          const status = page.getByRole('status').filter({ hasText: 'Hanya baca.' });
          assert.match(await status.innerText(), /Tahun 2025 tidak aktif; data historis hanya dapat dibaca/);
          assert.doesNotMatch(await status.innerText(), /dikunci/);
          await page.evaluate(() => window.picFixture.render({ year: 2026, active: true, locked: true }));
          await page.getByText('Periode data: Maret 2026', { exact: true }).waitFor();
          assert.match(await status.innerText(), /Periode Maret 2026 dikunci/);
          assert.doesNotMatch(await status.innerText(), /tidak aktif/);
          assert.equal(await page.getByRole('button', { name: /^(Isi indikator|Ubah isian)$/ }).count(), 0);
          assert.deepEqual(exceptions, []);
        } finally { await page.close(); }
      }
    });

    for (const role of ['PIC', 'ADMIN_PUSKESMAS', 'DINKES_ADMIN']) {
      await t.test(role + ' filters recap assignments independently of an empty PIC roster', async () => {
        const { page, exceptions, unexpectedRequests } = await fixture({
          role, view: 'recap', rosterEmpty: true, recapIds: ['actual', 'ytd', 'zero'],
          assignments: { actual: 'fixture-pic', ytd: 'other-pic' },
        });
        try {
          await openRecap(page);
          const selector = page.getByLabel(/^Indikator \(/);
          assert.deepEqual(await selector.locator('option').evaluateAll(options => options.map(option => option.value)),
            role === 'PIC' ? ['actual'] : ['actual', 'ytd', 'zero']);
          if (role === 'PIC') {
            await page.getByText('Isi atau perbarui rekap terpisah', { exact: true }).click();
            assert.equal(await page.getByRole('spinbutton', { name: 'Total item obat', exact: true }).isEnabled(), true);
            await page.evaluate(() => window.picFixture.configure({ assignments: {} }));
            await page.getByRole('status').filter({ hasText: 'Tidak ada indikator rekap yang ditugaskan kepada Anda' }).waitFor();
            assert.equal(await page.getByRole('region', { name: 'Hasil rekap indikator' }).count(), 0);
            assert.equal(await selector.isDisabled(), true);
            assert.deepEqual(await selector.locator('option').allTextContents(), ['Tidak ada indikator yang cocok']);
            await page.getByRole('button', { name: 'Muat ulang rekap', exact: true }).click();
            await page.getByRole('status').filter({ hasText: 'Tidak ada indikator rekap yang ditugaskan kepada Anda' }).waitFor();
            assert.equal(await page.getByRole('region', { name: 'Hasil rekap indikator' }).count(), 0);
          }
          assert.deepEqual(await page.evaluate(() => window.picFixture.writes), []);
          assert.deepEqual(unexpectedRequests, []);
          assert.deepEqual(exceptions, []);
        } finally { await page.close(); }
      });
    }

    for (const navigation of ['editor close', 'panel close', 'end month', 'filter', 'indicator']) {
      await t.test('dirty recap cancel preserves and accept discards on ' + navigation, async () => {
        const { page, exceptions, unexpectedRequests } = await fixture({ recapIds: ['actual', 'ytd'] });
        try {
          await openRecap(page, true);
          await makeRecapDirty(page);
          const numerator = page.getByRole('spinbutton', { name: 'Total item obat', exact: true });
          const notes = page.getByRole('textbox', { name: 'Sumber dan cara menyusun rekap (wajib)', exact: true });
          const month = page.getByRole('combobox', { name: 'Akhir periode rekap', exact: true });
          const filter = page.getByRole('searchbox', { name: 'Cari indikator rekap', exact: true });
          const selector = page.getByLabel(/^Indikator \(/);
          const action = () => navigation === 'editor close'
            ? page.getByText('Isi atau perbarui rekap terpisah', { exact: true }).click()
            : navigation === 'panel close'
              ? page.getByText('Rekap Kumulatif & Tahunan', { exact: true }).click()
              : navigation === 'end month' ? month.selectOption('6')
                : navigation === 'filter' ? filter.fill('ytd') : selector.selectOption('ytd');
          await discardDialog(page, false, action);
          assert.equal(await numerator.inputValue(), '321');
          assert.equal(await notes.inputValue(), 'Register Januari sampai Maret, sampel sama tanpa duplikasi.');
          assert.equal(await page.getByRole('checkbox').isChecked(), true);
          assert.equal(await month.inputValue(), '3');
          assert.equal(await filter.inputValue(), '');
          assert.equal(await selector.inputValue(), 'actual');
          assert.equal(await page.evaluate(() => window.picFixture.requests.length), 2);

          await discardDialog(page, true, action);
          if (navigation === 'editor close' || navigation === 'panel close') {
            const summary = page.getByText(navigation === 'editor close'
              ? 'Isi atau perbarui rekap terpisah' : 'Rekap Kumulatif & Tahunan', { exact: true });
            assert.equal(await summary.locator('..').getAttribute('open'), null);
            await summary.click();
            if (navigation === 'panel close') {
              await page.getByRole('region', { name: 'Hasil rekap indikator' }).waitFor();
              await page.getByText('Isi atau perbarui rekap terpisah', { exact: true }).click();
            }
          } else {
            await page.getByRole('region', { name: 'Hasil rekap indikator' }).waitFor();
            if (navigation === 'end month') {
              assert.equal(await month.inputValue(), '6');
              assert.equal((await page.evaluate(() => window.picFixture.requests)).at(-1),
                '/analytics/period-recap?year=2026&endMonth=6&healthCenterId=fixture-center');
            } else {
              assert.equal(await selector.inputValue(), 'ytd');
              assert.equal(await filter.inputValue(), navigation === 'filter' ? 'ytd' : '');
            }
            await page.getByText('Isi atau perbarui rekap terpisah', { exact: true }).click();
          }
          assert.equal(await numerator.inputValue(), '250');
          assert.equal(await notes.inputValue(), '');
          assert.equal(await page.getByRole('checkbox').isChecked(), false);
          const dialogs = [];
          page.on('dialog', dialog => { dialogs.push(dialog.message()); void dialog.dismiss(); });
          await page.getByText('Rekap Kumulatif & Tahunan', { exact: true }).click();
          assert.equal(await page.getByText('Rekap Kumulatif & Tahunan', { exact: true }).locator('..').getAttribute('open'), null);
          assert.deepEqual(dialogs, []);
          assert.deepEqual(await page.evaluate(() => window.picFixture.writes), []);
          assert.deepEqual(unexpectedRequests, []);
          assert.deepEqual(exceptions, []);
        } finally { await page.close(); }
      });
    }

    const permissionChanges = [
      { name: 'role', options: { role: 'DINKES_ADMIN' }, recapReason: /Dinkes meninjau capaian/, editorReason: /Sesi pengguna berubah/ },
      { name: 'earlier month lock', options: { lockedMonths: [1] }, recapReason: /periode Januari 2026 terkunci/ },
      { name: 'current month lock', options: { locked: true }, recapReason: /periode Januari 2026 terkunci/, editorReason: /periode Maret 2026 terkunci/ },
      { name: 'Puskesmas scope', options: { center: 'other-center' }, recapReason: /pilih Puskesmas tempat Anda bertugas/, editorReason: /Lingkup Puskesmas atau periode berubah/ },
      { name: 'year scope', options: { year: 2025 }, recapReason: /Lingkup Puskesmas atau tahun berubah/, editorReason: /Lingkup Puskesmas atau periode berubah/ },
      { name: 'inactive year', options: { active: false }, recapReason: /tahun input aktif 2026/, editorReason: /tahun input aktif 2026/ },
      { name: 'assignment', options: { assignments: {} }, editorReason: /indikator ini tidak ditugaskan kepada Anda/ },
    ];
    for (const view of ['recap', 'do-editor']) {
      for (const change of permissionChanges.filter(change => view === 'recap' ? change.recapReason : change.editorReason)) {
        await t.test(view + ' becomes read-only after live ' + change.name + ' change', async () => {
          const { page, exceptions, unexpectedRequests } = await fixture({ view });
          try {
            if (view === 'recap') {
              await openRecap(page, true);
              await makeRecapDirty(page);
            } else {
              await page.getByRole('spinbutton', { name: 'Total item obat', exact: true }).fill('321');
              await page.getByRole('textbox', { name: 'Catatan sumber data', exact: true }).fill('Sumber uji bulanan.');
            }
            const form = view === 'recap'
              ? page.getByRole('region', { name: 'Hasil rekap indikator' }).locator('form')
              : page.getByRole('dialog', { name: 'Input DO 2026', exact: true }).locator('form');
            await page.evaluate(options => window.picFixture.configure(options), change.options);
            if (view === 'recap' && change.options.center) {
              await page.getByRole('region', { name: 'Hasil rekap indikator' }).waitFor();
              const summary = page.getByText('Isi atau perbarui rekap terpisah', { exact: true });
              assert.equal(await summary.locator('..').getAttribute('open'), null);
              await summary.click();
              assert.equal((await page.evaluate(() => window.picFixture.requests)).at(-1),
                '/analytics/period-recap?year=2026&endMonth=3&healthCenterId=other-center');
            }
            await form.getByRole('status').filter({ hasText: view === 'recap' ? change.recapReason : change.editorReason }).waitFor();
            for (const control of await form.locator('input, textarea, button[type="submit"]').all()) {
              assert.equal(await control.isDisabled(), true);
            }
            assert.equal(await form.getByRole('spinbutton', { name: 'Total item obat', exact: true }).inputValue(),
              view === 'recap' && change.options.center ? '250' : '321');
            // Exercise the live submit guard as well as the disabled controls.
            await form.evaluate(element => element.requestSubmit());
            await form.getByRole('alert').waitFor();
            assert.deepEqual(await page.evaluate(() => window.picFixture.writes), []);
            assert.deepEqual(unexpectedRequests, []);
            assert.deepEqual(exceptions, []);
          } finally { await page.close(); }
        });
      }
    }

    await t.test('successful recap save reloads its revision and clears the dirty draft without monthly writes', async () => {
      const { page, exceptions, unexpectedRequests } = await fixture({ saveRecaps: true });
      try {
        await openRecap(page, true);
        await makeRecapDirty(page);
        await page.getByRole('textbox', { name: 'Sumber dan cara menyusun rekap (wajib)', exact: true }).fill('  Register Januari-Maret, sampel sama tanpa duplikasi.  ');
        await page.getByRole('button', { name: 'Simpan rekap terpisah', exact: true }).click();
        await page.getByRole('status').filter({ hasText: 'Rekap terpisah tersimpan.' }).waitFor();
        const region = page.getByRole('region', { name: 'Hasil rekap indikator' });
        await region.getByText('Catatan rekap tersimpan: Register Januari-Maret, sampel sama tanpa duplikasi.', { exact: true }).waitFor();
        assert.equal(await region.locator('dd').first().innerText(), '321');
        assert.deepEqual(await page.evaluate(() => window.picFixture.writes), [[{
          year: 2026, endMonth: 3, indicatorId: 'actual', numerator: 321, denominator: 100,
          notes: 'Register Januari-Maret, sampel sama tanpa duplikasi.', confirmed: true, expectedRevision: 0,
        }]]);
        assert.equal(await page.evaluate(() => window.picFixture.requests.length), 3);
        await page.getByText('Isi atau perbarui rekap terpisah', { exact: true }).click();
        assert.equal(await page.getByRole('spinbutton', { name: 'Total item obat', exact: true }).inputValue(), '321');
        assert.equal(await page.getByRole('checkbox').isChecked(), false);
        const dialogs = [];
        page.on('dialog', dialog => { dialogs.push(dialog.message()); void dialog.dismiss(); });
        await page.getByText('Rekap Kumulatif & Tahunan', { exact: true }).click();
        assert.equal(await page.getByText('Rekap Kumulatif & Tahunan', { exact: true }).locator('..').getAttribute('open'), null);
        assert.deepEqual(dialogs, []);
        await openRecap(page, true);
        assert.equal(await page.getByRole('spinbutton', { name: 'Total item obat', exact: true }).inputValue(), '321');
        assert.deepEqual(unexpectedRequests, []);
        assert.deepEqual(exceptions, []);
      } finally { await page.close(); }
    });
  } finally {
    await browser?.close();
    await server?.close();
    await rm(cacheDir, { recursive: true, force: true });
  }
});
