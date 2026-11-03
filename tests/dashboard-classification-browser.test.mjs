import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from 'playwright';

const storeSource = `
const listeners = new Set();
let revision = 0;
export const state = { view: 'executive', month: 3, year: 2026, trend: null, records: [],
  centers: [], comparison: [], defer: false, loading: false, error: null };
export const requests = [], pending = [], navigation = [];
export function configure(options) {
  Object.assign(state, options);
  revision++;
  listeners.forEach(fn => fn());
}
export function release(index, error) {
  const request = pending[index];
  if (error) request.reject(new Error(error));
  else request.resolve(request.data);
}
export const pkpStore = {
  subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); },
  getSnapshot: () => revision, getServerSnapshot: () => revision,
  getLoadState: () => ({ loading: state.loading, error: state.error && new Error(state.error) }),
  getCurrentYear: () => state.year,
  getIndicators: () => state.records.map((record, i) => ({ id: String(i), klasterId: i % 5 + 1 })),
  getMonthlyRecord: id => state.records[Number(id)],
  getAnnualTrendData: () => state.trend,
  getPuskesmasList: () => state.centers,
  fetchSupervision: async quarter => {
    requests.push({ quarter, year: state.year });
    const data = { comparison: structuredClone(state.comparison) };
    if (state.defer) return new Promise((resolve, reject) => pending.push({ resolve, reject, data }));
    return data;
  },
};
`;

