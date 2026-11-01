import { useEffect, useRef, useState } from 'react';
import { api } from '../../services/apiClient';

interface TurnstileApi {
  render(container: HTMLElement, options: {
    sitekey: string; action: string; theme: string; size: string; language: string;
    'response-field': boolean;
    callback(token: string): void;
    'expired-callback'(): void;
    'timeout-callback'(): void;
    'error-callback'(): boolean;
  }): string;
  remove(widgetId: string): void;
}

declare global { interface Window { turnstile?: TurnstileApi } }

let scriptPromise: Promise<TurnstileApi> | undefined;
function loadTurnstile() {
  if (!scriptPromise) {
    scriptPromise = new Promise<TurnstileApi>((resolve, reject) => {
      const script = document.createElement('script');
      const fail = () => {
        clearTimeout(timeout);
        script.remove();
        scriptPromise = undefined;
        reject(new Error('Turnstile unavailable'));
      };
      const timeout = window.setTimeout(fail, 15000);
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.onerror = fail;
      script.onload = () => {
        const turnstile = window.turnstile;
        if (!turnstile) { fail(); return; }
        // The script has loaded; Cloudflare rejects ready() on async/defer scripts.
        clearTimeout(timeout);
        resolve(turnstile);
      };
      document.head.appendChild(script);
    });
  }
  return scriptPromise;
}

export function TurnstileChallenge({ resetKey, onChange }: {
  resetKey: number;
  onChange: (state: { ready: boolean; token: string }) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [retry, setRetry] = useState(0);
  const [message, setMessage] = useState<string | null>('Memuat verifikasi keamanan...');
  const [failed, setFailed] = useState(false);
  const [compact, setCompact] = useState(true);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      // A disabled challenge is hidden; its zero width is not a mobile layout.
      if (element.clientWidth > 0) setCompact(element.clientWidth < 300);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let active = true;
    let widgetId: string | undefined;
    let widgetApi: TurnstileApi | undefined;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 10000);
    onChange({ ready: false, token: '' });
    setMessage('Memuat verifikasi keamanan...');
    setFailed(false);
    const invalidate = (text: string) => {
      if (!active) return;
      onChange({ ready: false, token: '' });
      setMessage(text);
      setFailed(true);
    };
    void (async () => {
      try {
        const config = await api.loginConfig(controller.signal);
        clearTimeout(timeout);
        if (!active) return;
        if (config.turnstileEnabled === false) {
          onChange({ ready: true, token: '' });
          setMessage(null);
          return;
        }
        if (config.turnstileEnabled !== true || !config.turnstileSiteKey) throw new Error('Invalid login config');
        const turnstile = await loadTurnstile();
        if (!active || !container.current) return;
        widgetApi = turnstile;
        setMessage('Selesaikan verifikasi keamanan.');
        widgetId = turnstile.render(container.current, {
          sitekey: config.turnstileSiteKey, action: 'login', theme: 'light',
          size: compact ? 'compact' : 'flexible', language: 'id',
          'response-field': false,
          callback: token => {
            if (!active) return;
            onChange({ ready: Boolean(token), token });
            setMessage(token ? 'Verifikasi selesai.' : 'Selesaikan verifikasi keamanan.');
            setFailed(!token);
          },
          'expired-callback': () => invalidate('Verifikasi kedaluwarsa. Silakan verifikasi kembali.'),
          'timeout-callback': () => invalidate('Waktu verifikasi habis. Silakan coba lagi.'),
          'error-callback': () => { invalidate('Verifikasi gagal dimuat. Periksa koneksi lalu coba lagi.'); return true; },
        });
      } catch {
        invalidate('Verifikasi tidak tersedia. Periksa koneksi lalu coba lagi.');
      } finally { clearTimeout(timeout); }
    })();
    return () => {
      active = false;
      controller.abort();
      clearTimeout(timeout);
      if (widgetId !== undefined) widgetApi?.remove(widgetId);
    };
  }, [resetKey, retry, compact, onChange]);

  return <div className="login-challenge" hidden={message === null}>
    <div ref={container} />
    {message && <p role="status" className="text-sm leading-relaxed text-slate-600">{message}</p>}
    {failed && <button type="button" className="login-challenge-retry" onClick={() => setRetry(value => value + 1)}>Ulangi verifikasi</button>}
  </div>;
}
