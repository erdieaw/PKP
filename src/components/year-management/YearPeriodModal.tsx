import React, { useState, useSyncExternalStore } from 'react';
import { pkpStore } from '../../services/apiStore';
import { Calendar, Plus, Lock, Unlock, Check, Clock, X } from 'lucide-react';

interface YearPeriodModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const YearPeriodModal: React.FC<YearPeriodModalProps> = ({ isOpen, onClose }) => {
  useSyncExternalStore(pkpStore.subscribe, pkpStore.getSnapshot, pkpStore.getServerSnapshot);
  const [newYear, setNewYear] = useState(String(new Date().getFullYear() + 1));
  const [cutoff, setCutoff] = useState('10');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [editingYear, setEditingYear] = useState<number | null>(null);
  const [editCutoff, setEditCutoff] = useState('10');
  if (!isOpen) return null;
  const isDinkes = pkpStore.getCurrentUser().role === 'DINKES_ADMIN';
  const canManage = pkpStore.getCurrentUser().role !== 'PIC';
  const disabled = pending || pkpStore.isMutating() || pkpStore.getLoadState().loading;
  const run = async (action: () => Promise<unknown>, success: string) => {
    if (!canManage || disabled) return;
    setPending(true); setError(null); setMessage(null);
    try { await action(); setMessage(success); }
    catch (error) { setError(error instanceof Error ? error.message : 'Operasi gagal. Silakan coba lagi.'); }
    finally { setPending(false); }
  };
  const create = (event: React.FormEvent) => {
    event.preventDefault();
    const year = Number(newYear), day = Number(cutoff);
    if (!Number.isInteger(year) || year < 1 || year > 9999 || !Number.isInteger(day) || day < 1 || day > 31) {
      setError('Isi tahun 1-9999 dan tanggal cut-off 1-31.'); return;
    }
    if (pkpStore.getYears().some(y => y.year === year)) { setError('Tahun sudah terdaftar. Pilih tahun yang belum tersedia.'); return; }
    void run(async () => { await pkpStore.addYearPeriod(year, day); setNewYear(String(year + 1)); }, `Periode tahun ${year} berhasil dibuka.`);
  };
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div role="dialog" aria-modal="true" aria-label="Periode tahun anggaran" className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-white rounded-2xl shadow-2xl border border-slate-200 animate-scale-in">
        <div className="p-5 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5"><Calendar className="w-5 h-5 text-emerald-600" /><div>
            <h3 className="font-bold text-slate-800 text-sm">Periode Tahun Anggaran & Batas Cut-Off</h3>
            <p className="text-[11px] text-slate-500">{canManage ? 'Admin dan Dinkes mengelola tahun/cut-off. Penguncian dan penghapusan hanya oleh Dinkes.' : 'Informasi periode pelaporan, hanya baca untuk PIC.'}</p>
          </div></div>
          <button disabled={pending} onClick={onClose} aria-label="Tutup" className="p-1.5 text-slate-400 hover:bg-slate-200 rounded-lg"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-6 space-y-6 text-xs">
          {error && <p role="alert" className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl">{error}</p>}
          {message && <p role="status" className="p-3 bg-emerald-50 text-emerald-800 rounded-xl flex items-center gap-2"><Check className="w-4 h-4" />{message}</p>}
          <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
            {pkpStore.getYears().map(y => <div key={y.year} className={`p-3.5 flex flex-wrap items-center justify-between gap-3 ${y.isCurrent ? 'bg-emerald-50/50' : ''}`}>
              <div><span className="font-mono text-base font-bold text-slate-900">{y.year}</span>{y.isCurrent && <span className="ml-2 text-emerald-700 font-semibold">Tahun Aktif</span>}</div>
              <div className="flex flex-wrap items-center gap-3">
                <span className="inline-flex items-center gap-1 text-slate-600 bg-slate-100 px-2 py-1 rounded"><Clock className="w-3 h-3" />Cut-off tgl {y.cutoffDay}</span>
                {canManage && <button disabled={disabled} className="px-2 py-1 border rounded" onClick={() => { setEditingYear(y.year); setEditCutoff(String(y.cutoffDay)); }}>Ubah Cut-off {y.year}</button>}
                {isDinkes && <button disabled={disabled} className="px-2 py-1 border rounded text-rose-700" onClick={() => { if (window.confirm(`Hapus tahun ${y.year}? Server akan menolak jika masih ada referensi data.`)) void run(() => pkpStore.deleteYearPeriod(y.year), `Tahun ${y.year} dihapus.`); }}>Hapus Tahun {y.year}</button>}
                {isDinkes ? <button disabled={disabled} onClick={() => {
                  const action = y.status === 'LOCKED' ? 'Membuka kunci' : 'Mengunci';
                  if (window.confirm(`${action} tahun ${y.year}? Perubahan ini memengaruhi pelaporan seluruh Puskesmas.`)) void run(() => pkpStore.toggleYearLock(y.year), `Status penguncian tahun ${y.year} diperbarui.`);
                }} className="inline-flex items-center gap-1 px-2.5 py-1 rounded border text-xs font-semibold disabled:opacity-50">
                  {y.status === 'LOCKED' ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}{y.status === 'LOCKED' ? 'Terkunci' : 'Terbuka'}
                </button> : <span>{y.status === 'LOCKED' ? 'Terkunci' : 'Terbuka'}</span>}
                {canManage && !y.isCurrent && <button disabled={disabled} onClick={() => void run(() => pkpStore.setCurrentYear(y.year), `Tahun aktif dialihkan ke ${y.year}.`)} className="px-2.5 py-1 bg-slate-900 text-white rounded disabled:opacity-50">Pilih</button>}
              </div>
            </div>)}
          </div>
          {canManage && editingYear !== null && <form onSubmit={event => { event.preventDefault(); const day = Number(editCutoff); if (!Number.isInteger(day) || day < 1 || day > 31) { setError('Tanggal cut-off harus 1-31.'); return; } if (window.confirm(`Ubah cut-off tahun ${editingYear}? Berlaku untuk seluruh Puskesmas.`)) void run(async () => { await pkpStore.updateYearCutoff(editingYear, day); setEditingYear(null); }, 'Cut-off diperbarui.'); }} className="p-4 border rounded-xl space-y-3"><label>Tanggal Cut-off {editingYear}<input disabled={disabled} required type="number" min={1} max={31} value={editCutoff} onChange={e => setEditCutoff(e.target.value)} className="block border rounded p-2" /></label><button disabled={disabled} type="submit" className="px-3 py-2 border rounded">Simpan Cut-off</button><button disabled={disabled} type="button" onClick={() => setEditingYear(null)} className="px-3 py-2">Batal</button></form>}
          <p className="p-4 bg-teal-50 text-teal-900 rounded-xl border border-teal-200">Rollover sasaran belum didukung backend. Tidak ada data sasaran yang disalin otomatis.</p>
          {canManage && <form onSubmit={create} className="p-4 bg-slate-50 rounded-xl border border-slate-200">
            <fieldset disabled={disabled} className="space-y-3">
              <h4 className="font-bold text-slate-800 flex items-center gap-2"><Plus className="w-4 h-4 text-emerald-600" />Buka Periode Tahun Anggaran Baru</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="font-semibold text-slate-600">Tahun Anggaran<input type="number" required min={1} max={9999} value={newYear} onChange={e => setNewYear(e.target.value)} className="mt-1 w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5" /></label>
                <label className="font-semibold text-slate-600">Tanggal Cut-off<input type="number" required min={1} max={31} value={cutoff} onChange={e => setCutoff(e.target.value)} className="mt-1 w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5" /></label>
              </div>
              <div className="flex justify-end"><button type="submit" className="px-4 py-1.5 bg-emerald-600 text-white rounded-lg font-bold disabled:opacity-50">{pending ? 'Menyimpan...' : 'Tambahkan Tahun Baru'}</button></div>
            </fieldset>
          </form>}
        </div>
      </div>
    </div>
  );
};
