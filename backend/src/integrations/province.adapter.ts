import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Browser, chromium, Route } from 'playwright';

const BASE = 'https://vfs-dinkes.com/pkp/';
const READS = ['get_current_user.php', 'get_total_sasaran.php', 'get_data_kinerja.php', 'get_month_options.php'];
const PAGES = ['', 'index.html', 'puskesmas.html'];
const TIMEOUT = 30_000;
const MAX_ROWS = 20_000;
type Scalar = string | number | null;
export type ProvinceRow = Record<string, Scalar>;
export interface ProvinceSnapshot {
  provinceHealthCenterCode: string;
  targets: ProvinceRow[];
  months: ProvinceRow[];
  monthly: ProvinceRow[];
}

// A positive allowlist also blocks mutation endpoints implemented as GET requests.
export function provinceRequestAllowed(url: string, method: string, loginAllowed: boolean): boolean {
  const target = new URL(url);
  if (target.origin !== new URL(BASE).origin || target.username || target.password || target.search) return false;
  if (method === 'POST') return loginAllowed && target.href === `${BASE}api/login.php`;
  if (method !== 'GET') return false;
  const path = target.pathname.slice('/pkp/'.length);
  if (!target.pathname.startsWith('/pkp/')) return false;
  return PAGES.includes(path) || READS.some(name => path === `api/${name}`)
    || /^(?:assets|css|js|images|img|fonts)\/[\w/.-]+\.(?:css|js|png|jpg|jpeg|svg|ico|woff2?)$/.test(path);
}

export function provinceRows(payload: unknown, fields: string[]): ProvinceRow[] {
  const data = payload as { ok?: boolean; data?: unknown } | null;
  if (!data || data.ok === false || !Array.isArray(data.data) || data.data.length > MAX_ROWS) throw new Error();
  return data.data.map(row => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error();
    return Object.fromEntries(fields.map(field => {
      const value = row[field];
      if (value !== undefined && value !== null && typeof value !== 'string' && typeof value !== 'number') throw new Error();
      if (typeof value === 'string' && value.length > 10_000) throw new Error();
      return [field, value ?? null];
    }));
  });
}

export async function fulfillProvinceRequest(route: Route, timeout: number): Promise<void> {
  // Never let either Playwright's fetch or the browser automatically follow a redirect.
  const response = await route.fetch({ maxRedirects: 0, maxRetries: 0, timeout });
  try {
    const status = response.status();
    if (status >= 300 && status < 400) {
      const request = route.request();
      const location = response.headers().location;
      if (request.method() !== 'POST' || request.url() !== `${BASE}api/login.php`
        || ![302, 303].includes(status) || !location
        || new URL(location, request.url()).href !== `${BASE}puskesmas.html`) throw new Error('Redirect blocked');
      // Preserve only the login cookie, not Location, Refresh, or the portal response body.
      const cookie = response.headers()['set-cookie'];
      await route.fulfill({ status: 200, headers: { 'content-type': 'text/plain', ...(cookie ? { 'set-cookie': cookie } : {}) }, body: '' });
    } else {
      if (response.headers().refresh) throw new Error('Redirect blocked');
      await route.fulfill({ response });
    }
  } finally {
    await response.dispose();
  }
}

@Injectable()
export class ProvinceAdapter {
  private active = 0;

