import React, { useState } from 'react';
import { ArrowRight, Eye, EyeOff, LoaderCircle } from 'lucide-react';
import { pkpStore } from '../../services/apiStore';
import { ApiError } from '../../services/apiClient';
import { AuthUser } from '../../types/pkp';
import './login.css';

interface LoginPageProps {
  onLoginSuccess: (user: AuthUser) => void;
}

export const LoginPage: React.FC<LoginPageProps> = ({ onLoginSuccess }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isCapsLockOn, setIsCapsLockOn] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (loading) return;
    setErrorMessage(null);
    if (!username.trim() || !password) {
      setErrorMessage('Isi username dan kata sandi Anda.');
      return;
    }
    setLoading(true);
    try {
      const user = await pkpStore.authenticate(username.trim(), password);
      if (!user) throw new ApiError(401, 'Username atau kata sandi salah.');
      onLoginSuccess(user);
    } catch (error) {
      const status = error instanceof ApiError ? error.status : undefined;
      setErrorMessage(status === 401 || status === 403
        ? 'Username atau kata sandi salah. Periksa kembali dan coba lagi. Jika tetap tidak bisa masuk, hubungi administrator.'
        : status === 429
          ? 'Terlalu banyak percobaan masuk. Tunggu beberapa saat, lalu coba lagi.'
          : status === 0
            ? 'Tidak dapat terhubung ke server. Periksa koneksi internet Anda, lalu coba lagi.'
            : 'Tidak dapat masuk karena terjadi gangguan. Silakan coba lagi nanti.');
    } finally {
      setLoading(false);
    }
  };

  const checkCapsLock = (event: React.KeyboardEvent<HTMLInputElement>) => {
    setIsCapsLockOn(event.getModifierState('CapsLock'));
  };

  return (
    <main className="login-page">
      <div className="login-center">
      <section className="login-panel" aria-labelledby="login-heading">
        <div className="login-identity">
        <a href="/" className="login-brand" aria-label="SIPKP, halaman masuk">
          <svg className="login-mark" viewBox="0 0 36 36" fill="none" aria-hidden="true">
            <path d="M18 3v30M3 18h30" stroke="currentColor" strokeWidth="6" />
            <path d="m8 22 6-8 5 9 9-12" stroke="var(--login-paper)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>SIPKP<span className="login-brand-secondary">Puskesmas</span></span>
        </a>
        </div>
        <h1 id="login-heading" className="login-heading">Selamat datang.</h1>
        <p className="login-intro">Masuk untuk melanjutkan pekerjaan Anda.</p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4" aria-busy={loading}>
          <div>
            <label htmlFor="auth-username" className="mb-2 block text-sm font-medium">Username</label>
            <input
              id="auth-username" name="username" type="text" autoComplete="username" autoCapitalize="none" spellCheck={false}
              value={username} onChange={event => setUsername(event.target.value)} required disabled={loading}
              aria-describedby={errorMessage ? 'login-error' : undefined}
              placeholder="Masukkan username"
              className="login-input"
            />
          </div>

          <div>
            <label htmlFor="auth-password" className="mb-2 block text-sm font-medium">Kata sandi</label>
            <div className="relative">
              <input
                id="auth-password" name="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password"
                value={password} onChange={event => setPassword(event.target.value)} onKeyDown={checkCapsLock} onKeyUp={checkCapsLock}
                onBlur={() => setIsCapsLockOn(false)} required disabled={loading}
                aria-describedby={[errorMessage ? 'login-error' : '', isCapsLockOn ? 'login-caps-lock' : ''].filter(Boolean).join(' ') || undefined}
                placeholder="Masukkan kata sandi"
                className="login-input login-password"
              />
              <button
                type="button" onClick={() => setShowPassword(value => !value)} disabled={loading}
                aria-label={showPassword ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi'} aria-pressed={showPassword}
                className="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-md text-slate-500 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-700"
              >{showPassword ? <EyeOff aria-hidden="true" className="h-4 w-4" /> : <Eye aria-hidden="true" className="h-4 w-4" />}</button>
            </div>
            {isCapsLockOn && <p id="login-caps-lock" role="status" className="mt-2 text-sm text-amber-800">Caps Lock aktif.</p>}
          </div>

          {errorMessage && <p id="login-error" role="alert" className="text-sm leading-relaxed text-red-800">{errorMessage}</p>}

           <button type="submit" disabled={loading} className="login-submit">
            <span>{loading ? 'Sedang masuk...' : 'Masuk'}</span>
            {loading ? <LoaderCircle className="login-spinner" size={18} aria-hidden="true" /> : <ArrowRight size={18} aria-hidden="true" />}
          </button>
        </form>

        <p className="login-help">Perlu bantuan akun? Hubungi Admin Puskesmas atau Dinkes Anda.</p>
      </section>
      </div>
    </main>
  );
};
