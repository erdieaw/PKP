import React from 'react';
import { 
  LayoutDashboard, 
  Users, 
  ClipboardPen, 
  Target, 
  UserCheck, 
  MessageSquareCheck,
  Building2,
  FileSpreadsheet,
  Trophy,
  CalendarDays,
  UserPlus,
  Printer,
  FileCheck2,
  CalendarRange,
  X
} from 'lucide-react';
import { pkpStore } from '../../services/apiStore';
import { UserRole } from '../../types/pkp';
import { AppLogo } from '../common/AppLogo';

export type NavTab = 
  | 'dashboard-exec' 
  | 'official-sheet7'
  | 'dashboard-annual'
  | 'dashboard-pic' 
  | 'data-entry' 
  | 'target-setting' 
  | 'pic-matrix' 
  | 'recommendations'
  | 'dinkes-supervision'
  | 'master-data';

interface SidebarProps {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  selectedKlaster: number;
  onSelectKlaster: (klasterId: number) => void;
  isDinkesMode: boolean;
  userRole: UserRole;
  globalMode: boolean;
  busy: boolean;
  selectedPuskesmas: string;
  onClose: () => void;
  onOpenYearModal: () => void;
  onOpenStaffModal: () => void;
  onOpenExportModal: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onSelectTab,
  selectedKlaster,
  onSelectKlaster,
  isDinkesMode,
  userRole,
  globalMode,
  busy,
  selectedPuskesmas,
  onClose,
  onOpenYearModal,
  onOpenStaffModal,
  onOpenExportModal
}) => {
  const currentYear = pkpStore.getCurrentYear();

  const navItems = userRole === 'PIC' ? [
    { id: 'dashboard-pic' as NavTab, label: 'Indikator Saya', icon: ClipboardPen },
    { id: 'recommendations' as NavTab, label: 'Rekomendasi & RTL', icon: MessageSquareCheck },
  ] : [
    { id: 'dashboard-exec' as NavTab, label: 'Dashboard Kinerja PKP', icon: LayoutDashboard },
    { id: 'official-sheet7' as NavTab, label: 'Rekap Kinerja (Sheet 7)', icon: FileCheck2 },
    { id: 'dashboard-annual' as NavTab, label: 'Dashboard Tahunan (12 Bln)', icon: CalendarRange },
    { id: 'dashboard-pic' as NavTab, label: 'Dashboard PIC & Kepatuhan', icon: Users },
    { id: 'data-entry' as NavTab, label: 'Input Capaian Bulanan', icon: ClipboardPen },
    { id: 'target-setting' as NavTab, label: 'Target Sasaran Tahunan', icon: Target },
    { id: 'pic-matrix' as NavTab, label: 'Setting / Penugasan PIC', icon: UserCheck },
    { id: 'recommendations' as NavTab, label: 'Rekomendasi Dinkes & RTL', icon: MessageSquareCheck },
    { id: 'master-data' as NavTab, label: 'Pusat Data Master (CRUD)', icon: Building2 },
    ...(isDinkesMode ? [{ id: 'dinkes-supervision' as NavTab, label: 'Supervisi Se-Wilayah (Ranking)', icon: Trophy }] : [])
  ];

  const allIndicators = pkpStore.getIndicators();
  const klasters = [
    { id: 0, label: `Semua Klaster (${allIndicators.length})` },
    { id: 1, label: `Klaster 1: Manajemen (${allIndicators.filter(i => i.klasterId === 1).length})` },
    { id: 2, label: `Klaster 2: KIA (${allIndicators.filter(i => i.klasterId === 2).length})` },
    { id: 3, label: `Klaster 3: Dewasa & Lansia (${allIndicators.filter(i => i.klasterId === 3).length})` },
    { id: 4, label: `Klaster 4: P2M & Kesling (${allIndicators.filter(i => i.klasterId === 4).length})` },
    { id: 5, label: `Klaster 5: Lintas Klaster (${allIndicators.filter(i => i.klasterId === 5).length})` },
  ];

  return (
    <aside className="w-72 min-w-[288px] max-w-[288px] bg-gradient-to-b from-obsidian-950 via-obsidian-900 to-obsidian-950 text-slate-300 flex flex-col flex-shrink-0 h-screen sticky top-0 border-r border-obsidian-800/80 shadow-2xl relative z-20 overflow-hidden">
      {/* Brand Header with AppLogo */}
      <div className="p-4 border-b border-obsidian-800/80 bg-obsidian-950/60 backdrop-blur-md">
        <button type="button" onClick={onClose} aria-label="Tutup navigasi" className="md:hidden absolute top-3 right-3 p-2 rounded-lg hover:bg-slate-800"><X className="w-4 h-4" /></button>
        <AppLogo variant="compact" size="md" />

        {/* Live System Badge */}
        <div className="mt-3 flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-obsidian-850/90 border border-obsidian-700/60 text-[10px]">
          <div className="flex items-center gap-1.5">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
            <span className="text-slate-300 font-medium">
              {isDinkesMode ? 'Mode Dinas Kesehatan' : selectedPuskesmas}
            </span>
          </div>
          <span className="font-mono text-emerald-400 font-bold bg-emerald-950/80 px-1.5 py-0.5 rounded border border-emerald-500/30">
            v2.6 ILP
          </span>
        </div>
      </div>

      {/* Main Navigation */}
      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-5 scrollbar-thin">
        <div>
          <p className="px-3 text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">
            Menu Operasional
          </p>
          <nav className="space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  disabled={busy || (globalMode && item.id !== 'master-data')}
                  title={globalMode && item.id !== 'master-data' ? 'Pilih Puskesmas dan tahun pelaporan terlebih dahulu' : undefined}
                  onClick={() => onSelectTab(item.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-semibold transition-all relative disabled:opacity-40 disabled:cursor-not-allowed ${
                    isActive
                      ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-lg shadow-emerald-950/50 border border-emerald-400/30 before:absolute before:left-0 before:top-2 before:bottom-2 before:w-1 before:rounded-r-full before:bg-cyan-300'
                      : 'text-slate-400 hover:bg-obsidian-800/70 hover:text-white'
                  }`}
                >
                  <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Action Utilities (Year, Staff, Export) */}
        {userRole !== 'PIC' && <div className="pt-2 border-t border-slate-800">
          <p className="px-3 text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">
            Utilitas & Konfigurasi
          </p>
          <div className="space-y-1">
            {userRole === 'DINKES_ADMIN' && <button
              onClick={onOpenYearModal}
              disabled={busy}
              className="w-full flex items-center gap-3 px-3 py-1.5 rounded-lg text-xs text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
            >
              <CalendarDays className="w-4 h-4 text-emerald-400" />
              <span>Kelola Periode Tahun</span>
            </button>}
            <button
              onClick={onOpenStaffModal}
              disabled={busy || globalMode}
              className="w-full flex items-center gap-3 px-3 py-1.5 rounded-lg text-xs text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
            >
              <UserPlus className="w-4 h-4 text-teal-400" />
              <span>{isDinkesMode ? 'Direktori PIC Wilayah' : 'Staf PIC Puskesmas'}</span>
            </button>
            <button
              onClick={onOpenExportModal}
              disabled={busy || globalMode}
              className="w-full flex items-center gap-3 px-3 py-1.5 rounded-lg text-xs text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
            >
              <Printer className="w-4 h-4 text-indigo-400" />
              <span>Ekspor & Cetak Laporan</span>
            </button>
          </div>
        </div>}

        {/* Klaster Filter Quick Selector (When on data-entry) */}
        {activeTab === 'data-entry' && (
          <div className="pt-2 border-t border-slate-800">
            <p className="px-3 text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2 flex items-center justify-between">
              <span>Filter Klaster</span>
              <span className="text-[10px] font-mono text-emerald-400 font-semibold">ILP</span>
            </p>
            <div className="space-y-1">
              {klasters.map((k) => (
                <button
                  key={k.id}
                  onClick={() => onSelectKlaster(k.id)}
                  className={`w-full text-left px-3 py-1.5 rounded text-xs transition-colors truncate ${
                    selectedKlaster === k.id
                      ? 'bg-slate-800 text-emerald-400 font-semibold border-l-2 border-emerald-400'
                      : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
                  }`}
                >
                  {k.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Provincial Link Info */}
        {userRole !== 'PIC' && <div className="p-3 bg-obsidian-850/80 rounded-xl border border-obsidian-700/60 text-xs shadow-inner">
          <div className="flex items-center gap-2 text-emerald-400 font-bold mb-1">
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span className="text-[11px] tracking-wide">Integritas Kode Provinsi</span>
          </div>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            Katalog {allIndicators.length} indikator dari server SIPKP untuk periode terpilih.
          </p>
        </div>}
      </div>

      {/* Footer / Status */}
      <div className="p-3.5 border-t border-obsidian-800/80 bg-obsidian-950/80 text-[11px] text-slate-400 flex items-center justify-between">
        <span className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-sm shadow-emerald-400" />
          <span className="font-medium text-slate-300">TLS 1.3 Terenkripsi</span>
        </span>
        <span className="font-mono text-[10px] text-emerald-400 bg-emerald-950/80 px-1.5 py-0.5 rounded border border-emerald-500/30">TA {currentYear}</span>
      </div>
    </aside>
  );
};
