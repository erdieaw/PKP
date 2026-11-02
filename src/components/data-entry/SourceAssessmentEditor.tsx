import type { SourceAssessmentDescriptor, SourceAssessmentDraft } from '../../types/sourceAssessment';
import { bindLocalResolutionDraft, derivedSourceDenominator, sourcePeriodLabels } from '../../services/sourceAssessment';
import { sourceTermLabel } from '../../services/sourceAssessmentLabels';
import { LocalResolutionEditor } from './LocalResolutionEditor';

const fieldClass = 'mt-1 block w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 disabled:bg-slate-100 read-only:bg-slate-50';
const provenanceLabels = {
  territoryReference: 'Referensi wilayah penilaian', sourceSnapshotReference: 'Referensi versi atau snapshot sumber',
  numeratorEvidenceReference: 'Referensi bukti pembilang', denominatorEvidenceReference: 'Referensi bukti penyebut',
  eligibilityReference: 'Referensi pemeriksaan kelayakan', completenessReference: 'Referensi kelengkapan cakupan sumber',
  grainReference: 'Referensi satuan pencatatan dan pengulangan', numeratorUnit: 'Satuan pembilang', denominatorUnit: 'Satuan penyebut',
  reconciliationReference: 'Referensi rekonsiliasi dan deduplikasi',
} as const;
const parameterLabels: Record<string, string> = { population: 'Jumlah penduduk dasar estimasi', detectionTarget: 'Target penemuan TBC',
  pkmPopulation: 'Jumlah penduduk Puskesmas', districtPopulation: 'Jumlah penduduk kabupaten/kota', districtEstimatedTbCases: 'Estimasi kasus TBC kabupaten/kota', indexCount: 'Jumlah kasus indeks' };

