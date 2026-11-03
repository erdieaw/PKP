import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from 'playwright';

// Isolated frontend contract fixtures, not a substitute for backend/MinIO integration tests.
const fixtureSource = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { api } from '/src/services/apiClient.ts';
import { pkpStore } from '/src/services/apiStore.ts';
import { ExportReportModal } from '/src/components/export/ExportReportModal.tsx';
import { OfficialPerformanceSheet7 } from '/src/components/official-sheet7/OfficialPerformanceSheet7.tsx';
import { IndicatorDetailDrawer } from '/src/components/recommendation/IndicatorDetailDrawer.tsx';
import { Do2026Editor } from '/src/components/data-entry/Do2026Editor.tsx';
const indicator = { id: 'indicator', no: '1', sectionCode: '1.1', klasterId: 1, indikator: 'Fixture indicator', satuan: '%', polarity: 'POSITIVE' };
const doIndicator = { ...indicator, id: 'do-indicator', indikator: 'Fixture DO indicator', do2026: {
  status: 'IMPLEMENTED', numeratorLabel: 'Pembilang aktual (N)', denominatorLabel: 'Penyebut aktual (D)',
  numeratorInput: 'INTEGER', denominatorInput: 'INTEGER', targetDisplay: '100%' } };
const doRecord = { pencapaianRiil: 2, totalSasaran: 4, scoringVersion: 'DO_2026_V2', inputBasis: 'PERIOD_ACTUAL',
  notes: 'Stored source', evidenceId: 'stored-evidence', isMissing: false };
const summary = { year: 2025, quarter: 1, periodLabel: 'Triwulan 1', puskesmasName: 'Fixture', klasterScores: {}, rows: [] };
pkpStore.state = { ...pkpStore.state, year: 2025, healthCenterId: 'center', activePeriod: { year: 2025 },
  user: { id: 'admin', role: 'ADMIN_PUSKESMAS', healthCenterId: 'center' }, indicators: [indicator],
  sheets: { 1: summary }, months: { 1: { indicator: { pencapaianRiil: 1, evidenceId: 'evidence', notes: '', isMissing: false } } } };
