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
const { stdout } = await promisify(execFile)(process.execPath, ['--import', 'tsx', '../tests/source-assessment-browser-fixtures.ts'], { cwd: root + '/backend', maxBuffer: 16 * 1024 * 1024 });
const rows = JSON.parse(stdout);
assert.equal(rows.length, 193);
assert.equal(rows.filter(row => row.profile.status === 'CONTEXTUAL').length, 165);
assert.equal(rows.filter(row => row.profile.status === 'SOURCE_INPUT_ONLY').length, 28);

const storeSource = `
const listeners = new Set(); let revision = 0, release;
export const rows = ${JSON.stringify(rows)};
export const state = { index: 0, stored: true, year: 2026, center: 'fixture-center', role: 'ADMIN_PUSKESMAS', session: true,
 userId: 'fixture-user', active: true, assigned: true, lockedMonths: [], endMonth: 12, mutating: false, pauseSave: false, failSave: false };
export const writes = [], pending = []; export let savedCalls = 0;
let sessionUser;
export function configure(options = {}) { Object.assign(state, options); revision++; listeners.forEach(fn => fn()); }
export class ApiError extends Error {}
export function profile() { return state.profile ?? rows[state.index].profile; }
export function indicator() { return { id: rows[state.index].id, indikator: 'Indikator asesmen sumber', do2026: profile() }; }
export function item() { const row = rows[state.index]; return { indicatorId: row.id, indicator: indicator(), numerator: state.stored ? row.expected.numerator : null,
 denominator: state.stored ? row.expected.denominator : null, measurementValue: row.expected.measurementValue, measurementUnit: row.expected.measurementUnit,
 nilaiKinerja: null, scoringVersion: 'DO_2026_V2', dataComplete: row.expected.measurementValue !== null, scoreComplete: false,
 availableMonths: [], missingMonths: [], recapRevision: state.stored ? 2 : 0, recapNotes: state.stored ? 'Catatan sumber QA' : '',
 recapStructuredInput: state.payload ?? (state.stored ? row.input : null), aggregationMethod: 'EXPLICIT_SOURCE_ASSESSMENT',
 status: row.expected.status, reason: null, assessmentScope: row.expected.assessmentScope, ...state.saved }; }
export const pkpStore = {
 subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); }, getSnapshot: () => revision, getServerSnapshot: () => revision,
 getSessionUser: () => {
   if (!state.session) return null;
   if (sessionUser?.id !== state.userId || sessionUser?.role !== state.role) sessionUser = { id: state.userId, role: state.role, healthCenterId: 'fixture-center' };
   return sessionUser;
 },
 getCurrentYear: () => state.year, getSelectedHealthCenterId: () => state.center, getSelectedHealthCenter: () => ({ name: 'Puskesmas QA' }),
  getLoadState: () => ({ loading: false, error: null }), getActivePeriod: () => ({ year: state.year }),
  isActiveYear: year => state.active && year === state.year, canInputOwnPeriod: year => state.active && year === state.year && state.center === 'fixture-center',
 isPeriodLocked: (_year, month) => state.lockedMonths.includes(month), isMutating: () => state.mutating,
 getAssignments: () => state.assigned ? { [indicator().id]: 'fixture-user' } : {}, getIndicators: () => state.missing ? [] : [indicator()],
 savePeriodRecap: async value => {
   writes.push(structuredClone(value)); if (state.pauseSave) await new Promise(resolve => { release = resolve; });
   if (state.failSave) throw new Error('Fixture: revisi berubah');
   const response = await fetch('/api/v1/records/period-recaps', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
   if (!response.ok) throw new Error('Fixture API rejected');
   const saved = await response.json(); state.saved = { numerator: saved.numerator, denominator: saved.denominator,
     recapStructuredInput: saved.structuredInput, recapNotes: saved.notes, recapRevision: saved.expectedRevision + 1 };
 }, saveRecord: async (...args) => writes.push(args),
};
export const api = { request: async path => {
 if (path.startsWith('/analytics/period-recap?')) return { items: [item()] };
 throw new Error('Unexpected API: ' + path);
} };
export function resume() { release?.(); }
export function onSaved() { savedCalls++; }
`;
const entrySource = `
import React from 'react'; import { createRoot } from 'react-dom/client';
import { RecapEditor } from '/src/components/data-entry/recap-editor.tsx';
import { PeriodRecapPanel } from '/src/components/data-entry/PeriodRecapPanel.tsx';
import { Do2026Editor } from '/src/components/data-entry/Do2026Editor.tsx';
import { confirmDiscardChanges } from '/src/components/common/useUnsavedChanges.ts';
import * as validation from '/src/services/sourceAssessment.ts';
import { sourceTermLabel } from '/src/services/sourceAssessmentLabels.ts';
import { rows, state, configure, profile, indicator, item, writes, pending, resume, onSaved, savedCalls } from 'virtual:source-store';
import '/src/index.css';
const root = createRoot(document.getElementById('root')); let key = 0;
function mount(options = {}) {
 configure(options);
 root.render(state.view === 'panel' ? React.createElement(PeriodRecapPanel, { key: ++key, year: 2026, month: state.endMonth })
  : state.view === 'monthly' ? React.createElement(Do2026Editor, { key: ++key, indicator: indicator(), record: { pencapaianRiil: 21.25, scoringVersion: 'ILP_2026_V1' }, year: 2026, month: 12, canEdit: true, onClose: onSaved })
   : React.createElement(RecapEditor, { key: ++key, item: item(), profile: profile(), year: state.year, endMonth: state.endMonth,
    healthCenterId: 'fixture-center', readOnlyReason: null, onPendingChange: value => pending.push(value), onSaved }));
}
window.sourceFixture = { rows, validation, sourceTermLabel, state, mount, configure, writes, pending, resume, savedCalls: () => savedCalls,
 unmount: () => root.render(null), discard: () => confirmDiscardChanges('recap') };
`;

