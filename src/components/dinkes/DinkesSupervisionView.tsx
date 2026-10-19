import React, { useState, useEffect, useSyncExternalStore } from 'react';
import { pkpStore } from '../../services/apiStore';
import { HealthCenter } from '../../types/pkp';
import { 
  ShieldCheck, 
  Trophy, 
  ArrowUpRight, 
} from 'lucide-react';
import { ScoreBadge } from '../common/ScoreBadge';

interface DinkesSupervisionViewProps {
  onSelectPuskesmas: (pkmName: string) => void;
  selectedMonth: number;
}

type CenterView = Omit<HealthCenter, 'currentScore' | 'kategoriPKP' | 'klasterScores'> & {
  currentScore: number | null;
  kategoriPKP: string | null;
  klasterScores: Record<number, number | null>;
};
const hasScore = (score: number | null | undefined): score is number => typeof score === 'number' && Number.isFinite(score);
const formatScore = (score: number | null | undefined) => hasScore(score) ? `${score.toFixed(1)}%` : '-';

export const DinkesSupervisionView: React.FC<DinkesSupervisionViewProps> = ({
  onSelectPuskesmas,
  selectedMonth
}) => {
  useSyncExternalStore(pkpStore.subscribe, pkpStore.getSnapshot, pkpStore.getServerSnapshot);
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const year = pkpStore.getCurrentYear();
  const quarter = Math.ceil(selectedMonth / 3) as 1 | 2 | 3 | 4;
  const requestKey = `${year}:${selectedMonth}`;
  const [result, setResult] = useState<{ key: string; loading: boolean; error: string | null; centers: CenterView[] }>({ key: '', loading: true, error: null, centers: [] });
  useEffect(() => {
    let active = true;
    setResult({ key: requestKey, loading: true, error: null, centers: [] });
    void pkpStore.fetchSupervision(quarter).then(data => {
      if (!active) return;
      const cached = pkpStore.getPuskesmasList() as unknown as CenterView[];
      // Only comparison rows returned for this request can supply scores.
      const centers = cached.map(center => {
        const summary = (data.comparison as { healthCenterId: string; nilaiKinerjaPuskesmas: number | null; kategoriPKP: string | null; klasterScores: Record<number, number | null> }[]).find(row => row.healthCenterId === center.id);
        return { ...center, currentScore: summary?.nilaiKinerjaPuskesmas ?? null, kategoriPKP: summary?.kategoriPKP ?? null, klasterScores: summary?.klasterScores ?? {} };
      });
      setResult({ key: requestKey, loading: false, error: null, centers });
    }).catch(cause => {
      if (active) setResult({ key: requestKey, loading: false, error: cause instanceof Error ? cause.message : 'Gagal memuat perbandingan Puskesmas.', centers: [] });
    });
    return () => { active = false; };
  }, [year, selectedMonth, quarter, requestKey]);
  const puskesmasList = result.key === requestKey ? result.centers : [];

  // Sort descending by score
  const sorted = [...puskesmasList].sort((a, b) => !hasScore(a.currentScore) ? (hasScore(b.currentScore) ? 1 : a.name.localeCompare(b.name)) : !hasScore(b.currentScore) ? -1 : b.currentScore - a.currentScore);

  const filtered = sorted.filter(p => {
    if (filterCategory === 'all') return true;
    return hasScore(p.currentScore) && p.kategoriPKP === filterCategory;
  });

  const assessed = puskesmasList.filter(p => hasScore(p.currentScore));
  const baikCount = assessed.filter(p => p.kategoriPKP === 'Kinerja Baik').length;
  const cukupCount = assessed.filter(p => p.kategoriPKP === 'Kinerja Cukup').length;
  const kurangCount = assessed.filter(p => p.kategoriPKP === 'Kinerja Kurang').length;
  const districtAvg = assessed.length ? assessed.reduce((acc, p) => acc + p.currentScore!, 0) / assessed.length : null;

  if (result.key !== requestKey || result.loading || result.error) return <div className="p-6 bg-white border border-slate-200 rounded-xl text-slate-600" role={result.error ? 'alert' : 'status'}>{result.key === requestKey && result.error ? result.error : 'Memuat perbandingan kinerja Puskesmas...'}</div>;

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 p-6 rounded-2xl text-white shadow-md border border-indigo-900/40">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-indigo-500/20 border border-indigo-500/30 text-indigo-300 text-xs font-semibold">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Supervisi & Pembinaan Dinas Kesehatan Kabupaten/Kota</span>
            </div>
            <h2 className="text-2xl font-bold tracking-tight">
              Pemeringkatan Kinerja Puskesmas Se-Wilayah (TW {quarter}, {year})
            </h2>
            <p className="text-slate-300 text-xs max-w-2xl leading-relaxed">
              Monitoring capaian kumulatif 5 Klaster ILP, pengelompokan kuadran mutu, dan komparasi hasil penilaian kinerja seluruh Puskesmas binaan dinas kesehatan.
            </p>
          </div>

          <div className="bg-indigo-900/50 p-4 rounded-xl border border-indigo-700/60 text-right">
            <span className="text-xs text-indigo-200">Rerata Nilai Kabupaten/Kota</span>
            <div className="text-3xl font-extrabold font-mono text-indigo-300 mt-0.5">
              {formatScore(districtAvg)}
            </div>
            <span className="text-[11px] text-indigo-200 font-semibold">
              {assessed.length} Dinilai / {puskesmasList.length} Puskesmas Terdaftar
            </span>
          </div>
        </div>
      </div>

      {/* 3 Metric Cards: Category Breakdown */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div 
          onClick={() => setFilterCategory(filterCategory === 'Kinerja Baik' ? 'all' : 'Kinerja Baik')}
          className={`p-5 rounded-xl border cursor-pointer transition-all ${
            filterCategory === 'Kinerja Baik' ? 'ring-2 ring-emerald-500 bg-emerald-50/50 border-emerald-300' : 'bg-white border-slate-200 shadow-sm hover:border-emerald-200'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-emerald-800 uppercase">Kelompok I: Kinerja Baik</span>
            <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-xs font-bold font-mono">≥ 91%</span>
          </div>
          <div className="text-2xl font-bold font-mono text-emerald-700 mt-2">{baikCount} Puskesmas</div>
          <span className="text-[11px] text-slate-500">Memenuhi standar mutu paripurna</span>
        </div>

        <div 
          onClick={() => setFilterCategory(filterCategory === 'Kinerja Cukup' ? 'all' : 'Kinerja Cukup')}
          className={`p-5 rounded-xl border cursor-pointer transition-all ${
            filterCategory === 'Kinerja Cukup' ? 'ring-2 ring-amber-500 bg-amber-50/50 border-amber-300' : 'bg-white border-slate-200 shadow-sm hover:border-amber-200'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-amber-800 uppercase">Kelompok II: Kinerja Cukup</span>
            <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-xs font-bold font-mono">81 - 90%</span>
          </div>
          <div className="text-2xl font-bold font-mono text-amber-700 mt-2">{cukupCount} Puskesmas</div>
          <span className="text-[11px] text-slate-500">Perlu akselerasi indikator tertinggal</span>
        </div>

        <div 
          onClick={() => setFilterCategory(filterCategory === 'Kinerja Kurang' ? 'all' : 'Kinerja Kurang')}
          className={`p-5 rounded-xl border cursor-pointer transition-all ${
            filterCategory === 'Kinerja Kurang' ? 'ring-2 ring-rose-500 bg-rose-50/50 border-rose-300' : 'bg-white border-slate-200 shadow-sm hover:border-rose-200'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-rose-800 uppercase">Kelompok III: Kinerja Kurang</span>
            <span className="px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 text-xs font-bold font-mono">&lt; 81%</span>
          </div>
          <div className="text-2xl font-bold font-mono text-rose-700 mt-2">{kurangCount} Puskesmas</div>
          <span className="text-[11px] text-slate-500">Wajib pendampingan intensif Dinkes</span>
        </div>
      </div>

      {/* Main Ranking Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2 font-bold text-slate-800">
            <Trophy className="w-4 h-4 text-amber-500" />
            <span>Papan Peringkat Kinerja Puskesmas Se-Kabupaten/Kota ({filtered.length} Faskes)</span>
          </div>
          <span className="text-slate-400">Klik Puskesmas untuk menginspeksi rincian internal</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200">
              <tr>
                <th className="py-2.5 px-3 w-16 text-center">Peringkat</th>
                <th className="py-2.5 px-3 min-w-[200px]">Puskesmas & Kepala Faskes</th>
                <th className="py-2.5 px-3 w-28 text-center">Klaster 1 (Mgt)</th>
                <th className="py-2.5 px-3 w-28 text-center">Klaster 2 (KIA)</th>
                <th className="py-2.5 px-3 w-28 text-center">Klaster 3 (Dewasa)</th>
                <th className="py-2.5 px-3 w-28 text-center">Klaster 4 (P2M)</th>
                <th className="py-2.5 px-3 w-28 text-center">Klaster 5 (Lintas)</th>
                <th className="py-2.5 px-3 w-32 text-center">Nilai Total PKP</th>
                <th className="py-2.5 px-3 w-32 text-center">Sinkron Provinsi</th>
                <th className="py-2.5 px-3 w-24 text-center">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {!filtered.length && <tr><td colSpan={10} className="p-6 text-center text-slate-500">{puskesmasList.length ? 'Tidak ada Puskesmas dalam kategori ini. Klik kategori aktif untuk menampilkan semua.' : 'Belum ada Puskesmas untuk dibandingkan pada periode ini.'}</td></tr>}
              {filtered.map(pkm => {
                const rank = hasScore(pkm.currentScore) ? sorted.findIndex(center => center.id === pkm.id) + 1 : null;

                return (
                  <tr 
                    key={pkm.id}
                    className="hover:bg-indigo-50/40 transition-colors cursor-pointer group"
                    onClick={() => onSelectPuskesmas(pkm.name)}
                  >
                    {/* Rank number with badge */}
                    <td className="py-3 px-3 text-center font-mono font-bold">
                      <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs ${
                        rank === 1 ? 'bg-amber-100 text-amber-800 border border-amber-300 font-bold' :
                        rank === 2 ? 'bg-slate-200 text-slate-800 font-bold' :
                        rank === 3 ? 'bg-amber-50 text-amber-700 font-bold' :
                        'text-slate-500'
                      }`}>
                        {rank ?? '-'}
                      </span>
                    </td>

                    {/* Puskesmas & Head Info */}
                    <td className="py-3 px-3">
                      <div className="font-bold text-slate-900 group-hover:text-indigo-600 transition-colors">
                        {pkm.name}
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        {pkm.headName} • <span className="font-mono text-slate-400">{pkm.code}</span>
                      </div>
                    </td>

                    {/* Klaster 1 to 5 scores */}
                    <td className="py-3 px-3 text-center font-mono text-slate-700">
                      {formatScore(pkm.klasterScores?.[1])}
                    </td>
                    <td className="py-3 px-3 text-center font-mono text-slate-700">
                      {formatScore(pkm.klasterScores?.[2])}
                    </td>
                    <td className="py-3 px-3 text-center font-mono text-slate-700">
                      {formatScore(pkm.klasterScores?.[3])}
                    </td>
                    <td className="py-3 px-3 text-center font-mono text-slate-700">
                      {formatScore(pkm.klasterScores?.[4])}
                    </td>
                    <td className="py-3 px-3 text-center font-mono text-slate-700">
                      {formatScore(pkm.klasterScores?.[5])}
                    </td>

                    {/* Total Score */}
                    <td className="py-3 px-3 text-center">
                      <ScoreBadge score={pkm.currentScore} size="md" />
                    </td>

                    {/* Status Sinkronisasi Provinsi */}
                    <td className="py-3 px-3 text-center">
                      <span className="text-[10px] text-slate-500">Integrasi belum tersedia</span>
                    </td>

                    {/* Action */}
                    <td className="py-3 px-3 text-center">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectPuskesmas(pkm.name);
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded text-[11px] font-semibold border border-indigo-200 transition-colors"
                      >
                        <span>Inspeksi</span>
                        <ArrowUpRight className="w-3 h-3" />
                      </button>
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
