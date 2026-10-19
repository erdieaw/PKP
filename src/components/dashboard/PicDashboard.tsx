import React, { useState, useSyncExternalStore, useEffect } from 'react';
import { pkpStore } from '../../services/apiStore';
import { 
  Users, 
  CheckCircle2, 
  PhoneCall, 
  MessageSquare,
} from 'lucide-react';
import { ScoreBadge } from '../common/ScoreBadge';
import { PolarityBadge } from '../common/PolarityBadge';
import { OfficialIndicator } from '../../types/pkp';

interface PicDashboardProps {
  selectedMonth: number;
  onOpenDrawer: (indicator: OfficialIndicator) => void;
}

export const PicDashboard: React.FC<PicDashboardProps> = ({ selectedMonth, onOpenDrawer }) => {
  useSyncExternalStore(pkpStore.subscribe, pkpStore.getSnapshot, pkpStore.getServerSnapshot);
  const currentUser = pkpStore.getCurrentUser();
  const currentYear = pkpStore.getCurrentYear();
  const load = pkpStore.getLoadState();
  const [selectedPicId, setSelectedPicId] = useState<string>('all');
  const [editingIndicatorId, setEditingIndicatorId] = useState<string | null>(null);
  const [inputVal, setInputVal] = useState<string>('');
  const [notesVal, setNotesVal] = useState<string>('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inputFilter, setInputFilter] = useState<'all' | 'missing' | 'filled'>('all');

  const pics = pkpStore.getPics();
  const indicators = pkpStore.getIndicators();
  const assignments = pkpStore.getAssignments();
  const picId = currentUser.role === 'PIC' ? currentUser.id : pics.some(p => p.id === selectedPicId) ? selectedPicId : 'all';
  const canEdit = (id: string) => currentUser.role === 'PIC' && assignments[id] === currentUser.id && !pkpStore.isPeriodLocked(currentYear, selectedMonth) && !load.loading && !load.error;
  useEffect(() => { setEditingIndicatorId(null); setError(null); }, [selectedMonth, currentYear, picId]);

  // Filter indicators by PIC
  const filteredIndicators = indicators.filter(ind => {
    if (picId === 'all') return true;
    return assignments[ind.id] === picId;
  });

  // Calculate stats for current filter
  const itemsWithRecord = filteredIndicators.map(ind => {
    const rec = pkpStore.getMonthlyRecord(ind.id, selectedMonth);
    const assignedPic = pkpStore.getPicForIndicator(ind.id);
    const annualTarget = pkpStore.getAnnualTargets()[ind.id];
    return {
      indicator: ind,
      record: rec,
      pic: assignedPic,
      annualTarget,
      monthlyTarget: typeof annualTarget?.targetSasaran === 'number' && Number.isFinite(annualTarget.targetSasaran) ? annualTarget.targetSasaran / 12 : null
    };
  });

  const totalAssigned = itemsWithRecord.length;
  const submittedCount = itemsWithRecord.filter(({ record }) => !record.isMissing && typeof record.pencapaianRiil === 'number' && Number.isFinite(record.pencapaianRiil)).length;
  const scores = itemsWithRecord.flatMap(({ record }) => !record.isMissing && typeof record.nilaiKinerja === 'number' && Number.isFinite(record.nilaiKinerja) ? [record.nilaiKinerja] : []);
  const avgScore = scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : null;

  const greenCount = scores.filter(score => score >= 91).length;
  const yellowCount = scores.filter(score => score >= 81 && score < 91).length;
  const redCount = scores.filter(score => score < 81).length;

  const activePic = pics.find(p => p.id === picId);

  const handleStartEdit = (indId: string, currentVal: number | null | undefined, currentNotes?: string) => {
    if (!canEdit(indId) || pending) return;
    setError(null);
    setEditingIndicatorId(indId);
    setInputVal(currentVal == null ? '' : String(currentVal));
    setNotesVal(currentNotes || '');
  };

  const handleSaveEdit = async (indId: string) => {
    if (pending) return;
    if (!canEdit(indId)) { setError('Hanya PIC yang ditugaskan dapat mengubah data pada periode terbuka.'); return; }
    const val = Number(inputVal);
    if (!inputVal.trim() || !Number.isFinite(val) || val < 0) { setError('Isi realisasi dengan angka valid yang tidak negatif.'); return; }
    setPending(true);
    setError(null);
    try {
      await pkpStore.updateMonthlyInput(indId, selectedMonth, val, notesVal, undefined, currentYear);
      setEditingIndicatorId(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Penyimpanan gagal. Silakan coba lagi.');
    } finally { setPending(false); }
  };

  // WhatsApp Reminder Link Generator
  const generateWaReminder = () => {
    if (!activePic) return '#';
    const text = encodeURIComponent(
      `Halo ${activePic.name}, mohon melengkapi data capaian fisik untuk Bulan ke-${selectedMonth} sesuai batas waktu pelaporan. Terima kasih.`
    );
    return `https://wa.me/${activePic.phone}?text=${text}`;
  };

  if (currentUser.role === 'PIC') {
    const locked = pkpStore.isPeriodLocked(currentYear, selectedMonth);
    const visibleItems = itemsWithRecord.filter(({ record }) => {
      const filled = !record.isMissing && typeof record.pencapaianRiil === 'number' && Number.isFinite(record.pencapaianRiil);
      return inputFilter === 'all' || (inputFilter === 'filled' ? filled : !filled);
    });
    const month = new Intl.DateTimeFormat('id-ID', { month: 'long' }).format(new Date(currentYear, selectedMonth - 1, 1));
    return (
      <div className="max-w-4xl space-y-6">
        <header>
          <p className="text-sm text-slate-500">{month} {currentYear}</p>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">Indikator Saya</h1>
          <p className="mt-2 text-sm text-slate-600">Isi realisasi indikator yang ditugaskan kepada Anda. Pilih indikator untuk menambahkan catatan dan bukti.</p>
        </header>
        {load.error && <p role="alert" className="rounded-lg bg-rose-50 p-4 text-sm text-rose-800">{load.error.message}</p>}
        {load.loading && <p role="status" className="text-sm text-slate-600">Memuat indikator Anda...</p>}
        {locked && <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Periode ini dikunci. Anda dapat melihat data, tetapi tidak dapat mengubahnya.</p>}
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter status pengisian">
          {([
            ['all', 'Semua', totalAssigned],
            ['missing', 'Belum diisi', totalAssigned - submittedCount],
            ['filled', 'Sudah diisi', submittedCount],
          ] as const).map(([value, label, count]) => (
            <button key={value} aria-pressed={inputFilter === value} onClick={() => setInputFilter(value)} className={`min-h-11 rounded-lg border px-4 py-2 text-sm font-medium ${inputFilter === value ? 'border-emerald-700 bg-emerald-700 text-white' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'}`}>
              {label} ({count})
            </button>
          ))}
        </div>
        {!load.loading && !load.error && !visibleItems.length && <p className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600">{totalAssigned === 0 ? 'Belum ada indikator yang ditugaskan kepada Anda. Hubungi Admin Puskesmas untuk penugasan.' : 'Tidak ada indikator dengan status ini. Pilih filter lain untuk melihat indikator Anda.'}</p>}
        <ul className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white">
          {visibleItems.map(({ indicator, record, monthlyTarget }) => {
            const filled = !record.isMissing && typeof record.pencapaianRiil === 'number' && Number.isFinite(record.pencapaianRiil);
            return (
              <li key={indicator.id} className="p-4 sm:p-5" data-indicator-id={indicator.id}>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                  <span className="font-mono text-slate-500">{indicator.sectionCode}.{indicator.no.replace('.', '')}</span>
                  <span className={filled ? 'font-medium text-emerald-700' : 'font-medium text-amber-800'}>{filled ? 'Sudah diisi' : 'Belum diisi'}</span>
                </div>
                <h2 className="mt-2 break-words text-base font-semibold text-slate-900">{indicator.indikator}</h2>
                <p className="mt-1 break-words text-sm text-slate-500">{indicator.kegiatan}</p>
                <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                  <dl className="flex flex-wrap gap-x-8 gap-y-3 text-sm">
                    <div><dt className="text-slate-500">Target sasaran / bulan</dt><dd className="mt-1 font-medium text-slate-800">{monthlyTarget === null ? 'Belum ditetapkan' : `${monthlyTarget.toLocaleString('id-ID', { maximumFractionDigits: 1 })} ${indicator.satuan}`}</dd></div>
                    <div><dt className="text-slate-500">Realisasi</dt><dd className="mt-1 font-semibold text-slate-900">{filled ? `${record.pencapaianRiil!.toLocaleString('id-ID')} ${indicator.satuan}` : 'Belum diisi'}</dd></div>
                  </dl>
                  <button onClick={() => onOpenDrawer(indicator)} disabled={load.loading || !!load.error} className="min-h-11 shrink-0 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">{locked ? 'Lihat indikator' : filled ? 'Ubah isian' : 'Isi indikator'}</button>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {(error || load.error) && <p role="alert" className="p-4 rounded-xl bg-rose-50 text-rose-700">{error ?? load.error?.message}</p>}
      {load.loading && <p role="status" className="text-sm text-slate-500">Memuat data PIC...</p>}
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
            value={picId}
            disabled={pending}
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

          {currentUser.role === 'ADMIN_PUSKESMAS' && activePic?.phone && (
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
            {totalAssigned > 0 ? `${Math.round((submittedCount / totalAssigned) * 100)}%` : '-'} Terisi
          </span>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <span className="text-[11px] font-semibold text-slate-500 uppercase">Sinkron Provinsi</span>
          <div className="text-2xl font-bold font-mono text-teal-600 mt-1">
            -
          </div>
          <span className="text-[11px] text-teal-700 font-medium">
            Integrasi belum tersedia
          </span>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <span className="text-[11px] font-semibold text-slate-500 uppercase">Rata-rata Skor PIC</span>
          <div className="text-2xl font-bold font-mono text-slate-900 mt-1">
            {avgScore === null ? '-' : `${avgScore.toFixed(1)}%`}
          </div>
          <span className={`text-[11px] font-bold ${
            avgScore === null ? 'text-slate-500' : avgScore >= 91 ? 'text-emerald-600' : avgScore >= 81 ? 'text-amber-600' : 'text-rose-600'
          }`}>
            {avgScore === null ? 'Belum dinilai' : `Dari ${scores.length} indikator dinilai`}
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
          <span className="text-[11px] text-slate-400 mt-1 block">{totalAssigned - scores.length} Belum dinilai</span>
        </div>
      </div>

      {/* Main Table: Indicators Assigned to PIC */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
            Daftar Elemen Penilaian ({filteredIndicators.length} Indikator)
          </h3>
          <span className="text-[11px] text-slate-500">
            Input hanya tersedia bagi PIC yang ditugaskan pada periode terbuka.
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
              {!itemsWithRecord.length && <tr><td colSpan={9} className="p-6 text-center text-slate-500">Tidak ada indikator yang ditugaskan untuk pilihan PIC ini.</td></tr>}
              {itemsWithRecord.map(({ indicator, record, monthlyTarget }) => {
                const isEditing = editingIndicatorId === indicator.id && canEdit(indicator.id);

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
                      {monthlyTarget === null ? '-' : monthlyTarget.toFixed(1)}
                    </td>

                    {/* Realization input */}
                    <td className="py-2.5 px-3 text-right align-top">
                      {isEditing ? (
                        <div className="space-y-1">
                          <input
                            type="number"
                            disabled={pending}
                            value={inputVal}
                            onChange={(e) => setInputVal(e.target.value)}
                            className="w-24 text-right px-2 py-1 text-xs border border-emerald-500 rounded font-mono font-bold focus:outline-none focus:ring-1 focus:ring-emerald-500"
                            autoFocus
                          />
                          <input
                            type="text"
                            disabled={pending}
                            placeholder="Catatan..."
                            value={notesVal}
                            onChange={(e) => setNotesVal(e.target.value)}
                            className="w-full text-left px-1.5 py-0.5 text-[10px] border border-slate-300 rounded"
                          />
                        </div>
                      ) : (
                        <div className="font-mono font-bold text-slate-900">
                          {record.pencapaianRiil ?? '-'}
                          <span className="text-[10px] text-slate-400 font-sans ml-1">
                            {indicator.satuan}
                          </span>
                        </div>
                      )}
                    </td>

                    {/* Realization % */}
                    <td className="py-2.5 px-3 text-right font-mono text-slate-700 align-top">
                      {record.capaianRiilPct == null ? '-' : `${record.capaianRiilPct}%`}
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
                          title={record.syncedAt ? `Tersinkron ke server SIPKP Provinsi (${record.syncedAt})` : 'Status sinkron dari server'}
                        >
                          <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                          <span>Tersinkron</span>
                        </span>
                      ) : (
                        <span className="text-[10px] text-slate-500" title="Backend belum menyediakan operasi sinkronisasi provinsi">Integrasi belum tersedia</span>
                      )}
                    </td>

                    {/* Action buttons */}
                    <td className="py-2.5 px-3 text-center align-top">
                      {isEditing ? (
                        <div className="flex items-center justify-center gap-1">
                          <button
                            disabled={pending}
                            onClick={() => void handleSaveEdit(indicator.id)}
                            className="px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-[11px] font-bold"
                          >
                            {pending ? 'Menyimpan...' : 'Simpan'}
                          </button>
                          <button
                            disabled={pending}
                            onClick={() => setEditingIndicatorId(null)}
                            className="px-2 py-1 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded text-[11px]"
                          >
                            Batal
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => handleStartEdit(indicator.id, record.pencapaianRiil, record.notes)}
                          disabled={pending || !canEdit(indicator.id)}
                          title={!canEdit(indicator.id) ? 'Hanya PIC yang ditugaskan pada periode terbuka dapat mengubah data.' : undefined}
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
