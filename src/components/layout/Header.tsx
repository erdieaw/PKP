import React, { useState, useRef, useEffect } from 'react';
import { 
  Calendar, 
  Clock, 
  ShieldCheck, 
  Building,
  UserCheck,
  Settings2,
  FileSpreadsheet,
  User,
  ChevronDown,
  LogOut,
  KeyRound,
  Shield,
  UserCircle
} from 'lucide-react';
import { pkpStore } from '../../services/mockState';
import { UserRole, AuthUser } from '../../types/pkp';
import { AppLogo } from '../common/AppLogo';

interface HeaderProps {
  selectedMonth: number;
  onSelectMonth: (month: number) => void;
  selectedPuskesmas: string;
  onSelectPuskesmas: (pkm: string) => void;
  userRole: UserRole;
  onChangeUserRole: (role: UserRole) => void;
  activePicId?: string;
  onChangeActivePicId?: (picId: string) => void;
  currentUser?: AuthUser | null;
  onOpenYearModal: () => void;
  onOpenExportModal: () => void;
  onOpenChangePassword: () => void;
  onLogout: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  selectedMonth,
  onSelectMonth,
  selectedPuskesmas,
  onSelectPuskesmas,
  userRole,
  onChangeUserRole,
  activePicId = 'pic-1',
  onChangeActivePicId,
  currentUser,
  onOpenYearModal,
  onOpenExportModal,
  onOpenChangePassword,
  onLogout
}) => {
  const currentYear = pkpStore.getCurrentYear();
  const years = pkpStore.getYears();
  const currentYearConfig = years.find(y => y.year === currentYear);
  const pics = pkpStore.getPics();

  const [isProfileDropdownOpen, setIsProfileDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsProfileDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const months = [
    { num: 1, name: 'Januari' },
    { num: 2, name: 'Februari' },
    { num: 3, name: 'Maret (TW I)' },
    { num: 4, name: 'April' },
    { num: 5, name: 'Mei' },
    { num: 6, name: 'Juni (TW II)' },
    { num: 7, name: 'Juli' },
    { num: 8, name: 'Agustus' },
    { num: 9, name: 'September (TW III)' },
    { num: 10, name: 'Oktober' },
    { num: 11, name: 'November' },
    { num: 12, name: 'Desember (TW IV)' },
  ];

  const puskesmasList = pkpStore.getPuskesmasList();
  const currentPic = pics.find(p => p.id === activePicId) || pics[0];
  const user = currentUser || pkpStore.getCurrentUser();

  return (
    <header className="h-16 w-full min-w-0 bg-white/95 backdrop-blur-md border-b border-slate-200/80 px-3 sm:px-5 flex items-center justify-between sticky top-0 z-20 shadow-2xs">
      {/* Left: Mobile Logo, Puskesmas, Year, Month */}
      <div className="flex items-center gap-1.5 sm:gap-2.5 min-w-0 shrink">
        {/* Mobile/Tablet Brand Mark */}
        <div className="md:hidden shrink-0">
          <AppLogo variant="icon-only" size="sm" />
        </div>

        {/* Puskesmas Selector */}
        <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
          <Building className="w-4 h-4 text-emerald-600 shrink-0 hidden sm:block" />
          <select
            value={selectedPuskesmas}
            onChange={(e) => onSelectPuskesmas(e.target.value)}
            className="text-xs sm:text-sm font-bold text-slate-800 bg-slate-50 border border-slate-200 rounded-xl px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-emerald-500 cursor-pointer max-w-[130px] sm:max-w-[170px] xl:max-w-[210px] truncate shadow-2xs"
          >
            {puskesmasList.map((pkm) => (
              <option key={pkm.id} value={pkm.name}>{pkm.name}</option>
            ))}
          </select>
        </div>

        <span className="text-slate-300 hidden md:inline">|</span>

        {/* Periode Tahun Selector & Edit Button */}
        <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-xl px-1.5 py-1 shadow-2xs shrink-0">
          <Calendar className="w-3.5 h-3.5 text-slate-500 shrink-0" />
          <span className="text-xs text-slate-500 font-medium hidden lg:inline">TA:</span>
          <select
            value={currentYear}
            onChange={(e) => pkpStore.setCurrentYear(Number(e.target.value))}
            className="text-xs font-bold text-slate-800 bg-transparent focus:outline-none cursor-pointer"
            title="Pilih Tahun Anggaran"
          >
            {years.map(y => (
              <option key={y.year} value={y.year}>
                {y.year} {y.status === 'LOCKED' ? '🔒' : ''}
              </option>
            ))}
          </select>
          <button
            onClick={onOpenYearModal}
            className="p-0.5 hover:bg-slate-200 rounded text-slate-500 hover:text-emerald-700 transition-colors"
            title="Kelola & Buka Periode Tahun Baru"
          >
            <Settings2 className="w-3.5 h-3.5" />
          </button>
        </div>

        <span className="text-slate-300 hidden lg:inline">|</span>

        {/* Month Selector */}
        <div className="flex items-center gap-1 shrink-0">
          <select
            value={selectedMonth}
            onChange={(e) => onSelectMonth(Number(e.target.value))}
            className="text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-emerald-500 cursor-pointer max-w-[110px] sm:max-w-[130px] xl:max-w-[160px] truncate"
            title="Pilih Bulan Evaluasi"
          >
            {months.map((m) => (
              <option key={m.num} value={m.num}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Right: Cut-off, Export, Role Toggle, Profile Dropdown */}
      <div className="flex items-center gap-1 sm:gap-2 shrink-0">
        {/* Cut-off info */}
        <div className="hidden 2xl:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-xs">
          <Clock className="w-3.5 h-3.5 text-amber-600" />
          <span>Cut-off: <strong>Tgl {currentYearConfig?.cutoffDay || 10}</strong></span>
        </div>

        {/* Export / Print Button */}
        <button
          onClick={onOpenExportModal}
          className="inline-flex items-center gap-1.5 px-2 sm:px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-700 text-xs font-semibold transition-colors"
          title="Ekspor Laporan Resmi Excel & Cetak PDF"
        >
          <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
          <span className="hidden xl:inline">Ekspor Laporan</span>
        </button>

        {/* Multi-Role Switcher (Dinkes vs Admin Puskesmas vs PIC) */}
        <div className="flex items-center bg-slate-100 p-0.5 rounded-xl border border-slate-300 text-xs">
          <button
            onClick={() => onChangeUserRole('DINKES_ADMIN')}
            className={`flex items-center gap-1 px-2 py-1 rounded-lg font-bold transition-all ${
              userRole === 'DINKES_ADMIN'
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
            title="Masuk sebagai Administrator Dinas Kesehatan"
          >
            <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
            <span className={userRole === 'DINKES_ADMIN' ? 'inline' : 'hidden xl:inline'}>Dinkes</span>
          </button>

          <button
            onClick={() => onChangeUserRole('ADMIN_PUSKESMAS')}
            className={`flex items-center gap-1 px-2 py-1 rounded-lg font-bold transition-all ${
              userRole === 'ADMIN_PUSKESMAS'
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
            title="Masuk sebagai Administrator Puskesmas"
          >
            <Building className="w-3.5 h-3.5 shrink-0" />
            <span className={userRole === 'ADMIN_PUSKESMAS' ? 'inline' : 'hidden xl:inline'}>
              <span className="xl:hidden">Admin</span>
              <span className="hidden xl:inline">Admin PKM</span>
            </span>
          </button>

          <button
            onClick={() => onChangeUserRole('PIC')}
            className={`flex items-center gap-1 px-2 py-1 rounded-lg font-bold transition-all ${
              userRole === 'PIC'
                ? 'bg-teal-600 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
            title="Masuk sebagai Staf Pengelola Program (PIC)"
          >
            <UserCheck className="w-3.5 h-3.5 shrink-0" />
            <span className={userRole === 'PIC' ? 'inline' : 'hidden xl:inline'}>PIC</span>
          </button>
        </div>

        {/* Active PIC Selector when userRole is PIC */}
        {userRole === 'PIC' && onChangeActivePicId && (
          <div className="flex items-center gap-1.5 bg-teal-50 border border-teal-300 rounded-lg px-2 py-1 text-xs">
            <span className={`w-2 h-2 rounded-full ${currentPic.avatarColor}`} />
            <select
              value={activePicId}
              onChange={(e) => onChangeActivePicId(e.target.value)}
              className="bg-transparent font-bold text-teal-900 focus:outline-none cursor-pointer max-w-[90px] sm:max-w-[120px] truncate"
              title="Pilih PIC yang sedang login"
            >
              {pics.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name.split(',')[0]}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* User Profile Dropdown (Mobbin Header Pattern with Ubah Password & Logout) */}
        <div className="relative" ref={dropdownRef}>
          <button
            type="button"
            onClick={() => setIsProfileDropdownOpen(!isProfileDropdownOpen)}
            className="flex items-center gap-1.5 p-1 rounded-xl border border-slate-200 hover:border-slate-300 hover:bg-slate-50 transition-all cursor-pointer group"
            title={user.name}
          >
            <div className={`w-7 h-7 rounded-lg ${user.avatarColor || 'bg-emerald-600'} text-white flex items-center justify-center font-bold text-xs shadow-xs shrink-0`}>
              {user.name.charAt(0)}
            </div>
            <div className="hidden 2xl:block text-left pr-1 leading-tight">
              <span className="block text-xs font-bold text-slate-800 truncate max-w-[110px]">
                {user.name.split(',')[0]}
              </span>
              <span className="block text-[10px] text-slate-500 font-medium">
                {user.roleLabel}
              </span>
            </div>
            <ChevronDown className={`w-3.5 h-3.5 text-slate-400 group-hover:text-slate-600 transition-transform shrink-0 ${isProfileDropdownOpen ? 'rotate-180' : ''}`} />
          </button>

          {/* Dropdown Menu */}
          {isProfileDropdownOpen && (
            <div className="absolute right-0 mt-2 w-64 bg-white rounded-2xl shadow-xl border border-slate-200 py-2 z-50 text-xs animate-scale-in">
              {/* User summary card */}
              <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/70">
                <p className="font-bold text-slate-900 text-xs truncate">{user.name}</p>
                <p className="text-[11px] text-slate-500 font-mono mt-0.5">NIP: {user.nip || '-'}</p>
                <div className="mt-1.5 flex items-center gap-1.5">
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                    user.role === 'DINKES_ADMIN'
                      ? 'bg-indigo-100 text-indigo-800'
                      : user.role === 'ADMIN_PUSKESMAS'
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-teal-100 text-teal-800'
                  }`}>
                    {user.roleLabel}
                  </span>
                </div>
              </div>

              {/* Menu Actions */}
              <div className="p-1 space-y-0.5">
                <button
                  type="button"
                  onClick={() => {
                    setIsProfileDropdownOpen(false);
                    onOpenChangePassword();
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-slate-700 hover:bg-emerald-50 hover:text-emerald-800 font-semibold transition-colors text-left"
                >
                  <KeyRound className="w-4 h-4 text-emerald-600" />
                  <span>Ubah Kata Sandi (Password)</span>
                </button>

                <div className="my-1 border-t border-slate-100" />

                <button
                  type="button"
                  onClick={() => {
                    setIsProfileDropdownOpen(false);
                    onLogout();
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-rose-700 hover:bg-rose-50 font-semibold transition-colors text-left"
                >
                  <LogOut className="w-4 h-4 text-rose-600" />
                  <span>Keluar Sistem (Logout)</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
