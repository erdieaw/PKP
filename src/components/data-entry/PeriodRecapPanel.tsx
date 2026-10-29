import { useEffect, useState, useSyncExternalStore } from 'react';
import { api } from '../../services/apiClient';
import { pkpStore } from '../../services/apiStore';
import { measurementText } from '../../types/do2026';
import { OperationalDefinition } from '../common/OperationalDefinition';
import { RecapEditor } from './recap-editor';
import { recapMethodLabels, recapMonths } from './recap-types';
import type { PeriodRecapResponse } from './recap-types';

interface Props { readonly year: number; readonly month: number }
interface Scope { readonly year: number; readonly endMonth: number; readonly healthCenterId: string }

function RecapWorkspace({ year, endMonth, healthCenterId }: Scope) {
  useSyncExternalStore(pkpStore.subscribe, pkpStore.getSnapshot, pkpStore.getServerSnapshot);
  const [response, setResponse] = useState<PeriodRecapResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [query, setQuery] = useState('');
  const [indicatorId, setIndicatorId] = useState('');
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ year: String(year), endMonth: String(endMonth), healthCenterId });
    void api.request<PeriodRecapResponse>(`/analytics/period-recap?${params}`, { signal: controller.signal }).then(result => {
      if (!controller.signal.aborted) setResponse(result);
    }).catch((failure: unknown) => {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Rekap gagal dimuat.');
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [year, endMonth, healthCenterId, retry]);

  const rows = response?.items ?? [];
  const matches = rows.filter(row => `${row.indicatorId} ${row.indicator.indikator}`.toLocaleLowerCase('id').includes(query.toLocaleLowerCase('id')));
  const item = matches.find(row => row.indicatorId === indicatorId) ?? matches[0];
  const profile = pkpStore.getIndicators().find(indicator => indicator.id === item?.indicatorId)?.do2026;
  const user = pkpStore.getCurrentUser();
  const locked = Array.from({ length: endMonth }, (_, index) => index + 1).some(month => pkpStore.isPeriodLocked(year, month));
  const canEdit = Boolean(item && pkpStore.canInputOwnPeriod(year) && !pkpStore.getLoadState().loading && !pkpStore.getLoadState().error && !locked &&
    (user.role === 'ADMIN_PUSKESMAS' || (user.role === 'PIC' && pkpStore.getAssignments(year)[item.indicatorId] === user.id)));

  if (loading) return <p role="status" className="text-sm text-slate-600">Memuat rekap Januari sampai {recapMonths[endMonth - 1]}...</p>;
  if (error) return <div className="space-y-2"><p role="alert" className="text-sm text-rose-800">{error}</p>
    <button type="button" onClick={() => setRetry(value => value + 1)} className="text-sm font-semibold text-emerald-800 underline">Coba muat ulang</button></div>;
  return <div className="space-y-4">
    {saved && <p role="status" className="text-sm text-emerald-800">Rekap terpisah tersimpan. Hasil telah dimuat ulang dari server.</p>}
    <p className="text-sm text-slate-600">{rows.length} indikator; {rows.filter(row => row.dataComplete).length} memiliki angka rekap; {rows.filter(row => row.scoreComplete).length} dapat dihitung skornya. Ini kelengkapan angka, bukan kelengkapan penilaian tahunan atau pengesahan hasil.</p>
    <button type="button" onClick={() => { setSaved(false); setRetry(value => value + 1); }} className="text-sm font-semibold text-emerald-800 underline">Muat ulang rekap dari server</button>
    <label className="block text-sm font-medium">Cari indikator rekap
      <input type="search" value={query} onChange={event => { setQuery(event.target.value); setSaved(false); }} placeholder="Nama atau kode indikator"
        className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 focus:ring-2 focus:ring-emerald-500" />
    </label>
    <label className="block text-sm font-medium">Indikator ({matches.length})
      <select value={item?.indicatorId ?? ''} onChange={event => { setIndicatorId(event.target.value); setSaved(false); }} disabled={!matches.length}
        className="mt-1 block w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 focus:ring-2 focus:ring-emerald-500">
        {!matches.length && <option value="">Tidak ada indikator yang cocok</option>}
        {matches.map(row => <option key={row.indicatorId} value={row.indicatorId}>{row.indicatorId} - {row.indicator.indikator}</option>)}
      </select>
    </label>
    {item && <section aria-label="Hasil rekap indikator" className="space-y-4">
      <h3 className="break-words text-sm font-semibold text-slate-900">{item.indicator.indikator}</h3>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg bg-slate-50 p-4 text-sm sm:grid-cols-4">
        <div><dt className="text-slate-500">Pembilang (N)</dt><dd className="mt-1 font-semibold">{item.numerator ?? '-'}</dd></div>
        <div><dt className="text-slate-500">Penyebut (D)</dt><dd className="mt-1 font-semibold">{item.denominator ?? '-'}</dd></div>
        <div><dt className="text-slate-500">Pengukuran</dt><dd className="mt-1 font-semibold">{measurementText(item.measurementValue, item.measurementUnit)}</dd></div>
        <div><dt className="text-slate-500">Nilai kinerja</dt><dd className="mt-1 font-semibold">{measurementText(item.nilaiKinerja, 'SCORE')}</dd></div>
      </dl>
      <div className="space-y-1 text-sm text-slate-600">
        <p>Metode: {recapMethodLabels[item.aggregationMethod] ?? item.aggregationMethod}</p>
        {profile?.cumulativeInstruction && <p>{profile.cumulativeInstruction}</p>}
        <p className="break-words">Status hitung: {item.status}. Angka rekap {item.dataComplete ? 'tersedia' : 'belum tersedia'}; skor {item.scoreComplete ? 'dapat dihitung' : 'belum dapat dihitung'}.</p>
        {profile?.assessmentInstruction && <p className="text-amber-900">{profile.assessmentInstruction}</p>}
        <p>Data bulanan tersedia ({item.availableMonths.length}): {item.availableMonths.map(month => recapMonths[month - 1] ?? month).join(', ') || 'Tidak ada'}.</p>
        <p>Data bulanan belum tersedia ({item.missingMonths.length}): {item.missingMonths.map(month => recapMonths[month - 1] ?? month).join(', ') || 'Tidak ada'}. Rekap terpisah dinilai secara mandiri.</p>
        {item.reason && <p className="rounded-lg bg-amber-50 p-3 text-amber-900">{item.reason}</p>}
        {item.recapNotes && <p className="whitespace-pre-wrap break-words">Catatan rekap tersimpan: {item.recapNotes}</p>}
      </div>
      <OperationalDefinition key={item.indicatorId} indicatorId={item.indicatorId} year={year} />
      {profile?.status === 'IMPLEMENTED' ? <RecapEditor key={`${item.indicatorId}:${item.recapRevision}`} item={item} profile={profile}
        year={year} endMonth={endMonth} healthCenterId={healthCenterId} canEdit={canEdit}
        onSaved={() => { setSaved(true); setRetry(value => value + 1); }} />
        : <p className="text-sm text-slate-600">Input rekap belum diaktifkan untuk profil ini. Tidak memakai rumus lama sebagai pengganti.</p>}
    </section>}
  </div>;
}

