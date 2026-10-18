import React, { useState } from 'react';
import { pkpStore } from '../../services/mockState';
import { 
  Calendar, 
  Plus, 
  Lock, 
  Unlock, 
  Copy, 
  Check, 
  Clock, 
  X,
  AlertCircle
} from 'lucide-react';

interface YearPeriodModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const YearPeriodModal: React.FC<YearPeriodModalProps> = ({ isOpen, onClose }) => {
  const [newYearInput, setNewYearInput] = useState<string>('2028');
  const [newCutoffInput, setNewCutoffInput] = useState<string>('10');
  const [newDescInput, setNewDescInput] = useState<string>('Tahun Anggaran Baru');
  const [rolloverFrom, setRolloverFrom] = useState<number>(2026);
  const [rolloverTo, setRolloverTo] = useState<number>(2027);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const years = pkpStore.getYears();
  const currentYear = pkpStore.getCurrentYear();

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const handleCreateYear = (e: React.FormEvent) => {
    e.preventDefault();
    const y = parseInt(newYearInput);
    const c = parseInt(newCutoffInput) || 10;
    if (isNaN(y) || y < 2020 || y > 2050) return;

    pkpStore.addYearPeriod(y, c, newDescInput);
    showToast(`Periode tahun ${y} berhasil dibuka!`);
    setNewYearInput((y + 1).toString());
  };

  const handleToggleLock = (y: number) => {
    pkpStore.toggleYearLock(y);
    showToast(`Status penguncian tahun ${y} diperbarui`);
  };

  const handleRollover = () => {
    pkpStore.rolloverTargets(rolloverFrom, rolloverTo);
    showToast(`Seluruh sasaran dari tahun ${rolloverFrom} berhasil disalin ke tahun ${rolloverTo}!`);
  };

  const handleSelectActiveYear = (y: number) => {
    pkpStore.setCurrentYear(y);
    showToast(`Tahun aktif dialihkan ke ${y}`);
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div 
        className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-600 flex items-center justify-center">
              <Calendar className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-slate-800 text-sm">
                Kelola Periode Tahun Anggaran & Batas Cut-Off
              </h3>
              <p className="text-[11px] text-slate-500">
                Atur tahun penilaian PKP, jadwal penguncian bulanan, dan rollover sasaran tahunan.
              </p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6 text-xs">
          {toastMessage && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl font-semibold flex items-center gap-2">
              <Check className="w-4 h-4 text-emerald-600" />
              <span>{toastMessage}</span>
            </div>
          )}

          {/* List of Configured Years */}
          <div>
            <h4 className="font-bold text-slate-700 uppercase tracking-wider text-[11px] mb-3">
              Daftar Periode Tahun Anggaran
            </h4>
            <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
              {years.map((y) => {
                const isActive = y.year === currentYear;
                const isLocked = y.status === 'LOCKED';

                return (
                  <div 
                    key={y.year} 
                    className={`p-3.5 flex items-center justify-between gap-4 transition-colors ${
                      isActive ? 'bg-emerald-50/50' : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex flex-col">
                        <span className="font-mono text-base font-bold text-slate-900 flex items-center gap-2">
                          {y.year}
                          {isActive && (
                            <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-sans font-bold border border-emerald-300">
                              Tahun Aktif
                            </span>
                          )}
                        </span>
                        <span className="text-[11px] text-slate-500 mt-0.5">{y.description}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      {/* Cutoff day badge */}
                      <span className="inline-flex items-center gap-1 text-[11px] text-slate-600 bg-slate-100 px-2 py-1 rounded">
                        <Clock className="w-3 h-3 text-slate-400" />
                        <span>Cut-off tgl {y.cutoffDay}</span>
                      </span>

                      {/* Lock / Unlock Toggle */}
                      <button
                        onClick={() => handleToggleLock(y.year)}
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded border text-xs font-semibold transition-colors ${
                          isLocked 
                            ? 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100'
                            : 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                        }`}
                        title={isLocked ? 'Klik untuk membuka kunci' : 'Klik untuk mengunci tahun'}
                      >
                        {isLocked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                        <span>{isLocked ? 'Terkunci' : 'Terbuka'}</span>
                      </button>

                      {/* Select as active */}
                      {!isActive && (
                        <button
                          onClick={() => handleSelectActiveYear(y.year)}
                          className="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 text-white rounded text-xs font-semibold"
                        >
                          Pilih
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Rollover Target Box (Salin Sasaran 1x Setahun) */}
          <div className="p-4 bg-gradient-to-r from-teal-50 to-emerald-50 rounded-xl border border-teal-200 space-y-3">
            <div className="flex items-center gap-2 text-teal-900 font-bold">
              <Copy className="w-4 h-4 text-teal-600" />
              <span>Rollover Sasaran Tahunan (Salin Sasaran 1x Setahun)</span>
            </div>
            <p className="text-[11px] text-teal-800 leading-relaxed">
              Fitur efisiensi untuk menduplikasi seluruh denominator dan target persentase dari tahun sebelumnya ke tahun baru agar staf tidak perlu menginput ulang dari awal.
            </p>
            <div className="flex items-center gap-3 flex-wrap pt-1">
              <span className="text-slate-600">Salin dari Tahun:</span>
              <select
                value={rolloverFrom}
                onChange={(e) => setRolloverFrom(Number(e.target.value))}
                className="bg-white border border-teal-300 rounded px-2.5 py-1 font-bold text-slate-800"
              >
                {years.map(y => <option key={y.year} value={y.year}>{y.year}</option>)}
              </select>

              <span className="text-slate-600">ke Tahun:</span>
              <select
                value={rolloverTo}
                onChange={(e) => setRolloverTo(Number(e.target.value))}
                className="bg-white border border-teal-300 rounded px-2.5 py-1 font-bold text-slate-800"
              >
                {years.map(y => <option key={y.year} value={y.year}>{y.year}</option>)}
              </select>

              <button
                onClick={handleRollover}
                disabled={rolloverFrom === rolloverTo}
                className="px-3.5 py-1 bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white rounded font-bold shadow-sm"
              >
                Jalankan Rollover
              </button>
            </div>
          </div>

          {/* Form: Buka Tahun Anggaran Baru */}
          <form onSubmit={handleCreateYear} className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
            <div className="flex items-center gap-2 font-bold text-slate-800">
              <Plus className="w-4 h-4 text-emerald-600" />
              <span>Buka Periode Tahun Anggaran Baru</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="text-[11px] font-semibold text-slate-600 block mb-1">Tahun Anggaran:</label>
                <input
                  type="number"
                  value={newYearInput}
                  onChange={(e) => setNewYearInput(e.target.value)}
                  className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 font-mono font-bold"
                  min="2020"
                  max="2050"
                  required
                />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-slate-600 block mb-1">Jadwal Cut-off Bulanan:</label>
                <input
                  type="number"
                  value={newCutoffInput}
                  onChange={(e) => setNewCutoffInput(e.target.value)}
                  className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 font-mono font-bold"
                  min="1"
                  max="31"
                  placeholder="Contoh: 10"
                  required
                />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-slate-600 block mb-1">Keterangan / Label:</label>
                <input
                  type="text"
                  value={newDescInput}
                  onChange={(e) => setNewDescInput(e.target.value)}
                  className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5"
                  placeholder="Contoh: TA 2028 ILP"
                  required
                />
              </div>
            </div>
            <div className="flex justify-end pt-1">
              <button
                type="submit"
                className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold shadow-sm"
              >
                Tambahkan Tahun Baru
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
