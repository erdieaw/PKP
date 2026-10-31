import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const configs = ['nginx.conf', 'deploy/nginx.dokploy.conf.template'];
const uploadPath = '/api/v1/storage/uploads/12345678-1234-4123-8123-123456789abc/content';

for (const path of configs) {
  test(`${path}: larger raw PUT is UUID-scoped, streaming and proxy headers are preserved`, async () => {
    const source = await readFile(new URL(`../${path}`, import.meta.url), 'utf8');
    assert.match(source, /^    client_max_body_size 1m;$/m);
    assert.equal((source.match(/client_max_body_size 10m;/g) ?? []).length, 1);
    const match = source.match(/location ~ "([^"]+)" \{([\s\S]*?)\n    \}/);
    assert.ok(match, 'raw upload regex location must be quoted for Nginx quantifiers');
    const [, pattern, upload] = match;
    const route = new RegExp(pattern);
    assert.equal(route.test(uploadPath), true);
    for (const invalid of [uploadPath.replace('12345678', 'not-a-uuid'), `${uploadPath}/`,
      `${uploadPath}/extra`, uploadPath.replace('/content', '/finalize'), '/api/v1/storage/uploads',
      '/api/v1/storage/download', '/api/v1/export/jobs/id/content', `/prefix${uploadPath}`]) {
      assert.equal(route.test(invalid), false, invalid);
    }
    assert.match(upload, /client_max_body_size 10m;/);
    assert.match(upload, /limit_except PUT \{ deny all; \}/);
    assert.match(upload, /client_body_timeout 60s;/);
    assert.match(upload, /proxy_request_buffering off;/);
    const api = source.match(/location \/api\/ \{([\s\S]*?)\n    \}/)?.[1];
    assert.ok(api);
    assert.doesNotMatch(api, /client_max_body_size/);
    for (const location of [upload, api]) {
      assert.match(location, /proxy_buffering off;/);
      assert.match(location, /proxy_http_version 1\.1;/);
      assert.match(location, /proxy_connect_timeout 10s;/);
      assert.match(location, /proxy_send_timeout 120s;/);
      assert.match(location, /proxy_read_timeout 120s;/);
    }
    const headers = block => block.split('\n').map(line => line.trim()).filter(line => line.startsWith('proxy_set_header '));
    assert.deepEqual(headers(upload), headers(api));
    if (path.includes('dokploy')) {
      assert.match(source, /resolver 127\.0\.0\.11 valid=10s ipv6=off;/);
      assert.match(source, /set_real_ip_from \$\{TRAEFIK_TRUSTED_PROXY\};/);
      for (const location of [upload, api]) {
        assert.match(location, /proxy_pass \$backend\$request_uri;/);
        assert.match(location, /proxy_set_header X-Forwarded-For \$remote_addr;/);
        assert.match(location, /proxy_set_header X-Forwarded-Host \$host;/);
        assert.match(location, /proxy_set_header X-Forwarded-Proto https;/);
      }
    } else {
      for (const location of [upload, api]) {
        assert.match(location, /proxy_pass http:\/\/app:4000;/);
        assert.match(location, /proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;/);
        assert.match(location, /proxy_set_header X-Forwarded-Proto \$scheme;/);
      }
    }
  });
}

