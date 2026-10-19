import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

// Run against an already running development Vite frontend and real backend:
// node tests/session-browser.e2e.mjs
const require = createRequire(new URL('../package.json', import.meta.url));
const backendRequire = createRequire(new URL('../backend/package.json', import.meta.url));
const { chromium } = require('playwright');
const jwt = backendRequire('jsonwebtoken');
const env = backendRequire('dotenv').config({
  path: fileURLToPath(new URL('../backend/.env', import.meta.url)), quiet: true,
}).parsed ?? {};
const secret = process.env.JWT_SECRET || env.JWT_SECRET;
const password = process.env.FE_E2E_PASSWORD ?? randomBytes(24).toString('base64url');
const newPassword = randomBytes(24).toString('base64url');
const frontend = process.env.FE_E2E_URL || 'http://localhost:5175';
const backend = (process.env.FE_E2E_API_URL || 'http://localhost:4000/api/v1').replace(/\/$/, '');
const data = payload => payload?.data ?? payload;
const secrets = new Set([password, newPassword, secret].filter(Boolean));
const failures = [];
let browser;
let page;
let fixture;
let stage = 'development prerequisites';
let responses = [];

function redact(message) {
  let result = String(message);
  for (const value of secrets) result = result.replaceAll(value, '[REDACTED]');
  return result.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[REDACTED JWT]');
}

function remember(tokens) {
  for (const token of [tokens.accessToken, tokens.refreshToken]) {
    assert.equal(typeof token, 'string', 'Backend must issue session tokens.');
    secrets.add(token);
  }
  return tokens;
}

function expired(tokens) {
  remember(tokens);
  // Keep the real session claims and valid signature; only the clock claims change.
  // This is a token fixture, not an HTTP interception or mocked response.
  const claims = jwt.verify(tokens.accessToken, secret, {
    algorithms: ['HS256'], issuer: 'sipkp', audience: 'sipkp-api', ignoreExpiration: true,
  });
  const token = jwt.sign({ ...claims, iat: Math.floor(Date.now() / 1000) - 120,
    exp: Math.floor(Date.now() / 1000) - 60 }, secret, { algorithm: 'HS256' });
  secrets.add(token);
  assert.throws(() => jwt.verify(token, secret, {
    algorithms: ['HS256'], issuer: 'sipkp', audience: 'sipkp-api',
  }), error => error.name === 'TokenExpiredError', 'Fixture must be expired, not an invalid signature.');
  return token;
}

