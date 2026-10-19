import React, { useEffect, useRef, useState } from 'react';
import { Calendar, Building, Settings2, FileSpreadsheet, ChevronDown, LogOut, KeyRound, Menu } from 'lucide-react';
import { pkpStore } from '../../services/apiStore';
import { AuthUser } from '../../types/pkp';

interface HeaderProps {
  selectedMonth: number;
  onSelectMonth: (month: number) => void;
  selectedPuskesmas: string;
  onSelectPuskesmas: (id: string) => Promise<void>;
  onSelectYear: (year: number) => Promise<void>;
  currentUser: AuthUser;
  busy: boolean;
  globalMode: boolean;
  onOpenNavigation: () => void;
  onOpenYearModal: () => void;
  onOpenExportModal: () => void;
  onOpenChangePassword: () => void;
  onLogout: () => void;
}

export function Header({ selectedMonth, onSelectMonth, selectedPuskesmas, onSelectPuskesmas, onSelectYear, currentUser: user, busy, globalMode, onOpenNavigation, onOpenYearModal, onOpenExportModal, onOpenChangePassword, onLogout }: HeaderProps) {
  const [profileOpen, setProfileOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const dropdown = useRef<HTMLDivElement>(null);
  const canManage = user.role !== 'PIC';
  const years = pkpStore.getYears();
  const centers = pkpStore.getPuskesmasList();
  const year = pkpStore.getCurrentYear();
  const centerId = pkpStore.getSelectedHealthCenterId() ?? '';

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!dropdown.current?.contains(event.target as Node)) setProfileOpen(false);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setProfileOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', escape); };
  }, []);

  const changeScope = async (operation: () => Promise<void>) => {
    if (pending || busy || pkpStore.isMutating()) return;
    setPending(true);
    setError('');
    try { await operation(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Periode atau Puskesmas tidak dapat dimuat.'); }
    finally { setPending(false); }
  };

  return <header className="w-full min-w-0 bg-white/95 border-b border-slate-200/80 sticky top-0 z-20 shadow-2xs">
    <div className="min-h-16 px-3 sm:px-5 py-2 flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap items-center gap-2 min-w-0">
        <button type="button" aria-label="Buka navigasi" onClick={onOpenNavigation} className="md:hidden p-2 rounded-lg hover:bg-slate-100"><Menu className="w-5 h-5" /></button>
        <div className="flex items-center gap-1.5 min-w-0">
          <Building className="w-4 h-4 text-emerald-600 hidden sm:block" />
          <select aria-label="Puskesmas" title={selectedPuskesmas} value={centerId} disabled={pending || busy || centers.length === 0 || years.length === 0 || user.role !== 'DINKES_ADMIN'} onChange={event => void changeScope(() => onSelectPuskesmas(event.target.value))} className="text-xs sm:text-sm font-bold text-slate-800 bg-slate-50 border border-slate-200 rounded-xl px-2 py-1.5 focus:ring-2 focus:ring-emerald-500 max-w-[145px] sm:max-w-[210px] truncate disabled:opacity-80">
            {!centerId && <option value="">Pilih Puskesmas</option>}
            {centers.filter(center => user.role === 'DINKES_ADMIN' || center.id === user.healthCenterId).map(center => <option key={center.id} value={center.id}>{center.name}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-xl px-1.5 py-1">
          <Calendar className="w-3.5 h-3.5 text-slate-500" />
          <select aria-label="Tahun anggaran" value={years.length ? year : ''} disabled={pending || busy || years.length === 0} onChange={event => void changeScope(() => onSelectYear(Number(event.target.value)))} className="text-xs font-bold text-slate-800 bg-transparent focus:ring-2 focus:ring-emerald-500">
            {years.length === 0 && <option value="">Belum ada tahun</option>}
            {years.map(period => <option key={period.year} value={period.year}>{period.year}{period.status === 'LOCKED' ? ' (Terkunci)' : ''}</option>)}
          </select>
          {canManage && <button type="button" disabled={busy || pending} onClick={onOpenYearModal} aria-label="Kelola periode tahun" className="p-1 hover:bg-slate-200 rounded text-slate-500"><Settings2 className="w-3.5 h-3.5" /></button>}
        </div>
        <select aria-label="Bulan evaluasi" value={selectedMonth} disabled={busy || pending || globalMode} onChange={event => onSelectMonth(Number(event.target.value))} className="text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg px-2 py-1.5 focus:ring-2 focus:ring-emerald-500 max-w-[120px]">
          {Array.from({ length: 12 }, (_, index) => <option key={index + 1} value={index + 1}>{new Intl.DateTimeFormat('id-ID', { month: 'long' }).format(new Date(2024, index, 1))}</option>)}
        </select>
      </div>
      <div className="flex items-center gap-2 ml-auto">
        {canManage && <button type="button" disabled={busy || pending || globalMode} onClick={onOpenExportModal} aria-label="Ekspor laporan" className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-700 text-xs font-semibold"><FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" /><span className="hidden xl:inline">Ekspor Laporan</span></button>}
        <span className="hidden lg:inline text-xs font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-2 py-1.5">{user.roleLabel}</span>
        <div ref={dropdown} className="relative">
          <button type="button" aria-label={`Menu akun ${user.name}`} aria-expanded={profileOpen} aria-controls="profile-menu" onClick={() => setProfileOpen(!profileOpen)} className="flex items-center gap-1.5 p-1 rounded-xl border border-slate-200 hover:bg-slate-50">
            <span className="w-7 h-7 rounded-lg bg-emerald-600 text-white flex items-center justify-center font-bold text-xs">{user.name.charAt(0)}</span>
            <span className="hidden xl:block text-xs font-bold text-slate-800 max-w-[130px] truncate">{user.name}</span>
            <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
          </button>
          {profileOpen && <div id="profile-menu" className="absolute right-0 mt-2 w-64 bg-white rounded-2xl shadow-xl border border-slate-200 py-2 z-50 text-xs">
            <div className="px-4 py-3 border-b border-slate-100 bg-slate-50"><p className="font-bold text-slate-900 truncate">{user.name}</p><p className="text-slate-500 mt-1">{user.roleLabel}</p><p className="text-slate-500 mt-1">NIP: {user.nip || '-'}</p></div>
            <div className="p-1 space-y-1">
              <button type="button" disabled={busy || pending} onClick={() => { setProfileOpen(false); onOpenChangePassword(); }} className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-slate-700 hover:bg-emerald-50 font-semibold"><KeyRound className="w-4 h-4 text-emerald-600" />Ubah Kata Sandi</button>
              <button type="button" onClick={() => { setProfileOpen(false); onLogout(); }} className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-rose-700 hover:bg-rose-50 font-semibold"><LogOut className="w-4 h-4" />Keluar Sistem</button>
            </div>
          </div>}
        </div>
      </div>
    </div>
    {error && <div role="alert" className="px-4 py-2 bg-rose-50 text-rose-800 text-xs flex justify-between gap-2">{error}<button type="button" aria-label="Tutup pesan kesalahan" onClick={() => setError('')}>Tutup</button></div>}
  </header>;
}
