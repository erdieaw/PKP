import React, { useState } from 'react';
import { pkpStore } from '../../services/mockState';
import { PicUser } from '../../types/pkp';
import { Users, UserPlus, Phone, Briefcase, X, Check, Building2, ShieldCheck, ExternalLink } from 'lucide-react';

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
  selectedPuskesmasName = 'Puskesmas Kebonagung'
}) => {
  const [name, setName] = useState('');
  const [nip, setNip] = useState('');
  const [role, setRole] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [toast, setToast] = useState<string | null>(null);

  if (!isOpen) return null;

  const pics = pkpStore.getPics();
  const puskesmasList = pkpStore.getPuskesmasList();
  const currentPkm = puskesmasList.find(p => p.name === selectedPuskesmasName) || puskesmasList[0];

  const filteredPics = isDinkesMode
    ? pics
    : pics.filter(p => !p.healthCenterName || p.healthCenterName === selectedPuskesmasName);

  const handleAddStaff = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !role.trim()) return;

    pkpStore.addPic(
      name.trim(), 
      role.trim(), 
      phone.trim() || '081234567890',
      currentPkm ? currentPkm.id : 'pkm-1',
      selectedPuskesmasName,
      nip.trim(),
      email.trim()
    );

    setName('');
    setNip('');
    setRole('');
    setPhone('');
    setEmail('');
    setToast(`Staf PIC ${name.trim()} berhasil didaftarkan untuk ${selectedPuskesmasName}!`);
    setTimeout(() => setToast(null), 3000);
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
                  ? 'Direktori Staf PIC Seluruh Puskesmas' 
                  : `Kelola Staf PIC Internal - ${selectedPuskesmasName}`
                }
              </h3>
              <p className="text-[11px] text-slate-300">
                {isDinkesMode 
                  ? 'Supervisi staf penanggung jawab penginputan 282 elemen penilaian' 
                  : 'Kewenangan mandiri Puskesmas untuk mendaftarkan dan menugaskan staf'
                }
              </p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-5 text-xs">
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
                Faskes Aktif: <strong>{selectedPuskesmasName}</strong>. Seluruh PIC yang didaftarkan di sini hanya akan bertanggung jawab pada data Puskesmas ini.
              </span>
            </div>
          )}

          {/* Current Staff List */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="font-bold text-slate-700 uppercase tracking-wider text-[11px]">
                {isDinkesMode ? 'Daftar PIC Seluruh Wilayah' : 'Staf PIC Terdaftar'} ({filteredPics.length} Orang)
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
                            {p.healthCenterName || 'Puskesmas Kebonagung'}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="font-mono text-emerald-700 font-semibold text-[11px]">{p.phone}</span>
                    {p.nip && <p className="text-[9px] text-slate-400 font-mono">NIP: {p.nip}</p>}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Form: Add New Staff (Puskesmas Mode Only) */}
          {!isDinkesMode && (
            <form onSubmit={handleAddStaff} className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
              <div className="flex items-center gap-2 font-bold text-slate-800">
                <UserPlus className="w-4 h-4 text-teal-600" />
                <span>Tambah Staf PIC Internal Puskesmas</span>
              </div>
              <div className="space-y-2.5">
                <div>
                  <label className="text-[11px] font-semibold text-slate-600 block mb-1">Nama Lengkap & Gelar:</label>
                  <input
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
                      type="text"
                      placeholder="081234567890"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 font-mono"
                      required
                    />
                  </div>
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-slate-600 block mb-1">Jabatan / Program:</label>
                  <input
                    type="text"
                    placeholder="Contoh: PJ Program Gizi / Bidan Koordinator"
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                    className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-1.5"
                    required
                  />
                </div>
              </div>
              <div className="flex justify-end pt-1">
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-teal-600 hover:bg-teal-700 text-white rounded-lg font-bold shadow-sm"
                >
                  Daftarkan Staf PIC
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
