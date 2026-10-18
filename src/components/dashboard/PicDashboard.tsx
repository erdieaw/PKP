import React, { useState } from 'react';
import { pkpStore } from '../../services/mockState';
import { 
  Users, 
  CheckCircle2, 
  AlertCircle, 
  Clock, 
  PhoneCall, 
  FileEdit, 
  TrendingUp,
  MessageSquare,
  Cloud,
  RefreshCw
} from 'lucide-react';
import { ScoreBadge } from '../common/ScoreBadge';
import { PolarityBadge } from '../common/PolarityBadge';

interface PicDashboardProps {
  selectedMonth: number;
}

export const PicDashboard: React.FC<PicDashboardProps> = ({ selectedMonth }) => {
  const [selectedPicId, setSelectedPicId] = useState<string>('all');
  const [editingIndicatorId, setEditingIndicatorId] = useState<string | null>(null);
  const [inputVal, setInputVal] = useState<string>('');
  const [notesVal, setNotesVal] = useState<string>('');

  const pics = pkpStore.getPics();
  const indicators = pkpStore.getIndicators();
  const assignments = pkpStore.getAssignments();

  // Filter indicators by PIC
  const filteredIndicators = indicators.filter(ind => {
    if (selectedPicId === 'all') return true;
    return assignments[ind.id] === selectedPicId;
  });

  // Calculate stats for current filter
  const itemsWithRecord = filteredIndicators.map(ind => {
    const rec = pkpStore.getMonthlyRecord(ind.id, selectedMonth);
    const assignedPic = pkpStore.getPicForIndicator(ind.id);
    const annualTarget = pkpStore.getAnnualTargets()[ind.id] || {
      targetSasaran: ind.targetSasaranDefault,
      totalSasaran: ind.totalSasaranDefault
    };
    return {
      indicator: ind,
      record: rec,
      pic: assignedPic,
      annualTarget,
      monthlyTarget: annualTarget.targetSasaran / 12
    };
  });

  const totalAssigned = itemsWithRecord.length;
  const submittedCount = itemsWithRecord.filter(item => item.record.isSubmitted).length;
  const syncedCount = itemsWithRecord.filter(item => item.record.syncStatus === 'SYNCED').length;
  const pendingCount = totalAssigned - submittedCount;
  const avgScore = totalAssigned > 0 
    ? itemsWithRecord.reduce((acc, curr) => acc + curr.record.nilaiKinerja, 0) / totalAssigned
    : 0;

  const greenCount = itemsWithRecord.filter(i => i.record.nilaiKinerja >= 91).length;
  const yellowCount = itemsWithRecord.filter(i => i.record.nilaiKinerja >= 81 && i.record.nilaiKinerja < 91).length;
  const redCount = itemsWithRecord.filter(i => i.record.nilaiKinerja < 81).length;

  const activePic = pics.find(p => p.id === selectedPicId);

  const handleSyncSingle = (indId: string) => {
    pkpStore.syncElementToProvinsi(indId, selectedMonth);
  };

  const handleStartEdit = (indId: string, currentVal: number, currentNotes?: string) => {
    setEditingIndicatorId(indId);
    setInputVal(currentVal.toString());
    setNotesVal(currentNotes || '');
  };

  const handleSaveEdit = (indId: string) => {
    const val = parseFloat(inputVal) || 0;
    pkpStore.updateMonthlyInput(indId, selectedMonth, val, notesVal);
    setEditingIndicatorId(null);
  };

  // WhatsApp Reminder Link Generator
  const generateWaReminder = () => {
    if (!activePic) return '#';
    const text = encodeURIComponent(
      `Halo ${activePic.name}, ini pengingat dari Tim Mutu PKP Puskesmas. Mohon melengkapi data capaian fisik untuk Bulan ke-${selectedMonth} sebelum batas cut-off tanggal 10. Terima kasih.`
    );
    return `https://wa.me/${activePic.phone}?text=${text}`;
  };

  return (
    <div className="space-y-6">
      {/* Header & Filter Controls */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-emerald-600 font-bold text-xs uppercase tracking-wider mb-1">
            <Users className="w-4 h-4" />
            <span>Monitoring Kepatuhan & Realisasi per PIC</span>
          </div>
          <h2 className="text-xl font-bold text-slate-800">
            Dashboard Penanggung Jawab (PIC) — Bulan {selectedMonth}
          </h2>
          <p className="text-xs text-slate-500">
            Pantau beban kerja, progress entri bulanan, dan capaian target untuk setiap staf pengelola program.
          </p>
        </div>

        {/* PIC Dropdown Filter */}
        <div className="flex items-center gap-3">
          <label className="text-xs font-semibold text-slate-600 whitespace-nowrap">
            Pilih PIC:
          </label>
          <select
            value={selectedPicId}
            onChange={(e) => setSelectedPicId(e.target.value)}
            className="text-xs font-bold text-slate-800 bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-emerald-500 cursor-pointer min-w-[220px]"
          >
            <option value="all">Semua Penanggung Jawab ({pics.length} PIC)</option>
            {pics.map(p => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.role})
              </option>
            ))}
          </select>

          {activePic && (
            <a
              href={generateWaReminder()}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 text-xs font-semibold transition-colors shadow-sm"
              title="Kirim pengingat input WhatsApp"
            >
              <PhoneCall className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Ingatkan WA</span>
            </a>
          )}
        </div>
      </div>

      {/* KPI Cards Row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <span className="text-[11px] font-semibold text-slate-500 uppercase">Indikator Diampu</span>
          <div className="text-2xl font-bold font-mono text-slate-800 mt-1">{totalAssigned}</div>
          <span className="text-[11px] text-slate-400">Total Elemen Penilaian</span>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <span className="text-[11px] font-semibold text-slate-500 uppercase">Status Input</span>
          <div className="text-2xl font-bold font-mono text-emerald-600 mt-1">
            {submittedCount} <span className="text-sm font-sans font-normal text-slate-400">/ {totalAssigned}</span>
          </div>
          <span className="text-[11px] text-emerald-600 font-medium">
            {totalAssigned > 0 ? Math.round((submittedCount / totalAssigned) * 100) : 0}% Selesai Input
          </span>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <span className="text-[11px] font-semibold text-slate-500 uppercase">Sinkron Provinsi</span>
          <div className="text-2xl font-bold font-mono text-teal-600 mt-1">
            {syncedCount} <span className="text-sm font-sans font-normal text-slate-400">/ {totalAssigned}</span>
          </div>
          <span className="text-[11px] text-teal-700 font-medium">
            {totalAssigned > 0 ? Math.round((syncedCount / totalAssigned) * 100) : 0}% SIPKP Jatim
          </span>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <span className="text-[11px] font-semibold text-slate-500 uppercase">Rata-rata Skor PIC</span>
          <div className="text-2xl font-bold font-mono text-slate-900 mt-1">
            {avgScore.toFixed(1)}%
          </div>
          <span className={`text-[11px] font-bold ${
            avgScore >= 91 ? 'text-emerald-600' : avgScore >= 81 ? 'text-amber-600' : 'text-rose-600'
          }`}>
            {avgScore >= 91 ? 'Kategori Baik' : avgScore >= 81 ? 'Kategori Cukup' : 'Kategori Kurang'}
          </span>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <span className="text-[11px] font-semibold text-slate-500 uppercase">Distribusi Capaian</span>
          <div className="flex items-center gap-1.5 mt-2">
            <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 text-xs font-mono font-bold" title="Hijau >= 91%">
              {greenCount}H
            </span>
            <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 text-xs font-mono font-bold" title="Kuning 81-90%">
              {yellowCount}K
            </span>
            <span className="px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 text-xs font-mono font-bold" title="Merah < 81%">
              {redCount}M
            </span>
          </div>
          <span className="text-[11px] text-slate-400 mt-1 block">Hijau / Kuning / Merah</span>
        </div>
      </div>

      {/* Main Table: Indicators Assigned to PIC */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
            Daftar Elemen Penilaian ({filteredIndicators.length} Indikator)
          </h3>
          <span className="text-[11px] text-slate-500">
            Klik tombol <strong className="text-emerald-700 font-semibold">Input/Ubah</strong> untuk memperbarui realisasi bulan ini
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-100 text-slate-600 font-semibold border-b border-slate-200">
                <th className="py-2.5 px-3 w-16">Kode</th>
                <th className="py-2.5 px-3 min-w-[200px]">Kegiatan & Indikator Kinerja</th>
                <th className="py-2.5 px-3 w-32">Target & Polaritas</th>
                <th className="py-2.5 px-3 w-28 text-right">Target Sasaran (Bln)</th>
                <th className="py-2.5 px-3 w-32 text-right">Realisasi (Bln Ini)</th>
                <th className="py-2.5 px-3 w-24 text-right">Capaian %</th>
                <th className="py-2.5 px-3 w-28 text-center">Nilai Kinerja</th>
                <th className="py-2.5 px-3 w-32 text-center">Sinkron Provinsi</th>
                <th className="py-2.5 px-3 w-24 text-center">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {itemsWithRecord.map(({ indicator, record, pic, monthlyTarget }) => {
                const isEditing = editingIndicatorId === indicator.id;

                return (
                  <tr key={indicator.id} className="hover:bg-slate-50/80 transition-colors">
                    {/* Official Provincial Code */}
                    <td className="py-2.5 px-3 font-mono font-bold text-slate-700 align-top">
                      <span className="px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200">
                        {indicator.sectionCode}.{indicator.no.replace('.', '')}
                      </span>
                    </td>

                    {/* Indicator Name & Section */}
                    <td className="py-2.5 px-3 align-top">
                      <p className="font-semibold text-slate-800 leading-tight">
                        {indicator.indikator}
                      </p>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        {indicator.kegiatan} • <span className="font-mono text-slate-400">{indicator.section}</span>
                      </p>
                      {record.notes && (
                        <p className="text-[11px] text-amber-700 bg-amber-50 rounded px-2 py-0.5 mt-1 border border-amber-200/60 inline-flex items-center gap-1">
                          <MessageSquare className="w-3 h-3 text-amber-600" />
                          <span>{record.notes}</span>
                        </p>
                      )}
                    </td>

                    {/* Target & Polarity */}
                    <td className="py-2.5 px-3 align-top">
                      <div className="space-y-1">
                        <PolarityBadge 
                          polarity={indicator.polarity} 
                          targetDisplay={indicator.targetDisplay} 
                        />
                        <span className="block text-[10px] text-slate-400">
                          Satuan: {indicator.satuan}
                        </span>
                      </div>
                    </td>

                    {/* Monthly Target Sasaran */}
                    <td className="py-2.5 px-3 text-right font-mono text-slate-600 align-top">
                      {monthlyTarget.toFixed(1)}
                    </td>

                    {/* Realization input */}
                    <td className="py-2.5 px-3 text-right align-top">
                      {isEditing ? (
                        <div className="space-y-1">
                          <input
                            type="number"
                            value={inputVal}
                            onChange={(e) => setInputVal(e.target.value)}
                            className="w-24 text-right px-2 py-1 text-xs border border-emerald-500 rounded font-mono font-bold focus:outline-none focus:ring-1 focus:ring-emerald-500"
                            autoFocus
                          />
                          <input
                            type="text"
                            placeholder="Catatan..."
                            value={notesVal}
                            onChange={(e) => setNotesVal(e.target.value)}
                            className="w-full text-left px-1.5 py-0.5 text-[10px] border border-slate-300 rounded"
                          />
                        </div>
                      ) : (
                        <div className="font-mono font-bold text-slate-900">
                          {record.pencapaianRiil}
                          <span className="text-[10px] text-slate-400 font-sans ml-1">
                            {indicator.satuan}
                          </span>
                        </div>
                      )}
                    </td>

                    {/* Realization % */}
                    <td className="py-2.5 px-3 text-right font-mono text-slate-700 align-top">
                      {record.capaianRiilPct}%
                    </td>

                    {/* Final Score */}
                    <td className="py-2.5 px-3 text-center align-top">
                      <ScoreBadge score={record.nilaiKinerja} size="sm" />
                    </td>

                    {/* Status Sinkronisasi Provinsi */}
                    <td className="py-2.5 px-3 text-center align-top">
                      {record.syncStatus === 'SYNCED' ? (
                        <span 
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-bold"
                          title={`Tersinkron ke server SIPKP Provinsi (${record.syncedAt || 'OK'})`}
                        >
                          <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                          <span>Tersinkron</span>
                        </span>
                      ) : (
                        <button
                          onClick={() => handleSyncSingle(indicator.id)}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-300 text-[10px] font-bold transition-all shadow-2xs"
                          title="Klik untuk sinkronkan elemen ini ke provinsi"
                        >
                          <RefreshCw className="w-3 h-3 text-amber-600" />
                          <span>Belum Sinkron</span>
                        </button>
                      )}
                    </td>

                    {/* Action buttons */}
                    <td className="py-2.5 px-3 text-center align-top">
                      {isEditing ? (
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => handleSaveEdit(indicator.id)}
                            className="px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-[11px] font-bold"
                          >
                            Simpan
                          </button>
                          <button
                            onClick={() => setEditingIndicatorId(null)}
                            className="px-2 py-1 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded text-[11px]"
                          >
                            Batal
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => handleStartEdit(indicator.id, record.pencapaianRiil, record.notes)}
                          className="px-2.5 py-1 bg-slate-100 hover:bg-emerald-50 text-slate-600 hover:text-emerald-700 border border-slate-200 rounded text-[11px] font-semibold transition-colors"
                        >
                          Input/Ubah
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
