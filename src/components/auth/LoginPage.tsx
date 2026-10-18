import React, { useState } from 'react';
import { 
  Building2, 
  ShieldCheck, 
  UserCheck, 
  Lock, 
  Eye, 
  EyeOff, 
  Sparkles, 
  ArrowRight, 
  AlertCircle,
  CheckCircle2,
  Activity,
  Layers,
  HeartPulse,
  KeyRound,
  FileCheck2,
  Info
} from 'lucide-react';
import { pkpStore } from '../../services/mockState';
import { UserRole, AuthUser } from '../../types/pkp';
import { ChangePasswordModal } from './ChangePasswordModal';
import { AppLogo } from '../common/AppLogo';

interface LoginPageProps {
  onLoginSuccess: (user: AuthUser) => void;
}

export const LoginPage: React.FC<LoginPageProps> = ({ onLoginSuccess }) => {
  const [selectedRole, setSelectedRole] = useState<UserRole>('ADMIN_PUSKESMAS');
  const [username, setUsername] = useState('admin.kebonagung');
  const [password, setPassword] = useState('kebonagung123');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [isCapsLockOn, setIsCapsLockOn] = useState(false);
  
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  
  // Forgot / Change password modal state
  const [isResetModalOpen, setIsResetModalOpen] = useState(false);

  // Quick Demo Fill Handler (Mobbin Prototyping Pattern)
  const handleQuickDemoFill = (role: UserRole) => {
    setSelectedRole(role);
    setErrorMessage(null);
    if (role === 'DINKES_ADMIN') {
      setUsername('dinkes.malangkab');
      setPassword('dinkes123');
    } else if (role === 'ADMIN_PUSKESMAS') {
      setUsername('admin.kebonagung');
      setPassword('kebonagung123');
    } else if (role === 'PIC') {
      setUsername('pic-1');
      setPassword('pic123');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    setIsCapsLockOn(e.getModifierState('CapsLock'));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!username.trim()) {
      setErrorMessage('Username atau NIP wajib diisi.');
      return;
    }
    if (!password) {
      setErrorMessage('Kata sandi wajib diisi.');
      return;
    }

    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      const res = pkpStore.authenticate(username, password, selectedRole);
      if (res.success && res.user) {
        onLoginSuccess(res.user);
      } else {
        setErrorMessage(res.message || 'Kredensial tidak valid. Silakan gunakan tombol demo di bawah.');
      }
    }, 550);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-obsidian-950 via-obsidian-900 to-obsidian-950 flex flex-col justify-center relative overflow-hidden font-sans">
      {/* Background Decorative Mesh Gradients */}
      <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 right-1/4 w-[500px] h-[500px] bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />

      <div className="w-full max-w-6xl mx-auto p-4 sm:p-6 lg:p-8 flex items-center justify-center min-h-screen">
        <div className="w-full bg-white rounded-3xl shadow-2xl overflow-hidden border border-slate-200/80 grid grid-cols-1 lg:grid-cols-12 min-h-[640px]">
          
          {/* ============================================================== */}
          {/* LEFT HERO PANEL (MOBBIN HEALTHCARE / GOVTECH STYLE) */}
          {/* ============================================================== */}
          <div className="lg:col-span-5 bg-gradient-to-br from-obsidian-950 via-obsidian-900 to-emerald-950/90 p-8 sm:p-10 text-white flex flex-col justify-between relative overflow-hidden border-r border-obsidian-800/80">
            {/* Subtle Accent Glow */}
            <div className="absolute -top-20 -right-20 w-64 h-64 bg-emerald-500/20 rounded-full blur-3xl" />
            <div className="absolute -bottom-20 -left-20 w-64 h-64 bg-cyan-500/15 rounded-full blur-3xl" />

            <div className="relative z-10 space-y-6">
              {/* Brand Identity with AppLogo */}
              <AppLogo 
                variant="full" 
                size="lg" 
                subtitle="Sistem Informasi Penilaian Kinerja Puskesmas Terpadu" 
              />

              {/* Tagline & Provincial Integration Badge */}
              <div className="space-y-3 pt-2">
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/15 border border-emerald-400/25 text-emerald-300 text-xs font-semibold">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Terintegrasi Bridge SIPKP Provinsi Jawa Timur</span>
                </div>
                <h2 className="text-2xl font-bold tracking-tight text-white leading-snug">
                  Transformasi Digital Evaluasi Mutu Faskes Primer Berbasis ILP
                </h2>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Standar penilaian terpadu 5 Klaster Kemenkes dengan polaritas target otomatis, penugasan PIC transparan, dan pemeringkatan faskes se-Kabupaten/Kota.
                </p>
              </div>

              {/* 3 Core Capability Highlights */}
              <div className="space-y-2.5 pt-2">
                <div className="flex items-center gap-3 p-3 rounded-xl bg-white/5 border border-white/10 backdrop-blur-xs">
                  <div className="p-2 rounded-lg bg-emerald-500/20 text-emerald-300 shrink-0">
                    <Layers className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-white">272 Elemen Penilaian Baku</h4>
                    <p className="text-[11px] text-slate-400">Kode hirarki resmi terhubung ke server SIPKP Provinsi</p>
                  </div>
                </div>

                <div className="flex items-center gap-3 p-3 rounded-xl bg-white/5 border border-white/10 backdrop-blur-xs">
                  <div className="p-2 rounded-lg bg-teal-500/20 text-teal-300 shrink-0">
                    <HeartPulse className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-white">Kalkulasi Cerdas Multi-Polaritas</h4>
                    <p className="text-[11px] text-slate-400">Higher, Lower, dan Tiered Brackets (Stunting, KB, POR)</p>
                  </div>
                </div>

                <div className="flex items-center gap-3 p-3 rounded-xl bg-white/5 border border-white/10 backdrop-blur-xs">
                  <div className="p-2 rounded-lg bg-indigo-500/20 text-indigo-300 shrink-0">
                    <ShieldCheck className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-white">Supervisi Dinkes & RTL Real-Time</h4>
                    <p className="text-[11px] text-slate-400">Feedback triwulanan langsung terhubung ke faskes</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Trust Footer */}
            <div className="pt-8 border-t border-white/10 relative z-10 flex items-center justify-between text-[11px] text-slate-400">
              <span className="flex items-center gap-1.5">
                <FileCheck2 className="w-3.5 h-3.5 text-emerald-400" />
                <span>Kemenkes RI • Dinkes Prov Jatim</span>
              </span>
              <span className="font-mono text-[10px] text-slate-400">v2.4.0 (2026)</span>
            </div>
          </div>

          {/* ============================================================== */}
          {/* RIGHT AUTH FORM PANEL (MOBBIN DOCTOLIB / ENTERPRISE STYLE) */}
          {/* ============================================================== */}
          <div className="lg:col-span-7 p-8 sm:p-10 flex flex-col justify-between bg-white">
            <div className="space-y-6">
              {/* Header Title */}
              <div>
                <h3 className="text-xl font-extrabold text-slate-900 tracking-tight">
                  Masuk ke Portal SIPKP
                </h3>
                <p className="text-xs text-slate-500 mt-1">
                  Pilih peran otorisasi Anda dan masukkan kredensial resmi faskes.
                </p>
              </div>

              {/* 3-Role Tab Switcher */}
              <div className="space-y-1.5">
                <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wider block">
                  Pilih Peran Otorisasi Akses:
                </span>
                <div className="grid grid-cols-3 gap-2 p-1 bg-slate-100 rounded-2xl border border-slate-200">
                  <button
                    type="button"
                    onClick={() => handleQuickDemoFill('DINKES_ADMIN')}
                    className={`flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-xl text-xs font-bold transition-all ${
                      selectedRole === 'DINKES_ADMIN'
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
                    }`}
                  >
                    <ShieldCheck className="w-4 h-4 shrink-0" />
                    <span className="truncate">Dinkes</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleQuickDemoFill('ADMIN_PUSKESMAS')}
                    className={`flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-xl text-xs font-bold transition-all ${
                      selectedRole === 'ADMIN_PUSKESMAS'
                        ? 'bg-emerald-600 text-white shadow-sm'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
                    }`}
                  >
                    <Building2 className="w-4 h-4 shrink-0" />
                    <span className="truncate">Admin PKM</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleQuickDemoFill('PIC')}
                    className={`flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-xl text-xs font-bold transition-all ${
                      selectedRole === 'PIC'
                        ? 'bg-teal-600 text-white shadow-sm'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
                    }`}
                  >
                    <UserCheck className="w-4 h-4 shrink-0" />
                    <span className="truncate">Staf PIC</span>
                  </button>
                </div>
              </div>

              {/* Quick Demo Pill Fillers (Mobbin Prototype Helper) */}
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 text-xs space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-slate-700 flex items-center gap-1">
                    <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                    <span>Pintasan Masuk Demo (1-Klik):</span>
                  </span>
                  <span className="text-[10px] text-slate-400 font-mono">Auto-fill kredensial</span>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <button
                    type="button"
                    onClick={() => handleQuickDemoFill('DINKES_ADMIN')}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-all ${
                      selectedRole === 'DINKES_ADMIN'
                        ? 'bg-indigo-50 border-indigo-300 text-indigo-700 font-bold'
                        : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    🏛️ Dinkes Kab. Malang
                  </button>
                  <button
                    type="button"
                    onClick={() => handleQuickDemoFill('ADMIN_PUSKESMAS')}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-all ${
                      selectedRole === 'ADMIN_PUSKESMAS'
                        ? 'bg-emerald-50 border-emerald-300 text-emerald-800 font-bold'
                        : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    🏥 Admin Puskesmas
                  </button>
                  <button
                    type="button"
                    onClick={() => handleQuickDemoFill('PIC')}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-all ${
                      selectedRole === 'PIC'
                        ? 'bg-teal-50 border-teal-300 text-teal-800 font-bold'
                        : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    👩‍⚕️ Bd. Siti Aminah (PIC KIA)
                  </button>
                </div>
              </div>

              {/* Main Auth Form */}
              <form onSubmit={handleSubmit} className="space-y-4 text-xs">
                {errorMessage && (
                  <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 flex items-center gap-2 animate-fade-in">
                    <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                    <span className="text-[11px] font-medium">{errorMessage}</span>
                  </div>
                )}

                {/* Username / NIP Field */}
                <div>
                  <label htmlFor="auth-username" className="text-[11px] font-semibold text-slate-700 block mb-1">
                    {selectedRole === 'DINKES_ADMIN' 
                      ? 'NIP / Username Pengawas Dinkes:' 
                      : selectedRole === 'ADMIN_PUSKESMAS' 
                      ? 'Username / NIP Administrator Puskesmas:' 
                      : 'ID Staf / NIP / Telepon PIC Program:'}
                  </label>
                  <input
                    id="auth-username"
                    name="username"
                    type="text"
                    autoComplete="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Masukkan username atau NIP..."
                    required
                    className="w-full px-3.5 py-2.5 text-xs bg-slate-50 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:bg-white transition-all font-mono font-medium text-slate-900"
                  />
                </div>

                {/* Password Field with Eye Toggle & Caps Lock Warning */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label htmlFor="auth-password" className="text-[11px] font-semibold text-slate-700">
                      Kata Sandi (Password):
                    </label>
                    <button
                      type="button"
                      onClick={() => setIsResetModalOpen(true)}
                      className="text-[11px] text-emerald-700 hover:text-emerald-800 font-bold hover:underline transition-colors"
                    >
                      Lupa Password?
                    </button>
                  </div>
                  <div className="relative">
                    <input
                      id="auth-password"
                      name="password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      onKeyDown={handleKeyDown}
                      onKeyUp={handleKeyDown}
                      placeholder="Masukkan kata sandi..."
                      required
                      className="w-full pl-3.5 pr-10 py-2.5 text-xs bg-slate-50 border border-slate-300 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:bg-white transition-all font-mono text-slate-900"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                      title={showPassword ? "Sembunyikan password" : "Tampilkan password"}
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>

                  {/* Caps Lock Indicator */}
                  {isCapsLockOn && (
                    <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-0.5 mt-1 inline-flex items-center gap-1">
                      <Info className="w-3 h-3 text-amber-600" />
                      <span>Peringatan: <strong>Caps Lock</strong> sedang aktif.</span>
                    </p>
                  )}
                </div>

                {/* Remember Me Checkbox & Security notice */}
                <div className="flex items-center justify-between pt-1">
                  <label className="flex items-center gap-2 cursor-pointer text-slate-600 select-none">
                    <input
                      type="checkbox"
                      checked={rememberMe}
                      onChange={(e) => setRememberMe(e.target.checked)}
                      className="w-4 h-4 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500 cursor-pointer"
                    />
                    <span className="text-[11px]">Ingat sesi saya di perangkat ini</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => setIsResetModalOpen(true)}
                    className="text-[11px] text-slate-500 hover:text-slate-800 inline-flex items-center gap-1 transition-colors"
                  >
                    <KeyRound className="w-3 h-3 text-slate-400" />
                    <span>Ubah Password</span>
                  </button>
                </div>

                {/* Submit Sign In Button */}
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-700 active:scale-98 disabled:bg-slate-400 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-emerald-600/20 flex items-center justify-center gap-2 cursor-pointer mt-2"
                >
                  {loading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>Memverifikasi Otorisasi...</span>
                    </>
                  ) : (
                    <>
                      <span>Masuk ke Dashboard SIPKP</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </form>
            </div>

            {/* Bottom Support & Security Badge */}
            <div className="pt-6 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[11px] text-slate-400">
              <span className="flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                <span>Enkripsi TLS 1.3 & Keamanan Sesi Kemenkes</span>
              </span>
              <span>Bantuan IT: (0341) 393939</span>
            </div>
          </div>
        </div>
      </div>

      {/* Forgot / Reset Password Modal */}
      <ChangePasswordModal
        isOpen={isResetModalOpen}
        onClose={() => setIsResetModalOpen(false)}
        defaultUsername={username}
      />
    </div>
  );
};
