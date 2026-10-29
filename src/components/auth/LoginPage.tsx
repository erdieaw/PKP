import React, { useState } from 'react';
import { ArrowRight, Eye, EyeOff, LoaderCircle, Pause, Play } from 'lucide-react';
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
  const [motionPaused, setMotionPaused] = useState(false);

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
        <div className="login-art" data-paused={motionPaused}>
          <svg className="login-art-vector" viewBox="0 0 340 144" fill="none" aria-hidden="true" focusable="false">
            <ellipse cx="170" cy="73" rx="111" ry="44" stroke="var(--login-art-line)" />
            <ellipse cx="170" cy="73" rx="80" ry="58" stroke="var(--login-art-line)" strokeDasharray="2 7" />
            <path d="M26 73h48m192 0h48" stroke="var(--login-art-line)" strokeDasharray="3 5" />
            <g className="login-art-orbit">
              <circle cx="170" cy="73" r="48" stroke="var(--login-art-accent)" strokeOpacity=".4" strokeDasharray="48 30 9 65" />
              <circle cx="170" cy="25" r="4" fill="var(--login-art-accent)" />
              <circle cx="170" cy="121" r="3" fill="var(--login-art-gold)" />
            </g>
            <circle cx="170" cy="73" r="36" fill="var(--login-art-soft)" stroke="var(--login-art-line)" />
            <circle className="login-art-breathe" cx="170" cy="73" r="29" stroke="var(--login-art-accent)" strokeOpacity=".2" />
            <path d="M162 52h16v13h13v16h-13v13h-16V81h-13V65h13V52Z" fill="var(--login-art-accent)" />
            <path d="m151 74 9 0 5-8 8 16 6-8h10" stroke="var(--login-paper)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <g className="login-art-chart">
              <rect x="57" y="35" width="57" height="64" rx="10" fill="var(--login-paper)" stroke="var(--login-art-line)" />
              <path d="M69 49h15m-15 6h27" stroke="var(--login-art-line)" strokeWidth="2" strokeLinecap="round" />
              <path d="M69 86h33" stroke="var(--login-art-line)" strokeLinecap="round" />
              <g fill="var(--login-art-accent)">
                <rect className="login-art-bar login-art-bar-one" x="70" y="74" width="6" height="9" rx="2" opacity=".4" />
                <rect className="login-art-bar login-art-bar-two" x="82" y="68" width="6" height="15" rx="2" opacity=".65" />
                <rect className="login-art-bar login-art-bar-three" x="94" y="61" width="6" height="22" rx="2" />
              </g>
            </g>
            <g className="login-art-checklist">
              <rect x="229" y="46" width="54" height="61" rx="10" fill="var(--login-paper)" stroke="var(--login-art-line)" />
              <rect x="244" y="42" width="24" height="8" rx="4" fill="var(--login-art-soft)" stroke="var(--login-art-line)" />
              <g stroke="var(--login-art-accent)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="m239 63 3 3 5-6m-8 17 3 3 5-6m-8 17 3 3 5-6" />
                <path d="M254 64h16m-16 14h12m-12 14h16" strokeOpacity=".4" />
              </g>
              <circle className="login-art-status" cx="280" cy="102" r="8" fill="var(--login-art-accent)" stroke="var(--login-paper)" strokeWidth="3" />
            </g>
            <g className="login-art-spark" stroke="var(--login-art-gold)" strokeWidth="1.5" strokeLinecap="round">
              <path d="M121 18v8m-4-4h8M302 94v6m-3-3h6" />
              <circle cx="36" cy="103" r="2" fill="var(--login-art-gold)" stroke="none" />
            </g>
          </svg>
          <button
            type="button" className="login-motion-toggle" onClick={() => setMotionPaused(value => !value)}
            aria-label={motionPaused ? 'Putar animasi ilustrasi' : 'Jeda animasi ilustrasi'}
            aria-pressed={motionPaused} title={motionPaused ? 'Putar animasi' : 'Jeda animasi'}
          >{motionPaused ? <Play size={12} aria-hidden="true" /> : <Pause size={12} aria-hidden="true" />}</button>
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
