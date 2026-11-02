import type { RecapLedgerDraft } from '../../types/do2026';
import { recapMonths } from './recap-types';

type AnnualDraft = Exclude<RecapLedgerDraft, { kind: 'PME_ANNUAL' | 'RTM_ANNUAL' }>;
const inputClass = 'mt-1 block w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 focus:ring-2 focus:ring-emerald-500 disabled:bg-slate-100';
const activityLabels = {
  rehydrationCounselling: 'Konseling rehidrasi oral dan zinc', diarrhoeaManagement: 'Tatalaksana diare', communityEducation: 'Sosialisasi dan kapasitas masyarakat',
  dehydrationTreatment: 'Pelayanan dehidrasi ringan-sedang', threeHourObservation: 'Observasi dehidrasi ringan-sedang minimal tiga jam', oralitPreparation: 'Edukasi penyiapan dan jumlah oralit',
};

export function RecapAnnualEditor({ value, disabled, onChange }: {
  readonly value: AnnualDraft; readonly disabled: boolean; readonly onChange: (value: RecapLedgerDraft) => void;
}) {
  function field(label: string, current: string | number, update: (next: string) => void, numeric = false) {
    return <label className="block min-w-0 text-sm font-medium">{label}
      <input type="text" inputMode={numeric ? 'decimal' : undefined} required maxLength={numeric ? 30 : 1000}
        value={current} onChange={event => update(event.target.value)} className={inputClass} />
    </label>;
  }
  function attest(label: string, checked: boolean, update: (next: boolean) => void) {
    return <label className="flex items-start gap-2 text-sm"><input type="checkbox" required checked={checked}
      onChange={event => update(event.target.checked)} className="mt-1 accent-emerald-700" /><span>{label}</span></label>;
  }
  return <fieldset disabled={disabled} className="min-w-0 space-y-4">
    <legend className="font-semibold text-slate-900">{value.kind === 'LROA_ANNUAL' ? 'Ledger bulanan LROA' : value.kind === 'SEMESTER_SURVEY_ANNUAL' ? 'Survei dua semester' : value.kind === 'TB_COHORT_ANNUAL' ? 'Kohort keberhasilan TBC' : 'Kohort RFT kusta'} {value.year}</legend>
    <p className="text-sm text-slate-600">Tahun evaluasi tetap {value.year}. Isi agregat dari sumber program, bukan identitas pasien. Jangan isi nama, NIK, nomor rekam medis, atau identitas pasien. Referensi dan attestasi adalah pernyataan petugas, bukan autentikasi dokumen atau pengesahan otoritas. Kosong bukan nol; isi 0 hanya untuk nihil yang diketahui.</p>
    {value.kind === 'LROA_ANNUAL' && <>
      <p className="text-sm text-amber-900">Provisional khusus LROA: satu triwulan memenuhi bila ketiga bulan memiliki laporan lengkap dan sedikitnya dua dari enam jenis kegiatan dengan count positif pada setiap bulan. N = triwulan memenuhi; D = 4. Hanya TW IV lengkap menghasilkan 1/4 (25%). Ini bukan aturan triwulan universal atau skor kinerja.</p>
      {field('Referensi sumber LROA setahun', value.sourceReference, sourceReference => onChange({ ...value, sourceReference }))}
      {attest('Saya mengonfirmasi cakupan sumber LROA setahun penuh, termasuk bulan tidak lengkap/tidak ada.', value.sourceCoverageComplete, sourceCoverageComplete => onChange({ ...value, sourceCoverageComplete }))}
      {value.months.map((row, index) => {
        const update = (patch: Partial<typeof row>) => onChange({ ...value, months: value.months.map((entry, i) => i === index ? { ...entry, ...patch } : entry) });
        return <fieldset key={row.month} className="min-w-0 space-y-3 border-t border-slate-200 pt-3">
          <legend className="text-sm font-semibold">{recapMonths[row.month - 1]} {value.year} (TW {Math.ceil(row.month / 3)})</legend>
          <label className="block text-sm font-medium">Status laporan
            <select aria-label="Status laporan" required value={row.reportStatus} onChange={event => update({ reportStatus: event.target.value as typeof row.reportStatus })} className={inputClass}>
              <option value="">Pilih status dari sumber</option><option value="COMPLETE">Lengkap</option><option value="INCOMPLETE">Tidak lengkap</option><option value="ABSENT">Tidak ada laporan</option>
            </select>
          </label>
          {(row.reportStatus === 'COMPLETE' || row.reportReference !== undefined) && field('Referensi laporan bulanan', row.reportReference ?? '', reportReference => {
            if (!reportReference && row.reportStatus !== 'COMPLETE') {
              const { reportReference: _reference, ...withoutReference } = row;
              onChange({ ...value, months: value.months.map((entry, i) => i === index ? withoutReference : entry) });
            } else update({ reportReference });
          })}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {(Object.keys(activityLabels) as (keyof typeof activityLabels)[]).map(key => <div key={key}>
              {field(activityLabels[key], row.activityCounts[key], next => update({ activityCounts: { ...row.activityCounts, [key]: next } }), true)}
            </div>)}
          </div>
        </fieldset>;
      })}
    </>}
    {value.kind === 'SEMESTER_SURVEY_ANNUAL' && <>
      <p className="text-sm text-amber-900">Skala 100 poin harus terdokumentasi; tidak ada konversi otomatis dari skala 1-4 atau 0-1. Isi nilai 0-100, maksimal empat desimal dengan titik. N = jumlah dua nilai; D = 2; pengukuran = rerata semester dalam poin (SCORE), bukan persentase, count pasien, atau rerata berbobot sampel.</p>
      {field('Referensi skala 100 poin terdokumentasi', value.scaleReference, scaleReference => onChange({ ...value, scaleReference }))}
      {field('Referensi kompatibilitas metode', value.methodCompatibilityReference, methodCompatibilityReference => onChange({ ...value, methodCompatibilityReference }))}
      {attest('Saya mengonfirmasi kedua metode semester kompatibel pada skala 100 poin terdokumentasi.', value.compatibleMethodsConfirmed, compatibleMethodsConfirmed => onChange({ ...value, compatibleMethodsConfirmed }))}
      {value.semesters.map((row, index) => {
        const update = (patch: Partial<typeof row>) => onChange({ ...value, semesters: value.semesters.map((entry, i) => i === index ? { ...entry, ...patch } : entry) });
        return <fieldset key={row.semester} className="min-w-0 space-y-3 border-t border-slate-200 pt-3"><legend className="text-sm font-semibold">Semester {row.semester} - {value.year}</legend>
          {field('Nilai survei (poin)', row.value, next => update({ value: next }), true)}
          {field('Referensi metode semester', row.methodReference, methodReference => update({ methodReference }))}
          {field('Referensi laporan semester', row.reportReference, reportReference => update({ reportReference }))}
        </fieldset>;
      })}
    </>}
    {value.kind === 'TB_COHORT_ANNUAL' && <>
      <p className="text-sm text-amber-900">Kohort SITB {value.year - 1} (Y-1), diobati, dicatat dan dilaporkan. D adalah denominator awal kohort, bukan semua kasus tahun evaluasi. N adalah union pasien berbeda yang sembuh atau pengobatan lengkap, bukan penjumlahan outcome yang tumpang tindih. N tidak boleh melebihi D.</p>
      <fieldset className="min-w-0 space-y-3"><legend className="text-sm font-semibold">TBC - kohort {value.cohort.year} (Y-1), SITB</legend>
        {field('Referensi kohort TBC', value.cohort.cohortReference, cohortReference => onChange({ ...value, cohort: { ...value.cohort, cohortReference } }))}
        {field('Referensi sumber SITB', value.cohort.sourceReference, sourceReference => onChange({ ...value, cohort: { ...value.cohort, sourceReference } }))}
        <div className="grid gap-3 sm:grid-cols-2">
          {field('Denominator awal kohort TBC', value.cohort.originalDenominator, originalDenominator => onChange({ ...value, cohort: { ...value.cohort, originalDenominator } }), true)}
          {field('Pasien berhasil berbeda (sembuh atau pengobatan lengkap)', value.cohort.successfulCount, successfulCount => onChange({ ...value, cohort: { ...value.cohort, successfulCount } }), true)}
        </div>
        {field('Referensi penilaian hasil TBC', value.cohort.outcomeAssessmentReference, outcomeAssessmentReference => onChange({ ...value, cohort: { ...value.cohort, outcomeAssessmentReference } }))}
        {attest('Kohort TBC lengkap.', value.cohort.complete, complete => onChange({ ...value, cohort: { ...value.cohort, complete } }))}
        {attest('Denominator awal dan hasil TBC tertaut pada kohort asal yang sama.', value.cohort.originalDenominatorAndOutcomeLinkageAttested, originalDenominatorAndOutcomeLinkageAttested => onChange({ ...value, cohort: { ...value.cohort, originalDenominatorAndOutcomeLinkageAttested } }))}
        {attest('Pasien berhasil TBC dihitung berbeda dalam union sembuh atau pengobatan lengkap.', value.cohort.distinctSuccessfulPatientsAttested, distinctSuccessfulPatientsAttested => onChange({ ...value, cohort: { ...value.cohort, distinctSuccessfulPatientsAttested } }))}
      </fieldset>
    </>}
    {value.kind === 'LEPROSY_COHORT_ANNUAL' && <>
      <p className="text-sm text-amber-900">SIPK: PB {value.year - 1} (Y-1) dan MB {value.year - 2} (Y-2). D per kohort adalah kasus baru awal mulai pengobatan. Hasil selesai harus matang, sesuai periode pengobatan dan tertaut kohort asal. N/D tahunan = jumlah hasil selesai / jumlah kasus baru awal, bukan rerata dua rasio. N tidak boleh melebihi D per kohort; isi komponen nihil secara eksplisit.</p>
      {value.cohorts.map((row, index) => {
        const update = (patch: Partial<typeof row>) => onChange({ ...value, cohorts: value.cohorts.map((entry, i) => i === index ? { ...entry, ...patch } : entry) });
        return <fieldset key={row.type} className="min-w-0 space-y-3 border-t border-slate-200 pt-3"><legend className="text-sm font-semibold">{row.type} - kohort {row.year} ({row.type === 'PB' ? 'Y-1' : 'Y-2'}), SIPK</legend>
          {field('Referensi kohort kusta', row.cohortReference, cohortReference => update({ cohortReference }))}
          {field('Referensi sumber SIPK', row.sourceReference, sourceReference => update({ sourceReference }))}
          <div className="grid gap-3 sm:grid-cols-2">
            {field('Kasus baru awal mulai pengobatan', row.originalNewCaseStarts, originalNewCaseStarts => update({ originalNewCaseStarts }), true)}
            {field('Jumlah selesai pengobatan', row.completedCount, completedCount => update({ completedCount }), true)}
          </div>
          {field('Referensi periode pengobatan yang ditetapkan', row.prescribedPeriodReference, prescribedPeriodReference => update({ prescribedPeriodReference }))}
          {field('Referensi penilaian hasil kusta', row.outcomeAssessmentReference, outcomeAssessmentReference => update({ outcomeAssessmentReference }))}
          {attest('Kohort kusta matang dan lengkap sesuai periode pengobatan.', row.matureAndComplete, matureAndComplete => update({ matureAndComplete }))}
          {attest('Denominator awal dan hasil kusta tertaut pada kohort asal yang sama.', row.originalDenominatorAndOutcomeLinkageAttested, originalDenominatorAndOutcomeLinkageAttested => update({ originalDenominatorAndOutcomeLinkageAttested }))}
        </fieldset>;
      })}
    </>}
  </fieldset>;
}
