import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { pkpStore } from '../../services/apiStore';
import { PeriodRecapPanel } from './PeriodRecapPanel';
import { ApiError } from '../../services/apiClient';
import { epSyncStatus, lastSyncText } from '../../services/integrationStatus';
import { indicatorDisplayCode } from '../../services/indicatorOrder';
import { OfficialIndicator, KlasterId, Sheet7OfficialSummary } from '../../types/pkp';
import { 
  Search, 
  FileSpreadsheet, 
  ChevronRight, 
  ChevronDown,
  User, 
  Check, 
  CheckCircle2,
  RefreshCw,
  Cloud,
  Lock,
  Unlock,
  Sparkles,
  AlertTriangle,
  Send,
  Clock,
  Layers,
  CalendarDays,
  FileCheck2
} from 'lucide-react';
import { PolarityBadge } from '../common/PolarityBadge';
import { ScoreBadge } from '../common/ScoreBadge';
import { Do2026Editor } from './Do2026Editor';
import { measurementText } from '../../types/do2026';

interface MonthlyDataGridProps {
  selectedMonth: number;
  selectedKlaster: number;
  onSelectKlaster: (klasterId: number) => void;
  onOpenDrawer: (indicator: OfficialIndicator) => void;
}

export const MonthlyDataGrid: React.FC<MonthlyDataGridProps> = ({
  selectedMonth,
  selectedKlaster,
  onSelectKlaster,
  onOpenDrawer,
}) => {
  const [periodViewMode, setPeriodViewMode] = useState<'MONTHLY' | 'QUARTERLY'>('MONTHLY');
  const [selectedQuarter, setSelectedQuarter] = useState<1 | 2 | 3 | 4>(
    selectedMonth <= 3 ? 1 : selectedMonth <= 6 ? 2 : selectedMonth <= 9 ? 3 : 4
  );

  const [searchQuery, setSearchQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [tempValue, setTempValue] = useState<string>('');
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState<string | null>(null);
  const isSyncingAll = false;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useSyncExternalStore(pkpStore.subscribe, pkpStore.getSnapshot, pkpStore.getServerSnapshot);

  // Workflow modals
  const [showSubmitModal, setShowSubmitModal] = useState<boolean>(false);
  const [showRevisionModal, setShowRevisionModal] = useState<boolean>(false);
  const [revisionNoteInput, setRevisionNoteInput] = useState<string>('');

  const currentYear = pkpStore.getCurrentYear();
  const currentUser = pkpStore.getCurrentUser();
  const selectedCenter = pkpStore.getSelectedHealthCenterId();
  useEffect(() => {
    setEditingId(null);
    setTempValue('');
    setError(null);
  }, [currentYear, selectedMonth, selectedKlaster, periodViewMode, selectedCenter]);
  const isDinkes = currentUser.role === 'DINKES_ADMIN';

  const isQuarterMode = periodViewMode === 'QUARTERLY';
  const activePeriodNum = isQuarterMode ? selectedQuarter : selectedMonth;
  const lockState = pkpStore.getPeriodLock(currentYear, activePeriodNum, isQuarterMode);
  const reportingPolicy = pkpStore.getReportingPolicy();

  const indicators = pkpStore.getIndicators();
  const annualTargets = pkpStore.getAnnualTargets();
  let quarterRows: Sheet7OfficialSummary['rows'] | undefined;
  try { quarterRows = pkpStore.getOfficialSheet7Data(selectedQuarter).rows; } catch { /* Scope is loading. */ }

  const showToast = (msg: string) => {
    setToast(msg);
  };

  const isArtifactRow = (ind: OfficialIndicator) => {
    return ind.no === 'No' || ind.no === '(1)' || ind.no === '(2)' || ind.no === '(3)' || ind.no === 'Kegiatan';
  };



  // Filter indicators
  const filtered = indicators.filter((ind) => {
    if (isArtifactRow(ind)) return false;
    if (selectedKlaster !== 0 && ind.klasterId !== selectedKlaster) {
      return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const code = indicatorDisplayCode(ind).toLowerCase();
      return (
        code.includes(q) ||
        ind.indikator.toLowerCase().includes(q) ||
        ind.kegiatan.toLowerCase().includes(q) ||
        ind.section.toLowerCase().includes(q)
      );
    }
    return true;
  });

  // Group filtered indicators by sectionCode
  const groupedSections: { sectionCode: string; sectionName: string; klasterId: KlasterId; items: OfficialIndicator[] }[] = [];
  const seenSections = new Set<string>();

  filtered.forEach(ind => {
    if (!seenSections.has(ind.sectionCode)) {
      seenSections.add(ind.sectionCode);
      const itemsInSection = filtered.filter(i => i.sectionCode === ind.sectionCode);
      groupedSections.push({
        sectionCode: ind.sectionCode,
        sectionName: ind.section || `Sub-klaster ${ind.sectionCode}`,
        klasterId: ind.klasterId,
        items: itemsInSection
      });
    }
  });

  const toggleSection = (sectionCode: string) => {
    setCollapsedSections(prev => ({ ...prev, [sectionCode]: !prev[sectionCode] }));
  };

  const isLocked = !pkpStore.isActiveYear(currentYear) || pkpStore.isPeriodLocked(currentYear, activePeriodNum, isQuarterMode);
  const canManageWorkflow = isDinkes && pkpStore.isActiveYear(currentYear) && !pkpStore.getLoadState().loading;
  const canEdit = (id: string) => pkpStore.canInputOwnPeriod(currentYear) && !pkpStore.getLoadState().loading && !isQuarterMode && !pkpStore.isPeriodLocked(currentYear, selectedMonth) &&
    (currentUser.role === 'ADMIN_PUSKESMAS' || (currentUser.role === 'PIC' && pkpStore.getAssignments()[id] === currentUser.id));

  // Realisasi Edit Handlers
  const handleStartEdit = (ind: OfficialIndicator, currentVal: number | null) => {
    if (pending || editingId === ind.id || !canEdit(ind.id)) return;
    if (isLocked) {
      showToast(`Periode ${isQuarterMode ? `Triwulan ${selectedQuarter}` : `Bulan ke-${selectedMonth}`} sedang TERKUNCI (${lockState.status}). Data tidak dapat diubah.`);
      return;
    }
    if (isQuarterMode) {
      showToast('Hasil triwulan mengikuti versi dan basis data tersimpan. Beralih ke Mode Bulanan untuk menginput capaian riil.');
      return;
    }
    setEditingId(ind.id);
    setTempValue(currentVal?.toString() ?? '');
  };

  const handleCommitEdit = async (ind: OfficialIndicator) => {
    if (pending || !canEdit(ind.id)) return;
    const val = Number(tempValue);
    if (!tempValue.trim() || !Number.isFinite(val) || val < 0) { setError('Realisasi harus berupa angka valid nonnegatif.'); return; }
    setPending(true); setError(null);
    try { await pkpStore.updateMonthlyInput(ind.id, selectedMonth, val); setEditingId(null); }
    catch (e) { setError(e instanceof Error ? e.message : 'Penyimpanan gagal.'); }
    finally { setPending(false); }
  };

  const handleKeyDown = (e: React.KeyboardEvent, ind: OfficialIndicator) => {
    if (e.key === 'Enter') {
      handleCommitEdit(ind);
    } else if (e.key === 'Escape') {
      setEditingId(null);
    }
  };

  const handleHeadPenilaianClick = (sectionName: string, childCount: number) => {
    showToast(`Head Penilaian [${sectionName}]: Nilai dihitung otomatis dari rata-rata ${childCount} child elemen di bawahnya dan tidak bisa diisi secara manual.`);
  };

  const handleOpenHeadDrawer = (sec: { sectionCode: string; sectionName: string; klasterId: KlasterId; items: OfficialIndicator[] }) => {
    const headIndicator: OfficialIndicator = {
      id: `head-${sec.sectionCode}`,
      klasterId: sec.klasterId,
      klasterName: `Klaster ${sec.klasterId}`,
      section: sec.sectionName,
      sectionCode: sec.sectionCode,
      no: 'HEAD',
      kegiatan: 'Sub-Klaster Induk (Agregasi Seluruh Child)',
      indikator: sec.sectionName,
      targetDisplay: '100%',
      targetNumeric: 1.0,
      satuan: 'Rerata %',
      totalSasaranDefault: 0,
      targetSasaranDefault: 0,
      polarity: 'HIGHER_IS_BETTER',
      isHead: true,
      childIds: sec.items.map(i => i.id)
    };
    onOpenDrawer(headIndicator);
  };

  const handleSyncAll = () => setError('Integrasi SIPKP Provinsi belum tersedia.');

  // Workflow Handlers
  const runWorkflow = async (action: (cascade: boolean) => Promise<unknown>) => {
    if (pending) return;
    setPending(true); setError(null);
    try {
      try { await action(false); }
      catch (e) {
        if (!(e instanceof ApiError) || e.status !== 409 || !e.dependencies || !window.confirm(`${e.message}\n${JSON.stringify(e.dependencies)}\nBuka juga seluruh periode terkait?`)) throw e;
        await action(true);
      }
      return true;
    } catch (e) { setError(e instanceof Error ? e.message : 'Operasi gagal.'); return false; }
    finally { setPending(false); }
  };
  const handleSubmitToDinkes = async () => {
    if (currentUser.role !== 'ADMIN_PUSKESMAS' || isLocked) return;
    if (!await runWorkflow(() => pkpStore.submitPeriod(currentYear, activePeriodNum, isQuarterMode))) return;
    setShowSubmitModal(false);
    showToast(`Laporan ${isQuarterMode ? `Triwulan ${selectedQuarter}` : `Bulan ke-${selectedMonth}`} diajukan ke Dinkes & dikunci.`);
  };

  const handleVerifyByDinkes = async () => {
    if (!canManageWorkflow || !await runWorkflow(() => pkpStore.verifyAndLockPeriod(currentYear, activePeriodNum, isQuarterMode))) return;
    showToast(`Laporan ${isQuarterMode ? `Triwulan ${selectedQuarter}` : `Bulan ke-${selectedMonth}`} DIVERIFIKASI & DIKUNCI secara resmi.`);
  };

  const handleRequestRevision = async () => {
    if (!revisionNoteInput.trim()) return;
    if (!canManageWorkflow || !await runWorkflow(cascade => pkpStore.requestRevisionPeriod(currentYear, activePeriodNum, isQuarterMode, revisionNoteInput.trim(), undefined, cascade))) return;
    setShowRevisionModal(false);
    setRevisionNoteInput('');
    showToast('Catatan revisi telah dikirimkan ke Puskesmas.');
  };

  const handleUnlockForEdit = async () => {
    if (!canManageWorkflow || pending) return;
    const reason = window.prompt('Alasan membuka kunci revisi (wajib):');
    if (!reason?.trim()) return;
    if (!await runWorkflow(cascade => pkpStore.unlockPeriodForEdit(currentYear, activePeriodNum, isQuarterMode, undefined, reason.trim(), cascade))) return;
    showToast(`Kunci data ${isQuarterMode ? `Triwulan ${selectedQuarter}` : `Bulan ke-${selectedMonth}`} telah dibuka.`);
  };

  const monthsName = ['', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

  return (
    <div className="space-y-4">
      <PeriodRecapPanel key={`${currentYear}:${selectedCenter}`} year={currentYear} month={selectedMonth} />
      <p className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">DO 2026 masih provisional: skor yang tersedia berasal dari rubrik sumber; kategori dan rekap resmi belum disahkan. Tampilan bulanan dapat memuat observasi YTD berlabel kumulatif, bukan capaian bulan mandiri.</p>
      {editingId && !isQuarterMode && indicators.filter(ind => ind.id === editingId && ind.do2026).map(ind => (
        <Do2026Editor key={`${ind.id}:${currentYear}:${selectedMonth}:${selectedCenter}`}
          indicator={ind} record={pkpStore.getMonthlyRecord(ind.id, selectedMonth)} year={currentYear} month={selectedMonth}
          canEdit={canEdit(ind.id)} onClose={() => setEditingId(null)} />
      ))}
      {error && <p role="alert" className="p-3 bg-rose-50 text-rose-800 rounded-xl">{error}</p>}
      {reportingPolicy && !reportingPolicy.canSubmit && <p role="status" className="p-3 bg-amber-50 text-amber-900 rounded-xl">{reportingPolicy.reason} Verifikasi historis tidak membuktikan kesesuaian aturan PKP 2026.</p>}
      {pending && <p role="status">Menyimpan ke server...</p>}
      {/* Toast Notification */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 text-white px-4 py-3 rounded-xl shadow-2xl border border-slate-700 flex items-center gap-2.5 text-xs animate-slide-in">
          <Sparkles className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{toast}</span>
        </div>
      )}

      {/* ===================== PERIOD VIEW MODE SWITCHER & HEADER ===================== */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 flex items-center justify-center">
            <FileSpreadsheet className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-slate-800">
                {isQuarterMode ? `Tinjauan Capaian Triwulan ${selectedQuarter}` : `Input & Capaian Bulan ${monthsName[selectedMonth]}`}
              </h2>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 font-bold border border-slate-200">
                Tahun {currentYear}
              </span>
            </div>
            <p className="text-xs text-slate-500">
              {isQuarterMode 
                ? 'Mode Triwulanan: Hasil backend mengikuti versi dan basis data. YTD tidak dijumlahkan antarbulan.'
                : 'Mode Bulanan: DO 2026 memakai N/D aktual dan basis periode; data V1 tetap kompatibilitas historis.'}
            </p>
          </div>
        </div>

        {/* Mode Toggle & Selectors */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Toggle Button Group: Bulanan vs Triwulanan */}
          <div className="flex p-1 bg-slate-100 rounded-xl border border-slate-200 text-xs font-semibold">
            <button
              onClick={() => setPeriodViewMode('MONTHLY')}
              className={`px-3 py-1.5 rounded-lg transition-all ${
                periodViewMode === 'MONTHLY'
                  ? 'bg-white text-emerald-700 shadow-sm font-bold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Mode Bulanan
            </button>
            <button
              onClick={() => setPeriodViewMode('QUARTERLY')}
              className={`px-3 py-1.5 rounded-lg transition-all ${
                periodViewMode === 'QUARTERLY'
                  ? 'bg-emerald-600 text-white shadow-sm font-bold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Mode Triwulanan (TW)
            </button>
          </div>

          {/* Triwulan Quick Selector (Only in Quarterly Mode) */}
          {isQuarterMode && (
            <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl border border-slate-200 text-xs font-semibold">
              {[1, 2, 3, 4].map((q) => (
                <button
                  key={q}
                  onClick={() => setSelectedQuarter(q as 1 | 2 | 3 | 4)}
                  className={`px-2.5 py-1 rounded-lg transition-all ${
                    selectedQuarter === q
                      ? 'bg-white text-emerald-700 shadow-xs font-bold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  TW {q}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ===================== WORKFLOW / LOCKING STATUS BANNER ===================== */}
      {lockState.status === 'VERIFIED' && (
        <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-300 flex flex-col md:flex-row md:items-center justify-between gap-3 text-emerald-950">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-700 flex-shrink-0">
              <Lock className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-xs text-emerald-900">
                  PERIODE INI TELAH DIVERIFIKASI & DIKUNCI OLEH DINAS KESEHATAN
                </span>
                <span className="text-[10px] px-2 py-0.2 rounded-full bg-emerald-200 text-emerald-800 font-bold uppercase">
                  Terkunci
                </span>
              </div>
              <p className="text-[11px] text-emerald-800">
                Disahkan oleh <span className="font-semibold">{lockState.verifiedBy}</span> pada {lockState.verifiedAt}. Input dinonaktifkan.
              </p>
            </div>
          </div>

          {isDinkes && (
            <button
              onClick={handleUnlockForEdit}
              disabled={pending || !canManageWorkflow}
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
            <div className="w-9 h-9 rounded-full bg-sky-100 flex items-center justify-center text-sky-700 flex-shrink-0">
              <Clock className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-xs text-sky-900">
                  PERIODE DIAJUKAN KE DINAS KESEHATAN (TERKUNCI SEMENTARA)
                </span>
                <span className="text-[10px] px-2 py-0.2 rounded-full bg-sky-200 text-sky-800 font-bold uppercase">
                  Dalam Proses
                </span>
              </div>
              <p className="text-[11px] text-sky-800">
                Diajukan oleh <span className="font-semibold">{lockState.submittedBy}</span> pada {lockState.submittedAt}.
              </p>
            </div>
          </div>

          {isDinkes ? (
            <div className="flex items-center gap-2 self-start md:self-auto">
              <button
                onClick={() => { if (canManageWorkflow && !pending) setShowRevisionModal(true); }}
                disabled={pending || !canManageWorkflow}
                className="px-3 py-1 rounded-lg bg-white border border-rose-300 text-rose-700 hover:bg-rose-50 text-xs font-bold"
              >
                Minta Revisi
              </button>
              <button
                onClick={handleVerifyByDinkes}
                disabled={pending || !canManageWorkflow || !reportingPolicy?.canVerify}
                className="px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1.5 shadow-xs"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Sahkan & Kunci</span>
              </button>
            </div>
          ) : (
            <span className="text-xs text-sky-700 italic self-start md:self-auto">
              Menunggu verifikasi Dinkes
            </span>
          )}
        </div>
      )}

      {lockState.status === 'REVISION_REQUIRED' && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-300 flex flex-col md:flex-row md:items-center justify-between gap-3 text-rose-950">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-rose-100 flex items-center justify-center text-rose-700 flex-shrink-0">
              <AlertTriangle className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-xs text-rose-900">
                  PERLU REVISI OLEH PUSKESMAS
                </span>
                <span className="text-[10px] px-2 py-0.2 rounded-full bg-rose-200 text-rose-800 font-bold uppercase">
                  Perlu Tindakan
                </span>
              </div>
              <p className="text-[11px] text-rose-800 mt-0.5">
                Catatan Dinkes: <span className="font-semibold italic">"{lockState.revisionNote}"</span>
              </p>
            </div>
          </div>

          {currentUser.role === 'ADMIN_PUSKESMAS' && !isLocked && (
            <button
              onClick={() => setShowSubmitModal(true)}
              disabled={!reportingPolicy?.canSubmit}
              className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1.5 shadow-xs transition-all self-start md:self-auto"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Ajukan Ulang ke Dinkes</span>
            </button>
          )}
        </div>
      )}

      {lockState.status === 'DRAFT' && currentUser.role === 'ADMIN_PUSKESMAS' && !isLocked && (
        <div className="p-3.5 rounded-xl bg-slate-100 border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-slate-800">
          <div className="flex items-center gap-2 text-xs text-slate-600">
            <Lock className="w-4 h-4 text-slate-400" />
            <span>
              Status: <strong>Draft Terbuka</strong> (PIC dapat menginput realisasi bulanan)
            </span>
          </div>

          <button
            onClick={() => setShowSubmitModal(true)}
            disabled={!reportingPolicy?.canSubmit}
            className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1.5 shadow-xs self-start sm:self-auto"
          >
            <Send className="w-3.5 h-3.5" />
            <span>Ajukan Laporan ke Dinkes</span>
          </button>
        </div>
      )}

      {/* ===================== PROVINCIAL SYNC STATUS BAR ===================== */}
      <div className="bg-gradient-to-r from-emerald-900 via-slate-900 to-teal-900 text-white p-4 rounded-2xl shadow-md border border-emerald-700/30 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-emerald-500/20 border border-emerald-400/30 text-emerald-300">
            <Cloud className="w-5 h-5" />
          </div>
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <span className="font-bold text-sm text-white">
                Status Sinkronisasi SIPKP Provinsi Jatim
              </span>
              <span className="px-2 py-0.2 rounded-full bg-emerald-500/30 text-emerald-200 border border-emerald-400/30 text-[10px] font-mono font-bold">
                {isQuarterMode ? `TW ${selectedQuarter}` : monthsName[selectedMonth]} {currentYear}
              </span>
            </div>
            <p className="text-xs text-slate-300">
              Integrasi SIPKP Provinsi belum tersedia. Tidak ada pengiriman dari layar ini.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden sm:block w-36 text-right">
            <div className="text-[10px] text-slate-300 font-mono mb-1 font-bold">
              Integrasi belum tersedia
            </div>
            <p className="text-[10px] text-slate-300">{lastSyncText}</p>
          </div>

          <button
            onClick={handleSyncAll}
            disabled
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 disabled:bg-emerald-800 text-white text-xs font-bold transition-all shadow-md active:scale-98"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isSyncingAll ? 'animate-spin' : ''}`} />
            <span>{isSyncingAll ? 'Menyinkronkan...' : 'Sinkronkan Semua ke Provinsi'}</span>
          </button>
        </div>
      </div>

      {/* ===================== FILTER & SEARCH BAR ===================== */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        {/* Klaster Quick Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0">
          {[
            { id: 0, label: 'Semua Klaster' },
            { id: 1, label: 'K1: Manajemen' },
            { id: 2, label: 'K2: KIA' },
            { id: 3, label: 'K3: Dewasa & Lansia' },
            { id: 4, label: 'K4: P2M & Kesling' },
            { id: 5, label: 'K5: Lintas Klaster' },
          ].map((k) => (
            <button
              key={k.id}
              onClick={() => onSelectKlaster(k.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
                selectedKlaster === k.id
                  ? 'bg-slate-900 text-white shadow-sm'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-800'
              }`}
            >
              {k.label}
            </button>
          ))}
        </div>

        {/* Search Field */}
        <div className="relative min-w-[280px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Cari kode, indikator, atau sub-klaster..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:bg-white transition-colors"
          />
        </div>
      </div>

      {/* ===================== MAIN TABLE ===================== */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-3 bg-slate-50 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 text-slate-700 font-semibold">
            <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
            <span>
              Menampilkan {filtered.length} Elemen Penilaian ({isQuarterMode ? `Periode Triwulan ${selectedQuarter}` : `Bulan ke-${selectedMonth}`})
            </span>
          </div>
          <div className="flex items-center gap-3 text-[11px] text-slate-500">
            <span className="flex items-center gap-1 font-semibold text-slate-700">
              <Lock className="w-3.5 h-3.5 text-slate-500" />
              <span>Head Penilaian: Terkunci (Agregasi Child)</span>
            </span>
            <span className="hidden md:inline">•</span>
            <span className="hidden md:inline text-emerald-700 font-medium">
              {isQuarterMode ? 'Kumulatif YTD Januari - Akhir Triwulan' : 'Child Elemen: Input Numerator Realisasi'}
            </span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-100 border-b border-slate-300 text-slate-700 font-bold uppercase text-[10px] tracking-wider">
                <th className="py-2.5 px-3 w-16 text-center border-r border-slate-200">No / Kode</th>
                <th className="py-2.5 px-3 min-w-[260px] border-r border-slate-200">Kegiatan & Indikator Kinerja</th>
                <th className="py-2.5 px-2.5 w-20 border-r border-slate-200">Target DO</th>
                <th className="py-2.5 px-2.5 w-20 border-r border-slate-200">Satuan</th>
                <th className="py-2.5 px-2.5 w-24 text-right border-r border-slate-200">
                  {isQuarterMode ? 'Total Sas. TW' : 'Tot. Sasaran'}
                </th>
                <th className="py-2.5 px-2.5 w-24 text-right border-r border-slate-200">
                  {isQuarterMode ? 'Target Sas. TW' : 'Tgt. Sasaran'}
                </th>
                <th className="py-2.5 px-3 w-32 text-right border-r border-slate-200 bg-emerald-50 text-emerald-950 font-black">
                  {isQuarterMode ? 'Kumulatif YTD' : 'Realisasi Bln'}
                </th>
                <th className="py-2.5 px-2.5 w-24 text-right border-r border-slate-200">Capaian Riil</th>
                <th className="py-2.5 px-2.5 w-28 text-center border-r border-slate-200">Nilai Kinerja</th>
                <th className="py-2.5 px-3 w-36 border-r border-slate-200">PIC Program</th>
                <th className="py-2.5 px-2.5 w-32 text-center">Sinkronisasi Jatim</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {groupedSections.map((sec) => {
                const isCollapsed = collapsedSections[sec.sectionCode];

                const monthlyAgg = pkpStore.getSubKlasterAggregation(sec.sectionCode, selectedMonth);
                const quarterRow = isQuarterMode ? quarterRows?.find(row => row.no === sec.sectionCode && !row.isKlasterHead) : undefined;
                const agg = { ...monthlyAgg, averageScore: isQuarterMode ? quarterRow?.nilaiKelompok ?? null : monthlyAgg.averageScore };
                const provisional = sec.items.some(ind => (isQuarterMode ? pkpStore.getQuarterlyRecord(ind.id, selectedQuarter) : pkpStore.getMonthlyRecord(ind.id, selectedMonth)).scoringVersion === 'DO_2026_V2');

                return (
                  <React.Fragment key={`group-${sec.sectionCode}`}>
                    {/* ==================== HEAD PENILAIAN ROW ==================== */}
                    <tr className="bg-slate-50 font-bold hover:bg-slate-100 transition-colors border-y border-slate-300">
                      <td className="py-2.5 px-3 text-center align-middle border-r border-slate-200">
                        <button
                          onClick={() => toggleSection(sec.sectionCode)}
                          className="inline-flex items-center gap-1 font-mono text-[11px] text-purple-700 bg-purple-50 hover:bg-purple-100 px-1.5 py-0.5 rounded border border-purple-200 transition-colors"
                        >
                          {isCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                          <span>HEAD {sec.sectionCode}</span>
                        </button>
                      </td>

                      <td className="py-2.5 px-3 align-middle">
                        <div 
                          role="button" tabIndex={0} aria-label={`Rincian head ${sec.sectionCode}`}
                          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleOpenHeadDrawer(sec); } }}
                          onClick={() => handleOpenHeadDrawer(sec)}
                          className="cursor-pointer group/head"
                          title="Klik untuk membuka rincian agregasi Head Penilaian"
                        >
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-slate-900 text-xs group-hover/head:text-purple-700 transition-colors">
                              {sec.sectionName}
                            </span>
                            <span className="text-[10px] text-purple-700 font-semibold bg-purple-50 px-2 py-0.5 rounded border border-purple-200">
                              {agg.childCount} Child Elemen
                            </span>
                          </div>
                          <p className="text-[10px] text-slate-500 font-normal mt-0.5">
                            Nilai dihitung otomatis dari rata-rata {agg.childCount} child elemen
                          </p>
                        </div>
                      </td>

                      <td className="py-2.5 px-3 text-slate-700 align-middle font-mono text-[11px]">100%</td>
                      <td className="py-2.5 px-3 text-slate-500 align-middle text-[11px]">Rerata</td>
                      <td className="py-2.5 px-3 text-right text-slate-400 align-middle font-mono">—</td>
                      <td className="py-2.5 px-3 text-right text-slate-400 align-middle font-mono">—</td>

                      <td 
                        onClick={() => handleHeadPenilaianClick(sec.sectionName, agg.childCount)}
                        className="py-2.5 px-3 text-right bg-slate-200/70 border-x border-slate-300 align-middle cursor-not-allowed"
                        title="Head penilaian tidak bisa diisi secara manual karena nilainya dari child"
                      >
                        <div className="flex items-center justify-end gap-1 text-slate-600 font-mono text-[11px]">
                          <Lock className="w-3.5 h-3.5 text-slate-500" />
                          <span className="text-[10px] font-sans font-bold text-slate-700">Auto Child</span>
                        </div>
                      </td>

                      <td className="py-2.5 px-3 text-right font-mono text-slate-800 align-middle font-bold">
                         {agg.averageCapaian == null ? '-' : `${agg.averageCapaian}%`}
                      </td>

                      <td className="py-2.5 px-3 text-center align-middle">
                         {agg.averageScore == null ? '-' : <ScoreBadge score={agg.averageScore} size="sm" provisional={provisional} />}
                      </td>

                      <td className="py-2.5 px-3 align-middle text-[11px] text-slate-600">
                        <span className="font-semibold text-slate-700">Koordinator Klaster</span>
                      </td>

                      <td className="py-2.5 px-3 text-center align-middle">
                        <span className="text-[10px] text-slate-500">Integrasi belum tersedia</span>
                      </td>
                    </tr>

                    {/* ==================== CHILD ELEMENTS ==================== */}
                    {!isCollapsed && sec.items.map((ind) => {
                      const rec = isQuarterMode
                        ? pkpStore.getQuarterlyRecord(ind.id, selectedQuarter)
                        : pkpStore.getMonthlyRecord(ind.id, selectedMonth);

                      const target = annualTargets[ind.id];
                      const usesDo = rec.scoringVersion === 'DO_2026_V2' || (rec.pencapaianRiil == null && Boolean(ind.do2026));

                      const fraction = isQuarterMode ? selectedQuarter / 4 : 1 / 12;
                      const periodTotalSasaran = usesDo ? rec.totalSasaran : target?.totalSasaran == null ? null : target.totalSasaran * fraction;
                      const periodTargetSasaran = usesDo ? rec.targetSasaran : target?.targetSasaran == null ? null : target.targetSasaran * fraction;

                      const pic = pkpStore.getPicForIndicator(ind.id);
                      const isEditing = editingId === ind.id && canEdit(ind.id);
                      const officialCode = indicatorDisplayCode(ind);

                      return (
                        <tr 
                          key={ind.id} 
                          className="hover:bg-emerald-50/40 transition-colors group"
                        >
                          {/* Kode Resmi */}
                          <td className="py-2 px-3 text-center align-middle border-r border-slate-200 font-mono text-[11px] text-slate-600">
                            <span className="font-bold text-slate-800">{officialCode}</span>
                          </td>

                          {/* Kegiatan & Indikator */}
                          <td className="py-2 px-3 align-middle border-r border-slate-200">
                            <div 
                              role="button" tabIndex={0} aria-label={`Rincian indikator ${officialCode}`}
                              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenDrawer(ind); } }}
                              onClick={() => onOpenDrawer(ind)}
                              className="cursor-pointer"
                              title="Klik untuk membuka drawer rincian & bukti dukung"
                            >
                              <p className="font-bold text-slate-900 group-hover:text-emerald-700 transition-colors line-clamp-1">
                                {ind.indikator}
                              </p>
                              <div className="flex items-center gap-2 mt-0.5">
                                <span className="text-[11px] text-slate-500 line-clamp-1">{ind.kegiatan}</span>
                                {!usesDo && <PolarityBadge polarity={ind.polarity} targetDisplay={ind.targetDisplay} />}
                              </div>
                              <p className="mt-1 text-[10px] text-slate-500">
                                {usesDo ? `DO_2026_V2 · ${rec.inputBasis === 'YTD_ACTUAL' ? 'Kumulatif YTD' : rec.inputBasis === 'PERIOD_ACTUAL' ? 'Aktual periode' : 'Basis belum tersedia'}` : `${rec.scoringVersion ?? 'ILP_2026_V1'} · kompatibilitas historis`}
                              </p>
                              <p className="mt-1 text-[11px] font-medium text-emerald-700">Lihat definisi operasional →</p>
                            </div>
                          </td>

                          {/* Target % */}
                          <td className="py-2 px-2.5 align-middle border-r border-slate-200 font-mono text-slate-600">
                            {usesDo ? ind.do2026?.targetDisplay ?? '-' : ind.targetDisplay}
                          </td>

                          {/* Satuan */}
                          <td className="py-2 px-2.5 align-middle border-r border-slate-200 text-slate-500">
                            {usesDo ? ind.do2026?.denominatorLabel ?? '-' : ind.satuan}
                          </td>

                          {/* Total Sasaran */}
                          <td className="py-2 px-2.5 text-right align-middle border-r border-slate-200 font-mono text-slate-600">
                            {periodTotalSasaran?.toFixed(1) ?? '-'}
                            {usesDo && rec.effectiveDenominator != null && rec.effectiveDenominator !== periodTotalSasaran && <p className="text-[10px] font-sans">D efektif: {rec.effectiveDenominator}</p>}
                          </td>

                          {/* Target Sasaran */}
                          <td className="py-2 px-2.5 text-right align-middle border-r border-slate-200 font-mono text-slate-900 font-semibold">
                            {periodTargetSasaran?.toFixed(1) ?? '-'}
                          </td>

                          {/* REALISASI CELL */}
                          <td 
                            role="button" tabIndex={canEdit(ind.id) ? 0 : -1} aria-disabled={!canEdit(ind.id) || pending}
                            aria-label={`Edit realisasi ${officialCode}`}
                            onKeyDown={e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); handleStartEdit(ind, rec.pencapaianRiil); } }}
                            onClick={() => handleStartEdit(ind, rec.pencapaianRiil)}
                            className={`py-2 px-3 text-right align-middle border-r border-slate-200 transition-colors ${
                              !canEdit(ind.id)
                                ? 'bg-slate-100/80 cursor-not-allowed' 
                                : isQuarterMode 
                                ? 'bg-sky-50/50 cursor-pointer' 
                                : 'bg-emerald-50/60 hover:bg-emerald-100/70 cursor-pointer'
                            }`}
                            title={
                              isLocked 
                                ? `Terkunci (${lockState.status})` 
                                : isQuarterMode 
                                ? 'Hasil triwulan sesuai versi dan basis data. Beralih ke Mode Bulanan untuk mengedit.'
                                : 'Klik untuk edit nilai'
                            }
                          >
                            {isEditing && !ind.do2026 ? (
                              <div className="flex items-center justify-end gap-1">
                                <input
                                  aria-label={`Realisasi ${officialCode}`}
                                  disabled={pending}
                                  type="number"
                                  value={tempValue}
                                  onChange={(e) => setTempValue(e.target.value)}
                                  onKeyDown={(e) => handleKeyDown(e, ind)}
                                  className="w-18 text-right px-1.5 py-0.5 border-2 border-emerald-500 rounded bg-white text-xs font-mono font-bold focus:outline-none"
                                  autoFocus
                                />
                                <button
                                  aria-label={`Simpan realisasi ${officialCode}`}
                                  disabled={pending}
                                  onClick={() => handleCommitEdit(ind)}
                                  className="p-1 bg-emerald-600 text-white rounded hover:bg-emerald-700"
                                  title="Simpan"
                                >
                                  <Check className="w-3 h-3" />
                                </button>
                              </div>
                            ) : (
                              <div className="flex items-center justify-end gap-1">
                                {isLocked && <Lock className="w-3 h-3 text-slate-400" />}
                                <span className="font-mono font-bold text-slate-900 group-hover:text-emerald-700">
                                  {rec.pencapaianRiil ?? '-'}{(rec as typeof rec & { isMissing?: boolean }).isMissing ? ' (Belum diisi)' : ''}
                                </span>
                                <span className="text-[10px] text-slate-400 font-sans ml-1 font-normal">
                                  {usesDo ? 'N aktual' : ind.satuan}
                                </span>
                              </div>
                            )}
                          </td>

                          {/* Capaian Riil % */}
                          <td className="py-2 px-2.5 text-right font-mono text-slate-700 align-middle text-[11px]">
                            {usesDo ? measurementText(rec.measurementValue, rec.measurementUnit) : rec.capaianRiilPct == null ? '-' : `${rec.capaianRiilPct}%`}
                          </td>

                          {/* Nilai Kinerja */}
                          <td className="py-2 px-2.5 text-center align-middle border-r border-slate-200">
                            {usesDo && rec.targetMet != null && <p className="text-[10px] text-slate-600">{rec.targetMet ? 'Target tercapai' : 'Target belum tercapai'}</p>}
                            {rec.nilaiKinerja == null ? <span className="text-[11px] text-slate-500">{rec.reason ?? (usesDo ? ind.do2026?.reason ?? 'Belum dinilai' : '-')}</span> : <ScoreBadge score={rec.nilaiKinerja} size="sm" provisional={usesDo} />}
                          </td>

                          {/* PIC Pengelola */}
                          <td className="py-2 px-3 align-middle border-r border-slate-200">
                            <div className="flex items-center gap-1.5">
                              <span className={`w-2 h-2 rounded-full ${pic?.avatarColor ?? 'bg-slate-300'}`} />
                              <span className="text-slate-700 font-medium truncate max-w-[100px] text-[11px]" title={pic?.name}>
                                {pic?.name.split(',')[0] ?? 'Belum ditugaskan'}
                              </span>
                            </div>
                          </td>

                          {/* Sinkronisasi Jatim */}
                          <td className="py-2 px-2.5 text-center align-middle" onClick={(e) => e.stopPropagation()}>
                            <span className="text-[10px] font-semibold text-slate-600">{epSyncStatus(rec.syncStatus)}</span>
                            <p className="mt-1 text-[10px] text-slate-500">{lastSyncText}</p>
                          </td>
                        </tr>
                      );
                    })}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ===================== SUBMISSION MODAL ===================== */}
      {showSubmitModal && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div role="dialog" aria-modal="true" aria-label="Ajukan laporan ke Dinkes" className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200">
            <div className="w-12 h-12 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center mb-4">
              <Send className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-bold text-slate-900">
              Ajukan Laporan {isQuarterMode ? `Triwulan ${selectedQuarter}` : `Bulan ke-${selectedMonth}`} ke Dinas Kesehatan?
            </h3>
            <p className="text-xs text-slate-600 mt-2 leading-relaxed">
              Seluruh data capaian pada periode ini akan diajukan ke Dinas Kesehatan dan statusnya berubah menjadi <strong>Terkunci Sementara</strong> untuk mencegah perubahan sepihak selama proses supervisi.
            </p>

            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                onClick={() => setShowSubmitModal(false)}
                className="px-4 py-2 rounded-xl border border-slate-300 text-slate-700 text-xs font-semibold hover:bg-slate-50"
              >
                Batal
              </button>
              <button
                onClick={handleSubmitToDinkes}
                disabled={pending || isLocked || currentUser.role !== 'ADMIN_PUSKESMAS'}
                className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-sm transition-all"
              >
                Ya, Ajukan & Kunci Data
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===================== REVISION MODAL (DINKES) ===================== */}
      {showRevisionModal && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div role="dialog" aria-modal="true" aria-label="Kembalikan untuk revisi" className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200">
            <div className="w-12 h-12 rounded-xl bg-rose-100 text-rose-700 flex items-center justify-center mb-4">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-bold text-slate-900">
              Kembalikan untuk Revisi
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              Tuliskan alasan pengembalian agar Puskesmas dapat memperbaiki data capaian yang dimaksud.
            </p>

            <div className="mt-4">
              <textarea
                aria-label="Catatan revisi"
                disabled={pending}
                value={revisionNoteInput}
                onChange={(e) => setRevisionNoteInput(e.target.value)}
                placeholder="Tuliskan catatan perbaikan..."
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
                disabled={pending || !canManageWorkflow || !revisionNoteInput.trim()}
                className="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-xs font-bold shadow-sm"
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