export function SourceAssessmentEditor({ value, descriptor, disabled, onChange: change }: {
  readonly value: SourceAssessmentDraft; readonly descriptor: SourceAssessmentDescriptor; readonly disabled: boolean;
  readonly onChange: (value: SourceAssessmentDraft) => void;
}) {
  const onChange = (draft: SourceAssessmentDraft) => change(bindLocalResolutionDraft(draft));
  const formula = descriptor.formula;
  const ratio = formula?.operator === 'RATIO_PERCENT' ? formula : undefined;
  const fixedPeriod = ['ANNUAL', 'MONTH', 'QUARTER'].includes(descriptor.period);
  const twoYearWindow = descriptor.periodWindowRule?.kind === 'CURRENT_AND_PREVIOUS_ASSESSMENT_YEAR_TO_CUTOFF';
  const numberField = (label: string, current: number | string, change: (value: string) => void, readOnly = false, decimal = false) => <label className="block min-w-0 text-sm font-medium">{label}
    <input type="number" min="0" step={decimal ? '0.0001' : '1'} required readOnly={readOnly} value={current} onChange={event => change(event.target.value)} className={fieldClass} />
  </label>;
  const textField = (label: string, current: string, change: (value: string) => void, readOnly = false) => <label className="block min-w-0 text-sm font-medium">{label}
    <input type="text" required maxLength={2000} readOnly={readOnly} value={current} onChange={event => change(event.target.value)} className={fieldClass} />
  </label>;
  function updateParameter(key: string, entry: string) {
    const parameters = { ...value.parameters, [key]: entry };
    let denominator: number | string = '';
    try {
      if (Object.values(parameters).some(row => String(row).trim() === '')) throw new Error('Missing');
      denominator = derivedSourceDenominator(descriptor, Object.fromEntries(Object.entries(parameters).map(([name, row]) => [name, Number(row)]))) ?? '';
    } catch { /* Invalid or unrepresentable parameters remain editable, without a rounded D. */ }
    onChange({ ...value, parameters, values: value.values.kind === 'RATIO_AGGREGATE' ? { ...value.values, denominator } : value.values });
  }
  let derivedError: string | null = null;
  if (value.parameters && Object.values(value.parameters).every(row => String(row).trim() !== '')) {
    try { derivedSourceDenominator(descriptor, Object.fromEntries(Object.entries(value.parameters).map(([key, row]) => [key, Number(row)]))); }
    catch (error) { derivedError = error instanceof Error ? error.message : 'Periksa parameter.'; }
  }
  return <fieldset disabled={disabled} aria-label="Asesmen sumber DO" className="min-w-0 space-y-5 break-words">
    <legend className="font-semibold text-slate-900">Asesmen sumber sesuai DO</legend>
    <p className="text-sm text-slate-600">Catat agregat yang telah ditelaah, bukan daftar individu. Jangan masukkan nama, NIK, nomor rekam medis, atau identitas pasien/pegawai pada referensi dan uraian. Kelayakan tidak disimpulkan otomatis dari N/D.</p>
    <p className="text-sm text-amber-900">{descriptor.calculationAvailability === 'SOURCE_UNRESOLVED'
      ? 'Pencatatan sumber tersedia; pengukuran menurut sumber tetap tertahan karena konflik atau metode sumber. Solusi lokal hanya tersedia bila ditawarkan descriptor dan diterima eksplisit, bukan penyelesaian konflik sumber.'
      : 'Penghitungan kontekstual internal saja. Data belum lengkap, belum jatuh jadwal, atau tidak berlaku tetap dapat disimpan tanpa hasil ukur.'} Skor kinerja tidak ditetapkan. Referensi merupakan attestasi petugas, bukan verifikasi eksternal atau pengesahan Dinkes.</p>
    <details className="space-y-2 text-sm text-slate-600">
      <summary className="cursor-pointer font-semibold text-emerald-800">Definisi, rumus, target dan batas sumber</summary>
      <p className="mt-2 whitespace-pre-wrap">{descriptor.sourceDefinition?.definition}</p>
      <p className="whitespace-pre-wrap">{descriptor.sourceDefinition?.calculation}</p>
      <p>Target mentah: {String(descriptor.target.raw)}; format sumber: {descriptor.target.excelNumberFormat}. Pembanding internal: {descriptor.target.comparator}; basis: {descriptor.target.basis}. Bukan skor kinerja.</p>
      {descriptor.sourceDefinition?.notes && <p className="whitespace-pre-wrap">{descriptor.sourceDefinition.notes}</p>}
      {descriptor.unresolved.map((entry, i) => <p key={i} className="text-amber-900">{entry}</p>)}
      {descriptor.applicability && <p>Kelayakan khusus perlu bukti sesuai DO: {sourceTermLabel(descriptor.applicability)}. <span className="break-all text-xs">({descriptor.applicability})</span></p>}
      <p>{descriptor.sourceRef} / {descriptor.definitionId}</p>
    </details>
    <fieldset className="min-w-0 space-y-3 border-t border-slate-200 pt-3">
      <legend className="font-semibold">Lingkup observasi: {sourcePeriodLabels[descriptor.period]}</legend>
      <p className="text-sm text-slate-600">{descriptor.periodInstruction} Tanggal kosong wajib ditentukan dari sumber; tanggal akhir tidak diasumsikan sebagai akhir tahun.</p>
      {value.period.month !== undefined && <p className="text-sm">Bulan observasi: {value.period.month} / {value.year}</p>}
      {value.period.quarter !== undefined && <p className="text-sm">Triwulan observasi: {value.period.quarter} / {value.year}</p>}
      {value.period.schoolYear && <p className="text-sm">Tahun ajaran: {value.period.schoolYear}; hanya sumber 2025/2026.</p>}
      {value.period.documentYear !== undefined && <p className="text-sm">Tahun dokumen: {value.period.documentYear}</p>}
      <div className="grid min-w-0 gap-3 sm:grid-cols-3">
        {(['startDate', 'endDate', 'cutoffDate'] as const).map((key, index) => <label key={key} className="block min-w-0 text-sm font-medium">{['Tanggal awal observasi', 'Tanggal akhir observasi', 'Tanggal cutoff penilaian'][index]}
          <input type="date" required readOnly={fixedPeriod || (twoYearWindow && key !== 'cutoffDate')} value={value.period[key]} className={fieldClass} onChange={event => {
            const entry = event.target.value;
            onChange({ ...value, period: descriptor.period === 'AS_OF' ? { ...value.period, startDate: entry, endDate: entry, cutoffDate: entry, asOf: entry }
              : twoYearWindow ? { ...value.period, startDate: `${Number(value.year) - 1}-01-01`, endDate: entry, cutoffDate: entry } : { ...value.period, [key]: entry } });
          }} />
        </label>)}
      </div>
      {descriptor.period === 'AS_OF' && <p className="text-sm text-slate-600">Ketiga tanggal menyatakan satu snapshot yang dipilih secara eksplisit, bukan capaian tahunan.</p>}
      {textField('Referensi penetapan periode dan cutoff', value.period.reference, reference => onChange({ ...value, period: { ...value.period, reference } }))}
    </fieldset>
    <fieldset className="min-w-0 space-y-3 border-t border-slate-200 pt-3">
      <legend className="font-semibold">Observasi agregat sumber</legend>
      <p className="text-sm text-slate-600">Isi angka eksplisit termasuk nol bila benar-benar diketahui. Agregat adalah attestasi hasil telaah sumber, bukan pemeriksaan otomatis syarat klinis.</p>
      {descriptor.denominatorRule?.kind === 'CALENDAR_MONTH_DAYS' && <p className="text-sm text-slate-600">Penyebut readonly: jumlah hari kalender pada bulan dan tahun observasi, termasuk Februari tahun kabisat. Bukan jumlah hari yang diisi petugas.</p>}
      {value.parameters && <div className="space-y-3">
        <p className="text-sm">Penyebut diturunkan dari parameter, bukan diisi manual. Faktor DO: {ratio?.documentedFactor ?? ratio?.documentedFactors?.join(' x ') ?? '-'}. Tidak ada pembulatan otomatis.</p>
        {Object.entries(value.parameters).map(([key, entry]) => <div key={key}>{numberField(parameterLabels[key] ?? 'Parameter sumber', entry, text => updateParameter(key, text), false, key === 'detectionTarget' || key === 'districtEstimatedTbCases')}</div>)}
        {derivedError && <p role="status" className="text-sm text-amber-900">{derivedError}</p>}
      </div>}
      {value.values.kind === 'RATIO_AGGREGATE' && (() => {
        const values = value.values;
        return <div className="grid min-w-0 gap-3 sm:grid-cols-2">
          {numberField(`Pembilang agregat: ${formula && 'numerator' in formula ? formula.numerator : 'N'}`, values.numerator, numerator => onChange({ ...value, values: { ...values, numerator } }), false, ratio?.input === 'DECIMAL_MONEY' || ratio?.input === 'DECIMAL_SCORE')}
          {numberField(`Penyebut agregat: ${formula && 'denominator' in formula ? formula.denominator : 'D'}`, values.denominator, denominator => onChange({ ...value, values: { ...values, denominator } }), !!value.parameters || ratio?.fixedDenominator !== undefined || descriptor.denominatorRule?.kind === 'CALENDAR_MONTH_DAYS',
            ratio?.input === 'DECIMAL_MONEY' || ratio?.input === 'DECIMAL_SCORE' || ratio?.input === 'ESTIMATED' || value.denominatorContext?.origin === 'ESTIMATED')}
        </div>;
      })()}
      {(value.values.kind === 'COUNT_AGGREGATE' || value.values.kind === 'SOURCE_OBSERVATION') && (() => {
        const values = value.values;
        return numberField(formula && 'numerator' in formula ? formula.numerator : 'Jumlah observasi sumber', values.count, count => onChange({ ...value, values: { ...values, count } }));
      })()}
      {value.values.kind === 'DOCUMENT_OBSERVATION' && (() => {
        const values = value.values;
        return <label className="block text-sm font-medium">Kehadiran dokumen menurut observasi
          <select required className={fieldClass} value={values.present === '' ? '' : String(values.present)} onChange={event => onChange({ ...value, values: { ...values, present: event.target.value === '' ? '' : event.target.value === 'true' } })}>
            <option value="">Belum dinyatakan</option><option value="true">Tersedia</option><option value="false">Tidak tersedia</option>
          </select>
        </label>;
      })()}
      {value.values.kind === 'SOURCE_OBSERVATION' && (() => {
        const values = value.values;
        return <>{textField('Satuan observasi sumber', values.unit, unit => onChange({ ...value, values: { ...values, unit } }))}
          {textField('Referensi observasi sumber', values.reference, reference => onChange({ ...value, values: { ...values, reference } }))}</>;
      })()}
      {value.values.kind === 'COMPONENT_OBSERVATIONS' && formula?.operator === 'COMPONENTS_ONLY' && (() => {
        const values = value.values;
        return formula.components.map((component, index) => {
          const row = values.components[component.key];
          const update = (entry: Partial<typeof row>) => onChange({ ...value, values: { ...values, components: { ...values.components, [component.key]: { ...row, ...entry } } } });
          const decimal = 'input' in component ? component.input === 'DECIMAL_MONEY' : component.unit === 'SOURCE_UNRESOLVED';
          return <fieldset key={component.key} className="min-w-0 space-y-3 border-t border-slate-200 pt-3"><legend className="text-sm font-semibold">Komponen {index + 1}: {'label' in component ? component.label : component.numerator}</legend>
            <div className="grid min-w-0 gap-3 sm:grid-cols-2">
              {numberField('numerator' in component ? component.numerator : 'Pembilang komponen', row.numerator, numerator => update({ numerator }), false, decimal)}
              {numberField('denominator' in component ? component.denominator : 'Penyebut komponen', row.denominator, denominator => update({ denominator }), false, decimal)}
            </div>
            {textField('Satuan komponen', row.unit, unit => update({ unit }), 'unit' in component && component.unit === 'COUNT_DOCUMENT')}
            {textField('Referensi komponen', row.reference, reference => update({ reference }))}
          </fieldset>;
        });
      })()}
      {value.values.kind === 'RATIO_AGGREGATE' && (Number(value.values.numerator) > Number(value.values.denominator) || value.exceedReviewReference !== undefined) &&
        textField('Referensi peninjauan kelebihan pembilang', value.exceedReviewReference ?? '', exceedReviewReference => onChange({ ...value, exceedReviewReference }))}
    </fieldset>
    {value.denominatorContext && (() => {
      const context = value.denominatorContext;
      const update = (entry: Partial<typeof context>) => onChange({ ...value, denominatorContext: { ...context, ...entry } });
      return <fieldset className="min-w-0 space-y-3 border-t border-slate-200 pt-3"><legend className="font-semibold">Asal dan metode penyebut</legend>
        <label className="block text-sm font-medium">Asal penyebut
          <select className={fieldClass} value={context.origin} onChange={event => update({ origin: event.target.value as typeof context.origin })}>
            {ratio?.denominatorBasis !== 'ESTIMATE' && <option value="INTEGER">Hitungan riil (bulat)</option>}<option value="ESTIMATED">Estimasi terdokumentasi</option>
          </select>
        </label>
        {numberField('Tahun acuan penyebut', context.referenceYear, referenceYear => update({ referenceYear }))}
        {textField('Referensi metode penyebut', context.methodReference, methodReference => update({ methodReference }))}
        {textField('Referensi wilayah penyebut (sama dengan wilayah penilaian)', context.territoryReference, territoryReference => update({ territoryReference }))}
        {textField('Referensi alokasi penyebut', context.allocationReference, allocationReference => update({ allocationReference }))}
      </fieldset>;
    })()}
    <details className="min-w-0 space-y-3" open><summary className="cursor-pointer font-semibold text-emerald-800">Kriteria dan referensi telaah ({descriptor.criteria.length})</summary>
      <p className="text-sm text-slate-600">Setiap kriteria memerlukan referensi penilaian. Bila belum dapat dipenuhi, catat gap dan pilih status belum lengkap; jangan mengonfirmasi otomatis.</p>
      {descriptor.criteria.map((criterion, index) => <div key={index} className="space-y-2 border-t border-slate-100 pt-3">
        <p className="text-sm">{index + 1}. {criterion}</p>
        {textField(`Referensi telaah kriteria ${index + 1}`, value.attestation.criteriaReferences[index], reference => onChange({ ...value, attestation: { ...value.attestation, criteriaReferences: value.attestation.criteriaReferences.map((entry, i) => i === index ? reference : entry) } }))}
      </div>)}
      {descriptor.thresholds && <div className="space-y-1 text-sm"><p className="font-medium">Ambang kelayakan dari DO (bukan skor):</p>
        {Object.entries(descriptor.thresholds).map(([key, threshold]) => <p key={key}>{sourceTermLabel(key)}: {Array.isArray(threshold) ? threshold.join(' / ') : threshold} <span className="break-all text-xs text-slate-500">({key})</span>. Baca kriteria sumber terkait.</p>)}
      </div>}
    </details>
    <details className="min-w-0 space-y-3" open><summary className="cursor-pointer font-semibold text-emerald-800">Konteks wajib sumber ({descriptor.requiredContext.length})</summary>
      <p className="text-sm text-slate-600">Sebutkan referensi dan ringkasan hasil pemeriksaan, bukan isi register individu. Status belum terselesaikan dapat disimpan dengan penjelasan gap. Seluruh konteks tetap wajib diisi.</p>
      {descriptor.requiredContext.map(({ key, label }, index) => <fieldset key={key} className="min-w-0 space-y-2 border-t border-slate-200 pt-3">
        <legend className="text-sm font-medium">Telaah konteks sumber {index + 1}: {label !== key ? label : sourceTermLabel(key)}</legend>
        <p className="break-all text-xs text-slate-500">Kunci sumber: {key}</p>
        <label className="block text-sm">Status konteks
          <select className={fieldClass} value={value.context[key].status} onChange={event => onChange({ ...value, context: { ...value.context, [key]: { ...value.context[key], status: event.target.value as 'AVAILABLE' | 'UNRESOLVED' } } })}>
            <option value="UNRESOLVED">Belum terselesaikan / ada gap</option><option value="AVAILABLE">Tersedia dan telah ditelaah</option>
          </select>
        </label>
        {textField('Referensi telaah konteks', value.context[key].reference, reference => onChange({ ...value, context: { ...value.context, [key]: { ...value.context[key], reference } } }))}
        {textField('Uraian hasil telaah atau kekurangan konteks', value.context[key].description, description => onChange({ ...value, context: { ...value.context, [key]: { ...value.context[key], description } } }))}
      </fieldset>)}
    </details>
    <details className="min-w-0 space-y-3" open><summary className="cursor-pointer font-semibold text-emerald-800">Asal data, unit dan rekonsiliasi</summary>
      {Object.entries(provenanceLabels).map(([key, label]) => <div key={key}>{textField(label, value.provenance[key as keyof typeof provenanceLabels], entry => onChange({ ...value, provenance: { ...value.provenance, [key]: entry } }))}</div>)}
    </details>
    {descriptor.verifiedNihilRule?.available === true && <fieldset className="min-w-0 space-y-3 border-t border-slate-200 pt-3">
      <legend className="font-semibold">Pengecualian nihil terverifikasi menurut attestasi petugas</legend>
      <p className="text-sm text-slate-600">Hanya untuk N=D=0 dengan konteks lengkap dan tanpa kewajiban kohort tahun lalu tersisa. Referensi petugas bukan autentikasi atau verifikasi eksternal. Target dapat terpenuhi tanpa persentase 0/0 atau skor numerik. {descriptor.verifiedNihilRule.referenceInstruction}</p>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1 accent-emerald-700" checked={!!value.verifiedNihil} onChange={event => {
        if (!event.target.checked) { const { verifiedNihil: _removed, ...draft } = value; onChange(draft); }
        else onChange({ ...value, verifiedNihil: { kind: 'DINSOS_VERIFIED_NIHIL', dinsosReference: '', cohortAbsenceReference: '', noResidualPriorYearObligationConfirmed: false,
          definitionId: value.definitionId, year: value.year, periodStartDate: value.period.startDate, periodEndDate: value.period.endDate, cutoffDate: value.period.cutoffDate, territoryReference: value.provenance.territoryReference } });
      }} />Ajukan pengecualian nihil Dinsos (opsional; menonaktifkan menghapus hanya isian nihil)</label>
      {value.verifiedNihil && (() => {
        const nihil = value.verifiedNihil;
        const update = (patch: Partial<typeof nihil>) => onChange({ ...value, verifiedNihil: { ...nihil, ...patch } });
        return <>
          {textField('Referensi dokumen agregat Dinsos', nihil.dinsosReference, dinsosReference => update({ dinsosReference }))}
          {textField('Referensi rekonsiliasi ketiadaan kohort kini dan tahun lalu', nihil.cohortAbsenceReference, cohortAbsenceReference => update({ cohortAbsenceReference }))}
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1 accent-emerald-700" checked={nihil.noResidualPriorYearObligationConfirmed === true} onChange={event => update({ noResidualPriorYearObligationConfirmed: event.target.checked })} />Saya memastikan tidak ada kewajiban kohort tahun lalu yang tersisa</label>
          {textField('Definisi attestasi nihil', nihil.definitionId, () => {}, true)}
          {numberField('Tahun attestasi nihil', nihil.year, () => {}, true)}
          {textField('Awal periode attestasi nihil', nihil.periodStartDate, () => {}, true)}
          {textField('Akhir periode attestasi nihil', nihil.periodEndDate, () => {}, true)}
          {textField('Cutoff attestasi nihil', nihil.cutoffDate, () => {}, true)}
          {textField('Wilayah attestasi nihil', nihil.territoryReference, () => {}, true)}
          <p className="text-sm text-slate-600">Lingkup disalin saat Anda mengaktifkan pengecualian. Bila periode atau wilayah berubah, nonaktifkan lalu aktifkan kembali dan telaah ulang bukti; isian lain tetap dipertahankan.</p>
        </>;
      })()}
    </fieldset>}
    <fieldset className="min-w-0 space-y-3 border-t border-slate-200 pt-3"><legend className="font-semibold">Pernyataan hasil penelaahan</legend>
      <label className="block text-sm font-medium">Status penelaahan sumber
        <select className={fieldClass} value={value.attestation.status} onChange={event => onChange({ ...value, attestation: { ...value.attestation, status: event.target.value as typeof value.attestation.status } })}>
          <option value="INCOMPLETE">Belum lengkap</option><option value="COMPLETE">Lengkap menurut telaah petugas</option><option value="NOT_YET_DUE">Belum jatuh jadwal</option><option value="NOT_APPLICABLE">Tidak berlaku menurut telaah sumber</option>
        </select>
      </label>
      {([['sourceCoverageComplete', 'Cakupan sumber untuk lingkup observasi telah lengkap'], ['eligibilityReviewed', 'Kelayakan seluruh kriteria DO telah diperiksa'], ['grainReconciled', 'Satuan pencatatan dan pengulangan telah direkonsiliasi']] as const).map(([key, label]) => <label key={key} className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1 accent-emerald-700" checked={value.attestation[key] === true} onChange={event => onChange({ ...value, attestation: { ...value.attestation, [key]: event.target.checked } })} />{label}
      </label>)}
      <p className="text-sm text-slate-600">Konfirmasi penyimpanan rekap tidak menggantikan ketiga pemeriksaan ini. Status tidak berlaku bukan persetujuan pengecualian resmi.</p>
    </fieldset>
    {descriptor.localResolution && <LocalResolutionEditor value={value} descriptor={descriptor.localResolution} onChange={change} />}
  </fieldset>;
}