  async read(credentials: { username: string; password: string; provinceHealthCenterCode: string }, monthly = false): Promise<ProvinceSnapshot> {
    if (this.active >= 2) throw new ServiceUnavailableException('Province reader is busy; retry later');
    this.active++;
    let browser: Browser | undefined;
    let timer: NodeJS.Timeout | undefined;
    let expired = false;
    let stage = 'BROWSER_UNAVAILABLE';
    const deadline = Date.now() + TIMEOUT;
    try {
      browser = await chromium.launch({ headless: true, timeout: 10_000 });
      stage = 'PORTAL_LOGIN_FAILED';
      const activeBrowser = browser;
      timer = setTimeout(() => { expired = true; void activeBrowser.close().catch(() => undefined); }, Math.max(1, deadline - Date.now()));
      const context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: false });
      context.setDefaultTimeout(8_000);
      context.setDefaultNavigationTimeout(10_000);
      await context.routeWebSocket('**/*', socket => socket.close());
      let loginAllowed = false;
      let requestFailed = false;
      await context.route('**/*', async route => {
        const request = route.request();
        const allowed = !expired && provinceRequestAllowed(request.url(), request.method(), loginAllowed);
        if (allowed && request.method() === 'POST') loginAllowed = false;
        if (!allowed) { await route.abort(); return; }
        try {
          await fulfillProvinceRequest(route, Math.max(1, Math.min(8_000, deadline - Date.now())));
        } catch {
          requestFailed = true;
          await route.abort().catch(() => undefined);
        }
      });
      const page = await context.newPage();
      await page.goto(BASE);
      const form = page.locator('form').filter({ has: page.locator('#password') });
      const action = await form.getAttribute('action');
      if (!action || new URL(action, BASE).href !== `${BASE}api/login.php` || (await form.getAttribute('method'))?.toLowerCase() !== 'post') throw new Error();
      await page.locator('#username').fill(credentials.username);
      await page.locator('#password').fill(credentials.password);
      loginAllowed = true;
      const [loginResponse] = await Promise.all([
        page.waitForResponse(response => response.url() === `${BASE}api/login.php` && response.request().method() === 'POST'),
        form.locator('[type="submit"]').click(),
      ]);
      loginAllowed = false;
      if (!loginResponse.ok()) throw new Error();
      // Always leave the credential form before reading; only these fixed pages are allowed.
      await page.goto(`${BASE}puskesmas.html`);
      if (requestFailed) throw new Error();
      const get = async (name: string): Promise<unknown> => page.evaluate(async url => {
        const response = await fetch(url, { method: 'GET', credentials: 'same-origin', redirect: 'error', signal: AbortSignal.timeout(8_000) });
        if (!response.ok) throw new Error('Read failed');
        const text = await response.text();
        if (text.length > 5_000_000) throw new Error('Read too large');
        return JSON.parse(text);
      }, `${BASE}api/${name}`);
      stage = 'READ_FAILED';
      const identity = await get('get_current_user.php') as { ok?: boolean; user?: { role?: unknown; puskesmas_kode?: unknown } } | null;
      stage = identity?.ok === false ? 'PORTAL_LOGIN_FAILED' : 'IDENTITY_MISMATCH';
      if (identity?.ok === false || identity?.user?.role !== 'puskesmas'
        || typeof identity.user.puskesmas_kode !== 'string' || !identity.user.puskesmas_kode
        || identity.user.puskesmas_kode !== credentials.provinceHealthCenterCode) throw new Error();
      stage = 'READ_FAILED';
      const targets = provinceRows(await get('get_total_sasaran.php'), ['kd_ind', 'indikator', 'satuan', 'total_sasaran']);
      const months = provinceRows(await get('get_month_options.php'), ['bulan', 'nama']);
      const records = monthly ? provinceRows(await get('get_data_kinerja.php'),
        ['bulan', 'kdindikator', 'indikator', 'target', 'sasaran', 'jml_sasaran', 'target_sasaran', 'capaian', 'hasil_riil', 'hasil_kinerja']) : [];
      if (requestFailed) throw new Error();
      return { provinceHealthCenterCode: identity.user.puskesmas_kode, targets, months, monthly: records };
    } catch {
      throw new ServiceUnavailableException(`${stage}: Province read failed`);
    } finally {
      if (timer) clearTimeout(timer);
      try { await browser?.close(); } catch { /* Never expose browser errors or session data. */ }
      this.active--;
    }
  }
}
