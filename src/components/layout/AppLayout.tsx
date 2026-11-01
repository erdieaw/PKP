import React, { useState, useEffect, useRef, useSyncExternalStore } from 'react';
import { Sidebar, NavTab } from './Sidebar';
import { Header } from './Header';
import { ExecutiveDashboard } from '../dashboard/ExecutiveDashboard';
import { PicDashboard } from '../dashboard/PicDashboard';
import { MonthlyDataGrid } from '../data-entry/MonthlyDataGrid';
import { TargetSettingView } from '../data-entry/TargetSettingView';
import { PicAssignmentView } from '../pic-management/PicAssignmentModal';
import { RecommendationView } from '../recommendation/RecommendationView';
import { IndicatorDetailDrawer } from '../recommendation/IndicatorDetailDrawer';
import { DinkesSupervisionView } from '../dinkes/DinkesSupervisionView';
import { YearPeriodModal } from '../year-management/YearPeriodModal';
import { StaffManagementModal } from '../pic-management/StaffManagementModal';
import { ExportReportModal } from '../export/ExportReportModal';
import { MasterDataHub } from '../master-data/MasterDataHub';
import { ChangePasswordModal } from '../auth/ChangePasswordModal';
import { OfficialPerformanceSheet7 } from '../official-sheet7/OfficialPerformanceSheet7';
import { AnnualTrendDashboard } from '../dashboard/AnnualTrendDashboard';
import { OfficialIndicator, AuthUser } from '../../types/pkp';
import { pkpStore } from '../../services/apiStore';
import { OperatingModeNotice } from '../common/OperatingModeNotice';
import { confirmDiscardChanges } from '../common/useUnsavedChanges';

interface AppLayoutProps {
  currentUser: AuthUser;
  onLogout: () => void;
}

export function AppLayout(props: AppLayoutProps) {
  useSyncExternalStore(pkpStore.subscribe, pkpStore.getSnapshot, pkpStore.getServerSnapshot);
  const [activeTab, setActiveTab] = useState<NavTab>(props.currentUser.role === 'PIC' ? 'dashboard-pic' : 'dashboard-exec');
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);
  const scopeKey = `${props.currentUser.id}:${pkpStore.getSelectedHealthCenterId()}:${pkpStore.getCurrentYear()}`;
  return <ScopedLayout key={scopeKey} {...props} activeTab={activeTab} setActiveTab={setActiveTab}
    selectedMonth={selectedMonth} setSelectedMonth={setSelectedMonth} />;
}

interface ScopedLayoutProps extends AppLayoutProps {
  activeTab: NavTab;
  setActiveTab: (tab: NavTab) => void;
  selectedMonth: number;
  setSelectedMonth: (month: number) => void;
}

