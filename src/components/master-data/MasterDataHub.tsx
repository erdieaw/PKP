import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { pkpStore, type ManagedHealthCenter } from '../../services/apiStore';
import type { AdminPuskesmasUser, PicUser } from '../../types/pkp';
import { Database, Layers, Building2, Users, History, Plus, Edit2, X, CheckCircle2, ShieldCheck } from 'lucide-react';
import { CatalogManager } from './CatalogManager';
import { ResetPasswordDialog } from './ResetPasswordDialog';

type MasterTab = 'indicators' | 'subklasters' | 'puskesmas' | 'users' | 'audit-logs';
interface MasterDataHubProps {
  isDinkesMode?: boolean;
  selectedPuskesmasName?: string;
}
const emptyUser = { name: '', username: '', password: '', nip: '', phone: '', email: '', status: 'ACTIVE' as 'ACTIVE' | 'INACTIVE' };
const emptyCenter = { name: '', code: '', district: '', headName: '', address: '' };
const inputClass = 'mt-1 w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-emerald-500';
const buttonClass = 'inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold disabled:opacity-50';

export const MasterDataHub: React.FC<MasterDataHubProps> = () => {
  useSyncExternalStore(pkpStore.subscribe, pkpStore.getSnapshot, pkpStore.getServerSnapshot);
  const user = pkpStore.getCurrentUser();
  const isDinkes = user.role === 'DINKES_ADMIN';
  const centerId = pkpStore.getSelectedHealthCenterId();
  const canManagePics = user.role === 'ADMIN_PUSKESMAS' && user.healthCenterId === centerId;
  const [activeTab, setActiveTab] = useState<MasterTab>('indicators');
  const [userTab, setUserTab] = useState<'admins' | 'pics'>('admins');
  const [modal, setModal] = useState<'center' | 'user' | null>(null);
  const [editing, setEditing] = useState<PicUser | AdminPuskesmasUser | null>(null);
  const [account, setAccount] = useState({ ...emptyUser });
  const [center, setCenter] = useState({ ...emptyCenter });
  const [editingCenter, setEditingCenter] = useState<ManagedHealthCenter | null>(null);
  const [resetAccount, setResetAccount] = useState<PicUser | AdminPuskesmasUser | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const disabled = pending || pkpStore.isMutating() || pkpStore.getLoadState().loading;
  useEffect(() => {
    setModal(null); setEditing(null); setAccount({ ...emptyUser }); setResetAccount(null); setError(null); setSuccess(null);
  }, [centerId]);

  const indicators = pkpStore.getIndicators();
  const sections = pkpStore.getSubKlasters();
  const centers = pkpStore.getPuskesmasList();
  const pics = pkpStore.getPicsByHealthCenter(centerId ?? undefined);
  const admins = pkpStore.getAdminPuskesmasList().filter(a => a.healthCenterId === centerId);
  const accounts = isDinkes && userTab === 'admins' ? admins : pics;
  const canManageAccounts = isDinkes || canManagePics;
  const managingAdmins = isDinkes && userTab === 'admins';
  const run = async (action: () => Promise<unknown>, message: string) => {
    if (disabled) return;
    setPending(true); setError(null); setSuccess(null);
    try { await action(); setSuccess(message); }
    catch (error) { setError(error instanceof Error ? error.message : 'Penyimpanan gagal. Periksa data dan coba lagi.'); }
    finally { setPending(false); }
  };
  const openAccount = (row: PicUser | AdminPuskesmasUser | null) => {
    setEditing(row);
    setAccount(row ? { ...emptyUser, name: row.name, nip: row.nip ?? '', phone: row.phone ?? '', email: row.email ?? '', status: row.status ?? 'ACTIVE' } : { ...emptyUser });
    setError(null); setModal('user');
  };
  const saveAccount = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canManageAccounts || !centerId || disabled) return;
    if (!account.name.trim()) { setError('Nama lengkap wajib diisi.'); return; }
    if (!editing && (!/^[A-Za-z0-9._-]{3,100}$/.test(account.username.trim()) || account.password.length < 12)) {
      setError('Username harus 3-100 karakter: huruf, angka, titik, garis bawah atau tanda hubung. Password minimal 12 karakter.'); return;
    }
    const profile = { name: account.name.trim(), phone: account.phone.trim(), email: account.email.trim() || undefined, status: account.status };
    if (editing && editing.status !== 'INACTIVE' && profile.status === 'INACTIVE' && !window.confirm(`Nonaktifkan akun ${editing.name}? Akun tidak dihapus, tetapi pengguna tidak dapat masuk.`)) return;
    void run(async () => {
      if (editing) {
        if (editing.healthCenterId !== centerId) throw new Error('Akun di luar Puskesmas terpilih.');
        if (managingAdmins) await pkpStore.updateAdminPuskesmas(editing.id, profile);
        else await pkpStore.updatePic(editing.id, profile);
      } else {
        const data = { ...profile, username: account.username.trim(), password: account.password, nip: account.nip.trim() || undefined, phone: account.phone.trim() || undefined };
        if (managingAdmins) await pkpStore.addAdminPuskesmas(data);
        else await pkpStore.addPic(data);
      }
      setAccount({ ...emptyUser }); setEditing(null); setModal(null);
    }, editing ? 'Profil akun berhasil diperbarui.' : 'Akun berhasil dibuat. Kredensial telah dikosongkan dari formulir.');
  };
  const deactivate = (row: PicUser | AdminPuskesmasUser) => {
    if (!canManageAccounts || row.healthCenterId !== centerId || disabled) return;
    if (!window.confirm(`Nonaktifkan akun ${row.name}? Akun tidak dihapus. Pengguna tidak dapat masuk selama akun nonaktif.`)) return;
    void run(() => isDinkes ? pkpStore.deleteAdminPuskesmas(row.id) : pkpStore.deletePic(row.id), `Akun ${row.name} berhasil dinonaktifkan, bukan dihapus.`);
  };
  const saveCenter = (event: React.FormEvent) => {
    event.preventDefault();
    if ((!isDinkes && (!editingCenter || editingCenter.id !== user.healthCenterId)) || disabled) return;
    if (!center.name.trim() || !center.district.trim() || !/^[A-Za-z0-9_-]{1,50}$/.test(center.code.trim())) {
      setError('Isi nama, kecamatan, dan kode faskes 1-50 karakter (huruf, angka, garis bawah atau tanda hubung).'); return;
    }
    void run(async () => {
      const data = { name: center.name.trim(), code: center.code.trim(), district: center.district.trim(), headName: center.headName.trim(), address: center.address.trim() };
      if (editingCenter) await pkpStore.updatePuskesmas(editingCenter.id, data);
      else await pkpStore.addPuskesmas(data);
      setCenter({ ...emptyCenter }); setModal(null);
    }, editingCenter ? 'Profil Puskesmas diperbarui.' : 'Puskesmas berhasil didaftarkan.');
  };
  const closeModal = () => { if (!pending) { setModal(null); setAccount({ ...emptyUser }); setEditing(null); setError(null); } };

  if (user.role === 'PIC') return <p role="alert">PIC tidak memiliki akses ke pengelolaan master.</p>;

  return <div className="space-y-6">
    <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-2">
      <div className="flex items-center gap-2 text-emerald-600 font-bold text-xs uppercase tracking-wider"><Database className="w-4 h-4" />Pusat Data Master Sistem PKP</div>
      <h2 className="text-xl font-bold text-slate-800">Kelola Master Data</h2>
      <p className="text-xs text-slate-500">Katalog indikator dan bagian berlaku untuk seluruh Puskesmas. Pengelolaan akun mengikuti kewenangan dan Puskesmas terpilih.</p>
      {success && <p role="status" className="flex items-center gap-2 p-3 bg-emerald-50 text-emerald-700 rounded-lg text-xs"><CheckCircle2 className="w-4 h-4" />{success}</p>}
    </div>
    {error && !modal && <p role="alert" className="p-3 bg-rose-50 text-rose-700 rounded-lg text-sm">{error}</p>}
    <div className="flex items-center gap-2 overflow-x-auto pb-1">
      {([
        ['indicators', `Master Indikator (${indicators.length})`, Database],
        ['subklasters', `Master Klaster & Sub (${sections.length})`, Layers],
        ['puskesmas', `Master Puskesmas (${centers.length})`, Building2],
        ['users', 'Master Pengguna & Staf PIC', Users],
        ['audit-logs', 'Log Audit & Aktivitas', History],
      ] as const).map(([id, label, Icon]) => <button key={id} disabled={pending} onClick={() => setActiveTab(id)} className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap ${activeTab === id ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 border border-slate-200'}`}><Icon className="w-3.5 h-3.5" />{label}</button>)}
    </div>

    {(activeTab === 'indicators' || activeTab === 'subklasters') && <CatalogManager kind={activeTab} />}
    {activeTab === 'puskesmas' && <div className="space-y-4">
      <div className="bg-white p-4 rounded-xl border border-slate-200 flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-bold text-sm text-slate-800">Daftar Fasilitas Pelayanan Kesehatan</h3><p className="text-xs text-slate-500">Arsip mempertahankan data dan audit, serta mencabut seluruh sesi Puskesmas.</p></div>{isDinkes && <button disabled={disabled} onClick={() => { setEditingCenter(null); setCenter({ ...emptyCenter }); setError(null); setModal('center'); }} className={buttonClass}><Plus className="w-3.5 h-3.5" />Tambah Puskesmas</button>}</div>
      <div className="space-y-2">{centers.map(c => <div key={c.id} className="p-3 bg-white border rounded-lg flex flex-wrap items-center gap-3"><span className="font-semibold">{c.name}</span><span className="text-xs">{c.isActive === false ? 'Arsip' : 'Aktif'}</span>{(isDinkes || c.id === user.healthCenterId) && <button className="text-xs underline" disabled={disabled} onClick={() => { setEditingCenter(c); setCenter({ name: c.name, code: c.code, district: c.subdistrict, headName: c.headName ?? '', address: c.address ?? '' }); setModal('center'); }}>Ubah Profil</button>}{isDinkes && <button className="text-xs underline" disabled={disabled} onClick={() => { if (window.confirm(c.isActive === false ? `Pulihkan ${c.name}?` : `Arsipkan ${c.name}? Seluruh sesi pengguna Puskesmas ini dicabut. Data dan audit tetap disimpan.`)) void run(() => c.isActive === false ? pkpStore.updatePuskesmas(c.id, { isActive: true }) : pkpStore.deletePuskesmas(c.id), 'Status Puskesmas diperbarui.'); }}>{c.isActive === false ? 'Pulihkan' : 'Arsipkan'}</button>}</div>)}</div>
      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto"><table className="w-full text-left text-xs"><thead className="bg-slate-100"><tr>{['Kode Faskes', 'Nama Puskesmas', 'Kecamatan', 'Kepala Puskesmas'].map(h => <th key={h} className="p-3">{h}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{centers.map(c => <tr key={c.id}><td className="p-3 font-mono">{c.code}</td><td className="p-3 font-bold">{c.name}</td><td className="p-3">{c.subdistrict}</td><td className="p-3">{c.headName || '-'}</td></tr>)}</tbody></table></div>
    </div>}

    {activeTab === 'users' && <div className="space-y-4">
      <div className="p-4 rounded-xl bg-slate-900 text-white flex items-start gap-3"><ShieldCheck className="w-6 h-6 text-emerald-300 shrink-0" /><div><h3 className="font-bold text-sm">{isDinkes ? 'Tata Kelola Administrator & Supervisi PIC' : 'Kelola Staf PIC Internal'}</h3><p className="text-xs text-slate-300 mt-1">Lingkup: {pkpStore.getSelectedHealthCenter()?.name ?? 'Pilih Puskesmas'}. {isDinkes ? 'Admin yang dibuat ditugaskan ke Puskesmas terpilih. Gunakan pemilih Puskesmas aplikasi untuk mengganti lingkup.' : 'Administrator hanya dapat mengelola PIC pada Puskesmasnya sendiri.'}</p></div></div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {isDinkes ? <div className="flex gap-2">{(['admins', 'pics'] as const).map(t => <button key={t} disabled={pending} onClick={() => setUserTab(t)} className={`px-3 py-2 rounded-lg text-xs font-bold ${userTab === t ? 'bg-emerald-600 text-white' : 'bg-white border text-slate-600'}`}>{t === 'admins' ? 'Administrator Puskesmas' : 'Direktori PIC Terpilih'}</button>)}</div> : <h3 className="text-sm font-bold text-slate-800">Staf PIC Terdaftar</h3>}
        {canManageAccounts && <button disabled={disabled || !centerId} onClick={() => openAccount(null)} className={buttonClass}><Plus className="w-3.5 h-3.5" />{managingAdmins ? 'Buat Akun Admin Puskesmas' : 'Tambah Staf PIC Internal'}</button>}
      </div>
      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto"><table className="w-full text-left text-xs"><thead className="bg-slate-100"><tr>{['Nama & NIP', 'Peran Sistem', 'Kontak', 'Status', 'Aksi'].map(h => <th key={h} className="p-3">{h}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{accounts.map(a => <tr key={a.id} className="hover:bg-slate-50"><td className="p-3"><p className="font-bold text-slate-800">{a.name}</p><p className="text-slate-500 font-mono">NIP: {a.nip || '-'}</p></td><td className="p-3">{isDinkes && userTab === 'admins' ? 'Admin Puskesmas' : 'PIC'}</td><td className="p-3"><p>{a.phone || '-'}</p><p className="text-slate-500">{a.email || '-'}</p></td><td className="p-3"><span className={`px-2 py-1 rounded-full font-semibold ${a.status === 'ACTIVE' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>{a.status === 'ACTIVE' ? 'Aktif' : 'Nonaktif'}</span></td><td className="p-3">{canManageAccounts && <div className="flex gap-2"><button disabled={disabled} title="Ubah profil akun" onClick={() => openAccount(a)} className="p-2 bg-slate-100 rounded text-slate-600"><Edit2 className="w-3.5 h-3.5" /></button>{a.status === 'ACTIVE' && <button disabled={disabled} onClick={() => deactivate(a)} className="px-2 py-1 rounded border text-rose-700 disabled:opacity-50">Nonaktifkan</button>}</div>}</td></tr>)}</tbody></table>{!accounts.length && <p className="p-4 text-sm text-slate-500">Belum ada akun pada Puskesmas terpilih.</p>}</div>
    </div>}

    {activeTab === 'audit-logs' && <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto"><table className="w-full text-left text-xs"><thead className="bg-slate-100"><tr>{['Waktu', 'Pengguna', 'Aktivitas', 'Detail'].map(h => <th key={h} className="p-3">{h}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{pkpStore.getAuditLogs().map(log => <tr key={log.id}><td className="p-3 whitespace-nowrap">{new Date(log.timestamp).toLocaleString('id-ID')}</td><td className="p-3">{log.userName}</td><td className="p-3">{log.action}</td><td className="p-3 break-words max-w-lg">{log.details}</td></tr>)}</tbody></table></div>}

    {activeTab === 'users' && canManageAccounts && <div className="space-y-2">{accounts.map(a => <div key={a.id} className="flex flex-wrap gap-3 text-xs items-center"><span>{a.name}</span><button disabled={disabled} className="underline" onClick={() => setResetAccount(a)}>Reset Password</button>{a.status !== 'ACTIVE' && <button disabled={disabled} className="underline" onClick={() => { if (window.confirm(`Aktifkan kembali akun ${a.name}?`)) void run(() => pkpStore.updatePic(a.id, { status: 'ACTIVE' }), 'Akun diaktifkan kembali.'); }}>Aktifkan Kembali</button>}</div>)}</div>}
    {resetAccount && <ResetPasswordDialog key={`${centerId}:${resetAccount.id}`} userId={resetAccount.id} name={resetAccount.name} onClose={() => setResetAccount(null)} onSuccess={setSuccess} />}
    {modal && <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div role="dialog" aria-modal="true" aria-label={modal === 'center' ? 'Tambah Puskesmas' : 'Profil akun'} className="w-full max-w-xl max-h-[90vh] overflow-y-auto bg-white rounded-2xl shadow-2xl border border-slate-200">
        <div className="p-5 bg-slate-50 border-b flex items-center justify-between"><h3 className="font-bold text-slate-800">{modal === 'center' ? editingCenter ? 'Ubah Profil Puskesmas' : 'Tambah Puskesmas' : editing ? 'Ubah Profil Akun' : managingAdmins ? 'Buat Akun Admin Puskesmas' : 'Tambah Staf PIC'}</h3><button disabled={pending} onClick={closeModal} aria-label="Tutup" className="p-2 rounded-lg hover:bg-slate-200"><X className="w-5 h-5" /></button></div>
        <form onSubmit={modal === 'center' ? saveCenter : saveAccount} className="p-5">
          <fieldset disabled={disabled} className="space-y-4">
            {error && <p role="alert" className="p-3 bg-rose-50 text-rose-700 rounded-lg text-xs">{error}</p>}
            {modal === 'center' ? <>
              <label className="block text-xs font-semibold text-slate-600">Nama Puskesmas *<input required maxLength={200} value={center.name} onChange={e => setCenter({ ...center, name: e.target.value })} className={inputClass} /></label>
              <label className="block text-xs font-semibold text-slate-600">Kode Faskes *<input disabled={!!editingCenter} required pattern={'[A-Za-z0-9_\\-]{1,50}'} value={center.code} onChange={e => setCenter({ ...center, code: e.target.value })} className={inputClass} /></label>
              <label className="block text-xs font-semibold text-slate-600">Kecamatan *<input required maxLength={200} value={center.district} onChange={e => setCenter({ ...center, district: e.target.value })} className={inputClass} /></label>
              <label className="block text-xs font-semibold text-slate-600">Kepala Puskesmas<input maxLength={200} value={center.headName} onChange={e => setCenter({ ...center, headName: e.target.value })} className={inputClass} /></label>
              <label className="block text-xs font-semibold text-slate-600">Alamat<input maxLength={1000} value={center.address} onChange={e => setCenter({ ...center, address: e.target.value })} className={inputClass} /></label>
            </> : <>
              <p className="text-xs text-slate-500">Puskesmas: {pkpStore.getSelectedHealthCenter()?.name}. Peran sistem: {managingAdmins ? 'ADMIN_PUSKESMAS' : 'PIC'}. Jabatan/program tidak disimpan.</p>
              <label className="block text-xs font-semibold text-slate-600">Nama Lengkap *<input required maxLength={200} value={account.name} onChange={e => setAccount({ ...account, name: e.target.value })} className={inputClass} /></label>
              {!editing && <>
                <label className="block text-xs font-semibold text-slate-600">Username *<input autoComplete="off" required pattern={'[A-Za-z0-9._\\-]{3,100}'} value={account.username} onChange={e => setAccount({ ...account, username: e.target.value })} className={inputClass} /><span className="text-slate-400">3-100 karakter: huruf, angka, titik, garis bawah atau tanda hubung.</span></label>
                <label className="block text-xs font-semibold text-slate-600">Password *<input type="password" autoComplete="new-password" required minLength={12} maxLength={256} value={account.password} onChange={e => setAccount({ ...account, password: e.target.value })} className={inputClass} /><span className="text-slate-400">Minimal 12 karakter. Tentukan password secara eksplisit.</span></label>
                <label className="block text-xs font-semibold text-slate-600">NIP (opsional)<input maxLength={50} value={account.nip} onChange={e => setAccount({ ...account, nip: e.target.value })} className={inputClass} /></label>
              </>}
              <label className="block text-xs font-semibold text-slate-600">Telepon (opsional)<input maxLength={50} value={account.phone} onChange={e => setAccount({ ...account, phone: e.target.value })} className={inputClass} /></label>
              <label className="block text-xs font-semibold text-slate-600">Email (opsional)<input type="email" maxLength={254} value={account.email} onChange={e => setAccount({ ...account, email: e.target.value })} className={inputClass} /></label>
              {editing && <label className="block text-xs font-semibold text-slate-600">Status<select value={account.status} onChange={e => setAccount({ ...account, status: e.target.value as 'ACTIVE' | 'INACTIVE' })} className={inputClass}><option value="ACTIVE">Aktif</option><option value="INACTIVE">Nonaktif</option></select></label>}
            </>}
            <div className="flex justify-end gap-2"><button type="button" onClick={closeModal} className="px-3 py-2 text-xs text-slate-600">Batal</button><button type="submit" className={buttonClass}>{pending ? 'Menyimpan...' : 'Simpan'}</button></div>
          </fieldset>
        </form>
      </div>
    </div>}
  </div>;
};
