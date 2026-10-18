import React, { useState, useEffect } from 'react';
import { pkpStore } from '../../services/mockState';
import { Sheet7OfficialSummary, PeriodLockState } from '../../types/pkp';
import { AppLogo } from '../common/AppLogo';
import { 
  FileText, 
  Printer, 
  Lock, 
  Unlock, 
  CheckCircle2, 
  AlertTriangle, 
  Send, 
  Clock, 
  Award, 
  Check, 
  ChevronRight,
  ShieldCheck,
  Building,
  Calendar,
  Layers,
  FileCheck2,
  RefreshCw
} from 'lucide-react';

export const OfficialPerformanceSheet7: React.FC = () => {
  const [selectedQuarter, setSelectedQuarter] = useState<1 | 2 | 3 | 4 | 'ANNUAL'>(1);
  const currentYear = pkpStore.getCurrentYear();
  const currentUser = pkpStore.getCurrentUser();
  const isDinkes = currentUser.role === 'DINKES_ADMIN';

  const [summaryData, setSummaryData] = useState<Sheet7OfficialSummary>(
    pkpStore.getOfficialSheet7Data(selectedQuarter, currentYear)
  );

  const [lockState, setLockState] = useState<PeriodLockState>(
    pkpStore.getPeriodLock(currentYear, selectedQuarter === 'ANNUAL' ? 12 : selectedQuarter, selectedQuarter !== 'ANNUAL')
  );

  const [showSubmitModal, setShowSubmitModal] = useState<boolean>(false);
  const [showRevisionModal, setShowRevisionModal] = useState<boolean>(false);
  const [revisionNoteInput, setRevisionNoteInput] = useState<string>('');
  const [notification, setNotification] = useState<string | null>(null);

  // Subscribe to changes in store
  useEffect(() => {
    const refreshData = () => {
      setSummaryData(pkpStore.getOfficialSheet7Data(selectedQuarter, currentYear));
      setLockState(pkpStore.getPeriodLock(
        currentYear, 
        selectedQuarter === 'ANNUAL' ? 12 : selectedQuarter, 
        selectedQuarter !== 'ANNUAL'
      ));
    };

    const unsub = pkpStore.subscribe(refreshData);
    refreshData();
    return () => unsub();
  }, [selectedQuarter, currentYear]);

  const handleQuarterChange = (q: 1 | 2 | 3 | 4 | 'ANNUAL') => {
    setSelectedQuarter(q);
    setSummaryData(pkpStore.getOfficialSheet7Data(q, currentYear));
    setLockState(pkpStore.getPeriodLock(
      currentYear, 
      q === 'ANNUAL' ? 12 : q, 
      q !== 'ANNUAL'
    ));
  };

  const handlePrint = () => {
    window.print();
  };

  // Workflow Handlers
  const handleSubmitToDinkes = () => {
    const periodNum = selectedQuarter === 'ANNUAL' ? 12 : selectedQuarter;
    const isQ = selectedQuarter !== 'ANNUAL';
    pkpStore.submitPeriod(currentYear, periodNum, isQ, currentUser.name);
    setShowSubmitModal(false);
    setNotification('Laporan Kinerja resmi berhasil diajukan ke Dinas Kesehatan dan dikunci untuk verifikasi.');
    setTimeout(() => setNotification(null), 3500);
  };

  const handleVerifyByDinkes = () => {
    const periodNum = selectedQuarter === 'ANNUAL' ? 12 : selectedQuarter;
    const isQ = selectedQuarter !== 'ANNUAL';
    pkpStore.verifyAndLockPeriod(currentYear, periodNum, isQ, `${currentUser.name} (Dinkes)`);
    setNotification('Hasil Kinerja Puskesmas telah DIVERIFIKASI & DIKUNCI secara sah oleh Dinas Kesehatan.');
    setTimeout(() => setNotification(null), 3500);
  };

  const handleRequestRevision = () => {
    if (!revisionNoteInput.trim()) return;
    const periodNum = selectedQuarter === 'ANNUAL' ? 12 : selectedQuarter;
    const isQ = selectedQuarter !== 'ANNUAL';
    pkpStore.requestRevisionPeriod(currentYear, periodNum, isQ, `${currentUser.name} (Dinkes)`, revisionNoteInput);
    setShowRevisionModal(false);
    setRevisionNoteInput('');
    setNotification('Catatan revisi telah dikirimkan kembali ke Puskesmas.');
    setTimeout(() => setNotification(null), 3500);
  };

  const handleUnlockForEdit = () => {
    const periodNum = selectedQuarter === 'ANNUAL' ? 12 : selectedQuarter;
    const isQ = selectedQuarter !== 'ANNUAL';
    pkpStore.unlockPeriodForEdit(currentYear, periodNum, isQ, currentUser.name);
    setNotification('Kunci data periode ini telah dibuka oleh Dinas Kesehatan.');
    setTimeout(() => setNotification(null), 3500);
  };

  const getScoreBadge = (score: number) => {
    if (score >= 91) return 'bg-emerald-100 text-emerald-800 border-emerald-300';
    if (score >= 81) return 'bg-amber-100 text-amber-800 border-amber-300';
    return 'bg-rose-100 text-rose-800 border-rose-300';
  };

  const isLocked = lockState.status === 'VERIFIED' || lockState.status === 'SUBMITTED';

  return (
    <div className="space-y-6">
      {/* ===================== NOTIFICATION TOAST ===================== */}
      {notification && (
        <div className="no-print p-4 bg-emerald-50 border border-emerald-300 rounded-xl flex items-center justify-between text-emerald-900 text-sm font-semibold shadow-sm animate-in fade-in">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" />
            <span>{notification}</span>
          </div>
          <button onClick={() => setNotification(null)} className="text-emerald-700 hover:text-emerald-900 text-xs">
            Tutup
          </button>
        </div>
      )}

      {/* ===================== NO-PRINT INTERACTIVE HEADER ===================== */}
      <div className="no-print bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-indigo-600 font-bold text-xs uppercase tracking-wider mb-1">
            <FileCheck2 className="w-4 h-4" />
            <span>Instrumen Resmi Kemenkes / Jawa Timur • Sheet 7 Excel</span>
          </div>
          <h2 className="text-2xl font-black text-slate-800 tracking-tight flex items-center gap-2">
            Lembar Hasil Kinerja Puskesmas (NILAI KINERJA {currentYear})
          </h2>
          <p className="text-xs text-slate-500 mt-1 max-w-2xl">
            Rekapitulasi resmi seluruh 5 Klaster dan 29 Sub-klaster Penilaian Kinerja Puskesmas (PKP). Dilengkapi alur verifikasi berjenjang dan cetak Berita Acara bertandatangan.
          </p>
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Period Selector Tabs */}
          <div className="flex p-1 bg-slate-100 rounded-xl border border-slate-200 text-xs font-semibold">
            <button
              onClick={() => handleQuarterChange(1)}
              className={`px-3 py-1.5 rounded-lg transition-all ${
                selectedQuarter === 1 ? 'bg-white text-emerald-700 shadow-sm font-bold' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Triwulan I
            </button>
            <button
              onClick={() => handleQuarterChange(2)}
              className={`px-3 py-1.5 rounded-lg transition-all ${
                selectedQuarter === 2 ? 'bg-white text-emerald-700 shadow-sm font-bold' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Triwulan II
            </button>
            <button
              onClick={() => handleQuarterChange(3)}
              className={`px-3 py-1.5 rounded-lg transition-all ${
                selectedQuarter === 3 ? 'bg-white text-emerald-700 shadow-sm font-bold' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Triwulan III
            </button>
            <button
              onClick={() => handleQuarterChange(4)}
              className={`px-3 py-1.5 rounded-lg transition-all ${
                selectedQuarter === 4 ? 'bg-white text-emerald-700 shadow-sm font-bold' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Triwulan IV
            </button>
            <button
              onClick={() => handleQuarterChange('ANNUAL')}
              className={`px-3 py-1.5 rounded-lg transition-all ${
                selectedQuarter === 'ANNUAL' ? 'bg-emerald-600 text-white shadow-sm font-bold' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Tahunan
            </button>
          </div>

          {/* Print Button */}
          <button
            onClick={handlePrint}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-900 text-white font-bold text-xs flex items-center gap-2 shadow-sm transition-all"
          >
            <Printer className="w-4 h-4" />
            <span>Cetak Berita Acara (Print)</span>
          </button>
        </div>
      </div>

      {/* ===================== WORKFLOW & STATUS BANNER ===================== */}
      <div className="no-print">
        {lockState.status === 'VERIFIED' && (
          <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-300 flex flex-col md:flex-row md:items-center justify-between gap-3 text-emerald-950">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-700 flex-shrink-0">
                <Lock className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-sm text-emerald-900">
                    STATUS: DIVERIFIKASI & DIKUNCI OLEH DINAS KESEHATAN
                  </span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-200 text-emerald-800 font-bold uppercase">
                    Sah / Locked
                  </span>
                </div>
                <p className="text-xs text-emerald-800">
                  Diverifikasi oleh <span className="font-semibold">{lockState.verifiedBy}</span> pada {lockState.verifiedAt}. Seluruh nilai indikator periode ini terkunci secara resmi.
                </p>
              </div>
            </div>

            {isDinkes && (
              <button
                onClick={handleUnlockForEdit}
                className="px-3 py-1.5 rounded-lg bg-white border border-emerald-300 hover:bg-emerald-100 text-emerald-800 text-xs font-bold flex items-center gap-1.5 transition-all self-start md:self-auto"
              >
                <Unlock className="w-3.5 h-3.5 text-emerald-700" />
                <span>Buka Kunci Revisi</span>
              </button>
            )}
          </div>
        )}

        {lockState.status === 'SUBMITTED' && (
          <div className="p-4 rounded-xl bg-sky-50 border border-sky-300 flex flex-col md:flex-row md:items-center justify-between gap-3 text-sky-950">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-sky-100 flex items-center justify-center text-sky-700 flex-shrink-0">
                <Clock className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-sm text-sky-900">
                    STATUS: MENUNGGU VERIFIKASI DINAS KESEHATAN
                  </span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-sky-200 text-sky-800 font-bold uppercase">
                    Submitted / Terkunci Sementara
                  </span>
                </div>
                <p className="text-xs text-sky-800">
                  Diajukan oleh <span className="font-semibold">{lockState.submittedBy}</span> pada {lockState.submittedAt}. Data dikunci sementara selama proses evaluasi Tim Pembina Dinkes.
                </p>
              </div>
            </div>

            {isDinkes ? (
              <div className="flex items-center gap-2 self-start md:self-auto">
                <button
                  onClick={() => setShowRevisionModal(true)}
                  className="px-3 py-1.5 rounded-lg bg-white border border-rose-300 text-rose-700 hover:bg-rose-50 text-xs font-bold transition-all"
                >
                  Minta Revisi
                </button>
                <button
                  onClick={handleVerifyByDinkes}
                  className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1.5 shadow-sm transition-all"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Sahkan & Kunci Nilai</span>
                </button>
              </div>
            ) : (
              <span className="text-xs text-sky-700 italic self-start md:self-auto">
                Menunggu pengesahan Dinkes
              </span>
            )}
          </div>
        )}

        {lockState.status === 'REVISION_REQUIRED' && (
          <div className="p-4 rounded-xl bg-rose-50 border border-rose-300 flex flex-col md:flex-row md:items-center justify-between gap-3 text-rose-950">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-rose-100 flex items-center justify-center text-rose-700 flex-shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-sm text-rose-900">
                    STATUS: PERLU REVISI OLEH PUSKESMAS
                  </span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-rose-200 text-rose-800 font-bold uppercase">
                    Action Required
                  </span>
                </div>
                <p className="text-xs text-rose-800 mt-0.5">
                  Catatan Tim Dinkes: <span className="font-semibold italic">"{lockState.revisionNote || 'Mohon cek kembali indikator yang belum sesuai sasaran'}"</span>
                </p>
              </div>
            </div>

            {!isDinkes && (
              <button
                onClick={() => setShowSubmitModal(true)}
                className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1.5 shadow-sm transition-all self-start md:self-auto"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Ajukan Ulang ke Dinkes</span>
              </button>
            )}
          </div>
        )}

        {lockState.status === 'DRAFT' && (
          <div className="p-4 rounded-xl bg-slate-100 border border-slate-300 flex flex-col md:flex-row md:items-center justify-between gap-3 text-slate-800">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-slate-200 flex items-center justify-center text-slate-600 flex-shrink-0">
                <FileText className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-sm text-slate-800">
                    STATUS: DRAFT TERBUKA (INPUT AKTIF)
                  </span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-200 text-slate-700 font-bold uppercase">
                    Open for Edit
                  </span>
                </div>
                <p className="text-xs text-slate-500">
                  PIC masih dapat mengisi dan mengoreksi data capaian bulanan. Setelah data lengkap, Kepala Puskesmas / Admin dapat mengajukan laporan resmi ke Dinkes.
                </p>
              </div>
            </div>

            {!isDinkes && (
              <button
                onClick={() => setShowSubmitModal(true)}
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-2 shadow-sm transition-all self-start md:self-auto"
              >
                <Send className="w-4 h-4" />
                <span>Ajukan Laporan ke Dinkes</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* ===================== SUMMARY METRIC CARDS ===================== */}
      <div className="no-print grid grid-cols-1 md:grid-cols-6 gap-4">
        {/* Main Final PKP Score */}
        <div className="md:col-span-2 bg-gradient-to-br from-slate-900 to-slate-800 text-white p-5 rounded-2xl shadow-sm border border-slate-700 relative overflow-hidden">
          <div className="relative z-10">
            <div className="flex items-center justify-between text-slate-300 text-xs font-semibold mb-2">
              <span>NILAI KINERJA PUSKESMAS</span>
              <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[10px] font-mono border border-emerald-500/30">
                {summaryData.periodLabel}
              </span>
            </div>
            <div className="flex items-baseline gap-3">
              <span className="text-4xl font-black tracking-tight text-white">
                {summaryData.nilaiKinerjaPuskesmas.toFixed(2)}
              </span>
              <span className="text-sm font-semibold text-slate-400">/ 100</span>
            </div>

            <div className="mt-3 flex items-center gap-2">
              <span className={`px-2.5 py-1 rounded-full text-xs font-black uppercase tracking-wider ${
                summaryData.kategoriPKP === 'Kinerja Baik'
                  ? 'bg-emerald-500 text-white'
                  : summaryData.kategoriPKP === 'Kinerja Cukup'
                  ? 'bg-amber-500 text-slate-950'
                  : 'bg-rose-500 text-white'
              }`}>
                {summaryData.kategoriPKP}
              </span>
              <span className="text-[11px] text-slate-400">
                (Standar PKP Jatim & Kemenkes)
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-3 pt-3 border-t border-slate-700">
              Formula: Rerata 5 Klaster = (D6 + D19 + D25 + D28 + D32) / 5
            </p>
          </div>
        </div>

        {/* 5 Klaster Mini Cards */}
        <div className="md:col-span-4 grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            { id: 1, name: 'Klaster 1 (Manajemen)', score: summaryData.klasterScores[1] },
            { id: 2, name: 'Klaster 2 (KIA)', score: summaryData.klasterScores[2] },
            { id: 3, name: 'Klaster 3 (Dewasa/Lansia)', score: summaryData.klasterScores[3] },
            { id: 4, name: 'Klaster 4 (P2M/Kesling)', score: summaryData.klasterScores[4] },
            { id: 5, name: 'Klaster 5 (Lintas Klaster)', score: summaryData.klasterScores[5] },
          ].map((k) => (
            <div key={k.id} className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between">
              <div>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  Klaster {k.id}
                </span>
                <p className="text-xs font-bold text-slate-700 truncate mt-0.5" title={k.name}>
                  {k.name.replace(/Klaster \d+ /, '')}
                </p>
              </div>
              <div className="mt-2">
                <span className="text-xl font-black text-slate-900">
                  {k.score.toFixed(2)}
                </span>
                <div className={`mt-1 h-1.5 w-full rounded-full bg-slate-100 overflow-hidden`}>
                  <div 
                    className={`h-full rounded-full ${
                      k.score >= 91 ? 'bg-emerald-500' : k.score >= 81 ? 'bg-amber-500' : 'bg-rose-500'
                    }`}
                    style={{ width: `${Math.min(100, k.score)}%` }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ===================== PRINT / OFFICIAL REPORT CONTAINER ===================== */}
      <div className="bg-white p-6 sm:p-8 rounded-2xl border border-slate-200 shadow-sm print-container">
        
        {/* PRINT ONLY: OFFICIAL GOVERNMENT LETTERHEAD (KOP SURAT) */}
        <div className="print-only mb-6 border-b-4 border-double border-slate-900 pb-4">
          <div className="flex items-center justify-between gap-6">
            <AppLogo variant="official" size="md" />
            <div className="text-right">
              <h3 className="text-xs font-bold tracking-wider uppercase text-slate-800">
                Pemerintah Kabupaten Malang • Dinas Kesehatan
              </h3>
              <h2 className="text-base font-black tracking-tight uppercase text-slate-900">
                UPT PUSKESMAS KEBONAGUNG
              </h2>
              <p className="text-[10px] text-slate-700">
                Jl. Raya Kebonagung No. 123, Kec. Pakisaji, Kab. Malang, Jawa Timur 65162
              </p>
              <p className="text-[9px] text-slate-600">
                Telp: (0341) 801234 | Email: pkm.kebonagung@malangkab.go.id | Kode Faskes: P35070101
              </p>
            </div>
          </div>
        </div>

        {/* PRINT ONLY: BERITA ACARA HEADER */}
        <div className="print-only text-center my-4">
          <h1 className="text-base font-black uppercase tracking-tight underline">
            BERITA ACARA EVALUASI HASIL PENILAIAN KINERJA PUSKESMAS (PKP)
          </h1>
          <p className="text-xs font-semibold mt-1">
            Nomor: 440 / {selectedQuarter === 'ANNUAL' ? 'THN' : `TW${selectedQuarter}`} / PKP / 35.07.101 / {currentYear}
          </p>
          <p className="text-xs text-slate-700 mt-2 text-justify">
            Pada hari ini, bertempat di UPT Puskesmas Kebonagung, telah dilakukan evaluasi dan verifikasi data capaian Penilaian Kinerja Puskesmas (PKP) Periode <strong>{summaryData.periodLabel}</strong> Tahun Anggaran <strong>{currentYear}</strong> berdasarkan instrumen standar Dinas Kesehatan Provinsi Jawa Timur dan Kepmenkes RI, dengan hasil sebagai berikut:
          </p>
        </div>

        {/* TABLE TITLE FOR SCREEN VIEW */}
        <div className="no-print flex items-center justify-between pb-4 mb-4 border-b border-slate-100">
          <div>
            <h3 className="text-lg font-black text-slate-800">
              Matriks Rekapitulasi Nilai Kinerja (Sheet 7)
            </h3>
            <p className="text-xs text-slate-500">
              Puskesmas: <span className="font-bold text-slate-700">{summaryData.puskesmasName} ({summaryData.puskesmasCode})</span> • Periode: <span className="font-bold text-slate-700">{summaryData.periodLabel}</span>
            </p>
          </div>
          <span className="text-xs font-mono px-3 py-1 bg-slate-100 text-slate-700 rounded-lg border border-slate-200">
            Formulir Excel Sheet 7
          </span>
        </div>

        {/* ===================== THE OFFICIAL SHEET 7 TABLE ===================== */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-100 border-y-2 border-slate-300 text-slate-800 uppercase font-black tracking-wider text-[11px]">
                <th className="py-2.5 px-3 w-16 text-center border-r border-slate-200">No</th>
                <th className="py-2.5 px-4 border-r border-slate-200">Pelayanan / Kelompok Indikator</th>
                <th className="py-2.5 px-3 w-28 text-right border-r border-slate-200">Nilai Kelompok</th>
                <th className="py-2.5 px-3 w-28 text-right border-r border-slate-200">Nilai Klaster</th>
                <th className="py-2.5 px-3 w-32 text-right border-r border-slate-200">Nilai Kinerja</th>
                <th className="py-2.5 px-3 w-36 text-center border-r border-slate-200">Kategori PKP</th>
                <th className="py-2.5 px-4 min-w-[200px]">Rekomendasi Tim Pembina</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {/* TOP HEADER ROW: HASIL KINERJA PUSKESMAS */}
              <tr className="bg-emerald-50/70 border-b-2 border-emerald-300 font-black text-slate-900">
                <td className="py-3 px-3 text-center border-r border-slate-200">-</td>
                <td className="py-3 px-4 text-emerald-950 font-black tracking-wide border-r border-slate-200">
                  HASIL KINERJA PUSKESMAS (AKUMULATIF)
                </td>
                <td className="py-3 px-3 text-right border-r border-slate-200">-</td>
                <td className="py-3 px-3 text-right border-r border-slate-200">-</td>
                <td className="py-3 px-3 text-right text-emerald-900 text-sm font-black border-r border-slate-200">
                  {summaryData.nilaiKinerjaPuskesmas.toFixed(2)}
                </td>
                <td className="py-3 px-3 text-center border-r border-slate-200">
                  <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-black border ${getScoreBadge(summaryData.nilaiKinerjaPuskesmas)}`}>
                    {summaryData.kategoriPKP}
                  </span>
                </td>
                <td className="py-3 px-4 text-[11px] text-slate-600 italic">
                  Status: {lockState.status}
                </td>
              </tr>

              {/* ROWS OF 5 KLASTERS & 29 SUBKLASTERS */}
              {summaryData.rows.map((row, idx) => {
                if (row.isKlasterHead) {
                  return (
                    <tr key={`head-${row.no}-${idx}`} className="bg-slate-50 font-black text-slate-800 border-t-2 border-slate-300">
                      <td className="py-2.5 px-3 text-center border-r border-slate-200 font-mono">
                        {row.no}
                      </td>
                      <td className="py-2.5 px-4 uppercase tracking-wide border-r border-slate-200 text-slate-900">
                        {row.name}
                      </td>
                      <td className="py-2.5 px-3 text-right border-r border-slate-200 text-slate-400 font-mono">-</td>
                      <td className="py-2.5 px-3 text-right font-mono text-slate-900 text-xs border-r border-slate-200 bg-slate-100/60 font-bold">
                        {row.nilaiKlaster?.toFixed(2) || '0.00'}
                      </td>
                      <td className="py-2.5 px-3 text-right border-r border-slate-200 font-mono text-slate-400">-</td>
                      <td className="py-2.5 px-3 text-center border-r border-slate-200">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${getScoreBadge(row.nilaiKlaster || 0)}`}>
                          {(row.nilaiKlaster || 0) >= 91 ? 'Baik' : (row.nilaiKlaster || 0) >= 81 ? 'Sedang' : 'Kurang'}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-[11px] text-slate-400 italic">
                        Rerata Subklaster {row.no}
                      </td>
                    </tr>
                  );
                }

                // Subklaster Row
                return (
                  <tr key={`sub-${row.no}-${idx}`} className="hover:bg-slate-50 transition-colors">
                    <td className="py-2 px-3 text-center border-r border-slate-200 font-mono text-slate-500">
                      {row.no}
                    </td>
                    <td className="py-2 px-4 border-r border-slate-200 text-slate-700 pl-8">
                      {row.name}
                    </td>
                    <td className="py-2 px-3 text-right font-mono font-semibold border-r border-slate-200 text-slate-900">
                      {row.nilaiKelompok?.toFixed(2) || '0.00'}
                    </td>
                    <td className="py-2 px-3 text-right border-r border-slate-200 text-slate-400 font-mono text-[11px]">-</td>
                    <td className="py-2 px-3 text-right border-r border-slate-200 text-slate-400 font-mono text-[11px]">-</td>
                    <td className="py-2 px-3 text-center border-r border-slate-200">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                        (row.nilaiKelompok || 0) >= 91 ? 'text-emerald-700 bg-emerald-50' : 
                        (row.nilaiKelompok || 0) >= 81 ? 'text-amber-700 bg-amber-50' : 
                        'text-rose-700 bg-rose-50'
                      }`}>
                        {(row.nilaiKelompok || 0) >= 91 ? 'Baik' : (row.nilaiKelompok || 0) >= 81 ? 'Sedang' : 'Kurang'}
                      </span>
                    </td>
                    <td className="py-2 px-4 text-[11px] text-slate-600">
                      {row.rekomendasi ? (
                        <span className="text-amber-800 font-medium">
                          {row.rekomendasi}
                        </span>
                      ) : (
                        <span className="text-slate-400 italic">Sesuai standar operasional</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* PRINT ONLY: OFFICIAL SIGNATURE BLOCKS */}
        <div className="print-only mt-10 pt-6 border-t border-slate-300">
          <p className="text-xs text-right text-slate-800 mb-8 font-serif">
            Malang, 31 Maret {currentYear}
          </p>

          <div className="grid grid-cols-3 gap-6 text-center text-xs">
            {/* Pihak 1: Kepala Puskesmas */}
            <div>
              <p className="font-bold text-slate-800 uppercase">
                Menyetujui,<br />
                Kepala UPT Puskesmas Kebonagung
              </p>
              <div className="h-20 flex items-center justify-center text-[10px] text-slate-400 italic">
                (Tanda Tangan & Cap Faskes)
              </div>
              <p className="font-bold underline text-slate-900">
                {summaryData.kepalaPuskesmas}
              </p>
              <p className="text-[10px] text-slate-600">
                NIP. {summaryData.nipKepalaPuskesmas}
              </p>
            </div>

            {/* Pihak 2: Tim Pembina Dinkes */}
            <div>
              <p className="font-bold text-slate-800 uppercase">
                Tim Pembina / Verifikator<br />
                Dinas Kesehatan Kab. Malang
              </p>
              <div className="h-20 flex items-center justify-center text-[10px] text-slate-400 italic">
                (Tanda Tangan Verifikator)
              </div>
              <p className="font-bold underline text-slate-900">
                drg. Sulistyaningsih, M.M.R
              </p>
              <p className="text-[10px] text-slate-600">
                NIP. 19720315 199903 2 004
              </p>
            </div>

            {/* Pihak 3: Mengetahui Kepala Dinas */}
            <div>
              <p className="font-bold text-slate-800 uppercase">
                Mengetahui,<br />
                Kepala Dinas Kesehatan Kab. Malang
              </p>
              <div className="h-20 flex items-center justify-center text-[10px] text-slate-400 italic">
                (Tanda Tangan & Cap Dinas)
              </div>
              <p className="font-bold underline text-slate-900">
                dr. Wiyanto Wijoyo, M.M.Kes
              </p>
              <p className="text-[10px] text-slate-600">
                NIP. 19680512 199803 1 007
              </p>
            </div>
          </div>
        </div>

      </div>

      {/* ===================== SUBMISSION CONFIRMATION MODAL ===================== */}
      {showSubmitModal && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200">
            <div className="w-12 h-12 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center mb-4">
              <Send className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-bold text-slate-900">
              Ajukan Laporan Kinerja ke Dinas Kesehatan?
            </h3>
            <p className="text-xs text-slate-600 mt-2 leading-relaxed">
              Anda akan mengajukan Laporan Penilaian Kinerja Puskesmas periode <strong>{summaryData.periodLabel} Tahun {currentYear}</strong>. 
              <br /><br />
              <strong className="text-amber-800">Perhatian:</strong> Setelah diajukan, status data akan berubah menjadi <strong>Terkunci Sementara</strong> untuk seluruh PIC hingga Dinas Kesehatan menyelesaikan verifikasi atau meminta revisi.
            </p>

            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                onClick={() => setShowSubmitModal(false)}
                className="px-4 py-2 rounded-xl border border-slate-300 text-slate-700 text-xs font-semibold hover:bg-slate-50 transition-colors"
              >
                Batal
              </button>
              <button
                onClick={handleSubmitToDinkes}
                className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-sm transition-all flex items-center gap-2"
              >
                <Check className="w-4 h-4" />
                <span>Ya, Ajukan & Kunci Data</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===================== REVISION REQUEST MODAL (DINKES) ===================== */}
      {showRevisionModal && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200">
            <div className="w-12 h-12 rounded-xl bg-rose-100 text-rose-700 flex items-center justify-center mb-4">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-bold text-slate-900">
              Minta Perbaikan / Revisi Data ke Puskesmas
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              Tuliskan instruksi atau indikator yang perlu diperbaiki oleh Puskesmas sebelum disahkan secara definitif.
            </p>

            <div className="mt-4">
              <label className="text-xs font-bold text-slate-700 mb-1 block">
                Catatan / Instruksi Pembinaan Dinkes
              </label>
              <textarea
                value={revisionNoteInput}
                onChange={(e) => setRevisionNoteInput(e.target.value)}
                placeholder="Contoh: Tolong verifikasi kembali cakupan imunisasi campak pada bulan Maret, denominator sasaran belum selaras dengan DO..."
                rows={4}
                className="w-full text-xs p-3 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-rose-500"
              />
            </div>

            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                onClick={() => setShowRevisionModal(false)}
                className="px-4 py-2 rounded-xl border border-slate-300 text-slate-700 text-xs font-semibold hover:bg-slate-50"
              >
                Batal
              </button>
              <button
                onClick={handleRequestRevision}
                disabled={!revisionNoteInput.trim()}
                className="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-xs font-bold shadow-sm transition-all"
              >
                Kirim Catatan Revisi
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
