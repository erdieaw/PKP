import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { FormEvent, SyntheticEvent } from 'react';
import type { OfficialIndicator } from '../../types/pkp';
import { defaultObservationKind, observationText } from '../../types/monthlyObservation';
import type { MonthlyObservation, MonthlyObservationInput, ObservationKind, ObservationStatus } from '../../types/monthlyObservation';
import { pkpStore } from '../../services/apiStore';
import { api, ApiError } from '../../services/apiClient';
import { getMonthlyInputBlockReason, monthPeriodLabel } from '../../services/inputPeriod';
import { confirmDiscardChanges, useUnsavedChanges } from '../common/useUnsavedChanges';

type Props = { indicator: OfficialIndicator; year: number; month: number; onClose: () => void };
const fieldClass = 'mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-600';

export function MonthlyObservationEditor({ indicator, year, month, onClose }: Props) {
  useSyncExternalStore(pkpStore.subscribe, pkpStore.getSnapshot, pkpStore.getServerSnapshot);
  const [context] = useState(() => ({ user: pkpStore.getSessionUser(), year, month, indicatorId: indicator.id,
    center: pkpStore.getSelectedHealthCenterId(), centerName: pkpStore.getSelectedHealthCenter()?.name }));
  const [kind, setKind] = useState<ObservationKind>(defaultObservationKind(indicator));
  const [status, setStatus] = useState<ObservationStatus>('RECORDED');
  const [value, setValue] = useState('');
  const [denominator, setDenominator] = useState('');
  const [documentAvailable, setDocumentAvailable] = useState('');
  const [unit, setUnit] = useState(indicator.satuan ?? '');
  const [notes, setNotes] = useState('');
  const [sourceReference, setSourceReference] = useState('');
  const [stored, setStored] = useState<MonthlyObservation>();
  const [file, setFile] = useState<File | null>(null);
  const [uploaded, setUploaded] = useState<string>();
  const [baseline, setBaseline] = useState('');
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const active = useRef(false);
  const busy = useRef(false);
  const draft = JSON.stringify([kind, status, value, denominator, documentAvailable, unit, notes, sourceReference]);
  const dirty = Boolean(baseline && (baseline !== draft || file));
  useUnsavedChanges(dirty || pending, 'monthly-observation');

  function scopeReason() {
    if (context.user !== pkpStore.getSessionUser() || context.center !== pkpStore.getSelectedHealthCenterId() ||
      context.year !== pkpStore.getCurrentYear() || year !== context.year || month !== context.month || indicator.id !== context.indicatorId) {
      return 'Sesi atau lingkup berubah. Tutup dan buka kembali observasi.';
    }
    return null;
  }
  function apply(row?: MonthlyObservation) {
    const next = [row?.kind ?? defaultObservationKind(indicator), row?.status ?? 'RECORDED',
      row?.value?.toString() ?? '', row?.denominator?.toString() ?? '',
      row?.documentAvailable == null ? '' : String(row.documentAvailable), row?.unit ?? indicator.satuan ?? '', row?.notes ?? '', row?.sourceReference ?? ''] as const;
    setKind(next[0]); setStatus(next[1]); setValue(next[2]); setDenominator(next[3]);
    setDocumentAvailable(next[4]); setUnit(next[5]); setNotes(next[6]); setSourceReference(next[7]);
    setStored(row); setFile(null); setUploaded(undefined); setConflict(false); setBaseline(JSON.stringify(next));
  }
  async function reload() {
    if (busy.current || (dirty && !confirmDiscardChanges('monthly-observation'))) return;
    const reason = scopeReason();
    if (reason) { setError(reason); return; }
    busy.current = true; setLoading(true); setError(null); setSuccess(false);
    try {
      const rows = await pkpStore.fetchMonthlyObservations(year, month);
      if (active.current && !scopeReason()) apply(rows.find(row => row.indicatorId === indicator.id));
    } catch (failure) {
      if (active.current) setError(failure instanceof Error ? failure.message : 'Observasi gagal dimuat. Coba muat ulang.');
    } finally {
      busy.current = false;
      if (active.current) setLoading(false);
    }
  }
  useEffect(() => {
    active.current = true;
    dialog.current?.showModal();
    void reload();
    return () => { active.current = false; };
    // Each editor is mounted with an immutable scope key by its caller.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const reason = scopeReason() ?? getMonthlyInputBlockReason(year, month, indicator.id);
  const blocked = Boolean(reason) || loading || pending || !baseline || conflict;
  const numeric = kind === 'NUMBER' || kind === 'RATIO';
  function close(event: SyntheticEvent) {
    event.preventDefault();
    if (!busy.current && !pending && (!dirty || confirmDiscardChanges('monthly-observation'))) onClose();
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy.current || blocked) return;
    const meaningful = (text: string) => /[^\s\u200B-\u200D\uFEFF]/u.test(text);
    const validNumber = (text: string) => text.trim() !== '' && Number.isFinite(Number(text)) && Number(text) >= 0 && Number(text) <= 1e12;
    if (((status !== 'RECORDED' || kind === 'NOTE') && !meaningful(notes)) ||
      (status === 'RECORDED' && numeric && (!validNumber(value) || !meaningful(unit) || (kind === 'RATIO' && !validNumber(denominator)))) ||
      (status === 'RECORDED' && kind === 'DOCUMENT' && documentAvailable === '')) {
      setError('Lengkapi isian sesuai jenis dan status. Angka 0 dan dokumen tidak tersedia berbeda dari isian kosong; catatan alasan wajib untuk status tanpa data.');
      return;
    }
    busy.current = true; setPending(true); setError(null); setSuccess(false);
    try {
      let evidenceId = uploaded;
      if (file && !evidenceId) {
        const result = await pkpStore.uploadEvidence(file, month);
        if (!active.current) return;
        evidenceId = result.evidenceId; setUploaded(evidenceId);
      }
      const changed = scopeReason() ?? getMonthlyInputBlockReason(year, month, indicator.id);
      if (changed) throw new Error(changed);
      const input: MonthlyObservationInput = {
        indicatorId: indicator.id, revision: stored?.revision ?? 0, kind, status,
        value: status === 'RECORDED' && numeric ? Number(value) : null,
        denominator: status === 'RECORDED' && kind === 'RATIO' ? Number(denominator) : null,
        documentAvailable: status === 'RECORDED' && kind === 'DOCUMENT' ? documentAvailable === 'true' : null,
        unit: numeric ? unit : null, notes, sourceReference,
      };
      // Omission preserves the server attachment, including evidence not downloaded by this editor.
      if (evidenceId) input.evidenceId = evidenceId;
      const rows = await pkpStore.saveMonthlyObservation(year, month, input);
      if (active.current && !scopeReason()) { apply(rows.find(row => row.indicatorId === indicator.id)); setSuccess(true); }
    } catch (failure) {
      if (active.current) {
        if (failure instanceof ApiError && failure.status === 409) {
          setConflict(true);
          setError('Observasi berubah atau periode dikunci di sesi lain. Isian Anda belum disimpan. Muat ulang, tinjau data terbaru, lalu isi kembali; tidak ada penimpaan otomatis.');
        } else setError(failure instanceof Error ? failure.message : 'Penyimpanan gagal. Isian tetap tersedia untuk dicoba kembali.');
      }
    } finally {
      busy.current = false;
      if (active.current) setPending(false);
    }
  }
  async function download() {
    const id = uploaded ?? stored?.evidenceId;
    if (!id || busy.current || scopeReason()) return;
    busy.current = true; setPending(true); setError(null);
    try {
      const result = await pkpStore.getEvidenceDownload(id);
      if (active.current && !scopeReason()) api.saveDownload(result, file?.name ?? `bukti-${id}`);
    } catch (failure) { if (active.current) setError(failure instanceof Error ? failure.message : 'Unduhan gagal.'); }
    finally { busy.current = false; if (active.current) setPending(false); }
  }
  return <dialog ref={dialog} aria-labelledby="monthly-observation-title" onCancel={close}
    className="w-[calc(100%-2rem)] max-w-lg max-h-[90dvh] overflow-y-auto rounded-xl border border-slate-200 bg-white p-5 text-slate-800 shadow-xl backdrop:bg-slate-900/40">
    <form onSubmit={save} onChange={() => setSuccess(false)} noValidate className="space-y-4">
      <header>
        <h2 id="monthly-observation-title" className="text-base font-bold">Observasi bulanan</h2>
        <p className="mt-1 break-words text-sm">{indicator.indikator}</p>
        <p className="mt-1 text-xs text-slate-600">{context.centerName} / {monthPeriodLabel(year, month)}</p>
        <p className="mt-2 text-xs text-slate-600">Catatan mentah bulan ini, bukan skor, keputusan tidak berlaku, atau penilaian tahunan. Tidak dijumlahkan otomatis ke rekap.</p>
      </header>
      {reason && <p role="status" className="text-sm text-amber-900">{reason}</p>}
      {loading && <p role="status">Memuat observasi tersimpan...</p>}
      {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
      {success && <p role="status" className="text-sm text-emerald-800">Observasi bulanan tersimpan di server. Revisi {stored?.revision}.</p>}
      <fieldset disabled={blocked} className="space-y-3 disabled:opacity-70">
        <label className="block text-sm font-medium">Jenis observasi
          <select autoFocus className={fieldClass} value={kind} onChange={event => { setKind(event.target.value as ObservationKind); setSuccess(false); }}>
            <option value="NUMBER">Angka</option><option value="DOCUMENT">Dokumen</option><option value="RATIO">Rasio mentah (N/D)</option><option value="NOTE">Catatan saja</option>
          </select>
        </label>
        <label className="block text-sm font-medium">Status bulan ini
          <select className={fieldClass} value={status} onChange={event => { setStatus(event.target.value as ObservationStatus); setSuccess(false); }}>
            <option value="RECORDED">Dicatat</option><option value="NOT_DUE">Belum jatuh jadwal</option><option value="NOT_AVAILABLE">Data belum tersedia</option>
          </select>
        </label>
        {status === 'RECORDED' && numeric && <>
          <label className="block text-sm font-medium">{kind === 'RATIO' ? 'Pembilang (N)' : 'Nilai observasi'}
            <input className={fieldClass} type="number" min="0" max="1000000000000" step="any" value={value} onChange={event => setValue(event.target.value)} />
          </label>
          {kind === 'RATIO' && <label className="block text-sm font-medium">Penyebut (D)
            <input className={fieldClass} type="number" min="0" max="1000000000000" step="any" value={denominator} onChange={event => setDenominator(event.target.value)} />
          </label>}
          <label className="block text-sm font-medium">Satuan
            <input className={fieldClass} maxLength={100} value={unit} onChange={event => setUnit(event.target.value)} />
          </label>
          {kind === 'RATIO' && <p className="text-xs text-slate-600">N/D disimpan apa adanya, termasuk D = 0; tidak dihitung menjadi persen, skor, atau nihil terverifikasi.</p>}
        </>}
        {status === 'RECORDED' && kind === 'DOCUMENT' && <label className="block text-sm font-medium">Ketersediaan dokumen
          <select className={fieldClass} value={documentAvailable} onChange={event => setDocumentAvailable(event.target.value)}>
            <option value="">Pilih ketersediaan</option><option value="true">Tersedia</option><option value="false">Belum tersedia</option>
          </select>
        </label>}
        <label className="block text-sm font-medium">Catatan{kind === 'NOTE' || status !== 'RECORDED' ? ' / alasan (wajib)' : ' (opsional)'}
          <textarea className={fieldClass} rows={3} maxLength={4000} value={notes} onChange={event => setNotes(event.target.value)} />
        </label>
        <details><summary className="cursor-pointer text-sm font-medium text-emerald-800">Sumber dan bukti (opsional)</summary>
          <div className="mt-3 space-y-3">
            <label className="block text-sm font-medium">Referensi sumber
              <input className={fieldClass} maxLength={1000} value={sourceReference} onChange={event => setSourceReference(event.target.value)} />
            </label>
            <label className="block text-sm font-medium">Bukti observasi
              <input className="mt-1 block w-full text-xs" type="file" accept=".pdf,.png,.jpg,.jpeg,.xlsx" onChange={event => {
                const selected = event.target.files?.[0]; event.target.value = '';
                if (!selected) return;
                if (!selected.size || selected.size > 10 * 1024 * 1024) { setError('Ukuran bukti harus 1 byte sampai 10 MiB.'); return; }
                setFile(selected); setUploaded(undefined); setSuccess(false);
              }} />
            </label>
            <p className="text-xs text-slate-600">PDF/PNG/JPEG/XLSX, maks. 10 MiB. Bukti lama tetap tertaut jika tidak diganti.</p>
            {file && <p className="break-words text-xs">Bukti dipilih: {file.name}</p>}
          </div>
        </details>
      </fieldset>
      {(uploaded ?? stored?.evidenceId) && <button type="button" disabled={pending || loading || Boolean(scopeReason())} onClick={download} className="text-sm text-emerald-800 underline">Unduh bukti observasi tersimpan</button>}
      <footer className="flex flex-wrap justify-end gap-2">
        <button type="button" disabled={pending || loading} onClick={() => void reload()} className="min-h-11 rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:opacity-50">Muat ulang</button>
        <button type="button" disabled={pending || loading} onClick={close} className="min-h-11 rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:opacity-50">Tutup</button>
        <button type="submit" disabled={blocked} className="min-h-11 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">{pending ? 'Menyimpan...' : 'Simpan observasi'}</button>
      </footer>
    </form>
  </dialog>;
}

export function MonthlyObservationAction({ indicator, year, month }: Omit<Props, 'onClose'>) {
  useSyncExternalStore(pkpStore.subscribe, pkpStore.getSnapshot, pkpStore.getServerSnapshot);
  const [open, setOpen] = useState(false);
  const user = pkpStore.getSessionUser();
  const scope = `${user?.id}:${pkpStore.getSelectedHealthCenterId()}:${year}:${month}:${indicator.id}`;
  const [openedScope, setOpenedScope] = useState('');
  const row = pkpStore.getMonthlyObservation(indicator.id, month, year);
  const reason = getMonthlyInputBlockReason(year, month, indicator.id);
  return <div className="mt-2 space-y-1 text-left" onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
    {row && <p className="break-words text-xs text-slate-700">Observasi: {observationText(row)} <span className="text-slate-500">(mentah, rev. {row.revision})</span></p>}
    <button type="button" disabled={pkpStore.isMutating()} title={reason ?? undefined}
      onClick={() => { if (confirmDiscardChanges()) { setOpenedScope(scope); setOpen(true); } }}
      aria-label={`Observasi bulanan ${indicator.id}`}
      className="min-h-9 rounded-md border border-emerald-200 px-2 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-50 disabled:opacity-50">
      {reason ? 'Lihat observasi bulanan' : 'Observasi / catatan bulanan'}
    </button>
    {open && openedScope === scope && <MonthlyObservationEditor key={scope} indicator={indicator} year={year} month={month} onClose={() => setOpen(false)} />}
  </div>;
}

export function MonthlyObservationsLoad({ year, month }: { year: number; month: number }) {
  useSyncExternalStore(pkpStore.subscribe, pkpStore.getSnapshot, pkpStore.getServerSnapshot);
  const userId = pkpStore.getSessionUser()?.id;
  const center = pkpStore.getSelectedHealthCenterId();
  const workspace = pkpStore.getLoadState();
  const state = pkpStore.getMonthlyObservationsLoad(month, year);
  const loading = state?.status === 'loading';
  const ready = Boolean(userId && center && !workspace.loading && !workspace.error);
  useEffect(() => {
    if (ready) void pkpStore.fetchMonthlyObservations(year, month).catch(() => {});
  }, [year, month, userId, center, ready]);
  return <div className="text-xs text-slate-600">
    <button type="button" disabled={!ready || loading || pkpStore.isMutating()} className="min-h-9 text-emerald-800 underline disabled:opacity-50"
      onClick={() => { void pkpStore.fetchMonthlyObservations(year, month).catch(() => {}); }}>
      {loading ? 'Memuat observasi...' : 'Muat observasi bulan ini'}</button>
    {state?.status === 'loaded' ? <p role="status">Observasi bulan ini dimuat, terpisah dari skor.</p>
      : <p role={state?.status === 'error' ? 'alert' : 'status'}>{state?.status === 'error' ? `Observasi gagal dimuat: ${state.error}. Coba muat ulang.` : loading ? 'Memuat observasi bulan ini.' : 'Observasi bulan ini belum dimuat.'} Status pengisian belum dapat dipastikan; isian angka lama tetap tersedia.</p>}
  </div>;
}
