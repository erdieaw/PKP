import type { SourceAssessmentDraft } from '../../types/sourceAssessment';
import type { LocalResolutionDescriptor } from '../../types/localResolution';
import { createLocalResolutionDraft, sourcePeriodLabels } from '../../services/sourceAssessment';
import { sourceTermLabel } from '../../services/sourceAssessmentLabels';

const fieldClass = 'mt-1 block w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 disabled:bg-slate-100';

export function LocalResolutionEditor({ value, descriptor, onChange }: {
  readonly value: SourceAssessmentDraft; readonly descriptor: LocalResolutionDescriptor;
  readonly onChange: (value: SourceAssessmentDraft) => void;
}) {
  const local = value.localResolution;
  const update = (patch: Partial<NonNullable<typeof local>>) => { if (local) onChange({ ...value, localResolution: { ...local, ...patch } }); };
  const textField = (label: string, current: string, change: (text: string) => void) => <label className="block min-w-0 text-sm font-medium">{label}
    <input type="text" required maxLength={2000} value={current} onChange={event => change(event.target.value)} className={fieldClass} />
  </label>;
  const candidates = descriptor.metrics.filter(metric => metric.targetValue !== undefined && !metric.derivedFrom);
  return <fieldset aria-label="Solusi lokal opsional" className="min-w-0 space-y-4 border-t border-slate-200 pt-4">
    <legend className="font-semibold">Solusi lokal pilihan petugas</legend>
    <p className="text-sm text-amber-900">Konflik sumber tetap SOURCE_UNRESOLVED. Pilihan ini bukan koreksi DO, pengesahan Dinkes atau verifikasi eksternal. Hanya pengukuran lokal provisional, tanpa skor dan tanpa penilaian lengkap.</p>
    <p className="text-sm text-slate-600">{descriptor.label}. {descriptor.referenceInstruction}</p>
    {descriptor.constraints.map((entry, i) => <p key={i} className="text-sm text-slate-600">{entry}</p>)}
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1 accent-emerald-700" checked={!!local} onChange={event => {
      if (event.target.checked) onChange({ ...value, localResolution: createLocalResolutionDraft(value, descriptor) });
      else { const { localResolution: _removed, ...source } = value; onChange(source); }
    }} />Saya menerima solusi lokal ini secara eksplisit (opsional; nonaktifkan untuk menghapus hanya solusi lokal)</label>
    {local && <>
      {textField('Referensi penerimaan solusi lokal', local.acceptanceReference, acceptanceReference => update({ acceptanceReference }))}
      {textField('Referensi kebijakan pengukuran lokal', local.measurementPolicyReference, measurementPolicyReference => update({ measurementPolicyReference }))}
      {textField('Referensi otoritas keputusan lokal (bukan pengesahan sumber)', local.correctionAuthorityReference, correctionAuthorityReference => update({ correctionAuthorityReference }))}
      <div className="space-y-1 text-sm text-slate-600">
        <p>Definisi lokal: {local.definitionId}; tahun {local.year}; wilayah: {local.territoryReference || 'Belum diisi pada sumber'}.</p>
        <p>Periode sumber terikat otomatis: {sourcePeriodLabels[local.sourcePeriod.kind]}, {local.sourcePeriod.startDate || '-'} sampai {local.sourcePeriod.endDate || '-'}; cutoff {local.sourcePeriod.cutoffDate || '-'}.</p>
        <p>Periode pengukuran lokal: {sourcePeriodLabels[local.period.kind]}, {local.period.startDate || '-'} sampai {local.period.endDate || '-'}; cutoff {local.period.cutoffDate || '-'}. Bukan otomatis hasil tahunan atau YTD.</p>
        <p>Perubahan lingkup sumber mengikat ulang identitas/periode saja. Telaah ulang bukti; sistem tidak menciptakan referensi atau menyatakan kesesuaiannya.</p>
      </div>
      {descriptor.periodPolicy === 'MONTH' && textField('Referensi periode bulanan lokal', local.period.reference, reference => update({ period: { ...local.period, reference } }))}
      <details open className="min-w-0 space-y-3"><summary className="cursor-pointer font-semibold text-emerald-800">Referensi bukti agregat lokal ({descriptor.requiredReferences.length})</summary>
        {descriptor.requiredReferences.map(key => <div key={key} className="min-w-0">
          {textField(`Bukti lokal: ${sourceTermLabel(key)}`, local.references[key], entry => update({ references: { ...local.references, [key]: entry } }))}
          <p className="break-all text-xs text-slate-500">Kunci bukti: {key}</p>
        </div>)}
      </details>
      {descriptor.metrics.map(metric => {
        if (metric.derivedFrom) return <p key={metric.key} className="text-sm text-slate-600">{metric.label}: diturunkan server dari {metric.derivedFrom.map(key => descriptor.metrics.find(row => row.key === key)?.label ?? key).join('; ')}. Tidak diisi atau dijumlahkan manual.</p>;
        const row = local.metrics[metric.key];
        const metricUpdate = (patch: Record<string, string | boolean>) => update({ metrics: { ...local.metrics, [metric.key]: { ...row, ...patch } as NonNullable<typeof row> } });
        const numberField = (label: string, key: string, current: number | string, decimal = false) => <label className="block min-w-0 text-sm font-medium">{label}
          <input type="number" required min="0" max={descriptor.precision.maximumInput} step={decimal ? '0.0001' : '1'} value={current} className={fieldClass} onChange={event => metricUpdate({ [key]: event.target.value })} />
        </label>;
        return <fieldset key={metric.key} aria-label={`Metrik lokal: ${metric.label}`} className="min-w-0 space-y-3 border-t border-slate-200 pt-3">
          <legend className="text-sm font-semibold">{metric.label}{metric.key === descriptor.primaryMetricKey ? ' (pengukuran utama lokal)' : ' (komponen terpisah)'}</legend>
          <label className="block text-sm font-medium">Status observasi lokal
            <select aria-label="Status observasi lokal" className={fieldClass} value={row === undefined ? 'OMITTED' : row === null ? 'INCOMPLETE' : 'OBSERVED'} onChange={event => {
              const metrics = { ...local.metrics };
              if (event.target.value === 'OMITTED') delete metrics[metric.key];
              else metrics[metric.key] = event.target.value === 'INCOMPLETE' ? null : metric.type === 'BOOLEAN' ? { satisfied: '' } : metric.type === 'COUNT' ? { count: '' }
                : metric.type === 'POPULATION_RATIO' ? { numerator: '', denominator: '', population: '', prevalencePercent: '', populationReference: '', prevalenceReference: '' } : { numerator: '', denominator: '' };
              update({ metrics });
            }}>
              {!metric.required && <option value="OMITTED">Tidak menyertakan metrik opsional</option>}
              <option value="INCOMPLETE">Belum lengkap (null, bukan nol)</option><option value="OBSERVED">Isi observasi eksplisit</option>
            </select>
          </label>
          {row && 'satisfied' in row && <label className="block text-sm font-medium">Hasil observasi lokal
            <select aria-label="Hasil observasi lokal" required className={fieldClass} value={String(row.satisfied)} onChange={event => metricUpdate({ satisfied: event.target.value === '' ? '' : event.target.value === 'true' })}>
              <option value="">Pilih hasil</option><option value="true">Ya, terpenuhi menurut bukti</option><option value="false">Tidak terpenuhi menurut bukti</option>
            </select>
          </label>}
          {row && 'count' in row && numberField('Jumlah lokal', 'count', row.count)}
          {row && 'numerator' in row && <div className="grid min-w-0 gap-3 sm:grid-cols-2">
            {numberField(metric.numeratorLabel!, 'numerator', row.numerator, metric.decimalPlaces === 4)}
            {numberField(metric.denominatorLabel!, 'denominator', row.denominator, metric.type === 'POPULATION_RATIO' || metric.decimalPlaces === 4)}
          </div>}
          {row && 'population' in row && <>
            {numberField('Populasi lokal dasar estimasi', 'population', row.population)}
            {numberField('Prevalensi lokal (%)', 'prevalencePercent', row.prevalencePercent, true)}
            {textField('Referensi populasi lokal', row.populationReference, populationReference => metricUpdate({ populationReference }))}
            {textField('Referensi prevalensi lokal', row.prevalenceReference, prevalenceReference => metricUpdate({ prevalenceReference }))}
            <p className="text-sm text-slate-600">D harus tepat populasi x prevalensi/100, maksimal empat desimal. Tidak dibulatkan atau diberi prevalensi bawaan.</p>
          </>}
          <p className="text-xs text-slate-600">{metric.subset ? 'Pembilang wajib bagian dari penyebut.' : 'Tidak dibatasi otomatis menjadi 100%.'} {metric.decimalPlaces === 4 ? 'Angka maksimal empat desimal.' : 'Hitungan wajib bulat.'} D nol menghasilkan null, bukan keberhasilan.</p>
        </fieldset>;
      })}
      <fieldset className="min-w-0 space-y-3 border-t border-slate-200 pt-3"><legend className="text-sm font-semibold">Target alternatif lokal (opsional)</legend>
        <p className="text-sm text-slate-600">Target sumber asli tetap terpisah. Tidak ada target lokal atau ketercapaian otomatis, termasuk untuk pengukuran 100%.</p>
        {candidates.length ? <label className="block text-sm font-medium">Pilih kandidat target lokal secara eksplisit
          <select aria-label="Pilih kandidat target lokal secara eksplisit" className={fieldClass} value={local.targetPolicy?.metricKey ?? ''} onChange={event => {
            const candidate = candidates.find(metric => metric.key === event.target.value);
            if (!candidate) { const { targetPolicy: _removed, ...rest } = local; onChange({ ...value, localResolution: rest }); }
            else update({ targetPolicy: { metricKey: candidate.key, value: candidate.targetValue!, reference: '' } });
          }}><option value="">Tanpa kebijakan target lokal</option>{candidates.map(metric => <option key={metric.key} value={metric.key}>{metric.label}: minimal {metric.targetValue}%</option>)}</select>
        </label> : <p className="text-sm text-slate-600">Descriptor tidak menyediakan kandidat target lokal.</p>}
        {local.targetPolicy && textField('Referensi penetapan target alternatif lokal', local.targetPolicy.reference, reference => update({ targetPolicy: { ...local.targetPolicy!, reference } }))}
      </fieldset>
    </>}
  </fieldset>;
}
