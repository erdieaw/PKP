import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from 'playwright';

const storeSource = `
export const state = { role: 'ADMIN_PUSKESMAS', center: 'home', yearAvailable: true, active: true };
export const writes = [];
export class ApiError extends Error {}
export const pkpStore = {
  subscribe: () => () => {}, getSnapshot: () => 0, getServerSnapshot: () => 0,
  getCurrentUser: () => ({ id: 'fixture-user', role: state.role, healthCenterId: 'home' }),
  getSelectedHealthCenterId: () => state.center,
  getCurrentYear: () => 2026, getYears: () => state.yearAvailable ? [{ year: 2026 }] : [],
  isActiveYear: () => state.active, isMutating: () => false,
  getLoadState: () => ({ loading: false }), getIndicators: () => [],
  getSubKlasters: () => [], getPuskesmasList: () => [],
  getPicsByHealthCenter: () => [], getAdminPuskesmasList: () => [],
  getRecommendations: () => [{ id: 'fixture-rec', sectionCode: '1.1', sectionName: 'Bagian Uji',
    klasterId: 1, quarter: 1, recommendationText: 'Rekomendasi uji', puskesmasRtl: '', status: 'PENDING' }],
  refreshScope: async () => {},
};
export const api = { request: async (path, options) => { writes.push({ path, ...options }); } };
`;

const entrySource = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { Sidebar } from '/src/components/layout/Sidebar.tsx';
import { MasterDataHub } from '/src/components/master-data/MasterDataHub.tsx';
import { state, writes } from 'virtual:evaluation-store';
import '/src/index.css';
Object.assign(state, Object.fromEntries(new URLSearchParams(location.search)));
state.yearAvailable = state.yearAvailable !== 'false';
state.active = state.active !== 'false';
createRoot(document.getElementById('root')).render(React.createElement('div', { className: 'flex' },
  React.createElement('div', { className: 'hidden md:block' }, React.createElement(Sidebar, { activeTab: 'master-data', userRole: state.role,
    isDinkesMode: state.role === 'DINKES_ADMIN', selectedKlaster: 0,
    globalMode: !state.yearAvailable || !state.center, busy: false, selectedPuskesmas: 'Puskesmas Uji' })),
  React.createElement('main', { className: 'flex-1 min-w-0 p-4' }, React.createElement(MasterDataHub, { selectedMonth: 1 }))));
