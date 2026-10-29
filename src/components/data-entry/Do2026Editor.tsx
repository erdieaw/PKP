import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { OfficialIndicator } from '../../types/pkp';
import type { Do2026RecordFields } from '../../types/do2026';
import { pkpStore } from '../../services/apiStore';
import { OperationalDefinition } from '../common/OperationalDefinition';

interface Props {
  readonly indicator: OfficialIndicator;
  readonly record: Do2026RecordFields & { readonly pencapaianRiil: number | null; readonly notes?: string };
  readonly year: number;
  readonly month: number;
  readonly canEdit: boolean;
  readonly onClose: () => void;
}

export function Do2026Editor({ indicator, record, year, month, canEdit, onClose }: Props) {
  const profile = indicator.do2026;
  const legacy = record.pencapaianRiil != null && record.scoringVersion !== 'DO_2026_V2';
  const historicalYtd = record.scoringVersion === 'DO_2026_V2' && record.inputBasis === 'YTD_ACTUAL';
  const [convert, setConvert] = useState(!legacy);
  const [numerator, setNumerator] = useState(record.pencapaianRiil?.toString() ?? '');
  const [denominator, setDenominator] = useState(legacy ? '' : record.totalSasaran?.toString() ?? '');
  const [notes, setNotes] = useState(record.notes ?? '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  const supported = profile?.status === 'IMPLEMENTED';
  const blocked = !canEdit || pending || historicalYtd || (convert && !supported);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (blocked) return;
    const actualNumerator = Number(numerator);
    const actualDenominator = Number(denominator);
    if (!numerator.trim() || !Number.isFinite(actualNumerator) || actualNumerator < 0 ||
      (convert && (!denominator.trim() || !Number.isFinite(actualDenominator) || actualDenominator < 0))) {
      setError('Isi N dan D aktual dengan angka nonnegatif. Angka kosong bukan nol.');
      return;
    }
    setPending(true);
    setError(null);
    try {
      const data: Parameters<typeof pkpStore.saveRecord>[2] = convert
        ? { pencapaianRiil: actualNumerator, totalSasaran: actualDenominator, scoringVersion: 'DO_2026_V2', inputBasis: 'PERIOD_ACTUAL', notes }
        : { pencapaianRiil: actualNumerator, notes };
      await pkpStore.saveRecord(indicator.id, month, data, year);
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Penyimpanan gagal. Coba kembali.');
    } finally {
      setPending(false);
    }
  }

  return (
    <dialog ref={dialog} aria-labelledby="do2026-title" onCancel={event => { if (pending) event.preventDefault(); else onClose(); }}
      className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border border-slate-200 p-5 text-slate-800 shadow-xl backdrop:bg-slate-900/40">
      <form onSubmit={save} className="space-y-4">
        <div>
          <h2 id="do2026-title" className="text-base font-bold">Input {convert ? 'DO 2026' : 'kompatibilitas V1'}</h2>
          <p className="text-sm mt-1">{indicator.indikator}</p>
          <p className="text-xs text-slate-500">Bulan {month}, tahun {year} · {convert ? 'DO_2026_V2' : record.scoringVersion ?? 'ILP_2026_V1'}</p>
          {convert && <p className="mt-1 text-xs text-slate-500">Profil sumber provisional; bukan pengesahan penilaian resmi Dinkes.</p>}
        </div>
        {historicalYtd && <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
          Rekap YTD lama hanya dapat dibaca di sini. Untuk angka kumulatif baru atau koreksi, tutup formulir ini dan gunakan “Rekap Kumulatif &amp; Tahunan”, lengkapi sumber dan konfirmasi. Data lama tidak ditimpa.
        </p>}
        {legacy && <div className="rounded-xl bg-slate-50 p-3 text-sm space-y-2">
          <p>Data tersimpan menggunakan V1. Mengedit tanpa konversi mempertahankan aturan historis.</p>
          <label className="flex items-start gap-2"><input type="checkbox" checked={convert} disabled={pending}
            onChange={event => { setConvert(event.target.checked); setDenominator(''); setError(null); }} />
            Konversi ke DO 2026 saat disimpan; isi ulang D aktual, bukan sasaran prorata.</label>
        </div>}
        {convert && !supported ? <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
          UNRESOLVED_RULE: {profile?.reason ?? 'Definisi belum tersedia. Input N/D dan penilaian otomatis belum diaktifkan; tidak memakai rumus V1 sebagai pengganti.'}
        </p> : <>
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
            <p className="text-xs text-slate-500">N dan D harus berasal dari populasi/sampel dan periode yang sama. YTD tidak dijumlahkan antarbulan. D = 0 tidak otomatis berarti nihil terverifikasi.</p>
            {profile?.cumulativeInstruction && <p className="text-xs text-slate-600">{profile.cumulativeInstruction}</p>}
            {profile?.assessmentInstruction && <p role="status" className="text-xs text-amber-900">{profile.assessmentInstruction}</p>}
            <p className="text-xs text-slate-600">Untuk rekap Januari–akhir periode yang baru, tutup form ini lalu gunakan “Rekap Kumulatif &amp; Tahunan”. Rekap tersebut disimpan terpisah dan tidak menimpa data bulanan.</p>
          </>}
          <label className="block text-sm font-medium">Catatan sumber data
            <textarea value={notes} disabled={blocked} onChange={event => setNotes(event.target.value)} rows={2}
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2" />
          </label>
        </>}
        <OperationalDefinition key={`${indicator.id}:${year}`} indicatorId={indicator.id} year={year} />
        {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
        {pending && <p role="status" className="text-sm">Menyimpan ke server...</p>}
        <div className="flex justify-end gap-2">
          <button type="button" disabled={pending} onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm">Batal</button>
          <button type="submit" disabled={blocked} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {legacy && convert ? 'Simpan dan konversi' : 'Simpan'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
