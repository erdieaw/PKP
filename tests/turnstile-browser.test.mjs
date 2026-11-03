import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from 'playwright';

// Isolated UI fixtures only: no real authentication, database, secret env, or Cloudflare requests.
test('login Turnstile lifecycle and responsive states', async t => {
  const server = await createServer({
    root: fileURLToPath(new URL('..', import.meta.url)), configFile: false, envFile: false,
    plugins: [react()], server: { host: '127.0.0.1', port: 0 },
    optimizeDeps: { noDiscovery: true, include: ['react', 'react-dom/client', 'react/jsx-dev-runtime', 'lucide-react'] },
    define: { 'import.meta.env.VITE_API_BASE_URL': JSON.stringify('/api/v1') },
  });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({ headless: true });
    const origin = server.resolvedUrls.local[0];
    async function fixture({ enabled = true, brokenScript = false, brokenConfig = false, width = 1440, configDelay = 0, loginStatus = 401, rejectAsyncReady = false } = {}) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      page.setDefaultTimeout(8000);
      const attempts = [];
      const exceptions = [];
      const configRequests = [];
      let scriptBlocked = brokenScript;
      let configBlocked = brokenConfig;
      page.on('pageerror', error => exceptions.push(error.message));
      await page.route('**/api/v1/**', async route => {
        if (route.request().url().endsWith('/auth/login-config')) {
          configRequests.push(route.request().url());
          if (configDelay) await new Promise(resolve => setTimeout(resolve, configDelay));
          return route.fulfill({ status: configBlocked ? 503 : 200, json: { data: { turnstileEnabled: enabled, turnstileSiteKey: enabled ? 'fixture-site-key' : null } } });
        }
        assert.ok(route.request().url().endsWith('/auth/login'));
        attempts.push(route.request().postDataJSON());
        return route.fulfill({ status: loginStatus, json: { message: 'Fixture rejection' } });
      });
      await page.route('https://challenges.cloudflare.com/**', route => scriptBlocked ? route.abort() : route.fulfill({
        contentType: 'application/javascript',
        body: `window.fixtureRenders = 0; window.fixtureRemovals = 0; window.fixtureReadyCalls = 0;
          const script = document.currentScript;
          window.turnstile = {
            ready(callback) {
              window.fixtureReadyCalls++;
              if (${rejectAsyncReady} && (script.async || script.defer)) {
                throw new Error('Remove async/defer before using turnstile.ready()');
              }
              callback();
            },
            render(container, options) {
              window.fixtureOptions = options; window.fixtureRenders++;
              const frame = document.createElement('iframe'); frame.title = 'Verifikasi keamanan';
              frame.style.width = options.size === 'compact' ? '150px' : '300px';
              frame.style.height = options.size === 'compact' ? '140px' : '65px';
              container.appendChild(frame); window.fixtureContainer = container;
              return 'fixture-widget';
            },
            remove() { window.fixtureRemovals++; window.fixtureContainer?.replaceChildren(); }
          };`,
      }));
      await page.goto(origin);
      await page.getByLabel('Nama pengguna', { exact: true }).fill('fixture-user');
      await page.getByLabel('Kata sandi', { exact: true }).fill('fixture-password');
      return { page, attempts, exceptions, configRequests, recover: () => { scriptBlocked = false; configBlocked = false; } };
    }

    await t.test('async script renders without calling ready, matching the production Cloudflare restriction', async () => {
      const { page, exceptions, attempts } = await fixture({ rejectAsyncReady: true });
      try {
        await page.waitForFunction(() => window.fixtureOptions);
        assert.equal(await page.locator('script[src*="challenges.cloudflare.com"]').evaluate(script => script.async), true);
        assert.equal(await page.evaluate(() => window.fixtureReadyCalls), 0);
        assert.deepEqual(exceptions, []);
        assert.equal(await page.locator('button[type="submit"]').isDisabled(), true);
        await page.evaluate(() => window.fixtureOptions.callback('fixture-token'));
        assert.equal(await page.locator('button[type="submit"]').isDisabled(), false);
        assert.equal(attempts.length, 0);
      } finally { await page.close(); }
    });

    await t.test('requires a token, sends it once, then resets after rejected credentials', async () => {
      const { page, attempts, exceptions } = await fixture();
      try {
        await page.waitForFunction(() => window.fixtureOptions);
        assert.equal(await page.locator('button[type="submit"]').isDisabled(), true);
        assert.equal(attempts.length, 0);
        await page.evaluate(() => window.fixtureOptions.callback('fixture-token'));
        await page.locator('button[type="submit"]').click();
        await page.getByRole('alert').waitFor();
        assert.equal(await page.getByRole('alert').innerText(), 'Nama pengguna atau kata sandi salah. Periksa kembali dan coba lagi. Jika tetap tidak bisa masuk, hubungi Admin Puskesmas atau Dinkes.');
        await page.waitForFunction(() => window.fixtureRenders >= 2 && window.fixtureRemovals >= 1);
        assert.deepEqual(attempts, [{ username: 'fixture-user', password: 'fixture-password', turnstileToken: 'fixture-token' }]);
        assert.equal(await page.locator('button[type="submit"]').isDisabled(), true);
        assert.equal(await page.evaluate(() => window.fixtureOptions.action), 'login');
        assert.deepEqual(exceptions, []);
      } finally { await page.close(); }
    });

    await t.test('challenge rejection is distinct from incorrect credentials', async () => {
      const { page, attempts } = await fixture({ loginStatus: 422 });
      try {
        await page.waitForFunction(() => window.fixtureOptions);
        await page.evaluate(() => window.fixtureOptions.callback('fixture-token'));
        await page.locator('button[type="submit"]').click();
        await page.getByRole('alert').waitFor();
        assert.match(await page.getByRole('alert').textContent(), /Verifikasi keamanan tidak valid atau kedaluwarsa/);
        assert.equal(attempts.length, 1);
        assert.equal(await page.locator('button[type="submit"]').isDisabled(), true);
      } finally { await page.close(); }
    });

    await t.test('expiry, timeout and widget errors clear tokens and permit retry', async () => {
      const { page, attempts } = await fixture();
      try {
        await page.waitForFunction(() => window.fixtureOptions);
        for (const callback of ['expired-callback', 'timeout-callback', 'error-callback']) {
          await page.evaluate(name => { window.fixtureOptions.callback('fixture-token'); window.fixtureOptions[name](); }, callback);
          assert.equal(await page.locator('button[type="submit"]').isDisabled(), true);
          await page.getByRole('button', { name: 'Ulangi verifikasi' }).click();
          await page.getByText('Selesaikan verifikasi keamanan.', { exact: true }).waitFor();
        }
        assert.equal(attempts.length, 0);
      } finally { await page.close(); }
    });

    await t.test('script and configuration failures keep login blocked', async () => {
      for (const options of [{ brokenScript: true }, { brokenConfig: true }]) {
        const { page, attempts, recover } = await fixture(options);
        try {
          await page.getByText('Verifikasi tidak tersedia. Periksa koneksi lalu coba lagi.', { exact: true }).waitFor();
          assert.equal(await page.locator('button[type="submit"]').isDisabled(), true);
          assert.equal(attempts.length, 0);
          recover();
          await page.getByRole('button', { name: 'Ulangi verifikasi' }).click();
          await page.waitForFunction(() => window.fixtureOptions);
          await page.evaluate(() => window.fixtureOptions.callback('fixture-token'));
          assert.equal(await page.locator('button[type="submit"]').isDisabled(), false);
        } finally { await page.close(); }
      }
    });

    await t.test('explicitly disabled local configuration needs no script or token', async () => {
      const { page, attempts, configRequests } = await fixture({ enabled: false, configDelay: 100 });
      try {
        await page.waitForFunction(() => !document.querySelector('button[type="submit"]').disabled);
        await page.waitForTimeout(250);
        const settledCount = configRequests.length;
        await page.waitForTimeout(500);
        assert.equal(configRequests.length, settledCount, 'Hidden widgets must not refetch configuration on a resize loop');
        assert.ok(settledCount <= 3);
        await page.locator('button[type="submit"]').click();
        await page.getByRole('alert').waitFor();
        assert.deepEqual(attempts, [{ username: 'fixture-user', password: 'fixture-password' }]);
        assert.equal(await page.locator('script[src*="challenges.cloudflare.com"]').count(), 0);
      } finally { await page.close(); }
    });

    await t.test('fits 320px through desktop and re-renders on resize without stale tokens', async () => {
      const { page, exceptions } = await fixture();
      try {
        let previousSize;
        for (const width of [1440, 320, 375, 390, 768, 1440]) {
          await page.evaluate(() => { window.fixturePreviousOptions = window.fixtureOptions; });
          await page.setViewportSize({ width, height: 900 });
          await page.waitForFunction(() => {
            const container = document.querySelector('.login-challenge > div');
            return window.fixtureOptions?.size === (container.clientWidth < 300 ? 'compact' : 'flexible');
          });
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `Overflow at ${width}px`);
          const size = await page.evaluate(() => window.fixtureOptions.size);
          if (size !== previousSize) {
            if (previousSize !== undefined) await page.evaluate(() => window.fixturePreviousOptions?.callback('stale-token'));
            assert.equal(await page.locator('button[type="submit"]').isDisabled(), true);
          }
          await page.evaluate(() => window.fixtureOptions.callback('fixture-token'));
          previousSize = size;
        }
        assert.deepEqual(exceptions, []);
      } finally { await page.close(); }
    });
  } finally {
    await browser?.close();
    await server.close();
  }
});
