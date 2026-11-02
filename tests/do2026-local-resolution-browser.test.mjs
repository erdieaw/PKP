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
const { stdout } = await promisify(execFile)(process.execPath, ['--import', 'tsx', '../tests/local-resolution-browser-fixtures.ts'], { cwd: root + '/backend', maxBuffer: 32 * 1024 * 1024 });
const rows = JSON.parse(stdout);
assert.equal(rows.length, 28);

const storeSource = `
const listeners = new Set(); let revision = 0, release, sessionUser;
export const rows = ${JSON.stringify(rows)};
export const state = { index: 0, mode: 'local', view: 'editor', year: 2026, center: 'fixture-center', role: 'ADMIN_PUSKESMAS', session: true,
 userId: 'fixture-user', active: true, assigned: true, lockedMonths: [], mutating: false, pauseSave: false, failSave: false };
export const writes = [], pending = []; export let savedCalls = 0;
export class ApiError extends Error {}
export function configure(options = {}) { Object.assign(state, options); revision++; listeners.forEach(fn => fn()); }
export function profile() { return state.profile ?? rows[state.index].profile; }
export function indicator() { return { id: rows[state.index].id, indikator: 'Indikator solusi lokal', do2026: profile() }; }
export function item() { const row = rows[state.index], result = state.result ?? (state.mode === 'old' ? row.oldExpected : row.expected);
 const payload = state.payload ?? (state.mode === 'old' ? row.oldInput : row.input);
 return { ...result, indicatorId: row.id, indicator: indicator(), numerator: state.mode === 'new' ? null : row.expected.numerator,
 denominator: state.mode === 'new' ? null : row.expected.denominator, dataComplete: result.measurementValue !== null, scoreComplete: false,
 availableMonths: [], missingMonths: [], recapRevision: state.mode === 'new' ? 0 : 2, recapNotes: state.mode === 'new' ? '' : 'Catatan sumber QA',
 recapStructuredInput: state.mode === 'new' ? null : payload, aggregationMethod: 'EXPLICIT_SOURCE_ASSESSMENT', ...state.saved }; }
export const pkpStore = {
 subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); }, getSnapshot: () => revision, getServerSnapshot: () => revision,
 getSessionUser: () => { if (!state.session) return null;
 if (sessionUser?.id !== state.userId || sessionUser?.role !== state.role) sessionUser = { id: state.userId, role: state.role, healthCenterId: 'fixture-center' }; return sessionUser; },
 getCurrentYear: () => state.year, getSelectedHealthCenterId: () => state.center, getSelectedHealthCenter: () => ({ name: 'Puskesmas QA' }),
 getLoadState: () => ({ loading: false, error: null }), getActivePeriod: () => ({ year: state.year }),
 isActiveYear: year => state.active && year === state.year, canInputOwnPeriod: year => state.active && year === state.year && state.center === 'fixture-center',
 isPeriodLocked: (_year, month) => state.lockedMonths.includes(month), isMutating: () => state.mutating,
 getAssignments: () => state.assigned ? { [indicator().id]: 'fixture-user' } : {}, getIndicators: () => state.missing ? [] : [indicator()],
 savePeriodRecap: async value => { writes.push(structuredClone(value)); if (state.pauseSave) await new Promise(resolve => { release = resolve; });
 if (state.failSave) throw new Error('Konflik revisi 409; muat ulang');
 const response = await fetch('/api/v1/records/period-recaps', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
 const saved = await response.json(); state.saved = { numerator: saved.numerator, denominator: saved.denominator, recapStructuredInput: saved.structuredInput,
 recapNotes: saved.notes, recapRevision: saved.expectedRevision + 1 }; },
};
export const api = { request: async path => { if (path.startsWith('/analytics/period-recap?')) return { items: [item()] }; throw new Error('Unexpected API ' + path); } };
export function resume() { release?.(); }
export function onSaved() { savedCalls++; }
`;
const entrySource = `
import React from 'react'; import { createRoot } from 'react-dom/client';
import { RecapEditor } from '/src/components/data-entry/recap-editor.tsx';
import { PeriodRecapPanel } from '/src/components/data-entry/PeriodRecapPanel.tsx';
import { confirmDiscardChanges } from '/src/components/common/useUnsavedChanges.ts';
import * as validation from '/src/services/sourceAssessment.ts';
import { rows, state, configure, profile, item, writes, pending, resume, onSaved, savedCalls } from 'virtual:local-store';
import '/src/index.css';
const root = createRoot(document.getElementById('root')); let key = 0;
function render(remount = false) { if (remount) key++;
 root.render(state.view === 'panel' ? React.createElement(PeriodRecapPanel, { key, year: 2026, month: rows[state.index].endMonth })
 : React.createElement(RecapEditor, { key, item: item(), profile: profile(), year: 2026, endMonth: rows[state.index].endMonth,
 healthCenterId: 'fixture-center', readOnlyReason: null, onPendingChange: value => pending.push(value), onSaved })); }
window.localFixture = { rows, state, configure, validation, writes, pending, resume, savedCalls: () => savedCalls,
 mount: options => { configure(options); render(true); }, rerender: options => { configure(options); render(); },
 unmount: () => root.render(null), discard: () => confirmDiscardChanges('recap') };
`;

