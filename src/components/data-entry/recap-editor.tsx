import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { pkpStore } from '../../services/apiStore';
import type { Do2026Profile } from '../../types/do2026';
import type { PeriodRecapItem } from './recap-types';
import { recapMonths } from './recap-types';

interface Props {
  readonly item: PeriodRecapItem;
  readonly profile: Do2026Profile;
  readonly year: number;
  readonly endMonth: number;
  readonly healthCenterId: string;
  readonly canEdit: boolean;
  readonly onSaved: () => void;
}

export function RecapEditor({ item, profile, year, endMonth, healthCenterId, canEdit, onSaved }: Props) {
  const [numerator, setNumerator] = useState(item.numerator?.toString() ?? '');
  const [denominator, setDenominator] = useState(item.denominator?.toString() ?? '');
  const [notes, setNotes] = useState(item.recapNotes ?? '');
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const blocked = !canEdit || pending;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (blocked || !confirmed) return;
    const actualNumerator = Number(numerator);
    const actualDenominator = Number(denominator);
    if (!numerator.trim() || !denominator.trim() || !notes.trim() ||
      !Number.isFinite(actualNumerator) || !Number.isFinite(actualDenominator) || actualNumerator < 0 || actualDenominator < 0) {
      setError('Isi N, D nonnegatif dan catatan sumber. Kosong bukan nol.');
      return;
    }
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setPending(true);
    setError(null);
    try {
      if (pkpStore.getSelectedHealthCenterId() !== healthCenterId || pkpStore.getCurrentYear() !== year) return;
      await pkpStore.savePeriodRecap({
        year, endMonth, indicatorId: item.indicatorId, numerator: actualNumerator,
        denominator: actualDenominator, notes: notes.trim(), confirmed: true, expectedRevision: item.recapRevision,
      });
      if (!request.signal.aborted) onSaved();
    } catch (failure) {
      if (!request.signal.aborted) setError(failure instanceof Error ? failure.message : 'Rekap gagal disimpan. Coba kembali.');
    } finally {
      if (!request.signal.aborted) setPending(false);
    }
  }

  return <details className="border-t border-slate-200 pt-4">
    <summary className="cursor-pointer font-semibold text-emerald-800 focus-visible:outline-emerald-600">Isi atau perbarui rekap terpisah</summary>
    <form onSubmit={save} className="mt-4 space-y-4">
      <p className="text-sm text-slate-600">Simpan angka rekap Januari sampai {recapMonths[endMonth - 1]} {year}. Data bulanan tidak ditimpa. Ini bukan input untuk bulan akhir saja.</p>
      {!canEdit && <p role="status" className="text-sm text-amber-900">Hanya admin atau PIC yang ditugaskan pada Puskesmas sendiri dapat mengisi pada tahun aktif dan periode terbuka.</p>}
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
