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
export const state = { do: true, quarterScore: 87.25, quarterAvailable: true, loading: false, error: null };
const series = (...values) => Array.from({ length: 12 }, (_, i) => values[i] ?? null);
const indicator = { id: 'K5-R26', no: '5.26', indikator: 'Rerata item obat', kegiatan: 'Resep',
  klasterId: 5, sectionCode: '5.1', satuan: 'resep', isHead: false };
export const navigations = [];
export function configure(options) { Object.assign(state, options); revision++; listeners.forEach(fn => fn()); }
export const pkpStore = {
  subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); },
  getSnapshot: () => revision, getServerSnapshot: () => revision,
  getCurrentYear: () => 2026,
  getLoadState: () => ({ loading: state.loading, error: state.error }),
  getAnnualTargets: () => ({ 'K5-R26': { targetSasaran: 1200 } }),
  getPeriodLock: () => ({ status: 'DRAFT' }),
  getOfficialSheet7Data: (quarter, year) => {
    if (quarter !== 1 || year !== 2026 || !state.quarterAvailable) throw new Error('Unavailable');
    return { nilaiKinerjaPuskesmas: state.quarterScore, isComplete: !state.do,
      classificationStatus: state.do ? 'UNRESOLVED_CLASSIFICATION' : 'LEGACY_V1' };
  },
  getAnnualTrendData: () => ({
    year: 2026, aggregation: state.do ? 'ANNUAL_MEAN_UNAVAILABLE_FOR_DO_PROFILES' : 'ARITHMETIC_MEAN_COMPLETED_MONTHS_NOT_CUMULATIVE_OFFICIAL',
    monthlyOverallScores: series(100, 0, 33.33), monthlyComplete: series(true, true, false).map(Boolean),
    annualAveragePKP: state.do ? null : 50, annualCategoryPKP: state.do ? null : 'Kinerja Kurang',
    highestMonth: { name: 'Januari', score: 100 }, lowestMonth: { name: 'Februari', score: 0 },
    klasters: [{ klasterId: 5, name: 'Klaster 5', monthlyScores: series(100, 0, 33.33), annualAverage: state.do ? null : 50, category: null }],
    subKlasters: [{ klasterId: 5, code: '5.1', name: 'POR', monthlyScores: series(100, 0), annualAverage: state.do ? null : 50, category: null }],
  }),
  getAnnualIndicatorsTrend: klaster => klaster && klaster !== 5 ? [] : [{
    indicator, monthlyValues: series(250, 0), monthlyPct: state.do ? series() : series(25, 0),
    monthlyMeasurements: series(2.5, 0, 77.99995), monthlyUnits: series('ITEMS_PER_PRESCRIPTION', 'ITEMS_PER_PRESCRIPTION', 'SCORE'),
    monthlyVersions: series(state.do ? 'DO_2026_V2' : 'ILP_2026_V1'), monthlyScores: series(100, 0),
    annualAverageScore: state.do ? null : 50, annualAveragePct: state.do ? null : 12.5, category: null,
  }],
};
`;

const entrySource = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { AnnualTrendDashboard } from '/src/components/dashboard/AnnualTrendDashboard.tsx';
import { configure, navigations } from 'virtual:period-trend-store';
import '/src/index.css';
window.periodTrendFixture = { configure, navigations };
createRoot(document.getElementById('root')).render(React.createElement(AnnualTrendDashboard, {
  onNavigateToMonth: month => navigations.push(month),
}));
`;

