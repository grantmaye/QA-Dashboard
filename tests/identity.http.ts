import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

// Starts the actual built Next route; never points at an existing server or external database.
for (const scenario of [
  { name: 'missing configuration', mode: '', deployment: '', status: 503 },
  {
    name: 'authenticated without a provider',
    mode: 'authenticated',
    deployment: 'local',
    status: 401,
  },
  { name: 'hosted demo with live scans', mode: 'demo', deployment: 'hosted', status: 503 },
  {
    name: 'hosted authenticated without a provider',
    mode: 'authenticated',
    deployment: 'hosted',
    status: 401,
  },
]) {
  test(`built Next HTTP route fails closed: ${scenario.name}`, { timeout: 30000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'qa-identity-http-'));
    const data = join(root, 'database-must-not-exist');
    const port = 3197;
    const child = spawn(
      process.execPath,
      [
        'node_modules/next/dist/bin/next',
        'start',
        '--hostname',
        '127.0.0.1',
        '--port',
        String(port),
      ],
      {
        env: {
          ...process.env,
          NODE_ENV: 'production',
          NEXT_TELEMETRY_DISABLED: '1',
          DATABASE_URL: '',
          PGLITE_DATA_DIR: data,
          QA_IDENTITY_MODE: scenario.mode,
          QA_DEPLOYMENT_MODE: scenario.deployment,
          APP_ORIGIN: scenario.deployment === 'hosted' ? 'https://qa.example' : '',
          ENABLE_LIVE_SCANS: 'true',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let logs = '';
    child.stdout.on('data', (chunk) => {
      logs += chunk;
    });
    child.stderr.on('data', (chunk) => {
      logs += chunk;
    });
    const exited = once(child, 'exit');
    try {
      let ready = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        assert.equal(child.exitCode, null, 'Next exited before readiness');
        try {
          const response = await fetch(`http://127.0.0.1:${port}/`, {
            signal: AbortSignal.timeout(1000),
          });
          if (response.ok) {
            ready = true;
            break;
          }
        } catch {
          /* Wait for this local test process to bind. */
        }
        await delay(100);
      }
      assert.ok(ready, 'Local Next process did not become ready');
      for (const query of [
        '{ dashboard { sites { id } } }',
        'mutation { startPreflight(input:{variant:FIXED}) { id } }',
      ]) {
        const response = await fetch(`http://127.0.0.1:${port}/api/graphql`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Demo-Role': 'OWNER',
            Cookie: 'qa-workspace=12345678-1234-4123-8123-123456789012',
            Authorization: 'Bearer forged-client-token',
          },
          body: JSON.stringify({ query }),
        });
        assert.equal(response.status, scenario.status);
        assert.equal(response.headers.get('set-cookie'), null);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        const result = await response.text();
        assert.ok(!result.includes('12345678') && !result.includes('forged-client-token'));
      }
      await assert.rejects(access(data), { code: 'ENOENT' });
      assert.ok(!logs.includes('forged-client-token') && !logs.includes('12345678'));
    } finally {
      child.kill('SIGTERM');
      await exited;
      await rm(root, { recursive: true, force: true });
    }
  });
}