test('28 descriptor-driven local resolutions: strict parity and real forms', async t => {
  const cacheDir = await mkdtemp('/tmp/opencode/local-resolution-vite-');
  const received = []; let server, browser;
  try {
    server = await createServer({ root, configFile: false, envFile: false, cacheDir,
      plugins: [{ name: 'local-resolution-fixture', enforce: 'pre', resolveId(id) {
        if (id === '/local-fixture.jsx') return '\0local-fixture.jsx';
        if (id === 'virtual:local-store' || /(?:^|\/)(?:apiStore|apiClient)(?:\.ts)?$/.test(id)) return '\0local-store';
      }, load(id) { if (id === '\0local-fixture.jsx') return entrySource; if (id === '\0local-store') return storeSource; },
      configureServer(vite) {
        vite.middlewares.use('/local-test', async (_req, res) => { res.setHeader('Content-Type', 'text/html');
          res.end(await vite.transformIndexHtml('/local-test', '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/local-fixture.jsx"></script></body></html>')); });
        vite.middlewares.use('/api/v1/records/period-recaps', async (req, res) => { let body = ''; for await (const chunk of req) body += chunk;
          const input = JSON.parse(body); received.push(input); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(input)); });
      } }, react()], server: { host: '127.0.0.1', port: 0 },
      optimizeDeps: { noDiscovery: true, include: ['react', 'react-dom/client', 'react/jsx-dev-runtime', 'lucide-react'] },
    });
    await server.listen(); browser = await chromium.launch({ headless: true });
    const origin = new URL(server.resolvedUrls.local[0]).origin;
    async function pageFixture(run, width = 375) {
      const page = await browser.newPage({ viewport: { width, height: 900 } }); page.setDefaultTimeout(10000);
      const errors = [], external = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', route => { if (new URL(route.request().url()).origin !== origin) { external.push(route.request().url()); return route.abort(); } return route.continue(); });
      try { await page.goto(origin + '/local-test'); await page.waitForFunction(() => window.localFixture);
        await run(page); assert.deepEqual(errors, []); assert.deepEqual(external, []);
        await assertFits(page);
      } finally { await page.close(); }
    }
    async function mount(page, options = {}) {
      await page.evaluate(options => window.localFixture.mount({ view: 'editor', saved: undefined, payload: undefined, profile: undefined, result: undefined, ...options }), options);
      if (options.view === 'panel') await page.getByText('Rekap Kumulatif & Tahunan', { exact: true }).click();
      await page.getByText('Isi atau perbarui rekap terpisah', { exact: true }).click();
    }
    const save = page => page.getByRole('button', { name: /^(Simpan rekap terpisah|Menyimpan rekap\.\.\.)$/ });
    const confirm = page => page.getByRole('checkbox', { name: /^Saya mengonfirmasi pencatatan/ }).check();
    const optIn = page => page.getByRole('checkbox', { name: /^Saya menerima solusi lokal ini/ });
    const localGroup = page => page.getByRole('group', { name: 'Solusi lokal opsional', exact: true });
    const submit = page => page.locator('form').evaluate(form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    const byId = id => rows.findIndex(row => row.id === id);
    async function assertFits(page) {
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth ? [] : [{ viewport: innerWidth, width: document.documentElement.scrollWidth }, ...[...document.querySelectorAll('body *')]
        .filter(element => element.scrollWidth > innerWidth + 1)
        .map(element => ({ tag: element.tagName, class: element.className, text: element.textContent?.slice(0, 100), width: element.getBoundingClientRect().width, scrollWidth: element.scrollWidth })).slice(-8)]);
      assert.deepEqual(overflow, []);
    }
    async function waitSaved(page, previous) { await page.waitForFunction(previous => window.localFixture.savedCalls() > previous, previous); }

    await pageFixture(async page => {
      for (const [index, row] of rows.entries()) await t.test(`${row.id}: ${row.cases.length} backend-oracle valid/invalid/incomplete cases`, async () => {
        const mismatches = await page.evaluate(index => {
          const { rows, validation } = window.localFixture, row = rows[index], mismatches = [];
          validation.assertSourceIdentity(row.profile, row.id);
          for (const scenario of [{ name: 'positive', input: row.input, accepted: true }, { name: 'legacy exact', input: row.oldInput, accepted: true }, ...row.cases]) {
            let accepted = false, message;
            const month = Number(scenario.input.period.cutoffDate.slice(5, 7));
            const before = JSON.stringify(scenario.input);
            try { validation.validateSourceAssessment(scenario.input, row.descriptor, 2026, month); accepted = true; } catch (error) { message = error.message; }
            if (accepted !== scenario.accepted || before !== JSON.stringify(scenario.input)) mismatches.push({ name: scenario.name, accepted, expected: scenario.accepted, message });
            if (accepted && JSON.stringify(validation.parseSourceAssessmentDraft(scenario.input, row.descriptor, 2026, month)) !== before) mismatches.push({ name: scenario.name, problem: 'parser changed payload' });
          }
          const draft = validation.createSourceAssessmentDraft(row.descriptor, 2026, row.endMonth);
          if ('localResolution' in draft) mismatches.push({ problem: 'default opt-in' });
          return mismatches;
        }, index);
        assert.deepEqual(mismatches, []);
      });
    }, 1280);

    await pageFixture(async page => {
      for (const [index, row] of rows.entries()) await t.test(`${row.id}: real form opt-in, all input types, save and read, opt-out preserves exact source`, async () => {
        await mount(page, { index, mode: 'old' });
        assert.equal(await optIn(page).isChecked(), false);
        await optIn(page).check();
        assert.equal(await page.getByLabel('Referensi penerimaan solusi lokal', { exact: true }).inputValue(), '');
        assert.equal(await save(page).isDisabled(), true);
        await page.getByLabel('Referensi penerimaan solusi lokal', { exact: true }).fill(row.input.localResolution.acceptanceReference);
        await page.getByLabel('Referensi kebijakan pengukuran lokal', { exact: true }).fill(row.input.localResolution.measurementPolicyReference);
        await page.getByLabel('Referensi otoritas keputusan lokal (bukan pengesahan sumber)', { exact: true }).fill(row.input.localResolution.correctionAuthorityReference);
        const evidence = localGroup(page).getByLabel(/^Bukti lokal:/);
        assert.equal(await evidence.count(), row.descriptor.localResolution.requiredReferences.length);
        for (const [i, key] of row.descriptor.localResolution.requiredReferences.entries()) await evidence.nth(i).fill(row.input.localResolution.references[key]);
        if (row.descriptor.localResolution.periodPolicy === 'MONTH') await page.getByLabel('Referensi periode bulanan lokal', { exact: true }).fill(row.input.localResolution.period.reference);
        for (const metric of row.descriptor.localResolution.metrics) {
          if (metric.derivedFrom) { assert.equal(await localGroup(page).getByRole('group', { name: `Metrik lokal: ${metric.label}`, exact: true }).count(), 0); continue; }
          const group = localGroup(page).getByRole('group', { name: `Metrik lokal: ${metric.label}`, exact: true });
          const value = row.input.localResolution.metrics[metric.key];
          await group.getByLabel('Status observasi lokal', { exact: true }).selectOption('OBSERVED');
          if (metric.type === 'BOOLEAN') await group.getByLabel('Hasil observasi lokal', { exact: true }).selectOption(String(value.satisfied));
          else if (metric.type === 'COUNT') await group.getByLabel('Jumlah lokal', { exact: true }).fill(String(value.count));
          else {
            await group.getByLabel(metric.numeratorLabel, { exact: true }).fill(String(value.numerator));
            await group.getByLabel(metric.denominatorLabel, { exact: true }).fill(String(value.denominator));
            if (metric.type === 'POPULATION_RATIO') {
              await group.getByLabel('Populasi lokal dasar estimasi', { exact: true }).fill(String(value.population));
              await group.getByLabel('Prevalensi lokal (%)', { exact: true }).fill(String(value.prevalencePercent));
              await group.getByLabel('Referensi populasi lokal', { exact: true }).fill(value.populationReference);
              await group.getByLabel('Referensi prevalensi lokal', { exact: true }).fill(value.prevalenceReference);
            }
          }
        }
        const target = page.getByLabel('Pilih kandidat target lokal secara eksplisit', { exact: true });
        if (await target.count()) assert.equal(await target.inputValue(), '');
        await confirm(page); assert.equal(await save(page).isEnabled(), true);
        let previous = await page.evaluate(() => window.localFixture.savedCalls());
        let count = received.length; await save(page).click(); await waitSaved(page, previous);
        assert.equal(received.length, count + 1);
        assert.deepEqual(received.at(-1).structuredInput, row.input);
        assert.equal(received.at(-1).expectedRevision, 2);
        assert.equal(received.at(-1).numerator, row.expected.numerator);
        assert.equal(received.at(-1).denominator, row.expected.denominator);
        const saved = await page.evaluate(() => window.localFixture.state.saved);
        await mount(page, { index, mode: 'local', view: 'panel', saved });
        assert.equal(await optIn(page).isChecked(), true);
        const results = page.getByRole('region', { name: 'Hasil solusi lokal', exact: true });
        assert.equal(await results.count(), 1);
        assert.equal(await results.getByText(/Target alternatif lokal: Tidak dipilih/).count(), 1);
        assert.equal(await results.getByText(/Target sumber asli \(tidak diwariskan\)/).count(), 1);
        assert.equal(await results.getByText(/Konflik sumber tetap SOURCE_UNRESOLVED/).count(), 1);
        assert.equal(await results.getByText(/USER_ATTESTED_NOT_EXTERNALLY_VERIFIED/).count(), 1);
        for (const metric of row.expected.localResolutionResult.metrics) {
          const output = results.getByLabel(`Hasil lokal: ${metric.label}`, { exact: true });
          assert.equal((await output.textContent()).includes(`(${metric.status})`), true);
        }
        if (row.id === 'K5-R17') assert.equal(await results.getByText(/Ketepatan waktu consent belum dinilai \(NOT_ASSESSED\)/).count(), 1);
        await optIn(page).uncheck(); await confirm(page);
        count = received.length;
        await save(page).click(); await page.getByText('Rekap terpisah tersimpan. Hasil telah dimuat ulang dari server.', { exact: true }).waitFor();
        assert.equal(received.length, count + 1);
        assert.deepEqual(received.at(-1).structuredInput, row.oldInput);
        assert.equal(received.at(-1).expectedRevision, 3);
        await assertFits(page);
        // Leave no panel state behind when reusing the page for the next profile.
        await page.evaluate(() => window.localFixture.configure({ view: 'editor' }));
      });
    });

    await pageFixture(async page => {
      for (const [index, row] of rows.entries()) await t.test(`${row.id}: null incomplete save and malformed saved JSON protection`, async () => {
        const scenario = row.cases.find(entry => entry.name === 'all metrics null');
        await mount(page, { index, mode: 'local', payload: scenario.input, result: scenario.result }); await confirm(page);
        assert.equal(await save(page).isEnabled(), true);
        const previous = await page.evaluate(() => window.localFixture.savedCalls());
        await save(page).click(); await waitSaved(page, previous);
        assert.deepEqual(received.at(-1).structuredInput, scenario.input);
        const payload = structuredClone(row.input); payload.localResolution.futureField = { preserve: true };
        const count = received.length;
        await mount(page, { index, payload }); await submit(page);
        assert.equal(await save(page).isDisabled(), true);
        assert.deepEqual(await page.evaluate(() => window.localFixture.state.payload), payload);
        assert.equal(received.length, count);
      });
    });

    for (const id of ['K5-R13', 'K5-R14', 'K5-R27']) await t.test(`${id}: null anchor still enforces sibling denominator group in real form`, () => pageFixture(async page => {
      const index = byId(id), row = rows[index];
      const valid = row.cases.find(entry => entry.name === 'null anchor: matching sibling denominators');
      const invalid = row.cases.find(entry => entry.name === 'null anchor: different sibling denominators');
      const sibling = row.descriptor.localResolution.metrics.find(metric => metric.sameDenominatorAs);
      await mount(page, { index, payload: valid.input, result: valid.result }); await confirm(page);
      assert.equal(await save(page).isEnabled(), true);
      const group = localGroup(page).getByRole('group', { name: `Metrik lokal: ${sibling.label}`, exact: true });
      const denominator = group.getByLabel(sibling.denominatorLabel, { exact: true });
      await denominator.fill('20'); await submit(page);
      assert.equal(await save(page).isDisabled(), true);
      assert.equal(await denominator.inputValue(), '20');
      assert.deepEqual(await page.evaluate(() => window.localFixture.writes), []);
      await denominator.fill('10');
      assert.equal(await save(page).isEnabled(), true);
      const previous = await page.evaluate(() => window.localFixture.savedCalls());
      await save(page).click(); await waitSaved(page, previous);
      assert.deepEqual(received.at(-1).structuredInput, valid.input);
      const count = received.length;
      await mount(page, { index, payload: invalid.input }); await submit(page);
      assert.equal(await save(page).isDisabled(), true);
      assert.deepEqual(await page.evaluate(() => window.localFixture.state.payload), invalid.input);
      assert.equal(received.length, count);
    }));

    for (const [name, options] of [
      ['year', { year: 2027 }], ['tenant', { center: 'other' }], ['session', { session: false }], ['Dinkes', { role: 'DINKES' }],
      ['active year', { active: false }], ['January storage lock', { lockedMonths: [1] }], ['end month lock', { lockedMonths: [12] }],
      ['PIC assignment', { role: 'PIC', assigned: false }], ['actor', { userId: 'different-user' }], ['missing metadata', { missing: true }],
      ['authorized role changed', { role: 'PIC' }], ['mutation pending elsewhere', { mutating: true }],
    ]) await t.test(`local draft live guard: ${name}`, () => pageFixture(async page => {
      await mount(page, { index: byId('K1-R10') });
      await page.getByLabel('Referensi penerimaan solusi lokal', { exact: true }).fill('Draft lokal tidak hilang'); await confirm(page);
      await page.evaluate(options => window.localFixture.configure(options), options); await submit(page);
      assert.equal(await save(page).isDisabled(), true);
      assert.equal(await page.getByLabel('Referensi penerimaan solusi lokal', { exact: true }).inputValue(), 'Draft lokal tidak hilang');
      assert.deepEqual(await page.evaluate(() => window.localFixture.writes), []);
    }));

    for (const [name, change] of [
      ['local version', profile => { profile.sourceAssessment.localResolution.contractVersion = 'FUTURE'; profile.localResolution.contractVersion = 'FUTURE'; }],
      ['local descriptor drift', profile => { profile.sourceAssessment.localResolution.metrics[0].label = 'Changed'; }],
      ['local primary drift', profile => { profile.localResolution.primaryMetricKey = 'unknown'; }],
      ['local removed', profile => { delete profile.localResolution; delete profile.sourceAssessment.localResolution; }],
    ]) await t.test(`local draft metadata guard: ${name}`, () => pageFixture(async page => {
      await mount(page, { index: byId('K1-R10') }); await confirm(page);
      const profile = structuredClone(rows[byId('K1-R10')].profile); change(profile);
      await page.evaluate(profile => window.localFixture.configure({ profile }), profile); await submit(page);
      assert.equal(await save(page).isDisabled(), true);
      assert.equal(await optIn(page).isChecked(), true);
      assert.deepEqual(await page.evaluate(() => window.localFixture.writes), []);
    }));

    await t.test('optimistic revision and changed saved payload retain local draft', () => pageFixture(async page => {
      await mount(page, { index: byId('K1-R10') }); await confirm(page);
      await page.getByLabel('Referensi penerimaan solusi lokal', { exact: true }).fill('Draft revisi lokal');
      await page.evaluate(() => window.localFixture.rerender({ saved: { recapRevision: 3 } })); await submit(page);
      assert.equal(await save(page).isDisabled(), true);
      assert.equal(await page.getByLabel('Referensi penerimaan solusi lokal', { exact: true }).inputValue(), 'Draft revisi lokal');
      assert.deepEqual(await page.evaluate(() => window.localFixture.writes), []);
    }));

    await t.test('409 failure preserves every local field and does not retry', () => pageFixture(async page => {
      await mount(page, { index: byId('K1-R10'), failSave: true }); await confirm(page);
      await page.getByLabel('Referensi penerimaan solusi lokal', { exact: true }).fill('Draft saat konflik');
      await save(page).click(); await page.getByRole('alert').filter({ hasText: /Konflik revisi/ }).waitFor();
      assert.equal(await page.getByLabel('Referensi penerimaan solusi lokal', { exact: true }).inputValue(), 'Draft saat konflik');
      assert.equal(await optIn(page).isChecked(), true);
      assert.equal(await page.evaluate(() => window.localFixture.writes.length), 1);
      assert.equal(await page.evaluate(() => window.localFixture.savedCalls()), 0);
    }));

    await t.test('in-flight duplicate and unmount response are guarded', () => pageFixture(async page => {
      await mount(page, { index: byId('K1-R10'), pauseSave: true }); await confirm(page); await save(page).click(); await submit(page);
      assert.equal(await page.evaluate(() => window.localFixture.writes.length), 1);
      await page.evaluate(() => window.localFixture.unmount()); await page.evaluate(() => window.localFixture.resume());
      await page.waitForFunction(() => !!window.localFixture.state.saved);
      assert.equal(await page.evaluate(() => window.localFixture.savedCalls()), 0);
      assert.equal((await page.evaluate(() => window.localFixture.pending)).at(-1), false);
    }));

    await t.test('local dirty tracking: decline close preserves draft; accept discards to saved baseline', () => pageFixture(async page => {
      await mount(page, { index: byId('K1-R10') });
      await page.getByLabel('Referensi penerimaan solusi lokal', { exact: true }).fill('Draft lokal dirty');
      page.once('dialog', dialog => dialog.dismiss()); await page.getByText('Isi atau perbarui rekap terpisah', { exact: true }).click();
      assert.equal(await page.getByLabel('Referensi penerimaan solusi lokal', { exact: true }).inputValue(), 'Draft lokal dirty');
      page.once('dialog', dialog => dialog.accept()); await page.getByText('Isi atau perbarui rekap terpisah', { exact: true }).click();
      await page.getByText('Isi atau perbarui rekap terpisah', { exact: true }).click();
      assert.equal(await page.getByLabel('Referensi penerimaan solusi lokal', { exact: true }).inputValue(), rows[byId('K1-R10')].input.localResolution.acceptanceReference);
      assert.deepEqual(await page.evaluate(() => window.localFixture.writes), []);
    }));

    await t.test('scope binding follows source edits without fabricating references or target policy', () => pageFixture(async page => {
      const index = byId('K4-R29'); await mount(page, { index });
      await page.getByLabel('Referensi wilayah penilaian', { exact: true }).fill('Wilayah baru');
      await page.getByLabel('Referensi penetapan periode dan cutoff', { exact: true }).fill('Periode sumber baru');
      await page.getByLabel('Tanggal cutoff penilaian', { exact: true }).fill('2026-11-30');
      assert.equal(await localGroup(page).getByText(/2026-11-01 sampai 2026-11-30/).count(), 1);
      assert.equal(await page.getByLabel('Referensi periode bulanan lokal', { exact: true }).inputValue(), rows[index].input.localResolution.period.reference);
      assert.equal(await localGroup(page).getByText(/wilayah: Wilayah baru/).count(), 1);
      await confirm(page); assert.equal(await save(page).isDisabled(), true, 'new cutoff is outside storage slot');
      await page.getByLabel('Tanggal cutoff penilaian', { exact: true }).fill('2026-12-31');
      const previous = await page.evaluate(() => window.localFixture.savedCalls()); await save(page).click(); await waitSaved(page, previous);
      const payload = received.at(-1).structuredInput;
      assert.deepEqual(payload.localResolution.sourcePeriod, payload.period);
      assert.equal(payload.localResolution.territoryReference, payload.provenance.territoryReference);
      assert.deepEqual(payload.localResolution.references, rows[index].input.localResolution.references);
      assert.equal('targetPolicy' in payload.localResolution, false);
    }));

    for (const id of ['K1-R10', 'K2-R32', 'K3-R19', 'K5-R13', 'K5-R14', 'K5-R27', 'K5-R28']) await t.test(`${id}: explicit candidate target, no implicit inheritance, removable policy`, () => pageFixture(async page => {
      const index = byId(id), row = rows[index], candidate = row.descriptor.localResolution.metrics.find(metric => metric.targetValue !== undefined);
      await mount(page, { index }); await confirm(page);
      const target = page.getByLabel('Pilih kandidat target lokal secara eksplisit', { exact: true });
      assert.equal(await target.inputValue(), '');
      await target.selectOption(candidate.key); assert.equal(await save(page).isDisabled(), true);
      await page.getByLabel('Referensi penetapan target alternatif lokal', { exact: true }).fill('Target alternatif QA');
      const previous = await page.evaluate(() => window.localFixture.savedCalls()); await save(page).click(); await waitSaved(page, previous);
      assert.deepEqual(received.at(-1).structuredInput.localResolution.targetPolicy, { metricKey: candidate.key, value: candidate.targetValue, reference: 'Target alternatif QA' });
      await target.selectOption('');
      assert.equal(await page.getByLabel('Referensi penetapan target alternatif lokal', { exact: true }).count(), 0);
    }));

    for (const name of ['source INCOMPLETE', 'source NOT_YET_DUE', 'source NOT_APPLICABLE', 'all metrics null', 'all ratio denominators zero']) await t.test(`local result status: ${name}`, () => pageFixture(async page => {
      const index = byId('K1-R10'), scenario = rows[index].cases.find(entry => entry.name === name);
      await mount(page, { index, view: 'panel', payload: scenario.input, result: scenario.result });
      const results = page.getByRole('region', { name: 'Hasil solusi lokal', exact: true });
      for (const metric of scenario.result.localResolutionResult.metrics) {
        const output = results.getByLabel(`Hasil lokal: ${metric.label}`, { exact: true });
        assert.equal((await output.textContent()).includes(`(${metric.status})`), true);
        assert.equal((await output.textContent()).includes('Tidak ada nilai'), true);
        assert.equal((await output.textContent()).includes('Tidak dinilai'), true);
      }
    }));

    await t.test('scope mismatch result never presents numeric local measurement or target success', () => pageFixture(async page => {
      const index = byId('K5-R27'), result = structuredClone(rows[index].expected);
      result.measurementValue = null; result.status = 'ASSESSMENT_SCOPE_MISMATCH';
      for (const metric of result.localResolutionResult.metrics) Object.assign(metric, { value: null, targetMet: null, status: 'ASSESSMENT_SCOPE_MISMATCH' });
      await mount(page, { index, view: 'panel', result });
      const output = page.getByRole('region', { name: 'Hasil solusi lokal', exact: true });
      assert.equal(await output.getByText(/Tidak ada nilai; Lingkup laporan tidak sesuai/).count(), result.localResolutionResult.metrics.length);
      assert.equal(await output.getByText(/Bukan hasil tahunan; tidak digabung antarbulan/).count(), 1);
    }));
  } finally {
    await browser?.close(); await server?.close(); await rm(cacheDir, { recursive: true, force: true });
  }
});
