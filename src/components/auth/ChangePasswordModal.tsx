import React, { useEffect, useRef, useState } from 'react';
import { KeyRound, X, ShieldCheck } from 'lucide-react';
import { pkpStore } from '../../services/apiStore';
import { AuthUser } from '../../types/pkp';

interface ChangePasswordModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: AuthUser;
}

export function ChangePasswordModal({ isOpen, onClose, currentUser }: ChangePasswordModalProps) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (isOpen) {
      setCurrentPassword('');
      setNewPassword('');
      setConfirmation('');
      setError('');
      dialog.current?.showModal();
    } else {
      dialog.current?.close();
    }
  }, [isOpen]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (pending) return;
    setError('');
    if (newPassword !== confirmation) {
      setError('Konfirmasi kata sandi tidak cocok.');
      return;
    }
    setPending(true);
    try {
      await pkpStore.changeUserPassword(currentPassword, newPassword);
      window.dispatchEvent(new CustomEvent('sipkp-session-expired', {
        detail: { message: 'Kata sandi berhasil diubah. Semua sesi dicabut. Silakan masuk kembali.' },
      }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Kata sandi tidak dapat diubah. Silakan coba kembali.');
    } finally {
      setPending(false);
    }
  };

  return (
    <dialog ref={dialog} aria-labelledby="password-title" onCancel={(event) => {
      event.preventDefault();
      if (!pending) onClose();
    }} className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-slate-200 p-0 shadow-2xl backdrop:bg-slate-900/60">
      <div className="p-5 bg-gradient-to-r from-slate-900 to-slate-800 text-white flex items-center justify-between">
        <div className="flex items-center gap-3">
          <KeyRound className="w-5 h-5 text-emerald-400" />
          <div><h3 id="password-title" className="font-bold text-sm">Ubah Kata Sandi Akun</h3><p className="text-xs text-slate-300">{currentUser.name}</p></div>
        </div>
        <button type="button" aria-label="Tutup" disabled={pending} onClick={onClose} className="p-2 rounded-lg hover:bg-slate-700"><X className="w-4 h-4" /></button>
      </div>
      <form onSubmit={submit} className="p-6 space-y-4 text-xs">
        {error && <p role="alert" className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800">{error}</p>}
        <fieldset disabled={pending} className="space-y-4">
          <label className="block font-semibold text-slate-700">Kata Sandi Saat Ini
            <input autoFocus type="password" autoComplete="current-password" required value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} className="mt-1 w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500" />
          </label>
          <label className="block font-semibold text-slate-700">Kata Sandi Baru
            <input type="password" autoComplete="new-password" required minLength={8} value={newPassword} onChange={event => setNewPassword(event.target.value)} className="mt-1 w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500" />
            <span className="block mt-1 font-normal text-slate-500">Minimal 8 karakter. Gunakan kata sandi yang unik.</span>
          </label>
          <label className="block font-semibold text-slate-700">Konfirmasi Kata Sandi Baru
            <input type="password" autoComplete="new-password" required value={confirmation} onChange={event => setConfirmation(event.target.value)} className="mt-1 w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500" />
          </label>
        </fieldset>
        <p className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-slate-600 flex items-start gap-2"><ShieldCheck className="w-4 h-4 shrink-0 text-emerald-600" />Setelah berhasil, semua sesi akan dicabut dan Anda harus masuk kembali.</p>
        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <button type="button" onClick={onClose} disabled={pending} className="px-4 py-2 rounded-xl text-slate-600 hover:bg-slate-100">Batal</button>
          <button type="submit" disabled={pending} className="px-4 py-2 rounded-xl bg-emerald-600 text-white font-bold hover:bg-emerald-700 disabled:bg-slate-400">{pending ? 'Menyimpan...' : 'Simpan Kata Sandi'}</button>
        </div>
      </form>
    </dialog>
  );
}
