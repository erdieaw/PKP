import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from 'playwright';

// Real recap components with isolated store/API fixtures; no backend, env files or external requests.
const storeSource = `
const listeners = new Set();
let revision = 0, release;
export const state = { kind: 'PME_ANNUAL', role: 'ADMIN_PUSKESMAS', year: 2026, center: 'fixture-center',
  userId: 'fixture-user', session: true, assigned: true, active: true, lockedMonths: [], mutating: false,
  endMonth: 12, view: 'editor', existing: false, stored: null, missing: false, held: false,
  annual: true, pauseSave: false, failSave: false, saved: null };
export const writes = [], pending = [];
export let savedCalls = 0;
export function indicatorId() { return state.idOverride ?? ({ PME_ANNUAL: 'K5-R38', RTM_ANNUAL: 'K1-R40', LROA_ANNUAL: 'K2-R44', SEMESTER_SURVEY_ANNUAL: 'K1-R39', TB_COHORT_ANNUAL: 'K4-R16', LEPROSY_COHORT_ANNUAL: 'K4-R20' }[state.kind] ?? 'generic'); }
export function indicator() { return { id: indicatorId(), indikator: 'Indikator ledger', do2026: {
  status: state.held ? 'UNRESOLVED_RULE' : 'IMPLEMENTED', annualRecapOnly: state.annual,
  ...(state.liveKind === 'ABSENT' ? {} : { structuredInputKind: state.liveKind ?? (state.kind === 'GENERIC' ? undefined : state.kind) }),
  numeratorInput: state.numericOverride ?? (state.kind === 'SEMESTER_SURVEY_ANNUAL' ? 'DECIMAL' : 'INTEGER'), denominatorInput: 'INTEGER', numeratorLabel: 'Pembilang ledger (N)', denominatorLabel: 'Penyebut ledger (D)',
  definitionId: 'fixture-definition', targetDisplay: '100%', measurementUnit: state.unitOverride ?? (state.kind === 'SEMESTER_SURVEY_ANNUAL' ? 'SCORE' : 'PERCENT'),
} }; }
export function item() { return { indicatorId: indicatorId(), indicator: indicator(), numerator: state.existing ? 1 : null,
   denominator: state.existing ? 2 : null, measurementValue: state.measurement ?? null, measurementUnit: state.measurementUnit ?? (state.kind === 'SEMESTER_SURVEY_ANNUAL' ? 'SCORE' : 'PERCENT'), nilaiKinerja: null,
   scoringVersion: state.scoringVersion === 'ABSENT' ? undefined : state.scoringVersion ?? 'DO_2026_V2',
  dataComplete: false, scoreComplete: false, availableMonths: [], missingMonths: [], recapRevision: state.existing ? 4 : 0,
  recapNotes: state.existing ? 'Sumber tahunan tersimpan' : null, recapStructuredInput: state.stored,
  aggregationMethod: 'EXPLICIT_YTD_REQUIRED', status: 'MISSING_DATA', ...state.saved }; }
export function configure(options = {}, notify = true) { Object.assign(state, options); if (notify) { revision++; listeners.forEach(fn => fn()); } }
export function resume() { release?.(); }
export function onSaved() { savedCalls++; }
export class ApiError extends Error {}
export const pkpStore = {
  subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); }, getSnapshot: () => revision, getServerSnapshot: () => revision,
  getSessionUser: () => state.session ? { id: state.userId, role: state.role, healthCenterId: 'fixture-center' } : null,
  getCurrentYear: () => state.year, getSelectedHealthCenterId: () => state.center,
  getSelectedHealthCenter: () => ({ name: 'Puskesmas Fixture' }), getLoadState: () => ({ loading: false, error: null }),
  getActivePeriod: () => ({ year: 2026 }), isActiveYear: year => state.active && year === 2026,
  canInputOwnPeriod: year => state.active && year === 2026 && state.center === 'fixture-center',
  isPeriodLocked: (_year, month) => state.lockedMonths.includes(month), isMutating: () => state.mutating,
  getAssignments: year => state.assigned && year === (state.assignmentYear ?? 2026) ? { [indicatorId()]: 'fixture-user' } : {},
  getIndicators: () => state.missing ? [] : [indicator()],
  savePeriodRecap: async value => {
    writes.push(structuredClone(value));
    if (state.pauseSave) await new Promise(resolve => { release = resolve; });
    if (state.failSave) throw new Error('Fixture: revisi berubah');
    state.saved = { numerator: value.numerator, denominator: value.denominator, recapStructuredInput: value.structuredInput,
      recapNotes: value.notes, recapRevision: value.expectedRevision + 1 };
  },
};
export const api = { request: async path => {
  if (path.startsWith('/analytics/period-recap?')) return { items: [item()] };
  throw new Error('Unexpected fixture request: ' + path);
} };
`;

const entrySource = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { RecapEditor } from '/src/components/data-entry/recap-editor.tsx';
import { PeriodRecapPanel } from '/src/components/data-entry/PeriodRecapPanel.tsx';
import { confirmDiscardChanges } from '/src/components/common/useUnsavedChanges.ts';
import { state, configure, indicator, item, writes, pending, resume, onSaved, savedCalls } from 'virtual:ledger-store';
import '/src/index.css';
const root = createRoot(document.getElementById('root'));
let mountKey = 0;
function mount(options = {}) {
  configure(options);
  root.render(state.view === 'panel' ? React.createElement(PeriodRecapPanel, { key: ++mountKey, year: 2026, month: state.endMonth })
    : React.createElement(RecapEditor, { key: ++mountKey, item: item(), profile: indicator().do2026, year: 2026, endMonth: state.endMonth,
      healthCenterId: 'fixture-center', readOnlyReason: state.readOnlyReason ?? null, onPendingChange: value => pending.push(value), onSaved }));
}
window.ledgerFixture = { mount, configure, writes, pending, resume, unmount: () => root.render(null),
  savedCalls: () => savedCalls, discard: () => confirmDiscardChanges('recap') };