// Opt-in with an existing local frontend image; never pull/build or use real services/env.
const image = process.env.NGINX_TEST_IMAGE;
for (const path of configs) {
  test(`${path}: real Nginx upload limits and binary downloads`, {
    skip: !image && 'Set NGINX_TEST_IMAGE to an existing local frontend image for disposable proxy tests',
    timeout: 60000,
  }, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pkp-nginx-'));
    const name = `pkp-nginx-test-${randomUUID()}`;
    let started = false;
    const docker = args => {
      const result = spawnSync('docker', args, { encoding: 'utf8', timeout: 20000 });
      assert.equal(result.status, 0, result.stderr || result.error?.message);
      return result.stdout.trim();
    };
    try {
      const binary = Buffer.alloc(2 * 1024 * 1024);
      for (let index = 0; index < binary.length; index++) binary[index] = index % 256;
      await writeFile(join(directory, 'download.bin'), binary, { mode: 0o644 });
      // Only upstream destination/trusted IP are fixtures; actual locations/limits stay unchanged.
      const source = (await readFile(new URL(`../${path}`, import.meta.url), 'utf8'))
        .replaceAll('${TRAEFIK_TRUSTED_PROXY}', '192.0.2.10')
        .replaceAll('http://app:4000', 'http://127.0.0.1:19090');
      await writeFile(join(directory, 'default.conf'), `${source}\nserver {
    listen 127.0.0.1:19090;
    client_max_body_size 20m;
    location = /api/v1/storage/download { alias /fixtures/download.bin; }
    location = /api/v1/export/jobs/fixture/content { alias /fixtures/download.bin; }
    location / {
        root /tmp/upload-root;
        dav_methods PUT;
        create_full_put_path on;
    }
}\n`, { mode: 0o644 });
      // The non-root Nginx user needs traversal; these generated fixtures contain no secrets.
      await chmod(directory, 0o755);
      docker(['run', '--detach', '--rm', '--pull', 'never', '--name', name,
        '--publish', '127.0.0.1::8080', '--mount', `type=bind,src=${directory},dst=/fixtures,readonly`,
        '--mount', `type=bind,src=${join(directory, 'default.conf')},dst=/etc/nginx/conf.d/default.conf,readonly`,
        '--entrypoint', 'sh', image, '-c', "mkdir -p /tmp/upload-root && nginx -t && exec nginx -g 'daemon off;' "]);
      started = true;
      const port = docker(['port', name, '8080/tcp']).match(/^127\.0\.0\.1:(\d+)$/)?.[1];
      assert.ok(port);
      const origin = `http://127.0.0.1:${port}`;
      let ready = false;
      for (let attempt = 0; attempt < 40; attempt++) {
        try {
          const response = await fetch(`${origin}/api/v1/storage/download`, { method: 'HEAD', signal: AbortSignal.timeout(500) });
          if (response.ok) { ready = true; break; }
        } catch { /* The isolated Nginx process may still be starting. */ }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      assert.ok(ready, docker(['logs', name]));
      const request = (route, method, body) => fetch(`${origin}${route}`, {
        method, body, headers: { 'Content-Type': method === 'PUT' ? 'application/octet-stream' : 'application/json' },
        signal: AbortSignal.timeout(15000),
      });
      const upload = await request(uploadPath, 'PUT', binary);
      assert.equal(upload.status, 201, await upload.text());
      const expectedHash = createHash('sha256').update(binary).digest('hex');
      assert.equal(docker(['exec', name, 'sha256sum', `/tmp/upload-root${uploadPath}`]).split(/\s/)[0], expectedHash);
      const chunked = await fetch(`${origin}${uploadPath}`, {
        method: 'PUT', duplex: 'half', headers: { 'Content-Type': 'application/octet-stream' },
        body: (async function* () {
          for (let offset = 0; offset < binary.length; offset += 65536) yield binary.subarray(offset, offset + 65536);
        })(), signal: AbortSignal.timeout(15000),
      });
      assert.equal(chunked.status, 204, await chunked.text());
      assert.equal(docker(['exec', name, 'sha256sum', `/tmp/upload-root${uploadPath}`]).split(/\s/)[0], expectedHash);
      const max = await request(uploadPath, 'PUT', Buffer.alloc(10 * 1024 * 1024));
      assert.equal(max.status, 204, await max.text());
      const json = Buffer.from(JSON.stringify({ padding: 'x'.repeat(2 * 1024 * 1024) }));
      for (const route of ['/api/v1/storage/uploads', uploadPath.replace('12345678', 'invalid'),
        `${uploadPath}/`, uploadPath.replace('/content', '/finalize'), '/api/v1/records/bulk']) {
        const response = await request(route, 'POST', json);
        assert.equal(response.status, 413, `${route}: ${await response.text()}`);
      }
      const oversized = await request(uploadPath, 'PUT', Buffer.alloc(10 * 1024 * 1024 + 1));
      assert.equal(oversized.status, 413, await oversized.text());
      assert.equal((await request(uploadPath, 'POST', Buffer.from('small'))).status, 403);
      for (const route of ['/api/v1/storage/download?objectKey=fixture', '/api/v1/export/jobs/fixture/content']) {
        const response = await fetch(`${origin}${route}`, { signal: AbortSignal.timeout(10000) });
        assert.equal(response.status, 200);
        assert.deepEqual(Buffer.from(await response.arrayBuffer()), binary);
      }
    } finally {
      const cleanup = started ? spawnSync('docker', ['rm', '--force', name], { encoding: 'utf8', timeout: 20000 }) : null;
      await rm(directory, { recursive: true, force: true });
      if (cleanup) assert.equal(cleanup.status, 0, cleanup.stderr);
    }
  });
}
