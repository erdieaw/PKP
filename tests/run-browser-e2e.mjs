import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';

const env = { ...process.env, FE_E2E_PASSWORD: process.env.FE_E2E_PASSWORD || randomBytes(24).toString('hex') };
const commands = [
  ['./backend/node_modules/.bin/tsx', ['backend/scripts/seed-browser-test.ts']],
  [process.execPath, ['tests/frontend.e2e.mjs']],
  [process.execPath, ['tests/workflow-browser.e2e.mjs']],
  [process.execPath, ['tests/session-browser.e2e.mjs']],
];
for (let index = 0; index < commands.length; index++) {
  // Browser suites share an IP; retain the real five-login/minute protection.
  if (index >= 2) await setTimeout(61_000);
  const [command, args] = commands[index];
  const result = spawnSync(command, args, { env, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
