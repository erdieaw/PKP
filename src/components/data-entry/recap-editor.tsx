import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { FormEvent } from 'react';
import { pkpStore } from '../../services/apiStore';
import { getMonthlyInputBlockReason, monthPeriodLabel } from '../../services/inputPeriod';
import type { Do2026Profile } from '../../types/do2026';
import { confirmDiscardChanges, useUnsavedChanges } from '../common/useUnsavedChanges';
import type { PeriodRecapItem } from './recap-types';
import { recapMonths } from './recap-types';

export function getRecapInputBlockReason(year: number, endMonth: number, healthCenterId: string, indicatorId?: string, profile?: Do2026Profile): string | null {
  if (!pkpStore.getSessionUser()) return 'Sesi berakhir. Silakan masuk kembali.';
  if (pkpStore.getSelectedHealthCenterId() !== healthCenterId || pkpStore.getCurrentYear() !== year) {
    return 'Lingkup Puskesmas atau tahun berubah. Buka kembali rekap pada periode yang dipilih.';
  }
  for (let month = 1; month <= endMonth; month++) {
    const reason = getMonthlyInputBlockReason(year, month, indicatorId);
    if (reason) return reason;
  }
  if (endMonth !== 12 && (profile?.annualRecapOnly ||
    pkpStore.getIndicators().find(row => row.id === indicatorId)?.do2026?.annualRecapOnly)) {
    return 'Profil ini hanya menerima rekap tahunan Januari sampai Desember yang dikonfirmasi. Rekap parsial tidak dapat diubah. Pilih Desember pada Akhir periode rekap untuk mengisi rekap tahunan.';
  }
  if (pkpStore.isMutating()) return 'Tunggu penyimpanan selesai sebelum mengubah rekap.';
  return null;
}

interface Props {
  readonly item: PeriodRecapItem;
  readonly profile: Do2026Profile;
  readonly year: number;
  readonly endMonth: number;
  readonly healthCenterId: string;
  readonly readOnlyReason: string | null;
  readonly onPendingChange: (pending: boolean) => void;
  readonly onSaved: () => void;
}

