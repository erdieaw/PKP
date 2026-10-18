import React, { useState } from 'react';
import { 
  KeyRound, 
  X, 
  Eye, 
  EyeOff, 
  CheckCircle2, 
  AlertCircle, 
  ShieldCheck, 
  Lock,
  Sparkles
} from 'lucide-react';
import { pkpStore } from '../../services/mockState';
import { AuthUser } from '../../types/pkp';

interface ChangePasswordModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser?: AuthUser | null;
  defaultUsername?: string;
}

export const ChangePasswordModal: React.FC<ChangePasswordModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  defaultUsername = ''
}) => {
  const [usernameInput, setUsernameInput] = useState(currentUser?.username || defaultUsername || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  // Password strength calculations
  const hasMinLength = newPassword.length >= 8;
  const hasMixedCase = /[a-z]/.test(newPassword) && /[A-Z]/.test(newPassword);
  const hasNumber = /\d/.test(newPassword);
  const hasSpecial = /[^A-Za-z0-9]/.test(newPassword);

  const strengthScore = [hasMinLength, hasMixedCase, hasNumber, hasSpecial].filter(Boolean).length;
  const isMatch = newPassword.length > 0 && newPassword === confirmPassword;

  const getStrengthLabel = () => {
    if (newPassword.length === 0) return { label: 'Belum diisi', color: 'bg-slate-200', text: 'text-slate-400' };
    if (strengthScore <= 1) return { label: 'Sangat Lemah', color: 'bg-rose-500', text: 'text-rose-600' };
    if (strengthScore === 2) return { label: 'Cukup', color: 'bg-amber-500', text: 'text-amber-600' };
    if (strengthScore === 3) return { label: 'Kuat', color: 'bg-emerald-500', text: 'text-emerald-600' };
    return { label: 'Sangat Kuat (Aman)', color: 'bg-emerald-600', text: 'text-emerald-700' };
  };

  const strength = getStrengthLabel();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    const targetIdentifier = currentUser?.username || usernameInput.trim();
    if (!targetIdentifier) {
      setErrorMsg('Username atau NIP wajib diisi.');
      return;
    }

    if (newPassword.length < 6) {
      setErrorMsg('Password baru minimal harus 6 karakter.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setErrorMsg('Konfirmasi password tidak cocok dengan password baru.');
      return;
    }

    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      const res = pkpStore.changeUserPassword(
        targetIdentifier,
        currentUser ? currentPassword : undefined,
        newPassword
      );

      if (res.success) {
        setSuccessMsg(res.message);
        setTimeout(() => {
          setSuccessMsg(null);
          onClose();
        }, 1800);
      } else {
        setErrorMsg(res.message);
      }
    }, 600);
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div 
        className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="p-5 bg-gradient-to-r from-slate-900 to-slate-800 text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <KeyRound className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-white">
                {currentUser ? 'Ubah Kata Sandi Akun' : 'Reset & Buat Password Baru'}
              </h3>
              <p className="text-[11px] text-slate-300">
                {currentUser ? `Pengguna: ${currentUser.name}` : 'Verifikasi identitas dan amankan akun SIPKP Anda'}
              </p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700/60 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4 text-xs">
          {errorMsg && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 flex items-center gap-2 animate-fade-in">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
              <span>{errorMsg}</span>
            </div>
          )}

          {successMsg && (
            <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 flex items-center gap-2 animate-fade-in">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
              <span className="font-semibold">{successMsg}</span>
            </div>
          )}

          {/* Identifier (If not logged in) */}
          {!currentUser && (
            <div>
              <label htmlFor="modal-username" className="text-[11px] font-semibold text-slate-700 block mb-1">
                Username / NIP Pengguna Terdaftar:
              </label>
              <input
                id="modal-username"
                type="text"
                autoComplete="username"
                value={usernameInput}
                onChange={(e) => setUsernameInput(e.target.value)}
                placeholder="Contoh: admin.kebonagung atau NIP"
                required
                className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:bg-white transition-all font-mono"
              />
            </div>
          )}

          {/* Current Password (if logged in) */}
          {currentUser && (
            <div>
              <label htmlFor="current-pass" className="text-[11px] font-semibold text-slate-700 block mb-1">
                Password Saat Ini (Lama):
              </label>
              <div className="relative">
                <input
                  id="current-pass"
                  type={showCurrent ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Masukkan password saat ini..."
                  required
                  className="w-full pl-3 pr-9 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:bg-white transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowCurrent(!showCurrent)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  {showCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
          )}

          {/* New Password */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label htmlFor="new-pass" className="text-[11px] font-semibold text-slate-700">
                Password Baru:
              </label>
              <span className={`text-[10px] font-bold ${strength.text}`}>
                {strength.label}
              </span>
            </div>
            <div className="relative">
              <input
                id="new-pass"
                type={showNew ? 'text' : 'password'}
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Minimal 8 karakter disarankan..."
                required
                className="w-full pl-3 pr-9 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:bg-white transition-all"
              />
              <button
                type="button"
                onClick={() => setShowNew(!showNew)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>

            {/* Visual Password Strength Meter */}
            <div className="w-full bg-slate-100 rounded-full h-1.5 mt-1.5 overflow-hidden">
              <div 
                className={`h-full transition-all duration-300 ${strength.color}`}
                style={{ width: `${Math.min(100, (strengthScore / 4) * 100)}%` }}
              />
            </div>

            {/* Password Criteria Checklist */}
            <div className="grid grid-cols-2 gap-1 mt-2 text-[10px] text-slate-500">
              <span className={`flex items-center gap-1 ${hasMinLength ? 'text-emerald-700 font-semibold' : ''}`}>
                <CheckCircle2 className={`w-3 h-3 ${hasMinLength ? 'text-emerald-600' : 'text-slate-300'}`} />
                <span>Min. 8 karakter</span>
              </span>
              <span className={`flex items-center gap-1 ${hasMixedCase ? 'text-emerald-700 font-semibold' : ''}`}>
                <CheckCircle2 className={`w-3 h-3 ${hasMixedCase ? 'text-emerald-600' : 'text-slate-300'}`} />
                <span>Huruf besar & kecil</span>
              </span>
              <span className={`flex items-center gap-1 ${hasNumber ? 'text-emerald-700 font-semibold' : ''}`}>
                <CheckCircle2 className={`w-3 h-3 ${hasNumber ? 'text-emerald-600' : 'text-slate-300'}`} />
                <span>Mengandung angka</span>
              </span>
              <span className={`flex items-center gap-1 ${hasSpecial ? 'text-emerald-700 font-semibold' : ''}`}>
                <CheckCircle2 className={`w-3 h-3 ${hasSpecial ? 'text-emerald-600' : 'text-slate-300'}`} />
                <span>Simbol (@, #, $, dll.)</span>
              </span>
            </div>
          </div>

          {/* Confirm Password */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label htmlFor="confirm-pass" className="text-[11px] font-semibold text-slate-700">
                Konfirmasi Password Baru:
              </label>
              {confirmPassword.length > 0 && (
                <span className={`text-[10px] font-bold ${isMatch ? 'text-emerald-600' : 'text-rose-600'}`}>
                  {isMatch ? '✓ Cocok' : '✕ Tidak Cocok'}
                </span>
              )}
            </div>
            <div className="relative">
              <input
                id="confirm-pass"
                type={showConfirm ? 'text' : 'password'}
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Ketik ulang password baru..."
                required
                className={`w-full pl-3 pr-9 py-2 text-xs bg-slate-50 border rounded-lg focus:ring-2 focus:bg-white transition-all ${
                  confirmPassword.length > 0 && !isMatch
                    ? 'border-rose-400 focus:ring-rose-400'
                    : 'border-slate-300 focus:ring-emerald-500'
                }`}
              />
              <button
                type="button"
                onClick={() => setShowConfirm(!showConfirm)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Security Notice */}
          <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-[11px] text-slate-500 flex items-start gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <span>
              Perubahan kata sandi akan otomatis dicatat pada audit log sistem dan sesi login pada perangkat lain akan diperbarui sesuai protokol keamanan Kemenkes.
            </span>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-3.5 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 transition-colors"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={loading || (confirmPassword.length > 0 && !isMatch)}
              className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white rounded-xl text-xs font-bold transition-all shadow-sm flex items-center gap-1.5"
            >
              {loading ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Menyimpan...</span>
                </>
              ) : (
                <>
                  <Lock className="w-3.5 h-3.5" />
                  <span>Simpan Password Baru</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