window.evaluationWrites = writes;
`;

test('Evaluasi belongs to the admin Puskesmas master menu', async t => {
  const cacheDir = await mkdtemp('/tmp/opencode/evaluation-menu-vite-');
  let server, browser;
  try {
    server = await createServer({
      root: fileURLToPath(new URL('..', import.meta.url)), configFile: false, envFile: false, cacheDir,
      plugins: [{
        name: 'evaluation-menu-fixture', enforce: 'pre',
        resolveId(id) {
          if (id === '/evaluation-fixture.jsx') return '\0evaluation-fixture.jsx';
          if (id === 'virtual:evaluation-store' || /(?:^|\/)(?:apiStore|apiClient)(?:\.ts)?$/.test(id)) return '\0evaluation-store';
          if (id === './CatalogManager') return '\0evaluation-catalog';
        },
        load(id) {
          if (id === '\0evaluation-fixture.jsx') return entrySource;
          if (id === '\0evaluation-store') return storeSource;
          if (id === '\0evaluation-catalog') return 'export const CatalogManager = () => null;';
        },
        configureServer(vite) {
          vite.middlewares.use('/evaluation-test', async (_req, res) => {
            res.setHeader('Content-Type', 'text/html');
            res.end(await vite.transformIndexHtml('/evaluation-test', '<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/evaluation-fixture.jsx"></script></body></html>'));
          });
        },
      }, react()],
      server: { host: '127.0.0.1', port: 0 },
      optimizeDeps: { noDiscovery: true, include: ['react', 'react-dom/client', 'react/jsx-dev-runtime', 'lucide-react'] },
    });
    await server.listen();
    browser = await chromium.launch({ headless: true });
    const origin = new URL(server.resolvedUrls.local[0]).origin;
    async function fixture(params = {}, width = 1440) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      page.setDefaultTimeout(15000);
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin === origin && !url.pathname.startsWith('/api/')) return route.continue();
        if (!url.hostname.endsWith('googleapis.com') && !url.hostname.endsWith('gstatic.com')) errors.push(`Unexpected request: ${url.pathname}`);
        return route.abort();
      });
      await page.goto(`${origin}/evaluation-test?${new URLSearchParams(params)}`);
      try {
        await page.getByRole('heading', { name: 'Pengelolaan Data', exact: true }).or(page.getByRole('alert')).waitFor();
      } catch (error) {
        await page.close();
        throw new Error(errors.join('\n') || error.message);
      }
      return { page, errors };
    }

    for (const width of [1440, 390]) {
      await t.test(`admin opens evaluation and edits RTL from Master at ${width}px`, async () => {
        const { page, errors } = await fixture({}, width);
        try {
          assert.equal(await page.locator('aside').getByRole('button', { name: 'Rekomendasi Dinkes & RTL', exact: true }).count(), 0);
          await page.locator('main').getByRole('button', { name: 'Evaluasi', exact: true }).click();
          await page.getByRole('heading', { name: 'Rekomendasi Dinas Kesehatan & Rencana Tindak Lanjut (RTL)', exact: true }).waitFor();
          assert.equal(await page.getByRole('button', { name: 'Simpan Rekomendasi', exact: true }).count(), 0);
          await page.getByRole('button', { name: 'Respons RTL', exact: true }).click();
          await page.getByLabel('Analisis Penyebab', { exact: true }).fill('Analisis uji');
          await page.getByPlaceholder('Tuliskan rencana perbaikan mutu, jadwal kegiatan, dan penanggung jawab...').fill('RTL uji');
          await page.getByRole('button', { name: 'Simpan RTL', exact: true }).click();
          await page.getByText('Analisis penyebab dan RTL berhasil diperbarui.', { exact: true }).waitFor();
          assert.deepEqual(await page.evaluate(() => window.evaluationWrites), [{
            path: '/recommendations/fixture-rec/action-plan', method: 'PATCH',
            body: { healthCenterId: 'home', analisisPenyebab: 'Analisis uji', actionPlanText: 'RTL uji', statusFollowUp: 'PENDING' },
          }]);
          assert.deepEqual(errors, []);
        } finally { await page.close(); }
      });
    }

    for (const [name, params] of [
      ['Dinkes', { role: 'DINKES_ADMIN' }], ['PIC', { role: 'PIC' }],
      ['foreign center', { center: 'other' }], ['no center', { center: '' }],
      ['no reporting year', { yearAvailable: 'false' }],
    ]) {
      await t.test(`${name} cannot open the admin-only evaluation tab`, async () => {
        const { page, errors } = await fixture(params);
        try {
          assert.equal(await page.locator('main').getByRole('button', { name: 'Evaluasi', exact: true }).count(), 0);
          assert.equal(await page.getByRole('button', { name: 'Respons RTL', exact: true }).count(), 0);
          if (params.role === 'DINKES_ADMIN') assert.equal(await page.locator('aside').getByRole('button', { name: 'Rekomendasi Dinkes & RTL', exact: true }).count(), 1);
          if (params.role === 'PIC') assert.equal(await page.locator('aside').getByRole('button', { name: 'Rekomendasi & RTL', exact: true }).count(), 1);
          assert.deepEqual(errors, []);
        } finally { await page.close(); }
      });
    }

    await t.test('historical evaluation remains readable without RTL editing', async () => {
      const { page, errors } = await fixture({ active: 'false' });
      try {
        await page.getByRole('button', { name: 'Evaluasi', exact: true }).click();
        assert.equal(await page.getByRole('button', { name: 'Respons RTL', exact: true }).isDisabled(), true);
        assert.deepEqual(errors, []);
      } finally { await page.close(); }
    });
  } finally {
    await browser?.close();
    await server?.close();
    await rm(cacheDir, { recursive: true, force: true });
  }
});
