import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { FormEvent, SyntheticEvent } from 'react';
import type { OfficialIndicator } from '../../types/pkp';
import type { Do2026RecordFields } from '../../types/do2026';
import { pkpStore } from '../../services/apiStore';
import { api } from '../../services/apiClient';
import { getMonthlyInputBlockReason, monthPeriodLabel } from '../../services/inputPeriod';
import { structuredInputKindFor } from '../../services/recapStructuredInput';
import { OperationalDefinition } from '../common/OperationalDefinition';
import { EvidencePreviewDialog } from '../common/EvidencePreviewDialog';
import { confirmDiscardChanges, useUnsavedChanges } from '../common/useUnsavedChanges';

interface Props {
  readonly indicator: OfficialIndicator;
  readonly record: Do2026RecordFields & { readonly pencapaianRiil: number | null; readonly notes?: string; readonly evidenceId?: string | null };
  readonly year: number;
  readonly month: number;
  readonly canEdit: boolean;
  readonly onClose: () => void;
}

export function Do2026Editor({ indicator, record, year, month, canEdit, onClose }: Props) {
  useSyncExternalStore(pkpStore.subscribe, pkpStore.getSnapshot, pkpStore.getServerSnapshot);
  const profile = indicator.do2026;
  const legacy = record.pencapaianRiil != null && record.scoringVersion !== 'DO_2026_V2';
  const historicalYtd = record.scoringVersion === 'DO_2026_V2' && record.inputBasis === 'YTD_ACTUAL';
  const [convert, setConvert] = useState(!legacy);
  const [numerator, setNumerator] = useState(record.pencapaianRiil?.toString() ?? '');
  const [denominator, setDenominator] = useState(legacy ? '' : record.totalSasaran?.toString() ?? '');
  const [notes, setNotes] = useState(record.notes ?? '');
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const [uploadedEvidence, setUploadedEvidence] = useState<{ id: string; name: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<'selected' | 'stored' | null>(null);
  const [baseline] = useState({ numerator, denominator, notes, convert, evidenceFile });
  const [context] = useState(() => ({
    user: pkpStore.getSessionUser(),
    healthCenterId: pkpStore.getSelectedHealthCenterId(),
    healthCenterName: pkpStore.getSelectedHealthCenter()?.name ?? pkpStore.getSelectedHealthCenterId(),
    year: pkpStore.getCurrentYear(), month, indicatorId: indicator.id,
    periodLabel: monthPeriodLabel(year, month),
  }));
  const dialog = useRef<HTMLDialogElement>(null);
  const active = useRef(true);
  const busy = useRef(false);
  const dirty = numerator !== baseline.numerator || denominator !== baseline.denominator ||
    notes !== baseline.notes || convert !== baseline.convert || evidenceFile !== baseline.evidenceFile;
  useUnsavedChanges(dirty || pending, 'do-editor');
  useEffect(() => {
    active.current = true;
    dialog.current?.showModal();
    return () => { active.current = false; };
  }, []);
  const supported = profile?.status === 'IMPLEMENTED';
  // Keep async continuations on the latest props while checking the live store again.
  const getBlockReason = useRef<(includeProfileRule?: boolean) => string | null>(() => null);
  getBlockReason.current = (includeProfileRule = true) => {
    const user = pkpStore.getSessionUser();
    if (!user) return 'Sesi berakhir. Silakan masuk kembali.';
    if (user !== context.user) return 'Sesi pengguna berubah. Buka kembali isian sebelum menyimpan.';
    if (pkpStore.getSelectedHealthCenterId() !== context.healthCenterId ||
      pkpStore.getCurrentYear() !== context.year || year !== context.year ||
      month !== context.month || indicator.id !== context.indicatorId) {
      return 'Lingkup Puskesmas atau periode berubah. Buka kembali isian.';
    }
    return getMonthlyInputBlockReason(year, month, indicator.id) ??
      (historicalYtd ? 'Hanya baca: koreksi YTD melalui rekap terpisah.' :
        !canEdit ? 'Hanya baca: isian ini tidak dapat diubah.' : null) ??
      (includeProfileRule && convert && (profile?.structuredInputKind === 'DO_SOURCE_ASSESSMENT' || pkpStore.getIndicators().find(row => row.id === indicator.id)?.do2026?.structuredInputKind === 'DO_SOURCE_ASSESSMENT')
        ? 'Profil ini memerlukan asesmen sumber terstruktur melalui Rekap Kumulatif & Tahunan. Input V2 bulanan tidak tersedia; periode mengikuti DO, bukan otomatis tahunan.' : null) ??
      (includeProfileRule && convert && (structuredInputKindFor(indicator.id) || profile?.annualRecapOnly ||
        pkpStore.getIndicators().find(row => row.id === indicator.id)?.do2026?.annualRecapOnly)
        ? 'Profil ini hanya menerima rekap tahunan Januari sampai Desember. Input V2 bulanan tidak tersedia, termasuk bulan Desember. Buka Rekap Kumulatif & Tahunan, lalu pilih Desember.' : null);
  };
  const permissionReason = getBlockReason.current(false);
  const readOnlyReason = getBlockReason.current() ?? (convert && !supported ? 'Hanya baca: input DO 2026 belum tersedia.' : null);
  const blocked = Boolean(readOnlyReason) || pending;

  function close(event: SyntheticEvent) {
    event.preventDefault();
    if (pending || busy.current || (dirty && !confirmDiscardChanges('do-editor'))) return;
    onClose();
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (pending || busy.current) return;
    const reason = getBlockReason.current();
    if (reason) { setError(reason); return; }
    if (convert && !supported) return;
    const actualNumerator = Number(numerator);
    const actualDenominator = Number(denominator);
    if (!numerator.trim() || !Number.isFinite(actualNumerator) || actualNumerator < 0 ||
      (convert && (!denominator.trim() || !Number.isFinite(actualDenominator) || actualDenominator < 0))) {
      setError('Isi angka 0 atau lebih. Kosong tidak sama dengan 0.');
      return;
    }
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      let attachment = uploadedEvidence;
      if (evidenceFile && !attachment) {
        const metadata = await pkpStore.uploadEvidence(evidenceFile, month);
        if (!active.current) return;
        attachment = { id: metadata.evidenceId, name: evidenceFile.name };
        setUploadedEvidence(attachment);
      }
      const reason = getBlockReason.current();
      if (reason) { setError(reason); return; }
      const data: Parameters<typeof pkpStore.saveRecord>[2] = convert
        ? { pencapaianRiil: actualNumerator, totalSasaran: actualDenominator, scoringVersion: 'DO_2026_V2', inputBasis: 'PERIOD_ACTUAL', notes }
        : { pencapaianRiil: actualNumerator, notes };
      // Omit unchanged evidence so editing numbers never clears an existing attachment.
      if (attachment) data.evidenceId = attachment.id;
      await pkpStore.saveRecord(indicator.id, month, data, year);
      if (active.current) onClose();
    } catch (failure) {
      if (active.current) setError(failure instanceof Error ? failure.message : 'Penyimpanan gagal. Coba kembali.');
    } finally {
      busy.current = false;
      if (active.current) setPending(false);
    }
  }

  const evidenceId = uploadedEvidence?.id ?? record.evidenceId;
  async function downloadEvidence() {
    if (!evidenceId || pending || busy.current) return;
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      const file = await pkpStore.getEvidenceDownload(evidenceId);
      if (active.current) api.saveDownload(file, uploadedEvidence?.name ?? `bukti-${evidenceId}`);
    } catch (failure) {
      if (active.current) setError(failure instanceof Error ? failure.message : 'Unduhan gagal. Coba kembali.');
    } finally {
      busy.current = false;
      if (active.current) setPending(false);
    }
  }

  return (
    <dialog ref={dialog} aria-labelledby="do2026-title" onCancel={close}
      className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border border-slate-200 p-5 text-slate-800 shadow-xl backdrop:bg-slate-900/40">
      <form onSubmit={save} className="space-y-4">
        <div>
          <h2 id="do2026-title" className="text-base font-bold">Input {convert ? 'DO 2026' : 'kompatibilitas V1'}</h2>
          <p className="text-sm mt-1">{indicator.indikator}</p>
          <p className="text-xs text-slate-500">{context.periodLabel}</p>
          {convert && <p className="mt-1 text-xs text-slate-500">Evaluasi internal; belum disahkan Dinkes.</p>}
        </div>
        {historicalYtd && <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
          Rekap YTD lama hanya baca. Buat rekap atau koreksi terpisah melalui “Rekap Kumulatif &amp; Tahunan”.
        </p>}
        {legacy && <div className="rounded-xl bg-slate-50 p-3 text-sm space-y-2">
          <p>Data V1 tetap memakai aturan lama tanpa konversi.</p>
          <label className="flex items-start gap-2"><input type="checkbox" checked={convert} disabled={pending || Boolean(permissionReason)}
            onChange={event => { setConvert(event.target.checked); setDenominator(''); setError(null); }} />
            Konversi ke DO 2026; isi ulang D aktual, bukan prorata.</label>
        </div>}
        {convert && !supported ? <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
          <p role="status">{profile?.structuredInputKind === 'DO_SOURCE_ASSESSMENT' ? 'Pencatatan DO tersedia melalui asesmen sumber terpisah, bukan input bulanan. Hasil hitung mengikuti ketersediaan dan konteks sumber.' : 'Input DO 2026 belum tersedia untuk indikator ini.'}</p>
          {profile?.reason && <details className="mt-2"><summary className="cursor-pointer focus-visible:outline-emerald-600">Lihat alasan</summary>
            <p className="mt-2">{profile.reason}</p>
          </details>}
        </div> : <>
          <label className="block text-sm font-medium">{convert ? profile?.numeratorLabel ?? 'Pembilang aktual (N)' : 'Realisasi V1'}
            <input autoFocus type="number" min="0" step={convert && profile?.numeratorInput === 'INTEGER' ? '1' : 'any'} required value={numerator} disabled={blocked}
              onChange={event => setNumerator(event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 focus:ring-2 focus:ring-emerald-500" />
          </label>
          {convert && <>
            <label className="block text-sm font-medium">{profile?.denominatorLabel ?? 'Penyebut aktual (D)'}
              <input type="number" min="0" step={profile?.denominatorInput === 'INTEGER' ? '1' : 'any'} required value={denominator} disabled={blocked}
                onChange={event => setDenominator(event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 focus:ring-2 focus:ring-emerald-500" />
            </label>
            <label className="block text-sm font-medium">Basis N dan D
              <select value={historicalYtd ? 'YTD_ACTUAL' : 'PERIOD_ACTUAL'} disabled
                className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2">
                <option value="PERIOD_ACTUAL">Aktual bulan ini (bukan kumulatif)</option>
                {historicalYtd && <option value="YTD_ACTUAL">Rekap YTD lama (hanya baca)</option>}
              </select>
            </label>
            <p className="text-xs text-slate-500">N dan D harus dari populasi/sampel dan periode yang sama.</p>
            {denominator.trim() !== '' && Number(denominator) === 0 && <p role="status" className="text-xs text-amber-900">D = 0 tidak otomatis berarti nihil terverifikasi.</p>}
            {profile?.assessmentInstruction && <p role="status" className="text-xs text-amber-900">{profile.assessmentInstruction}</p>}
            <details className="text-xs text-slate-600">
              <summary className="cursor-pointer font-medium text-emerald-800 focus-visible:outline-emerald-600">Panduan rekap</summary>
              <div className="mt-2 space-y-2">
                <p>Gunakan “Rekap Kumulatif &amp; Tahunan” untuk rekap Januari-akhir periode, terpisah dari data bulanan. Jangan menjumlahkan YTD antarbulan.</p>
                {profile?.cumulativeInstruction && <p>{profile.cumulativeInstruction}</p>}
              </div>
            </details>
          </>}
          <label className="block text-sm font-medium">Catatan sumber data
            <textarea value={notes} disabled={blocked} onChange={event => setNotes(event.target.value)} rows={2}
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2" />
          </label>
        </>}
        <div className="space-y-2 text-sm">
          <label className="block font-medium">Lampirkan bukti dukung
            <input type="file" accept=".pdf,.png,.jpg,.jpeg,.xlsx" disabled={blocked}
              onChange={event => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (!file) return;
                if (file.size === 0 || file.size > 10 * 1024 * 1024) {
                  setError('Ukuran bukti dukung harus antara 1 byte dan 10 MiB.');
                  return;
                }
                setEvidenceFile(file);
                setUploadedEvidence(null);
                setError(null);
              }} className="mt-1 block w-full text-xs" />
          </label>
          <p className="text-xs text-slate-500">PDF/PNG/JPEG/XLSX, maks. 10 MiB. Unggah saat Simpan; bukti lama tetap jika tidak diganti.</p>
          {evidenceFile && <p className="break-words text-xs">Bukti dipilih: {evidenceFile.name}</p>}
          {evidenceFile && <button type="button" disabled={pending} onClick={() => setPreview('selected')}
            className="block text-xs text-emerald-700 underline disabled:opacity-50">Pratinjau file terpilih</button>}
          {evidenceFile && <button type="button" disabled={pending} onClick={() => { setEvidenceFile(null); setUploadedEvidence(null); }}
            className="block text-xs text-slate-600 underline disabled:opacity-50">Batal ganti bukti</button>}
          {evidenceId && <button type="button" disabled={pending} onClick={() => setPreview('stored')}
            className="block text-xs text-emerald-700 underline disabled:opacity-50">Pratinjau bukti tersimpan</button>}
          {evidenceId && <button type="button" disabled={pending} onClick={() => void downloadEvidence()}
            className="text-xs text-emerald-700 underline disabled:opacity-50">Unduh bukti dukung</button>}
        </div>
        <OperationalDefinition key={`${indicator.id}:${year}`} indicatorId={indicator.id} year={year} />
        {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
        {pending && <p role="status" className="text-sm">Memproses...</p>}
        <p className="break-words text-xs text-slate-500">Simpan untuk {context.periodLabel}. Puskesmas: {context.healthCenterName ?? 'Belum dipilih'}.</p>
        {readOnlyReason && <p role="status" className="text-xs text-amber-900">{readOnlyReason}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" disabled={pending} onClick={close} className="rounded-lg border border-slate-300 px-4 py-2 text-sm">Batal</button>
          <button type="submit" disabled={blocked} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {legacy && convert ? 'Simpan dan konversi' : 'Simpan'}
          </button>
        </div>
      </form>
      {preview && <EvidencePreviewDialog evidenceId={preview === 'stored' ? evidenceId : undefined}
        file={preview === 'selected' ? evidenceFile ?? undefined : undefined} onClose={() => setPreview(null)} />}
    </dialog>
  );
}
