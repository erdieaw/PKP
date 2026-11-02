import type { LocalMetricResult, LocalResolutionResult } from '../../types/localResolution';
import { measurementText } from '../../types/do2026';
import { sourceScopeLabel } from '../../services/sourceAssessment';

const statuses: Record<LocalMetricResult['status'], string> = {
  MEASURED: 'Terukur', INCOMPLETE: 'Belum lengkap', ZERO_DENOMINATOR: 'Penyebut nol',
  NOT_YET_DUE: 'Belum jatuh jadwal', NOT_APPLICABLE: 'Tidak berlaku menurut telaah', ASSESSMENT_SCOPE_MISMATCH: 'Lingkup laporan tidak sesuai',
};

export function LocalResolutionResults({ result }: { readonly result: LocalResolutionResult }) {
  return <section aria-label="Hasil solusi lokal" className="min-w-0 space-y-3 break-words border-t border-slate-200 pt-4 text-sm">
    <h4 className="font-semibold text-slate-900">Pengukuran solusi lokal provisional</h4>
    <p className="text-amber-900">Penerimaan lokal oleh petugas, bukan pengesahan Dinkes. Referensi belum diverifikasi eksternal (USER_ATTESTED_NOT_EXTERNALLY_VERIFIED). Hanya aritmetika, bukan penilaian lengkap; nilai kinerja dan skor tidak tersedia.</p>
    <p>Periode sumber asli: {sourceScopeLabel(result.sourcePeriod)}.</p>
    <p>Periode pengukuran lokal: {sourceScopeLabel(result.assessmentScope)}. {result.assessmentScope.annualComparable ? 'Lingkup tahun penuh, tetap provisional.' : 'Bukan hasil tahunan; tidak digabung antarbulan.'}</p>
    <p>Target sumber asli (tidak diwariskan): {JSON.stringify(result.originalTarget) ?? '-'}.</p>
    <p>Target alternatif lokal: {result.alternativeTarget ? `${result.alternativeTarget.metricKey}, minimal ${result.alternativeTarget.value}%; referensi ${result.alternativeTarget.reference}` : 'Tidak dipilih; ketercapaian tidak dinilai.'}</p>
    <p>N/D sumber mentah: {result.rawNumerator} / {result.rawDenominator}; bukan gabungan metrik lokal.</p>
    <dl className="min-w-0 divide-y divide-slate-200">
      {result.metrics.map(metric => <div key={metric.key} className="min-w-0 space-y-1 py-3" aria-label={`Hasil lokal: ${metric.label}`}>
        <dt className="font-medium">{metric.label}{metric.primary ? ' (utama lokal)' : ' (komponen terpisah)'}</dt>
        <dd>{metric.status === 'MEASURED' && metric.value !== null ? typeof metric.value === 'boolean' ? metric.value ? 'Ya' : 'Tidak' : measurementText(metric.value, metric.unit, 8) : 'Tidak ada nilai'}; {statuses[metric.status]} ({metric.status}).</dd>
        <dd>Target alternatif: {metric.targetMet === null ? 'Tidak dinilai' : metric.targetMet ? 'Terpenuhi' : 'Belum terpenuhi'}. Bukan skor kinerja.</dd>
      </div>)}
    </dl>
    {result.timelinessStatus === 'NOT_ASSESSED' && <p className="text-amber-900">Ketepatan waktu consent belum dinilai (NOT_ASSESSED). Kelengkapan consent tidak membuktikan batas 24 jam atau membenarkan consent setelah tindakan.</p>}
    <div className="space-y-1 text-amber-900"><p>Konflik sumber tetap {result.sourceStatus}:</p>{result.sourceConflicts.map((entry, i) => <p key={i}>{entry}</p>)}</div>
    <p>Referensi penerimaan: {result.acceptanceReference}. Kebijakan pengukuran: {result.measurementPolicyReference}. Otoritas keputusan lokal: {result.correctionAuthorityReference}.</p>
  </section>;
}