test('period trend renders cumulative recap separately from monthly measurements', async t => {
  const cacheDir = await mkdtemp('/tmp/opencode/period-trend-vite-');
  let server, browser;
  try {
    server = await createServer({
      root: fileURLToPath(new URL('..', import.meta.url)), configFile: false, envFile: false, cacheDir,
      plugins: [{
        name: 'period-trend-fixture', enforce: 'pre',
        resolveId(id) {
          if (id === '/period-trend-fixture.jsx') return '\0period-trend-entry';
          if (id === 'virtual:period-trend-store' || /(?:^|\/)apiStore(?:\.ts)?$/.test(id)) return '\0period-trend-store';
        },
        load(id) {
          if (id === '\0period-trend-entry') return entrySource;
          if (id === '\0period-trend-store') return storeSource;
        },
        configureServer(vite) {
          vite.middlewares.use('/period-trend-test', async (_req, res) => {
            res.setHeader('Content-Type', 'text/html');
            res.end(await vite.transformIndexHtml('/period-trend-test', '<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/period-trend-fixture.jsx"></script></body></html>'));
          });
        },
      }, react()],
      server: { host: '127.0.0.1', port: 0 },
      optimizeDeps: { noDiscovery: true, include: ['react', 'react-dom/client', 'react/jsx-dev-runtime', 'lucide-react'] },
    });
    await server.listen();
    browser = await chromium.launch({ headless: true });
    const origin = new URL(server.resolvedUrls.local[0]).origin;
    for (const width of [375, 1440]) {
      await t.test(`desktop/mobile period semantics at ${width}px`, async () => {
        const page = await browser.newPage({ viewport: { width, height: 900 } });
        const exceptions = [], unexpected = [];
        page.on('pageerror', error => exceptions.push(error.message));
        await page.route('**/*', route => {
          const url = new URL(route.request().url());
          if (url.origin !== origin || url.pathname.startsWith('/api/')) { unexpected.push(url.href); return route.abort(); }
          return route.continue();
        });
        try {
          await page.goto(origin + '/period-trend-test');
          const quarter = page.locator('div.bg-white').filter({ has: page.getByText('Rekap TW I (Jan-Mar)', { exact: true }) }).last();
          await quarter.getByText('87.3%', { exact: true }).waitFor();
          await quarter.getByText(/masih parsial/).waitFor();
          await page.getByText('2 / 12', { exact: true }).waitFor();
          await page.getByText('Agregat DO bersifat provisional; kategori V1 tidak diterapkan.', { exact: true }).waitFor();
          await page.evaluate(() => window.periodTrendFixture.configure({ quarterScore: 0 }));
          await quarter.getByText('0.0%', { exact: true }).waitFor();
          await page.evaluate(() => window.periodTrendFixture.configure({ quarterAvailable: false }));
          await quarter.getByText('Rekap triwulan belum tersedia.', { exact: true }).waitFor();
          assert.equal(await quarter.getByText('33.3%', { exact: true }).count(), 0);

          await page.getByRole('button', { name: 'Matriks Rinci Indikator', exact: true }).click();
          let cells = page.locator('tbody tr').first().locator('td');
          assert.equal(await cells.nth(3).innerText(), '-');
          await page.getByRole('button', { name: 'Pengukuran DO (satuan asli)', exact: true }).click();
          await cells.nth(4).getByText('2,5 item/resep', { exact: true }).waitFor();
          assert.equal(await cells.nth(5).innerText(), '0 item/resep');
          assert.equal(await cells.nth(6).innerText(), '77,99995 poin');
          assert.equal(await cells.nth(7).innerText(), '-');
          assert.equal(await cells.nth(16).innerText(), '-');

          const downloadPromise = page.waitForEvent('download');
          await page.getByRole('button', { name: 'Ekspor CSV', exact: true }).click();
          const download = await downloadPromise;
          let csv = '';
          for await (const chunk of await download.createReadStream()) csv += chunk.toString();
          assert.match(csv, /Target\/Bln V1,Metrik/);
          assert.match(csv, /"MEASUREMENT","2,5 item\/resep","0 item\/resep","77,99995 poin"/);
          assert.match(csv, /"resep","-"/);

          await page.getByRole('button', { name: 'Capaian Riil %', exact: true }).click();
          assert.equal(await cells.nth(4).innerText(), '-');
          await page.getByRole('button', { name: 'Numerator Riil', exact: true }).click();
          assert.equal(await cells.nth(4).innerText(), '250');
          assert.equal(await cells.nth(5).innerText(), '0');
          await page.getByRole('button', { name: 'Nilai Kinerja (0–100)', exact: true }).click();
          assert.equal(await cells.nth(4).innerText(), '100.0');
          await page.evaluate(() => window.periodTrendFixture.configure({ do: false, quarterAvailable: true }));
          await quarter.getByText('Rekap kumulatif Januari-Maret dari server.', { exact: true }).waitFor();
          assert.equal(await cells.nth(3).innerText(), '100.0');
          assert.equal(await cells.nth(16).innerText(), '50.0');
          await page.getByRole('columnheader').filter({ hasText: 'B06' }).click();
          assert.deepEqual(await page.evaluate(() => window.periodTrendFixture.navigations), [6]);
          const overflow = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth,
            elements: [...document.querySelectorAll('body *')].filter(el => el.getBoundingClientRect().right > innerWidth + 1 && getComputedStyle(el).position !== 'absolute')
              .slice(0, 8).map(el => ({ tag: el.tagName, class: el.className, right: el.getBoundingClientRect().right })) }));
          assert.ok(overflow.scroll <= overflow.width, JSON.stringify(overflow));
          await page.getByRole('textbox').fill('tidak ditemukan');
          await page.getByText('Tidak ada data yang sesuai dengan filter. Ubah filter untuk melihat data lain.', { exact: true }).waitFor();
          await page.evaluate(() => window.periodTrendFixture.configure({ loading: true }));
          await page.getByRole('status').getByText('Memuat tren tahunan...', { exact: true }).waitFor();
          await page.evaluate(() => window.periodTrendFixture.configure({ loading: false, error: { message: 'Koneksi analitik gagal' } }));
          await page.getByRole('alert').getByText('Koneksi analitik gagal', { exact: true }).waitFor();
          assert.deepEqual(exceptions, []);
          assert.deepEqual(unexpected, []);
        } finally { await page.close(); }
      });
    }
  } finally {
    await browser?.close();
    await server?.close();
    await rm(cacheDir, { recursive: true, force: true });
  }
});
