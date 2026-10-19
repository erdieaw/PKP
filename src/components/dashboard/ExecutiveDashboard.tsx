import React, { useSyncExternalStore } from 'react';
import { pkpStore } from '../../services/apiStore';
import { 
  Award, 
  AlertTriangle, 
  CheckCircle2, 
  Clock, 
  ArrowRight
} from 'lucide-react';
import { ScoreBadge } from '../common/ScoreBadge';

interface ExecutiveDashboardProps {
  selectedMonth: number;
  onNavigateToDataEntry: (klasterId: number) => void;
  onNavigateToPicDashboard: () => void;
}

export const ExecutiveDashboard: React.FC<ExecutiveDashboardProps> = ({
  selectedMonth,
  onNavigateToDataEntry,
  onNavigateToPicDashboard
}) => {
  useSyncExternalStore(pkpStore.subscribe, pkpStore.getSnapshot, pkpStore.getServerSnapshot);
  const load = pkpStore.getLoadState();
  const indicators = pkpStore.getIndicators();
  let trend: ReturnType<typeof pkpStore.getAnnualTrendData> | undefined;
  try { trend = pkpStore.getAnnualTrendData(); } catch { /* Analytics may not be loaded yet. */ }
  const monthlyScore = trend?.monthlyOverallScores[selectedMonth - 1];
  const totalPKP = typeof monthlyScore === 'number' && Number.isFinite(monthlyScore) ? monthlyScore : null;
  const kategoriPKP = totalPKP === null ? 'Belum dinilai' : (trend?.monthlyCategories[selectedMonth - 1] ?? 'Belum dinilai');
  const scoredItems = indicators.map(ind => {
    const rec = pkpStore.getMonthlyRecord(ind.id, selectedMonth);
    return {
      klasterId: ind.klasterId,
      score: !rec.isMissing && typeof rec.nilaiKinerja === 'number' && Number.isFinite(rec.nilaiKinerja) ? rec.nilaiKinerja : null,
      hasInput: !rec.isMissing && typeof rec.pencapaianRiil === 'number' && Number.isFinite(rec.pencapaianRiil)
    };
  });

  const klasterAverages: Record<number, number | null> = Object.fromEntries([1, 2, 3, 4, 5].map(id => {
    const score = trend?.klasters.find(k => k.klasterId === id)?.monthlyScores[selectedMonth - 1];
    return [id, typeof score === 'number' && Number.isFinite(score) ? score : null];
  }));

  const klasterInfo = [
    { id: 1, name: 'Klaster 1: Manajemen Puskesmas', count: indicators.filter(i => i.klasterId === 1).length, score: klasterAverages[1] },
    { id: 2, name: 'Klaster 2: Pelayanan Kesehatan Ibu dan Anak', count: indicators.filter(i => i.klasterId === 2).length, score: klasterAverages[2] },
    { id: 3, name: 'Klaster 3: Pelayanan Usia Dewasa dan Lansia', count: indicators.filter(i => i.klasterId === 3).length, score: klasterAverages[3] },
    { id: 4, name: 'Klaster 4: Penanggulangan Penyakit Menular & Kesling', count: indicators.filter(i => i.klasterId === 4).length, score: klasterAverages[4] },
    { id: 5, name: 'Klaster 5: Dukungan Pelayanan Lintas Klaster', count: indicators.filter(i => i.klasterId === 5).length, score: klasterAverages[5] },
  ];

  const submittedCount = scoredItems.filter(s => s.hasInput).length;
  const submissionRate = indicators.length ? `${Math.round((submittedCount / indicators.length) * 100)}%` : '-';

  // Distribution
  const greenCount = scoredItems.filter(s => s.score !== null && s.score >= 91).length;
  const yellowCount = scoredItems.filter(s => s.score !== null && s.score >= 81 && s.score < 91).length;
  const redCount = scoredItems.filter(s => s.score !== null && s.score < 81).length;

  if (load.loading || load.error || !trend) return <div className="bg-white p-6 rounded-xl border border-slate-200 text-slate-600" role={load.error ? 'alert' : 'status'}>{load.error?.message ?? (load.loading ? 'Memuat ringkasan kinerja...' : 'Analitik belum tersedia untuk periode ini.')}</div>;

  return (
    <div className="space-y-6">
      {/* Top Banner: Total Performance Score */}
      <div className="bg-gradient-to-br from-obsidian-950 via-obsidian-900 to-emerald-950/90 rounded-3xl p-6 sm:p-7 text-white shadow-xl border border-obsidian-800/80 relative overflow-hidden">
        {/* Subtle Ambient Radial Glow */}
        <div className="absolute top-0 right-1/4 w-80 h-80 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 right-0 w-64 h-64 bg-cyan-500/10 rounded-full blur-2xl pointer-events-none" />

        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/20 border border-emerald-400/30 text-emerald-300 text-xs font-semibold">
              <Award className="w-3.5 h-3.5" />
              <span>SIPKP PULSE • Rekapitulasi Kinerja Akhir Faskes</span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-white">
              Capaian Penilaian Kinerja Puskesmas
            </h2>
            <p className="text-slate-300 text-xs max-w-2xl leading-relaxed">
              Ringkasan bulanan dari analitik server untuk tahun {pkpStore.getCurrentYear()}. Nilai yang belum tersedia ditampilkan sebagai tanda - dan tidak masuk distribusi kinerja.
            </p>
          </div>

          <div className="flex items-center gap-5 sm:gap-6 bg-obsidian-850/90 backdrop-blur-md p-4 sm:p-5 rounded-2xl border border-obsidian-700/80 shadow-inner">
            <div className="text-right">
              <p className="text-[11px] text-slate-400 font-medium">Skor Total PKP</p>
              <div className="text-3xl sm:text-4xl font-black font-mono text-emerald-400">
                {totalPKP === null ? '-' : `${totalPKP.toFixed(1)}%`}
              </div>
              <p className={`text-xs font-bold mt-0.5 ${
                totalPKP === null ? 'text-slate-400' : kategoriPKP === 'Kinerja Baik' ? 'text-emerald-400' : kategoriPKP === 'Kinerja Cukup' ? 'text-amber-400' : 'text-rose-400'
              }`}>
                {kategoriPKP}
              </p>
            </div>
            <div className="h-12 w-px bg-obsidian-700" />
            <div>
              <p className="text-[11px] text-slate-400 font-medium">Progress Input</p>
              <div className="text-2xl sm:text-3xl font-bold font-mono text-white">
                {submissionRate}
              </div>
              <p className="text-[10px] text-slate-400 font-mono">
                {submittedCount}/{indicators.length} Indikator
              </p>
            </div>
            <div className="h-12 w-px bg-obsidian-700 hidden sm:block" />
            <div className="hidden sm:block">
              <p className="text-[11px] text-slate-400 font-medium">Bridge Provinsi</p>
              <div className="text-2xl sm:text-3xl font-bold font-mono text-cyan-300">
                -
              </div>
              <p className="text-[10px] text-slate-400 font-mono">
                Integrasi belum tersedia
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* 3 Metric Cards: Target Status Distribution */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Kinerja Baik (≥ 91%)</span>
            <div className="text-2xl font-bold font-mono text-emerald-600">{greenCount}</div>
            <span className="text-[11px] text-slate-400">Elemen Penilaian Tercapai</span>
          </div>
          <div className="w-12 h-12 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-600">
            <CheckCircle2 className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Kinerja Cukup (81-90%)</span>
            <div className="text-2xl font-bold font-mono text-amber-600">{yellowCount}</div>
            <span className="text-[11px] text-slate-400">Dalam Pengawasan Rutin</span>
          </div>
          <div className="w-12 h-12 rounded-xl bg-amber-50 border border-amber-100 flex items-center justify-center text-amber-600">
            <Clock className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Kinerja Kurang (&lt; 81%)</span>
            <div className="text-2xl font-bold font-mono text-rose-600">{redCount}</div>
            <span className="text-[11px] text-slate-400">Perlu Intervensi / RTL</span>
          </div>
          <div className="w-12 h-12 rounded-xl bg-rose-50 border border-rose-100 flex items-center justify-center text-rose-600">
            <AlertTriangle className="w-6 h-6" />
          </div>
        </div>
      </div>

      {/* 5 Klasters Performance Grid */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-5 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h3 className="font-bold text-slate-800 text-sm">Capaian per Klaster Pelayanan (ILP)</h3>
            <p className="text-xs text-slate-500">Evaluasi bulan {selectedMonth} berbasis instrumen resmi</p>
          </div>
          <button 
            onClick={onNavigateToPicDashboard}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-600 hover:text-emerald-700 bg-emerald-50 hover:bg-emerald-100 px-3 py-1.5 rounded-lg transition-colors"
          >
            <span>Lihat Dasbor PIC</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="divide-y divide-slate-100">
          {klasterInfo.map((k) => (
            <div 
              key={k.id}
              className="p-4 hover:bg-slate-50/70 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-4 cursor-pointer"
              onClick={() => onNavigateToDataEntry(k.id)}
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center font-mono font-bold text-slate-700 text-sm">
                  K{k.id}
                </div>
                <div>
                  <h4 className="text-xs font-bold text-slate-800 hover:text-emerald-600 transition-colors">
                    {k.name}
                  </h4>
                  <span className="text-[11px] text-slate-500 font-mono">
                    {k.count} Elemen Penilaian
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-6">
                {/* Progress bar */}
                <div className="w-36 hidden sm:block">
                  <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                    <div 
                      className={`h-full rounded-full transition-all ${
                        k.score === null ? 'bg-slate-300' : k.score >= 91 ? 'bg-emerald-500' : k.score >= 81 ? 'bg-amber-500' : 'bg-rose-500'
                      }`}
                      style={{ width: k.score === null ? '0%' : `${Math.max(0, Math.min(100, k.score))}%` }}
                    />
                  </div>
                </div>

                <div className="min-w-[120px] text-right">
                  <ScoreBadge score={k.score} size="md" />
                </div>

                <button className="text-slate-400 hover:text-emerald-600 p-1">
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