async function http(path, body, expected = 200, retried = false) {
  const response = await fetch(`${backend}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(30_000),
  });
  if (path === '/auth/login' && response.status === 429 && !retried) {
    await rateWindow(response.headers.get('retry-after'));
    return http(path, body, expected, true);
  }
  assert.equal(response.status, expected, `POST ${path}: unexpected HTTP status.`);
  if (expected !== 401) return data(await response.json());
}

async function rateWindow(header) {
  const seconds = Number(header);
  const delay = Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds + 1, 121) : 61;
  console.log(`Real backend login rate limit reached; waiting ${delay}s before one retry.`);
  await new Promise(resolve => setTimeout(resolve, delay * 1000));
}

function sequence(expected) {
  assert.deepEqual(responses, expected, `${stage}: unexpected real auth response sequence.`);
  responses = [];
}

async function ready() {
  await page.waitForFunction(centerId => {
    const year = document.querySelector('select[aria-label="Tahun anggaran"]');
    const center = document.querySelector('select[aria-label="Puskesmas"]');
    return year?.value === '2026' && !year.disabled && center?.value === centerId;
  }, fixture.healthCenterId);
  assert.equal(await page.getByRole('alert').count(), 0, 'Scope must load without errors.');
}

async function login() {
  assert.equal(await page.getByRole('group', { name: 'Peran akun' }).count(), 0);
  await page.getByLabel(/Username|ID Staf/).fill(fixture.adminUsername);
  await page.getByLabel('Kata sandi', { exact: true }).fill(password);
  async function submit() {
    const loggedIn = page.waitForResponse(response =>
      new URL(response.url()).pathname.endsWith('/auth/login') && response.request().method() === 'POST');
    await page.locator('form button[type="submit"]').click();
    return loggedIn;
  }
  let response = await submit();
  if (response.status() === 429) {
    sequence([['POST', '/auth/login', 429]]);
    await rateWindow(response.headers()['retry-after']);
    response = await submit();
  }
  assert.equal(response.status(), 200, 'Admin UI login must succeed.');
  const tokens = remember(data(await response.json()));
  await ready();
  await page.evaluate(async () => {
    // Reuse Vite's timestamped UI modules after HMR, not a second empty store.
    const resources = performance.getEntriesByType('resource').map(entry => entry.name);
    const url = name => resources.find(value => new URL(value).pathname === `/src/services/${name}.ts`);
    window.__sessionE2E = {
      api: (await import(url('apiClient'))).api,
      pkpStore: (await import(url('apiStore'))).pkpStore,
    };
  });
  sequence([['POST', '/auth/login', 200]]);
  return tokens;
}

async function installExpired(tokens) {
  await page.evaluate(async accessToken => {
    const { api } = window.__sessionE2E;
    const refreshToken = sessionStorage.getItem('SIPKP_SESSION');
    if (!refreshToken) throw new Error('Expected the current tab session.');
    api.setSession({ accessToken, refreshToken });
  }, expired(tokens));
}

try {
  assert.ok(password.length >= 12, 'FE_E2E_PASSWORD must contain at least 12 characters.');
  assert.ok(secret && secret.length >= 32, 'JWT_SECRET is required from the backend environment or backend/.env.');
  stage = 'isolated fixture seed';
  const seeded = await promisify(execFile)(fileURLToPath(new URL('../backend/node_modules/.bin/tsx', import.meta.url)),
    ['scripts/seed-workflow-browser.ts'], {
      cwd: fileURLToPath(new URL('../backend/', import.meta.url)), timeout: 60_000,
      env: { ...process.env, NODE_ENV: 'development', FE_E2E_PASSWORD: password },
    }).catch(() => { throw new Error('Isolated development fixture seed failed (credential details suppressed).'); });
  fixture = JSON.parse(seeded.stdout.trim());
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  page = await context.newPage();
  page.setDefaultTimeout(30_000);
  page.on('pageerror', () => failures.push('Uncaught browser exception.'));
  page.on('response', response => {
    const path = new URL(response.url()).pathname;
    const prefix = '/api/v1';
    if (path.startsWith(`${prefix}/auth/`)) responses.push([
      response.request().method(), path.slice(prefix.length), response.status(),
    ]);
    else if (path.startsWith(`${prefix}/`) && response.status() >= 400) {
      failures.push(`${response.request().method()} ${path}: HTTP ${response.status()}`);
    }
  });
  // No routes, fetch overrides, traces, or HARs: all responses come from the backend.
  stage = 'Admin UI login and loaded tenant scope';
  await page.goto(frontend);
  let tokens = await login();
  const userId = tokens.user.id;
  assert.equal(tokens.user.healthCenterId, fixture.healthCenterId);

  stage = 'expired access refreshes once and retries /auth/me';
  await installExpired(tokens);
  const refreshed = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/auth/refresh'));
  const me = await page.evaluate(async () => {
    const { api } = window.__sessionE2E;
    return api.request('/auth/me');
  });
  assert.equal(me.id, userId);
  assert.equal(me.healthCenterId, fixture.healthCenterId);
  const refreshedTokens = remember(data(await (await refreshed).json()));
  assert.ok(refreshedTokens.refreshToken !== tokens.refreshToken, 'Refresh must rotate the credential.');
  tokens = refreshedTokens;
  assert.equal(await page.evaluate(() => window.__sessionE2E.api.hasSession()), true);
  sequence([['GET', '/auth/me', 401], ['POST', '/auth/refresh', 200], ['GET', '/auth/me', 200]]);
  assert.equal(await page.evaluate(() => Boolean(sessionStorage.getItem('SIPKP_SESSION'))), true);
  assert.equal(await page.evaluate(() => localStorage.getItem('SIPKP_SESSION')), null, 'Refresh credentials must not persist in localStorage.');

  stage = 'scope controls and store reject changes during a real write';
  const write = await page.evaluate(async () => {
    const { pkpStore } = window.__sessionE2E;
    const before = { year: pkpStore.getCurrentYear(), center: pkpStore.getSelectedHealthCenterId() };
    let disabledObserved = false;
    const observe = () => {
      const labels = ['Tahun anggaran', 'Puskesmas', 'Bulan evaluasi'];
      if (pkpStore.isMutating() && labels.every(label => document.querySelector(`select[aria-label="${label}"]`)?.disabled)) disabledObserved = true;
    };
    const observer = new MutationObserver(observe);
    observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['disabled'] });
    try {
      const indicator = pkpStore.getIndicators()[0];
      const saving = pkpStore.updateAnnualTarget(indicator.id, 100, 120);
      const pending = pkpStore.isMutating();
      const blocked = await Promise.all([
        pkpStore.setCurrentYear(before.year), pkpStore.selectHealthCenter(before.center),
      ].map(operation => operation.then(() => false, error => error.message === 'Tunggu penyimpanan selesai sebelum mengganti lingkup.')));
      await saving;
      return { pending, blocked, disabledObserved, before,
        after: { year: pkpStore.getCurrentYear(), center: pkpStore.getSelectedHealthCenterId() },
        settled: !pkpStore.isMutating(), target: pkpStore.getAnnualTargets()[indicator.id]?.totalSasaran };
    } finally { observer.disconnect(); }
  });
  assert.equal(write.pending, true);
  assert.deepEqual(write.blocked, [true, true]);
  assert.equal(write.disabledObserved, true, 'Scope controls must disable during the real pending write.');
  assert.deepEqual(write.after, write.before);
  assert.equal(write.settled, true);
  assert.equal(Number(write.target), 120, 'Real target write must be loaded back from the backend.');
  await ready();
  sequence([]);

  stage = 'logout with expired access refreshes, retries, and revokes session';
  await installExpired(tokens);
  const logoutRefresh = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/auth/refresh'));
  await page.evaluate(async () => {
    const { api } = window.__sessionE2E;
    await api.logout();
  });
  const loggedOut = remember(data(await (await logoutRefresh).json()));
  sequence([['POST', '/auth/logout', 401], ['POST', '/auth/refresh', 200], ['POST', '/auth/logout', 200]]);
  assert.equal(await page.evaluate(() => sessionStorage.getItem('SIPKP_SESSION')), null);
  await http('/auth/refresh', { refreshToken: loggedOut.refreshToken }, 401);
  await http('/auth/refresh', { refreshToken: tokens.refreshToken }, 401);

  stage = 'password change with expired access and all-session revocation';
  await page.reload();
  tokens = await login();
  const otherSession = remember(await http('/auth/login', { username: fixture.adminUsername, password, role: 'ADMIN_PUSKESMAS' }));
  await installExpired(tokens);
  const passwordRefresh = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/auth/refresh'));
  const changed = await page.evaluate(async ({ currentPassword, newPassword }) => {
    const { pkpStore } = window.__sessionE2E;
    const result = await pkpStore.changeUserPassword(currentPassword, newPassword);
    return { result, user: pkpStore.getSessionUser(), pending: pkpStore.isMutating(), session: sessionStorage.getItem('SIPKP_SESSION') };
  }, { currentPassword: password, newPassword });
  const passwordSession = remember(data(await (await passwordRefresh).json()));
  sequence([['POST', '/auth/change-password', 401], ['POST', '/auth/refresh', 200], ['POST', '/auth/change-password', 200]]);
  assert.deepEqual(changed, { result: { passwordChanged: true, requiresLogin: true }, user: null, pending: false, session: null });
  for (const session of [passwordSession, otherSession]) {
    await http('/auth/refresh', { refreshToken: session.refreshToken }, 401);
    const response = await fetch(`${backend}/auth/me`, {
      headers: { Authorization: `Bearer ${session.accessToken}` }, signal: AbortSignal.timeout(30_000),
    });
    assert.equal(response.status, 401, 'Password change must revoke access for every existing session.');
  }

  stage = 'stale real refresh cannot resurrect a cleared session';
  const fresh = remember(await http('/auth/login', { username: fixture.adminUsername, password: newPassword, role: 'ADMIN_PUSKESMAS' }));
  const staleRefresh = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/auth/refresh'));
  const stale = await page.evaluate(async tokens => {
    const { api } = window.__sessionE2E;
    api.setSession(tokens);
    const refreshing = api.refresh();
    api.clearSession();
    const status = await refreshing.then(() => 200, error => error.status);
    return { status, hasSession: api.hasSession(), session: sessionStorage.getItem('SIPKP_SESSION') };
  }, { accessToken: fresh.accessToken, refreshToken: fresh.refreshToken });
  const rotated = remember(data(await (await staleRefresh).json()));
  sequence([['POST', '/auth/refresh', 200]]);
  assert.deepEqual(stale, { status: 401, hasSession: false, session: null });
  assert.equal(await page.evaluate(() => window.__sessionE2E.pkpStore.getSessionUser()), null);
  // Revoke the server session created solely for the stale-response regression.
  const revoked = await fetch(`${backend}/auth/logout`, {
    method: 'POST', headers: { Authorization: `Bearer ${rotated.accessToken}` }, signal: AbortSignal.timeout(30_000),
  });
  assert.equal(revoked.status, 200);
  assert.deepEqual(failures, [], 'Unexpected browser or backend errors.');
  console.log('PASS: real Admin UI login/scope, expired-access refresh/retry, pending-write scope guards, logout revocation, password-change all-session revocation, and stale-refresh isolation.');
} catch (error) {
  if (page && !page.isClosed()) {
    // Remove form contents before capturing UI; never capture network credentials.
    await page.locator('input').evaluateAll(inputs => inputs.forEach(input => { input.value = ''; })).catch(() => {});
    const screenshot = `/tmp/opencode/session-failure-${Date.now()}.png`;
    await page.screenshot({ path: screenshot, fullPage: true }).then(
      () => console.error(`Failure screenshot: ${screenshot}`), () => {},
    );
  }
  console.error(`FAIL at ${stage}: ${redact(error.message)}`);
  if (failures.length) console.error(redact(failures.join('\n')));
  process.exitCode = 1;
} finally {
  await browser?.close();
}
