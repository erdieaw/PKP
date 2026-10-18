import React, { useState, useEffect } from 'react';
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
import { OfficialIndicator, UserRole, AuthUser } from '../../types/pkp';
import { pkpStore } from '../../services/mockState';

interface AppLayoutProps {
  currentUser?: AuthUser | null;
  onLogout?: () => void;
}

export const AppLayout: React.FC<AppLayoutProps> = ({ 
  currentUser, 
  onLogout = () => {} 
}) => {
  const [activeTab, setActiveTab] = useState<NavTab>('dashboard-exec');
  const [selectedMonth, setSelectedMonth] = useState<number>(3); // Default to Maret (TW1)
  const [selectedKlaster, setSelectedKlaster] = useState<number>(0); // 0 = Semua
  const [selectedPuskesmas, setSelectedPuskesmas] = useState<string>(
    currentUser?.healthCenterName || 'Puskesmas Kebonagung'
  );
  const [userRole, setUserRole] = useState<UserRole>(
    currentUser?.role || 'ADMIN_PUSKESMAS'
  );
  const [activePicId, setActivePicId] = useState<string>(
    currentUser?.role === 'PIC' ? currentUser.id : 'pic-1'
  );

  const isDinkesMode = userRole === 'DINKES_ADMIN';
  
  // Modals & Drawers state
  const [selectedIndicatorForDrawer, setSelectedIndicatorForDrawer] = useState<OfficialIndicator | null>(null);
  const [isYearModalOpen, setIsYearModalOpen] = useState<boolean>(false);
  const [isStaffModalOpen, setIsStaffModalOpen] = useState<boolean>(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState<boolean>(false);
  const [isChangePasswordOpen, setIsChangePasswordOpen] = useState<boolean>(false);

  // Sync role if currentUser prop updates
  useEffect(() => {
    if (currentUser) {
      setUserRole(currentUser.role);
      if (currentUser.healthCenterName) {
        setSelectedPuskesmas(currentUser.healthCenterName);
      }
      if (currentUser.role === 'PIC') {
        setActivePicId(currentUser.id);
      }
    }
  }, [currentUser]);

  // Force re-render on store update
  const [, setTick] = useState(0);
  useEffect(() => {
    return pkpStore.subscribe(() => setTick(t => t + 1));
  }, []);

  const handleNavigateToDataEntry = (klasterId: number) => {
    setSelectedKlaster(klasterId);
    setActiveTab('data-entry');
  };

  const handleSelectPuskesmasFromDinkes = (pkmName: string) => {
    setSelectedPuskesmas(pkmName);
    setActiveTab('dashboard-exec');
  };

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      {/* Sidebar */}
      <Sidebar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        selectedKlaster={selectedKlaster}
        onSelectKlaster={setSelectedKlaster}
        isDinkesMode={isDinkesMode}
        onOpenYearModal={() => setIsYearModalOpen(true)}
        onOpenStaffModal={() => setIsStaffModalOpen(true)}
        onOpenExportModal={() => setIsExportModalOpen(true)}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        {/* Top Header */}
        <Header
          selectedMonth={selectedMonth}
          onSelectMonth={setSelectedMonth}
          selectedPuskesmas={selectedPuskesmas}
          onSelectPuskesmas={setSelectedPuskesmas}
          userRole={userRole}
          onChangeUserRole={(role) => {
            setUserRole(role);
            if (role === 'DINKES_ADMIN') {
              setActiveTab('dinkes-supervision');
            } else if (role === 'PIC') {
              setActiveTab('data-entry');
            }
          }}
          activePicId={activePicId}
          onChangeActivePicId={setActivePicId}
          currentUser={currentUser}
          onOpenYearModal={() => setIsYearModalOpen(true)}
          onOpenExportModal={() => setIsExportModalOpen(true)}
          onOpenChangePassword={() => setIsChangePasswordOpen(true)}
          onLogout={onLogout}
        />

        {/* Scrollable View Container */}
        <main className="flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-6 bg-slate-50">
          <div className="w-full max-w-7xl mx-auto">
            {activeTab === 'dashboard-exec' && (
              <ExecutiveDashboard
                selectedMonth={selectedMonth}
                onNavigateToDataEntry={handleNavigateToDataEntry}
                onNavigateToPicDashboard={() => setActiveTab('dashboard-pic')}
              />
            )}

            {activeTab === 'official-sheet7' && (
              <OfficialPerformanceSheet7 />
            )}

            {activeTab === 'dashboard-annual' && (
              <AnnualTrendDashboard
                onNavigateToMonth={(m) => {
                  setSelectedMonth(m);
                  setActiveTab('data-entry');
                }}
                onOpenDrawer={setSelectedIndicatorForDrawer}
              />
            )}

            {activeTab === 'dashboard-pic' && (
              <PicDashboard selectedMonth={selectedMonth} />
            )}

            {activeTab === 'data-entry' && (
              <MonthlyDataGrid
                selectedMonth={selectedMonth}
                selectedKlaster={selectedKlaster}
                onSelectKlaster={setSelectedKlaster}
                onOpenDrawer={setSelectedIndicatorForDrawer}
              />
            )}

            {activeTab === 'target-setting' && (
              <TargetSettingView />
            )}

            {activeTab === 'pic-matrix' && (
              <PicAssignmentView />
            )}

            {activeTab === 'recommendations' && (
              <RecommendationView />
            )}

            {activeTab === 'dinkes-supervision' && (
              <DinkesSupervisionView 
                onSelectPuskesmas={handleSelectPuskesmasFromDinkes}
                selectedMonth={selectedMonth}
              />
            )}

            {activeTab === 'master-data' && (
              <MasterDataHub 
                isDinkesMode={isDinkesMode}
                selectedPuskesmasName={selectedPuskesmas}
              />
            )}
          </div>
        </main>
      </div>

      {/* Sliding Inspection Drawer */}
      {selectedIndicatorForDrawer && (
        <IndicatorDetailDrawer
          indicator={selectedIndicatorForDrawer}
          selectedMonth={selectedMonth}
          onClose={() => setSelectedIndicatorForDrawer(null)}
          onSelectIndicator={(ind) => setSelectedIndicatorForDrawer(ind)}
        />
      )}

      {/* Modal: Kelola Periode Tahun & Cutoff */}
      <YearPeriodModal
        isOpen={isYearModalOpen}
        onClose={() => setIsYearModalOpen(false)}
      />

      {/* Modal: Kelola Staf PIC */}
      <StaffManagementModal
        isOpen={isStaffModalOpen}
        onClose={() => setIsStaffModalOpen(false)}
        selectedPuskesmasName={selectedPuskesmas}
      />

      {/* Modal: Ekspor Laporan Resmi Excel & Cetak PDF */}
      <ExportReportModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        selectedMonth={selectedMonth}
        puskesmasName={selectedPuskesmas}
      />

      {/* Modal: Ubah Password Pengguna */}
      <ChangePasswordModal
        isOpen={isChangePasswordOpen}
        onClose={() => setIsChangePasswordOpen(false)}
        currentUser={currentUser || pkpStore.getCurrentUser()}
      />
    </div>
  );
};