test('193 live source contracts in frontend and browser', async t => {
  const cacheDir = await mkdtemp('/tmp/opencode/source-assessment-vite-');
  let server, browser;
  const received = [];
  try {
    server = await createServer({ root, configFile: false, envFile: false, cacheDir,
      plugins: [{ name: 'source-assessment-fixture', enforce: 'pre', resolveId(id) {
        if (id === '/source-fixture.jsx') return '\0source-fixture.jsx';
        if (id === 'virtual:source-store' || /(?:^|\/)(?:apiStore|apiClient)(?:\.ts)?$/.test(id)) return '\0source-store';
      }, load(id) { if (id === '\0source-fixture.jsx') return entrySource; if (id === '\0source-store') return storeSource; },
      configureServer(vite) {
        vite.middlewares.use('/source-test', async (_req, res) => {
          res.setHeader('Content-Type', 'text/html');
          res.end(await vite.transformIndexHtml('/source-test', '<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/source-fixture.jsx"></script></body></html>'));
        });
        vite.middlewares.use('/api/v1/records/period-recaps', async (req, res) => {
          let body = ''; for await (const chunk of req) body += chunk;
          const input = JSON.parse(body); received.push(input);
          res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(input));
        });
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
      try { await page.goto(origin + '/source-test'); await page.waitForFunction(() => window.sourceFixture).catch(error => { assert.deepEqual(errors, []); throw error; });
        await run(page); assert.deepEqual(errors, []); assert.deepEqual(external, []);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      } finally { await page.close(); }
    }
    async function mount(page, options = {}) {
      await page.evaluate(options => window.sourceFixture.mount(options), options);
      if (options.view === 'panel') await page.getByText('Rekap Kumulatif & Tahunan', { exact: true }).click();
      if (options.view !== 'monthly') await page.getByText('Isi atau perbarui rekap terpisah', { exact: true }).click();
    }
    const save = page => page.getByRole('button', { name: /^(Simpan rekap terpisah|Menyimpan rekap\.\.\.)$/ });
    const submit = page => page.locator('form').evaluate(form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    const confirm = page => page.getByRole('checkbox', { name: /^Saya mengonfirmasi pencatatan/ }).check();
    const indexFor = predicate => rows.findIndex(predicate);
    const ratioIndex = indexFor(row => row.descriptor.period === 'ANNUAL' && row.descriptor.formula?.operator === 'RATIO_PERCENT' && row.descriptor.formula.numeratorSubset === true);

    await pageFixture(async page => {
      for (const [index, row] of rows.entries()) await t.test(`${row.id}: descriptor identity, strict parsing, guided render, exact HTTP roundtrip`, async () => {
        const result = await page.evaluate(index => {
          const { rows, validation } = window.sourceFixture, row = rows[index];
          validation.assertSourceIdentity(row.profile, row.id);
           validation.validateSourceAssessment(row.input, row.descriptor, 2026, 12);
           let rejected = false;
           try { validation.validateSourceAssessment(row.invalidNihil, row.descriptor, 2026, 12); } catch { rejected = true; }
           if (!rejected) throw new Error('Frontend accepted backend-rejected nihil');
          const parsed = validation.parseSourceAssessmentDraft(row.input, row.descriptor, 2026, 12);
          const draft = validation.createSourceAssessmentDraft(row.descriptor, 2026, 12);
          return { parsed, counts: validation.sourceAssessmentCounts(parsed), draft };
        }, index);
        assert.deepEqual(result.parsed, row.input);
        assert.deepEqual(result.counts, { numerator: row.expected.numerator, denominator: row.expected.denominator });
        assert.equal(result.draft.attestation.sourceCoverageComplete, false);
        assert.equal(result.draft.attestation.criteriaReferences.every(value => value === ''), true);
        assert.equal(Object.values(result.draft.context).every(value => value.reference === '' && value.description === '' && value.status === 'UNRESOLVED'), true);
        await mount(page, { index, stored: true, saved: undefined });
        assert.equal(await page.getByRole('group', { name: 'Asesmen sumber DO', exact: true }).count(), 1);
        assert.equal(await page.getByLabel('Referensi telaah konteks', { exact: true }).count(), row.descriptor.requiredContext.length);
        const contextLabels = await page.locator('legend').filter({ hasText: /^Telaah konteks sumber / }).allTextContents();
        assert.equal(contextLabels.every((label, i) => label.includes(': ') && !label.endsWith(row.descriptor.requiredContext[i].key)), true);
        assert.equal(await page.getByLabel(/^Referensi telaah kriteria \d+$/).count(), row.descriptor.criteria.length);
        assert.equal(await page.locator('textarea').count(), 1, 'only ordinary recap notes, never a JSON editor');
        await confirm(page); assert.equal(await save(page).isEnabled(), true);
        const previous = received.length; await save(page).click();
        await page.waitForFunction(() => window.sourceFixture.state.saved?.recapRevision === 3);
        assert.equal(received.length, previous + 1);
        assert.deepEqual(received.at(-1), { year: 2026, endMonth: 12, indicatorId: row.id, numerator: row.expected.numerator,
          denominator: row.expected.denominator, notes: 'Catatan sumber QA', confirmed: true, expectedRevision: 2, structuredInput: row.input });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      });
    });

    const invalids = [
      ['unknown root', input => { input.unknown = true; }], ['wrong definition', input => { input.definitionId = 'DO26-wrong'; }],
      ['wrong year', input => { input.year = 2027; }], ['wrong kind', input => { input.kind = 'PME_ANNUAL'; }],
      ['wrong version', input => { input.contractVersion = 'DO_SOURCE_ASSESSMENT_V2'; }], ['missing context', input => { delete input.context[Object.keys(input.context)[0]]; }],
      ['unknown context key', input => { input.context.unknown = { reference: 'x', description: 'x', status: 'AVAILABLE' }; }],
      ['unknown nested context', input => { Object.values(input.context)[0].extra = true; }], ['empty context', input => { Object.values(input.context)[0].description = ''; }],
      ['empty provenance', input => { input.provenance.grainReference = ''; }], ['control reference', input => { input.period.reference = 'a\nb'; }],
      ['missing criterion', input => { input.attestation.criteriaReferences = []; }], ['unknown attestation', input => { input.attestation.extra = true; }],
      ['nonboolean attestation', input => { input.attestation.grainReconciled = 'true'; }], ['invalid status', input => { input.attestation.status = 'PASS'; }],
      ['wrong period', input => { input.period.kind = 'AS_OF'; }], ['invalid calendar', input => { input.period.startDate = '2026-02-30'; }],
      ['period cutoff mismatch', input => { input.period.cutoffDate = '2026-11-30'; }], ['nonannual range', input => { input.period.startDate = '2026-02-01'; }],
      ['unknown values', input => { input.values.extra = 0; }], ['wrong numeric type', input => { input.values.numerator = '1'; }],
      ['negative', input => { input.values.numerator = -1; }], ['fractional count', input => { input.values.numerator = 1.1; }],
      ['too large', input => { input.values.numerator = 10000000000; }], ['subset exceed', input => { input.values.numerator = 999; }],
      ['unexpected parameters', input => { input.parameters = { x: 1 }; }], ['unexpected denominator context', input => { input.denominatorContext = {}; }],
    ];
    for (const [name, change] of invalids) await t.test(`fail closed: ${name}`, () => pageFixture(async page => {
      const payload = structuredClone(rows[ratioIndex].input); change(payload);
      const rejection = await page.evaluate(({ payload, index }) => { try { const row = window.sourceFixture.rows[index]; window.sourceFixture.validation.validateSourceAssessment(payload, row.descriptor, 2026, 12); return null; } catch (error) { return error.message; } }, { payload, index: ratioIndex });
      assert.equal(typeof rejection, 'string');
      await mount(page, { index: ratioIndex, payload });
      await submit(page);
      assert.equal(await save(page).isDisabled(), true);
      assert.deepEqual(await page.evaluate(() => window.sourceFixture.writes), []);
    }));

    for (const [name, options] of [
      ['year', { year: 2027 }], ['tenant', { center: 'other' }], ['session', { session: false }], ['role', { role: 'DINKES' }],
      ['inactive', { active: false }], ['lock', { lockedMonths: [12] }], ['PIC assignment', { role: 'PIC', assigned: false }],
      ['missing metadata', { missing: true }], ['user identity', { userId: 'different-user' }],
    ]) await t.test(`live ${name} blocks and retains draft`, () => pageFixture(async page => {
      await mount(page, { index: ratioIndex });
      await page.getByLabel('Referensi penetapan periode dan cutoff', { exact: true }).fill('Draft tidak hilang'); await confirm(page);
      await page.evaluate(options => window.sourceFixture.configure(options), options);
      await submit(page); assert.equal(await save(page).isDisabled(), true);
      assert.equal(await page.getByLabel('Referensi penetapan periode dan cutoff', { exact: true }).inputValue(), 'Draft tidak hilang');
      assert.deepEqual(await page.evaluate(() => window.sourceFixture.writes), []);
    }));

    for (const [name, mutate] of [
      ['definition identity', profile => { profile.definitionId = 'DO26-wrong'; }], ['descriptor source indicator', profile => { profile.sourceAssessment.sourceDefinition.indicatorId = 'other'; }],
      ['required context', profile => { profile.sourceAssessment.requiredContext.push({ key: 'newContext', label: 'newContext', input: 'REFERENCED_ASSESSMENT' }); }],
      ['formula', profile => { profile.sourceAssessment.formula.fixedDenominator = 19; }], ['kind', profile => { profile.structuredInputKind = 'PME_ANNUAL'; }],
      ['availability', profile => { profile.inputAvailable = false; }], ['status', profile => { profile.status = 'UNRESOLVED_RULE'; }],
    ]) await t.test(`live metadata ${name} blocks without clearing`, () => pageFixture(async page => {
      await mount(page, { index: ratioIndex }); await confirm(page);
      const profile = structuredClone(rows[ratioIndex].profile); mutate(profile);
      await page.evaluate(profile => window.sourceFixture.configure({ profile }), profile);
      await submit(page); assert.equal(await save(page).isDisabled(), true);
      assert.deepEqual(await page.evaluate(() => window.sourceFixture.writes), []);
    }));

    for (const [before, after] of [['ADMIN_PUSKESMAS', 'PIC'], ['PIC', 'ADMIN_PUSKESMAS']]) await t.test(`live authorized role change ${before} to ${after} blocks without discarding`, () => pageFixture(async page => {
      await mount(page, { index: ratioIndex, role: before });
      const field = page.getByLabel('Referensi penetapan periode dan cutoff', { exact: true });
      await field.fill('Draft pada peran awal'); await confirm(page);
      assert.equal(await save(page).isEnabled(), true);
      await page.evaluate(role => window.sourceFixture.configure({ role }), after);
      await submit(page);
      assert.equal(await save(page).isDisabled(), true);
      assert.equal(await field.inputValue(), 'Draft pada peran awal');
      assert.deepEqual(await page.evaluate(() => window.sourceFixture.writes), []);
    }));

    await t.test('source labels remain Indonesian while technical keys stay secondary', () => pageFixture(async page => {
      const labels = await page.evaluate(() => ['sourceSnapshotReference', 'yearScope', 'documentYear', 'source_coverage_complete', 'hbsag_testing', 'externalUnrecognizedKey'].map(window.sourceFixture.sourceTermLabel));
      assert.deepEqual(labels, ['Referensi versi sumber', 'Lingkup tahun penilaian', 'Dokumen tahun', 'Sumber cakupan lengkap', 'HBsAg pemeriksaan', 'EXTERNAL UNRECOGNIZED KEY']);
    }));

    await t.test('all period defaults use only known source dates; optional windows stay empty', () => pageFixture(async page => {
      const failures = await page.evaluate(() => {
        const { rows, validation } = window.sourceFixture;
        return rows.flatMap(row => { const draft = validation.createSourceAssessmentDraft(row.descriptor, 2026, 12);
          const known = ['ANNUAL', 'MONTH', 'QUARTER'].includes(row.descriptor.period);
          return (known ? !draft.period.endDate : !!draft.period.endDate || !!draft.period.cutoffDate) ? [row.id] : []; });
      }); assert.deepEqual(failures, []);
    }));

    const vaccineIndex = indexFor(row => row.id === 'K1-R34');
    await t.test('paired backend regression payloads match frontend acceptance without rounding', () => pageFixture(async page => {
      const mismatches = await page.evaluate(() => window.sourceFixture.rows.flatMap(row => row.regressionPayloads.flatMap(scenario => {
        let accepted = false;
        try { window.sourceFixture.validation.validateSourceAssessment(scenario.input, row.descriptor, scenario.year, scenario.endMonth); accepted = true; } catch { /* Compare exact backend outcome. */ }
        return accepted === scenario.accepted ? [] : [row.id + ': ' + scenario.name];
      })));
      assert.deepEqual(mismatches, []);
    }));
    for (const entry of rows[vaccineIndex].regressionCases.vaccineMonths) await t.test(`calendar vaccine ${entry.year}-${entry.month}: exact D=${entry.days}, readonly UI and tamper rejection`, () => pageFixture(async page => {
      const payload = structuredClone(rows[vaccineIndex].input);
      const month = String(entry.month).padStart(2, '0');
      payload.year = entry.year;
      payload.period = { ...payload.period, month: entry.month, startDate: `${entry.year}-${month}-01`, endDate: `${entry.year}-${month}-${entry.days}`, cutoffDate: `${entry.year}-${month}-${entry.days}` };
      payload.values = { kind: 'RATIO_AGGREGATE', numerator: entry.numerator, denominator: entry.days };
      const result = await page.evaluate(({ payload, index, entry }) => {
        const { validation, rows } = window.sourceFixture, descriptor = rows[index].descriptor;
        validation.validateSourceAssessment(payload, descriptor, entry.year, entry.month);
        const draft = validation.createSourceAssessmentDraft(descriptor, entry.year, entry.month);
        let rejected = false;
        try { validation.validateSourceAssessment({ ...payload, values: { ...payload.values, denominator: 1 } }, descriptor, entry.year, entry.month); } catch { rejected = true; }
        return { denominator: draft.values.denominator, rejected };
      }, { payload, index: vaccineIndex, entry });
      assert.deepEqual(result, { denominator: entry.days, rejected: true });
      await mount(page, { index: vaccineIndex, payload, year: entry.year, endMonth: entry.month, saved: { numerator: entry.numerator, denominator: entry.days } });
      assert.notEqual(await page.getByLabel(/^Penyebut agregat:/).getAttribute('readonly'), null);
      assert.equal(await page.getByLabel(/^Penyebut agregat:/).inputValue(), String(entry.days));
      await confirm(page); assert.equal(await save(page).isEnabled(), true);
      await save(page).click(); await page.waitForFunction(() => window.sourceFixture.state.saved?.recapRevision === 3);
      assert.deepEqual(received.at(-1).structuredInput, payload);
    }));

    await t.test('stored vaccine N=1 D=1 in December fails closed without auto-repair', () => pageFixture(async page => {
      const payload = structuredClone(rows[vaccineIndex].input); payload.values.denominator = 1;
      await mount(page, { index: vaccineIndex, payload }); await submit(page);
      assert.equal(await save(page).isDisabled(), true);
      assert.deepEqual(await page.evaluate(() => window.sourceFixture.writes), []);
      assert.equal(await page.evaluate(() => window.sourceFixture.state.payload.values.denominator), 1);
    }));

    for (const id of ['K1-R137', 'K1-R138']) {
      const index = indexFor(row => row.id === id);
      await t.test(`${id}: provisional readonly two-year window follows explicit cutoff`, () => pageFixture(async page => {
        await mount(page, { index });
        assert.notEqual(await page.getByLabel('Tanggal awal observasi', { exact: true }).getAttribute('readonly'), null);
        assert.notEqual(await page.getByLabel('Tanggal akhir observasi', { exact: true }).getAttribute('readonly'), null);
        assert.equal(await page.getByText(/Konvensi teknis provisional, bukan batas tanggal/).count(), 1);
        await page.getByLabel('Tanggal cutoff penilaian', { exact: true }).fill('2026-12-15');
        assert.equal(await page.getByLabel('Tanggal awal observasi', { exact: true }).inputValue(), '2025-01-01');
        assert.equal(await page.getByLabel('Tanggal akhir observasi', { exact: true }).inputValue(), '2026-12-15');
        await confirm(page); await save(page).click(); await page.waitForFunction(() => window.sourceFixture.state.saved?.recapRevision === 3);
        assert.equal(received.at(-1).structuredInput.period.endDate, '2026-12-15');
      }));
      for (const patch of [{ startDate: '2000-01-01', endDate: '2001-12-31' }, { startDate: '2025-02-01' }, { endDate: '2026-12-30' }]) await t.test(`${id}: reject stored wrong window ${JSON.stringify(patch)}`, () => pageFixture(async page => {
        const payload = structuredClone(rows[index].input); Object.assign(payload.period, patch);
        await mount(page, { index, payload }); await submit(page);
        assert.equal(await save(page).isDisabled(), true);
        assert.deepEqual(await page.evaluate(() => window.sourceFixture.writes), []);
      }));
    }

    for (const [name, id, mutate] of [
      ['calendar rule missing', 'K1-R34', d => { delete d.denominatorRule; }],
      ['calendar rule kind', 'K1-R34', d => { d.denominatorRule.kind = 'FIXED'; }],
      ['parameter arithmetic', 'K4-R15', d => { d.denominatorRule.arithmetic = 'FLOAT'; }],
      ['parameter precision', 'K4-R15', d => { d.denominatorRule.maximumDecimalPlaces = 8; }],
      ['period rule missing', 'K1-R137', d => { delete d.periodWindowRule; }],
      ['period rule authority', 'K1-R138', d => { d.periodWindowRule.authority = 'APPROVED'; }],
      ['nihil rule missing', 'K3-R11', d => { delete d.verifiedNihilRule; }],
      ['nihil rule enabled for conflict', 'K3-R12', d => { d.verifiedNihilRule.available = true; }],
      ['nihil fields missing', 'K3-R48', d => { d.verifiedNihilRule.requiredFields = []; }],
    ]) await t.test(`descriptor ${name}: reject initially and block live mutation`, () => pageFixture(async page => {
      const index = indexFor(row => row.id === id), profile = structuredClone(rows[index].profile); mutate(profile.sourceAssessment);
      assert.equal(await page.evaluate(({ index, profile }) => {
        try { window.sourceFixture.validation.assertSourceIdentity(profile, window.sourceFixture.rows[index].id); return false; } catch { return true; }
      }, { index, profile }), true);
      await mount(page, { index }); await confirm(page);
      await page.getByLabel('Referensi penetapan periode dan cutoff', { exact: true }).fill('Draft dengan metadata awal');
      await page.evaluate(profile => window.sourceFixture.configure({ profile }), profile);
      await submit(page); assert.equal(await save(page).isDisabled(), true);
      assert.equal(await page.getByLabel('Referensi penetapan periode dan cutoff', { exact: true }).inputValue(), 'Draft dengan metadata awal');
      assert.deepEqual(await page.evaluate(() => window.sourceFixture.writes), []);
    }));

    await t.test('live valid nihil descriptor instruction change is detected by the complete snapshot', () => pageFixture(async page => {
      const index = indexFor(row => row.id === 'K3-R11'); await mount(page, { index }); await confirm(page);
      const profile = structuredClone(rows[index].profile); profile.sourceAssessment.verifiedNihilRule.referenceInstruction += ' QA additional instruction';
      assert.equal(await page.evaluate(({ profile, index }) => !!window.sourceFixture.validation.assertSourceIdentity(profile, window.sourceFixture.rows[index].id), { profile, index }), true);
      await page.evaluate(profile => window.sourceFixture.configure({ profile }), profile); await submit(page);
      assert.equal(await save(page).isDisabled(), true); assert.deepEqual(await page.evaluate(() => window.sourceFixture.writes), []);
    }));

    await t.test('large repeating source allocation rejects rounded Decimal(14,4) in validation and actual form', () => pageFixture(async page => {
      const index = indexFor(row => row.id === 'K4-R15'), row = rows[index];
      const payload = structuredClone(row.input); payload.parameters = row.regressionCases.repeatingAllocation;
      payload.values.denominator = row.regressionCases.roundedAllocationDenominator;
      await mount(page, { index, payload }); await submit(page);
      assert.equal(await save(page).isDisabled(), true);
      assert.deepEqual(await page.evaluate(() => window.sourceFixture.writes), []);
      await page.evaluate(() => window.sourceFixture.mount({ payload: undefined, profile: undefined, index: window.sourceFixture.rows.findIndex(row => row.id === 'K4-R15') }));
      await page.getByText('Isi atau perbarui rekap terpisah', { exact: true }).click();
      await page.getByLabel('Jumlah penduduk Puskesmas', { exact: true }).fill(String(payload.parameters.pkmPopulation));
      await page.getByLabel('Jumlah penduduk kabupaten/kota', { exact: true }).fill(String(payload.parameters.districtPopulation));
      await page.getByLabel('Estimasi kasus TBC kabupaten/kota', { exact: true }).fill(String(payload.parameters.districtEstimatedTbCases));
      assert.equal(await page.getByLabel(/^Penyebut agregat:/).inputValue(), '');
      assert.equal(await page.getByText(/Penyebut turunan tidak dapat disimpan tepat/).count() > 0, true);
      await confirm(page); await submit(page); assert.deepEqual(await page.evaluate(() => window.sourceFixture.writes), []);
    }));

    for (const id of ['K3-R11', 'K3-R48', 'K3-R49']) {
      const index = indexFor(row => row.id === id);
      await t.test(`${id}: stored nihil strict snapshot and exact HTTP roundtrip`, () => pageFixture(async page => {
        const payload = structuredClone(rows[index].input); payload.values = { kind: 'RATIO_AGGREGATE', numerator: 0, denominator: 0 }; payload.verifiedNihil = rows[index].nihilFixture;
        const parsed = await page.evaluate(({ payload, index }) => window.sourceFixture.validation.parseSourceAssessmentDraft(payload, window.sourceFixture.rows[index].descriptor, 2026, 12), { payload, index });
        assert.deepEqual(parsed, payload);
        await mount(page, { index, payload, saved: { numerator: 0, denominator: 0 } }); await confirm(page);
        assert.equal(await save(page).isEnabled(), true); await save(page).click(); await page.waitForFunction(() => window.sourceFixture.state.saved?.recapRevision === 3);
        assert.deepEqual(received.at(-1).structuredInput, payload);
      }));
      await t.test(`${id}: explicit nihil actual form, unset, reattest and exact save`, () => pageFixture(async page => {
        await mount(page, { index });
        const toggle = page.getByRole('checkbox', { name: /^Ajukan pengecualian nihil Dinsos/ });
        assert.equal(await toggle.isChecked(), false);
        assert.equal(await page.getByLabel('Referensi dokumen agregat Dinsos', { exact: true }).count(), 0);
        await page.getByLabel(/^Pembilang agregat:/).fill('0'); await page.getByLabel(/^Penyebut agregat:/).fill('0');
        await toggle.check();
        const proof = page.getByRole('checkbox', { name: 'Saya memastikan tidak ada kewajiban kohort tahun lalu yang tersisa', exact: true });
        assert.equal(await proof.isChecked(), false);
        await page.getByLabel('Referensi dokumen agregat Dinsos', { exact: true }).fill('QA Dinsos aggregate');
        await page.getByLabel('Referensi rekonsiliasi ketiadaan kohort kini dan tahun lalu', { exact: true }).fill('QA cohort absence');
        await proof.check(); await toggle.uncheck();
        assert.equal(await page.getByLabel(/^Pembilang agregat:/).inputValue(), '0');
        assert.equal(await page.getByLabel('Referensi penetapan periode dan cutoff', { exact: true }).inputValue(), rows[index].input.period.reference);
        await toggle.check(); assert.equal(await proof.isChecked(), false);
        await page.getByLabel('Referensi dokumen agregat Dinsos', { exact: true }).fill('QA Dinsos aggregate');
        await page.getByLabel('Referensi rekonsiliasi ketiadaan kohort kini dan tahun lalu', { exact: true }).fill('QA cohort absence');
        await proof.check(); await confirm(page); assert.equal(await save(page).isEnabled(), true);
        await save(page).click(); await page.waitForFunction(() => window.sourceFixture.state.saved?.recapRevision === 3);
        const sent = received.at(-1).structuredInput;
        assert.deepEqual(sent.verifiedNihil, { ...rows[index].nihilFixture, dinsosReference: 'QA Dinsos aggregate', cohortAbsenceReference: 'QA cohort absence' });
        assert.deepEqual(sent.values, { kind: 'RATIO_AGGREGATE', numerator: 0, denominator: 0 });
        assert.deepEqual(rows[index].nihilExpected, { status: 'VERIFIED_NO_CASE_TARGET_MET', targetMet: true, measurementValue: null, nilaiKinerja: null });
      }));
      for (const [name, change] of [
        ['missing proof', p => { delete p.verifiedNihil.noResidualPriorYearObligationConfirmed; }],
        ['false proof', p => { p.verifiedNihil.noResidualPriorYearObligationConfirmed = false; }],
        ['missing Dinsos', p => { p.verifiedNihil.dinsosReference = ''; }],
        ['missing cohort', p => { p.verifiedNihil.cohortAbsenceReference = ''; }],
        ['wrong scope', p => { p.verifiedNihil.territoryReference = 'other'; }],
        ['wrong definition', p => { p.verifiedNihil.definitionId = 'other'; }],
        ['wrong year', p => { p.verifiedNihil.year = 2027; }],
        ['wrong dates', p => { p.verifiedNihil.periodStartDate = '2000-01-01'; }],
        ['wrong end', p => { p.verifiedNihil.periodEndDate = '2026-12-30'; }],
        ['wrong cutoff', p => { p.verifiedNihil.cutoffDate = '2026-12-30'; }],
        ['unknown field', p => { p.verifiedNihil.extra = true; }],
        ['incomplete context', p => { Object.values(p.context)[0].status = 'UNRESOLVED'; }],
        ['incomplete attestation', p => { p.attestation.status = 'INCOMPLETE'; }],
        ['nonzero counts', p => { p.values = { kind: 'RATIO_AGGREGATE', numerator: 1, denominator: 1 }; }],
      ]) await t.test(`${id}: nihil rejects ${name} without write`, () => pageFixture(async page => {
        const payload = structuredClone(rows[index].input); payload.values = { kind: 'RATIO_AGGREGATE', numerator: 0, denominator: 0 }; payload.verifiedNihil = structuredClone(rows[index].nihilFixture); change(payload);
        await mount(page, { index, payload }); await submit(page);
        assert.equal(await save(page).isDisabled(), true); assert.deepEqual(await page.evaluate(() => window.sourceFixture.writes), []);
      }));
      await t.test(`${id}: report labels target-met nihil without fabricated measurement or score`, () => pageFixture(async page => {
        await mount(page, { index, view: 'panel', saved: { status: 'VERIFIED_NO_CASE_TARGET_MET', numerator: 0, denominator: 0, measurementValue: null, nilaiKinerja: null, dataComplete: false } });
        assert.equal(await page.getByText('Target terpenuhi berdasarkan pernyataan petugas bahwa tidak ada kasus, dengan referensi Dinsos dan pencocokan data kohort. Pernyataan ini belum diverifikasi pihak luar. Hasil tidak dinyatakan sebagai persentase 0/0 atau skor angka.', { exact: true }).count(), 1);
        assert.equal(await page.getByText(/Status hitung: VERIFIED_NO_CASE_TARGET_MET/).count(), 1);
        const results = await page.getByRole('region', { name: 'Hasil rekap indikator', exact: true }).locator('dl dd').allTextContents();
        assert.deepEqual(results, ['0', '0', '-', '-']);
      }));
    }
    for (const [name, options] of [
      ['year', { year: 2027 }], ['tenant', { center: 'other' }], ['session', { session: false }], ['role', { role: 'DINKES' }],
      ['authorized role', { role: 'PIC' }], ['inactive', { active: false }], ['lock', { lockedMonths: [1] }], ['PIC assignment', { role: 'PIC', assigned: false }],
      ['missing metadata', { missing: true }], ['user identity', { userId: 'other' }],
    ]) await t.test(`nihil draft survives live ${name} guard with no write`, () => pageFixture(async page => {
      const index = indexFor(row => row.id === 'K3-R11'), payload = structuredClone(rows[index].input);
      payload.values = { kind: 'RATIO_AGGREGATE', numerator: 0, denominator: 0 }; payload.verifiedNihil = rows[index].nihilFixture;
      await mount(page, { index, payload, saved: { numerator: 0, denominator: 0 } }); await confirm(page);
      await page.getByLabel('Referensi dokumen agregat Dinsos', { exact: true }).fill('QA draft retained');
      await page.evaluate(options => window.sourceFixture.configure(options), options); await submit(page);
      assert.equal(await save(page).isDisabled(), true);
      assert.equal(await page.getByLabel('Referensi dokumen agregat Dinsos', { exact: true }).inputValue(), 'QA draft retained');
      assert.deepEqual(await page.evaluate(() => window.sourceFixture.writes), []);
    }));
    for (const id of ['K3-R12', 'K1-R34']) await t.test(`${id}: nihil cannot override source conflict or unrelated indicator`, () => pageFixture(async page => {
      const index = indexFor(row => row.id === id);
      await mount(page, { index }); assert.equal(await page.getByRole('checkbox', { name: /^Ajukan pengecualian nihil Dinsos/ }).count(), 0);
      const payload = structuredClone(rows[index].input); payload.verifiedNihil = rows[index].nihilFixture;
      await page.evaluate(({ index, payload }) => window.sourceFixture.mount({ index, payload }), { index, payload });
      await page.getByText('Isi atau perbarui rekap terpisah', { exact: true }).click(); await submit(page);
      assert.equal(await save(page).isDisabled(), true); assert.deepEqual(await page.evaluate(() => window.sourceFixture.writes), []);
    }));

    for (const period of ['MONTH', 'QUARTER', 'AS_OF']) await t.test(`${period} respects all storage-period locks without changing observation scope`, () => pageFixture(async page => {
      const index = indexFor(row => row.descriptor.period === period);
      await mount(page, { index }); await confirm(page);
      await page.evaluate(() => window.sourceFixture.configure({ lockedMonths: [1] }));
      assert.equal(await save(page).isDisabled(), true);
      if (period !== 'QUARTER') {
        const value = await page.evaluate(index => window.sourceFixture.validation.createSourceAssessmentDraft(window.sourceFixture.rows[index].descriptor, 2026, 2), index);
        assert.equal(value.period.kind, period);
      }
    }));

    await t.test('exact derived precision, scientific factors, SASARAN, money and zero', () => pageFixture(async page => {
      const checks = await page.evaluate(() => {
        const { rows, validation } = window.sourceFixture;
        const find = id => rows.find(row => row.id === id);
        const derive = (id, parameters) => validation.derivedSourceDenominator(find(id).descriptor, parameters);
        const errors = [];
        for (const [id, parameters] of [['K4-R14', { detectionTarget: 0.0001 }], ['K4-R15', { pkmPopulation: 1, districtPopulation: 3, districtEstimatedTbCases: 1 }]]) {
          try { derive(id, parameters); errors.push(id); } catch { /* Must fail without rounding. */ }
        }
        const zero = structuredClone(rows.find(row => row.descriptor.formula?.operator === 'RATIO_PERCENT' && row.descriptor.formula.numeratorSubset === true).input);
        zero.values.numerator = 0; zero.values.denominator = 0;
        const row = rows.find(row => row.input.definitionId === zero.definitionId);
        if (row.descriptor.formula.fixedDenominator !== undefined) zero.values.denominator = row.descriptor.formula.fixedDenominator;
        validation.validateSourceAssessment(zero, row.descriptor, 2026, 12);
        return { errors, tb: derive('K4-R14', { detectionTarget: 100 }), contacts: derive('K4-R19', { indexCount: 2 }),
          allocated: derive('K4-R15', { pkmPopulation: 1000, districtPopulation: 10000, districtEstimatedTbCases: 100 }),
          population: derive('K3-R10', { population: 10000 }) };
      });
      assert.deepEqual(checks, { errors: [], tb: 540, contacts: 40, allocated: 10, population: 64 });
    }));

    await t.test('new ratio form fills structured values and all references without JSON', () => pageFixture(async page => {
      const row = rows[ratioIndex]; await mount(page, { index: ratioIndex, stored: false });
      const group = page.getByRole('group', { name: 'Asesmen sumber DO', exact: true });
      await group.getByLabel(/^Pembilang agregat:/).fill('1');
      const d = group.getByLabel(/^Penyebut agregat:/); if (await d.getAttribute('readonly') === null) await d.fill(String(row.expected.denominator));
      const texts = group.locator('input[type="text"]');
      for (const field of await texts.all()) if (await field.getAttribute('readonly') === null) await field.fill('Referensi agregat QA tanpa identitas individu');
      await page.getByRole('textbox', { name: 'Sumber dan cara menyusun rekap (wajib)', exact: true }).fill('Catatan sumber independen');
      await confirm(page); await save(page).click();
      await page.waitForFunction(() => window.sourceFixture.state.saved?.recapRevision === 1);
      const payload = received.at(-1); assert.equal(payload.expectedRevision, 0); assert.equal(payload.structuredInput.attestation.status, 'INCOMPLETE');
      assert.equal(payload.structuredInput.attestation.eligibilityReviewed, false);
      assert.equal(Object.values(payload.structuredInput.context).every(item => item.status === 'UNRESOLVED'), true);
    }));

    for (const status of ['INCOMPLETE', 'NOT_YET_DUE', 'NOT_APPLICABLE']) await t.test(`${status} can save counts without forcing score`, () => pageFixture(async page => {
      const payload = structuredClone(rows[ratioIndex].input); payload.attestation.status = status; payload.attestation.eligibilityReviewed = false;
      Object.values(payload.context)[0].status = 'UNRESOLVED'; Object.values(payload.context)[0].description = 'Gap sumber belum terselesaikan';
      await mount(page, { index: ratioIndex, payload }); await confirm(page); assert.equal(await save(page).isEnabled(), true);
      await save(page).click(); await page.waitForFunction(() => window.sourceFixture.state.saved?.recapRevision === 3);
      assert.deepEqual(received.at(-1).structuredInput, payload);
    }));

    await t.test('revision failure retains the draft and releases pending state for retry', () => pageFixture(async page => {
      await mount(page, { index: ratioIndex, failSave: true });
      const field = page.getByLabel('Referensi penetapan periode dan cutoff', { exact: true });
      await field.fill('Draft revisi yang dipertahankan'); await confirm(page);
      const previous = received.length;
      await save(page).click();
      await page.getByRole('alert').filter({ hasText: 'Fixture: revisi berubah' }).waitFor();
      assert.equal(await field.inputValue(), 'Draft revisi yang dipertahankan');
      assert.equal(await save(page).isEnabled(), true);
      assert.equal(await page.evaluate(() => window.sourceFixture.savedCalls()), 0);
      assert.equal(await page.evaluate(() => window.sourceFixture.pending.at(-1)), false);
      assert.equal(received.length, previous);
      await page.evaluate(() => window.sourceFixture.configure({ failSave: false }));
      await save(page).click();
      await page.waitForFunction(() => window.sourceFixture.state.saved?.recapRevision === 3);
      assert.equal(received.length, previous + 1);
      assert.equal(received.at(-1).expectedRevision, 2, 'retry must not bypass optimistic concurrency');
      assert.equal(received.at(-1).structuredInput.period.reference, 'Draft revisi yang dipertahankan');
      assert.equal(await page.evaluate(() => window.sourceFixture.writes.length), 2);
      assert.equal(await page.evaluate(() => window.sourceFixture.savedCalls()), 1);
    }));

    await t.test('pending, duplicate submit, close and unmount preserve safety', () => pageFixture(async page => {
      await mount(page, { index: ratioIndex, pauseSave: true }); await confirm(page); await save(page).click();
      assert.equal(await save(page).isDisabled(), true); await submit(page);
      assert.equal(await page.evaluate(() => window.sourceFixture.writes.length), 1);
      await page.getByText('Isi atau perbarui rekap terpisah', { exact: true }).click();
      assert.equal(await page.locator('details').first().getAttribute('open') !== null, true);
      await page.evaluate(() => window.sourceFixture.unmount()); await page.evaluate(() => window.sourceFixture.resume());
      await page.waitForFunction(() => window.sourceFixture.state.saved?.recapRevision === 3);
      assert.equal(await page.evaluate(() => window.sourceFixture.savedCalls()), 0);
    }));
    await t.test('cancel discard retains draft; confirmed close resets it', () => pageFixture(async page => {
      await mount(page, { index: ratioIndex }); const field = page.getByLabel('Referensi penetapan periode dan cutoff', { exact: true }); await field.fill('Draft baru');
      page.once('dialog', dialog => dialog.dismiss()); await page.getByText('Isi atau perbarui rekap terpisah', { exact: true }).click();
      assert.equal(await field.inputValue(), 'Draft baru');
      page.once('dialog', dialog => dialog.accept()); await page.getByText('Isi atau perbarui rekap terpisah', { exact: true }).click();
      await page.getByText('Isi atau perbarui rekap terpisah', { exact: true }).click(); assert.equal(await field.inputValue(), rows[ratioIndex].input.period.reference);
    }));

    await t.test('source panel opens input-only components and labels snapshot as nonannual', () => pageFixture(async page => {
      const index = indexFor(row => row.descriptor.expectedValueKind === 'COMPONENT_OBSERVATIONS' && row.descriptor.period === 'AS_OF');
      await mount(page, { index, view: 'panel' });
      assert.equal(await page.getByText(/Bukan capaian tahunan\. Data tidak dikonversi atau digabung antarbulan\./).count(), 1);
      assert.equal(await page.getByText(/API menyimpan placeholder kompatibilitas 0\/0/).count(), 1);
      await confirm(page); assert.equal(await save(page).isEnabled(), true);
    }));

    await t.test('V1 monthly observation remains editable; conversion cannot enter source as monthly', () => pageFixture(async page => {
      await mount(page, { index: ratioIndex, view: 'monthly' });
      assert.equal(await page.getByLabel('Realisasi V1', { exact: true }).isEnabled(), true);
      assert.equal(await page.getByLabel('Realisasi V1', { exact: true }).inputValue(), '21.25');
      await page.getByRole('checkbox', { name: /^Konversi ke DO 2026/ }).check();
      assert.equal(await page.getByText(/Pencatatan DO tersedia melalui asesmen sumber terpisah/).count(), 1);
      await submit(page); assert.deepEqual(await page.evaluate(() => window.sourceFixture.writes), []);
    }));
  } finally { await browser?.close(); await server?.close(); await rm(cacheDir, { recursive: true, force: true }); }
});
