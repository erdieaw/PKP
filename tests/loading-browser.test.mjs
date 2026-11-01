import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from 'playwright';

test('startup background remains consistent before scripts and through session loading', async t => {
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
    const backgroundColor = 'rgb(238, 241, 235)';

    await t.test('HTML supplies the background and viewport height without JavaScript or application CSS', async () => {
      const page = await browser.newPage({ javaScriptEnabled: false, viewport: { width: 375, height: 812 } });
      try {
        await page.route('https://fonts.**/**', route => route.abort());
        await page.goto(origin);
        const initial = await page.evaluate(() => ({
          html: getComputedStyle(document.documentElement).backgroundColor,
          body: getComputedStyle(document.body).backgroundColor,
          margin: getComputedStyle(document.body).margin,
          rootHeight: document.getElementById('root').getBoundingClientRect().height,
          viewportHeight: innerHeight,
          empty: document.getElementById('root').childElementCount === 0,
        }));
        assert.equal(initial.html, backgroundColor);
        assert.equal(initial.body, backgroundColor);
        assert.equal(initial.margin, '0px');
        assert.equal(initial.rootHeight, initial.viewportHeight);
        assert.equal(initial.empty, true);
      } finally { await page.close(); }
    });

    for (const width of [1440, 375]) {
      await t.test(`loading, recovery and login share a background at ${width}px`, async () => {
        const reducedMotion = width === 375 ? 'reduce' : 'no-preference';
        const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion });
        page.setDefaultTimeout(10000);
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        try {
          await page.route('https://fonts.**/**', route => route.abort());
          await page.route('**/api/v1/**', route => {
            assert.ok(route.request().url().endsWith('/auth/login-config'), 'No real session or login requests');
            return route.fulfill({ json: { data: { turnstileEnabled: false, turnstileSiteKey: null } } });
          });
          // Hold the real App's session handoff without credentials or a backend.
          await page.route('**/src/main.tsx', async route => {
            const response = await route.fetch();
            await route.fulfill({ response, body: `
              import { pkpStore } from '/src/services/apiStore.ts';
              pkpStore.restore = () => new Promise((resolve, reject) => {
                window.loadingFixtureResolve = () => resolve(null);
                window.loadingFixtureReject = () => reject(new Error('Fixture session failure'));
              });
              ${await response.text()}
            ` });
          });
          await page.goto(origin);
          await page.getByText('Memuat sesi dan data SIPKP...', { exact: true }).waitFor();
          const surface = () => page.locator('.app-loading, .login-page').evaluate(element => {
            const style = getComputedStyle(element);
            return { color: style.backgroundColor, image: style.backgroundImage, size: style.backgroundSize,
              position: style.backgroundPosition, repeat: style.backgroundRepeat };
          });
          const loading = await surface();
          assert.equal(loading.color, backgroundColor);
          assert.notEqual(loading.image, 'none');
          assert.equal(loading.position, width <= 900 ? '100% 50%' : '50% 50%');
          assert.equal(await page.locator('.processing-indicator__orbit > span').evaluate(element =>
            getComputedStyle(element).animationName), reducedMotion === 'reduce' ? 'none' : 'processing-indicator-orbit');

          await page.evaluate(() => window.loadingFixtureReject());
          await page.getByRole('alert').waitFor();
          assert.deepEqual(await surface(), loading);
          await page.getByRole('button', { name: 'Coba Lagi' }).click();
          await page.getByText('Memuat sesi dan data SIPKP...', { exact: true }).waitFor();
          assert.deepEqual(await surface(), loading);
          await page.evaluate(() => window.loadingFixtureResolve());
          await page.getByLabel('Username', { exact: true }).waitFor();
          assert.deepEqual(await surface(), loading);

          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
          assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), backgroundColor);
          assert.deepEqual(errors, []);
        } finally { await page.close(); }
      });
    }
  } finally {
    await browser?.close();
    await server.close();
  }
});
