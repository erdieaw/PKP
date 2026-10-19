import React, { useState } from 'react';
import { pkpStore } from '../../services/apiStore';

export function ResetPasswordDialog({ userId, name, onClose, onSuccess }: { userId: string; name: string; onClose: () => void; onSuccess: (message: string) => void }) {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const close = () => { setPassword(''); setConfirmation(''); setReason(''); onClose(); };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (pending || pkpStore.isMutating()) return;
    if (password !== confirmation || password.length < 12 || !reason.trim()) { setError('Password minimal 12 karakter, konfirmasi harus sama, dan alasan wajib diisi.'); return; }
    setPending(true); setError('');
    try {
      const result = await pkpStore.resetUserPassword(userId, password, reason);
      setPassword(''); setConfirmation(''); setReason('');
      onSuccess(`Password ${name} berhasil direset. Sesi dicabut: ${result.sessionsRevoked ?? 'lihat audit server'}.`);
      onClose();
    } catch (e) { setError(e instanceof Error ? e.message : 'Reset password gagal.'); }
    finally { setPending(false); }
  };
  return <div className="fixed inset-0 z-[60] bg-slate-900/50 flex items-center justify-center p-4"><form role="dialog" aria-modal="true" aria-label={`Reset password ${name}`} onSubmit={submit} className="bg-white rounded-xl p-5 space-y-4 w-full max-w-md">
    <h3 className="font-bold">Reset Password: {name}</h3>
    <p className="text-sm">Seluruh sesi akun ini akan dicabut. Password tidak disimpan di browser atau ditampilkan dalam hasil.</p>
    {error && <p role="alert" className="text-rose-700">{error}</p>}
    <fieldset disabled={pending} className="space-y-3">
      <label className="block">Password baru<input className="block w-full border rounded p-2" type="password" autoComplete="new-password" required minLength={12} maxLength={256} value={password} onChange={e => setPassword(e.target.value)} /></label>
      <label className="block">Konfirmasi password baru<input className="block w-full border rounded p-2" type="password" autoComplete="new-password" required minLength={12} maxLength={256} value={confirmation} onChange={e => setConfirmation(e.target.value)} /></label>
      <label className="block">Alasan reset password<textarea className="block w-full border rounded p-2" required maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} /></label>
      <div className="flex justify-end gap-3"><button type="button" onClick={close}>Batal</button><button className="bg-emerald-600 text-white rounded px-3 py-2" type="submit">{pending ? 'Mereset...' : 'Reset Password dan Cabut Sesi'}</button></div>
    </fieldset>
  </form></div>;
}
