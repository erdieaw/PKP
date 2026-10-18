import React, { useState, useEffect, useMemo } from 'react';
import { pkpStore } from '../../services/mockState';
import { AnnualTrendData, AnnualIndicatorTrend, OfficialIndicator } from '../../types/pkp';
import { 
  CalendarRange, 
  TrendingUp, 
  TrendingDown,
  Award, 
  Filter, 
  Search, 
  Download, 
  Printer, 
  ChevronRight, 
  ChevronDown,
  Layers,
  Sparkles,
  BarChart3,
  Calendar,
  CheckCircle2,
  AlertTriangle,
  ArrowUpRight,
  ArrowDownRight,
  FileSpreadsheet
} from 'lucide-react';

interface AnnualTrendDashboardProps {
  onNavigateToMonth?: (month: number) => void;
  onOpenDrawer?: (indicator: OfficialIndicator) => void;
}

export const AnnualTrendDashboard: React.FC<AnnualTrendDashboardProps> = ({
  onNavigateToMonth,
  onOpenDrawer
}) => {
  const currentYear = pkpStore.getCurrentYear();
  const [selectedKlaster, setSelectedKlaster] = useState<number>(0); // 0 = Semua
  const [viewMode, setViewMode] = useState<'KLASTER' | 'INDICATOR'>('KLASTER');
  const [metricType, setMetricType] = useState<'SCORE' | 'PERCENT' | 'NUMERATOR'>('SCORE');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [expandedKlasters, setExpandedKlasters] = useState<Record<number, boolean>>({
    1: true,
    2: true,
    3: true,
    4: true,
    5: true
  });

  const [trendData, setTrendData] = useState<AnnualTrendData>(() => 
    pkpStore.getAnnualTrendData(currentYear)
  );

  const [indicatorsTrend, setIndicatorsTrend] = useState<AnnualIndicatorTrend[]>(() =>
    pkpStore.getAnnualIndicatorsTrend(selectedKlaster, currentYear)
  );

  // Subscribe to changes
  useEffect(() => {
    const refresh = () => {
      setTrendData(pkpStore.getAnnualTrendData(currentYear));
      setIndicatorsTrend(pkpStore.getAnnualIndicatorsTrend(selectedKlaster, currentYear));
    };
    const unsub = pkpStore.subscribe(refresh);
    return () => unsub();
  }, [currentYear, selectedKlaster]);

  const monthShorts = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const monthFullNames = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
  ];

  // Helper for color badge
  const getCellBadgeClass = (score: number) => {
    if (score === 0) return 'bg-slate-100 text-slate-400 border-slate-200';
    if (score >= 91) return 'bg-emerald-50 text-emerald-700 border-emerald-200 font-bold';
    if (score >= 81) return 'bg-amber-50 text-amber-700 border-amber-200 font-bold';
    return 'bg-rose-50 text-rose-700 border-rose-200 font-bold';
  };

  // Filtered indicators in detailed mode
  const filteredIndicators = useMemo(() => {
    let list = indicatorsTrend;
    if (selectedKlaster > 0) {
      list = list.filter(i => i.indicator.klasterId === selectedKlaster);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(i => 
        i.indicator.no.toLowerCase().includes(q) ||
        i.indicator.indikator.toLowerCase().includes(q) ||
        i.indicator.kegiatan.toLowerCase().includes(q) ||
        i.indicator.sectionCode.toLowerCase().includes(q)
      );
    }
    return list;
  }, [indicatorsTrend, selectedKlaster, searchQuery]);

  // Export CSV
  const handleExportCSV = () => {
    let csv = '';
    if (viewMode === 'KLASTER') {
      csv = 'No / Kode,Nama Klaster / Sub-klaster,Jan,Feb,Mar (TW1),Apr,Mei,Jun (TW2),Jul,Agu,Sep (TW3),Okt,Nov,Des (TW4),Rerata Tahunan,Kategori\n';
      trendData.klasters.forEach(k => {
        csv += `"${k.klasterId}.0","${k.name}",${k.monthlyScores.join(',')},"${k.annualAverage}","${k.category}"\n`;
        trendData.subKlasters.filter(s => s.klasterId === k.klasterId).forEach(s => {
          csv += `"${s.code}","${s.name}",${s.monthlyScores.join(',')},"${s.annualAverage}","${s.category}"\n`;
        });
      });
    } else {
      csv = 'Kode,Indikator Kinerja,Satuan,Target Sasaran,Jan,Feb,Mar (TW1),Apr,Mei,Jun (TW2),Jul,Agu,Sep (TW3),Okt,Nov,Des (TW4),Rerata Nilai,Kategori\n';
      filteredIndicators.forEach(item => {
        const scores = metricType === 'SCORE' 
          ? item.monthlyScores 
          : metricType === 'PERCENT' 
          ? item.monthlyPct 
          : item.monthlyValues;
        csv += `"${item.indicator.no}","${item.indicator.indikator.replace(/"/g, '""')}","${item.indicator.satuan}","${item.indicator.targetSasaranDefault}",${scores.join(',')},"${item.annualAverageScore}","${item.category}"\n`;
      });
    }

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `SIPKP_Matriks_Tahunan_12Bulan_${currentYear}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const toggleKlaster = (id: number) => {
    setExpandedKlasters(prev => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div className="space-y-6">
      {/* ===================== HERO HEADER BANNER ===================== */}
      <div className="bg-gradient-to-br from-obsidian-950 via-obsidian-900 to-emerald-950/90 rounded-3xl p-6 sm:p-7 text-white shadow-xl border border-obsidian-800/80 relative overflow-hidden">
        {/* Glow circles */}
        <div className="absolute top-0 right-1/4 w-80 h-80 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 right-0 w-64 h-64 bg-cyan-500/10 rounded-full blur-2xl pointer-events-none" />

        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/20 border border-emerald-400/30 text-emerald-300 text-xs font-semibold">
              <CalendarRange className="w-3.5 h-3.5" />
              <span>SIPKP PULSE • Rekapitulasi Tahunan (12 Kolom Bulanan)</span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-white">
              Dashboard Kinerja Tahunan (12 Bulan)
            </h2>
            <p className="text-slate-300 text-xs max-w-2xl leading-relaxed">
              Pemantauan komparasi longitudinal performa mutu fasilitas kesehatan dari Januari hingga Desember (Tahun Anggaran {currentYear}). Menampilkan agregasi 5 Klaster, 29 Sub-klaster, dan 272 Indikator Baku secara terintegrasi.
            </p>
          </div>

          <div className="flex items-center gap-4 sm:gap-6 bg-obsidian-850/90 backdrop-blur-md p-4 sm:p-5 rounded-2xl border border-obsidian-700/80 shadow-inner shrink-0">
            <div className="text-right">
              <p className="text-[11px] text-slate-400 font-medium">Rerata Tahunan (YTD)</p>
              <div className="text-3xl sm:text-4xl font-black font-mono text-emerald-400">
                {trendData.annualAveragePKP}%
              </div>
              <p className={`text-xs font-bold mt-0.5 ${
                trendData.annualCategoryPKP === 'Kinerja Baik' ? 'text-emerald-400' : 
                trendData.annualCategoryPKP === 'Kinerja Cukup' ? 'text-amber-400' : 'text-rose-400'
              }`}>
                {trendData.annualCategoryPKP}
              </p>
            </div>
            <div className="h-12 w-px bg-obsidian-700" />
            <div>
              <p className="text-[11px] text-slate-400 font-medium">Status Periode</p>
              <div className="text-xl sm:text-2xl font-bold font-mono text-white">
                12 Bulan
              </div>
              <p className="text-[10px] text-emerald-300 font-mono">
                TA {currentYear} Aktif
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ===================== KPI METRIC CARDS ===================== */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Puncak Performa */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-2xs hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Bulan Tertinggi</span>
            <div className="w-8 h-8 rounded-xl bg-emerald-100 flex items-center justify-center text-emerald-600">
              <ArrowUpRight className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2">
            <span className="text-2xl font-black text-slate-900 font-mono">
              {trendData.highestMonth.score}%
            </span>
            <span className="ml-2 text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
              {trendData.highestMonth.name}
            </span>
          </div>
          <p className="mt-2 text-xs text-slate-500">Capaian kinerja puncak se-kabupaten</p>
        </div>

        {/* Card 2: Titik Terendah */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-2xs hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Bulan Terendah</span>
            <div className="w-8 h-8 rounded-xl bg-rose-100 flex items-center justify-center text-rose-600">
              <ArrowDownRight className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2">
            <span className="text-2xl font-black text-slate-900 font-mono">
              {trendData.lowestMonth.score}%
            </span>
            <span className="ml-2 text-xs font-bold text-rose-600 bg-rose-50 px-2 py-0.5 rounded-md border border-rose-200">
              {trendData.lowestMonth.name}
            </span>
          </div>
          <p className="mt-2 text-xs text-slate-500">Bulan baseline awal sebelum akselerasi</p>
        </div>

        {/* Card 3: Milestone Triwulan I */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-2xs hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Milestone TW I (Mar)</span>
            <div className="w-8 h-8 rounded-xl bg-teal-100 flex items-center justify-center text-teal-600">
              <Award className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2">
            <span className="text-2xl font-black text-slate-900 font-mono">
              {trendData.monthlyOverallScores[2] || 0}%
            </span>
            <span className="ml-2 text-xs font-bold text-teal-700 bg-teal-50 px-2 py-0.5 rounded-md border border-teal-200">
              Terkunci Dinkes
            </span>
          </div>
          <p className="mt-2 text-xs text-slate-500">Tersinkron 100% ke server Provinsi</p>
        </div>

        {/* Card 4: Kepatuhan Entri 12 Bulan */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-2xs hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Progres Siklus Tahunan</span>
            <div className="w-8 h-8 rounded-xl bg-indigo-100 flex items-center justify-center text-indigo-600">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-black text-slate-900 font-mono">
              3 / 12
            </span>
            <span className="text-xs text-slate-500 font-medium">Bulan Berjalan</span>
          </div>
          {/* 12-dot timeline */}
          <div className="mt-3 flex items-center gap-1">
            {monthShorts.map((m, idx) => (
              <div 
                key={m}
                className={`h-2 flex-1 rounded-sm ${
                  idx < 3 ? 'bg-emerald-500' : 'bg-slate-200'
                }`}
                title={`Bulan ${idx+1} (${m}): ${idx < 3 ? 'Data Terisi' : 'Belum Dimulai'}`}
              />
            ))}
          </div>
        </div>
      </div>

      {/* ===================== 12-MONTH TRAJECTORY CHART ===================== */}
      <div className="bg-white rounded-3xl p-6 border border-slate-200/80 shadow-2xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-100 gap-3">
          <div>
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-emerald-600" />
              <span>Kurva Tren Skor PKP Bulanan (Januari – Desember {currentYear})</span>
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Target Standar Mutu: <strong className="text-emerald-700">Baik ≥ 91%</strong> • <strong className="text-amber-600">Cukup 81–90%</strong> • <strong className="text-rose-600">Kurang &lt; 81%</strong>
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-200 font-medium">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              Skor Total PKP
            </span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-50 text-slate-600 border border-slate-200 font-medium">
              <span className="w-2 h-0.5 bg-amber-400" />
              Garis Ambang Cukup (81%)
            </span>
          </div>
        </div>

        {/* Visual Monthly Bars Chart */}
        <div className="mt-6 pt-4 pb-2">
          <div className="grid grid-cols-12 gap-2 sm:gap-3 items-end h-44 border-b border-slate-200 px-2 relative">
            {/* Horizontal Guide Lines */}
            <div className="absolute inset-x-0 bottom-[81%] border-b border-dashed border-amber-300 pointer-events-none z-0" />
            <div className="absolute inset-x-0 bottom-[91%] border-b border-dashed border-emerald-300 pointer-events-none z-0" />

            {trendData.monthlyOverallScores.map((score, idx) => {
              const isQuarter = idx === 2 || idx === 5 || idx === 8 || idx === 11;
              const hasData = score > 0;
              const heightPct = Math.max(8, Math.min(100, score));

              return (
                <div key={idx} className="flex flex-col items-center h-full justify-end group relative z-10">
                  {/* Tooltip on hover */}
                  <div className="absolute -top-12 opacity-0 group-hover:opacity-100 transition-opacity bg-slate-900 text-white text-[11px] rounded-lg px-2.5 py-1 pointer-events-none shadow-xl whitespace-nowrap z-30 font-medium">
                    <p className="font-bold">{monthFullNames[idx]}: {score.toFixed(1)}%</p>
                    <p className="text-[10px] text-slate-300">{isQuarter ? `Evaluasi Resmi TW ${Math.floor(idx/3)+1}` : 'Capaian Reguler'}</p>
                  </div>

                  {/* Top value */}
                  <span className={`text-[10px] sm:text-xs font-mono font-bold mb-1 transition-transform group-hover:-translate-y-1 ${
                    hasData ? 'text-slate-800' : 'text-slate-400'
                  }`}>
                    {score > 0 ? `${score.toFixed(0)}%` : '-'}
                  </span>

                  {/* Bar */}
                  <div 
                    style={{ height: `${heightPct}%` }}
                    className={`w-full max-w-[42px] rounded-t-xl transition-all duration-300 group-hover:brightness-110 cursor-pointer shadow-xs ${
                      !hasData
                        ? 'bg-slate-200 border border-slate-300 border-dashed'
                        : isQuarter
                        ? 'bg-gradient-to-t from-emerald-600 via-teal-500 to-cyan-400 border border-emerald-400/40'
                        : score >= 91
                        ? 'bg-gradient-to-t from-emerald-600 to-emerald-400'
                        : score >= 81
                        ? 'bg-gradient-to-t from-amber-600 to-amber-400'
                        : 'bg-gradient-to-t from-rose-600 to-rose-400'
                    }`}
                    onClick={() => onNavigateToMonth && onNavigateToMonth(idx + 1)}
                  />
                </div>
              );
            })}
          </div>

          {/* Month labels bottom axis */}
          <div className="grid grid-cols-12 gap-2 sm:gap-3 px-2 mt-2 text-center">
            {monthShorts.map((m, idx) => {
              const isQuarter = idx === 2 || idx === 5 || idx === 8 || idx === 11;
              const quarterNum = Math.floor(idx / 3) + 1;
              return (
                <div key={m} className="text-center">
                  <p className={`text-[11px] font-bold ${isQuarter ? 'text-emerald-700 font-black' : 'text-slate-600'}`}>
                    {m}
                  </p>
                  {isQuarter && (
                    <span className="inline-block mt-0.5 text-[9px] px-1 py-0.2 rounded font-black bg-emerald-100 text-emerald-800">
                      TW {quarterNum}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ===================== CONTROLS & FILTER TOOLBAR ===================== */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-2xs space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          {/* View Mode Switcher */}
          <div className="flex items-center gap-1.5 p-1 bg-slate-100 rounded-xl border border-slate-200 text-xs">
            <button
              onClick={() => setViewMode('KLASTER')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-bold transition-all ${
                viewMode === 'KLASTER'
                  ? 'bg-white text-emerald-800 shadow-xs border border-slate-200'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Rekap Klaster & Sub-klaster</span>
            </button>

            <button
              onClick={() => setViewMode('INDICATOR')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-bold transition-all ${
                viewMode === 'INDICATOR'
                  ? 'bg-white text-emerald-800 shadow-xs border border-slate-200'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <BarChart3 className="w-3.5 h-3.5" />
              <span>Matriks Rinci 272 Indikator</span>
            </button>
          </div>

          {/* Metric Selector (Only active in detailed mode) */}
          {viewMode === 'INDICATOR' && (
            <div className="flex items-center gap-1.5 p-1 bg-slate-100 rounded-xl border border-slate-200 text-xs">
              <span className="text-[11px] font-semibold text-slate-500 pl-2">Tampilkan:</span>
              <button
                onClick={() => setMetricType('SCORE')}
                className={`px-2.5 py-1 rounded-lg font-bold transition-all ${
                  metricType === 'SCORE' ? 'bg-emerald-600 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Nilai Kinerja (0–100)
              </button>
              <button
                onClick={() => setMetricType('PERCENT')}
                className={`px-2.5 py-1 rounded-lg font-bold transition-all ${
                  metricType === 'PERCENT' ? 'bg-emerald-600 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Capaian Riil %
              </button>
              <button
                onClick={() => setMetricType('NUMERATOR')}
                className={`px-2.5 py-1 rounded-lg font-bold transition-all ${
                  metricType === 'NUMERATOR' ? 'bg-emerald-600 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Numerator Riil
              </button>
            </div>
          )}

          {/* Action Buttons: Export & Print */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleExportCSV}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-700 text-xs font-bold transition-colors shadow-2xs"
              title="Unduh Matriks 12 Bulan dalam format spreadsheet CSV"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
              <span>Ekspor CSV</span>
            </button>

            <button
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-700 text-xs font-bold transition-colors shadow-2xs"
              title="Cetak Matriks Tahunan"
            >
              <Printer className="w-3.5 h-3.5 text-slate-600" />
              <span className="hidden sm:inline">Cetak</span>
            </button>
          </div>
        </div>

        {/* Filter Klaster Pills & Search */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-2 border-t border-slate-100">
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-thin text-xs">
            <span className="text-slate-400 text-[11px] font-semibold flex items-center gap-1 mr-1 shrink-0">
              <Filter className="w-3 h-3" /> Filter:
            </span>
            {[
              { id: 0, label: 'Semua Klaster' },
              { id: 1, label: 'K1: Manajemen' },
              { id: 2, label: 'K2: KIA' },
              { id: 3, label: 'K3: Dewasa & Lansia' },
              { id: 4, label: 'K4: P2M & Kesling' },
              { id: 5, label: 'K5: Lintas Klaster' }
            ].map(k => (
              <button
                key={k.id}
                onClick={() => setSelectedKlaster(k.id)}
                className={`px-3 py-1 rounded-xl font-bold whitespace-nowrap transition-all ${
                  selectedKlaster === k.id
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {k.label}
              </button>
            ))}
          </div>

          {/* Quick Search */}
          <div className="relative min-w-[220px]">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Cari kode atau kegiatan..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full text-xs pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
        </div>
      </div>

      {/* ===================== THE 12-MONTH MATRIX GRID TABLE ===================== */}
      <div className="bg-white rounded-3xl border border-slate-200/80 shadow-2xs overflow-hidden">
        {/* Table Title Banner */}
        <div className="p-4 sm:p-5 bg-gradient-to-r from-slate-50 to-white border-b border-slate-200/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
              <Calendar className="w-4 h-4 text-emerald-600" />
              <span>
                {viewMode === 'KLASTER'
                  ? 'Matriks Komparasi 5 Klaster & 29 Sub-klaster (Bulan 1 s/d 12)'
                  : `Matriks Evaluasi Rinci 272 Indikator (${filteredIndicators.length} Elemen)`}
              </span>
            </h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Nilai per kolom mewakili akumulasi capaian bulanan. Kolom Maret, Juni, September, dan Desember merefleksikan evaluasi resmi Triwulan.
            </p>
          </div>

          <span className="text-[11px] font-mono font-bold px-2.5 py-1 bg-emerald-50 text-emerald-800 rounded-lg border border-emerald-200 shrink-0 self-start sm:self-auto">
            12 Kolom Evaluasi Bulanan
          </span>
        </div>

        {/* The Grid Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-100 border-b-2 border-slate-300 text-slate-800 uppercase font-black tracking-wider text-[10px]">
                <th className="py-2.5 px-3 w-16 text-center border-r border-slate-200 sticky left-0 bg-slate-100 z-10 shadow-r">
                  Kode
                </th>
                <th className="py-2.5 px-3 min-w-[240px] border-r border-slate-200 sticky left-16 bg-slate-100 z-10 shadow-r">
                  Uraian Klaster / Indikator
                </th>
                {viewMode === 'INDICATOR' && (
                  <>
                    <th className="py-2.5 px-2 w-16 text-center border-r border-slate-200">Satuan</th>
                    <th className="py-2.5 px-2 w-16 text-right border-r border-slate-200">Tgt/Bln</th>
                  </>
                )}
                {/* 12 Month Columns */}
                {monthShorts.map((m, idx) => {
                  const isQuarter = idx === 2 || idx === 5 || idx === 8 || idx === 11;
                  const quarterNum = Math.floor(idx / 3) + 1;
                  return (
                    <th 
                      key={m}
                      onClick={() => onNavigateToMonth && onNavigateToMonth(idx + 1)}
                      className={`py-2 px-1.5 w-16 text-center border-r border-slate-200 cursor-pointer transition-colors ${
                        isQuarter 
                          ? 'bg-emerald-100/70 text-emerald-950 font-black hover:bg-emerald-200/80' 
                          : 'hover:bg-slate-200/70'
                      }`}
                      title={`Klik untuk membuka modul Bulan ${idx + 1} (${monthFullNames[idx]})`}
                    >
                      <div className="leading-tight">
                        <span>B{String(idx + 1).padStart(2, '0')}</span>
                        <span className="block text-[9px] font-normal text-slate-500">{m}</span>
                        {isQuarter && (
                          <span className="block text-[8px] font-black text-emerald-800">TW{quarterNum}</span>
                        )}
                      </div>
                    </th>
                  );
                })}
                <th className="py-2.5 px-3 w-24 text-right border-r border-slate-200 bg-slate-50">Rerata</th>
                <th className="py-2.5 px-3 w-28 text-center border-r border-slate-200">Kategori</th>
                <th className="py-2.5 px-3 w-24 text-center">Tren</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {/* ===================== VIEW MODE 1: KLASTER & SUBKLASTER ===================== */}
              {viewMode === 'KLASTER' && (
                <>
                  {trendData.klasters
                    .filter(k => selectedKlaster === 0 || k.klasterId === selectedKlaster)
                    .map(k => {
                      const isExpanded = expandedKlasters[k.klasterId];
                      const subItems = trendData.subKlasters.filter(s => s.klasterId === k.klasterId);

                      return (
                        <React.Fragment key={`klaster-${k.klasterId}`}>
                          {/* Klaster Header Row */}
                          <tr className="bg-slate-50/90 font-black text-slate-900 border-t-2 border-slate-300">
                            <td className="py-2.5 px-3 text-center border-r border-slate-200 font-mono sticky left-0 bg-slate-50 z-10 shadow-r">
                              <button
                                onClick={() => toggleKlaster(k.klasterId)}
                                className="inline-flex items-center gap-1 text-slate-600 hover:text-slate-900 font-black"
                              >
                                {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                                <span>{k.klasterId}.0</span>
                              </button>
                            </td>
                            <td className="py-2.5 px-3 border-r border-slate-200 sticky left-16 bg-slate-50 z-10 shadow-r">
                              <span className="text-slate-900 font-black">{k.name}</span>
                              <span className="ml-2 text-[10px] font-normal text-slate-500">
                                ({subItems.length} Sub-klaster)
                              </span>
                            </td>

                            {/* 12 Months Scores */}
                            {k.monthlyScores.map((score, idx) => {
                              const isQuarter = idx === 2 || idx === 5 || idx === 8 || idx === 11;
                              return (
                                <td 
                                  key={idx} 
                                  className={`py-2 px-1 text-center font-mono text-xs border-r border-slate-200 ${
                                    isQuarter ? 'bg-emerald-50/50' : ''
                                  }`}
                                >
                                  <span className={`inline-block px-1.5 py-0.5 rounded text-[11px] border ${getCellBadgeClass(score)}`}>
                                    {score > 0 ? score.toFixed(1) : '-'}
                                  </span>
                                </td>
                              );
                            })}

                            {/* Annual Average */}
                            <td className="py-2.5 px-3 text-right font-mono font-black text-slate-900 border-r border-slate-200 bg-slate-50">
                              {k.annualAverage}%
                            </td>

                            {/* Category */}
                            <td className="py-2.5 px-3 text-center border-r border-slate-200">
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-black border ${
                                k.category === 'Kinerja Baik' ? 'bg-emerald-50 text-emerald-800 border-emerald-300' :
                                k.category === 'Kinerja Cukup' ? 'bg-amber-50 text-amber-800 border-amber-300' :
                                'bg-rose-50 text-rose-800 border-rose-300'
                              }`}>
                                {k.category.replace('Kinerja ', '')}
                              </span>
                            </td>

                            {/* Sparkline Visual Bar */}
                            <td className="py-2 px-3 text-center">
                              <div className="flex items-end gap-0.5 h-5 w-16 mx-auto">
                                {k.monthlyScores.map((sc, scIdx) => (
                                  <div
                                    key={scIdx}
                                    style={{ height: `${Math.max(15, Math.min(100, sc))}%` }}
                                    className={`flex-1 rounded-xs ${
                                      sc >= 91 ? 'bg-emerald-500' : sc >= 81 ? 'bg-amber-400' : sc > 0 ? 'bg-rose-400' : 'bg-slate-200'
                                    }`}
                                  />
                                ))}
                              </div>
                            </td>
                          </tr>

                          {/* Sub-klaster Rows (Collapsible) */}
                          {isExpanded && subItems.map(sub => (
                            <tr key={`sub-${sub.code}`} className="hover:bg-slate-50/60 transition-colors">
                              <td className="py-2 px-3 text-center font-mono text-[11px] text-slate-500 border-r border-slate-200 sticky left-0 bg-white z-10 shadow-r">
                                {sub.code}
                              </td>
                              <td className="py-2 px-3 border-r border-slate-200 text-slate-700 sticky left-16 bg-white z-10 shadow-r">
                                <span className="font-medium text-xs">{sub.name}</span>
                              </td>

                              {/* 12 Months Scores */}
                              {sub.monthlyScores.map((score, idx) => {
                                const isQuarter = idx === 2 || idx === 5 || idx === 8 || idx === 11;
                                return (
                                  <td 
                                    key={idx} 
                                    className={`py-1.5 px-1 text-center font-mono text-[11px] border-r border-slate-200 ${
                                      isQuarter ? 'bg-emerald-50/30' : ''
                                    }`}
                                  >
                                    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] border ${getCellBadgeClass(score)}`}>
                                      {score > 0 ? score.toFixed(1) : '-'}
                                    </span>
                                  </td>
                                );
                              })}

                              {/* Annual Average */}
                              <td className="py-2 px-3 text-right font-mono font-bold text-slate-800 border-r border-slate-200 bg-slate-50/50">
                                {sub.annualAverage}%
                              </td>

                              {/* Category */}
                              <td className="py-2 px-3 text-center border-r border-slate-200">
                                <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold border ${
                                  sub.category === 'Kinerja Baik' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' :
                                  sub.category === 'Kinerja Cukup' ? 'bg-amber-50 text-amber-800 border-amber-200' :
                                  'bg-rose-50 text-rose-800 border-rose-200'
                                }`}>
                                  {sub.category.replace('Kinerja ', '')}
                                </span>
                              </td>

                              {/* Sparkline Visual Bar */}
                              <td className="py-2 px-3 text-center">
                                <div className="flex items-end gap-0.5 h-4 w-16 mx-auto">
                                  {sub.monthlyScores.map((sc, scIdx) => (
                                    <div
                                      key={scIdx}
                                      style={{ height: `${Math.max(15, Math.min(100, sc))}%` }}
                                      className={`flex-1 rounded-xs ${
                                        sc >= 91 ? 'bg-emerald-500' : sc >= 81 ? 'bg-amber-400' : sc > 0 ? 'bg-rose-400' : 'bg-slate-200'
                                      }`}
                                    />
                                  ))}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </React.Fragment>
                      );
                    })}
                </>
              )}

              {/* ===================== VIEW MODE 2: DETAILED 272 INDICATORS ===================== */}
              {viewMode === 'INDICATOR' && (
                <>
                  {filteredIndicators.map(item => {
                    const values = metricType === 'SCORE' 
                      ? item.monthlyScores 
                      : metricType === 'PERCENT' 
                      ? item.monthlyPct 
                      : item.monthlyValues;

                    const isHead = item.indicator.isHead;

                    return (
                      <tr 
                        key={item.indicator.id} 
                        className={`hover:bg-slate-50 transition-colors ${
                          isHead ? 'bg-purple-50/40 font-bold' : ''
                        }`}
                      >
                        <td className="py-2 px-3 text-center font-mono text-[11px] font-bold text-slate-700 border-r border-slate-200 sticky left-0 bg-white z-10 shadow-r">
                          {item.indicator.no}
                        </td>
                        <td 
                          className="py-2 px-3 border-r border-slate-200 sticky left-16 bg-white z-10 shadow-r cursor-pointer hover:text-emerald-700"
                          onClick={() => onOpenDrawer && onOpenDrawer(item.indicator)}
                        >
                          <p className="font-semibold text-xs text-slate-800 truncate max-w-[280px]" title={item.indicator.indikator}>
                            {item.indicator.indikator}
                          </p>
                          <p className="text-[10px] text-slate-400 truncate max-w-[280px]">
                            {item.indicator.kegiatan}
                          </p>
                        </td>
                        <td className="py-2 px-2 text-center text-[10px] text-slate-500 border-r border-slate-200">
                          {item.indicator.satuan}
                        </td>
                        <td className="py-2 px-2 text-right font-mono text-[11px] text-slate-600 border-r border-slate-200">
                          {item.indicator.targetSasaranDefault > 0 ? (item.indicator.targetSasaranDefault / 12).toFixed(1) : '-'}
                        </td>

                        {/* 12 Months Cells */}
                        {values.map((val, idx) => {
                          const isQuarter = idx === 2 || idx === 5 || idx === 8 || idx === 11;
                          const scoreVal = item.monthlyScores[idx];

                          return (
                            <td 
                              key={idx}
                              className={`py-1.5 px-1 text-center font-mono text-[11px] border-r border-slate-200 ${
                                isQuarter ? 'bg-emerald-50/30' : ''
                              }`}
                            >
                              <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] border ${
                                metricType === 'SCORE'
                                  ? getCellBadgeClass(val)
                                  : val > 0 ? 'bg-slate-100 text-slate-800 border-slate-300 font-bold' : 'bg-slate-50 text-slate-400 border-slate-200'
                              }`}>
                                {val > 0 
                                  ? (metricType === 'NUMERATOR' ? val : `${val.toFixed(1)}${metricType === 'PERCENT' ? '%' : ''}`) 
                                  : '-'}
                              </span>
                            </td>
                          );
                        })}

                        {/* Annual Average */}
                        <td className="py-2 px-3 text-right font-mono font-bold text-slate-900 border-r border-slate-200 bg-slate-50/60">
                          {metricType === 'PERCENT' ? `${item.annualAveragePct}%` : item.annualAverageScore}
                        </td>

                        {/* Category */}
                        <td className="py-2 px-3 text-center border-r border-slate-200">
                          <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold border ${
                            item.category === 'Kinerja Baik' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' :
                            item.category === 'Kinerja Cukup' ? 'bg-amber-50 text-amber-800 border-amber-200' :
                            'bg-rose-50 text-rose-800 border-rose-200'
                          }`}>
                            {item.category.replace('Kinerja ', '')}
                          </span>
                        </td>

                        {/* Sparkline Visual Bar */}
                        <td className="py-2 px-3 text-center">
                          <div className="flex items-end gap-0.5 h-4 w-16 mx-auto">
                            {item.monthlyScores.map((sc, scIdx) => (
                              <div
                                key={scIdx}
                                style={{ height: `${Math.max(15, Math.min(100, sc))}%` }}
                                className={`flex-1 rounded-xs ${
                                  sc >= 91 ? 'bg-emerald-500' : sc >= 81 ? 'bg-amber-400' : sc > 0 ? 'bg-rose-400' : 'bg-slate-200'
                                }`}
                              />
                            ))}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
