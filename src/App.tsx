import React, { useEffect, useRef, useState } from 'react';
import { AppLayout } from './components/layout/AppLayout';
import { LoginPage } from './components/auth/LoginPage';
import { AuthUser } from './types/pkp';
import { pkpStore } from './services/apiStore';
import { ProcessingIndicator } from './components/common/ProcessingIndicator';

class AppErrorBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <div role="alert" className="min-h-screen flex flex-col items-center justify-center gap-4 bg-slate-50 text-slate-800"><p>Tampilan tidak dapat dimuat. Muat ulang untuk mencoba kembali.</p><button onClick={() => window.location.reload()} className="rounded-xl bg-emerald-600 px-4 py-2 text-white">Muat Ulang</button></div>;
    return this.props.children;
  }
}

export function App() {
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const generation = useRef(0);

  const load = async (user?: AuthUser) => {
    const request = ++generation.current;
    setPending(true);
    setError('');
    try {
      const session = user ?? await pkpStore.restore();
      if (request !== generation.current) return;
      setCurrentUser(session);
      if (session) {
        await pkpStore.initialize(session);
        if (request === generation.current) setCurrentUser(pkpStore.getSessionUser());
      }
    } catch (reason) {
      if (request === generation.current) {
        setError(reason instanceof Error ? reason.message : 'Server tidak dapat dihubungi.');
      }
    } finally {
      if (request === generation.current) setPending(false);
    }
  };

  useEffect(() => {
    const expired = (event: Event) => {
      generation.current++;
      setCurrentUser(null);
      setPending(false);
      setError('');
      setNotice((event as CustomEvent<{ message?: string }>).detail?.message || 'Sesi Anda berakhir. Silakan masuk kembali.');
    };
    window.addEventListener('sipkp-session-expired', expired);
    void load();
    return () => { generation.current++; window.removeEventListener('sipkp-session-expired', expired); };
  }, []);

  const logout = async () => {
    generation.current++;
    setPending(true);
    try {
      await pkpStore.logout();
      setNotice('Anda telah keluar dari sistem.');
    } catch {
      setNotice('Sesi lokal ditutup. Server tidak dapat mengonfirmasi pencabutan sesi.');
    } finally {
      setCurrentUser(null);
      setError('');
      setPending(false);
    }
  };

  if (pending || error) return <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6"><div className="w-full max-w-md space-y-4 text-slate-700">{error ? <div role="alert" className="space-y-4 text-center"><p>{error}</p><div className="flex flex-wrap justify-center gap-3"><button className="px-4 py-2 rounded-xl bg-emerald-600 text-white" onClick={() => void load(currentUser ?? undefined)}>Coba Lagi</button><button className="px-4 py-2 rounded-xl border border-slate-300" onClick={() => void logout()}>Kembali ke Login</button></div></div> : <ProcessingIndicator label="Memuat sesi dan data SIPKP..." description="Menyiapkan akses dan data sesuai akun Anda. Mohon tunggu." />}</div></div>;

  return <AppErrorBoundary>{currentUser
    ? <AppLayout currentUser={currentUser} onLogout={() => void logout()} />
    : <>{notice && <div role="status" className="fixed top-3 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-2rem)] max-w-lg rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 shadow-lg">{notice}<button aria-label="Tutup pemberitahuan" className="ml-3 font-bold" onClick={() => setNotice('')}>×</button></div>}<LoginPage onLoginSuccess={user => { setNotice(''); void load(user); }} /></>}
  </AppErrorBoundary>;
}

export default App;
