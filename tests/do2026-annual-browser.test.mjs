import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from 'playwright';

// Same isolated Vite/store approach as pic-input-browser: real components, no backend or env files.
const storeSource = `
const listeners = new Set();
let revision = 0;
export const state = { role: 'ADMIN_PUSKESMAS', year: 2026, month: 3, endMonth: 3,
  center: 'fixture-center', active: true, lockedMonths: [], assigned: true,
  annual: true, view: 'panel', legacy: false, held: false, pauseUpload: false };
let user = { id: 'fixture-user', role: state.role, healthCenterId: 'fixture-center' };
export const instruction = 'Verifikasi kegiatan pemeliharaan terjadwal dan bukti pelaksanaan pada tahun yang sama. Hitung setiap kegiatan sekali sesuai jadwal yang direkonsiliasi. Konfirmasi bukan pengesahan Dinkes.';
export function indicator(id = state.indicatorId ?? 'annual') {
  return { id, indikator: 'Indikator ' + id, do2026: {
    status: state.held ? 'UNRESOLVED_RULE' : 'IMPLEMENTED',
    reason: state.held ? 'Kelayakan kohort belum dapat dipastikan dari sumber.' : null,
    numeratorLabel: 'Penerima unik (N)', denominatorLabel: 'Sasaran tahunan (D)',
    numeratorInput: 'INTEGER', denominatorInput: 'INTEGER', measurementUnit: 'PERCENT',
    ...(id === 'annual' ? { annualRecapOnly: state.annual } : {}),
    assessmentInstruction: instruction, targetDisplay: '90%',
  } };
}
export const requests = [], writes = [], uploads = [];
let releaseUpload;
export function resumeUpload() { releaseUpload?.(); }
const saved = new Map();
export function item(id = 'annual', endMonth = state.endMonth) {
  const recap = saved.get([state.center, state.year, endMonth, id].join(':'));
  return { indicatorId: id, indicator: indicator(id), numerator: null, denominator: null,
    measurementValue: null, measurementUnit: 'PERCENT', nilaiKinerja: null, dataComplete: false,
    scoreComplete: false, availableMonths: [], missingMonths: [], recapRevision: 0,
    aggregationMethod: 'EXPLICIT_YTD_REQUIRED', status: 'MISSING_DATA', recapStructuredInput: null, ...recap };
}
export const pkpStore = {
  subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); },
  getSnapshot: () => revision, getServerSnapshot: () => revision,
  getSessionUser: () => user, getCurrentYear: () => state.year,
  getSelectedHealthCenterId: () => state.center,
  getSelectedHealthCenter: () => ({ name: 'Puskesmas Uji' }),
  getLoadState: () => ({ loading: false, error: null }),
  getActivePeriod: () => ({ year: 2026 }), isActiveYear: year => state.active && year === 2026,
  canInputOwnPeriod: year => state.active && year === 2026 && state.center === user.healthCenterId,
  isPeriodLocked: (_year, month) => state.lockedMonths.includes(month), isMutating: () => false,
  getAssignments: () => state.assigned ? { [state.indicatorId ?? 'annual']: user.id, existing: user.id } : {},
  getIndicators: () => [indicator(), indicator('existing')],
  uploadEvidence: async (file, month) => {
    uploads.push({ name: file.name, month });
    if (state.pauseUpload) await new Promise(resolve => { releaseUpload = resolve; });
    return { evidenceId: 'uploaded' };
  },
  saveRecord: async (...args) => { writes.push({ kind: 'monthly', args }); },
  savePeriodRecap: async value => {
    writes.push({ kind: 'recap', value });
    saved.set([state.center, value.year, value.endMonth, value.indicatorId].join(':'), {
      numerator: value.numerator, denominator: value.denominator, recapNotes: value.notes,
      recapRevision: value.expectedRevision + 1, measurementValue: 80, dataComplete: true,
      aggregationMethod: 'EXPLICIT_YTD_RECAP', status: 'AVAILABLE',
    });
  },
};
export function configure(options = {}, notify = true) {
  Object.assign(state, options);
  if (user.role !== state.role) user = { ...user, role: state.role };
  if (notify) { revision++; listeners.forEach(fn => fn()); }
}
export class ApiError extends Error {}
export const api = { request: async path => {
  requests.push(path);
  if (path.startsWith('/analytics/period-recap?')) {
    const endMonth = Number(new URL(path, 'http://fixture.invalid').searchParams.get('endMonth'));
    return { items: [item('annual', endMonth), item('existing', endMonth)] };
  }
  if (path.startsWith('/master/indicators/')) return {
    year: state.year, definitionId: 'fixture-definition', definition: 'DO source', calculation: 'N / D',
    targetDisplay: '90%', dataSource: null, notes: null,
    implementationStatus: state.held ? 'UNRESOLVED_RULE' : 'IMPLEMENTED',
    reason: state.held ? 'Kelayakan kohort belum dapat dipastikan dari sumber.' : null,
    sourceFile: 'fixture.xlsx', sourceRef: 'fixture', version: 'DO_2026_V2', sourceHash: 'fixture',
  };
  throw new Error('Unexpected fixture request: ' + path);
} };
`;

