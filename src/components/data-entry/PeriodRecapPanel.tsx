import { useEffect, useState, useSyncExternalStore } from 'react';
import type { ComponentProps } from 'react';
import { api } from '../../services/apiClient';
import { pkpStore } from '../../services/apiStore';
import { monthPeriodLabel } from '../../services/inputPeriod';
import { measurementText } from '../../types/do2026';
import { OperationalDefinition } from '../common/OperationalDefinition';
import { confirmDiscardChanges } from '../common/useUnsavedChanges';
import { getRecapInputBlockReason, RecapEditor } from './recap-editor';
import { recapMethodLabels, recapMonths } from './recap-types';
import type { PeriodRecapResponse } from './recap-types';
import type { Do2026Profile } from '../../types/do2026';
import { sourceScopeLabel } from '../../services/sourceAssessment';
import { LocalResolutionResults } from './LocalResolutionResults';

function RecapInput({ profile, ...props }: Omit<ComponentProps<typeof RecapEditor>, 'profile'> & { readonly profile: Do2026Profile | undefined }) {
  // Keep the editor mounted on catalogue refresh; its live guard blocks stale contracts without discarding drafts.
  const [initialProfile] = useState(profile);
  return initialProfile && (initialProfile.status === 'IMPLEMENTED' || initialProfile.structuredInputKind === 'DO_SOURCE_ASSESSMENT') ? <RecapEditor {...props} profile={initialProfile} />
    : <p className="text-sm text-slate-600">Input rekap belum diaktifkan untuk profil ini. Tidak memakai rumus lama sebagai pengganti.</p>;
}

interface Props { readonly year: number; readonly month: number }
interface Scope {
  readonly year: number;
  readonly endMonth: number;
  readonly healthCenterId: string;
  readonly pending: boolean;
  readonly onPendingChange: (pending: boolean) => void;
}