export function RecapEditor({ item, profile, year, endMonth, healthCenterId, readOnlyReason, onPendingChange, onSaved }: Props) {
  useSyncExternalStore(pkpStore.subscribe, pkpStore.getSnapshot, pkpStore.getServerSnapshot);
  const [numerator, setNumerator] = useState(item.numerator?.toString() ?? '');
  const [denominator, setDenominator] = useState(item.denominator?.toString() ?? '');
  const [notes, setNotes] = useState(item.recapNotes ?? '');
  const [confirmed, setConfirmed] = useState(false);
  const [baseline, setBaseline] = useState({ numerator, denominator, notes, confirmed });
  const [userId] = useState(() => pkpStore.getSessionUser()?.id);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    onPendingChange(pending);
    return () => onPendingChange(false);
  }, [pending, onPendingChange]);
  const dirty = numerator !== baseline.numerator || denominator !== baseline.denominator || notes !== baseline.notes || confirmed !== baseline.confirmed;
  useUnsavedChanges(dirty || pending, 'recap');
  const blockReason = getRecapInputBlockReason(year, endMonth, healthCenterId, item.indicatorId, profile) ?? readOnlyReason;
  const blocked = Boolean(blockReason) || pending;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || controller.current || pkpStore.isMutating()) return;
    const user = pkpStore.getSessionUser();
    const liveReason = getRecapInputBlockReason(year, endMonth, healthCenterId, item.indicatorId, profile);
    if (!user || user.id !== userId || liveReason || readOnlyReason) {
      setError(liveReason ?? readOnlyReason ?? 'Sesi pengguna berubah. Buka kembali rekap sebelum menyimpan.');
      return;
    }
    if (!confirmed) return;
    const actualNumerator = Number(numerator);
    const actualDenominator = Number(denominator);
    if (!numerator.trim() || !denominator.trim() || !notes.trim() ||
      !Number.isFinite(actualNumerator) || !Number.isFinite(actualDenominator) || actualNumerator < 0 || actualDenominator < 0) {
      setError('Isi N, D nonnegatif dan catatan sumber. Kosong bukan nol.');
      return;
    }
    if ((profile.numeratorInput === 'INTEGER' && !Number.isInteger(actualNumerator)) ||
      (profile.denominatorInput === 'INTEGER' && !Number.isInteger(actualDenominator))) {
      setError('Isi bilangan bulat untuk N dan D berupa hitungan sesuai DO. Jangan membulatkan data sumber secara otomatis.');
      return;
    }
    const request = new AbortController();
    controller.current = request;
    setPending(true);
    setError(null);
    try {
      await pkpStore.savePeriodRecap({
        year, endMonth, indicatorId: item.indicatorId, numerator: actualNumerator,
        denominator: actualDenominator, notes: notes.trim(), confirmed: true, expectedRevision: item.recapRevision,
      });
      if (!request.signal.aborted) {
        setNotes(notes.trim());
        setBaseline({ numerator, denominator, notes: notes.trim(), confirmed });
        onSaved();
      }
    } catch (failure) {
      if (!request.signal.aborted) setError(failure instanceof Error ? failure.message : 'Rekap gagal disimpan. Coba kembali.');
    } finally {
      if (!request.signal.aborted) {
        controller.current = null;
        setPending(false);
      }
    }
  }

  return <details open={open} className="border-t border-slate-200 pt-4">
    <summary onClick={event => {
      event.preventDefault();
      if (open) {
        if (pending || controller.current || pkpStore.isMutating() || !confirmDiscardChanges('recap')) return;
        setNumerator(baseline.numerator);
        setDenominator(baseline.denominator);
        setNotes(baseline.notes);
        setConfirmed(baseline.confirmed);
        setError(null);
      }
      setOpen(!open);
    }} className="cursor-pointer font-semibold text-emerald-800 focus-visible:outline-emerald-600">Isi atau perbarui rekap terpisah</summary>
    <form onSubmit={save} className="mt-4 space-y-4">
      <p className="text-sm text-slate-600">Simpan angka rekap Januari sampai {monthPeriodLabel(year, endMonth)}. Puskesmas: {pkpStore.getSelectedHealthCenter()?.name ?? healthCenterId}. Data bulanan tidak ditimpa. Ini bukan input untuk bulan akhir saja.</p>
      {profile.annualRecapOnly && <p className="text-sm text-slate-600">Hanya rekap tahunan Januari sampai Desember yang dikonfirmasi sesuai DO. Bukan penjumlahan otomatis data bulanan; pengukuran dan ketercapaian tidak berarti skor kinerja tersedia.</p>}
      {profile.annualRecapOnly && profile.assessmentInstruction && <p role="status" className="whitespace-pre-wrap text-sm text-amber-900">{profile.assessmentInstruction}</p>}
      {blockReason && <p role="status" className="text-sm text-amber-900">{blockReason}</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-medium">{profile.numeratorLabel || 'Pembilang aktual (N)'}
          <input type="number" min="0" step={profile.numeratorInput === 'INTEGER' ? '1' : 'any'} required disabled={blocked} value={numerator} onChange={event => setNumerator(event.target.value)}
            className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 focus:ring-2 focus:ring-emerald-500 disabled:bg-slate-100" />
        </label>
        <label className="block text-sm font-medium">{profile.denominatorLabel || 'Penyebut aktual (D)'}
          <input type="number" min="0" step={profile.denominatorInput === 'INTEGER' ? '1' : 'any'} required disabled={blocked} value={denominator} onChange={event => setDenominator(event.target.value)}
            className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 focus:ring-2 focus:ring-emerald-500 disabled:bg-slate-100" />
        </label>
      </div>
      <label className="block text-sm font-medium">Sumber dan cara menyusun rekap (wajib)
        <textarea required maxLength={2000} rows={3} disabled={blocked} value={notes} onChange={event => setNotes(event.target.value)}
          placeholder="Sebutkan register, periode, kesesuaian sampel/metode, dan cara memastikan data tidak dihitung ganda."
          className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 focus:ring-2 focus:ring-emerald-500 disabled:bg-slate-100" />
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" required checked={confirmed} disabled={blocked} onChange={event => setConfirmed(event.target.checked)} className="mt-1 accent-emerald-700" />
        <span>Saya telah merekonsiliasi sumber rekap Januari sampai {recapMonths[endMonth - 1]} {year}, memeriksa kesesuaian sampel/metode dan periode, serta memastikan tidak ada penghitungan ganda sesuai DO. Konfirmasi ini bukan pengesahan Dinkes.</span>
      </label>
      {error && <p role="alert" className="text-sm text-rose-800">{error}</p>}
      <button type="submit" disabled={blocked || !confirmed} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50">
        {pending ? 'Menyimpan rekap...' : 'Simpan rekap terpisah'}
      </button>
    </form>
  </details>;
}