const ScopedLayout: React.FC<ScopedLayoutProps> = ({ currentUser, onLogout, activeTab, setActiveTab, selectedMonth, setSelectedMonth }) => {
  const globalMode = !pkpStore.getSelectedHealthCenterId() || !pkpStore.getYears().some(period => period.year === pkpStore.getCurrentYear());
  const [selectedKlaster, setSelectedKlaster] = useState<number>(0); // 0 = Semua
  const selectedPuskesmas = pkpStore.getSelectedHealthCenter()?.name || '';
  const userRole = currentUser.role;
  const canManage = userRole !== 'PIC';
  const load = pkpStore.getLoadState();
  const blocked = load.loading || !!load.error;
  const busy = blocked || pkpStore.isMutating();
  const hasRendered = useRef(false);
  // Scope identity remounts this instance; refreshes retain its loaded views and drafts.
  if (!blocked) hasRendered.current = true;
  const showContent = hasRendered.current;
  const visibleTab = globalMode && canManage ? 'master-data' : activeTab;
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [notice, setNotice] = useState('');

  const isDinkesMode = userRole === 'DINKES_ADMIN';
  
  // Modals & Drawers state
  const [selectedIndicatorForDrawer, setSelectedIndicatorForDrawer] = useState<OfficialIndicator | null>(null);
  const [drawerQuarter, setDrawerQuarter] = useState<1 | 2 | 3 | 4 | undefined>();
  const openDrawer = (indicator: OfficialIndicator, quarter?: 1 | 2 | 3 | 4) => {
    if (busy || !confirmDiscardChanges('indicator-drawer')) return;
    setSelectedIndicatorForDrawer(indicator);
    setDrawerQuarter(quarter);
  };
  const [isYearModalOpen, setIsYearModalOpen] = useState<boolean>(false);
  const [isStaffModalOpen, setIsStaffModalOpen] = useState<boolean>(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState<boolean>(false);
  const [isChangePasswordOpen, setIsChangePasswordOpen] = useState<boolean>(false);

  useEffect(() => {
    const receive = (event: Event) => {
      const detail = (event as CustomEvent<string | { message?: string }>).detail;
      setNotice(typeof detail === 'string' ? detail : detail?.message || 'Operasi tidak dapat diselesaikan.');
    };
    window.addEventListener('sipkp-notice', receive);
    return () => window.removeEventListener('sipkp-notice', receive);
  }, []);

  const handleNavigateToDataEntry = (klasterId: number) => {
    if (busy || !confirmDiscardChanges()) return;
    setSelectedKlaster(klasterId);
    setActiveTab('data-entry');
  };

  const handleSelectPuskesmasFromDinkes = (selection: string) => {
    if (busy || !confirmDiscardChanges()) return;
    // The supervision view currently emits a name; scope mutations always use IDs.
    const centers = pkpStore.getPuskesmasList();
    const matches = centers.filter(center => center.id === selection || center.name === selection);
    if (matches.length !== 1) {
      setNotice('Puskesmas tidak ditemukan atau nama tidak unik. Pilih melalui daftar Puskesmas di header.');
      return;
    }
    void pkpStore.selectHealthCenter(matches[0].id).catch(reason => setNotice(reason instanceof Error ? reason.message : 'Puskesmas tidak dapat dimuat.'));
  };

  const retry = () => {
    const operation = globalMode ? pkpStore.initialize(currentUser) : pkpStore.refreshScope();
    void operation.catch(reason => setNotice(reason instanceof Error ? reason.message : 'Data tidak dapat dimuat.'));
  };

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      {/* Sidebar */}
      {navigationOpen && <button aria-label="Tutup navigasi" onClick={() => setNavigationOpen(false)} className="fixed inset-0 z-30 bg-slate-900/60 md:hidden" />}
      <div className={`${navigationOpen ? 'fixed inset-y-0 left-0 z-40' : 'hidden'} md:relative md:block md:z-20`}>
      <Sidebar
        activeTab={visibleTab}
        onSelectTab={tab => {
          if (globalMode && tab !== 'master-data') setNotice('Buat atau pilih Puskesmas dan tahun pelaporan terlebih dahulu.');
          else if (!busy && confirmDiscardChanges()) setActiveTab(tab);
          setNavigationOpen(false);
        }}
        selectedKlaster={selectedKlaster}
        onSelectKlaster={id => { if (!busy && confirmDiscardChanges('monthly-grid')) setSelectedKlaster(id); }}
        isDinkesMode={isDinkesMode}
        userRole={userRole}
        globalMode={globalMode}
        busy={busy}
        selectedPuskesmas={selectedPuskesmas}
        onClose={() => setNavigationOpen(false)}
        onOpenYearModal={() => { if (!busy && canManage) setIsYearModalOpen(true); setNavigationOpen(false); }}
        onOpenStaffModal={() => { if (!busy && !globalMode && canManage) setIsStaffModalOpen(true); setNavigationOpen(false); }}
        onOpenExportModal={() => { if (!busy && !globalMode && canManage) setIsExportModalOpen(true); setNavigationOpen(false); }}
      />
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        {/* Top Header */}
        <Header
          selectedMonth={selectedMonth}
          onSelectMonth={month => { if (month !== selectedMonth && !busy && confirmDiscardChanges()) setSelectedMonth(month); }}
          selectedPuskesmas={selectedPuskesmas}
          onSelectPuskesmas={async id => { if (!busy && id !== pkpStore.getSelectedHealthCenterId() && confirmDiscardChanges()) await pkpStore.selectHealthCenter(id); }}
          onSelectYear={async year => { if (!busy && year !== pkpStore.getCurrentYear() && confirmDiscardChanges()) await pkpStore.setCurrentYear(year); }}
          busy={busy}
          globalMode={globalMode}
          onOpenNavigation={() => setNavigationOpen(true)}
          currentUser={currentUser}
          onOpenYearModal={() => setIsYearModalOpen(true)}
          onOpenExportModal={() => setIsExportModalOpen(true)}
          onOpenChangePassword={() => setIsChangePasswordOpen(true)}
          onLogout={() => { if (!pkpStore.isMutating() && confirmDiscardChanges()) onLogout(); }}
        />
        {notice && <div role="alert" className="px-4 py-3 bg-amber-50 text-amber-900 text-sm flex justify-between gap-2">{notice}<button onClick={() => setNotice('')}>Tutup</button></div>}
        {globalMode && <div role="status" className="px-4 py-3 bg-emerald-50 text-emerald-900 text-sm">{userRole === 'DINKES_ADMIN' ? 'Siapkan Puskesmas melalui Pusat Data Master. Buat dan tetapkan tahun aktif melalui Kelola Periode Tahun. Pilihan tahun di header hanya mengubah tampilan data.' : 'Periode pelaporan belum tersedia. Hubungi Dinkes untuk menyiapkan dan menetapkan tahun aktif; penugasan PIC dikelola Puskesmas.'}</div>}
        {showContent && load.error && <div role="alert" className="px-4 py-3 bg-rose-50 text-rose-900 text-sm flex justify-between gap-3"><span>{load.error.message} Data terakhir tetap ditampilkan.</span><button disabled={pkpStore.isMutating()} onClick={retry} className="font-bold shrink-0">Coba Lagi</button></div>}

        {/* Scrollable View Container */}
        <main aria-busy={busy} className="relative flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-6 bg-slate-50">
          {!showContent && <div className="max-w-md mx-auto py-16 space-y-4 text-center text-slate-700" role={load.error ? 'alert' : 'status'}>
            <p>{load.error?.message || 'Memuat data Puskesmas dan tahun terpilih...'}</p>
            {load.error && <button className="px-4 py-2 rounded-xl bg-emerald-600 text-white" onClick={retry}>Coba Lagi</button>}
          </div>}
          {showContent && <div inert={busy} className="w-full max-w-7xl mx-auto">
            {!globalMode && <OperatingModeNotice />}
            {visibleTab === 'dashboard-exec' && (
              <ExecutiveDashboard
                selectedMonth={selectedMonth}
                onNavigateToDataEntry={handleNavigateToDataEntry}
                onNavigateToPicDashboard={() => { if (!busy && confirmDiscardChanges()) setActiveTab('dashboard-pic'); }}
              />
            )}

            {visibleTab === 'official-sheet7' && (
              <OfficialPerformanceSheet7 />
            )}

            {visibleTab === 'dashboard-annual' && (
              <AnnualTrendDashboard
                onNavigateToMonth={(m) => {
                  if (busy || !confirmDiscardChanges()) return;
                  setSelectedMonth(m);
                  setActiveTab('data-entry');
                }}
                 onOpenDrawer={ind => openDrawer(ind)}
              />
            )}

            {visibleTab === 'dashboard-pic' && !globalMode && (
              <PicDashboard selectedMonth={selectedMonth} onOpenDrawer={ind => openDrawer(ind)} />
            )}

            {visibleTab === 'data-entry' && (
              <MonthlyDataGrid
                selectedMonth={selectedMonth}
                selectedKlaster={selectedKlaster}
                onSelectKlaster={setSelectedKlaster}
                onOpenDrawer={(indicator, quarter) => {
                  if (busy) return;
                  setSelectedIndicatorForDrawer(indicator);
                  setDrawerQuarter(quarter);
                }}
              />
            )}

            {visibleTab === 'target-setting' && canManage && (
              <TargetSettingView />
            )}

            {visibleTab === 'pic-matrix' && canManage && (
              <PicAssignmentView />
            )}

            {visibleTab === 'recommendations' && (
              <RecommendationView />
            )}

            {visibleTab === 'dinkes-supervision' && isDinkesMode && (
              <DinkesSupervisionView 
                onSelectPuskesmas={handleSelectPuskesmasFromDinkes}
                selectedMonth={selectedMonth}
              />
            )}

            {visibleTab === 'master-data' && canManage && (
              <MasterDataHub 
                selectedMonth={selectedMonth}
                isDinkesMode={isDinkesMode}
                selectedPuskesmasName={selectedPuskesmas}
              />
            )}
          </div>}
          {showContent && (load.loading || pkpStore.isMutating()) && <div role="status" className="absolute inset-0 z-30 flex items-center justify-center bg-slate-50/60 text-sm font-semibold text-slate-700">Memperbarui data...</div>}
        </main>
      </div>

      {/* Sliding Inspection Drawer */}
      <div inert={busy}>
      {showContent && !globalMode && selectedIndicatorForDrawer && (
        <IndicatorDetailDrawer key={`${selectedIndicatorForDrawer.id}:${selectedMonth}:${drawerQuarter ?? 'month'}`}
          indicator={selectedIndicatorForDrawer}
          selectedMonth={selectedMonth}
          inspectionQuarter={drawerQuarter}
          onClose={() => setSelectedIndicatorForDrawer(null)}
           onSelectIndicator={(ind) => openDrawer(ind, drawerQuarter)}
        />
      )}

      {/* Modal: Kelola Periode Tahun & Cutoff */}
      {showContent && userRole === 'DINKES_ADMIN' && <YearPeriodModal
        isOpen={isYearModalOpen}
        onClose={() => setIsYearModalOpen(false)}
      />}

      {/* Modal: Kelola Staf PIC */}
      {showContent && !globalMode && canManage && <StaffManagementModal
        isOpen={isStaffModalOpen}
        onClose={() => setIsStaffModalOpen(false)}
        selectedPuskesmasName={selectedPuskesmas}
      />}

      {/* Modal: Ekspor Laporan Resmi Excel & Cetak PDF */}
      {showContent && !globalMode && canManage && <ExportReportModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        selectedMonth={selectedMonth}
        puskesmasName={selectedPuskesmas}
      />}

      {/* Modal: Ubah Password Pengguna */}
      {showContent && <ChangePasswordModal
        isOpen={isChangePasswordOpen}
        onClose={() => setIsChangePasswordOpen(false)}
        currentUser={currentUser}
      />}
      </div>
    </div>
  );
};
