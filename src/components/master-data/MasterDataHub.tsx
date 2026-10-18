import React, { useState } from 'react';
import { pkpStore, SubKlasterMaster } from '../../services/mockState';
import { 
  OfficialIndicator, 
  HealthCenter, 
  PicUser, 
  AdminPuskesmasUser,
  TargetPolarity, 
  KlasterId 
} from '../../types/pkp';
import { 
  Database, 
  Layers, 
  Building2, 
  Users, 
  History, 
  Plus, 
  Search, 
  Edit2, 
  Trash2, 
  Check, 
  X,
  HelpCircle,
  ShieldAlert,
  Save,
  CheckCircle2,
  ShieldCheck,
  UserCheck,
  Key,
  Lock,
  PhoneCall,
  ExternalLink,
  ToggleLeft,
  ToggleRight,
  AlertCircle,
  Info,
  Shield
} from 'lucide-react';
import { PolarityBadge } from '../common/PolarityBadge';

type MasterTab = 'indicators' | 'subklasters' | 'puskesmas' | 'users' | 'audit-logs';

interface MasterDataHubProps {
  isDinkesMode?: boolean;
  selectedPuskesmasName?: string;
}

export const MasterDataHub: React.FC<MasterDataHubProps> = ({
  isDinkesMode = false,
  selectedPuskesmasName = 'Puskesmas Kebonagung'
}) => {
  const [activeTab, setActiveTab] = useState<MasterTab>('indicators');
  const [search, setSearch] = useState('');
  const [selectedKlaster, setSelectedKlaster] = useState<number>(0);
  const [toast, setToast] = useState<string | null>(null);

  // Indicators modal state
  const [isIndModalOpen, setIsIndModalOpen] = useState(false);
  const [editingInd, setEditingInd] = useState<OfficialIndicator | null>(null);
  const [indForm, setIndForm] = useState({
    klasterId: 1 as KlasterId,
    section: '1.1.Manajemen Inti Puskesmas',
    sectionCode: '1.1',
    no: '7.',
    kegiatan: '',
    indikator: '',
    targetDisplay: '1.0',
    targetNumeric: 1.0,
    satuan: 'Dokumen',
    totalSasaranDefault: 1,
    targetSasaranDefault: 1,
    polarity: 'HIGHER_IS_BETTER' as TargetPolarity,
    notes: ''
  });

  // Puskesmas modal state
  const [isPkmModalOpen, setIsPkmModalOpen] = useState(false);
  const [editingPkm, setEditingPkm] = useState<HealthCenter | null>(null);
  const [pkmForm, setPkmForm] = useState({
    name: '',
    code: '',
    subdistrict: '',
    headName: ''
  });

  // Subklaster modal state
  const [isSubModalOpen, setIsSubModalOpen] = useState(false);
  const [editingSub, setEditingSub] = useState<SubKlasterMaster | null>(null);
  const [subForm, setSubForm] = useState({
    klasterId: 1,
    code: '1.13',
    name: ''
  });

  // Admin Puskesmas modal state (Dinkes Privilege)
  const [isAdminPkmModalOpen, setIsAdminPkmModalOpen] = useState(false);
  const [editingAdminPkm, setEditingAdminPkm] = useState<AdminPuskesmasUser | null>(null);
  const [adminPkmForm, setAdminPkmForm] = useState({
    name: '',
    username: '',
    nip: '',
    healthCenterId: 'pkm-1',
    healthCenterName: 'Puskesmas Kebonagung',
    phone: '',
    email: '',
    tempPassword: ''
  });

  // Dinkes User Management Sub-Tab ('admin-pkm' | 'all-pics')
  const [dinkesUserSubTab, setDinkesUserSubTab] = useState<'admin-pkm' | 'all-pics'>('admin-pkm');
  const [pkmFilterForPics, setPkmFilterForPics] = useState<string>('ALL');

  // User/PIC modal state (Puskesmas Privilege)
  const [isUserModalOpen, setIsUserModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<PicUser | null>(null);
  const [userForm, setUserForm] = useState({
    name: '',
    nip: '',
    role: '',
    phone: '',
    email: ''
  });

  const indicators = pkpStore.getIndicators();
  const puskesmasList = pkpStore.getPuskesmasList();
  const subKlasters = pkpStore.getSubKlasters();
  const pics = pkpStore.getPics();
  const adminPuskesmasList = pkpStore.getAdminPuskesmasList();
  const auditLogs = pkpStore.getAuditLogs();
  const assignments = pkpStore.getAssignments();

  const getAssignedCountForPic = (picId: string) => {
    return Object.values(assignments).filter(id => id === picId).length;
  };

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };
  const setToastMessage = setToast;

  // ==================== HANDLERS: INDIKATOR ====================
  const handleOpenAddInd = () => {
    setEditingInd(null);
    setIndForm({
      klasterId: 1,
      section: '1.1.Manajemen Inti Puskesmas',
      sectionCode: '1.1',
      no: `${indicators.filter(i => i.sectionCode === '1.1').length + 1}.`,
      kegiatan: '',
      indikator: '',
      targetDisplay: '1.0',
      targetNumeric: 1.0,
      satuan: 'Dokumen',
      totalSasaranDefault: 1,
      targetSasaranDefault: 1,
      polarity: 'HIGHER_IS_BETTER',
      notes: ''
    });
    setIsIndModalOpen(true);
  };

  const handleOpenEditInd = (ind: OfficialIndicator) => {
    setEditingInd(ind);
    setIndForm({
      klasterId: ind.klasterId,
      section: ind.section,
      sectionCode: ind.sectionCode,
      no: ind.no,
      kegiatan: ind.kegiatan,
      indikator: ind.indikator,
      targetDisplay: ind.targetDisplay,
      targetNumeric: ind.targetNumeric,
      satuan: ind.satuan,
      totalSasaranDefault: ind.totalSasaranDefault,
      targetSasaranDefault: ind.targetSasaranDefault,
      polarity: ind.polarity,
      notes: ind.notes || ''
    });
    setIsIndModalOpen(true);
  };

  const handleSaveIndicator = (e: React.FormEvent) => {
    e.preventDefault();
    if (!indForm.indikator.trim()) return;

    if (editingInd) {
      pkpStore.updateIndicator(editingInd.id, {
        ...indForm,
        notes: indForm.notes || null
      });
      showToast(`Indikator ${indForm.indikator} berhasil diperbarui!`);
    } else {
      const newId = `K${indForm.klasterId}-R${Date.now()}`;
      const klasterTitles: Record<number, string> = {
        1: 'Klaster Pelayanan Manajemen',
        2: 'Klaster Pelayanan Kesehatan Ibu dan Anak',
        3: 'Klaster Pelayanan Kesehatan Dewasa dan Lanjut Usia',
        4: 'Klaster Pelayanan Penanggulangan Penyakit Menular dan Kesehatan Lingkungan',
        5: 'Klaster Dukungan Pelayanan Lintas Klaster'
      };

      pkpStore.addIndicator({
        id: newId,
        klasterId: indForm.klasterId,
        klasterName: klasterTitles[indForm.klasterId],
        section: indForm.section,
        sectionCode: indForm.sectionCode,
        no: indForm.no,
        kegiatan: indForm.kegiatan,
        indikator: indForm.indikator,
        targetDisplay: indForm.targetDisplay,
        targetNumeric: indForm.targetNumeric,
        satuan: indForm.satuan,
        totalSasaranDefault: indForm.totalSasaranDefault,
        targetSasaranDefault: indForm.targetSasaranDefault,
        polarity: indForm.polarity,
        notes: indForm.notes || null
      });
      showToast(`Indikator baru [${indForm.sectionCode}.${indForm.no}] berhasil ditambahkan!`);
    }
    setIsIndModalOpen(false);
  };

  const handleDeleteIndicator = (ind: OfficialIndicator) => {
    if (confirm(`Apakah Anda yakin ingin menghapus indikator "${ind.indikator}"?`)) {
      pkpStore.deleteIndicator(ind.id);
      showToast(`Indikator ${ind.indikator} telah dihapus.`);
    }
  };

  // ==================== HANDLERS: PUSKESMAS ====================
  const handleOpenAddPkm = () => {
    setEditingPkm(null);
    setPkmForm({ name: '', code: '', subdistrict: '', headName: '' });
    setIsPkmModalOpen(true);
  };

  const handleOpenEditPkm = (pkm: HealthCenter) => {
    setEditingPkm(pkm);
    setPkmForm({
      name: pkm.name,
      code: pkm.code,
      subdistrict: pkm.subdistrict,
      headName: pkm.headName
    });
    setIsPkmModalOpen(true);
  };

  const handleSavePuskesmas = (e: React.FormEvent) => {
    e.preventDefault();
    if (!pkmForm.name.trim()) return;

    if (editingPkm) {
      pkpStore.updatePuskesmas(editingPkm.id, pkmForm);
      showToast(`Data ${pkmForm.name} berhasil diperbarui!`);
    } else {
      pkpStore.addPuskesmas({
        id: `pkm-${Date.now()}`,
        name: pkmForm.name,
        code: pkmForm.code || `P3507${Math.floor(1000 + Math.random() * 9000)}`,
        subdistrict: pkmForm.subdistrict,
        headName: pkmForm.headName,
        picCount: 8,
        currentScore: 80.0,
        kategoriPKP: 'Kinerja Cukup',
        klasterScores: { 1: 80, 2: 80, 3: 80, 4: 80, 5: 80 }
      });
      showToast(`Puskesmas ${pkmForm.name} berhasil didaftarkan!`);
    }
    setIsPkmModalOpen(false);
  };

  const handleDeletePuskesmas = (pkm: HealthCenter) => {
    if (confirm(`Hapus ${pkm.name} dari sistem?`)) {
      pkpStore.deletePuskesmas(pkm.id);
      showToast(`${pkm.name} berhasil dihapus.`);
    }
  };

  // ==================== HANDLERS: SUB-KLASTER ====================
  const handleOpenAddSub = () => {
    setEditingSub(null);
    setSubForm({ klasterId: 1, code: '1.13', name: '' });
    setIsSubModalOpen(true);
  };

  const handleOpenEditSub = (sub: SubKlasterMaster) => {
    setEditingSub(sub);
    setSubForm({ klasterId: sub.klasterId, code: sub.code, name: sub.name });
    setIsSubModalOpen(true);
  };

  const handleSaveSubKlaster = (e: React.FormEvent) => {
    e.preventDefault();
    if (!subForm.name.trim()) return;

    if (editingSub) {
      pkpStore.updateSubKlaster(editingSub.id, subForm);
      showToast(`Sub-klaster ${subForm.name} diperbarui!`);
    } else {
      pkpStore.addSubKlaster({
        id: `sub-${subForm.code}-${Date.now()}`,
        klasterId: subForm.klasterId,
        code: subForm.code,
        name: subForm.name
      });
      showToast(`Sub-klaster ${subForm.name} berhasil ditambahkan!`);
    }
    setIsSubModalOpen(false);
  };

  const handleDeleteSub = (sub: SubKlasterMaster) => {
    if (confirm(`Hapus sub-klaster ${sub.name}?`)) {
      pkpStore.deleteSubKlaster(sub.id);
      showToast(`Sub-klaster ${sub.name} dihapus.`);
    }
  };

  // ==================== HANDLERS: ADMIN PUSKESMAS (DINKES ONLY) ====================
  const handleOpenAddAdminPkm = () => {
    setEditingAdminPkm(null);
    const defaultPkm = puskesmasList[0] || { id: 'pkm-1', name: 'Puskesmas Kebonagung' };
    setAdminPkmForm({
      name: '',
      username: '',
      nip: '',
      healthCenterId: defaultPkm.id,
      healthCenterName: defaultPkm.name,
      phone: '',
      email: '',
      tempPassword: 'Puskesmas2026!'
    });
    setIsAdminPkmModalOpen(true);
  };

  const handleOpenEditAdminPkm = (admin: AdminPuskesmasUser) => {
    setEditingAdminPkm(admin);
    setAdminPkmForm({
      name: admin.name,
      username: admin.username,
      nip: admin.nip,
      healthCenterId: admin.healthCenterId,
      healthCenterName: admin.healthCenterName,
      phone: admin.phone,
      email: admin.email,
      tempPassword: ''
    });
    setIsAdminPkmModalOpen(true);
  };

  const handleSaveAdminPkm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminPkmForm.name.trim() || !adminPkmForm.username.trim()) return;

    const selectedPkm = puskesmasList.find(p => p.id === adminPkmForm.healthCenterId) || {
      id: adminPkmForm.healthCenterId,
      name: adminPkmForm.healthCenterName
    };

    if (editingAdminPkm) {
      pkpStore.updateAdminPuskesmas(editingAdminPkm.id, {
        name: adminPkmForm.name.trim(),
        username: adminPkmForm.username.trim(),
        nip: adminPkmForm.nip.trim(),
        healthCenterId: selectedPkm.id,
        healthCenterName: selectedPkm.name,
        phone: adminPkmForm.phone.trim(),
        email: adminPkmForm.email.trim()
      });
      showToast(`Akun Admin ${adminPkmForm.name} berhasil diperbarui!`);
    } else {
      pkpStore.addAdminPuskesmas({
        name: adminPkmForm.name.trim(),
        username: adminPkmForm.username.trim(),
        nip: adminPkmForm.nip.trim(),
        healthCenterId: selectedPkm.id,
        healthCenterName: selectedPkm.name,
        phone: adminPkmForm.phone.trim(),
        email: adminPkmForm.email.trim()
      });
      showToast(`Akun Admin Puskesmas untuk ${selectedPkm.name} berhasil dibuat!`);
    }
    setIsAdminPkmModalOpen(false);
  };

  const handleDeleteAdminPkm = (admin: AdminPuskesmasUser) => {
    if (confirm(`Hapus akun Administrator Puskesmas untuk "${admin.name}" (${admin.healthCenterName})?`)) {
      pkpStore.deleteAdminPuskesmas(admin.id);
      showToast(`Akun Admin ${admin.name} berhasil dihapus.`);
    }
  };

  const handleToggleAdminPkmStatus = (admin: AdminPuskesmasUser) => {
    pkpStore.toggleAdminPuskesmasStatus(admin.id);
    showToast(`Status akun ${admin.username} diubah.`);
  };

  // ==================== HANDLERS: PIC / USER (PUSKESMAS SCOPED) ====================
  const handleOpenAddUser = () => {
    setEditingUser(null);
    setUserForm({ name: '', nip: '', role: '', phone: '', email: '' });
    setIsUserModalOpen(true);
  };

  const handleOpenEditUser = (pic: PicUser) => {
    setEditingUser(pic);
    setUserForm({
      name: pic.name,
      nip: pic.nip || '',
      role: pic.role,
      phone: pic.phone,
      email: pic.email || ''
    });
    setIsUserModalOpen(true);
  };

  const handleSaveUser = (e: React.FormEvent) => {
    e.preventDefault();
    if (!userForm.name.trim() || !userForm.role.trim()) return;

    if (editingUser) {
      pkpStore.updatePic(editingUser.id, {
        name: userForm.name.trim(),
        nip: userForm.nip.trim() || undefined,
        role: userForm.role.trim(),
        phone: userForm.phone.trim(),
        email: userForm.email.trim() || undefined
      });
      showToast(`Staf PIC ${userForm.name} berhasil diperbarui!`);
    } else {
      const activePkmObj = puskesmasList.find(p => p.name === selectedPuskesmasName) || puskesmasList[0];
      pkpStore.addPic(
        userForm.name.trim(),
        userForm.role.trim(),
        userForm.phone.trim() || '081234567890',
        activePkmObj ? activePkmObj.id : 'pkm-1',
        activePkmObj ? activePkmObj.name : selectedPuskesmasName,
        userForm.nip.trim(),
        userForm.email.trim()
      );
      showToast(`Staf PIC ${userForm.name} berhasil didaftarkan untuk ${selectedPuskesmasName}!`);
    }
    setIsUserModalOpen(false);
  };

  const handleDeleteUser = (pic: PicUser) => {
    if (confirm(`Hapus staf PIC ${pic.name}?`)) {
      pkpStore.deletePic(pic.id);
      showToast(`Staf ${pic.name} dihapus.`);
    }
  };

  // Filter for indicators list
  const filteredIndicators = indicators.filter((ind) => {
    if (selectedKlaster !== 0 && ind.klasterId !== selectedKlaster) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      const code = `${ind.sectionCode}.${ind.no}`.toLowerCase();
      return code.includes(q) || ind.indikator.toLowerCase().includes(q) || ind.kegiatan.toLowerCase().includes(q);
    }
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-emerald-600 font-bold text-xs uppercase tracking-wider mb-1">
            <Database className="w-4 h-4" />
            <span>Pusat Data Master Sistem PKP</span>
          </div>
          <h2 className="text-xl font-bold text-slate-800">
            Kelola Master Data (CRUD Terpadu)
          </h2>
          <p className="text-xs text-slate-500">
            Pengelolaan menyeluruh data induk: 282 Elemen Penilaian, Struktur Klaster/Sub-klaster, Fasilitas Pelayanan (Puskesmas), Staf PIC, dan Log Audit.
          </p>
        </div>

        {toast && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-semibold animate-fade-in">
            <CheckCircle2 className="w-4 h-4" />
            <span>{toast}</span>
          </div>
        )}
      </div>

      {/* Navigation Pills (5 Master Modules) */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {[
          { id: 'indicators' as MasterTab, label: `Master Indikator (${indicators.length})`, icon: Database },
          { id: 'subklasters' as MasterTab, label: `Master Klaster & Sub (${subKlasters.length})`, icon: Layers },
          { id: 'puskesmas' as MasterTab, label: `Master Puskesmas (${puskesmasList.length})`, icon: Building2 },
          { 
            id: 'users' as MasterTab, 
            label: isDinkesMode 
              ? `Master Pengguna & Admin (${adminPuskesmasList.length} Admin / ${pics.length} PIC)` 
              : `Master Staf PIC (${pics.filter(p => !p.healthCenterName || p.healthCenterName === selectedPuskesmasName).length} Staf)`, 
            icon: isDinkesMode ? ShieldCheck : Users 
          },
          { id: 'audit-logs' as MasterTab, label: `Log Audit & Aktivitas (${auditLogs.length})`, icon: History },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${
                isActive
                  ? 'bg-slate-900 text-white shadow-sm'
                  : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* ============================================================== */}
      {/* 1. MASTER INDIKATOR TAB */}
      {/* ============================================================== */}
      {activeTab === 'indicators' && (
        <div className="space-y-4">
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0">
              {[
                { id: 0, label: 'Semua' },
                { id: 1, label: 'K1: Manajemen' },
                { id: 2, label: 'K2: KIA' },
                { id: 3, label: 'K3: Dewasa' },
                { id: 4, label: 'K4: P2M' },
                { id: 5, label: 'K5: Lintas' },
              ].map((k) => (
                <button
                  key={k.id}
                  onClick={() => setSelectedKlaster(k.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                    selectedKlaster === k.id ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {k.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-3">
              <div className="relative min-w-[240px]">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Cari kode atau indikator..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <button
                onClick={handleOpenAddInd}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-colors whitespace-nowrap shadow-sm"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Tambah Indikator</span>
              </button>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto max-h-[65vh] overflow-y-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="bg-slate-100 sticky top-0 z-10 text-slate-700 font-bold border-b border-slate-200">
                  <tr>
                    <th className="py-2.5 px-3 w-20">Kode</th>
                    <th className="py-2.5 px-3 min-w-[280px]">Indikator Kinerja & Kegiatan</th>
                    <th className="py-2.5 px-3 w-28">Polaritas</th>
                    <th className="py-2.5 px-3 w-24">Satuan</th>
                    <th className="py-2.5 px-3 w-24 text-right">Target Sasaran</th>
                    <th className="py-2.5 px-3 w-28 text-center">Aksi (CRUD)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredIndicators.map((ind) => (
                    <tr key={ind.id} className="hover:bg-slate-50 transition-colors">
                      <td className="py-2.5 px-3 font-mono font-bold text-slate-700 align-top">
                        <span className="px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200">
                          {ind.sectionCode}.{ind.no.replace('.', '')}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 align-top">
                        <p className="font-semibold text-slate-800 leading-tight">{ind.indikator}</p>
                        <p className="text-[11px] text-slate-400 mt-0.5">{ind.kegiatan} • {ind.section}</p>
                      </td>
                      <td className="py-2.5 px-3 align-top">
                        <PolarityBadge polarity={ind.polarity} targetDisplay={ind.targetDisplay} />
                      </td>
                      <td className="py-2.5 px-3 text-slate-500 align-top">{ind.satuan}</td>
                      <td className="py-2.5 px-3 text-right font-mono text-slate-700 align-top">
                        {ind.targetSasaranDefault.toFixed(1)}
                      </td>
                      <td className="py-2.5 px-3 text-center align-top">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            onClick={() => handleOpenEditInd(ind)}
                            className="p-1.5 rounded bg-slate-100 hover:bg-emerald-50 text-slate-600 hover:text-emerald-700 transition-colors"
                            title="Edit Indikator"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDeleteIndicator(ind)}
                            className="p-1.5 rounded bg-slate-100 hover:bg-rose-50 text-slate-600 hover:text-rose-700 transition-colors"
                            title="Hapus Indikator"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* 2. MASTER KLASTER & SUB-KLASTER TAB */}
      {/* ============================================================== */}
      {activeTab === 'subklasters' && (
        <div className="space-y-4">
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
            <div>
              <h3 className="font-bold text-slate-800 text-sm">Struktur Klaster & Sub-klaster ILP</h3>
              <p className="text-xs text-slate-500">Daftar 5 Klaster utama dan 29 sub-kelompok penilaian kinerja</p>
            </div>
            <button
              onClick={handleOpenAddSub}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-colors shadow-sm"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Tambah Sub-klaster</span>
            </button>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200">
                <tr>
                  <th className="py-2.5 px-3 w-24">Kode</th>
                  <th className="py-2.5 px-3 w-28">Klaster Induk</th>
                  <th className="py-2.5 px-3">Nama Sub-klaster</th>
                  <th className="py-2.5 px-3 w-36 text-center">Jumlah Indikator</th>
                  <th className="py-2.5 px-3 w-28 text-center">Aksi (CRUD)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {subKlasters.map((sub) => {
                  const count = indicators.filter(i => i.sectionCode === sub.code || i.sectionCode.startsWith(sub.code + '.')).length;
                  return (
                    <tr key={sub.id} className="hover:bg-slate-50 transition-colors">
                      <td className="py-2.5 px-3 font-mono font-bold text-slate-800">{sub.code}</td>
                      <td className="py-2.5 px-3">
                        <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-semibold text-[11px]">
                          Klaster {sub.klasterId}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 font-bold text-slate-900">{sub.name}</td>
                      <td className="py-2.5 px-3 text-center font-mono font-bold text-emerald-600">
                        {count} Indikator
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            onClick={() => handleOpenEditSub(sub)}
                            className="p-1.5 rounded bg-slate-100 hover:bg-emerald-50 text-slate-600 hover:text-emerald-700"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDeleteSub(sub)}
                            className="p-1.5 rounded bg-slate-100 hover:bg-rose-50 text-slate-600 hover:text-rose-700"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* 3. MASTER PUSKESMAS TAB */}
      {/* ============================================================== */}
      {activeTab === 'puskesmas' && (
        <div className="space-y-4">
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
            <div>
              <h3 className="font-bold text-slate-800 text-sm">Daftar Fasilitas Pelayanan Kesehatan (Puskesmas)</h3>
              <p className="text-xs text-slate-500">Master Puskesmas di bawah naungan Dinas Kesehatan Kabupaten/Kota</p>
            </div>
            <button
              onClick={handleOpenAddPkm}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-colors shadow-sm"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Tambah Puskesmas</span>
            </button>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200">
                <tr>
                  <th className="py-2.5 px-3 w-28">Kode Faskes</th>
                  <th className="py-2.5 px-3">Nama Puskesmas</th>
                  <th className="py-2.5 px-3 w-40">Kecamatan</th>
                  <th className="py-2.5 px-3 min-w-[200px]">Kepala Puskesmas</th>
                  <th className="py-2.5 px-3 w-28 text-center">Aksi (CRUD)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {puskesmasList.map((pkm) => (
                  <tr key={pkm.id} className="hover:bg-slate-50 transition-colors">
                    <td className="py-2.5 px-3 font-mono font-bold text-slate-700">{pkm.code}</td>
                    <td className="py-2.5 px-3 font-bold text-slate-900">{pkm.name}</td>
                    <td className="py-2.5 px-3 text-slate-600">{pkm.subdistrict}</td>
                    <td className="py-2.5 px-3 text-slate-800">{pkm.headName}</td>
                    <td className="py-2.5 px-3 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          onClick={() => handleOpenEditPkm(pkm)}
                          className="p-1.5 rounded bg-slate-100 hover:bg-emerald-50 text-slate-600 hover:text-emerald-700"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDeletePuskesmas(pkm)}
                          className="p-1.5 rounded bg-slate-100 hover:bg-rose-50 text-slate-600 hover:text-rose-700"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* 4. MASTER PEGAWAI & PENGGUNA TAB (RBAC SEPARATED) */}
      {/* ============================================================== */}
      {activeTab === 'users' && (
        <div className="space-y-5">
          {/* ==================== A. DINKES VIEW ==================== */}
          {isDinkesMode ? (
            <div className="space-y-4">
              {/* Otoritas Dinkes Banner */}
              <div className="p-4 rounded-xl bg-gradient-to-r from-emerald-900 to-slate-900 text-white shadow-md border border-emerald-700/40 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className="p-2.5 rounded-xl bg-emerald-500/20 border border-emerald-400/30 text-emerald-300 mt-0.5">
                    <ShieldCheck className="w-6 h-6" />
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded-full bg-emerald-500/30 text-emerald-200 border border-emerald-400/30 font-mono text-[10px] font-bold uppercase tracking-wider">
                        Hak Akses Dinas Kesehatan
                      </span>
                      <span className="text-xs text-slate-300">Level Kota / Kabupaten</span>
                    </div>
                    <h3 className="font-bold text-base text-white">
                      Tata Kelola Akun Administrator Puskesmas & Supervisi PIC
                    </h3>
                    <p className="text-xs text-slate-300 max-w-3xl leading-relaxed">
                      Sesuai regulasi sistem penilaian kinerja, <strong>Dinas Kesehatan berwenang penuh membuat, mengaktifkan, dan menugaskan akun Administrator untuk setiap Puskesmas</strong>. Masing-masing Administrator Puskesmas selanjutnya memiliki kewenangan mandiri untuk mendaftarkan dan menugaskan staf PIC di fasilitas kesehatannya.
                    </p>
                  </div>
                </div>
              </div>

              {/* Sub-Tabs: Admin Puskesmas vs Direktori PIC Seluruh Wilayah */}
              <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setDinkesUserSubTab('admin-pkm')}
                    className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                      dinkesUserSubTab === 'admin-pkm'
                        ? 'bg-emerald-600 text-white shadow-sm'
                        : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
                    }`}
                  >
                    <Key className="w-3.5 h-3.5" />
                    <span>Akun Administrator Puskesmas ({adminPuskesmasList.length})</span>
                  </button>
                  <button
                    onClick={() => setDinkesUserSubTab('all-pics')}
                    className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                      dinkesUserSubTab === 'all-pics'
                        ? 'bg-emerald-600 text-white shadow-sm'
                        : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
                    }`}
                  >
                    <Users className="w-3.5 h-3.5" />
                    <span>Direktori PIC Seluruh Faskes ({pics.length})</span>
                  </button>
                </div>

                {dinkesUserSubTab === 'admin-pkm' && (
                  <button
                    onClick={handleOpenAddAdminPkm}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-colors shadow-sm"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Buat Akun Admin Puskesmas</span>
                  </button>
                )}
              </div>

              {/* Sub-Tab 1: Akun Administrator Puskesmas */}
              {dinkesUserSubTab === 'admin-pkm' && (
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200">
                      <tr>
                        <th className="py-2.5 px-3">Nama Lengkap & NIP</th>
                        <th className="py-2.5 px-3">Puskesmas Ditugaskan</th>
                        <th className="py-2.5 px-3">Username & Email Sistem</th>
                        <th className="py-2.5 px-3">Kontak WhatsApp</th>
                        <th className="py-2.5 px-3 text-center">Status Akun</th>
                        <th className="py-2.5 px-3 w-32 text-center">Aksi (Dinkes)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {adminPuskesmasList.map((adm) => (
                        <tr key={adm.id} className="hover:bg-slate-50 transition-colors">
                          <td className="py-2.5 px-3">
                            <div className="flex items-center gap-2.5">
                              <div className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-800 font-bold flex items-center justify-center text-xs border border-emerald-300">
                                {adm.name.charAt(0)}
                              </div>
                              <div>
                                <p className="font-bold text-slate-900">{adm.name}</p>
                                <p className="text-[11px] font-mono text-slate-500">NIP: {adm.nip || '-'}</p>
                              </div>
                            </div>
                          </td>
                          <td className="py-2.5 px-3">
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-100 border border-slate-200 text-slate-800 font-semibold text-[11px]">
                              <Building2 className="w-3.5 h-3.5 text-emerald-600" />
                              <span>{adm.healthCenterName}</span>
                            </span>
                          </td>
                          <td className="py-2.5 px-3">
                            <div className="space-y-0.5">
                              <p className="font-mono font-bold text-slate-800 text-[11px]">@{adm.username}</p>
                              <p className="text-[10px] text-slate-500">{adm.email}</p>
                            </div>
                          </td>
                          <td className="py-2.5 px-3 font-mono font-semibold text-emerald-700">
                            <a
                              href={`https://wa.me/${adm.phone.replace(/[^0-9]/g, '')}`}
                              target="_blank"
                              rel="noreferrer"
                              className="hover:underline flex items-center gap-1"
                            >
                              <span>{adm.phone}</span>
                              <ExternalLink className="w-3 h-3 text-slate-400" />
                            </a>
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            <button
                              onClick={() => handleToggleAdminPkmStatus(adm)}
                              className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold border transition-colors ${
                                adm.status === 'ACTIVE'
                                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                                  : 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100'
                              }`}
                            >
                              <span className={`w-1.5 h-1.5 rounded-full ${adm.status === 'ACTIVE' ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                              <span>{adm.status === 'ACTIVE' ? 'Aktif' : 'Nonaktif'}</span>
                            </button>
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            <div className="flex items-center justify-center gap-1.5">
                              <button
                                onClick={() => handleOpenEditAdminPkm(adm)}
                                title="Ubah Akun Admin Puskesmas"
                                className="p-1.5 rounded bg-slate-100 hover:bg-emerald-50 text-slate-600 hover:text-emerald-700 transition-colors"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handleDeleteAdminPkm(adm)}
                                title="Hapus Akun Admin"
                                className="p-1.5 rounded bg-slate-100 hover:bg-rose-50 text-slate-600 hover:text-rose-700 transition-colors"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Sub-Tab 2: Direktori PIC Seluruh Faskes (Supervisi Dinkes) */}
              {dinkesUserSubTab === 'all-pics' && (
                <div className="space-y-3">
                  <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-slate-600">Filter Puskesmas:</span>
                      <select
                        value={pkmFilterForPics}
                        onChange={(e) => setPkmFilterForPics(e.target.value)}
                        className="bg-white border border-slate-300 rounded-lg px-2.5 py-1 text-xs font-semibold"
                      >
                        <option value="ALL">Semua Puskesmas ({pics.length} Staf)</option>
                        {puskesmasList.map((p) => (
                          <option key={p.id} value={p.name}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="text-[11px] text-slate-500 italic">
                      * Staf PIC didaftarkan dan ditugaskan secara mandiri oleh masing-masing Admin Puskesmas.
                    </div>
                  </div>

                  <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200">
                        <tr>
                          <th className="py-2.5 px-3">Nama PIC & NIP</th>
                          <th className="py-2.5 px-3">Puskesmas Asal</th>
                          <th className="py-2.5 px-3">Jabatan / Program Tanggung Jawab</th>
                          <th className="py-2.5 px-3 text-center">Beban Indikator</th>
                          <th className="py-2.5 px-3">Nomor WhatsApp</th>
                          <th className="py-2.5 px-3 text-center">Kewenangan</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {pics
                          .filter((p) => pkmFilterForPics === 'ALL' || p.healthCenterName === pkmFilterForPics)
                          .map((p) => (
                            <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                              <td className="py-2.5 px-3 font-bold text-slate-900 flex items-center gap-2.5">
                                <span className={`w-7 h-7 rounded-full ${p.avatarColor} text-white flex items-center justify-center font-bold text-xs`}>
                                  {p.name.charAt(0)}
                                </span>
                                <div>
                                  <p>{p.name}</p>
                                  <p className="text-[10px] font-mono text-slate-400 font-normal">NIP: {p.nip || '-'}</p>
                                </div>
                              </td>
                              <td className="py-2.5 px-3">
                                <span className="text-slate-700 font-medium">{p.healthCenterName || 'Puskesmas Kebonagung'}</span>
                              </td>
                              <td className="py-2.5 px-3 text-slate-600">{p.role}</td>
                              <td className="py-2.5 px-3 text-center">
                                <span className="font-mono font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-[11px]">
                                  {getAssignedCountForPic(p.id)} Elemen
                                </span>
                              </td>
                              <td className="py-2.5 px-3 font-mono text-emerald-700 font-semibold">{p.phone}</td>
                              <td className="py-2.5 px-3 text-center">
                                <span className="text-[10px] font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                                  Dikelola Puskesmas
                                </span>
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* ==================== B. PUSKESMAS VIEW ==================== */
            <div className="space-y-4">
              {/* Otonomi Puskesmas Banner */}
              <div className="p-4 rounded-xl bg-gradient-to-r from-teal-900 to-slate-900 text-white shadow-md border border-teal-700/40 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className="p-2.5 rounded-xl bg-teal-500/20 border border-teal-400/30 text-teal-300 mt-0.5">
                    <Building2 className="w-6 h-6" />
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded-full bg-teal-500/30 text-teal-200 border border-teal-400/30 font-mono text-[10px] font-bold uppercase tracking-wider">
                        Kewenangan Mandiri Puskesmas
                      </span>
                      <span className="text-xs font-bold text-white">{selectedPuskesmasName}</span>
                    </div>
                    <h3 className="font-bold text-base text-white">
                      Kelola Staf PIC Internal Penginput Elemen Penilaian
                    </h3>
                    <p className="text-xs text-slate-300 max-w-3xl leading-relaxed">
                      Sebagai Administrator di <strong>{selectedPuskesmasName}</strong>, Anda memiliki hak penuh untuk mendaftarkan, memperbarui, dan menugaskan staf PIC (Bidan, Apoteker, Sanitarian, Analis Lab, KTU, dll.) untuk menginput capaian bulanan dan bukti dukung pada 282 elemen penilaian.
                    </p>
                  </div>
                </div>

                <div className="shrink-0 p-3 bg-white/10 rounded-xl border border-white/10 text-right text-xs">
                  <p className="text-[10px] uppercase font-bold text-teal-300 tracking-wider">Otoritas Akun Admin</p>
                  <p className="text-white font-semibold mt-0.5">Dikelola oleh Dinas Kesehatan</p>
                  <p className="text-[10px] text-slate-300 mt-0.5">Hubungi Dinkes untuk rotasi Kapus/Admin</p>
                </div>
              </div>

              {/* Action Bar */}
              <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-slate-800 text-sm">
                    Daftar Staf PIC Internal {selectedPuskesmasName}
                  </h3>
                  <p className="text-xs text-slate-500">
                    Tenaga medis dan staf program yang ditugaskan menginput realisasi bulanan PKP
                  </p>
                </div>
                <button
                  onClick={handleOpenAddUser}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold transition-colors shadow-sm"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Tambah Staf PIC Internal</span>
                </button>
              </div>

              {/* Internal PIC Table */}
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200">
                    <tr>
                      <th className="py-2.5 px-3">Nama Lengkap & NIP</th>
                      <th className="py-2.5 px-3">Jabatan / Program Tanggung Jawab</th>
                      <th className="py-2.5 px-3 text-center">Beban Indikator</th>
                      <th className="py-2.5 px-3">Nomor WhatsApp</th>
                      <th className="py-2.5 px-3 text-center">Status</th>
                      <th className="py-2.5 px-3 w-28 text-center">Aksi (Puskesmas)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {pics
                      .filter((p) => !p.healthCenterName || p.healthCenterName === selectedPuskesmasName)
                      .map((p) => {
                        const assignedCount = getAssignedCountForPic(p.id);
                        return (
                          <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                            <td className="py-2.5 px-3">
                              <div className="flex items-center gap-2.5">
                                <span className={`w-7 h-7 rounded-full ${p.avatarColor} text-white flex items-center justify-center font-bold text-xs`}>
                                  {p.name.charAt(0)}
                                </span>
                                <div>
                                  <p className="font-bold text-slate-900">{p.name}</p>
                                  <p className="text-[10px] font-mono text-slate-500">NIP: {p.nip || '-'}</p>
                                </div>
                              </div>
                            </td>
                            <td className="py-2.5 px-3 text-slate-700 font-medium">{p.role}</td>
                            <td className="py-2.5 px-3 text-center">
                              <span className="font-mono font-bold px-2 py-0.5 rounded-full bg-teal-50 text-teal-800 border border-teal-200 text-[11px]">
                                {assignedCount} Elemen
                              </span>
                            </td>
                            <td className="py-2.5 px-3 font-mono text-emerald-700 font-semibold">
                              <a
                                href={`https://wa.me/${p.phone.replace(/[^0-9]/g, '')}`}
                                target="_blank"
                                rel="noreferrer"
                                className="hover:underline flex items-center gap-1"
                              >
                                <span>{p.phone}</span>
                                <ExternalLink className="w-3 h-3 text-slate-400" />
                              </a>
                            </td>
                            <td className="py-2.5 px-3 text-center">
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-semibold">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                <span>Aktif</span>
                              </span>
                            </td>
                            <td className="py-2.5 px-3 text-center">
                              <div className="flex items-center justify-center gap-1.5">
                                <button
                                  onClick={() => handleOpenEditUser(p)}
                                  title="Ubah Profil PIC"
                                  className="p-1.5 rounded bg-slate-100 hover:bg-emerald-50 text-slate-600 hover:text-emerald-700 transition-colors"
                                >
                                  <Edit2 className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => handleDeleteUser(p)}
                                  title="Hapus Staf PIC"
                                  className="p-1.5 rounded bg-slate-100 hover:bg-rose-50 text-slate-600 hover:text-rose-700 transition-colors"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ============================================================== */}
      {/* 5. AUDIT LOGS TAB */}
      {/* ============================================================== */}
      {activeTab === 'audit-logs' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h3 className="font-bold text-slate-800 text-sm">Riwayat Aktivitas & Jejak Audit (Audit Trail)</h3>
              <p className="text-xs text-slate-500">Mencatat setiap aksi perubahan data master, target, dan realisasi bulanan</p>
            </div>
            <span className="font-mono text-xs text-emerald-600 font-bold bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200">
              Live Logger Active
            </span>
          </div>

          <div className="divide-y divide-slate-100 max-h-[60vh] overflow-y-auto">
            {auditLogs.map((log) => (
              <div key={log.id} className="py-3 flex items-start justify-between gap-4 text-xs">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-800">{log.action}</span>
                    <span className="text-[10px] text-slate-400 font-mono">oleh {log.userName}</span>
                  </div>
                  <p className="text-slate-600 text-[11px]">{log.details}</p>
                </div>
                <span className="font-mono text-[10px] text-slate-400 whitespace-nowrap bg-slate-100 px-2 py-0.5 rounded">
                  {log.timestamp}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL: TAMBAH / EDIT INDIKATOR */}
      {/* ============================================================== */}
      {isIndModalOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden animate-scale-in">
            <div className="p-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <h3 className="font-bold text-slate-800 text-sm">
                {editingInd ? 'Ubah Master Indikator' : 'Tambah Master Indikator Baru'}
              </h3>
              <button onClick={() => setIsIndModalOpen(false)} className="p-1 text-slate-400 hover:text-slate-700">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveIndicator} className="p-5 space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-semibold text-slate-600 block mb-1">Klaster ILP:</label>
                  <select
                    value={indForm.klasterId}
                    onChange={(e) => setIndForm({ ...indForm, klasterId: Number(e.target.value) as KlasterId })}
                    className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 font-semibold"
                  >
                    <option value={1}>Klaster 1: Manajemen</option>
                    <option value={2}>Klaster 2: KIA</option>
                    <option value={3}>Klaster 3: Dewasa & Lansia</option>
                    <option value={4}>Klaster 4: P2M & Kesling</option>
                    <option value={5}>Klaster 5: Lintas Klaster</option>
                  </select>
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-slate-600 block mb-1">Kode Sub-klaster:</label>
                  <input
                    type="text"
                    value={indForm.sectionCode}
                    onChange={(e) => setIndForm({ ...indForm, sectionCode: e.target.value })}
                    placeholder="Contoh: 1.1 atau 2.2.5"
                    className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 font-mono font-bold"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-[11px] font-semibold text-slate-600 block mb-1">No Urut:</label>
                  <input
                    type="text"
                    value={indForm.no}
                    onChange={(e) => setIndForm({ ...indForm, no: e.target.value })}
                    placeholder="Contoh: 1."
                    className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 font-mono font-bold"
                    required
                  />
                </div>
                <div className="col-span-2">
                  <label className="text-[11px] font-semibold text-slate-600 block mb-1">Nama Kegiatan:</label>
                  <input
                    type="text"
                    value={indForm.kegiatan}
                    onChange={(e) => setIndForm({ ...indForm, kegiatan: e.target.value })}
                    placeholder="Nama kegiatan..."
                    className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="text-[11px] font-semibold text-slate-600 block mb-1">Nama Indikator Kinerja:</label>
                <input
                  type="text"
                  value={indForm.indikator}
                  onChange={(e) => setIndForm({ ...indForm, indikator: e.target.value })}
                  placeholder="Nama indikator kinerja resmi..."
                  className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 font-bold"
                  required
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-[11px] font-semibold text-slate-600 block mb-1">Target Display:</label>
                  <input
                    type="text"
                    value={indForm.targetDisplay}
                    onChange={(e) => setIndForm({ ...indForm, targetDisplay: e.target.value })}
                    placeholder="1.0 atau ≥ 90%"
                    className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 font-mono"
                    required
                  />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-slate-600 block mb-1">Satuan Sasaran:</label>
                  <input
                    type="text"
                    value={indForm.satuan}
                    onChange={(e) => setIndForm({ ...indForm, satuan: e.target.value })}
                    placeholder="Dokumen/Bumil/..."
                    className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5"
                    required
                  />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-slate-600 block mb-1">Arah Polaritas:</label>
                  <select
                    value={indForm.polarity}
                    onChange={(e) => setIndForm({ ...indForm, polarity: e.target.value as TargetPolarity })}
                    className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 font-semibold"
                  >
                    <option value="HIGHER_IS_BETTER">Lebih Besar Bagus (Normal)</option>
                    <option value="LOWER_IS_BETTER">Lebih Kecil Bagus (Invers)</option>
                    <option value="TIERED_BRACKETS">Rubrik Bertingkat (POR/DO)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-[11px] font-semibold text-slate-600 block mb-1">Petunjuk Teknis / Definisi Operasional (DO Kolom L):</label>
                <textarea
                  value={indForm.notes}
                  onChange={(e) => setIndForm({ ...indForm, notes: e.target.value })}
                  placeholder="Keterangan juknis atau cara pengisian..."
                  className="w-full h-16 p-2 bg-white border border-slate-300 rounded-lg"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsIndModalOpen(false)}
                  className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-semibold"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold shadow-sm"
                >
                  Simpan Indikator
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL: TAMBAH / EDIT PUSKESMAS */}
      {/* ============================================================== */}
      {isPkmModalOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden animate-scale-in">
            <div className="p-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <h3 className="font-bold text-slate-800 text-sm">
                {editingPkm ? 'Ubah Data Puskesmas' : 'Tambah Puskesmas Baru'}
              </h3>
              <button onClick={() => setIsPkmModalOpen(false)} className="p-1 text-slate-400 hover:text-slate-700">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSavePuskesmas} className="p-5 space-y-3 text-xs">
              <div>
                <label className="text-[11px] font-semibold text-slate-600 block mb-1">Nama Puskesmas:</label>
                <input
                  type="text"
                  value={pkmForm.name}
                  onChange={(e) => setPkmForm({ ...pkmForm, name: e.target.value })}
                  placeholder="Contoh: Puskesmas Wagir"
                  className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 font-bold"
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] font-semibold text-slate-600 block mb-1">Kode Faskes:</label>
                  <input
                    type="text"
                    value={pkmForm.code}
                    onChange={(e) => setPkmForm({ ...pkmForm, code: e.target.value })}
                    placeholder="P35070701"
                    className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 font-mono"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-slate-600 block mb-1">Kecamatan:</label>
                  <input
                    type="text"
                    value={pkmForm.subdistrict}
                    onChange={(e) => setPkmForm({ ...pkmForm, subdistrict: e.target.value })}
                    placeholder="Wagir"
                    className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5"
                  />
                </div>
              </div>
              <div>
                <label className="text-[11px] font-semibold text-slate-600 block mb-1">Nama Kepala Puskesmas:</label>
                <input
                  type="text"
                  value={pkmForm.headName}
                  onChange={(e) => setPkmForm({ ...pkmForm, headName: e.target.value })}
                  placeholder="dr. Contoh Nama, M.M"
                  className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsPkmModalOpen(false)}
                  className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-semibold"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold shadow-sm"
                >
                  Simpan Puskesmas
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL: TAMBAH / EDIT SUB-KLASTER */}
      {/* ============================================================== */}
      {isSubModalOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden animate-scale-in">
            <div className="p-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <h3 className="font-bold text-slate-800 text-sm">
                {editingSub ? 'Ubah Sub-klaster' : 'Tambah Sub-klaster Baru'}
              </h3>
              <button onClick={() => setIsSubModalOpen(false)} className="p-1 text-slate-400 hover:text-slate-700">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSaveSubKlaster} className="p-5 space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] font-semibold text-slate-600 block mb-1">Klaster Induk:</label>
                  <select
                    value={subForm.klasterId}
                    onChange={(e) => setSubForm({ ...subForm, klasterId: Number(e.target.value) })}
                    className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 font-semibold"
                  >
                    <option value={1}>Klaster 1</option>
                    <option value={2}>Klaster 2</option>
                    <option value={3}>Klaster 3</option>
                    <option value={4}>Klaster 4</option>
                    <option value={5}>Klaster 5</option>
                  </select>
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-slate-600 block mb-1">Kode Sub-klaster:</label>
                  <input
                    type="text"
                    value={subForm.code}
                    onChange={(e) => setSubForm({ ...subForm, code: e.target.value })}
                    placeholder="Contoh: 1.13"
                    className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 font-mono font-bold"
                    required
                  />
                </div>
              </div>
              <div>
                <label className="text-[11px] font-semibold text-slate-600 block mb-1">Nama Sub-klaster:</label>
                <input
                  type="text"
                  value={subForm.name}
                  onChange={(e) => setSubForm({ ...subForm, name: e.target.value })}
                  placeholder="Nama sub-klaster..."
                  className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 font-bold"
                  required
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsSubModalOpen(false)}
                  className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-semibold"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold shadow-sm"
                >
                  Simpan Sub-klaster
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL: BUAT / EDIT AKUN ADMIN PUSKESMAS (DINKES PRIVILEGE) */}
      {/* ============================================================== */}
      {isAdminPkmModalOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden animate-scale-in">
            <div className="p-4 bg-emerald-900 text-white flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-emerald-800 rounded-lg text-emerald-300">
                  <Key className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-sm">
                    {editingAdminPkm ? 'Ubah Akun Admin Puskesmas' : 'Buat Akun Administrator Puskesmas'}
                  </h3>
                  <p className="text-[11px] text-emerald-200">
                    Kewenangan Dinas Kesehatan Kota / Kabupaten
                  </p>
                </div>
              </div>
              <button 
                onClick={() => setIsAdminPkmModalOpen(false)} 
                className="p-1 text-emerald-300 hover:text-white rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveAdminPkm} className="p-5 space-y-3.5 text-xs">
              <div>
                <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                  Puskesmas yang Ditugaskan:
                </label>
                <select
                  value={adminPkmForm.healthCenterId}
                  onChange={(e) => {
                    const selected = puskesmasList.find(p => p.id === e.target.value);
                    setAdminPkmForm({
                      ...adminPkmForm,
                      healthCenterId: e.target.value,
                      healthCenterName: selected ? selected.name : adminPkmForm.healthCenterName
                    });
                  }}
                  className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 font-bold text-slate-800"
                  required
                >
                  {puskesmasList.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.code}) - Kec. {p.subdistrict}
                    </option>
                  ))}
                </select>
                <p className="text-[10px] text-slate-400 mt-0.5">
                  Akun ini akan memiliki akses pengelolaan penuh terhadap data capaian dan staf PIC di Puskesmas yang dipilih.
                </p>
              </div>

              <div>
                <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                  Nama Lengkap & Gelar Administrator:
                </label>
                <input
                  type="text"
                  value={adminPkmForm.name}
                  onChange={(e) => setAdminPkmForm({ ...adminPkmForm, name: e.target.value })}
                  placeholder="Contoh: dr. H. Rahmat Hidayat, M.Kes"
                  className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 font-bold"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                    NIP / NIK Pegawai:
                  </label>
                  <input
                    type="text"
                    value={adminPkmForm.nip}
                    onChange={(e) => setAdminPkmForm({ ...adminPkmForm, nip: e.target.value })}
                    placeholder="19750812 200212 1 003"
                    className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 font-mono"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                    Username Sistem:
                  </label>
                  <input
                    type="text"
                    value={adminPkmForm.username}
                    onChange={(e) => setAdminPkmForm({ ...adminPkmForm, username: e.target.value })}
                    placeholder="admin.kebonagung"
                    className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 font-mono font-bold"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                    Email Kedinasan:
                  </label>
                  <input
                    type="email"
                    value={adminPkmForm.email}
                    onChange={(e) => setAdminPkmForm({ ...adminPkmForm, email: e.target.value })}
                    placeholder="admin.pkm@dinkes.go.id"
                    className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                    Nomor WhatsApp:
                  </label>
                  <input
                    type="text"
                    value={adminPkmForm.phone}
                    onChange={(e) => setAdminPkmForm({ ...adminPkmForm, phone: e.target.value })}
                    placeholder="08113456701"
                    className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 font-mono"
                    required
                  />
                </div>
              </div>

              {!editingAdminPkm && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl space-y-1">
                  <div className="flex items-center gap-1.5 text-amber-800 font-bold text-[11px]">
                    <Lock className="w-3.5 h-3.5" />
                    <span>Password Awal Akun:</span>
                  </div>
                  <p className="font-mono text-xs font-bold text-slate-700 bg-white px-2 py-1 rounded border border-amber-300 inline-block">
                    {adminPkmForm.tempPassword || 'Puskesmas2026!'}
                  </p>
                  <p className="text-[10px] text-amber-700">
                    Administrator wajib mengganti password saat pertama kali masuk ke aplikasi SIPKP.
                  </p>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsAdminPkmModalOpen(false)}
                  className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-semibold"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold shadow-sm"
                >
                  {editingAdminPkm ? 'Perbarui Akun Admin' : 'Terbitkan Akun Admin Puskesmas'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL: TAMBAH / EDIT STAF PIC INTERNAL (PUSKESMAS PRIVILEGE) */}
      {/* ============================================================== */}
      {isUserModalOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden animate-scale-in">
            <div className="p-4 bg-teal-800 text-white flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-teal-700 rounded-lg text-teal-200">
                  <Users className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-sm">
                    {editingUser ? 'Ubah Profil Staf PIC' : 'Tambah Staf PIC Internal Baru'}
                  </h3>
                  <p className="text-[11px] text-teal-200">
                    {selectedPuskesmasName}
                  </p>
                </div>
              </div>
              <button 
                onClick={() => setIsUserModalOpen(false)} 
                className="p-1 text-teal-300 hover:text-white rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveUser} className="p-5 space-y-3.5 text-xs">
              <div className="p-2.5 bg-teal-50 border border-teal-200 rounded-xl flex items-center gap-2">
                <Building2 className="w-4 h-4 text-teal-700 shrink-0" />
                <span className="text-teal-900 text-[11px]">
                  Staf ini didaftarkan untuk faskes: <strong>{selectedPuskesmasName}</strong>
                </span>
              </div>

              <div>
                <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                  Nama Lengkap & Gelar Tenaga Medis / Staf:
                </label>
                <input
                  type="text"
                  value={userForm.name}
                  onChange={(e) => setUserForm({ ...userForm, name: e.target.value })}
                  placeholder="Contoh: Bd. Siti Aminah, S.Tr.Keb"
                  className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 font-bold"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                    NIP / NIK (Opsional):
                  </label>
                  <input
                    type="text"
                    value={userForm.nip}
                    onChange={(e) => setUserForm({ ...userForm, nip: e.target.value })}
                    placeholder="19880412 201101 2 004"
                    className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 font-mono"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                    Nomor WhatsApp (Aktif):
                  </label>
                  <input
                    type="text"
                    value={userForm.phone}
                    onChange={(e) => setUserForm({ ...userForm, phone: e.target.value })}
                    placeholder="081234567801"
                    className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 font-mono"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                  Jabatan / Penanggung Jawab Program:
                </label>
                <input
                  type="text"
                  value={userForm.role}
                  onChange={(e) => setUserForm({ ...userForm, role: e.target.value })}
                  placeholder="Contoh: Bidan Koordinator (KIA & KB) / Sanitarian"
                  className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 font-medium"
                  required
                />
              </div>

              <div>
                <label className="text-[11px] font-semibold text-slate-700 block mb-1">
                  Email (Opsional):
                </label>
                <input
                  type="email"
                  value={userForm.email}
                  onChange={(e) => setUserForm({ ...userForm, email: e.target.value })}
                  placeholder="siti.aminah@gmail.com"
                  className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsUserModalOpen(false)}
                  className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-semibold"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-teal-600 hover:bg-teal-700 text-white rounded-lg font-bold shadow-sm"
                >
                  {editingUser ? 'Perbarui Profil PIC' : 'Daftarkan Staf PIC Internal'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
