import React, { useState } from 'react';
import { pkpStore } from '../../services/mockState';
import { 
  UserCheck, 
  Search, 
  Layers, 
  Check, 
  ShieldAlert, 
  Sparkles,
  Phone
} from 'lucide-react';

export const PicAssignmentView: React.FC = () => {
  const [search, setSearch] = useState('');
  const [selectedKlaster, setSelectedKlaster] = useState<number>(0);
  const [bulkSection, setBulkSection] = useState<string>('1.1');
  const [bulkPicId, setBulkPicId] = useState<string>('pic-1');
  const [notification, setNotification] = useState<string | null>(null);

  const indicators = pkpStore.getIndicators();
  const pics = pkpStore.getPics();
  const assignments = pkpStore.getAssignments();

  // Filter indicators
  const filtered = indicators.filter((ind) => {
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

  const handleAssignSingle = (indicatorId: string, picId: string) => {
    pkpStore.assignPic(indicatorId, picId);
    showNotification('PIC berhasil diperbarui untuk indikator terkait');
  };

  const handleBulkAssign = () => {
    pkpStore.bulkAssignPic(bulkSection, bulkPicId);
    const pic = pics.find(p => p.id === bulkPicId);
    showNotification(`Seluruh indikator sub-klaster ${bulkSection} berhasil ditugaskan ke ${pic?.name}`);
  };

  const showNotification = (msg: string) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 3000);
  };

  // Distinct sub-sections for bulk assignment
  const subSections = Array.from(new Set(indicators.map(i => i.sectionCode))).sort();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-emerald-600 font-bold text-xs uppercase tracking-wider mb-1">
            <UserCheck className="w-4 h-4" />
            <span>Manajemen Penugasan Elemen Penilaian</span>
          </div>
          <h2 className="text-xl font-bold text-slate-800">
            Setting / Assignment PIC (Person In Charge)
          </h2>
          <p className="text-xs text-slate-500">
            Tentukan staf Puskesmas yang bertanggung jawab menginput realisasi bulanan untuk masing-masing elemen penilaian.
          </p>
        </div>

        {notification && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-semibold animate-fade-in">
            <Check className="w-4 h-4" />
            <span>{notification}</span>
          </div>
        )}
      </div>

      {/* Bulk Assignment Quick Bar (Notion / Retool style) */}
      <div className="bg-gradient-to-r from-emerald-50 to-teal-50 p-4 rounded-xl border border-emerald-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-emerald-600 text-white flex items-center justify-center">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <h4 className="text-xs font-bold text-emerald-950">Fitur Penugasan Cepat (Bulk Assign per Sub-klaster)</h4>
            <p className="text-[11px] text-emerald-700">Tugaskan sekaligus seluruh indikator dalam satu sub-kelompok program</p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-slate-600 font-medium">Sub-klaster:</span>
          <select
            value={bulkSection}
            onChange={(e) => setBulkSection(e.target.value)}
            className="text-xs font-semibold bg-white border border-emerald-300 rounded-lg px-2.5 py-1.5 focus:ring-2 focus:ring-emerald-500"
          >
            {subSections.map(sec => (
              <option key={sec} value={sec}>Kode {sec}</option>
            ))}
          </select>

          <span className="text-xs text-slate-600 font-medium">ke PIC:</span>
          <select
            value={bulkPicId}
            onChange={(e) => setBulkPicId(e.target.value)}
            className="text-xs font-semibold bg-white border border-emerald-300 rounded-lg px-2.5 py-1.5 focus:ring-2 focus:ring-emerald-500"
          >
            {pics.map(p => (
              <option key={p.id} value={p.id}>{p.name} ({p.role})</option>
            ))}
          </select>

          <button
            onClick={handleBulkAssign}
            className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-colors shadow-sm"
          >
            Terapkan Sekaligus
          </button>
        </div>
      </div>

      {/* Search & Filter */}
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
            placeholder="Cari indikator untuk di-assign..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>
      </div>

      {/* Table: Setting PIC per Indikator */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-3 bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-700">
          Daftar Penugasan ({filtered.length} Elemen Penilaian)
        </div>

        <div className="overflow-x-auto max-h-[60vh] overflow-y-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead className="bg-slate-100 sticky top-0 z-10 text-slate-700 font-bold border-b border-slate-200">
              <tr>
                <th className="py-2.5 px-3 w-20">Kode</th>
                <th className="py-2.5 px-3 min-w-[280px]">Indikator Kinerja & Kegiatan</th>
                <th className="py-2.5 px-3 w-40">Sub-klaster</th>
                <th className="py-2.5 px-3 w-72">Penanggung Jawab (PIC yang Ditunjuk)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((ind) => {
                const currentPicId = assignments[ind.id] || 'pic-1';
                const officialCode = `${ind.sectionCode}.${ind.no.replace('.', '')}`;

                return (
                  <tr key={ind.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-2.5 px-3 font-mono font-bold text-slate-700 align-top">
                      <span className="px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200">
                        {officialCode}
                      </span>
                    </td>

                    <td className="py-2.5 px-3 align-top">
                      <p className="font-semibold text-slate-800 leading-tight">
                        {ind.indikator}
                      </p>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        {ind.kegiatan}
                      </p>
                    </td>

                    <td className="py-2.5 px-3 text-slate-500 font-mono text-[11px] align-top">
                      {ind.section}
                    </td>

                    {/* PIC Dropdown */}
                    <td className="py-2 px-3 align-top">
                      <select
                        value={currentPicId}
                        onChange={(e) => handleAssignSingle(ind.id, e.target.value)}
                        className="w-full text-xs font-semibold bg-slate-50 hover:bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 focus:ring-2 focus:ring-emerald-500 cursor-pointer"
                      >
                        {pics.map(p => (
                          <option key={p.id} value={p.id}>
                            {p.name} — {p.role}
                          </option>
                        ))}
                      </select>
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