const entrySource = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { PeriodRecapPanel } from '/src/components/data-entry/PeriodRecapPanel.tsx';
import { RecapEditor } from '/src/components/data-entry/recap-editor.tsx';
import { Do2026Editor } from '/src/components/data-entry/Do2026Editor.tsx';
import { state, configure, indicator, item, requests, writes, uploads, instruction, resumeUpload } from 'virtual:annual-store';
import '/src/index.css';
const root = createRoot(document.getElementById('root'));
function render(options = {}) {
  configure(options);
  root.render(state.view === 'monthly' ? React.createElement(Do2026Editor, {
    indicator: indicator(), record: { pencapaianRiil: 4, totalSasaran: 10,
      scoringVersion: state.legacy ? 'ILP_2026_V1' : 'DO_2026_V2', inputBasis: 'PERIOD_ACTUAL',
      notes: 'Sumber tersimpan', evidenceId: 'stored-evidence' },
    year: 2026, month: state.month, canEdit: true, onClose: () => root.render(null),
  }) : state.view === 'editor' ? React.createElement(RecapEditor, {
    item: item(), profile: indicator().do2026, year: 2026, endMonth: state.endMonth,
    healthCenterId: 'fixture-center', readOnlyReason: null, onPendingChange: () => {}, onSaved: () => {},
  }) : React.createElement(PeriodRecapPanel, { year: 2026, month: state.month }));
}
window.annualFixture = { render, configure, requests, writes, uploads, instruction, resumeUpload };
render();
`;

test('annual-only DO frontend with isolated browser fixtures', async t => {
  const cacheDir = await mkdtemp('/tmp/opencode/do2026-annual-vite-');
  let server, browser;
  try {
    server = await createServer({
      root: fileURLToPath(new URL('..', import.meta.url)), configFile: false, envFile: false, cacheDir,
      plugins: [{
        name: 'annual-do-fixture', enforce: 'pre',
        resolveId(id) {
          if (id === '/annual-fixture.jsx') return '\0annual-fixture.jsx';
          if (id === 'virtual:annual-store' || /(?:^|\/)(?:apiStore|apiClient)(?:\.ts)?$/.test(id)) return '\0annual-store';
        },
        load(id) {
          if (id === '\0annual-fixture.jsx') return entrySource;
          if (id === '\0annual-store') return storeSource;
        },
        configureServer(vite) {
          vite.middlewares.use('/annual-test', async (_req, res) => {
            res.setHeader('Content-Type', 'text/html');
            res.end(await vite.transformIndexHtml('/annual-test', '<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/annual-fixture.jsx"></script></body></html>'));
          });
        },
      }, react()],
      server: { host: '127.0.0.1', port: 0 },
      optimizeDeps: { noDiscovery: true, include: ['react', 'react-dom/client', 'react/jsx-dev-runtime', 'lucide-react'] },
    });
    await server.listen();
    browser = await chromium.launch({ headless: true });
    const origin = new URL(server.resolvedUrls.local[0]).origin;
    async function fixture(options, run) {
      const page = await browser.newPage({ viewport: { width: 375, height: 900 } });
      page.setDefaultTimeout(15000);
      const exceptions = [], unexpectedRequests = [];
      page.on('pageerror', error => exceptions.push(error.message));
      await page.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin !== origin || url.pathname.startsWith('/api/')) {
          unexpectedRequests.push(url.href);
          return route.abort();
        }
        return route.continue();
      });
      try {
        await page.goto(origin + '/annual-test');
        await page.waitForFunction(() => window.annualFixture);
        await page.evaluate(options => window.annualFixture.render(options), options);
        await run(page);
        assert.deepEqual(exceptions, []);
        assert.deepEqual(unexpectedRequests, []);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      } finally { await page.close(); }
    }
    async function openEditor(page, panel = false) {
      if (panel) {
        await page.getByText('Rekap Kumulatif & Tahunan', { exact: true }).click();
        await page.getByRole('region', { name: 'Hasil rekap indikator' }).waitFor();
      }
      await page.getByText('Isi atau perbarui rekap terpisah', { exact: true }).click();
    }
    async function fillRecap(page) {
      await page.getByLabel('Penerima unik (N)', { exact: true }).fill('80');
      await page.getByLabel('Sasaran tahunan (D)', { exact: true }).fill('100');
      await page.getByRole('textbox', { name: 'Sumber dan cara menyusun rekap (wajib)', exact: true }).fill('Register Januari-Desember 2026; ANC K1 murni <=12 minggu, orang unik tanpa duplikasi.');
      await page.getByRole('checkbox').check();
    }
    async function forceSubmit(page) {
      await page.locator('form').evaluate(form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    }
    async function noWrites(page) {
      assert.deepEqual(await page.evaluate(() => [window.annualFixture.writes, window.annualFixture.uploads]), [[], []]);
    }

    for (const role of ['ADMIN_PUSKESMAS', 'PIC']) {
      for (const month of [3, 12]) {
        await t.test(role + ' cannot write or upload annual V2 monthly in month ' + month, () => fixture({ role, month, view: 'monthly' }, async page => {
          await page.getByRole('dialog', { name: 'Input DO 2026', exact: true }).waitFor();
          assert.equal(await page.getByRole('button', { name: 'Simpan', exact: true }).isDisabled(), true);
          assert.equal(await page.getByLabel('Lampirkan bukti dukung', { exact: true }).isDisabled(), true);
          await page.getByRole('status').filter({ hasText: /Input V2 bulanan tidak tersedia, termasuk bulan Desember/ }).waitFor();
          assert.equal(await page.getByRole('button', { name: 'Pratinjau bukti tersimpan', exact: true }).isEnabled(), true);
          await forceSubmit(page);
          await page.getByRole('alert').filter({ hasText: /Buka Rekap Kumulatif & Tahunan, lalu pilih Desember/ }).waitFor();
          await noWrites(page);
        }));
      }
      await t.test(role + ' can browse partial months but only save a confirmed December recap', () => fixture({ role }, async page => {
        await openEditor(page, true);
        const month = page.getByLabel('Akhir periode rekap');
        assert.equal(await month.locator('option').count(), 12);
        for (const endMonth of ['3', '1', '11']) {
          if (endMonth !== '3') {
            await month.selectOption(endMonth);
            await openEditor(page);
          }
          assert.equal(await month.inputValue(), endMonth);
          assert.equal(await page.getByRole('button', { name: 'Simpan rekap terpisah', exact: true }).isDisabled(), true);
          assert.equal(await page.getByLabel('Penerima unik (N)', { exact: true }).isDisabled(), true);
          await forceSubmit(page);
          await page.getByRole('alert').filter({ hasText: /Rekap parsial tidak dapat diubah/ }).waitFor();
          await noWrites(page);
        }
        await month.selectOption('12');
        await openEditor(page);
        await page.locator('form').getByText(await page.evaluate(() => window.annualFixture.instruction), { exact: true }).waitFor();
        assert.equal(await page.getByRole('button', { name: 'Simpan rekap terpisah', exact: true }).isDisabled(), true);
        await forceSubmit(page);
        await noWrites(page);
        await fillRecap(page);
        for (const label of ['Penerima unik (N)', 'Sasaran tahunan (D)']) {
          const input = page.getByLabel(label, { exact: true });
          await input.fill('1.5');
          assert.equal(await input.evaluate(el => el.validity.stepMismatch), true);
          await forceSubmit(page);
          await page.getByRole('alert').filter({ hasText: /bilangan bulat/ }).waitFor();
          await noWrites(page);
          await input.fill(label.startsWith('Penerima') ? '80' : '100');
        }
        await page.getByRole('textbox', { name: 'Sumber dan cara menyusun rekap (wajib)', exact: true }).fill('   ');
        await forceSubmit(page);
        await page.getByRole('alert').filter({ hasText: /catatan sumber/ }).waitFor();
        await noWrites(page);
        await fillRecap(page);
        await page.getByRole('button', { name: 'Simpan rekap terpisah', exact: true }).click();
        await page.getByRole('status').filter({ hasText: 'Rekap terpisah tersimpan.' }).waitFor();
        const writes = await page.evaluate(() => window.annualFixture.writes);
        assert.deepEqual(writes, [{ kind: 'recap', value: { year: 2026, endMonth: 12, indicatorId: 'annual',
          numerator: 80, denominator: 100, notes: 'Register Januari-Desember 2026; ANC K1 murni <=12 minggu, orang unik tanpa duplikasi.', confirmed: true, expectedRevision: 0 } }]);
        const result = page.getByRole('region', { name: 'Hasil rekap indikator' });
        assert.equal(await result.locator('dd').nth(2).innerText(), '80%');
        assert.equal(await result.locator('dd').nth(3).innerText(), '-');
      }));
    }

    for (const indicatorId of ['K5-R38', 'K1-R40', 'K2-R44', 'K1-R39', 'K4-R16', 'K4-R20']) {
      for (const role of ['ADMIN_PUSKESMAS', 'PIC']) {
        for (const month of [3, 12]) {
          await t.test(`${role} cannot write/upload structured ${indicatorId} monthly with missing metadata flags in month ${month}`, () => fixture({ indicatorId, role, month, view: 'monthly' }, async page => {
            await page.getByRole('dialog', { name: 'Input DO 2026', exact: true }).waitFor();
            assert.equal(await page.getByRole('button', { name: 'Simpan', exact: true }).isDisabled(), true);
            assert.equal(await page.getByLabel('Lampirkan bukti dukung', { exact: true }).isDisabled(), true);
            await forceSubmit(page);
            await page.getByRole('alert').filter({ hasText: /Input V2 bulanan tidak tersedia/ }).waitFor();
            await noWrites(page);
          }));
        }
      }
      await t.test(`${indicatorId} identity guard preserves V1 editing and reversible conversion`, () => fixture({ indicatorId, view: 'monthly', legacy: true }, async page => {
        await page.getByLabel('Realisasi V1', { exact: true }).fill('7');
        await page.getByRole('checkbox').check();
        assert.equal(await page.getByRole('button', { name: 'Simpan dan konversi', exact: true }).isDisabled(), true);
        await forceSubmit(page);
        await noWrites(page);
        await page.getByRole('checkbox').uncheck();
        assert.equal(await page.getByLabel('Realisasi V1', { exact: true }).inputValue(), '7');
        await page.getByRole('button', { name: 'Simpan', exact: true }).click();
        assert.deepEqual(await page.evaluate(() => window.annualFixture.writes), [
          { kind: 'monthly', args: [indicatorId, 3, { pencapaianRiil: 7, notes: 'Sumber tersimpan' }, 2026] },
        ]);
      }));
    }

    await t.test('annual V1 stays editable and conversion can be cancelled without losing evidence', () => fixture({ view: 'monthly', legacy: true }, async page => {
      const convert = page.getByRole('checkbox');
      await page.getByLabel('Realisasi V1', { exact: true }).fill('7');
      await page.getByLabel('Lampirkan bukti dukung', { exact: true }).setInputFiles({ name: 'fixture.txt.pdf', mimeType: 'application/pdf', buffer: Buffer.from('fixture') });
      await convert.check();
      assert.equal(await page.getByRole('button', { name: 'Simpan dan konversi', exact: true }).isDisabled(), true);
      assert.equal(await convert.isEnabled(), true);
      await forceSubmit(page);
      await page.getByRole('alert').waitFor();
      await noWrites(page);
      await convert.uncheck();
      assert.equal(await page.getByLabel('Realisasi V1', { exact: true }).inputValue(), '7');
      await page.getByText('Bukti dipilih: fixture.txt.pdf', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'Simpan', exact: true }).click();
      await page.waitForFunction(() => window.annualFixture.writes.length === 1);
      assert.deepEqual(await page.evaluate(() => window.annualFixture.writes), [{ kind: 'monthly', args: ['annual', 3,
        { pencapaianRiil: 7, notes: 'Sumber tersimpan', evidenceId: 'uploaded' }, 2026] }]);
    }));

    for (const view of ['monthly', 'editor']) {
      await t.test(view + ' revalidates live annual metadata before upload/write and retains its draft', () => fixture({ view, annual: false }, async page => {
        if (view === 'editor') { await openEditor(page); await fillRecap(page); }
        else {
          await page.getByLabel('Penerima unik (N)', { exact: true }).fill('80');
          await page.getByLabel('Lampirkan bukti dukung', { exact: true }).setInputFiles({ name: 'pending.pdf', mimeType: 'application/pdf', buffer: Buffer.from('fixture') });
        }
        // Change live store without rendering: submit must not trust stale props/disabled UI alone.
        await page.evaluate(() => window.annualFixture.configure({ annual: true }, false));
        await forceSubmit(page);
        await page.getByRole('alert').filter({ hasText: /hanya menerima rekap tahunan/ }).waitFor();
        await noWrites(page);
        await page.evaluate(() => window.annualFixture.render());
        assert.equal(await page.getByLabel('Penerima unik (N)', { exact: true }).isDisabled(), true);
        assert.equal(await page.getByLabel('Penerima unik (N)', { exact: true }).inputValue(), '80');
        if (view === 'monthly') await page.getByText('Bukti dipilih: pending.pdf', { exact: true }).waitFor();
        else assert.equal(await page.getByRole('checkbox').isChecked(), true);
      }));
    }

    await t.test('monthly save revalidates annual metadata after an already-started upload', () => fixture({ view: 'monthly', annual: false, pauseUpload: true }, async page => {
      await page.getByLabel('Penerima unik (N)', { exact: true }).fill('80');
      await page.getByLabel('Lampirkan bukti dukung', { exact: true }).setInputFiles({ name: 'pending.pdf', mimeType: 'application/pdf', buffer: Buffer.from('fixture') });
      await page.getByRole('button', { name: 'Simpan', exact: true }).click();
      await page.waitForFunction(() => window.annualFixture.uploads.length === 1);
      await page.evaluate(() => {
        window.annualFixture.configure({ annual: true });
        window.annualFixture.resumeUpload();
      });
      await page.getByRole('alert').filter({ hasText: /Input V2 bulanan tidak tersedia/ }).waitFor();
      assert.deepEqual(await page.evaluate(() => window.annualFixture.writes), []);
      assert.equal(await page.getByRole('button', { name: 'Simpan', exact: true }).isDisabled(), true);
      assert.equal(await page.getByLabel('Penerima unik (N)', { exact: true }).inputValue(), '80');
      await page.getByText('Bukti dipilih: pending.pdf', { exact: true }).waitFor();
    }));

    await t.test('annual month navigation asks before discarding and existing omitted flags permit partial recaps', () => fixture({ month: 12 }, async page => {
      await openEditor(page, true);
      await fillRecap(page);
      page.once('dialog', dialog => dialog.dismiss());
      await page.getByLabel('Akhir periode rekap').selectOption('11');
      assert.equal(await page.getByLabel('Akhir periode rekap').inputValue(), '12');
      assert.equal(await page.getByLabel('Penerima unik (N)', { exact: true }).inputValue(), '80');
      page.once('dialog', dialog => dialog.accept());
      await page.getByLabel('Akhir periode rekap').selectOption('11');
      await openEditor(page);
      assert.equal(await page.getByLabel('Akhir periode rekap').inputValue(), '11');
      assert.equal(await page.getByLabel('Penerima unik (N)', { exact: true }).isDisabled(), true);
      await page.getByLabel(/^Indikator \(/).selectOption('existing');
      await openEditor(page);
      assert.equal(await page.getByLabel('Penerima unik (N)', { exact: true }).isEnabled(), true);
      await fillRecap(page);
      await page.getByRole('button', { name: 'Simpan rekap terpisah', exact: true }).click();
      await page.getByRole('status').filter({ hasText: 'Rekap terpisah tersimpan.' }).waitFor();
      assert.equal(await page.evaluate(() => window.annualFixture.writes[0].value.endMonth), 11);
      assert.equal(await page.evaluate(() => window.annualFixture.writes[0].value.indicatorId), 'existing');
    }));

    for (const change of [
      { lockedMonths: [1] }, { active: false }, { year: 2025 },
      { center: 'other-center' }, { role: 'DINKES_ADMIN' }, { assigned: false },
    ]) {
      await t.test('annual recap keeps live scope/permission guard ' + JSON.stringify(change), () => fixture({ view: 'editor', role: 'PIC', endMonth: 12 }, async page => {
        await openEditor(page);
        await fillRecap(page);
        await page.evaluate(change => window.annualFixture.configure(change), change);
        assert.equal(await page.getByRole('button', { name: 'Simpan rekap terpisah', exact: true }).isDisabled(), true);
        assert.equal(await page.getByLabel('Penerima unik (N)', { exact: true }).inputValue(), '80');
        await forceSubmit(page);
        await page.getByRole('alert').waitFor();
        await noWrites(page);
      }));
    }

    await t.test('definition distinguishes measurement from score and held profiles retain precise reasons', () => fixture({ held: true, month: 12 }, async page => {
      await page.getByText('Rekap Kumulatif & Tahunan', { exact: true }).click();
      await page.getByText('Input rekap belum diaktifkan untuk profil ini. Tidak memakai rumus lama sebagai pengganti.', { exact: true }).waitFor();
      await page.getByText('Definisi Operasional', { exact: false }).click();
      await page.getByText('Kelayakan kohort belum dapat dipastikan dari sumber.', { exact: true }).waitFor();
      await noWrites(page);
      await page.evaluate(() => window.annualFixture.render({ held: false }));
      await page.getByRole('button', { name: 'Muat ulang rekap', exact: true }).click();
      await page.getByText('Definisi Operasional', { exact: false }).click();
      await page.getByText('Profil pengukuran tersedia sesuai periode dan ketentuan DO. Pengukuran atau ketercapaian target tidak selalu disertai skor kinerja.', { exact: true }).waitFor();
    }));
  } finally {
    await browser?.close();
    await server?.close();
    await rm(cacheDir, { recursive: true, force: true });
  }
});