const root = createRoot(document.getElementById('root'));
const render = (view, month = 1, options = {}) => {
  let selectedIndicator = doIndicator, record = doRecord;
  if (view.startsWith('do-')) {
    if (options.guidance) selectedIndicator = { ...doIndicator, do2026: { ...doIndicator.do2026,
      cumulativeInstruction: 'Panduan kumulatif khusus profil.', assessmentInstruction: 'Penilaian masih memerlukan konfirmasi sumber.' } };
    if (options.unimplemented) selectedIndicator = { ...doIndicator, do2026: { ...doIndicator.do2026, status: 'UNRESOLVED_RULE', reason: 'Aturan pengukuran perlu ditinjau.' } };
    record = { ...doRecord, ...(options.historicalYtd ? { inputBasis: 'YTD_ACTUAL' } : {}),
      ...(options.missing ? { pencapaianRiil: null, isMissing: true, scoringVersion: undefined } : {}) };
    pkpStore.state = { ...pkpStore.state, year: 2026, activePeriod: { year: 2026 }, indicators: [indicator, selectedIndicator],
      periods: options.locked ? [{ periodNumber: month, isQuarter: false, status: 'VERIFIED' }] : [],
      months: { ...pkpStore.state.months, [month]: { ...pkpStore.state.months[month], [doIndicator.id]: record } } };
  }
  root.render(view === 'modal'
  ? React.createElement(ExportReportModal, { isOpen: true, onClose: () => render('none'), selectedMonth: 1, puskesmasName: 'Fixture' })
  : view === 'sheet' ? React.createElement(OfficialPerformanceSheet7)
  : view === 'evidence' ? React.createElement(IndicatorDetailDrawer, { indicator, selectedMonth: month, onClose: () => render('none') })
  : view === 'do-drawer' ? React.createElement(IndicatorDetailDrawer, { indicator: selectedIndicator, selectedMonth: month, onClose: () => render('none') })
  : view === 'do-editor' ? React.createElement(Do2026Editor, { indicator: selectedIndicator, record, year: 2026, month,
    canEdit: pkpStore.canInputOwnPeriod(2026) && !pkpStore.isPeriodLocked(2026, month), onClose: () => render('none') })
  : null);
};
api.setSession({ accessToken: 'old-access', refreshToken: 'fixture-refresh' });
window.gateway = { api, store: pkpStore, render, downloads: [], revoked: [], saves: [], saveFailures: 0 };
pkpStore.saveRecord = async (indicatorId, month, data, year = pkpStore.getCurrentYear()) => {
  window.gateway.saves.push({ indicatorId, month, data: { ...data }, year });
  if (window.gateway.saveFailures > 0) { window.gateway.saveFailures--; throw new Error('Monthly save failed'); }
  pkpStore.state = { ...pkpStore.state, months: { ...pkpStore.state.months, [month]: {
    ...pkpStore.state.months[month], [indicatorId]: { ...pkpStore.getMonthlyRecord(indicatorId, month), ...data } } } };
};
const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
URL.createObjectURL = blob => { const url = create(blob); window.gateway.downloads.push({ url, size: blob.size }); return url; };
URL.revokeObjectURL = url => { window.gateway.revoked.push(url); revoke(url); };
`;

test('authenticated private storage gateway frontend', async t => {
  const server = await createServer({
    root: fileURLToPath(new URL('..', import.meta.url)), configFile: false, envFile: false,
    cacheDir: 'node_modules/.vite/storage-gateway',
    plugins: [react(), {
      name: 'gateway-test-fixture',
      resolveId(id) { if (id === '/gateway-fixture.jsx') return '\0gateway-fixture.jsx'; },
      load(id) { if (id === '\0gateway-fixture.jsx') return fixtureSource; },
      configureServer(vite) {
        vite.middlewares.use('/gateway-test', async (_req, res) => {
          res.setHeader('Content-Type', 'text/html');
          res.end(await vite.transformIndexHtml('/gateway-test', '<html><body><div id="root"></div><script type="module" src="/gateway-fixture.jsx"></script></body></html>'));
        });
      },
    }],
    server: { host: '127.0.0.1', port: 0 },
    optimizeDeps: { noDiscovery: true, include: ['react', 'react-dom/client', 'react/jsx-dev-runtime', 'lucide-react'] },
    define: { 'import.meta.env.VITE_API_BASE_URL': JSON.stringify('/api/v1') },
  });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({ headless: true });
    const origin = server.resolvedUrls.local[0];
    async function fixture(handler) {
      const page = await browser.newPage();
      page.setDefaultTimeout(30000);
      const requests = [], exceptions = [];
      page.on('pageerror', error => exceptions.push(error.message));
      await page.route('**/*', route => new URL(route.request().url()).origin === new URL(origin).origin
        ? route.continue() : route.abort());
      await page.route('**/api/v1/**', async route => {
        const request = route.request();
        const url = new URL(request.url());
        requests.push({ path: url.pathname.slice('/api/v1'.length), search: url.search, method: request.method(),
          auth: request.headers().authorization, type: request.headers()['content-type'], body: request.postDataBuffer() });
        await handler(route, requests.at(-1));
      });
      await page.goto(`${origin}gateway-test`, { timeout: 60000 });
      await page.waitForFunction(() => window.gateway);
      return { page, requests, exceptions };
    }
    const json = (route, data, status = 200) => route.fulfill({ status, json: { data } });
    const binary = route => route.fulfill({ status: 200, contentType: 'application/octet-stream',
      headers: { 'Content-Disposition': "attachment; filename=plain.pdf; filename*=UTF-8''bukti%20uji.pdf" }, body: Buffer.from([0, 255, 13, 10, 128]) });
    const evidence = { name: 'fixture.pdf', mimeType: 'application/pdf', buffer: Buffer.from([0, 255, 13, 10, 128]) };
    const image = { name: 'bukti.png', mimeType: 'image/png', buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64') };
    const pdfObjects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << >> /Contents 4 0 R >>',
      '<< /Length 0 >>\nstream\n\nendstream'];
    let pdf = '%PDF-1.4\n';
    const offsets = [];
    for (const [index, object] of pdfObjects.entries()) {
      offsets.push(Buffer.byteLength(pdf));
      pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    }
    const xref = Buffer.byteLength(pdf);
    pdf += `xref\n0 5\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`;
    pdf += `trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    async function doFixture({ failAt, pauseAt } = {}) {
      let attempt = 0, failed = false, release;
      const gate = new Promise(resolve => { release = resolve; });
      const result = await fixture(async (route, request) => {
        assert.equal(request.auth, 'Bearer old-access');
        if (request.path === '/storage/uploads') {
          attempt++;
          assert.equal(request.method, 'POST');
          return json(route, { uploadId: `do-upload-${attempt}`, objectKey: 'private/do-key', expiresInSeconds: 300 });
        }
        assert.ok(['/content', '/finalize'].some(suffix => request.path === `/storage/uploads/do-upload-${attempt}${suffix}`));
        const stage = request.path.endsWith('/content') ? 'content' : 'finalize';
        assert.equal(request.method, stage === 'content' ? 'PUT' : 'POST');
        if (stage === 'content') {
          assert.equal(request.type, 'application/octet-stream');
          assert.deepEqual(request.body, evidence.buffer);
        }
        if (stage === pauseAt) await gate;
        if (stage === failAt && !failed) {
          failed = true;
          return route.fulfill({ status: 503, json: { message: `${stage} failed` } });
        }
        return stage === 'content' ? route.fulfill({ status: 204 }) : json(route, { filename: evidence.name });
      });
      return { ...result, release };
    }
    async function openDoEditor(page, view = 'do-editor', options = {}) {
      await page.evaluate(({ view, options }) => window.gateway.render(view, 3, options), { view, options });
      if (view === 'do-drawer') await page.getByRole('button', { name: 'Edit capaian dan bukti dukung', exact: true }).click();
      const editor = page.getByRole('dialog', { name: 'Input DO 2026', exact: true });
      await editor.waitFor();
      return editor;
    }

    await t.test('DO drawer opens the real editor without legacy controls, including missing DO records', async () => {
      for (const missing of [false, true]) {
        const { page, requests, exceptions } = await fixture(route => route.abort());
        try {
          await page.evaluate(missing => window.gateway.render('do-drawer', 3, { missing }), missing);
          const edit = page.getByRole('button', { name: 'Edit capaian dan bukti dukung', exact: true });
          await edit.waitFor();
          assert.equal(await page.getByRole('button', { name: 'Simpan Capaian', exact: true }).count(), 0);
          assert.equal(await page.getByRole('spinbutton', { name: 'Realisasi fisik', exact: true }).count(), 0);
          assert.equal(await page.getByText('Realisasi Fisik', { exact: false }).count(), 0);
          await edit.click();
          const editor = page.getByRole('dialog', { name: 'Input DO 2026', exact: true });
          await editor.waitFor();
          assert.equal(await editor.getByLabel('Pembilang aktual (N)', { exact: true }).inputValue(), missing ? '' : '2');
          assert.equal(await editor.getByLabel('Penyebut aktual (D)', { exact: true }).inputValue(), '4');
          assert.equal(await editor.getByLabel('Lampirkan bukti dukung', { exact: true }).isEnabled(), true);
          assert.equal(await editor.getByRole('button', { name: 'Simpan', exact: true }).isEnabled(), true);
          assert.equal(requests.length, 0);
          assert.deepEqual(exceptions, []);
        } finally { await page.close(); }
      }
    });

    await t.test('DO editor keeps essential copy visible and expands secondary guidance on demand', async () => {
      const { page, requests } = await fixture(route => route.abort());
      try {
        const editor = await openDoEditor(page, 'do-editor', { guidance: true });
        await editor.getByText('Evaluasi internal; belum disahkan Dinkes.', { exact: true }).waitFor();
        await editor.getByText('N dan D harus dari populasi/sampel dan periode yang sama.', { exact: true }).waitFor();
        await editor.getByText('Penilaian masih memerlukan konfirmasi sumber.', { exact: true }).waitFor();
        const instructions = editor.getByText('Panduan kumulatif khusus profil.', { exact: true });
        assert.equal(await instructions.isVisible(), false);
        await editor.getByText('Panduan rekap', { exact: true }).click();
        assert.equal(await instructions.isVisible(), true);
        assert.equal(await editor.getByText('DO_2026_V2', { exact: false }).count(), 0);
        const zeroWarning = editor.getByText('D = 0 tidak otomatis berarti nihil terverifikasi.', { exact: true });
        assert.equal(await zeroWarning.count(), 0);
        await editor.getByLabel('Penyebut aktual (D)', { exact: true }).fill('0');
        await zeroWarning.waitFor();
        await editor.getByLabel('Penyebut aktual (D)', { exact: true }).fill('4');
        assert.equal(await zeroWarning.count(), 0);
        assert.equal(requests.length, 0);
        assert.deepEqual(await page.evaluate(() => window.gateway.saves), []);
      } finally { await page.close(); }
    });

    for (const view of ['do-editor', 'do-drawer']) {
      await t.test(`${view} uploads evidence only on Simpan and saves finalized N/D, basis and notes`, async () => {
        const { page, requests, exceptions, release } = await doFixture({ pauseAt: 'finalize' });
        try {
          const editor = await openDoEditor(page, view);
          await editor.getByLabel('Pembilang aktual (N)', { exact: true }).fill('7');
          await editor.getByLabel('Penyebut aktual (D)', { exact: true }).fill('11');
          await editor.getByRole('textbox', { name: /^Catatan sumber data/ }).fill('Monthly source fixture');
          const input = editor.getByLabel('Lampirkan bukti dukung', { exact: true });
          assert.deepEqual((await input.getAttribute('accept')).split(',').sort(), ['.jpeg', '.jpg', '.pdf', '.png', '.xlsx']);
          await input.setInputFiles(evidence);
          await editor.getByText(`Bukti dipilih: ${evidence.name}`, { exact: true }).waitFor();
          assert.equal(requests.length, 0, 'Selecting a file must not upload or download it');
          const finalized = page.waitForRequest('**/storage/uploads/do-upload-1/finalize');
          await editor.getByRole('button', { name: 'Simpan', exact: true }).click();
          await finalized;
          assert.equal(await input.isDisabled(), true);
          assert.equal(await editor.getByRole('button', { name: 'Simpan', exact: true }).isDisabled(), true);
          assert.deepEqual(await page.evaluate(() => window.gateway.saves), [], 'Do not save before finalization succeeds');
          release();
          await editor.waitFor({ state: 'detached' });
          assert.deepEqual(requests.map(r => [r.method, r.path]), [
            ['POST', '/storage/uploads'], ['PUT', '/storage/uploads/do-upload-1/content'], ['POST', '/storage/uploads/do-upload-1/finalize'],
          ]);
          assert.deepEqual(JSON.parse(requests[0].body), { healthCenterId: 'center', year: 2026, month: 3,
            filename: evidence.name, mimeType: evidence.mimeType, fileSizeBytes: evidence.buffer.length });
          assert.deepEqual(await page.evaluate(() => window.gateway.saves), [{ indicatorId: 'do-indicator', month: 3, year: 2026,
            data: { pencapaianRiil: 7, totalSasaran: 11, scoringVersion: 'DO_2026_V2', inputBasis: 'PERIOD_ACTUAL',
              notes: 'Monthly source fixture', evidenceId: 'do-upload-1' } }]);
          assert.deepEqual(exceptions, []);
        } finally { release(); await page.close(); }
      });
    }

    await t.test('DO evidence accepts PDF/PNG/JPEG/XLSX up to 10 MiB and rejects larger files locally', async () => {
      const { page, requests } = await fixture(route => route.abort());
      try {
        const editor = await openDoEditor(page);
        const input = editor.getByLabel('Lampirkan bukti dukung', { exact: true });
        for (const [extension, mimeType] of [['pdf', 'application/pdf'], ['png', 'image/png'], ['jpg', 'image/jpeg'],
          ['jpeg', 'image/jpeg'], ['xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']]) {
          await input.setInputFiles({ name: `accepted.${extension}`, mimeType, buffer: evidence.buffer });
          await editor.getByText(`Bukti dipilih: accepted.${extension}`, { exact: true }).waitFor();
        }
        await input.setInputFiles({ name: 'boundary.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(10 * 1024 * 1024) });
        await editor.getByText('Bukti dipilih: boundary.pdf', { exact: true }).waitFor();
        assert.equal(await editor.getByRole('alert').count(), 0);
        assert.equal(await editor.getByRole('button', { name: 'Simpan', exact: true }).isEnabled(), true);
        assert.equal(requests.length, 0, 'Even a valid boundary-size file waits for Simpan');
        assert.deepEqual(await page.evaluate(() => window.gateway.saves), []);
        await input.setInputFiles({ name: 'oversized.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(10 * 1024 * 1024 + 1) });
        await editor.getByRole('alert').filter({ hasText: /10 MiB/ }).waitFor({ timeout: 5000 });
        assert.equal(await editor.getByText('Bukti dipilih: oversized.pdf', { exact: true }).count(), 0);
        assert.equal(requests.length, 0);
        assert.deepEqual(await page.evaluate(() => window.gateway.saves), []);
        await input.setInputFiles(evidence);
        await editor.getByText(`Bukti dipilih: ${evidence.name}`, { exact: true }).waitFor();
        assert.equal(await editor.getByRole('alert').count(), 0);
      } finally { await page.close(); }
    });

    await t.test('DO save omits unchanged evidence and preserves the stored attachment', async () => {
      const { page, requests } = await fixture(route => route.abort());
      try {
        const editor = await openDoEditor(page);
        await editor.getByLabel('Pembilang aktual (N)', { exact: true }).fill('3');
        await editor.getByRole('button', { name: 'Simpan', exact: true }).click();
        await editor.waitFor({ state: 'detached' });
        assert.deepEqual(await page.evaluate(() => window.gateway.saves), [{ indicatorId: 'do-indicator', month: 3, year: 2026,
          data: { pencapaianRiil: 3, totalSasaran: 4, scoringVersion: 'DO_2026_V2', inputBasis: 'PERIOD_ACTUAL', notes: 'Stored source' } }]);
        assert.equal(await page.evaluate(() => window.gateway.store.getMonthlyRecord('do-indicator', 3).evidenceId), 'stored-evidence');
        assert.equal(requests.length, 0);
      } finally { await page.close(); }
    });

    await t.test('DO editor downloads existing evidence through the authenticated gateway without saving', async () => {
      const { page, requests } = await fixture((route, request) => {
        assert.equal(request.path, '/storage/download');
        assert.equal(new URLSearchParams(request.search).get('uploadId'), 'stored-evidence');
        assert.equal(request.auth, 'Bearer old-access');
        return binary(route);
      });
      try {
        const editor = await openDoEditor(page);
        assert.equal(requests.length, 0);
        const downloaded = page.waitForEvent('download');
        await editor.getByRole('button', { name: 'Unduh bukti dukung', exact: true }).click();
        assert.equal((await downloaded).suggestedFilename(), 'bukti uji.pdf');
        await page.waitForFunction(() => window.gateway.revoked.length === 1);
        assert.equal(requests.length, 1);
        assert.deepEqual(await page.evaluate(() => window.gateway.saves), []);
      } finally { await page.close(); }
    });

    for (const view of ['do-editor', 'do-drawer', 'evidence']) {
      await t.test(`${view} previews private images on demand, restores focus and releases its URL`, async () => {
        let release;
        const gate = new Promise(resolve => { release = resolve; });
        const { page, requests, exceptions } = await fixture(async (route, request) => {
          assert.equal(request.path, '/storage/download');
          assert.equal(request.auth, 'Bearer old-access');
          assert.equal(new URLSearchParams(request.search).get('uploadId'), view === 'evidence' ? 'evidence' : 'stored-evidence');
          await gate;
          return route.fulfill({ contentType: image.mimeType, headers: { 'Content-Disposition': 'attachment; filename=bukti.png' }, body: image.buffer });
        });
        let downloadCount = 0;
        page.on('download', () => downloadCount++);
        try {
          if (view === 'do-editor') await openDoEditor(page);
          else await page.evaluate(view => window.gateway.render(view, view === 'evidence' ? 1 : 3), view);
          const trigger = page.getByRole('button', { name: view === 'do-editor' ? 'Pratinjau bukti tersimpan' : 'Pratinjau bukti dukung', exact: true });
          await trigger.waitFor();
          assert.equal(requests.length, 0);
          await trigger.click();
          const preview = page.getByRole('dialog', { name: 'Pratinjau bukti dukung', exact: true });
          await preview.getByRole('status').filter({ hasText: 'Memuat pratinjau' }).waitFor();
          release();
          const img = preview.getByRole('img', { name: 'Bukti dukung: bukti.png' });
          await img.waitFor();
          await page.waitForFunction(() => { const img = document.querySelector('dialog img'); return img?.complete && img.naturalWidth === 1; });
          assert.match(await img.getAttribute('src'), /^blob:/);
          assert.equal(downloadCount, 0);
          assert.equal(requests.length, 1);
          assert.deepEqual(await page.evaluate(() => window.gateway.revoked), []);
          assert.deepEqual(await page.evaluate(() => window.gateway.saves), []);
          const downloaded = page.waitForEvent('download');
          await preview.getByRole('button', { name: 'Unduh bukti dukung', exact: true }).click();
          assert.equal((await downloaded).suggestedFilename(), image.name);
          await page.waitForFunction(() => window.gateway.revoked.length === 1);
          assert.equal(requests.length, 1, 'Downloading the preview reuses its authenticated bytes');
          await preview.getByRole('button', { name: 'Tutup pratinjau', exact: true }).focus();
          await page.keyboard.press('Escape');
          await preview.waitFor({ state: 'detached' });
          assert.equal(await trigger.evaluate(element => element === document.activeElement), true);
          assert.equal(await page.evaluate(() => window.gateway.revoked.length), 2);
          if (view === 'do-editor') assert.equal(await page.getByRole('dialog', { name: 'Input DO 2026', exact: true }).count(), 1);
          assert.deepEqual(exceptions, []);
        } finally { release(); await page.close(); }
      });
    }

    await t.test('DO local image preview is responsive and does not upload, download or save', async () => {
      const { page, requests, exceptions } = await fixture(route => route.abort());
      try {
        await page.evaluate(() => import('/src/index.css'));
        const editor = await openDoEditor(page);
        await editor.getByLabel('Lampirkan bukti dukung', { exact: true }).setInputFiles(image);
        const trigger = editor.getByRole('button', { name: 'Pratinjau file terpilih', exact: true });
        await trigger.click();
        const preview = page.getByRole('dialog', { name: 'Pratinjau bukti dukung', exact: true });
        await preview.getByRole('img', { name: 'Bukti dukung: bukti.png' }).waitFor();
        await preview.getByText('File lokal.', { exact: false }).waitFor();
        for (const width of [320, 375, 1440]) {
          await page.setViewportSize({ width, height: 800 });
          const bounds = await preview.boundingBox();
          assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width, `Preview fits ${width}px`);
          assert.ok(bounds.y >= 0 && bounds.height <= 800);
          assert.equal(await preview.evaluate(el => el.scrollWidth <= el.clientWidth), true);
        }
        assert.equal(requests.length, 0);
        assert.deepEqual(await page.evaluate(() => window.gateway.saves), []);
        await preview.getByRole('button', { name: 'Tutup pratinjau', exact: true }).click();
        await trigger.waitFor();
        assert.equal(await editor.getByLabel('Pembilang aktual (N)', { exact: true }).inputValue(), '2');
        assert.equal(await page.evaluate(() => window.gateway.revoked.length), 1);
        assert.deepEqual(exceptions, []);
      } finally { await page.close(); }
    });

    await t.test('PDF preview uses a local blob object with an explicit download fallback', async () => {
      const { page, requests } = await fixture(route => route.abort());
      let downloads = 0;
      page.on('download', () => downloads++);
      try {
        const editor = await openDoEditor(page);
        await editor.getByLabel('Lampirkan bukti dukung', { exact: true }).setInputFiles({
          name: 'bukti.pdf', mimeType: 'application/pdf', buffer: Buffer.from(pdf),
        });
        await editor.getByRole('button', { name: 'Pratinjau file terpilih', exact: true }).click();
        const preview = page.getByRole('dialog', { name: 'Pratinjau bukti dukung', exact: true });
        const frame = preview.locator('object[title="Pratinjau PDF bukti dukung"]');
        await frame.waitFor();
        assert.match(await frame.getAttribute('data'), /^blob:/);
        assert.equal(downloads, 0);
        assert.equal(requests.length, 0);
        const downloaded = page.waitForEvent('download');
        await preview.getByRole('button', { name: 'Unduh bukti dukung', exact: true }).click();
        assert.equal((await downloaded).suggestedFilename(), 'bukti.pdf');
        assert.equal(requests.length, 0);
        await preview.getByRole('button', { name: 'Tutup pratinjau', exact: true }).click();
        await page.waitForFunction(() => window.gateway.revoked.length === 2);
      } finally { await page.close(); }
    });

    for (const mimeType of ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/html']) {
      await t.test(`preview never embeds ${mimeType} and keeps a download fallback`, async () => {
        const { page, requests } = await fixture(route => route.fulfill({ contentType: mimeType, body: '<script>window.injected=true</script>' }));
        try {
          await openDoEditor(page);
          await page.getByRole('button', { name: 'Pratinjau bukti tersimpan', exact: true }).click();
          const preview = page.getByRole('dialog', { name: 'Pratinjau bukti dukung', exact: true });
          await preview.getByRole('status').filter({ hasText: 'Pratinjau format ini belum tersedia' }).waitFor();
          assert.equal(await preview.locator('iframe, img, object, embed').count(), 0);
          assert.equal(await page.evaluate(() => window.injected), undefined);
          assert.equal(await page.evaluate(() => window.gateway.downloads.length), 0);
          assert.equal(await preview.getByRole('button', { name: 'Unduh bukti dukung', exact: true }).isEnabled(), true);
          assert.equal(requests.length, 1);
        } finally { await page.close(); }
      });
    }

    await t.test('preview load failure is retryable without saving or automatic download', async () => {
      let attempt = 0;
      const { page, requests } = await fixture(route => ++attempt === 1
        ? route.fulfill({ status: 503, json: { message: 'Preview unavailable' } })
        : route.fulfill({ contentType: image.mimeType, body: image.buffer }));
      try {
        await openDoEditor(page);
        await page.getByRole('button', { name: 'Pratinjau bukti tersimpan', exact: true }).click();
        const preview = page.getByRole('dialog', { name: 'Pratinjau bukti dukung', exact: true });
        await preview.getByRole('alert').filter({ hasText: 'Preview unavailable' }).waitFor();
        assert.equal(await preview.getByRole('button', { name: 'Unduh bukti dukung', exact: true }).count(), 0);
        await preview.getByRole('button', { name: 'Coba lagi', exact: true }).click();
        await preview.getByRole('img').waitFor();
        assert.equal(requests.length, 2);
        assert.deepEqual(await page.evaluate(() => window.gateway.saves), []);
      } finally { await page.close(); }
    });

    await t.test('corrupt images show a download fallback instead of a broken preview', async () => {
      const { page } = await fixture(route => route.fulfill({ contentType: 'image/png', body: 'not an image' }));
      try {
        await openDoEditor(page);
        await page.getByRole('button', { name: 'Pratinjau bukti tersimpan', exact: true }).click();
        const preview = page.getByRole('dialog', { name: 'Pratinjau bukti dukung', exact: true });
        await preview.getByRole('status').filter({ hasText: 'File tidak dapat ditampilkan' }).waitFor();
        assert.equal(await preview.getByRole('img').count(), 0);
        assert.equal(await preview.getByRole('button', { name: 'Unduh bukti dukung', exact: true }).isEnabled(), true);
      } finally { await page.close(); }
    });

    for (const expireSession of [false, true]) {
      await t.test(`loaded preview clears private bytes on ${expireSession ? 'session expiry' : 'tenant change'}`, async () => {
        const { page, exceptions } = await fixture(route => route.fulfill({ contentType: image.mimeType, body: image.buffer }));
        try {
          await openDoEditor(page);
          await page.getByRole('button', { name: 'Pratinjau bukti tersimpan', exact: true }).click();
          const preview = page.getByRole('dialog', { name: 'Pratinjau bukti dukung', exact: true });
          await preview.getByRole('img').waitFor();
          await page.evaluate(expire => {
            if (expire) window.dispatchEvent(new CustomEvent('sipkp-session-expired'));
            else window.gateway.store.commit({ healthCenterId: 'other-center' });
          }, expireSession);
          await preview.waitFor({ state: 'detached' });
          assert.equal(await page.evaluate(() => window.gateway.revoked.length), 1);
          assert.deepEqual(await page.evaluate(() => window.gateway.saves), []);
          assert.deepEqual(exceptions, []);
        } finally { await page.close(); }
      });
    }

    for (const closeDuringLoad of [true, false]) {
      await t.test(`preview ignores late bytes after ${closeDuringLoad ? 'close' : 'scope change'}`, async () => {
        let release;
        const gate = new Promise(resolve => { release = resolve; });
        const { page, exceptions } = await fixture(async route => {
          await gate;
          return route.fulfill({ contentType: image.mimeType, body: image.buffer });
        });
        try {
          await openDoEditor(page);
          const response = page.waitForResponse('**/storage/download?**');
          await page.getByRole('button', { name: 'Pratinjau bukti tersimpan', exact: true }).click();
          const preview = page.getByRole('dialog', { name: 'Pratinjau bukti dukung', exact: true });
          await preview.getByRole('status').waitFor();
          if (closeDuringLoad) await preview.getByRole('button', { name: 'Tutup pratinjau', exact: true }).click();
          else await page.evaluate(() => window.gateway.render('none'));
          release();
          await response;
          await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 100)));
          assert.equal(await page.getByRole('dialog', { name: 'Pratinjau bukti dukung', exact: true }).count(), 0);
          assert.equal(await page.evaluate(() => window.gateway.downloads.length), 0);
          assert.deepEqual(exceptions, []);
        } finally { release(); await page.close(); }
      });
    }

    for (const failAt of ['content', 'finalize']) {
      await t.test(`DO ${failAt} failure never saves and can retry the selected file`, async () => {
        const { page, requests } = await doFixture({ failAt });
        try {
          const editor = await openDoEditor(page);
          const input = editor.getByLabel('Lampirkan bukti dukung', { exact: true });
          const save = editor.getByRole('button', { name: 'Simpan', exact: true });
          await input.setInputFiles(evidence);
          await save.click();
          await editor.getByRole('alert').filter({ hasText: `${failAt} failed` }).waitFor();
          assert.deepEqual(await page.evaluate(() => window.gateway.saves), []);
          assert.equal(await input.isEnabled(), true);
          assert.equal(await save.isEnabled(), true);
          assert.equal(requests.filter(r => r.path.endsWith('/finalize')).length, failAt === 'content' ? 0 : 1);
          await save.click();
          await editor.waitFor({ state: 'detached' });
          assert.equal(requests.filter(r => r.path === '/storage/uploads').length, 2);
          assert.equal(requests.filter(r => r.path.endsWith('/content')).length, 2);
          assert.equal(requests.at(-1).path, '/storage/uploads/do-upload-2/finalize');
          assert.equal(await page.evaluate(() => window.gateway.saves.length), 1);
          assert.equal(await page.evaluate(() => window.gateway.saves[0].data.evidenceId), 'do-upload-2');
        } finally { await page.close(); }
      });
    }

    await t.test('DO monthly save failure retries the same finalized evidence without reupload', async () => {
      const { page, requests } = await doFixture();
      try {
        const editor = await openDoEditor(page);
        await page.evaluate(() => { window.gateway.saveFailures = 1; });
        await editor.getByLabel('Lampirkan bukti dukung', { exact: true }).setInputFiles(evidence);
        const save = editor.getByRole('button', { name: 'Simpan', exact: true });
        await save.click();
        await editor.getByRole('alert').filter({ hasText: 'Monthly save failed' }).waitFor();
        assert.equal(await save.isEnabled(), true);
        assert.equal(requests.length, 3);
        await save.click();
        await editor.waitFor({ state: 'detached' });
        const saves = await page.evaluate(() => window.gateway.saves);
        assert.equal(saves.length, 2);
        assert.equal(saves[0].data.evidenceId, 'do-upload-1');
        assert.deepEqual(saves[1], saves[0]);
        assert.equal(requests.length, 3, 'Retry must reuse the finalized upload');
      } finally { await page.close(); }
    });

    for (const reason of ['locked', 'historicalYtd', 'unimplemented']) {
      await t.test(`DO ${reason} disables evidence and save without mutation`, async () => {
        const { page, requests } = await fixture(route => route.abort());
        try {
          const editor = await openDoEditor(page, 'do-editor', { [reason]: true });
          assert.equal(await editor.getByLabel('Lampirkan bukti dukung', { exact: true }).isDisabled(), true);
          assert.equal(await editor.getByRole('button', { name: 'Simpan', exact: true }).isDisabled(), true);
          if (reason === 'historicalYtd') assert.equal(await editor.getByRole('combobox', { name: /^Basis N dan D/ }).inputValue(), 'YTD_ACTUAL');
          if (reason === 'unimplemented') {
            await editor.getByRole('status').filter({ hasText: 'Input DO 2026 belum tersedia untuk indikator ini.' }).waitFor();
            const detail = editor.getByText('Aturan pengukuran perlu ditinjau.', { exact: true });
            assert.equal(await detail.isVisible(), false);
            await editor.getByText('Lihat alasan', { exact: true }).click();
            assert.equal(await detail.isVisible(), true);
          }
          await editor.locator('form').evaluate(form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
          assert.deepEqual(await page.evaluate(() => window.gateway.saves), []);
          assert.equal(requests.length, 0);
          if (reason === 'locked') {
            await page.evaluate(() => window.gateway.render('do-drawer', 3, { locked: true }));
            const edit = page.getByRole('button', { name: 'Edit capaian dan bukti dukung', exact: true });
            await edit.waitFor();
            assert.equal(await edit.isDisabled(), true);
          }
        } finally { await page.close(); }
      });
    }

    await t.test('DO scope change unmounts an uploading editor and prevents a late monthly save', async () => {
      const { page, requests, exceptions, release } = await doFixture({ pauseAt: 'content' });
      try {
        const editor = await openDoEditor(page, 'do-drawer');
        await editor.getByLabel('Lampirkan bukti dukung', { exact: true }).setInputFiles(evidence);
        const started = page.waitForRequest('**/storage/uploads/do-upload-1/content');
        await editor.getByRole('button', { name: 'Simpan', exact: true }).click();
        await started;
        await page.evaluate(() => window.gateway.render('do-drawer', 4));
        await editor.waitFor({ state: 'detached' });
        await page.getByText('Capaian April 2026', { exact: true }).waitFor();
        release();
        await page.waitForFunction(() => !window.gateway.store.isMutating());
        assert.equal(requests.at(-1).path, '/storage/uploads/do-upload-1/finalize');
        assert.deepEqual(await page.evaluate(() => window.gateway.saves), []);
        assert.equal(await page.getByRole('dialog', { name: 'Input DO 2026', exact: true }).count(), 0);
        assert.deepEqual(exceptions, []);
      } finally { release(); await page.close(); }
    });

    await t.test('legacy drawer retains Realisasi fisik and Simpan Capaian behavior', async () => {
      const { page, requests } = await fixture(route => route.abort());
      try {
        await page.evaluate(() => window.gateway.render('evidence'));
        const input = page.getByRole('spinbutton', { name: 'Realisasi fisik', exact: true });
        await input.fill('5');
        assert.equal(await page.getByRole('button', { name: 'Edit capaian dan bukti dukung', exact: true }).count(), 0);
        await page.getByRole('button', { name: 'Simpan Capaian', exact: true }).click();
        await page.getByText('Data capaian Januari 2025 tersimpan di server.', { exact: true }).waitFor();
        assert.deepEqual(await page.evaluate(() => window.gateway.saves), [{ indicatorId: 'indicator', month: 1, year: 2025,
          data: { pencapaianRiil: 5, notes: '', evidenceId: 'evidence' } }]);
        assert.equal(requests.length, 0);
      } finally { await page.close(); }
    });

    await t.test('raw upload retries identical bytes after refresh then finalizes, without MinIO requests', async () => {
      const { page, requests } = await fixture(async (route, request) => {
        if (request.path === '/storage/uploads') {
          assert.deepEqual(JSON.parse(request.body), { healthCenterId: 'center', year: 2025, month: 1,
            filename: 'fixture.pdf', mimeType: 'application/pdf', fileSizeBytes: 5 });
          return json(route, { uploadId: 'upload-id', objectKey: 'private/key', expiresInSeconds: 300 });
        }
        if (request.path === '/auth/refresh') return json(route, { accessToken: 'new-access', refreshToken: 'new-refresh' });
        if (request.path.endsWith('/content')) {
          assert.equal(request.type, 'application/octet-stream');
          assert.deepEqual(request.body, Buffer.from([0, 255, 13, 10, 128]));
          return request.auth === 'Bearer old-access'
            ? route.fulfill({ status: 401, json: { message: 'Expired' } }) : route.fulfill({ status: 204 });
        }
        assert.equal(request.path, '/storage/uploads/upload-id/finalize');
        return json(route, { filename: 'fixture.pdf' });
      });
      try {
        const result = await page.evaluate(async () => {
          const store = window.gateway.store;
          const uploading = store.uploadEvidence(new File([new Uint8Array([0, 255, 13, 10, 128])], 'fixture.pdf', { type: 'application/pdf' }), 1);
          const busy = store.isMutating();
          let blocked = false;
          try { await store.setCurrentYear(2025); } catch { blocked = true; }
          return { busy, blocked, result: await uploading, settled: !store.isMutating() };
        });
        assert.deepEqual(result, { busy: true, blocked: true, result: { filename: 'fixture.pdf', uploadId: 'upload-id', evidenceId: 'upload-id' }, settled: true });
        assert.deepEqual(requests.map(r => [r.method, r.path]), [
          ['POST', '/storage/uploads'], ['PUT', '/storage/uploads/upload-id/content'], ['POST', '/auth/refresh'],
          ['PUT', '/storage/uploads/upload-id/content'], ['POST', '/storage/uploads/upload-id/finalize'],
        ]);
        assert.equal(requests.at(-1).auth, 'Bearer new-access');
      } finally { await page.close(); }
    });

    await t.test('failed upload preserves API error details and never finalizes', async () => {
      const { page, requests } = await fixture((route, request) => request.path === '/storage/uploads'
        ? json(route, { uploadId: 'upload' })
        : route.fulfill({ status: 413, json: { message: ['File too large', 'Try a smaller file'], dependencies: ['limit'] } }));
      try {
        assert.deepEqual(await page.evaluate(async () => {
          try { await window.gateway.store.uploadEvidence(new File(['x'], 'x.pdf'), 1); }
          catch (e) { return { name: e.name, status: e.status, message: e.message, dependencies: e.dependencies, busy: window.gateway.store.isMutating() }; }
        }), { name: 'ApiError', status: 413, message: 'File too large; Try a smaller file', dependencies: ['limit'], busy: false });
        assert.equal(requests.length, 2);
      } finally { await page.close(); }
    });

    await t.test('upload accepts non-JSON success acknowledgements and late refresh cannot restore a cleared session', async () => {
      let release;
      const gate = new Promise(resolve => { release = resolve; });
      const { page, requests } = await fixture(async (route, request) => {
        if (request.method === 'PUT') return route.fulfill({ status: 200, contentType: 'text/plain', body: 'Uploaded' });
        if (request.path !== '/auth/refresh') return route.fulfill({ status: 401, json: { message: 'Expired' } });
        await gate;
        return json(route, { accessToken: 'stale-access', refreshToken: 'stale-refresh' });
      });
      try {
        await page.evaluate(() => window.gateway.api.upload('/storage/uploads/id/content', new Blob(['raw'])));
        const refreshing = page.waitForRequest('**/auth/refresh');
        await page.evaluate(() => {
          window.gateway.pending = window.gateway.api.download('/storage/download').then(() => 'unexpected success', e => e.message);
        });
        await refreshing;
        await page.evaluate(() => window.gateway.api.clearSession());
        release();
        assert.equal(await page.evaluate(() => window.gateway.pending), 'Sesi telah berubah.');
        assert.equal(await page.evaluate(() => window.gateway.api.hasSession()), false);
        assert.equal(requests.filter(r => r.path === '/storage/download').length, 1, 'No retry under a changed session');
      } finally { release(); await page.close(); }
    });

    await t.test('binary GET shares one refresh for concurrent downloads and decodes attachment filename', async () => {
      const { page, requests } = await fixture((route, request) => request.path === '/auth/refresh'
        ? json(route, { accessToken: 'new-access', refreshToken: 'new-refresh' })
        : request.auth === 'Bearer old-access' ? route.fulfill({ status: 401, json: { message: 'Expired' } }) : binary(route));
      try {
        const result = await page.evaluate(async () => Promise.all([1, 2].map(async () => {
          const file = await window.gateway.store.getEvidenceDownload('id &?');
          return { bytes: [...new Uint8Array(await file.blob.arrayBuffer())], filename: file.filename };
        })));
        assert.deepEqual(result, Array(2).fill({ bytes: [0, 255, 13, 10, 128], filename: 'bukti uji.pdf' }));
        assert.equal(requests.filter(r => r.path === '/auth/refresh').length, 1);
        for (const request of requests.filter(r => r.path === '/storage/download')) {
          assert.equal(new URLSearchParams(request.search).get('uploadId'), 'id &?');
          assert.equal(new URLSearchParams(request.search).get('healthCenterId'), 'center');
        }
      } finally { await page.close(); }
    });

    await t.test('absolute, protocol-relative, traversal and backslash paths are rejected before fetch', async () => {
      const { page, requests } = await fixture(route => route.abort());
      try {
        const result = await page.evaluate(async () => {
          const fetch = window.fetch;
          let calls = 0;
          window.fetch = (...args) => { calls++; return fetch(...args); };
          try {
            const errors = await Promise.all([
              'https://evil.invalid/file', 'http://evil.invalid', '//evil.invalid/file', '\\\\evil.invalid/file',
              '/export/../auth/me', '/export/%2e%2e/auth/me', '/%2f%2fevil.invalid', 'data:text/plain,x',
              '/export/\\evil.invalid', '/export/jobs/id/content\n', '/export/jobs/id/content#fragment',
            ].map(async path => {
              try { await window.gateway.api.download(path); return null; } catch (e) { return e.name; }
            }));
            return { errors, calls };
          } finally { window.fetch = fetch; }
        });
        assert.ok(result.errors.every(name => name === 'ApiError'));
        assert.equal(result.calls, 0);
        assert.equal(requests.length, 0);
      } finally { await page.close(); }
    });

    await t.test('redirects do not forward bearer credentials or fetch external content', async () => {
      const { page } = await fixture(route => route.fulfill({ status: 302, headers: { location: 'https://evil.invalid/file' } }));
      let leaked = false;
      await page.route('https://evil.invalid/**', route => { leaked = true; return route.abort(); });
      try {
        assert.deepEqual(await page.evaluate(async () => {
          try { await window.gateway.api.download('/storage/download'); } catch (e) { return { name: e.name, status: e.status }; }
        }), { name: 'ApiError', status: 0 });
        assert.equal(leaked, false);
      } finally { await page.close(); }
    });

    await t.test('second 401 expires the session; aborted downloads do not refresh', async () => {
      const { page, requests } = await fixture((route, request) => request.path === '/auth/refresh'
        ? json(route, { accessToken: 'new-access', refreshToken: 'new-refresh' })
        : route.fulfill({ status: 401, json: { message: 'Revoked' } }));
      try {
        assert.deepEqual(await page.evaluate(async () => {
          let expired = 0;
          window.addEventListener('sipkp-session-expired', () => expired++);
          let status;
          try { await window.gateway.api.download('/storage/download'); } catch (e) { status = e.status; }
          const controller = new AbortController(); controller.abort();
          let aborted;
          try { await window.gateway.api.download('/storage/download', { signal: controller.signal }); } catch (e) { aborted = e.name; }
          return { status, expired, aborted, session: window.gateway.api.hasSession() };
        }), { status: 401, expired: 1, aborted: 'AbortError', session: false });
        assert.equal(requests.filter(r => r.path === '/auth/refresh').length, 1);
      } finally { await page.close(); }
    });

    await t.test('late binary responses are rejected after session replacement or scope reset', async () => {
      for (const change of ['session', 'scope']) {
        let release;
        const gate = new Promise(resolve => { release = resolve; });
        const { page } = await fixture(async route => { await gate; await binary(route); });
        try {
          const response = page.waitForRequest('**/api/v1/storage/download*');
          await page.evaluate(() => {
            window.gateway.pending = window.gateway.store.getEvidenceDownload('evidence').then(() => 'unexpected success', e => e.message);
          });
          await response;
          await page.evaluate(change => {
            if (change === 'session') window.gateway.api.setSession({ accessToken: 'other-user', refreshToken: 'other-refresh' });
            else window.gateway.store.clear();
          }, change);
          release();
          assert.notEqual(await page.evaluate(() => window.gateway.pending), 'unexpected success');
          assert.equal(await page.evaluate(() => window.gateway.downloads.length), 0);
        } finally { release(); await page.close(); }
      }
    });

    for (const view of ['modal', 'sheet']) for (const year of [2025, 2026]) {
      await t.test(`${view} shows source-period applicability only for ${year >= 2026 ? '2026+' : 'historical exclusion'} without requests`, async () => {
        const { page, requests, exceptions } = await fixture(route => route.abort());
        try {
          await page.evaluate(({ view, year }) => {
            const { store, render } = window.gateway;
            store.state = { ...store.state, year, sheets: { 1: { ...store.state.sheets[1], year } } };
            render(view);
          }, { view, year });
          if (view === 'modal') await page.getByRole('dialog', { name: 'Ekspor laporan PKP', exact: true }).waitFor();
          else await page.getByRole('heading', { name: `Lembar Hasil Kinerja Puskesmas (NILAI KINERJA ${year})`, exact: true }).waitFor();
          assert.equal(await page.getByText(/bukan otomatis capaian tahunan|tidak otomatis menjadi capaian tahunan/).count(), year >= 2026 ? 1 : 0);
          assert.equal(requests.length, 0);
          assert.deepEqual(exceptions, []);
        } finally { await page.close(); }
      });
    }

    for (const view of ['modal', 'sheet', 'evidence']) {
      await t.test(`${view} fetches only on download click, disables busy UI and revokes object URLs`, async () => {
        let release;
        const gate = new Promise(resolve => { release = resolve; });
        const { page, requests, exceptions } = await fixture(async (route, request) => {
          if (request.path === '/export/pdf/sheet7') return json(route, { jobId: 'job' });
          if (request.path === '/export/jobs/job') return json(route, { status: 'COMPLETED', filename: 'report.pdf', downloadPath: '/export/jobs/job/content?healthCenterId=center' });
          await gate; return binary(route);
        });
        try {
          await page.evaluate(view => window.gateway.render(view), view);
          let button;
          if (view === 'evidence') button = page.getByRole('button', { name: 'Unduh bukti dukung', exact: true });
          else {
            await page.getByRole('button', { name: view === 'modal' ? 'Unduh PDF Sementara' : 'Unduh PDF Provisional', exact: true }).click();
            button = page.getByRole('button', { name: 'Unduh report.pdf', exact: true });
          }
          await button.waitFor();
          assert.equal(requests.filter(r => r.path.endsWith('/content') || r.path === '/storage/download').length, 0, 'No blob prefetch');
          const started = page.waitForRequest('**/api/v1/**');
          await button.click();
          await started;
          assert.equal(await button.isDisabled(), true);
          const downloaded = page.waitForEvent('download');
          release();
          assert.equal((await downloaded).suggestedFilename(), 'bukti uji.pdf');
          await page.waitForFunction(() => window.gateway.revoked.length === 1);
          assert.deepEqual(await page.evaluate(() => ({ created: window.gateway.downloads.length,
            revoked: window.gateway.revoked[0] === window.gateway.downloads[0].url,
            anchors: document.querySelectorAll('a[download]').length })), { created: 1, revoked: true, anchors: 0 });
          assert.equal(await button.isDisabled(), false);
          assert.ok(requests.every(r => r.auth === 'Bearer old-access'));
          assert.deepEqual(exceptions, []);
        } finally { release(); await page.close(); }
      });
    }

    await t.test('download failure stays visible and retryable; missing metadata never fetches a blob', async () => {
      let ready = true;
      const { page, requests } = await fixture((route, request) => {
        if (request.path === '/export/pdf/sheet7') return json(route, { jobId: 'job' });
        if (request.path === '/export/jobs/job') return json(route, { status: 'COMPLETED', ...(ready ? { filename: 'report.pdf', downloadPath: '/export/jobs/job/content?healthCenterId=center' } : {}) });
        return route.fulfill({ status: 403, json: { message: 'Download denied' } });
      });
      try {
        await page.evaluate(() => window.gateway.render('modal'));
        await page.getByRole('button', { name: 'Unduh PDF Sementara', exact: true }).click();
        const button = page.getByRole('button', { name: 'Unduh report.pdf', exact: true });
        await button.click();
        await page.getByRole('alert').filter({ hasText: 'Download denied' }).waitFor();
        assert.equal(await button.isDisabled(), false);
        assert.equal(await page.evaluate(() => window.gateway.downloads.length), 0);
        ready = false;
        await page.getByRole('button', { name: 'Unduh PDF Sementara', exact: true }).click();
        await page.getByRole('alert').filter({ hasText: 'Berkas unduhan belum tersedia.' }).waitFor();
        assert.equal(requests.filter(r => r.path.endsWith('/content')).length, 1);
      } finally { await page.close(); }
    });

    await t.test('export uses metadata filename when the binary response has no exposed attachment header', async () => {
      const { page } = await fixture((route, request) => {
        if (request.path === '/export/pdf/sheet7') return json(route, { jobId: 'job' });
        if (request.path === '/export/jobs/job') return json(route, { status: 'COMPLETED', filename: 'report.pdf', downloadPath: 'export/jobs/job/content?healthCenterId=center' });
        return route.fulfill({ status: 200, contentType: 'application/pdf', body: '%PDF-fixture' });
      });
      try {
        await page.evaluate(() => window.gateway.render('modal'));
        await page.getByRole('button', { name: 'Unduh PDF Sementara', exact: true }).click();
        const downloaded = page.waitForEvent('download');
        await page.getByRole('button', { name: 'Unduh report.pdf', exact: true }).click();
        assert.equal((await downloaded).suggestedFilename(), 'report.pdf');
        await page.waitForFunction(() => window.gateway.revoked.length === 1);
      } finally { await page.close(); }
    });

    await t.test('closing export UI before download completes prevents saving stale content', async () => {
      let release;
      const gate = new Promise(resolve => { release = resolve; });
      const { page } = await fixture(async (route, request) => {
        if (request.path === '/export/pdf/sheet7') return json(route, { jobId: 'job' });
        if (request.path === '/export/jobs/job') return json(route, { status: 'COMPLETED', filename: 'report.pdf', downloadPath: '/export/jobs/job/content' });
        await gate; return binary(route);
      });
      try {
        await page.evaluate(() => window.gateway.render('modal'));
        await page.getByRole('button', { name: 'Unduh PDF Sementara', exact: true }).click();
        const started = page.waitForRequest('**/export/jobs/job/content');
        await page.getByRole('button', { name: 'Unduh report.pdf', exact: true }).click();
        await started;
        await page.getByRole('button', { name: 'Tutup ekspor laporan' }).click();
        const finished = page.waitForResponse('**/export/jobs/job/content');
        release(); await finished;
        await page.waitForTimeout(100);
        assert.equal(await page.evaluate(() => window.gateway.downloads.length), 0);
      } finally { release(); await page.close(); }
    });
  } finally {
    await browser?.close();
    await server.close();
  }
});
