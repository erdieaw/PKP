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

export interface DownloadedFile {
  blob: Blob;
  filename?: string;
}

interface TransferOptions extends RequestOptions {
  rawBody?: Blob;
  binary?: boolean;
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

function apiPath(path: string) {
  if (!/^\/?[a-zA-Z0-9_-]/.test(path) || /[\\\s#]/.test(path)) throw new ApiError(0, 'Path API tidak valid.');
  try {
    for (const segment of path.split('?')[0].split('/')) {
      const decoded = decodeURIComponent(segment);
      if (decoded === '.' || decoded === '..' || /[\\/\s:#]/.test(decoded)) throw new Error();
    }
  } catch { throw new ApiError(0, 'Path API tidak valid.'); }
  return `${base}/${path.replace(/^\//, '')}`;
}

async function send<T>(path: string, options: TransferOptions, token: string | null): Promise<T> {
  const url = apiPath(path);
  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? 'GET', signal: options.signal, redirect: 'error',
      headers: { Accept: options.binary ? 'application/octet-stream' : 'application/json', ...(options.rawBody !== undefined ? { 'Content-Type': 'application/octet-stream' } : options.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(options.rawBody !== undefined ? { body: options.rawBody } : options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });
  } catch (error) {
    if (options.signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw error;
    throw new ApiError(0, 'Tidak dapat menghubungi server.', error);
  }
  if (response.ok && options.rawBody !== undefined && !response.headers.get('Content-Type')?.includes('json')) return undefined as T;
  if (response.ok && options.binary) {
    const disposition = response.headers.get('Content-Disposition') ?? '';
    const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
    let filename = /filename="([^"]*)"|filename=([^;\s]+)/i.exec(disposition)?.slice(1).find(Boolean);
    if (encoded) {
      try { filename = decodeURIComponent(encoded); } catch { /* Use the plain filename when encoding is invalid. */ }
    }
    return { blob: await response.blob(), filename } as T;
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

async function authenticatedRequest<T>(path: string, options: TransferOptions = {}): Promise<T> {
  const auth = /^\/?auth\/(login|refresh)(?:[?/#]|$)/.test(path);
  const epoch = generation;
  const attemptedToken = accessToken;
  try {
    const result = await send<T>(path, options, attemptedToken);
    if (epoch !== generation) throw new ApiError(401, 'Sesi telah berubah.');
    return result;
  }
  catch (error) {
    if (auth || !(error instanceof ApiError) || error.status !== 401) throw error;
    if (epoch !== generation) throw new ApiError(401, 'Sesi telah berubah.');
    if (attemptedToken === accessToken) await refresh();
    if (epoch !== generation) throw new ApiError(401, 'Sesi telah berubah.');
    options.signal?.throwIfAborted();
    try {
      const result = await send<T>(path, options, accessToken);
      if (epoch !== generation) throw new ApiError(401, 'Sesi telah berubah.');
      return result;
    }
    catch (retryError) {
      if (epoch === generation && retryError instanceof ApiError && retryError.status === 401) expire();
      throw retryError;
    }
  }
}

function request<T>(path: string, options: RequestOptions = {}) {
  return authenticatedRequest<T>(path, options);
}

function saveDownload(file: DownloadedFile, fallback = 'download') {
  const url = URL.createObjectURL(file.blob);
  const link = document.createElement('a');
  try {
    link.href = url;
    link.download = (file.filename || fallback).replace(/[\\/\u0000-\u001f\u007f]/g, '_');
    document.body.appendChild(link);
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

export const api = {
  request, setSession, clearSession, refresh,
  upload: (path: string, body: Blob, options: Pick<RequestOptions, 'signal'> = {}) => authenticatedRequest<void>(path, { ...options, method: 'PUT', rawBody: body }),
  download: (path: string, options: Pick<RequestOptions, 'signal'> = {}) => authenticatedRequest<DownloadedFile>(path, { ...options, binary: true }),
  saveDownload,
  loginConfig: (signal: AbortSignal) => send<{ turnstileEnabled: boolean; turnstileSiteKey: string | null }>('/auth/login-config', { signal }, null),
  hasSession: () => Boolean(refreshToken()),
  async login<T extends SessionTokens>(username: string, password: string, role?: string, turnstileToken?: string): Promise<T> {
    clearSession();
    const epoch = generation;
    const result = await request<T>('/auth/login', { method: 'POST', body: { username, password, role, turnstileToken } });
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
