import React, { useState, useSyncExternalStore } from 'react';
import { pkpStore } from '../../services/apiStore';
import { Target, Search, Lock, Unlock, Check, AlertCircle } from 'lucide-react';
import { PolarityBadge } from '../common/PolarityBadge';

export const TargetSettingView: React.FC = () => {
  const [selectedKlaster, setSelectedKlaster] = useState<number>(0);
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [targetPctInput, setTargetPctInput] = useState<string>('100');
  const [totalSasaranInput, setTotalSasaranInput] = useState<string>('0');
  const [notification, setNotification] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useSyncExternalStore(pkpStore.subscribe, pkpStore.getSnapshot, pkpStore.getServerSnapshot);
  const year = pkpStore.getCurrentYear();
  const canEdit = (id: string) => !pkpStore.getLoadState().loading && pkpStore.getCurrentUser().role === 'ADMIN_PUSKESMAS' &&
    !pkpStore.getAnnualTargets()[id]?.isLocked && !pkpStore.isPeriodLocked(year, 4, true);

  const indicators = pkpStore.getIndicators();
  const annualTargets = pkpStore.getAnnualTargets();

  const isArtifactRow = (ind: typeof indicators[0]) => {
    return ind.no === 'No' || ind.no === '(1)' || ind.no === '(2)' || ind.no === '(3)' || ind.no === 'Kegiatan';
  };

  const filtered = indicators.filter((ind) => {
    if (isArtifactRow(ind)) return false;
    if (selectedKlaster !== 0 && ind.klasterId !== selectedKlaster) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      const code = `${ind.sectionCode}.${ind.no}`.toLowerCase();
      return (
        code.includes(q) ||
        ind.indikator.toLowerCase().includes(q) ||
        ind.kegiatan.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const handleStartEdit = (indId: string, currentPct: number | null | undefined, currentTot: number | null | undefined) => {
    if (pending || !canEdit(indId)) return;
    setEditingId(indId);
    setTargetPctInput(currentPct?.toString() ?? '');
    setTotalSasaranInput(currentTot?.toString() ?? '');
  };

  const handleSave = async (indId: string) => {
    if (pending || !canEdit(indId)) return;
    const pct = Number(targetPctInput);
    const tot = Number(totalSasaranInput);
    if (!targetPctInput.trim() || !totalSasaranInput.trim() || !Number.isFinite(pct) || !Number.isFinite(tot) || pct < 0 || tot < 0) {
      setError('Target dan total sasaran harus berupa angka valid nonnegatif.'); return;
    }
    setPending(true); setError(null); setNotification(null);
    try {
      await pkpStore.updateAnnualTarget(indId, pct, tot);
      setEditingId(null); setNotification('Target tahunan berhasil disimpan!');
    } catch (e) { setError(e instanceof Error ? e.message : 'Penyimpanan gagal.'); }
    finally { setPending(false); }
  };

  return (
    <div className="space-y-6">
      {error && <p role="alert" className="p-3 bg-rose-50 text-rose-800 rounded-xl">{error}</p>}
      {pending && <p role="status">Menyimpan target...</p>}
      {/* Header */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-emerald-600 font-bold text-xs uppercase tracking-wider mb-1">
            <Target className="w-4 h-4" />
            <span>Siklus Perencanaan Awal Tahun (1x Setahun)</span>
          </div>
          <h2 className="text-xl font-bold text-slate-800">
            Penetapan Target Sasaran Tahunan {year}
          </h2>
          <p className="text-xs text-slate-500">
            Tentukan denominator (total sasaran riil wilayah) dan persentase target tahunan untuk {indicators.length} indikator. Target fisik dihitung oleh server.
          </p>
        </div>

        {notification && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-semibold">
            <Check className="w-4 h-4" />
            <span>{notification}</span>
          </div>
        )}
      </div>

      {/* Filter & Search */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0">
          {[
            { id: 0, label: 'Semua Klaster' },
            { id: 1, label: 'K1: Manajemen' },
            { id: 2, label: 'K2: KIA' },
            { id: 3, label: 'K3: Dewasa/Lansia' },
            { id: 4, label: 'K4: P2M/Kesling' },
            { id: 5, label: 'K5: Lintas Klaster' },
          ].map((k) => (
            <button
              key={k.id}
              onClick={() => setSelectedKlaster(k.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
                selectedKlaster === k.id
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {k.label}
            </button>
          ))}
        </div>

        <div className="relative min-w-[280px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Cari indikator..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto max-h-[65vh] overflow-y-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead className="bg-slate-100 sticky top-0 z-10 text-slate-700 font-bold border-b border-slate-200">
              <tr>
                <th className="py-2.5 px-3 w-20">Kode</th>
                <th className="py-2.5 px-3 min-w-[260px]">Indikator Kinerja</th>
                <th className="py-2.5 px-3 w-24">Satuan</th>
                <th className="py-2.5 px-3 w-32 text-right">Target %</th>
                <th className="py-2.5 px-3 w-36 text-right">Total Sasaran (Denominator)</th>
                <th className="py-2.5 px-3 w-36 text-right">Target Sasaran Fisik</th>
                <th className="py-2.5 px-3 w-28 text-center">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((ind) => {
                const target = annualTargets[ind.id];
                const isEditing = editingId === ind.id && canEdit(ind.id);
                const officialCode = `${ind.sectionCode}.${ind.no.replace('.', '')}`;

                return (
                  <tr key={ind.id} className="hover:bg-slate-50 transition-colors">
                    <td className="py-2.5 px-3 font-mono font-bold text-slate-700 align-top">
                      <span className="px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200">
                        {officialCode}
                      </span>
                    </td>

                    <td className="py-2.5 px-3 align-top">
                      <p className="font-semibold text-slate-800 leading-tight">
                        {ind.indikator}
                      </p>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        {ind.kegiatan}
                      </p>
                    </td>

                    <td className="py-2.5 px-3 text-slate-500 align-top">
                      {ind.satuan}
                    </td>

                    {/* Target % */}
                    <td className="py-2.5 px-3 text-right align-top">
                      {isEditing ? (
                        <input
                          aria-label={`Target persen ${officialCode}`}
                          disabled={pending}
                          type="number"
                          value={targetPctInput}
                          onChange={(e) => setTargetPctInput(e.target.value)}
                          className="w-20 text-right px-2 py-1 text-xs border border-emerald-500 rounded font-mono font-bold"
                        />
                      ) : (
                        <span className="font-mono font-bold text-slate-800">
                          {target?.targetPct == null ? '-' : `${target.targetPct}%`}
                        </span>
                      )}
                    </td>

                    {/* Total Sasaran */}
                    <td className="py-2.5 px-3 text-right align-top">
                      {isEditing ? (
                        <input
                          aria-label={`Total sasaran ${officialCode}`}
                          disabled={pending}
                          type="number"
                          value={totalSasaranInput}
                          onChange={(e) => setTotalSasaranInput(e.target.value)}
                          className="w-28 text-right px-2 py-1 text-xs border border-emerald-500 rounded font-mono font-bold"
                        />
                      ) : (
                        <span className="font-mono text-slate-700">
                          {target?.totalSasaran ?? '-'}
                        </span>
                      )}
                    </td>

                    {/* Target Sasaran Fisik */}
                    <td className="py-2.5 px-3 text-right font-mono font-bold text-emerald-700 align-top">
                      {target?.targetSasaran?.toFixed(1) ?? '-'}
                    </td>

                    {/* Action */}
                    <td className="py-2.5 px-3 text-center align-top">
                      {isEditing ? (
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => handleSave(ind.id)}
                            disabled={pending}
                            className="px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-[11px] font-bold"
                          >
                            Simpan
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            disabled={pending}
                            className="px-2 py-1 bg-slate-200 text-slate-700 rounded text-[11px]"
                          >
                            Batal
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => handleStartEdit(ind.id, target?.targetPct, target?.totalSasaran)}
                          disabled={pending || !canEdit(ind.id)}
                          className="px-2.5 py-1 bg-slate-100 hover:bg-emerald-50 text-slate-600 hover:text-emerald-700 border border-slate-200 rounded text-[11px] font-semibold"
                        >
                          Ubah Sasaran
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
