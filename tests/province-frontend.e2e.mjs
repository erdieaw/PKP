import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';

// Isolated frontend fixture: every API request is intercepted, with no backend or portal access.
const server = await createServer({ server: { host: '127.0.0.1', port: 0, hmr: false } });
await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
let config = { configured: true, hasPassword: true, username: 'admin', provinceHealthCenterCode: '001', revision: 1, connectionStatus: 'UNTESTED' };
let mappings = [{ indicatorId: 'local-id', provinceCode: '001-A' }];
let testFails = false;
let configConflict = false;
let unavailable = false;
let delayedPreview;
let delayedLogs;
let onLogsStarted;
let logsFail = false;
let logsEmpty = false;
const logPages = [];
const logItem = { id: 'log-1', actorId: 'internal-actor-id', action: 'PROVINCE_TEST', status: 'FAILURE', timestamp: '2026-10-19T00:00:00.000Z', durationMs: 0, errorCode: 'REMOTE_UNAVAILABLE' };
const writes = [];
let apiCalls = 0;
let activePeriod = { year: null, provinceEnabled: false, revision: 0 };
let periodConflict = false;
const flags = { readOnly: true, canWrite: false, activeYear: 2026, provinceEnabled: true, periodRevision: 7 };
const target = { kd_ind: '001-A', indikator: 'Indikator portal', satuan: 'orang', total_sasaran: 0 };
let fixtureIndicators = [{ id: 'local-id', indikator: 'Indikator lokal' }];
let catalogTargets = [target];
await page.route('**/*', async route => {
  const url = new URL(route.request().url());
  if (url.origin !== origin) return route.abort();
  if (url.pathname === '/store-fixture') return route.fulfill({ contentType: 'text/html', body: '<div>Store scope fixture</div>' });
  if (url.pathname === '/workflow-fixture') return route.fulfill({ contentType: 'text/html', body: `
    <div id="root"></div><script type="module">
    import RefreshRuntime from '/@react-refresh';
    RefreshRuntime.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type;
    window.__vite_plugin_react_preamble_installed__ = true;
    import React from '/node_modules/.vite/deps/react.js';
    import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
    import { pkpStore } from '/src/services/apiStore.ts';
    const { MonthlyDataGrid } = await import('/src/components/data-entry/MonthlyDataGrid.tsx');
    const { TargetSettingView } = await import('/src/components/data-entry/TargetSettingView.tsx');
    window.renderEpOrder = target => {
      pkpStore.state = { ...pkpStore.state, user: { id: 'user', role: 'ADMIN_PUSKESMAS' }, indicators: [10, 3, 2, 1].map(no => ({ id: 'ep-' + no, sectionCode: '1.1', no: no === 1 ? '1.0' : no + '.', indikator: 'EP ' + no, kegiatan: 'Kegiatan', section: 'Bagian', klasterId: 1, satuan: 'orang' })) };
      pkpStore.getMonthlyRecord = () => ({ pencapaianRiil: null, nilaiKinerja: null, syncStatus: 'SYNCED', syncedAt: '2026-01-01T00:00:00Z' });
      root.render(target ? React.createElement(TargetSettingView) : React.createElement(MonthlyDataGrid, { selectedMonth: 2, selectedKlaster: 0, onSelectKlaster: () => {}, onOpenDrawer: () => {} }));
    };
    window.workflowCalls = [];
    for (const name of ['verifyAndLockPeriod', 'requestRevisionPeriod', 'unlockPeriodForEdit']) {
      pkpStore[name] = async () => { window.workflowCalls.push(name); };
    }
    const root = ReactDOM.createRoot(document.getElementById('root'));
    window.renderWorkflow = (activeYear, status, role = 'DINKES_ADMIN') => {
      pkpStore.readCache.clear();
      pkpStore.state = { ...pkpStore.state, user: { id: 'user', role }, year: 2025,
        activePeriod: { year: activeYear, provinceEnabled: false, revision: 1 },
        periods: [{ year: 2025, periodNumber: 2, isQuarter: false, status }] };
      root.render(React.createElement(MonthlyDataGrid, { selectedMonth: 2, selectedKlaster: 0, onSelectKlaster: () => {}, onOpenDrawer: () => {} }));
    };
    window.renderWorkflow(2026, 'SUBMITTED');
    </script>` });
  if (url.pathname === '/period-fixture') return route.fulfill({ contentType: 'text/html', body: `
    <div id="root"></div><script type="module">
    import RefreshRuntime from '/@react-refresh';
    RefreshRuntime.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type;
    window.__vite_plugin_react_preamble_installed__ = true;
    import React from '/node_modules/.vite/deps/react.js';
    import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
    import { pkpStore } from '/src/services/apiStore.ts';
    const { YearPeriodModal } = await import('/src/components/year-management/YearPeriodModal.tsx');
    pkpStore.state = { ...pkpStore.state, user: { id: 'dinkes', role: 'DINKES_ADMIN' }, year: 2025, years: [{ year: 2026, cutoffDay: 10, status: 'LOCKED', provinceEnabled: false }, { year: 2025, cutoffDay: 10, status: 'OPEN', provinceEnabled: true }] };
    pkpStore.refreshCatalog = async () => {};
    await pkpStore.fetchActivePeriod();
    ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(YearPeriodModal, { isOpen: true, onClose: () => {} }));
    window.store = pkpStore;
    </script>` });
  if (url.pathname === '/province-fixture') return route.fulfill({ contentType: 'text/html', body: `
    <div id="root"></div><script type="module">
    import RefreshRuntime from '/@react-refresh';
    RefreshRuntime.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {};
    window.$RefreshSig$ = () => type => type;
    window.__vite_plugin_react_preamble_installed__ = true;
    await import('/src/index.css');
    import React from '/node_modules/.vite/deps/react.js';
    import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
    import { pkpStore } from '/src/services/apiStore.ts';
    const { ProvinceIntegrationPanel } = await import('/src/components/master-data/ProvinceIntegrationPanel.tsx');
    const params = new URLSearchParams(location.search);
    const user = { id: 'admin', role: params.get('role') || 'ADMIN_PUSKESMAS', healthCenterId: params.get('tenant') || 'own' };
    Object.assign(pkpStore, {
      getCurrentUser: () => user, getSessionUser: () => user, getSelectedHealthCenterId: () => 'own',
      getSelectedHealthCenter: () => ({ name: 'Puskesmas Sendiri' }), getCurrentYear: () => 2026,
      getIndicators: () => ${JSON.stringify(fixtureIndicators)}, getLoadState: () => ({ loading: false }),
      isMutating: () => false, runOwnTenantWrite: action => action(new AbortController().signal)
    });
    const root = ReactDOM.createRoot(document.getElementById('root'));
    window.renderMonth = month => root.render(React.createElement(ProvinceIntegrationPanel, { key: month, selectedMonth: month }));
    window.changeScope = () => { pkpStore.getSelectedHealthCenterId = () => 'other'; };
    window.renderMonth(2);
    </script>` });
  if (!url.pathname.startsWith('/api/v1/')) return route.continue();
  apiCalls++;
  const path = url.pathname.replace('/api/v1', '');
  const method = route.request().method();
  const body = route.request().postDataJSON();
  const reply = (data, status = 200) => route.fulfill({ status, json: status === 200 ? { success: true, data: { ...flags, ...data } } : { success: false, message: 'Sanitized server failure' } });
  if (path === '/master/active-year') {
    if (method === 'PUT') {
      writes.push({ path, body });
      assert.deepEqual(Object.keys(body).sort(), ['provinceEnabled', 'revision', 'year']);
      if (periodConflict) { activePeriod = { ...activePeriod, revision: activePeriod.revision + 1 }; return reply({}, 409); }
      assert.equal(body.revision, activePeriod.revision);
      activePeriod = { ...body, revision: body.revision + 1 };
    }
    return reply(activePeriod);
  }
  if (path === '/bridge/logs') {
    assert.equal(method, 'GET');
    assert.deepEqual([...url.searchParams.keys()].sort(), ['limit', 'page']);
    assert.equal(url.searchParams.get('limit'), '20');
    const requestedPage = Number(url.searchParams.get('page'));
    logPages.push(requestedPage);
    // Capture the response before waiting to exercise late, stale responses.
    const data = { items: logsEmpty ? [] : [{ ...logItem, id: `log-${requestedPage}`, actorId: requestedPage === 1 ? 'internal-actor-id' : null, action: requestedPage === 1 ? logItem.action : 'PROVINCE_CATALOG', durationMs: requestedPage === 1 ? 0 : null, errorCode: requestedPage === 1 ? logItem.errorCode : 'untrusted-secret-error' }], page: requestedPage, limit: 20, hasMore: requestedPage === 1 && !logsEmpty };
    const fail = logsFail;
    if (delayedLogs) { onLogsStarted?.(); await delayedLogs; }
    return route.fulfill({ status: fail ? 503 : 200, json: fail ? { success: false, message: 'sensitive-raw-log-error' } : { success: true, data } });
  }
  if (unavailable) return reply({}, 503);
  if (path === '/bridge/config' && method === 'GET') return reply(config);
  if (path === '/bridge/config' && method === 'PUT') {
    writes.push({ path, body });
    if (configConflict) return reply({}, 409);
    config = { ...config, username: body.username, provinceHealthCenterCode: body.provinceHealthCenterCode, revision: config.revision + 1 };
    return reply(config);
  }
  if (path === '/bridge/mappings' && method === 'GET') return reply({ revision: config.revision, items: mappings });
  if (path === '/bridge/mappings' && method === 'PUT') {
    writes.push({ path, body });
    if (body.revision !== config.revision) return reply({}, 409);
    mappings = body.items; config.revision++; return reply({ revision: config.revision, items: mappings });
  }
  if (path === '/bridge/catalog') return reply({ revision: config.revision, remoteYear: null, targets: catalogTargets, months: [] });
  if (path === '/bridge/test') return testFails ? reply({}, 503) : reply({ connectionStatus: 'CONNECTED', revision: config.revision, provinceHealthCenterCode: '001', testedAt: '2026-01-01T00:00:00Z' });
  if (path === '/bridge/preview') {
    assert.equal(Object.hasOwn(body, 'year'), false);
    if (body.operation === 'MONTHLY') assert.equal(body.month, 2);
    if (delayedPreview) await delayedPreview;
    return reply({ revision: config.revision, operation: body.operation, localYear: flags.activeYear, month: body.month ?? null, remoteYear: null, warnings: ['REMOTE_YEAR_UNKNOWN', 'FORMULA_EQUIVALENCE_UNVERIFIED'], items: [{ indicatorId: 'local-id', provinceCode: '001-A', local: null, remote: { ...target, target_sasaran: null }, warnings: ['REMOTE_YEAR_UNKNOWN', 'FORMULA_EQUIVALENCE_UNVERIFIED', 'LOCAL_RECORD_MISSING'] }], unmappedRemote: Array.from({ length: 250 }, (_, i) => ({ ...target, kd_ind: `unmapped-${i}` })) });
  }
  throw new Error(`Unexpected API call: ${path}`);
});
try {
  fixtureIndicators = [
    { id: 'ten', sectionCode: '1.1', no: '10.', indikator: 'EP sepuluh' },
    { id: 'three', sectionCode: '1.1', no: '3.', indikator: 'EP tiga' },
    { id: 'two', sectionCode: '1.1', no: '2.', indikator: 'EP dua' },
    { id: 'one', sectionCode: '1.1', no: '1.0', indikator: 'EP satu' },
  ];
  mappings = [{ indicatorId: 'ten', provinceCode: '1.10' }, { indicatorId: 'one', provinceCode: '1.1' }];
  catalogTargets = ['1.10', '1.2', '1.1'].map(kd_ind => ({ ...target, kd_ind }));
  await page.goto(`${origin}/province-fixture`);
  await page.getByRole('button', { name: 'Ambil katalog provinsi' }).click();
  const mappingTable = page.getByRole('region', { name: 'Tabel pemetaan indikator', exact: true });
  assert.deepEqual(await mappingTable.locator('select[aria-label^="Indikator lokal baris"]').evaluateAll(elements => elements.map(el => el.value)), ['one', 'ten']);
  assert.deepEqual(await page.getByLabel('Kode provinsi baris 2', { exact: true }).locator('option').evaluateAll(elements => elements.map(el => el.value)), ['', '1.1', '1.2', '1.10']);
  await page.getByText('Status integrasi seluruh EP lokal (4)', { exact: true }).click();
  const overview = page.getByRole('region', { name: 'Status integrasi seluruh EP lokal', exact: true });
  assert.deepEqual(await overview.locator('tbody tr td:first-child').allTextContents(), ['1.1.1 - EP satu', '1.1.2 - EP dua', '1.1.3 - EP tiga', '1.1.10 - EP sepuluh']);
  assert.equal(await overview.getByText('Belum dipetakan', { exact: true }).count(), 2);
  assert.equal(await overview.getByText('Pemetaan tersimpan', { exact: true }).count(), 2);
  assert.equal(await overview.getByText('Sinkron terakhir: Belum tersedia', { exact: true }).count(), 4);
  await page.getByRole('button', { name: 'Uji koneksi tersimpan', exact: true }).click();
  await page.getByText(/Koneksi teruji pada/).waitFor();
  assert.equal(await overview.getByText('Sinkron terakhir: Belum tersedia', { exact: true }).count(), 4, 'Read/test timestamps never become sync timestamps');
  await page.getByLabel('Kode provinsi baris 2', { exact: true }).selectOption('1.2');
  assert.equal(await page.getByLabel('Kode provinsi baris 1', { exact: true }).inputValue(), '1.10', 'Sorted first row edits original index 1 only');
  assert.equal(await overview.getByText('Pemetaan belum disimpan', { exact: true }).count(), 1);
  await page.getByRole('button', { name: 'Hapus pasangan baris 1', exact: true }).click();
  assert.equal(await mappingTable.locator('select[aria-label^="Indikator lokal baris"]').inputValue(), 'one', 'Remove original index 0, not sorted position 0');
  assert.equal(await overview.getByText('Pemetaan belum disimpan', { exact: true }).count(), 2, 'Pending removal is not persisted');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.equal(await overview.evaluate(el => el.scrollWidth > el.clientWidth), true, 'Overview scroll stays inside the mobile panel');
  assert.equal(writes.length, 0, 'Sorting, edits and reads never write remotely or save drafts');
  await page.setViewportSize({ width: 1280, height: 900 });
  // Real structural codes: catalog reads append suggestions, never PUT until explicit save.
  fixtureIndicators = [
    { id: 'K1-R8', sectionCode: '1.1', no: '1.', indikator: 'Nama lokal berbeda' },
    { id: 'K1-R9', sectionCode: '1.5.6', no: '1.0', indikator: 'Normalisasi ordinal' },
    { id: 'K1-R10', sectionCode: '1.8.1.2', no: '3.', indikator: 'Empat tingkat' },
    { id: 'K2-R11', sectionCode: '2.2.1', no: '10.', indikator: 'Sepuluh' },
    { id: 'missing', sectionCode: '1.10', no: '1.', indikator: 'Nama portal sama' },
    { id: 'conflict-id', sectionCode: '3.1', no: '1.', indikator: 'Pertahankan manual' },
    { id: 'conflict-code', sectionCode: '4.1', no: '1.', indikator: 'Kode sudah dipakai' },
    { id: 'duplicate-a', sectionCode: '5.1', no: '1.', indikator: 'Duplikat lokal' },
    { id: 'duplicate-b', sectionCode: '5.1', no: '1.00', indikator: 'Duplikat lokal' },
    { id: 'remote-duplicate', sectionCode: '5.2', no: '1.', indikator: 'Duplikat portal' },
    { id: 'head', sectionCode: '1.2', no: '1.', isHead: true, indikator: 'Header' },
    { id: 'artifact', sectionCode: '1.3', no: '1.', isTableArtifact: true, indikator: 'Artefak' },
    { id: 'inactive', sectionCode: '1.4', no: '1.', isActive: false, indikator: 'Nonaktif' },
    { id: 'malformed', sectionCode: '1.1', no: '1.5', indikator: 'Ordinal pecahan' },
  ];
  catalogTargets = ['1.01.01.01.01', '1.05.06.01.01', '1.08.01.02.03', '2.02.01.01.10', '3.01.01.01.01', '4.01.01.01.01', '5.01.01.01.01', '5.02.01.01.01', '5.02.01.01.01', '001-A'].map(kd_ind => ({ ...target, kd_ind, indikator: 'Nama portal sama' }));
  mappings = [{ indicatorId: 'conflict-id', provinceCode: '001-A' }, { indicatorId: 'manual', provinceCode: '4.01.01.01.01' }];
  const preserved = structuredClone(mappings);
  await page.goto(`${origin}/province-fixture`);
  await page.getByRole('button', { name: 'Ambil katalog provinsi' }).click();
  const summary = page.getByRole('status').filter({ hasText: 'Usulan kandidat valid:' });
  await summary.waitFor();
  assert.match(await summary.innerText(), /valid: 10\. Ditambahkan ke draf: 4\. Tidak ditemukan: 1\. Ambigu: 3\. Sudah terpakai: 2\. Tidak valid \/ dilewati: 4/);
  assert.equal(writes.length, 0);
  assert.equal(await page.getByLabel('Kode provinsi baris 1', { exact: true }).inputValue(), '001-A');
  assert.equal(await page.getByLabel('Kode provinsi baris 2', { exact: true }).inputValue(), '4.01.01.01.01');
  assert.equal(await page.getByLabel('Kandidat kode lokal baris 3').inputValue(), '1.01.01.01.01');
  assert.equal(await page.getByLabel('Kandidat kode lokal baris 3').getAttribute('readonly'), '');
  assert.equal(await page.getByLabel('Kandidat kode lokal baris 4').inputValue(), '1.05.06.01.01');
  // Incomplete manual rows must also survive a fresh catalog fetch and explicit rerun.
  await page.getByRole('button', { name: 'Tambah pasangan', exact: true }).click();
  await page.getByLabel('Indikator lokal baris 7').selectOption('missing');
  await page.getByRole('button', { name: 'Ambil katalog provinsi' }).click();
  await summary.waitFor();
  assert.match(await summary.innerText(), /Ditambahkan ke draf: 0/);
  assert.equal(await page.getByLabel('Indikator lokal baris 7').inputValue(), 'missing');
  assert.equal(await page.getByLabel('Kode provinsi baris 7').inputValue(), '');
  await page.getByRole('button', { name: 'Lengkapi pemetaan kode persis' }).click();
  assert.equal(writes.length, 0);
  await page.setViewportSize({ width: 375, height: 812 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole('button', { name: 'Hapus pasangan baris 7', exact: true }).click();
  // Existing unknown manual IDs are retained, but must be corrected before explicit save.
  await page.getByLabel('Indikator lokal baris 2').selectOption('conflict-code');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Simpan seluruh pemetaan' }).click();
  await page.getByText('Seluruh pemetaan tersimpan dan revisi konfigurasi dimuat ulang.', { exact: true }).waitFor();
  assert.equal(writes.length, 1);
  assert.equal(writes[0].path, '/bridge/mappings');
  assert.deepEqual(writes[0].body.items[0], preserved[0]);
  assert.deepEqual(writes[0].body.items.slice(2).map(m => m.provinceCode), ['1.01.01.01.01', '1.05.06.01.01', '1.08.01.02.03', '2.02.01.01.10']);
  fixtureIndicators = [{ id: 'local-id', indikator: 'Indikator lokal' }];
  catalogTargets = [target];
  mappings = [{ indicatorId: 'local-id', provinceCode: '001-A' }];
  config.revision = 1;
  writes.length = 0;
  await page.goto(`${origin}/province-fixture`);
  const waitRevision = revision => page.getByText(`Revisi ${revision}.`, { exact: false }).waitFor({ state: 'attached' });
  await waitRevision(1).catch(async error => { console.error(errors, await page.locator('body').innerText()); throw error; });
  assert.deepEqual(await page.getByRole('heading', { level: 3 }).allTextContents(), [
    'Integrasi Provinsi', '1. Kredensial portal provinsi', '2. Pemetaan indikator', '3. Pratinjau hanya baca', 'Riwayat integrasi',
  ], 'Core setup and preview precede visible audit history');
  assert.equal(await page.getByText('Revisi 1.', { exact: false }).isVisible(), false, 'Technical revisions are disclosed on demand');
  await page.getByText('Detail konfigurasi', { exact: true }).focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.getByText('Revisi 1.', { exact: false }).isVisible(), true);
  await page.keyboard.press('Enter');
  for (const name of ['Uji koneksi tersimpan', 'Ambil katalog provinsi', 'Lihat perbandingan']) {
    assert.match(await page.getByRole('button', { name }).getAttribute('aria-describedby'), /province-remote-reason/);
  }
  const history = page.getByRole('region', { name: 'Riwayat integrasi', exact: true });
  const waitLogs = () => history.getByText('Memuat riwayat integrasi...', { exact: true }).waitFor({ state: 'hidden' });
  await history.getByText('Uji koneksi', { exact: true }).waitFor();
  assert.equal(await history.getByRole('button', { name: 'Sebelumnya' }).isDisabled(), true);
  assert.match(await history.innerText(), /Gagal/);
  assert.match(await history.innerText(), /0 ms/);
  assert.match(await history.innerText(), /Layanan integrasi tidak tersedia/);
  assert.equal(await history.getByText(/ID pelaku:/).isVisible(), false);
  await history.getByText('Detail pelaku', { exact: true }).click();
  assert.match(await history.innerText(), /internal-actor-id/);
  await page.getByLabel('Username', { exact: true }).fill('unsaved-admin');
  await page.getByLabel('Password pengganti (opsional)').fill('unsaved-password');
  await page.getByLabel('Kode Puskesmas provinsi').fill('unsaved-code');
  assert.match(await page.locator('#province-remote-reason').innerText(), /Simpan atau muat ulang perubahan kredensial/);
  assert.equal(await page.getByRole('button', { name: 'Uji koneksi tersimpan' }).isDisabled(), true);
  await history.getByRole('button', { name: 'Berikutnya' }).click();
  await history.getByText('Halaman 2', { exact: true }).waitFor();
  assert.equal(await history.getByRole('button', { name: 'Berikutnya' }).isDisabled(), true);
  assert.match(await history.innerText(), /Baca katalog/);
  assert.match(await history.innerText(), /Penyebab tidak tersedia/);
  assert.doesNotMatch(await history.innerText(), /untrusted-secret-error/);
  logsEmpty = true;
  await history.getByRole('button', { name: 'Sebelumnya' }).click();
  await history.getByText('Halaman 1', { exact: true }).waitFor();
  assert.match(await history.innerText(), /Belum ada aktivitas/);
  logsEmpty = false;
  await history.getByRole('button', { name: 'Segarkan riwayat' }).click();
  await waitLogs();
  // Offset inserts/deletes can leave the next page empty even after hasMore was true.
  logsEmpty = true;
  await history.getByRole('button', { name: 'Berikutnya' }).click();
  await history.getByText('Halaman 2', { exact: true }).waitFor();
  assert.match(await history.innerText(), /Tidak ada aktivitas pada halaman ini/);
  assert.equal(await history.getByRole('button', { name: 'Sebelumnya' }).isEnabled(), true);
  logsEmpty = false;
  await history.getByRole('button', { name: 'Sebelumnya' }).click();
  await history.getByText('Halaman 1', { exact: true }).waitFor();
  await history.getByRole('button', { name: 'Segarkan riwayat' }).click();
  await waitLogs();
  assert.equal(await page.getByLabel('Username', { exact: true }).inputValue(), 'unsaved-admin');
  assert.equal(await page.getByLabel('Password pengganti (opsional)').inputValue(), 'unsaved-password');
  assert.equal(await page.getByLabel('Kode Puskesmas provinsi').inputValue(), 'unsaved-code');
  await page.getByLabel('Username', { exact: true }).fill('admin');
  await page.getByLabel('Password pengganti (opsional)').fill('');
  await page.getByLabel('Kode Puskesmas provinsi').fill('001');
  const beforeOperationLogs = logPages.length;
  logsFail = true;
  await page.getByRole('button', { name: 'Uji koneksi tersimpan' }).click();
  await page.getByText(/Koneksi teruji pada/).waitFor();
  await history.getByRole('alert').waitFor();
  assert.equal(logPages.length, beforeOperationLogs + 1, 'Successful operation refreshes logs even when log read fails');
  assert.doesNotMatch(await history.innerText(), /sensitive-raw-log-error/);
  assert.match(await history.innerText(), /hasil pemuatan sebelumnya/);
  testFails = true;
  await page.getByRole('button', { name: 'Uji koneksi tersimpan' }).click();
  await page.getByRole('alert').filter({ hasText: /Kunci enkripsi server/ }).waitFor();
  await waitLogs();
  assert.equal(logPages.length, beforeOperationLogs + 2, 'Failed operation also refreshes logs without masking original error');
  assert.equal(await page.getByText(/Koneksi teruji pada/).count(), 0);
  logsFail = false;
  await page.getByLabel('Password pengganti (opsional)').fill('temporary-secret');
  await page.getByRole('button', { name: 'Simpan kredensial' }).click();
  await page.getByText(/Konfigurasi tersimpan. Koneksi belum diuji/).waitFor();
  assert.equal(await page.getByLabel('Password pengganti (opsional)').inputValue(), '');
  assert.equal(writes[0].body.revision, 1);
  assert.equal(writes[0].body.password, 'temporary-secret');
  await page.getByRole('button', { name: 'Lihat perbandingan' }).click();
  await page.getByText('Belum ada rekaman lokal tersimpan (null).', { exact: true }).waitFor();
  assert.match(await page.getByRole('region', { name: 'Tabel perbandingan lokal dan provinsi' }).innerText(), /Total sasaran portal:\s*0/);
  const comparison = page.getByRole('region', { name: 'Tabel perbandingan lokal dan provinsi' });
  assert.match(await comparison.innerText(), /Target sasaran portal:\s*Tidak tersedia \(bukan nol\)/);
  assert.doesNotMatch(await comparison.innerText(), /Tahun data provinsi tidak diketahui|Kesetaraan rumus/);
  const unmatched = page.getByRole('region', { name: 'Data provinsi belum dipetakan', exact: true });
  assert.equal(await unmatched.isVisible(), false, 'Large unmatched catalog starts collapsed');
  await page.getByText('Data provinsi belum dipetakan (250)', { exact: true }).click();
  assert.equal(await unmatched.getByRole('row').count(), 251);
  assert.equal(await unmatched.evaluate(el => el.scrollHeight > el.clientHeight), true, 'Expanded catalog has bounded height');
  await page.setViewportSize({ width: 375, height: 812 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Full panel does not overflow mobile viewport with preview and unmatched rows');
  assert.equal(await comparison.evaluate(el => el.scrollWidth > el.clientWidth), true, 'Numeric comparison scrolls inside its own region');
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByLabel('Jenis pratinjau').selectOption('MONTHLY');
  assert.equal(await page.getByRole('region', { name: 'Tabel perbandingan lokal dan provinsi' }).count(), 0);
  await page.getByRole('button', { name: 'Lihat perbandingan' }).click();
  await page.getByText('Belum ada rekaman lokal tersimpan (null).', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Ambil katalog provinsi' }).click();
  await page.getByText(/1 baris katalog/).waitFor();
  assert.equal(await page.getByLabel('Indikator lokal baris 1').inputValue(), 'local-id');
  assert.equal(await page.getByLabel('Kode provinsi baris 1').inputValue(), '001-A');
  await page.getByRole('button', { name: 'Hapus pasangan baris 1', exact: true }).click();
  assert.match(await page.locator('#province-preview-reason').innerText(), /Simpan atau muat ulang pemetaan/);
  assert.equal(await page.getByRole('button', { name: 'Lihat perbandingan' }).isDisabled(), true);
  assert.match(await page.getByRole('region', { name: '2. Pemetaan indikator' }).innerText(), /Menyimpan daftar kosong akan menghapus/);
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: 'Simpan seluruh pemetaan' }).click();
  assert.equal(writes.length, 1);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Simpan seluruh pemetaan' }).click();
  await page.getByText(/Seluruh pemetaan tersimpan/).waitFor();
  assert.deepEqual(writes[1].body, { revision: 2, items: [] });
  await waitRevision(3);
  configConflict = true;
  await page.getByLabel('Password pengganti (opsional)').fill('not-retained');
  await page.getByRole('button', { name: 'Simpan kredensial' }).click();
  await page.getByText(/berubah di sesi lain/).waitFor();
  assert.match(await page.locator('#province-remote-reason').innerText(), /Konfigurasi perlu dimuat ulang/);
  assert.equal(await page.getByLabel('Password pengganti (opsional)').inputValue(), '');
  assert.equal(await page.getByRole('button', { name: 'Lihat perbandingan' }).isDisabled(), true);
  unavailable = true;
  await page.reload();
  await page.getByText(/Kunci enkripsi server/).waitFor();
  await history.getByText('Uji koneksi', { exact: true }).waitFor();
  assert.equal(await history.getByRole('button', { name: 'Segarkan riwayat' }).isEnabled(), true, 'Logs remain independent of missing credential key');
  assert.equal(await page.getByRole('button', { name: 'Muat ulang konfigurasi / coba lagi' }).isEnabled(), true);
  await page.setViewportSize({ width: 375, height: 812 });
  assert.equal(await history.evaluate(el => el.scrollWidth <= el.clientWidth), true, 'Log timeline fits mobile width');
  unavailable = false;
  await page.getByRole('button', { name: 'Muat ulang konfigurasi / coba lagi' }).click();
  await waitRevision(3);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Credentials, mapping, preview controls and history fit mobile viewport');
  assert.equal(await page.getByLabel('Username', { exact: true }).evaluate(el => el.getBoundingClientRect().height >= 44 && getComputedStyle(el).fontSize === '14px'), true);
  assert.equal(await page.getByRole('region', { name: 'Tabel pemetaan indikator' }).evaluate(el => el.scrollWidth > el.clientWidth), true);
  let releasePreview;
  delayedPreview = new Promise(resolve => { releasePreview = resolve; });
  await page.getByRole('button', { name: 'Lihat perbandingan' }).click();
  await page.getByText('Memuat pratinjau...', { exact: true }).waitFor();
  const processing = page.locator('.processing-indicator');
  assert.equal(await processing.getAttribute('role'), 'status');
  assert.equal(await processing.getAttribute('aria-live'), 'polite');
  assert.equal(await processing.getAttribute('aria-atomic'), 'true');
  assert.equal(await processing.locator('[role="status"], [role="progressbar"]').count(), 0, 'One status region, no invented determinate progress');
  assert.equal(await processing.locator('.processing-indicator__dots > span').count(), 3);
  assert.equal(await processing.locator('[aria-hidden="true"]').count(), 3, 'Orbit, dots and bar are decorative');
  const animationNames = () => processing.locator('span').evaluateAll(elements => elements.map(el => getComputedStyle(el).animationName).filter(name => name !== 'none'));
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  assert.equal((await animationNames()).length, 5, 'Orbit, sliding bar and three dots animate');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Pending indicator fits the mobile viewport');
  const pendingText = await processing.innerText();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.deepEqual(await animationNames(), [], 'Reduced motion disables every indicator animation');
  assert.equal(await processing.innerText(), pendingText, 'Reduced motion retains the same readable status');
  assert.equal(await processing.locator('.processing-indicator__track > span').evaluate(el => el.getBoundingClientRect().width > 0 && getComputedStyle(el).transform !== 'none'), true, 'Static bar remains visible');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Static indicator fits mobile too');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  assert.match(await page.locator('#province-remote-reason').innerText(), /Memuat pratinjau. Tunggu hingga selesai/);
  assert.equal(await page.getByRole('button', { name: 'Uji koneksi tersimpan' }).isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: 'Ambil katalog provinsi' }).isDisabled(), true);
  assert.equal(await page.getByLabel('Username', { exact: true }).isDisabled(), true);
  await page.evaluate(() => window.renderMonth(3));
  await page.getByText(/tahun 2026, bulan 3/).waitFor();
  releasePreview();
  await page.getByRole('button', { name: 'Lihat perbandingan' }).waitFor({ state: 'visible' });
  assert.equal(await page.getByRole('region', { name: 'Tabel perbandingan lokal dan provinsi' }).count(), 0);
  // Another administrator changes mappings after this panel loaded its draft.
  delayedPreview = null;
  config.revision++;
  const beforeStaleCatalog = writes.length;
  await page.getByRole('button', { name: 'Ambil katalog provinsi' }).click();
  await page.getByText(/berubah di sesi lain/).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Simpan seluruh pemetaan' }).isDisabled(), true);
  assert.equal(writes.length, beforeStaleCatalog, 'A newer catalog must not authorize saving an old mapping draft');
  await page.getByRole('button', { name: 'Muat ulang konfigurasi / coba lagi' }).click();
  await waitRevision(4);
  await page.getByRole('button', { name: 'Ambil katalog provinsi' }).click();
  await page.getByText(/1 baris katalog/).waitFor();
  await page.getByRole('button', { name: 'Tambah pasangan' }).click();
  await page.getByLabel('Indikator lokal baris 1').selectOption('local-id');
  await page.getByLabel('Kode provinsi baris 1').selectOption('001-A');
  // A second race after catalog validation must submit the observed revision, then fail closed.
  config.revision++;
  await page.getByRole('button', { name: 'Simpan seluruh pemetaan' }).click();
  await page.getByText(/berubah di sesi lain/).waitFor();
  assert.deepEqual(writes.at(-1).body, { revision: 4, items: [{ indicatorId: 'local-id', provinceCode: '001-A' }] });
  assert.deepEqual(mappings, [], 'A stale draft must not replace the current mapping set');
  assert.equal(await page.getByRole('button', { name: 'Simpan seluruh pemetaan' }).isDisabled(), true);
  for (const activeYear of [null, 2026]) {
    flags.activeYear = activeYear;
    flags.provinceEnabled = false;
    await page.reload();
    await waitRevision(5);
    assert.match(await page.locator('#province-remote-reason').innerText(), activeYear === null ? /Tahun aktif belum ditetapkan.*Minta Dinkes/ : /Akses baca provinsi dinonaktifkan.*Minta Dinkes/);
    await history.getByText('Uji koneksi', { exact: true }).waitFor();
    await waitLogs();
    assert.equal(await history.getByRole('button', { name: 'Segarkan riwayat' }).isEnabled(), true);
    assert.equal(await page.getByRole('button', { name: 'Uji koneksi tersimpan' }).isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: 'Ambil katalog provinsi' }).isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: 'Lihat perbandingan' }).isDisabled(), true);
    await page.getByLabel('Password pengganti (opsional)').fill('local-only');
    assert.equal(await page.getByRole('button', { name: 'Simpan kredensial' }).isEnabled(), true);
  }
  config.configured = false;
  flags.activeYear = 2026;
  flags.provinceEnabled = true;
  await page.reload();
  await waitRevision(5);
  assert.match(await page.locator('#province-remote-reason').innerText(), /Lengkapi dan simpan kredensial pada langkah 1/);
  assert.equal(await page.getByRole('button', { name: 'Uji koneksi tersimpan' }).isDisabled(), true);
  config.configured = true;
  logsEmpty = true;
  await history.getByRole('button', { name: 'Segarkan riwayat' }).click();
  await history.getByText('Belum ada aktivitas integrasi tercatat.', { exact: true }).waitFor();
  assert.equal(await history.getByRole('button', { name: 'Berikutnya' }).isDisabled(), true);
  logsFail = true;
  await page.reload();
  await history.getByRole('alert').waitFor();
  assert.equal(await history.getByRole('listitem').count(), 0);
  logsFail = false;
  await history.getByRole('button', { name: 'Segarkan riwayat' }).click();
  await history.getByText('Belum ada aktivitas integrasi tercatat.', { exact: true }).waitFor();
  logsEmpty = false;
  let releaseLogs;
  delayedLogs = new Promise(resolve => { releaseLogs = resolve; });
  let logsStarted = new Promise(resolve => { onLogsStarted = resolve; });
  await history.getByRole('button', { name: 'Segarkan riwayat' }).click();
  await logsStarted;
  await history.getByText('Memuat riwayat integrasi...', { exact: true }).waitFor();
  // Remount into a new panel while the old request is still pending.
  logsEmpty = true;
  delayedLogs = null;
  await page.evaluate(() => window.renderMonth(4));
  await history.getByText('Belum ada aktivitas integrasi tercatat.', { exact: true }).waitFor();
  releaseLogs();
  await waitLogs();
  assert.equal(await history.getByRole('listitem').count(), 0, 'Unmounted log response cannot populate a new panel');
  // A scope change without a remount must also reject a late response.
  logsEmpty = false;
  delayedLogs = new Promise(resolve => { releaseLogs = resolve; });
  logsStarted = new Promise(resolve => { onLogsStarted = resolve; });
  await history.getByRole('button', { name: 'Segarkan riwayat' }).click();
  await logsStarted;
  await history.getByText('Memuat riwayat integrasi...', { exact: true }).waitFor();
  await page.evaluate(() => window.changeScope());
  releaseLogs();
  delayedLogs = null;
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await history.getByRole('listitem').count(), 0, 'Changed tenant scope rejects late log data');
  for (const query of ['role=PIC', 'role=DINKES_ADMIN', 'tenant=other']) {
    const before = apiCalls;
    await page.goto(`${origin}/province-fixture?${query}`);
    await page.waitForFunction(() => typeof window.renderMonth === 'function');
    assert.equal(await page.getByRole('heading', { name: 'Integrasi Provinsi', exact: true }).count(), 0);
    assert.equal(apiCalls, before, 'Forbidden scope must not issue any bridge request');
  }
  // Fresh document imports the real store, without the panel fixture's method overrides.
  await page.goto(`${origin}/store-fixture`);
  const storeChecks = await page.evaluate(async () => {
    const { pkpStore: store } = await import('/src/services/apiStore.ts');
    // Seed state only; exercise the actual trackWrite, scope setters and session-expiry handler.
    store.state = { ...store.state, user: { id: 'admin', role: 'ADMIN_PUSKESMAS', healthCenterId: 'own' }, healthCenterId: 'own', year: 2026, years: [{ year: 2026 }, { year: 2025 }], centers: [{ id: 'own', isActive: true }, { id: 'other', isActive: true }] };
    const checks = [];
    store.state = { ...store.state, activePeriod: { year: 2026, provinceEnabled: false, revision: 7 } };
    checks.push(store.canInputOwnPeriod());
    for (const activeYear of [null, 2025]) {
      store.state = { ...store.state, activePeriod: { year: activeYear, provinceEnabled: false, revision: 7 } };
      checks.push(!store.canInputOwnPeriod());
      for (const action of [() => store.saveRecord('local-id', 2, { pencapaianRiil: 1 }), () => store.saveAnnualTargetsBulk([]), () => store.submitPeriod(2026, 2, false), () => store.uploadEvidence(new File(['x'], 'x.txt'), 2)]) {
        try { await action(); checks.push(false); } catch (error) { checks.push(error.status === 409); }
      }
    }
    for (const action of [() => store.addYearPeriod(2027, 10), () => store.updateYearCutoff(2026, 5), () => store.setActivePeriod(2026, true), () => store.toggleYearLock(2026)]) {
      try { await action(); checks.push(false); } catch (error) { checks.push(error.status === 403); }
    }
    let release;
    const write = store.runOwnTenantWrite(() => new Promise(resolve => { release = resolve; }));
    checks.push(store.isMutating());
    for (const action of [() => store.setCurrentYear(2025), () => store.selectHealthCenter('other'), () => store.runOwnTenantWrite(async () => 'overlap')]) {
      try { await action(); checks.push(false); } catch (error) { checks.push(error.message.includes('Tunggu penyimpanan')); }
    }
    checks.push(store.getCurrentYear() === 2026 && store.getSelectedHealthCenterId() === 'own');
    release('ok');
    checks.push(await write === 'ok', !store.isMutating());
    try { await store.runOwnTenantWrite(async () => { throw new Error('fixture failure'); }); } catch { checks.push(!store.isMutating()); }
    for (const user of [{ role: 'PIC', healthCenterId: 'own' }, { role: 'DINKES_ADMIN', healthCenterId: 'own' }, { role: 'ADMIN_PUSKESMAS', healthCenterId: 'other' }]) {
      store.state = { ...store.state, user };
      let called = false;
      try { await store.runOwnTenantWrite(async () => { called = true; }); checks.push(false); } catch (error) { checks.push(error.status === 403 && !called && !store.isMutating()); }
    }
    store.state = { ...store.state, user: { id: 'admin', role: 'ADMIN_PUSKESMAS', healthCenterId: 'own' } };
    let writeSignal;
    const stale = store.runOwnTenantWrite(signal => { writeSignal = signal; return new Promise(resolve => { release = resolve; }); });
    window.dispatchEvent(new CustomEvent('sipkp-session-expired'));
    checks.push(writeSignal.aborted, !store.isMutating(), store.getSessionUser() === null);
    release('stale');
    try { await stale; checks.push(false); } catch (error) { checks.push(error.message.includes('Lingkup sesi telah berubah')); }
    checks.push(!store.isMutating());
    return checks;
  });
  assert.ok(storeChecks.length >= 15 && storeChecks.every(Boolean), `Real store scope checks: ${JSON.stringify(storeChecks)}`);
  await page.goto(`${origin}/period-fixture`);
  await page.getByText(/Tahun aktif: Belum ditetapkan/).waitFor();
  assert.equal(await page.getByRole('switch').isDisabled(), true);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Aktifkan Tahun 2026', exact: true }).click();
  await page.getByText(/Tahun aktif ditetapkan ke 2026/).waitFor();
  assert.deepEqual(writes.at(-1).body, { year: 2026, provinceEnabled: false, revision: 0 });
  assert.equal(await page.evaluate(() => window.store.getCurrentYear()), 2025, 'Active pointer must not replace historical view');
  assert.equal(await page.getByRole('button', { name: 'Hapus Tahun 2026' }).isDisabled(), true);
  assert.equal(await page.evaluate(() => window.store.getYears()[0].status), 'LOCKED');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('switch').click();
  await page.getByText('Akses baca provinsi diperbarui.', { exact: true }).waitFor();
  assert.deepEqual(writes.at(-1).body, { year: 2026, provinceEnabled: true, revision: 1 });
  periodConflict = true;
  const beforeConflict = writes.length;
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Aktifkan Tahun 2025', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: /Status terbaru dimuat/ }).waitFor();
  assert.equal(writes.length, beforeConflict + 1, 'Conflict must reload without retrying PUT');
  assert.equal(await page.evaluate(() => window.store.getActivePeriod().revision), 3);
  const bootstrapChecks = await page.evaluate(async () => {
    const store = window.store;
    let reads = 0;
    store.read = async path => {
      if (path === '/master/active-year') { reads++; return { year: 2026, provinceEnabled: false, revision: 9 }; }
      if (path === '/master/years') return [{ year: 2027, provinceEnabled: false }, { year: 2026, provinceEnabled: false }, { year: 2025, provinceEnabled: true }];
      if (path === '/health-centers') return [{ id: 'own', name: 'Own', isActive: true }];
      return [];
    };
    const refresh = store.refreshScope;
    store.refreshScope = async () => {};
    await store.initialize({ id: 'own-admin', role: 'ADMIN_PUSKESMAS', healthCenterId: 'own' });
    const initialActive = store.getCurrentYear() === 2026 && reads === 1;
    store.state = { ...store.state, year: 2025 };
    store.refreshScope = refresh;
    // The real scope refresh must fetch active state once, not recursively refresh itself.
    store.analytics = async () => ({ sheets: {}, trend: null, indicatorTrends: [] });
    store.users = async () => [];
    await store.refreshScope();
    return [initialActive, reads === 2, store.getCurrentYear() === 2025, store.getActivePeriod().year === 2026];
  });
  assert.ok(bootstrapChecks.every(Boolean), `Bootstrap/refresh checks: ${JSON.stringify(bootstrapChecks)}`);
  await page.goto(`${origin}/workflow-fixture`);
  await page.waitForFunction(() => typeof window.renderWorkflow === 'function');
  for (const activeYear of [2026, null]) {
    await page.evaluate(year => window.renderWorkflow(year, 'SUBMITTED'), activeYear);
    await page.getByRole('button', { name: 'Minta Revisi', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Minta Revisi', exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: 'Sahkan & Kunci', exact: true }).isDisabled(), true);
    for (const name of ['Minta Revisi', 'Sahkan & Kunci']) {
      await page.getByRole('button', { name, exact: true }).evaluate(button => {
        const props = button[Object.keys(button).find(key => key.startsWith('__reactProps$'))];
        return props.onClick();
      });
    }
    assert.equal(await page.getByRole('dialog', { name: 'Kembalikan untuk revisi' }).count(), 0);
    await page.evaluate(year => window.renderWorkflow(year, 'VERIFIED'), activeYear);
    await page.getByRole('button', { name: 'Buka Kunci Revisi', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Buka Kunci Revisi', exact: true }).isDisabled(), true);
    await page.getByRole('button', { name: 'Buka Kunci Revisi', exact: true }).evaluate(button => {
      const props = button[Object.keys(button).find(key => key.startsWith('__reactProps$'))];
      return props.onClick();
    });
  }
  assert.deepEqual(await page.evaluate(() => window.workflowCalls), []);
  await page.evaluate(() => window.renderWorkflow(2025, 'SUBMITTED'));
  await page.getByRole('button', { name: 'Sahkan & Kunci', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.workflowCalls), ['verifyAndLockPeriod']);
  await page.getByRole('button', { name: 'Minta Revisi', exact: true }).click();
  await page.getByLabel('Catatan revisi').fill('Perbaiki data');
  await page.evaluate(() => window.renderWorkflow(2026, 'SUBMITTED'));
  assert.equal(await page.getByRole('button', { name: 'Kirim Catatan Revisi', exact: true }).isDisabled(), true);
  // Exercise the handler even if a caller bypasses the disabled DOM control.
  await page.getByRole('button', { name: 'Kirim Catatan Revisi', exact: true }).evaluate(button => {
    const props = button[Object.keys(button).find(key => key.startsWith('__reactProps$'))];
    return props.onClick();
  });
  assert.deepEqual(await page.evaluate(() => window.workflowCalls), ['verifyAndLockPeriod']);
  await page.getByRole('button', { name: 'Batal', exact: true }).click();
  await page.evaluate(() => window.renderWorkflow(2025, 'SUBMITTED', 'ADMIN_PUSKESMAS'));
  await page.getByText('Menunggu verifikasi Dinkes', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Sahkan & Kunci', exact: true }).count(), 0);
   await page.evaluate(() => window.renderEpOrder(false));
   await page.getByText('1.1.10', { exact: true }).waitFor();
   assert.deepEqual(await page.locator('tbody tr').filter({ hasText: 'EP ' }).locator('td:first-child span.font-bold').allTextContents(), ['1.1.1', '1.1.2', '1.1.3', '1.1.10']);
   assert.equal(await page.getByText('Status belum terverifikasi', { exact: true }).count(), 4);
   assert.equal(await page.getByText('Tersinkron', { exact: true }).count(), 0);
   assert.equal(await page.getByText('Sinkron terakhir: Belum tersedia', { exact: true }).count(), 5);
   await page.evaluate(() => window.renderEpOrder(true));
   await page.getByText('1.1.10', { exact: true }).waitFor();
   assert.deepEqual(await page.locator('tbody tr td:first-child').allTextContents(), ['1.1.1', '1.1.2', '1.1.3', '1.1.10']);
   assert.deepEqual(errors, []);
  console.log('Frontend fixtures passed: automatic structural exact-code suggestions, .0 ordinal normalization, duplicate and occupied candidates, manual/incomplete draft preservation, no PUT before explicit save, idempotent reruns, synthetic 001-A manual fallback, province logs pagination/empty/error/recovery, operation refresh isolation, disabled/missing-key access, stale tenant/unmount guards, mobile timeline, config/read-only preview, disabled/null active periods, mapping revisions, 409/503, mobile scroll, session guards, own active-year input guards, Dinkes activation/switch/conflict reload, active bootstrap and bounded scope refresh.');
} finally {
  await browser.close();
  await server.close();
}