function RecapWorkspace({ year, endMonth, healthCenterId, pending, onPendingChange }: Scope) {
  useSyncExternalStore(pkpStore.subscribe, pkpStore.getSnapshot, pkpStore.getServerSnapshot);
  const [response, setResponse] = useState<PeriodRecapResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [query, setQuery] = useState('');
  const [indicatorId, setIndicatorId] = useState('');
  const [saved, setSaved] = useState(false);
  const [editorRevision, setEditorRevision] = useState(0);
  const user = pkpStore.getSessionUser();
  useEffect(() => {
    if (!user) return;
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
  }, [year, endMonth, healthCenterId, retry, user?.id]);

  const assignments = pkpStore.getAssignments(year);
  const rows = user ? (response?.items ?? []).filter(row => user.role !== 'PIC' || assignments[row.indicatorId] === user.id) : [];
  const matches = rows.filter(row => `${row.indicatorId} ${row.indicator.indikator}`.toLocaleLowerCase('id').includes(query.toLocaleLowerCase('id')));
  const item = matches.find(row => row.indicatorId === indicatorId) ?? matches[0];
  const profile = pkpStore.getIndicators().find(indicator => indicator.id === item?.indicatorId)?.do2026;
  const readOnlyReason = getRecapInputBlockReason(year, endMonth, healthCenterId, item?.indicatorId, profile);
  const busy = pending || pkpStore.isMutating();
  const assessmentPeriod = item?.localResolutionResult?.sourcePeriod ?? item?.sourceAssessmentPeriod ?? item?.assessmentScope;
  const noCombined = item?.recapStructuredInput?.kind === 'DO_SOURCE_ASSESSMENT' && ['COMPONENT_OBSERVATIONS', 'SOURCE_OBSERVATION'].includes(item.recapStructuredInput.values?.kind);
  function navigate() {
    if (pending || pkpStore.isMutating() || !confirmDiscardChanges('recap')) return false;
    setEditorRevision(value => value + 1);
    setSaved(false);
    return true;
  }

  if (!user) return <p role="status" className="text-sm text-amber-900">Sesi berakhir. Silakan masuk kembali.</p>;
  if (loading) return <p role="status" className="text-sm text-slate-600">Memuat rekap Januari sampai {recapMonths[endMonth - 1]}...</p>;
  if (error) return <div className="space-y-2"><p role="alert" className="text-sm text-rose-800">{error}</p>
    <button type="button" disabled={busy} onClick={() => { if (navigate()) setRetry(value => value + 1); }} className="text-sm font-semibold text-emerald-800 underline disabled:opacity-50">Coba muat ulang</button></div>;
  return <div className="space-y-4">
    {readOnlyReason && <p role="status" className="text-sm text-amber-900">{readOnlyReason}</p>}
    {saved && <p role="status" className="text-sm text-emerald-800">Rekap terpisah tersimpan. Hasil telah dimuat ulang dari server.</p>}
    <p className="text-sm text-slate-600">{rows.length} indikator; {rows.filter(row => row.dataComplete).length} memiliki angka rekap; {rows.filter(row => row.scoreComplete).length} dapat dihitung skornya. Ini kelengkapan angka, bukan kelengkapan penilaian tahunan atau pengesahan hasil.</p>
    {!rows.length && <p role="status" className="text-sm text-slate-600">{user.role === 'PIC' ? 'Tidak ada indikator rekap yang ditugaskan kepada Anda pada periode ini.' : 'Tidak ada indikator rekap pada periode ini.'}</p>}
    <button type="button" disabled={busy} onClick={() => { if (navigate()) setRetry(value => value + 1); }} className="text-sm font-semibold text-emerald-800 underline disabled:opacity-50">Muat ulang rekap dari server</button>
    <label className="block text-sm font-medium">Cari indikator rekap
      <input type="search" value={query} disabled={busy} onChange={event => { if (navigate()) setQuery(event.target.value); }} placeholder="Nama atau kode indikator"
        className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 focus:ring-2 focus:ring-emerald-500" />
    </label>
    <label className="block text-sm font-medium">Indikator ({matches.length})
      <select value={item?.indicatorId ?? ''} onChange={event => { if (navigate()) setIndicatorId(event.target.value); }} disabled={busy || !matches.length}
        className="mt-1 block w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 focus:ring-2 focus:ring-emerald-500">
        {!matches.length && <option value="">Tidak ada indikator yang cocok</option>}
        {matches.map(row => <option key={row.indicatorId} value={row.indicatorId}>{row.indicatorId} - {row.indicator.indikator}</option>)}
      </select>
    </label>
    {item && <section aria-label="Hasil rekap indikator" className="space-y-4">
      <h3 className="break-words text-sm font-semibold text-slate-900">{item.indicator.indikator}</h3>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg bg-slate-50 p-4 text-sm sm:grid-cols-4">
        <div><dt className="text-slate-500">Pembilang (N)</dt><dd className="mt-1 font-semibold">{noCombined ? 'Tidak berlaku untuk hasil gabungan' : item.numerator ?? '-'}</dd></div>
        <div><dt className="text-slate-500">Penyebut (D)</dt><dd className="mt-1 font-semibold">{noCombined ? 'Tidak berlaku untuk hasil gabungan' : item.denominator ?? '-'}</dd></div>
        <div><dt className="text-slate-500">Pengukuran</dt><dd className="mt-1 font-semibold">{measurementText(item.measurementValue, item.measurementUnit,
          item.indicatorId === 'K1-R39' && item.scoringVersion === 'DO_2026_V2' && item.measurementUnit === 'SCORE' ? 5 : 4)}</dd></div>
        <div><dt className="text-slate-500">Nilai kinerja</dt><dd className="mt-1 font-semibold">{measurementText(item.nilaiKinerja, 'SCORE')}</dd></div>
      </dl>
      <div className="space-y-1 text-sm text-slate-600">
        {assessmentPeriod && <p className="break-words">Lingkup asesmen sumber: {sourceScopeLabel(assessmentPeriod)}. {assessmentPeriod.kind === 'ANNUAL' ? 'Tahun kalender penuh, tetap provisional.' : 'Tidak berlaku sebagai capaian tahunan; tidak dikonversi atau digabung antarbulan.'}</p>}
        <p>Metode: {recapMethodLabels[item.aggregationMethod] ?? item.aggregationMethod}</p>
        {profile?.cumulativeInstruction && <p>{profile.cumulativeInstruction}</p>}
        <p className="break-words">Status hitung: {item.status}. Angka rekap {item.dataComplete ? 'tersedia' : 'belum tersedia'}; skor {item.scoreComplete ? 'dapat dihitung' : 'belum dapat dihitung'}.</p>
        {item.status === 'VERIFIED_NO_CASE_TARGET_MET' && <p className="text-sm text-emerald-900">Nihil terverifikasi menurut attestasi petugas: target terpenuhi dengan referensi Dinsos dan rekonsiliasi kohort. Bukan verifikasi eksternal; tidak ada persentase 0/0 atau skor numerik.</p>}
        {!profile?.annualRecapOnly && profile?.assessmentInstruction && <p className="text-amber-900">{profile.assessmentInstruction}</p>}
        <p>Data bulanan tersedia ({item.availableMonths.length}): {item.availableMonths.map(month => recapMonths[month - 1] ?? month).join(', ') || 'Tidak ada'}.</p>
        <p>Data bulanan belum tersedia ({item.missingMonths.length}): {item.missingMonths.map(month => recapMonths[month - 1] ?? month).join(', ') || 'Tidak ada'}. Rekap terpisah dinilai secara mandiri.</p>
        {item.reason && <p className="rounded-lg bg-amber-50 p-3 text-amber-900">{item.reason}</p>}
        {item.recapNotes && <p className="whitespace-pre-wrap break-words">Catatan rekap tersimpan: {item.recapNotes}</p>}
      </div>
      {item.localResolutionResult && <LocalResolutionResults result={item.localResolutionResult} />}
      <OperationalDefinition key={item.indicatorId} indicatorId={item.indicatorId} year={year} />
      <RecapInput key={`${item.indicatorId}:${item.recapRevision}:${editorRevision}`} item={item} profile={profile}
        year={year} endMonth={endMonth} healthCenterId={healthCenterId} readOnlyReason={readOnlyReason} onPendingChange={onPendingChange}
        onSaved={() => { setSaved(true); setRetry(value => value + 1); }} />
    </section>}
  </div>;
}

