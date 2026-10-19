export class ApiError extends Error {
  readonly dependencies: unknown;
  constructor(public readonly status: number, message: string, public readonly details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.dependencies = details && typeof details === 'object' && 'dependencies' in details ? details.dependencies : undefined;
  }
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
}

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
}

const base = (import.meta.env.VITE_API_BASE_URL || '/api/v1').replace(/\/$/, '');
const sessionKey = 'SIPKP_SESSION';
let accessToken: string | null = null;
let generation = 0;
let refreshing: Promise<void> | null = null;

function refreshToken() { return sessionStorage.getItem(sessionKey); }

function clearSession() {
  generation++;
  accessToken = null;
  refreshing = null;
  sessionStorage.removeItem(sessionKey);
}

function expire() {
  clearSession();
  window.dispatchEvent(new CustomEvent('sipkp-session-expired'));
}

async function send<T>(path: string, options: RequestOptions, token: string | null): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${base}/${path.replace(/^\//, '')}`, {
      method: options.method ?? 'GET', signal: options.signal,
      headers: { Accept: 'application/json', ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });
  } catch (error) {
    if (options.signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw error;
    throw new ApiError(0, 'Tidak dapat menghubungi server.', error);
  }
  const text = await response.text();
  let payload: unknown;
  try { payload = text ? JSON.parse(text) : null; }
  catch { throw new ApiError(response.status, 'Respons server bukan JSON yang valid.', text); }
  const envelope = payload as { success?: boolean; data?: T; message?: string | string[]; details?: unknown } | null;
  if (!response.ok || envelope?.success === false) {
    const message = envelope?.message;
    throw new ApiError(response.status, Array.isArray(message) ? message.join('; ') : message || response.statusText || 'Permintaan gagal.', payload);
  }
  return (envelope && 'data' in envelope ? envelope.data : payload) as T;
}

function setSession(tokens: SessionTokens) {
  generation++;
  refreshing = null;
  sessionStorage.setItem(sessionKey, tokens.refreshToken);
  accessToken = tokens.accessToken;
}

function refresh(): Promise<void> {
  if (refreshing) return refreshing;
  const token = refreshToken();
  const epoch = generation;
  const work = (async () => {
    if (!token) { expire(); throw new ApiError(401, 'Sesi berakhir. Silakan masuk kembali.'); }
    try {
      const tokens = await send<SessionTokens>('/auth/refresh', { method: 'POST', body: { refreshToken: token } }, null);
      if (epoch !== generation) throw new ApiError(401, 'Sesi telah berubah.');
      sessionStorage.setItem(sessionKey, tokens.refreshToken);
      accessToken = tokens.accessToken;
    } catch (error) {
      if (epoch === generation && error instanceof ApiError && (error.status === 401 || error.status === 403)) expire();
      throw error;
    }
  })();
  refreshing = work;
  void work.finally(() => { if (refreshing === work) refreshing = null; }).catch(() => {});
  return work;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const auth = /^\/?auth\/(login|refresh)(?:[?/#]|$)/.test(path);
  const epoch = generation;
  const attemptedToken = accessToken;
  try { return await send<T>(path, options, attemptedToken); }
  catch (error) {
    if (auth || !(error instanceof ApiError) || error.status !== 401) throw error;
    if (epoch !== generation) throw new ApiError(401, 'Sesi telah berubah.');
    if (attemptedToken === accessToken) await refresh();
    if (epoch !== generation) throw new ApiError(401, 'Sesi telah berubah.');
    options.signal?.throwIfAborted();
    try { return await send<T>(path, options, accessToken); }
    catch (retryError) {
      if (epoch === generation && retryError instanceof ApiError && retryError.status === 401) expire();
      throw retryError;
    }
  }
}

export const api = {
  request, setSession, clearSession, refresh,
  hasSession: () => Boolean(refreshToken()),
  async login<T extends SessionTokens>(username: string, password: string, role?: string): Promise<T> {
    clearSession();
    const epoch = generation;
    const result = await request<T>('/auth/login', { method: 'POST', body: { username, password, role } });
    if (epoch !== generation) throw new ApiError(401, 'Sesi telah berubah.');
    setSession(result);
    return result;
  },
  async logout() {
    const epoch = generation;
    try {
      if (refreshToken()) {
        if (!accessToken) await refresh();
        await request('/auth/logout', { method: 'POST' });
      }
    } finally { if (epoch === generation) clearSession(); }
  },
};
