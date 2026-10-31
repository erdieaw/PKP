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
const indicator = { id: 'indicator', no: '1', sectionCode: '1.1', klasterId: 1, indikator: 'Fixture indicator', satuan: '%', polarity: 'POSITIVE' };
const summary = { year: 2025, quarter: 1, periodLabel: 'Triwulan 1', puskesmasName: 'Fixture', klasterScores: {}, rows: [] };
pkpStore.state = { ...pkpStore.state, year: 2025, healthCenterId: 'center', activePeriod: { year: 2025 },
  user: { id: 'admin', role: 'ADMIN_PUSKESMAS', healthCenterId: 'center' }, indicators: [indicator],
  sheets: { 1: summary }, months: { 1: { indicator: { pencapaianRiil: 1, evidenceId: 'evidence', notes: '', isMissing: false } } } };
const root = createRoot(document.getElementById('root'));
const render = (view, month = 1) => root.render(view === 'modal'
  ? React.createElement(ExportReportModal, { isOpen: true, onClose: () => render('none'), selectedMonth: 1, puskesmasName: 'Fixture' })
  : view === 'sheet' ? React.createElement(OfficialPerformanceSheet7)
  : view === 'evidence' ? React.createElement(IndicatorDetailDrawer, { indicator, selectedMonth: month, onClose: () => render('none') })
  : null);
api.setSession({ accessToken: 'old-access', refreshToken: 'fixture-refresh' });
window.gateway = { api, store: pkpStore, render, downloads: [], revoked: [] };
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
            await page.getByRole('button', { name: 'Unduh PDF Provisional', exact: true }).click();
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
        await page.getByRole('button', { name: 'Unduh PDF Provisional', exact: true }).click();
        const button = page.getByRole('button', { name: 'Unduh report.pdf', exact: true });
        await button.click();
        await page.getByRole('alert').filter({ hasText: 'Download denied' }).waitFor();
        assert.equal(await button.isDisabled(), false);
        assert.equal(await page.evaluate(() => window.gateway.downloads.length), 0);
        ready = false;
        await page.getByRole('button', { name: 'Unduh PDF Provisional', exact: true }).click();
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
        await page.getByRole('button', { name: 'Unduh PDF Provisional', exact: true }).click();
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
        await page.getByRole('button', { name: 'Unduh PDF Provisional', exact: true }).click();
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