export function PeriodRecapPanel({ year, month }: Props) {
  useSyncExternalStore(pkpStore.subscribe, pkpStore.getSnapshot, pkpStore.getServerSnapshot);
  const [endMonth, setEndMonth] = useState(month);
  const [open, setOpen] = useState(false);
  const healthCenterId = pkpStore.getSelectedHealthCenterId();
  useEffect(() => { setEndMonth(month); }, [year, month, healthCenterId]);
  return <details onToggle={event => setOpen(event.currentTarget.open)} className="rounded-xl border border-slate-200 bg-white p-4 text-slate-800 sm:p-5">
    <summary className="cursor-pointer font-semibold focus-visible:outline-emerald-600">Rekap Kumulatif &amp; Tahunan</summary>
    <div className="mt-4 space-y-4">
      <p className="text-sm text-slate-600">Rekap {endMonth === 12 ? 'tahunan' : 'kumulatif'} Januari sampai {recapMonths[endMonth - 1]} {year}, bukan hanya triwulan terakhir. Hasil provisional; bukan penilaian resmi Dinkes.</p>
      <label className="block max-w-sm text-sm font-medium">Akhir periode rekap
        <select value={endMonth} onChange={event => setEndMonth(Number(event.target.value))} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 focus:ring-2 focus:ring-emerald-500">
          {recapMonths.map((name, index) => <option key={name} value={index + 1}>{name}{index === 11 ? ' - Tahunan' : ''}</option>)}
        </select>
      </label>
      {open && (healthCenterId ? <RecapWorkspace key={`${healthCenterId}:${year}:${endMonth}`} healthCenterId={healthCenterId} year={year} endMonth={endMonth} />
        : <p role="status" className="text-sm text-slate-600">Pilih Puskesmas untuk membaca rekap.</p>)}
    </div>
  </details>;
}
