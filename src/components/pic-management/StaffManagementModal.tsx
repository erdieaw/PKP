import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { pkpStore } from '../../services/apiStore';
import { Users, UserPlus, X, Check, Building2, ShieldCheck } from 'lucide-react';
import { ResetPasswordDialog } from '../master-data/ResetPasswordDialog';

interface StaffManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  isDinkesMode?: boolean;
  selectedPuskesmasName?: string;
}

export const StaffManagementModal: React.FC<StaffManagementModalProps> = ({ 
  isOpen, 
  onClose,
  isDinkesMode = false,
  selectedPuskesmasName = ''
}) => {
  useSyncExternalStore(pkpStore.subscribe, pkpStore.getSnapshot, pkpStore.getServerSnapshot);
  const [name, setName] = useState('');
  const [nip, setNip] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetPic, setResetPic] = useState<{ id: string; name: string } | null>(null);
  const user = pkpStore.getCurrentUser();
  const canCreate = user.role === 'ADMIN_PUSKESMAS' && user.healthCenterId === pkpStore.getSelectedHealthCenterId();
  const centerId = pkpStore.getSelectedHealthCenterId();
  useEffect(() => {
    setName(''); setNip(''); setUsername(''); setPassword(''); setPhone(''); setEmail(''); setError(null); setToast(null); setResetPic(null);
  }, [isOpen, centerId]);

  if (!isOpen) return null;

  const filteredPics = pkpStore.getPicsByHealthCenter(pkpStore.getSelectedHealthCenterId() ?? undefined);
  const scopeName = pkpStore.getSelectedHealthCenter()?.name ?? selectedPuskesmasName;

  const handleAddStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canCreate || pending) return;
    setError(null); setToast(null);
    if (!name.trim() || !/^[A-Za-z0-9._-]{3,100}$/.test(username.trim()) || password.length < 12) {
      setError('Isi nama, username 3-100 karakter (huruf, angka, titik, garis bawah atau tanda hubung), dan password minimal 12 karakter.');
      return;
    }
    setPending(true);
    try {
    await pkpStore.addPic({ name: name.trim(), username: username.trim(), password, nip: nip.trim() || undefined, phone: phone.trim() || undefined, email: email.trim() || undefined });
    setName('');
    setNip('');
    setUsername('');
    setPassword('');
    setPhone('');
    setEmail('');
    setToast(`Staf PIC ${name.trim()} berhasil didaftarkan untuk ${scopeName}!`);
    setTimeout(() => setToast(null), 3000);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Pendaftaran gagal. Periksa data dan coba lagi.');
    } finally { setPending(false); }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div 
        className="w-full max-w-xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className={`p-5 border-b flex items-center justify-between ${isDinkesMode ? 'bg-slate-900 text-white border-slate-800' : 'bg-teal-900 text-white border-teal-800'}`}>
          <div className="flex items-center gap-2.5">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${isDinkesMode ? 'bg-emerald-500/20 text-emerald-300' : 'bg-teal-500/20 text-teal-300'}`}>
              {isDinkesMode ? <ShieldCheck className="w-4 h-4" /> : <Users className="w-4 h-4" />}
            </div>
            <div>
              <h3 className="font-bold text-sm text-white">
                {isDinkesMode 
                  ? `Direktori Staf PIC - ${scopeName}`
                  : `Kelola Staf PIC Internal - ${scopeName}`
                }
              </h3>
              <p className="text-[11px] text-slate-300">
                {isDinkesMode 
                   ? `Supervisi staf penanggung jawab ${pkpStore.getIndicators().length} indikator aktif`
                  : 'Kewenangan mandiri Puskesmas untuk mendaftarkan dan menugaskan staf'
                }
              </p>
            </div>
          </div>
          <button 
            disabled={pending}
            aria-label="Tutup manajemen staf"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-5 text-xs">
          {error && <p role="alert" className="p-3 bg-rose-50 text-rose-700 rounded-xl">{error}</p>}
          <p className="font-semibold text-slate-600">Lingkup: {scopeName}</p>
          {toast && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl font-semibold flex items-center gap-2">
              <Check className="w-4 h-4 text-emerald-600" />
              <span>{toast}</span>
            </div>
          )}

          {isDinkesMode ? (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-900 text-[11px] space-y-1">
              <p className="font-bold flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                <span>Kewenangan Administrator Puskesmas vs PIC:</span>
              </p>
              <p>
                Dinas Kesehatan berwenang membuat <strong>Akun Administrator Puskesmas</strong> melalui menu <em>Pusat Data Master</em>. Setiap Puskesmas memiliki wewenang mandiri mendaftarkan staf PIC mereka di bawah ini.
              </p>
            </div>
          ) : (
            <div className="p-3 bg-teal-50 border border-teal-200 rounded-xl text-teal-900 text-[11px] flex items-center gap-2">
              <Building2 className="w-4 h-4 text-teal-700 shrink-0" />
              <span>
                Faskes Aktif: <strong>{scopeName}</strong>. Seluruh PIC yang didaftarkan di sini hanya akan bertanggung jawab pada data Puskesmas ini.
              </span>
            </div>
          )}

          {/* Current Staff List */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="font-bold text-slate-700 uppercase tracking-wider text-[11px]">
                 Staf PIC Puskesmas Terpilih ({filteredPics.length} Orang)
              </h4>
            </div>
            <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl max-h-52 overflow-y-auto">
              {filteredPics.map(p => (
                <div key={p.id} className="p-3 flex items-center justify-between hover:bg-slate-50">
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-full ${p.avatarColor} text-white font-bold flex items-center justify-center text-xs`}>
                      {p.name.charAt(0)}
                    </div>
                    <div>
                      <p className="font-bold text-slate-800">{p.name}</p>
                      <div className="flex items-center gap-2 text-[10px] text-slate-500">
                        <span>{p.role}</span>
                        {isDinkesMode && (
                          <span className="font-semibold text-emerald-700 bg-emerald-50 px-1.5 py-0.2 rounded">
                            {p.healthCenterName || scopeName}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    {(canCreate || user.role === 'DINKES_ADMIN') && <button disabled={pending || pkpStore.isMutating()} onClick={() => setResetPic({ id: p.id, name: p.name })} className="block underline text-xs">Reset Password</button>}
                    <span className="block text-xs">{p.status === 'ACTIVE' ? 'Aktif' : 'Nonaktif'}</span>
                    <span className="font-mono text-emerald-700 font-semibold text-[11px]">{p.phone}</span>
                    {p.nip && <p className="text-[9px] text-slate-400 font-mono">NIP: {p.nip}</p>}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Form: Add New Staff (Puskesmas Mode Only) */}
          {canCreate && (
            <form onSubmit={handleAddStaff} className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
              <fieldset disabled={pending || pkpStore.getLoadState().loading} className="space-y-3">
              <div className="flex items-center gap-2 font-bold text-slate-800">
                <UserPlus className="w-4 h-4 text-teal-600" />
                <span>Tambah Staf PIC Internal Puskesmas</span>
              </div>
              <div className="space-y-2.5">
                <div>
                  <label className="text-[11px] font-semibold text-slate-600 block mb-1">Nama Lengkap & Gelar:</label>
                  <input
                     aria-label="Nama Lengkap dan Gelar"
                     type="text"
                    placeholder="Contoh: dr. Farah Diba, Sp.A"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 font-bold"
                    required
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[11px] font-semibold text-slate-600 block mb-1">NIP / NIK:</label>
                    <input
                       aria-label="NIP atau NIK"
                       type="text"
                      placeholder="19890101 201501 2 001"
                      value={nip}
                      onChange={(e) => setNip(e.target.value)}
                      className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold text-slate-600 block mb-1">Nomor WhatsApp:</label>
                    <input
                       aria-label="Nomor WhatsApp"
                       type="text"
                      placeholder="081234567890"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 font-mono"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-slate-600 block mb-1">Username (3-100 karakter):</label>
                  <input
                     aria-label="Username"
                     type="text"
                    autoComplete="off"
                    pattern="[A-Za-z0-9._-]{3,100}"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5"
                    required
                  />
                </div>
                <label className="block text-[11px] font-semibold text-slate-600">Password (minimal 12 karakter)
                  <input type="password" autoComplete="new-password" required minLength={12} maxLength={256} value={password} onChange={e => setPassword(e.target.value)} className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5" />
                </label>
                <label className="block text-[11px] font-semibold text-slate-600">Email (opsional)
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)} className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5" />
                </label>
                <p className="text-slate-500">Akun disimpan dengan peran PIC. Jabatan/program tidak disimpan oleh sistem.</p>
              </div>
              <div className="flex justify-end pt-1">
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-teal-600 hover:bg-teal-700 text-white rounded-lg font-bold shadow-sm"
                >
                  Daftarkan Staf PIC
                </button>
              </div>
              </fieldset>
            </form>
          )}
        </div>
      </div>
      {resetPic && <ResetPasswordDialog key={`${centerId}:${resetPic.id}`} userId={resetPic.id} name={resetPic.name} onClose={() => setResetPic(null)} onSuccess={setToast} />}
    </div>
  );
};