const entrySource = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { ExecutiveDashboard } from '/src/components/dashboard/ExecutiveDashboard.tsx';
import { DinkesSupervisionView } from '/src/components/dinkes/DinkesSupervisionView.tsx';
import { state, configure, requests, navigation, release } from 'virtual:classification-store';
import '/src/index.css';
const root = createRoot(document.getElementById('root'));
function render(options = {}) {
  configure(options);
  root.render(state.view === 'executive' ? React.createElement(ExecutiveDashboard, {
    selectedMonth: state.month, onNavigateToDataEntry: id => navigation.push(['entry', id]),
    onNavigateToPicDashboard: () => navigation.push(['pic']),
  }) : React.createElement(DinkesSupervisionView, {
    selectedMonth: state.month, onSelectPuskesmas: name => navigation.push(['center', name]),
  }));
}
window.classificationFixture = { render, requests, navigation, release };
render();
`;

const legacy = { scoringVersion: 'ILP_2026_V1', isComplete: true,
  classificationStatus: 'LEGACY_V1', aggregationStatus: 'LEGACY_V1' };
const provisional = { scoringVersion: 'PER_RECORD_VERSIONED', isComplete: true,
  classificationStatus: 'UNRESOLVED_CLASSIFICATION', aggregationStatus: 'PROVISIONAL_LEGACY_HIERARCHY' };
const category = score => score === null ? null : score >= 91 ? 'Kinerja Baik' : score >= 81 ? 'Kinerja Cukup' : 'Kinerja Kurang';
const clusters = score => Object.fromEntries([1, 2, 3, 4, 5].map(id => [id, score]));
const summary = (id, score, metadata = legacy) => ({ healthCenterId: id,
  nilaiKinerjaPuskesmas: score, klasterScores: clusters(score), kategoriPKP: category(score), ...metadata });
const center = id => ({ id, name: 'Puskesmas ' + id, code: id, headName: 'Kepala ' + id,
  // Cached numbers must never fill a missing comparison row or its metadata.
  currentScore: 100, kategoriPKP: 'Kinerja Baik', klasterScores: clusters(100), ...legacy });
const trend = (score, metadata = {}) => ({ scoringVersion: 'ILP_2026_V1', monthlyComplete: Array(12).fill(true),
  monthlyOverallScores: Array(12).fill(score), monthlyCategories: Array(12).fill(category(score)),
  klasters: [1, 2, 3, 4, 5].map(klasterId => ({ klasterId, monthlyScores: Array(12).fill(score) })), ...metadata });
const record = (score, metadata = {}) => ({ nilaiKinerja: score, pencapaianRiil: score,
  scoringVersion: 'ILP_2026_V1', isMissing: false, ...metadata });

test('dashboard classification with real components and isolated store', { timeout: 180000 }, async t => {
  const cacheDir = await mkdtemp('/tmp/opencode/dashboard-classification-vite-');
  let server, browser;
  try {
    server = await createServer({
      root: fileURLToPath(new URL('..', import.meta.url)), configFile: false, envFile: false, cacheDir,
      plugins: [{
        name: 'dashboard-classification-fixture', enforce: 'pre',
        resolveId(id) {
          if (id === '/classification-fixture.jsx') return '\0classification-fixture.jsx';
          if (id === 'virtual:classification-store' || /(?:^|\/)(?:apiStore|apiClient)(?:\.ts)?$/.test(id)) return '\0classification-store';
        },
        load(id) {
          if (id === '\0classification-fixture.jsx') return entrySource;
          if (id === '\0classification-store') return storeSource;
        },
        configureServer(vite) {
          vite.middlewares.use('/classification-test', async (_req, res) => {
            res.setHeader('Content-Type', 'text/html');
            res.end(await vite.transformIndexHtml('/classification-test', '<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><main id="root" style="padding:16px"></main><script type="module" src="/classification-fixture.jsx"></script></body></html>'));
          });
        },
      }, react()],
      server: { host: '127.0.0.1', port: 0 },
      optimizeDeps: { noDiscovery: true, include: ['react', 'react-dom/client', 'react/jsx-dev-runtime', 'lucide-react'] },
    });
    await server.listen();
    browser = await chromium.launch({ headless: true });
    const origin = new URL(server.resolvedUrls.local[0]).origin;
    const render = (page, options) => page.evaluate(options => window.classificationFixture.render(options), options);
    const row = (page, id) => page.locator('tbody tr').filter({ hasText: 'Puskesmas ' + id });
    const total = page => page.getByText('Skor Total PKP', { exact: true }).locator('..');
    const average = page => page.getByText('Rerata V1 Lengkap Kabupaten/Kota', { exact: true }).locator('..');
    const clusterRows = page => page.getByText('Capaian per Klaster Pelayanan (ILP)', { exact: true }).locator('../..').locator('+ div > div');
    async function fixture(width, options, run) {
      const context = await browser.newContext({ viewport: { width, height: 1000 }, serviceWorkers: 'block' });
      const page = await context.newPage();
      page.setDefaultTimeout(10000);
      const errors = [], unexpected = [];
      page.on('pageerror', error => errors.push(error.message));
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin !== origin || url.pathname.startsWith('/api/')) {
          unexpected.push(url.href);
          return route.abort();
        }
        return route.continue();
      });
      try {
        await page.goto(origin + '/classification-test');
        await page.waitForFunction(() => window.classificationFixture);
        await render(page, options);
        await run(page);
        assert.deepEqual(errors, []);
        assert.deepEqual(unexpected, []);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'No document overflow; table scrolls locally');
      } finally { await context.close(); }
    }

    for (const width of [1440, 375]) {
      await t.test(`${width}: executive retains complete legacy badges, distribution and navigation`, () => fixture(width, {
        trend: trend(95), records: [record(95), record(85), record(0), record(100, { scoringVersion: 'DO_2026_V2' }),
          record(100, { scoringVersion: undefined }), record(null, { isMissing: true })],
      }, async page => {
        await page.getByRole('heading', { name: 'Ringkasan Kinerja PKP', exact: true }).waitFor();
        assert.match(await total(page).innerText(), /95\.0%\s+Kinerja Baik/);
        assert.equal(await clusterRows(page).getByText('(Baik)', { exact: true }).count(), 5);
        for (const label of ['Kinerja Baik (≥ 91%)', 'Kinerja Cukup (81% sampai <91%)', 'Kinerja Kurang (< 81%)']) {
          assert.equal(await page.getByText(label, { exact: true }).locator('..').locator('div').innerText(), '1');
        }
        await page.getByRole('heading', { name: 'Klaster 3: Pelayanan Usia Dewasa dan Lansia', exact: true }).click();
        await page.getByRole('button', { name: 'Lihat Pemantauan PIC', exact: true }).click();
        assert.deepEqual(await page.evaluate(() => window.classificationFixture.navigation), [['entry', 3], ['pic']]);
      }));

      for (const [name, score, metadata, label] of [
        ['partial', 99, { monthlyComplete: Array(12).fill(false) }, 'Parsial; belum lengkap'],
        ['DO', 99, { scoringVersion: 'PER_RECORD_VERSIONED', monthlyCategories: Array(12).fill(null) }, 'Sementara DO; kategori belum ditetapkan'],
        ['missing metadata', 99, { scoringVersion: undefined, monthlyComplete: undefined }, 'Klasifikasi belum tersedia'],
        ['zero', 0, {}, 'Kinerja Kurang'],
        ['null', null, {}, 'Belum dinilai'],
      ]) {
        await t.test(`${width}: executive ${name} preserves arithmetic without false classification`, () => fixture(width, {
          trend: trend(score, metadata), records: [],
        }, async page => {
          await page.getByRole('heading', { name: 'Ringkasan Kinerja PKP', exact: true }).waitFor();
          assert.match(await total(page).innerText(), new RegExp(label));
          assert.match(await total(page).innerText(), score === null ? /\n-\n/ : new RegExp(score.toFixed(1).replace('.', '\\.') + '%'));
          const rows = clusterRows(page);
          assert.equal(await rows.count(), 5);
          if (score === 99) {
            assert.equal(await rows.getByText(label, { exact: true }).count(), 5);
            assert.equal(await rows.getByText(/\((Baik|Cukup|Kurang)\)/).count(), 0);
            assert.equal(await rows.locator('.bg-emerald-500, .bg-amber-500, .bg-rose-500').count(), 0);
          } else if (score === 0) assert.equal(await rows.getByText('(Kurang)', { exact: true }).count(), 5);
          else {
            assert.equal(await rows.getByText('Belum dinilai', { exact: true }).count(), 5);
            assert.equal(await rows.getByText(/\((Baik|Cukup|Kurang)\)/).count(), 0);
          }
        }));
      }

      await t.test(`${width}: executive month change replaces DO/partial with complete legacy`, () => fixture(width, {
        trend: trend(99, { scoringVersion: 'PER_RECORD_VERSIONED', monthlyComplete: Array(12).fill(false) }),
      }, async page => {
        await total(page).getByText(/Sementara DO.*parsial/).waitFor();
        const next = trend(85, { monthlyComplete: Array.from({ length: 12 }, (_, i) => i === 3) });
        next.monthlyOverallScores[2] = 99;
        await render(page, { month: 4, trend: next });
        await total(page).getByText('Kinerja Cukup', { exact: true }).waitFor();
        assert.match(await total(page).innerText(), /85\.0%/);
        assert.equal(await clusterRows(page).getByText('(Cukup)', { exact: true }).count(), 5);
        assert.equal(await page.getByText(/Sementara DO; kategori/).count(), 0);
      }));

      await t.test(`${width}: supervision ranks only complete classifiable V1 in mixed centers`, () => fixture(width, {
        view: 'supervision', centers: ['good', 'fair', 'zero', 'partial', 'do', 'null', 'unknown', 'cached'].map(center),
        comparison: [summary('good', 95), summary('fair', 85), summary('zero', 0), summary('partial', 100, { ...legacy, isComplete: false }),
          summary('do', 99, provisional), summary('null', null), summary('unknown', 100, {})],
      }, async page => {
        await page.getByRole('table').waitFor();
        assert.match(await average(page).innerText(), /60\.0%\s+3 V1 lengkap \/ 8 Puskesmas Terdaftar/);
        for (const id of ['good', 'fair', 'zero']) {
          assert.equal(await row(page, id).locator('td').first().innerText(), String(['good', 'fair', 'zero'].indexOf(id) + 1));
        }
        assert.match(await row(page, 'zero').locator('td').nth(7).innerText(), /0\.0%\s+\(Kurang\)/);
        for (const id of ['partial', 'do', 'null', 'unknown', 'cached']) {
          assert.equal(await row(page, id).locator('td').first().innerText(), '-');
          assert.doesNotMatch(await row(page, id).locator('td').nth(7).innerText(), /\((Baik|Cukup|Kurang)\)/);
        }
        assert.match(await row(page, 'partial').innerText(), /100\.0%\s+Parsial; belum lengkap/);
        assert.match(await row(page, 'do').innerText(), /99\.0%\s+Sementara DO; kategori belum ditetapkan/);
        assert.match(await row(page, 'unknown').innerText(), /100\.0%\s+Klasifikasi belum tersedia/);
        assert.equal(await row(page, 'cached').locator('td').nth(2).innerText(), '-');
        for (const label of ['Kelompok I: Kinerja Baik', 'Kelompok II: Kinerja Cukup', 'Kelompok III: Kinerja Kurang']) {
          const card = page.getByText(label, { exact: true }).locator('../..');
          assert.match(await card.innerText(), /1 Puskesmas/);
          await card.click();
          assert.equal(await page.locator('tbody tr').count(), 1);
          await card.click();
        }
        await row(page, 'do').getByRole('button', { name: 'Inspeksi', exact: true }).click();
        await row(page, 'partial').locator('td').nth(1).click();
        assert.deepEqual(await page.evaluate(() => window.classificationFixture.navigation), [['center', 'Puskesmas do'], ['center', 'Puskesmas partial']]);
      }));

      await t.test(`${width}: DO zero and null remain unranked even with complete arithmetic`, () => fixture(width, {
        view: 'supervision', centers: ['do-zero', 'do-null'].map(center),
        comparison: [summary('do-zero', 0, provisional), summary('do-null', null, { ...provisional, isComplete: false })],
      }, async page => {
        await page.getByRole('table').waitFor();
        assert.match(await average(page).innerText(), /\n-\n0 V1 lengkap/);
        assert.match(await row(page, 'do-zero').locator('td').nth(7).innerText(), /0\.0%\s+Sementara DO/);
        assert.match(await row(page, 'do-null').locator('td').nth(7).innerText(), /-\s+Sementara DO.*parsial/);
        assert.equal(await page.locator('tbody').getByText(/\((Baik|Cukup|Kurang)\)/).count(), 0);
        assert.equal(await page.locator('tbody tr td:first-child').allTextContents().then(values => values.every(value => value.trim() === '-')), true);
      }));

      await t.test(`${width}: supervision metadata gates fail closed independently`, () => fixture(width, {
        view: 'supervision', centers: ['complete', 'classification', 'aggregation', 'version', 'category'].map(center),
        comparison: [summary('complete', 100, { ...legacy, isComplete: undefined }),
          summary('classification', 100, { ...legacy, classificationStatus: 'UNRESOLVED_CLASSIFICATION' }),
          summary('aggregation', 100, { ...legacy, aggregationStatus: 'PROVISIONAL_LEGACY_HIERARCHY' }),
          summary('version', 100, { ...legacy, scoringVersion: 'DO_2026_V2' }),
          { ...summary('category', 100), kategoriPKP: null }],
      }, async page => {
        await page.getByRole('table').waitFor();
        assert.match(await average(page).innerText(), /0 V1 lengkap/);
        assert.equal(await page.locator('tbody').getByText(/\((Baik|Cukup|Kurang)\)/).count(), 0);
      }));

      await t.test(`${width}: quarter/year loading hides stale results and ignores superseded responses`, () => fixture(width, {
        view: 'supervision', centers: [center('good')], comparison: [summary('good', 95)],
      }, async page => {
        await page.getByRole('table').waitFor();
        await render(page, { month: 4, defer: true, comparison: [summary('good', 100, provisional)] });
        await page.getByRole('status').getByText('Memuat perbandingan kinerja Puskesmas...', { exact: true }).waitFor();
        assert.equal(await page.getByRole('table').count(), 0);
        await page.waitForFunction(() => window.classificationFixture.requests.length === 2);
        await render(page, { month: 7, year: 2025, comparison: [summary('good', 85)] });
        await page.waitForFunction(() => window.classificationFixture.requests.length === 3);
        await page.evaluate(() => window.classificationFixture.release(1));
        await page.getByRole('table').waitFor();
        assert.match(await average(page).innerText(), /85\.0%/);
        await page.evaluate(() => window.classificationFixture.release(0));
        await page.getByRole('heading', { name: /TW 3, 2025/ }).waitFor();
        assert.match(await average(page).innerText(), /85\.0%/);
        assert.deepEqual(await page.evaluate(() => window.classificationFixture.requests), [
          { quarter: 1, year: 2026 }, { quarter: 2, year: 2026 }, { quarter: 3, year: 2025 },
        ]);
        await render(page, { month: 10 });
        await page.waitForFunction(() => window.classificationFixture.requests.length === 4);
        await page.evaluate(() => window.classificationFixture.release(2, 'Fixture unavailable'));
        await page.getByRole('alert').getByText('Fixture unavailable', { exact: true }).waitFor();
        assert.equal(await page.getByRole('table').count(), 0);
      }));
    }
  } finally {
    await browser?.close();
    await server?.close();
    await rm(cacheDir, { recursive: true, force: true });
  }
});