`;

const pmeRow = (id = 'PME-1', date = '2026-03-01') => ({ eventId: id, date, organizer: 'Penyelenggara uji', program: 'Program kualitas', evidenceReference: 'https://example.invalid/sertifikat' });
const pmeStored = { kind: 'PME_ANNUAL', year: 2026, participations: [pmeRow()] };
const meetings = [
  { meetingId: 'RTM-1', date: '2026-02-01', minutesReference: 'Notulen 01' },
  { meetingId: 'RTM-2', date: '2026-08-01', minutesReference: 'Notulen 02' },
];
const recommendation = { recommendationId: 'REK-1', meetingId: 'RTM-1', description: 'Perbaiki prosedur mutu', followUpStatus: 'COMPLETED', followUpDate: '2026-03-01', followUpReference: 'Laporan tindak lanjut' };
const rtmStored = { kind: 'RTM_ANNUAL', year: 2026, meetings, recommendations: [recommendation] };
const activities = { rehydrationCounselling: 2, diarrhoeaManagement: 1, communityEducation: 0, dehydrationTreatment: 0, threeHourObservation: 0, oralitPreparation: 0 };
const lroaStored = { kind: 'LROA_ANNUAL', year: 2026, sourceReference: 'SIHEPI/PISP annual register', sourceCoverageComplete: true,
  months: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, reportStatus: i >= 9 ? 'COMPLETE' : 'ABSENT', ...(i >= 9 ? { reportReference: 'PISP month ' + (i + 1) } : {}), activityCounts: { ...activities } })) };
const surveyStored = { kind: 'SEMESTER_SURVEY_ANNUAL', year: 2026, scale: 'DOCUMENTED_100_POINT', scaleReference: 'Documented 100-point scale',
  methodCompatibilityReference: 'Compatible semester methods attested', compatibleMethodsConfirmed: true,
  semesters: [{ semester: 1, value: 80, methodReference: 'Method I', reportReference: 'Report I' }, { semester: 2, value: 84, methodReference: 'Method II', reportReference: 'Report II' }] };
const tbStored = { kind: 'TB_COHORT_ANNUAL', year: 2026, cohort: { type: 'TB_TREATED_RECORDED_REPORTED', year: 2025, cohortReference: '2025 cohort', sourceSystem: 'SITB',
  sourceReference: 'SITB register 2025', originalDenominator: 100, successfulCount: 90, outcomeDefinition: 'CURED_OR_TREATMENT_COMPLETED', outcomeAssessmentReference: 'Linked outcome assessment',
  complete: true, originalDenominatorAndOutcomeLinkageAttested: true, distinctSuccessfulPatientsAttested: true } };
const leprosyStored = { kind: 'LEPROSY_COHORT_ANNUAL', year: 2026, cohorts: [
  { type: 'PB', year: 2025, cohortReference: 'PB 2025', sourceSystem: 'SIPK', sourceReference: 'SIPK PB register', originalNewCaseStarts: 10, completedCount: 10, prescribedPeriodReference: 'PB prescribed treatment period', outcomeAssessmentReference: 'PB linked outcomes', matureAndComplete: true, originalDenominatorAndOutcomeLinkageAttested: true },
  { type: 'MB', year: 2024, cohortReference: 'MB 2024', sourceSystem: 'SIPK', sourceReference: 'SIPK MB register', originalNewCaseStarts: 90, completedCount: 72, prescribedPeriodReference: 'MB prescribed treatment period', outcomeAssessmentReference: 'MB linked outcomes', matureAndComplete: true, originalDenominatorAndOutcomeLinkageAttested: true },
] };
const annualCases = [
  { stored: lroaStored, id: 'K2-R44', numerator: 1, denominator: 4, field: 'Referensi sumber LROA setahun', original: lroaStored.sourceReference },
  { stored: surveyStored, id: 'K1-R39', numerator: 164, denominator: 2, field: 'Referensi skala 100 poin terdokumentasi', original: surveyStored.scaleReference },
  { stored: tbStored, id: 'K4-R16', numerator: 90, denominator: 100, field: 'Referensi kohort TBC', original: tbStored.cohort.cohortReference },
  { stored: leprosyStored, id: 'K4-R20', numerator: 82, denominator: 100, field: 'Referensi kohort kusta', original: leprosyStored.cohorts[0].cohortReference },
];

test('six structured annual ledgers in real frontend components', async t => {
  const cacheDir = await mkdtemp('/tmp/opencode/structured-recaps-vite-');
  let server, browser;
  try {
    server = await createServer({
      root: fileURLToPath(new URL('..', import.meta.url)), configFile: false, envFile: false, cacheDir,
      plugins: [{
        name: 'structured-recap-fixture', enforce: 'pre',
        resolveId(id) {
          if (id === '/ledger-fixture.jsx') return '\0ledger-fixture.jsx';
          if (id === 'virtual:ledger-store' || /(?:^|\/)(?:apiStore|apiClient)(?:\.ts)?$/.test(id)) return '\0ledger-store';
        },
        load(id) {
          if (id === '\0ledger-fixture.jsx') return entrySource;
          if (id === '\0ledger-store') return storeSource;
        },
        configureServer(vite) {
          vite.middlewares.use('/ledger-test', async (_req, res) => {
            res.setHeader('Content-Type', 'text/html');
            res.end(await vite.transformIndexHtml('/ledger-test', '<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/ledger-fixture.jsx"></script></body></html>'));
          });
        },
      }, react()],
      server: { host: '127.0.0.1', port: 0 },
      optimizeDeps: { noDiscovery: true, include: ['react', 'react-dom/client', 'react/jsx-dev-runtime', 'lucide-react'] },
    });
    await server.listen();
    browser = await chromium.launch({ headless: true });
    const origin = new URL(server.resolvedUrls.local[0]).origin;
    async function fixture(options, run, width = 375) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      page.setDefaultTimeout(10000);
      const errors = [], external = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin !== origin || url.pathname.startsWith('/api/')) { external.push(url.href); return route.abort(); }
        return route.continue();
      });
      try {
        await page.goto(origin + '/ledger-test');
        await page.waitForFunction(() => window.ledgerFixture).catch(error => { assert.deepEqual(errors, []); throw error; });
        await page.evaluate(options => window.ledgerFixture.mount(options), options);
        if (options.view === 'panel') await page.getByText('Rekap Kumulatif & Tahunan', { exact: true }).click();
        await page.getByText('Isi atau perbarui rekap terpisah', { exact: true }).click();
        await run(page);
        assert.deepEqual(errors, []);
        assert.deepEqual(external, []);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      } finally { await page.close(); }
    }
    const submit = page => page.locator('form').evaluate(form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    const noWrites = async page => assert.deepEqual(await page.evaluate(() => window.ledgerFixture.writes), []);
    const notes = page => page.getByRole('textbox', { name: 'Sumber dan cara menyusun rekap (wajib)', exact: true });
    const saveButton = page => page.getByRole('button', { name: 'Simpan rekap terpisah', exact: true });
    async function attest(page) {
      await notes(page).fill('Register independen Januari-Desember 2026; nihil bila daftar kosong, deduplikasi diperiksa.');
      await page.getByRole('checkbox', { name: /^Saya telah merekonsiliasi/ }).check();
    }
    async function addPme(page, row = pmeRow()) {
      await page.getByRole('button', { name: 'Tambah kegiatan PME', exact: true }).click();
      const group = page.getByRole('group', { name: /^Kegiatan PME \d+$/ }).last();
      for (const [label, key] of [['ID kegiatan', 'eventId'], ['Tanggal kegiatan', 'date'], ['Penyelenggara', 'organizer'], ['Program PME', 'program'], ['Referensi sertifikat/hasil', 'evidenceReference']]) await group.getByLabel(label, { exact: true }).fill(row[key]);
    }
    async function addRtm(page) {
      for (const row of meetings) {
        await page.getByRole('button', { name: 'Tambah rapat RTM', exact: true }).click();
        const group = page.getByRole('group', { name: /^Rapat RTM \d+$/ }).last();
        await group.getByLabel('ID rapat', { exact: true }).fill(row.meetingId);
        await group.getByLabel('Tanggal rapat', { exact: true }).fill(row.date);
        await group.getByLabel('Referensi notulen', { exact: true }).fill(row.minutesReference);
      }
      await page.getByRole('button', { name: 'Tambah rekomendasi RTM', exact: true }).click();
      await page.getByLabel('ID rekomendasi', { exact: true }).fill(recommendation.recommendationId);
      await page.getByLabel('Rapat asal', { exact: true }).selectOption('RTM-1');
      await page.getByLabel('Uraian rekomendasi', { exact: true }).fill(recommendation.description);
      await page.getByLabel('Status tindak lanjut', { exact: true }).selectOption('COMPLETED');
      await page.getByLabel('Tanggal tindak lanjut', { exact: true }).fill(recommendation.followUpDate);
      await page.getByLabel('Referensi tindak lanjut', { exact: true }).fill(recommendation.followUpReference);
    }

    async function fillAnnual(page, stored) {
      const fill = async (scope, label, value) => scope.getByLabel(label, { exact: true }).fill(String(value));
      if (stored.kind === 'LROA_ANNUAL') {
        await fill(page, 'Referensi sumber LROA setahun', stored.sourceReference);
        const groups = page.getByRole('group', { name: /\(TW \d\)/ });
        const labels = ['Konseling rehidrasi oral dan zinc', 'Tatalaksana diare', 'Sosialisasi dan kapasitas masyarakat', 'Pelayanan dehidrasi ringan-sedang', 'Observasi dehidrasi ringan-sedang minimal tiga jam', 'Edukasi penyiapan dan jumlah oralit'];
        for (const [index, row] of stored.months.entries()) {
          const group = groups.nth(index);
          await group.getByLabel('Status laporan', { exact: true }).selectOption(row.reportStatus);
          if (row.reportReference) await fill(group, 'Referensi laporan bulanan', row.reportReference);
          for (const [i, count] of Object.values(row.activityCounts).entries()) await fill(group, labels[i], count);
        }
      } else if (stored.kind === 'SEMESTER_SURVEY_ANNUAL') {
        await fill(page, 'Referensi skala 100 poin terdokumentasi', stored.scaleReference);
        await fill(page, 'Referensi kompatibilitas metode', stored.methodCompatibilityReference);
        for (const row of stored.semesters) {
          const group = page.getByRole('group', { name: 'Semester ' + row.semester + ' - 2026', exact: true });
          await fill(group, 'Nilai survei (poin)', row.value);
          await fill(group, 'Referensi metode semester', row.methodReference);
          await fill(group, 'Referensi laporan semester', row.reportReference);
        }
      } else if (stored.kind === 'TB_COHORT_ANNUAL') {
        for (const [label, key] of [['Referensi kohort TBC', 'cohortReference'], ['Referensi sumber SITB', 'sourceReference'], ['Denominator awal kohort TBC', 'originalDenominator'], ['Pasien berhasil berbeda (sembuh atau pengobatan lengkap)', 'successfulCount'], ['Referensi penilaian hasil TBC', 'outcomeAssessmentReference']]) await fill(page, label, stored.cohort[key]);
      } else {
        for (const row of stored.cohorts) {
          const group = page.getByRole('group', { name: new RegExp('^' + row.type + ' - kohort') });
          for (const [label, key] of [['Referensi kohort kusta', 'cohortReference'], ['Referensi sumber SIPK', 'sourceReference'], ['Kasus baru awal mulai pengobatan', 'originalNewCaseStarts'], ['Jumlah selesai pengobatan', 'completedCount'], ['Referensi periode pengobatan yang ditetapkan', 'prescribedPeriodReference'], ['Referensi penilaian hasil kusta', 'outcomeAssessmentReference']]) await fill(group, label, row[key]);
        }
      }
      for (const checkbox of await page.getByRole('checkbox').all()) await checkbox.check();
      await attest(page);
    }

    for (const [index, scenario] of annualCases.entries()) {
      const { stored, id, numerator, denominator, field, original } = scenario;
      const kind = stored.kind;
      await t.test(kind + ' starts unknown, accepts real fixed-row inputs and saves exact V2 annual payload', () => fixture({ kind }, async page => {
        assert.equal(await page.getByRole('checkbox', { checked: true }).count(), 0);
        assert.equal(await page.locator('input[readonly]').count(), 2);
        assert.equal(await page.locator('input[type="date"]').count(), 0);
        assert.equal(await page.getByLabel('Pembilang ledger (N)', { exact: true }).inputValue(), '');
        if (kind === 'LROA_ANNUAL') {
          assert.equal(await page.getByRole('group', { name: /\(TW \d\)/ }).count(), 12);
          assert.equal(await page.getByLabel('Tatalaksana diare', { exact: true }).first().inputValue(), '');
          assert.equal(await page.getByLabel('Status laporan', { exact: true }).first().inputValue(), '');
          await page.getByText(/Ini bukan aturan triwulan universal/).waitFor();
        }
        if (kind === 'TB_COHORT_ANNUAL') await page.getByRole('group', { name: 'TBC - kohort 2025 (Y-1), SITB', exact: true }).waitFor();
        if (kind === 'LEPROSY_COHORT_ANNUAL') {
          await page.getByRole('group', { name: 'PB - kohort 2025 (Y-1), SIPK', exact: true }).waitFor();
          await page.getByRole('group', { name: 'MB - kohort 2024 (Y-2), SIPK', exact: true }).waitFor();
        }
        await fillAnnual(page, stored);
        assert.equal(await page.getByLabel('Pembilang ledger (N)', { exact: true }).inputValue(), String(numerator));
        assert.equal(await page.getByLabel('Penyebut ledger (D)', { exact: true }).inputValue(), String(denominator));
        await saveButton(page).click();
        await page.waitForFunction(() => window.ledgerFixture.writes.length === 1);
        assert.deepEqual(await page.evaluate(() => window.ledgerFixture.writes[0]), {
          year: 2026, endMonth: 12, indicatorId: id, numerator, denominator,
          notes: 'Register independen Januari-Desember 2026; nihil bila daftar kosong, deduplikasi diperiksa.', confirmed: true, expectedRevision: 0, structuredInput: stored,
        });
      }, index % 2 ? 375 : 1280));

      await t.test(kind + ' filled form fits 375px without horizontal overflow', () => fixture({ kind, view: 'panel' }, async page => {
        await fillAnnual(page, stored);
        assert.equal(await saveButton(page).isEnabled(), true);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        await noWrites(page);
      }, 375));

      await t.test(kind + ' preserves/reset dirty ledger drafts through cancelled navigation', () => fixture({ kind, stored, existing: true, view: 'panel' }, async page => {
        await page.getByLabel(field, { exact: true }).first().fill('DRAFT-REFERENCE');
        page.once('dialog', dialog => dialog.dismiss());
        await page.getByLabel('Akhir periode rekap').selectOption('11');
        assert.equal(await page.getByLabel('Akhir periode rekap').inputValue(), '12');
        page.once('dialog', dialog => dialog.accept());
        await page.getByText('Isi atau perbarui rekap terpisah', { exact: true }).click();
        await page.getByText('Isi atau perbarui rekap terpisah', { exact: true }).click();
        assert.equal(await page.getByLabel(field, { exact: true }).first().inputValue(), original);
        assert.equal(await page.evaluate(() => window.ledgerFixture.discard()), true);
      }));

      for (const change of [{ liveKind: 'ABSENT' }, { liveKind: 'PME_ANNUAL' }, { held: true }, { missing: true }, { annual: false }, { unitOverride: 'COUNT' }, { numericOverride: 'ESTIMATED' }]) {
        await t.test(kind + ' retains draft and blocks changed live contract ' + JSON.stringify(change), () => fixture({ kind, stored, existing: true, view: 'panel' }, async page => {
          await page.getByLabel(field, { exact: true }).first().fill('DRAFT-REFERENCE'); await attest(page);
          await page.evaluate(change => window.ledgerFixture.configure(change), change);
          assert.equal(await page.getByLabel(field, { exact: true }).first().inputValue(), 'DRAFT-REFERENCE');
          assert.equal(await saveButton(page).isDisabled(), true);
          await submit(page); await noWrites(page);
        }));
      }
      for (const change of [{ role: 'DINKES_ADMIN' }, { assigned: false }, { assignmentYear: 2025 }, { lockedMonths: [6] }, { center: 'other' }, { year: 2027 }, { active: false }, { session: false }, { userId: 'other-user' }]) {
        await t.test(kind + ' rechecks live permission/assignment-year/tenant/year/locks ' + JSON.stringify(change), () => fixture({ kind, stored, existing: true, role: 'PIC' }, async page => {
          await attest(page);
          await page.evaluate(change => window.ledgerFixture.configure(change, false), change);
          await submit(page); await noWrites(page);
          assert.equal(await page.getByLabel(field, { exact: true }).first().inputValue(), original);
        }));
      }
      for (const options of [{ endMonth: 11 }, { readOnlyReason: 'Fixture hanya baca' }, { idOverride: 'generic' }, { liveKind: 'ABSENT' }, { annual: false }]) {
        await t.test(kind + ' initial readonly/identity/annual contract cannot be bypassed ' + JSON.stringify(options), () => fixture({ kind, stored, existing: true, ...options }, async page => {
          assert.equal(await saveButton(page).isDisabled(), true); await submit(page); await noWrites(page);
        }));
      }
      for (const bad of [null, { ...stored, extra: 'preserve me' }, { ...stored, year: 2027 }, { ...stored, kind: 'FUTURE_LEDGER' }]) {
        await t.test(kind + ' refuses replacing missing/unknown stored payload ' + JSON.stringify(bad?.kind) + '/' + !!bad?.extra + '/' + bad?.year, () => fixture({ kind, stored: bad, existing: true }, async page => {
          assert.equal(await saveButton(page).isDisabled(), true); await submit(page); await noWrites(page);
          await page.getByRole('status').filter({ hasText: /Format ledger tersimpan/ }).waitFor();
        }));
      }
      await t.test(kind + ' pending save cleanup on unmount does not call stale callbacks', () => fixture({ kind, stored, existing: true, pauseSave: true }, async page => {
        await attest(page); await saveButton(page).click();
        await page.waitForFunction(() => window.ledgerFixture.pending.includes(true));
        await submit(page); assert.equal(await page.evaluate(() => window.ledgerFixture.writes.length), 1);
        await page.evaluate(() => window.ledgerFixture.unmount());
        await page.waitForFunction(() => window.ledgerFixture.pending.at(-1) === false);
        await page.evaluate(() => window.ledgerFixture.resume());
        await page.waitForTimeout(30); assert.equal(await page.evaluate(() => window.ledgerFixture.savedCalls()), 0);
      }));
      await t.test(kind + ' blocks missing source references and unchecked per-profile attestations', () => fixture({ kind, stored, existing: true }, async page => {
        await attest(page);
        for (const attestation of await page.getByRole('checkbox').all()) {
          await attestation.uncheck(); await submit(page); await noWrites(page);
          await attestation.check();
        }
        await page.getByLabel(field, { exact: true }).first().fill('');
        await submit(page); await noWrites(page);
      }));
    }

    await t.test('survey exact four-place sum, readonly N/D and SCORE presentation stay separate from performance score', () => fixture({ kind: 'SEMESTER_SURVEY_ANNUAL', stored: surveyStored, existing: true, view: 'panel', measurement: 82 }, async page => {
      await page.getByText('82 poin', { exact: true }).waitFor();
      assert.equal(await page.getByText('82%', { exact: true }).count(), 0);
      await page.getByLabel('Nilai survei (poin)', { exact: true }).nth(0).fill('0.1');
      await page.getByLabel('Nilai survei (poin)', { exact: true }).nth(1).fill('0.2');
      await attest(page); assert.equal(await page.getByLabel('Pembilang ledger (N)', { exact: true }).inputValue(), '0.3');
      await saveButton(page).click(); await page.waitForFunction(() => window.ledgerFixture.writes.length === 1);
      const payload = await page.evaluate(() => window.ledgerFixture.writes[0]);
      assert.equal(payload.numerator, 0.3); assert.equal(payload.denominator, 2);
      assert.equal('nilaiKinerja' in payload, false);
    }));
    await t.test('survey boundary mean renders 77,99995 poin rather than rounding up to 78', () => fixture({
      kind: 'SEMESTER_SURVEY_ANNUAL', stored: surveyStored, existing: true, view: 'panel', measurement: 77.99995,
    }, async page => {
      const result = page.getByRole('region', { name: 'Hasil rekap indikator' });
      assert.equal(await result.locator('dd').nth(2).innerText(), '77,99995 poin');
      assert.equal(await result.getByText('78 poin', { exact: true }).count(), 0);
      assert.equal(await result.locator('dd').nth(3).innerText(), '-');
      await page.getByLabel('Nilai survei (poin)', { exact: true }).nth(0).fill('77.9999');
      await page.getByLabel('Nilai survei (poin)', { exact: true }).nth(1).fill('78');
      await attest(page);
      assert.equal(await page.getByLabel('Pembilang ledger (N)', { exact: true }).inputValue(), '155.9999');
      await saveButton(page).click();
      await page.waitForFunction(() => window.ledgerFixture.writes.length === 1);
      const payload = await page.evaluate(() => window.ledgerFixture.writes[0]);
      assert.equal(payload.numerator, 155.9999);
      assert.equal(payload.denominator, 2);
    }));
    for (const options of [{ scoringVersion: 'ILP_2026_V1' }, { scoringVersion: 'ABSENT' }, { idOverride: 'generic' },
      { measurementUnit: 'PERCENT' }, { kind: 'TB_COHORT_ANNUAL', measurementUnit: 'SCORE' }]) {
      await t.test('five-decimal survey display does not alter other response formats ' + JSON.stringify(options), () => fixture({
        kind: 'SEMESTER_SURVEY_ANNUAL', stored: surveyStored, existing: true, view: 'panel', measurement: 77.99995, ...options,
      }, async page => {
        const result = page.getByRole('region', { name: 'Hasil rekap indikator' });
        assert.equal(await result.locator('dd').nth(2).innerText(), options.measurementUnit === 'PERCENT' ? '78%' : '78 poin');
        await noWrites(page);
      }));
    }
    for (const invalid of ['', '-1', '100.0001', '80.12345', '1e2', 'NaN', '0,5']) {
      await t.test('survey preserves invalid scalar draft and blocks save: ' + JSON.stringify(invalid), () => fixture({ kind: 'SEMESTER_SURVEY_ANNUAL', stored: surveyStored, existing: true }, async page => {
        const input = page.getByLabel('Nilai survei (poin)', { exact: true }).first();
        await input.fill(invalid); await attest(page); await submit(page); await noWrites(page);
        assert.equal(await input.inputValue(), invalid); assert.equal(await saveButton(page).isDisabled(), true);
      }));
    }
    for (const [stored, label] of [[tbStored, 'Pasien berhasil berbeda (sembuh atau pengobatan lengkap)'], [leprosyStored, 'Jumlah selesai pengobatan']]) {
      for (const invalid of ['', '101', '1.5', '10000000000', '-1']) {
        await t.test(stored.kind + ' preserves invalid count/N>D draft ' + JSON.stringify(invalid), () => fixture({ kind: stored.kind, stored, existing: true }, async page => {
          const input = page.getByLabel(label, { exact: true }).first();
          await input.fill(invalid); await attest(page); await submit(page); await noWrites(page);
          assert.equal(await input.inputValue(), invalid);
        }));
      }
    }
    await t.test('LROA incomplete third month does not qualify the quarter and retains explicit activity counts', () => fixture({ kind: 'LROA_ANNUAL', stored: lroaStored, existing: true }, async page => {
      await page.getByLabel('Status laporan', { exact: true }).nth(11).selectOption('INCOMPLETE');
      await attest(page); assert.equal(await page.getByLabel('Pembilang ledger (N)', { exact: true }).inputValue(), '0');
      await saveButton(page).click(); await page.waitForFunction(() => window.ledgerFixture.writes.length === 1);
      const payload = await page.evaluate(() => window.ledgerFixture.writes[0]);
      assert.equal(payload.numerator, 0); assert.equal(payload.denominator, 4);
      assert.deepEqual(payload.structuredInput.months[11].activityCounts, activities);
    }));
    await t.test('LROA requires all six explicit counts even when a report is absent', () => fixture({ kind: 'LROA_ANNUAL', stored: lroaStored, existing: true }, async page => {
      const input = page.getByLabel('Tatalaksana diare', { exact: true }).first();
      await input.fill(''); await attest(page); await submit(page); await noWrites(page);
      assert.equal(await input.inputValue(), '');
      await input.fill('0'); await saveButton(page).click();
      await page.waitForFunction(() => window.ledgerFixture.writes.length === 1);
      assert.equal(await page.evaluate(() => window.ledgerFixture.writes[0].structuredInput.months[0].activityCounts.diarrhoeaManagement), 0);
    }));
    await t.test('LROA complete reports alone cannot replace two positive activities every month', () => fixture({ kind: 'LROA_ANNUAL', stored: lroaStored, existing: true }, async page => {
      await page.getByLabel('Tatalaksana diare', { exact: true }).nth(11).fill('0'); await attest(page);
      assert.equal(await page.getByLabel('Pembilang ledger (N)', { exact: true }).inputValue(), '0');
      await saveButton(page).click(); await page.waitForFunction(() => window.ledgerFixture.writes.length === 1);
      assert.equal(await page.evaluate(() => window.ledgerFixture.writes[0].numerator), 0);
    }));
    const malformedAnnual = [
      [lroaStored, { ...lroaStored, months: lroaStored.months.slice(1) }],
      [lroaStored, { ...lroaStored, months: lroaStored.months.map((row, i) => i === 11 ? { ...row, month: 11 } : row) }],
      [lroaStored, { ...lroaStored, months: lroaStored.months.map((row, i) => i === 11 ? { ...row, reportReference: undefined } : row) }],
      [lroaStored, { ...lroaStored, months: lroaStored.months.map((row, i) => i === 0 ? { ...row, activityCounts: { ...activities, extra: 0 } } : row) }],
      [surveyStored, { ...surveyStored, scale: '0_TO_1' }],
      [surveyStored, { ...surveyStored, semesters: [surveyStored.semesters[0]] }],
      [surveyStored, { ...surveyStored, semesters: [surveyStored.semesters[0], surveyStored.semesters[0]] }],
      [surveyStored, { ...surveyStored, semesters: surveyStored.semesters.map(row => ({ ...row, value: String(row.value) })) }],
      [surveyStored, { ...surveyStored, compatibleMethodsConfirmed: false }],
      [tbStored, { ...tbStored, cohort: { ...tbStored.cohort, year: 2026 } }],
      [tbStored, { ...tbStored, cohort: { ...tbStored.cohort, sourceSystem: 'SIPK' } }],
      [tbStored, { ...tbStored, cohort: { ...tbStored.cohort, originalDenominatorAndOutcomeLinkageAttested: false } }],
      [tbStored, { ...tbStored, cohort: { ...tbStored.cohort, distinctSuccessfulPatientsAttested: false } }],
      [tbStored, { ...tbStored, cohort: { ...tbStored.cohort, extra: 'must preserve' } }],
      [leprosyStored, { ...leprosyStored, cohorts: leprosyStored.cohorts.map(row => ({ ...row, year: 2026 })) }],
      [leprosyStored, { ...leprosyStored, cohorts: leprosyStored.cohorts.map(row => ({ ...row, prescribedPeriodReference: '' })) }],
      [leprosyStored, { ...leprosyStored, cohorts: [leprosyStored.cohorts[0], leprosyStored.cohorts[0]] }],
      [leprosyStored, { ...leprosyStored, cohorts: leprosyStored.cohorts.map(row => ({ ...row, matureAndComplete: false })) }],
      [leprosyStored, { ...leprosyStored, cohorts: leprosyStored.cohorts.map(row => ({ ...row, completedCount: 1000 })) }],
      [leprosyStored, { ...leprosyStored, cohorts: leprosyStored.cohorts.map(row => ({ ...row, originalNewCaseStarts: 9_999_999_999 })) }],
    ];
    for (const [index, [base, stored]] of malformedAnnual.entries()) {
      await t.test(base.kind + ' preserves malformed stored ledger without overwrite #' + index, () => fixture({ kind: base.kind, stored, existing: true }, async page => {
        assert.equal(await saveButton(page).isDisabled(), true); await submit(page); await noWrites(page);
      }));
    }

    await t.test('PME derives 3/2 without capping above 100 and submits exact scoped ledger', () => fixture({}, async page => {
      for (let i = 1; i <= 3; i++) await addPme(page, pmeRow('PME-' + i, '2026-03-0' + i));
      for (const [label, value] of [['Pembilang ledger (N)', '3'], ['Penyebut ledger (D)', '2']]) {
        const field = page.getByLabel(label, { exact: true });
        assert.equal(await field.inputValue(), value);
        assert.equal(await field.evaluate(el => el.readOnly), true);
      }
      await page.getByText(/Capaian di atas 100% sah/).waitFor();
      await page.getByText(/Jangan isi nama, NIK/).waitFor();
      assert.equal(await page.locator('a[href^="https://example.invalid"]').count(), 0);
      await attest(page);
      await saveButton(page).click();
      await page.waitForFunction(() => window.ledgerFixture.writes.length === 1);
      const [payload] = await page.evaluate(() => window.ledgerFixture.writes);
      assert.deepEqual(payload, { year: 2026, endMonth: 12, indicatorId: 'K5-R38', numerator: 3, denominator: 2,
        notes: 'Register independen Januari-Desember 2026; nihil bila daftar kosong, deduplikasi diperiksa.', confirmed: true, expectedRevision: 0,
        structuredInput: { kind: 'PME_ANNUAL', year: 2026, participations: [1, 2, 3].map(i => pmeRow('PME-' + i, '2026-03-0' + i)) } });
      assert.equal('nilaiKinerja' in payload, false);
    }, 1280));

    await t.test('RTM derives recommendations, not meetings; unfinished rows omit completed evidence', () => fixture({ kind: 'RTM_ANNUAL', role: 'PIC' }, async page => {
      await addRtm(page);
      await page.getByRole('button', { name: 'Tambah rekomendasi RTM', exact: true }).click();
      const second = page.getByRole('group', { name: 'Rekomendasi RTM 2', exact: true });
      await second.getByLabel('ID rekomendasi', { exact: true }).fill('REK-2');
      await second.getByLabel('Rapat asal', { exact: true }).selectOption('RTM-2');
      await second.getByLabel('Uraian rekomendasi', { exact: true }).fill('Tinjau ulang');
      assert.equal(await second.getByLabel('Tanggal tindak lanjut', { exact: true }).count(), 0);
      assert.equal(await page.getByLabel('Pembilang ledger (N)', { exact: true }).inputValue(), '1');
      assert.equal(await page.getByLabel('Penyebut ledger (D)', { exact: true }).inputValue(), '2');
      await attest(page); await saveButton(page).click();
      await page.waitForFunction(() => window.ledgerFixture.writes.length === 1);
      const [payload] = await page.evaluate(() => window.ledgerFixture.writes);
      assert.equal(payload.indicatorId, 'K1-R40');
      assert.equal(payload.numerator, 1); assert.equal(payload.denominator, 2);
      assert.deepEqual(payload.structuredInput, { kind: 'RTM_ANNUAL', year: 2026, meetings,
        recommendations: [recommendation, { recommendationId: 'REK-2', meetingId: 'RTM-2', description: 'Tinjau ulang', followUpStatus: 'NOT_COMPLETED' }] });
    }));

    for (const kind of ['PME_ANNUAL', 'RTM_ANNUAL']) {
      const stored = kind === 'PME_ANNUAL' ? pmeStored : rtmStored;
      const idLabel = kind === 'PME_ANNUAL' ? 'ID kegiatan' : 'ID rekomendasi';
      const originalId = kind === 'PME_ANNUAL' ? 'PME-1' : 'REK-1';
      await t.test(kind + ' empty ledger requires source and explicit annual confirmation, then saves zero', () => fixture({ kind }, async page => {
        await submit(page); await noWrites(page);
        await page.getByRole('checkbox').check();
        await submit(page);
        await page.getByRole('alert').filter({ hasText: /catatan sumber/ }).waitFor(); await noWrites(page);
        await attest(page); await saveButton(page).click();
        await page.waitForFunction(() => window.ledgerFixture.writes.length === 1);
        const [payload] = await page.evaluate(() => window.ledgerFixture.writes);
        assert.equal(payload.numerator, 0); assert.equal(payload.denominator, kind === 'PME_ANNUAL' ? 2 : 0);
        assert.deepEqual(payload.structuredInput, kind === 'PME_ANNUAL' ? { kind, year: 2026, participations: [] } : { kind, year: 2026, meetings: [], recommendations: [] });
      }));
      await t.test(kind + ' restores existing ledger, cancel resets both ledger/counts and notes', () => fixture({ kind, existing: true, stored }, async page => {
        assert.equal(await page.getByLabel(idLabel, { exact: true }).inputValue(), originalId);
        await page.getByLabel(idLabel, { exact: true }).fill('DRAFT-ID');
        if (kind === 'PME_ANNUAL') await addPme(page, pmeRow('PME-2', '2026-05-01'));
        else await page.getByRole('button', { name: 'Hapus rekomendasi 1', exact: true }).click();
        await attest(page);
        page.once('dialog', dialog => dialog.dismiss());
        await page.getByText('Isi atau perbarui rekap terpisah', { exact: true }).click();
        assert.equal(await notes(page).isVisible(), true);
        page.once('dialog', dialog => dialog.accept());
        await page.getByText('Isi atau perbarui rekap terpisah', { exact: true }).click();
        await page.getByText('Isi atau perbarui rekap terpisah', { exact: true }).click();
        assert.equal(await page.getByLabel(idLabel, { exact: true }).inputValue(), originalId);
        assert.equal(await page.getByLabel('Pembilang ledger (N)', { exact: true }).inputValue(), '1');
        assert.equal(await page.getByLabel('Penyebut ledger (D)', { exact: true }).inputValue(), kind === 'PME_ANNUAL' ? '2' : '1');
        assert.equal(await notes(page).inputValue(), 'Sumber tahunan tersimpan');
        assert.equal(await page.getByRole('checkbox').isChecked(), false);
        await attest(page); await saveButton(page).click();
        await page.waitForFunction(() => window.ledgerFixture.writes.length === 1);
        const [payload] = await page.evaluate(() => window.ledgerFixture.writes);
        assert.equal(payload.expectedRevision, 4); assert.deepEqual(payload.structuredInput, stored);
      }));
      await t.test(kind + ' row-only edits protect scoped navigation and do not dirty after cancel', () => fixture({ kind, view: 'panel' }, async page => {
        await page.getByRole('button', { name: kind === 'PME_ANNUAL' ? 'Tambah kegiatan PME' : 'Tambah rapat RTM', exact: true }).click();
        const period = page.getByLabel('Akhir periode rekap');
        page.once('dialog', dialog => dialog.dismiss());
        await period.selectOption('11'); assert.equal(await period.inputValue(), '12');
        page.once('dialog', dialog => dialog.accept());
        await page.getByText('Isi atau perbarui rekap terpisah', { exact: true }).click();
        assert.equal(await page.evaluate(() => window.ledgerFixture.discard()), true);
        await period.selectOption('11');
        await page.getByText('Isi atau perbarui rekap terpisah', { exact: true }).click();
        assert.equal(await saveButton(page).isDisabled(), true);
        await submit(page); await noWrites(page);
      }));
      for (const change of [{ liveKind: 'FUTURE_LEDGER' }, { liveKind: 'ABSENT' }, { liveKind: kind === 'PME_ANNUAL' ? 'RTM_ANNUAL' : 'PME_ANNUAL' }, { held: true }, { missing: true }, { annual: false }]) {
        await t.test(kind + ' retains drafts and blocks changed live metadata ' + JSON.stringify(change), () => fixture({ kind, existing: true, stored, view: 'panel' }, async page => {
          await page.getByLabel(idLabel, { exact: true }).fill('DRAFT-ID');
          await attest(page);
          await page.evaluate(change => window.ledgerFixture.configure(change), change);
          assert.equal(await saveButton(page).isDisabled(), true);
          assert.equal(await page.getByLabel(idLabel, { exact: true }).inputValue(), 'DRAFT-ID');
          await submit(page); await page.getByRole('alert').waitFor(); await noWrites(page);
        }));
      }
      await t.test(kind + ' checks fresh metadata even without a store notification', () => fixture({ kind, existing: true, stored }, async page => {
        await attest(page);
        await page.evaluate(() => window.ledgerFixture.configure({ liveKind: 'FUTURE_LEDGER' }, false));
        await submit(page); await page.getByRole('alert').filter({ hasText: /Profil atau ledger sumber berubah/ }).waitFor(); await noWrites(page);
      }));
      for (const change of [{ role: 'DINKES_ADMIN' }, { assigned: false }, { lockedMonths: [1] }, { center: 'other-center' }, { year: 2025 }, { active: false }, { session: false }, { userId: 'other-user' }, { mutating: true }]) {
        await t.test(kind + ' respects live session/permission/scope/lock guard ' + JSON.stringify(change), () => fixture({ kind, role: 'PIC', existing: true, stored }, async page => {
          await attest(page);
          await page.evaluate(change => window.ledgerFixture.configure(change), change);
          assert.equal(await saveButton(page).isDisabled(), true);
          await submit(page); await noWrites(page);
          assert.equal(await page.getByLabel(idLabel, { exact: true }).inputValue(), originalId);
        }));
      }
      for (const bad of [{ ...stored, extra: 'future field' }, { ...stored, year: 2025 }, { ...stored, kind: 'FUTURE_LEDGER' }, null]) {
        await t.test(kind + ' never silently replaces unsupported/missing stored ledger ' + JSON.stringify(bad?.kind ?? null) + '/' + (bad?.year ?? '' ) + '/' + !!bad?.extra, () => fixture({ kind, existing: true, stored: bad }, async page => {
          assert.equal(await saveButton(page).isDisabled(), true);
          await page.getByRole('status').filter({ hasText: /Format ledger tersimpan/ }).waitFor();
          await submit(page); await noWrites(page);
        }));
      }
      await t.test(kind + ' pending save tracks state, prevents double writes/discard, and clears on unmount', () => fixture({ kind, pauseSave: true }, async page => {
        await attest(page); await saveButton(page).click();
        await page.waitForFunction(() => window.ledgerFixture.pending.includes(true));
        await submit(page);
        assert.equal(await page.evaluate(() => window.ledgerFixture.writes.length), 1);
        await page.getByText('Isi atau perbarui rekap terpisah', { exact: true }).click();
        assert.equal(await notes(page).isVisible(), true);
        await page.evaluate(() => window.ledgerFixture.unmount());
        await page.waitForFunction(() => window.ledgerFixture.pending.at(-1) === false);
        assert.equal(await page.evaluate(() => window.ledgerFixture.discard()), true);
        await page.evaluate(() => window.ledgerFixture.resume());
        await page.waitForTimeout(30);
        assert.equal(await page.evaluate(() => window.ledgerFixture.savedCalls()), 0);
      }));
      await t.test(kind + ' failed save retains draft and remains retryable', () => fixture({ kind, existing: true, stored, failSave: true }, async page => {
        await page.getByLabel(idLabel, { exact: true }).fill('DRAFT-ID'); await attest(page);
        await saveButton(page).click();
        await page.getByRole('alert').filter({ hasText: /revisi berubah/ }).waitFor();
        assert.equal(await page.getByLabel(idLabel, { exact: true }).inputValue(), 'DRAFT-ID');
        assert.equal(await saveButton(page).isEnabled(), true);
      }));
    }

    for (const label of ['ID kegiatan', 'Tanggal kegiatan', 'Penyelenggara', 'Program PME', 'Referensi sertifikat/hasil']) {
      await t.test('PME requires ' + label, () => fixture({}, async page => {
        await addPme(page); await attest(page);
        await page.getByLabel(label, { exact: true }).fill('');
        await submit(page); await page.getByRole('alert').waitFor(); await noWrites(page);
      }));
    }
    for (const [row, message] of [
      [pmeRow('ＰＭＥ-１', '2026-04-01'), /ID kegiatan duplikat/],
      [{ ...pmeRow('PME-2'), organizer: '  PENYELENGGARA UJI  ', program: 'PROGRAM KUALITAS' }, /Kegiatan duplikat/],
      [pmeRow('PME-2', '2025-04-01'), /tahun rekap 2026/],
    ]) {
      await t.test('PME validates duplicate/calendar constraints ' + message, () => fixture({}, async page => {
        await addPme(page); await addPme(page, row); await attest(page);
        await submit(page); await page.getByRole('alert').filter({ hasText: message }).waitFor(); await noWrites(page);
      }));
    }
    for (const label of ['ID rapat', 'Tanggal rapat', 'Referensi notulen', 'ID rekomendasi', 'Rapat asal', 'Uraian rekomendasi', 'Tanggal tindak lanjut', 'Referensi tindak lanjut']) {
      await t.test('RTM requires ' + label, () => fixture({ kind: 'RTM_ANNUAL' }, async page => {
        await addRtm(page); await attest(page);
        if (label === 'Rapat asal') await page.getByLabel(label, { exact: true }).selectOption('');
        else await page.getByLabel(label, { exact: true }).first().fill('');
        await submit(page); await page.getByRole('alert').waitFor(); await noWrites(page);
      }));
    }
    await t.test('RTM rejects dangling meeting references, never cascades deleted recommendations', () => fixture({ kind: 'RTM_ANNUAL' }, async page => {
      await addRtm(page); await attest(page);
      await page.getByRole('button', { name: 'Hapus rapat 1', exact: true }).click();
      assert.equal(await page.getByLabel('ID rekomendasi', { exact: true }).inputValue(), 'REK-1');
      await submit(page); await page.getByRole('alert').filter({ hasText: /pilih rapat yang ada/ }).waitFor(); await noWrites(page);
    }));
    await t.test('RTM rejects normalized duplicate recommendation IDs', () => fixture({ kind: 'RTM_ANNUAL' }, async page => {
      await addRtm(page); await attest(page);
      await page.getByRole('button', { name: 'Tambah rekomendasi RTM', exact: true }).click();
      const second = page.getByRole('group', { name: 'Rekomendasi RTM 2', exact: true });
      await second.getByLabel('ID rekomendasi', { exact: true }).fill('ＲＥＫ-１');
      await second.getByLabel('Rapat asal', { exact: true }).selectOption('RTM-2');
      await second.getByLabel('Uraian rekomendasi', { exact: true }).fill('Tinjau mutu');
      await submit(page); await page.getByRole('alert').filter({ hasText: /ID rekomendasi duplikat/ }).waitFor(); await noWrites(page);
    }));
    await t.test('RTM enforces followup same year and not before meeting; changing status removes completion fields', () => fixture({ kind: 'RTM_ANNUAL' }, async page => {
      await addRtm(page); await attest(page);
      for (const [date, message] of [['2026-01-01', /tidak boleh mendahului rapat/], ['2027-01-01', /tahun rekap 2026/]]) {
        await page.getByLabel('Tanggal tindak lanjut', { exact: true }).fill(date);
        await submit(page); await page.getByRole('alert').filter({ hasText: message }).waitFor(); await noWrites(page);
      }
      await page.getByLabel('Status tindak lanjut', { exact: true }).selectOption('NOT_COMPLETED');
      await saveButton(page).click();
      await page.waitForFunction(() => window.ledgerFixture.writes.length === 1);
      const [payload] = await page.evaluate(() => window.ledgerFixture.writes);
      assert.equal(payload.numerator, 0); assert.equal(payload.denominator, 1);
      assert.deepEqual(payload.structuredInput.recommendations, [{ recommendationId: 'REK-1', meetingId: 'RTM-1', description: recommendation.description, followUpStatus: 'NOT_COMPLETED' }]);
    }));
    await t.test('RTM clearly warns on one meeting but can attest the incomplete prerequisite without inventing a score', () => fixture({ kind: 'RTM_ANNUAL' }, async page => {
      await addRtm(page); await attest(page);
      await page.getByRole('button', { name: 'Hapus rapat 2', exact: true }).click();
      await page.getByRole('status').filter({ hasText: /1 rapat dicatat.*minimal 2 rapat berbeda/ }).waitFor();
      await saveButton(page).click(); await page.waitForFunction(() => window.ledgerFixture.writes.length === 1);
      const [payload] = await page.evaluate(() => window.ledgerFixture.writes);
      assert.equal(payload.structuredInput.meetings.length, 1); assert.equal('nilaiKinerja' in payload, false);
    }));
    for (const [label, value, message] of [['ID rapat', 'ＲＴＭ-１', /ID rapat duplikat/], ['Referensi notulen', 'Notulen 01', /Rapat duplikat/]]) {
      await t.test('RTM rejects normalized duplicate ' + label, () => fixture({ kind: 'RTM_ANNUAL' }, async page => {
        await addRtm(page); await attest(page);
        if (label === 'Referensi notulen') await page.getByLabel('Tanggal rapat', { exact: true }).nth(1).fill('2026-02-01');
        await page.getByLabel(label, { exact: true }).nth(1).fill(value);
        await submit(page); await page.getByRole('alert').filter({ hasText: message }).waitFor(); await noWrites(page);
      }));
    }
    await t.test('generic editor preserves aggregate payload without adding optional ledger fields', () => fixture({ kind: 'GENERIC' }, async page => {
      await page.getByLabel('Pembilang ledger (N)', { exact: true }).fill('4');
      await page.getByLabel('Penyebut ledger (D)', { exact: true }).fill('5');
      await attest(page); await saveButton(page).click();
      await page.waitForFunction(() => window.ledgerFixture.writes.length === 1);
      const [payload] = await page.evaluate(() => window.ledgerFixture.writes);
      assert.equal(payload.numerator, 4); assert.equal(payload.denominator, 5); assert.equal('structuredInput' in payload, false);
    }));
    await t.test('generic draft cannot silently change into a structured contract', () => fixture({ kind: 'GENERIC', view: 'panel' }, async page => {
      await page.getByLabel('Pembilang ledger (N)', { exact: true }).fill('4');
      await page.getByLabel('Penyebut ledger (D)', { exact: true }).fill('5');
      await attest(page);
      await page.evaluate(() => window.ledgerFixture.configure({ liveKind: 'PME_ANNUAL' }));
      assert.equal(await page.getByLabel('Pembilang ledger (N)', { exact: true }).inputValue(), '4');
      assert.equal(await saveButton(page).isDisabled(), true);
      await submit(page); await page.getByRole('alert').waitFor(); await noWrites(page);
    }));
    for (const [kind, stored] of [
      ['GENERIC', pmeStored],
      ['PME_ANNUAL', { ...pmeStored, participations: [{ ...pmeRow(), extra: 'Do not discard' }] }],
      ['RTM_ANNUAL', { ...rtmStored, recommendations: [{ ...recommendation, extra: 'Do not discard' }] }],
      ['RTM_ANNUAL', { ...rtmStored, recommendations: [{ ...recommendation, followUpStatus: 'NOT_COMPLETED' }] }],
      ['PME_ANNUAL', { ...pmeStored, participations: [pmeRow('PME-1', '2026-02-30')] }],
      ['PME_ANNUAL', { ...pmeStored, participations: Array.from({ length: 1001 }, (_, i) => pmeRow(String(i))) }],
    ]) {
      await t.test(kind + ' blocks unsupported nested/snapshot shape ' + JSON.stringify(stored.kind) + '/' + (stored.participations?.length ?? stored.recommendations?.[0]?.followUpStatus), () => fixture({ kind, existing: true, stored }, async page => {
        assert.equal(await saveButton(page).isDisabled(), true);
        await submit(page); await noWrites(page);
      }));
    }
  } finally {
    await browser?.close(); await server?.close(); await rm(cacheDir, { recursive: true, force: true });
  }
});