export function PeriodRecapPanel({ year, month }: Props) {
  useSyncExternalStore(pkpStore.subscribe, pkpStore.getSnapshot, pkpStore.getServerSnapshot);
  const [endMonth, setEndMonth] = useState(month);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const healthCenterId = pkpStore.getSelectedHealthCenterId();
  const user = pkpStore.getSessionUser();
  const busy = pending || pkpStore.isMutating();
  useEffect(() => { setEndMonth(month); }, [year, month, healthCenterId]);
  return <details open={open} className="rounded-xl border border-slate-200 bg-white p-4 text-slate-800 sm:p-5">
    <summary onClick={event => {
      event.preventDefault();
      if (open && (pending || pkpStore.isMutating() || !confirmDiscardChanges('recap'))) return;
      setOpen(!open);
    }} className="cursor-pointer font-semibold focus-visible:outline-emerald-600">Rekap Kumulatif &amp; Tahunan</summary>
    <div className="mt-4 space-y-4">
      <p className="text-sm text-slate-600">Akhir periode penyimpanan: {monthPeriodLabel(year, endMonth)}. Rekap kumulatif memakai Januari sampai akhir periode; asesmen sumber mengikuti lingkup DO masing-masing, bukan otomatis YTD atau tahunan. Puskesmas: {pkpStore.getSelectedHealthCenter()?.name ?? healthCenterId ?? 'Belum dipilih'}. Hasil provisional; bukan penilaian resmi Dinkes.</p>
      <label className="block max-w-sm text-sm font-medium">Akhir periode rekap
        <select value={endMonth} disabled={busy} onChange={event => {
          if (!pending && !pkpStore.isMutating() && confirmDiscardChanges('recap')) setEndMonth(Number(event.target.value));
        }} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 focus:ring-2 focus:ring-emerald-500">
          {recapMonths.map((name, index) => <option key={name} value={index + 1}>{name}{index === 11 ? ' - Akhir tahun kalender' : ''}</option>)}
        </select>
      </label>
      {open && (healthCenterId ? <RecapWorkspace key={`${user?.id}:${healthCenterId}:${year}:${endMonth}`} healthCenterId={healthCenterId} year={year} endMonth={endMonth} pending={pending} onPendingChange={setPending} />
        : <p role="status" className="text-sm text-slate-600">Pilih Puskesmas untuk membaca rekap.</p>)}
    </div>
  </details>;
}
