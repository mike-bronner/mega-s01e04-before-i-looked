import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { RigConfig } from '../src/config.js';

const config: RigConfig = { adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir: 'runs' };

let dir: string;
let out: string;
let server: Server | undefined;

function run(port: number, ...args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/save-preview.ts', ...args], {
      env: { ...process.env, PORT: String(port) },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

function rig(): Promise<number> {
  return new Promise((resolve) => {
    server = serve({ fetch: createApp(config).fetch, port: 0 }, (info) => resolve(info.port)) as Server;
  });
}

function stoppedPort(): Promise<number> {
  const s = createServer();
  return new Promise((resolve) =>
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as AddressInfo;
      s.close(() => resolve(port));
    }),
  );
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'save-preview-'));
  out = join(dir, 'preview.html');
});

afterEach(async () => {
  const s = server;
  server = undefined;
  if (s) await new Promise<void>((resolve) => s.close(() => resolve()));
  rmSync(dir, { recursive: true, force: true });
});

describe('CLI boundary: exit codes of the spawned save-preview script', () => {
  it('exit 0: saves one file from a running rig', async () => {
    const port = await rig();
    const result = await run(port, '2026-10-28', out);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(`saved http://localhost:${port}/digest/2026-10-28 to ${out}`);
    expect(readdirSync(dir)).toEqual(['preview.html']);
  });

  it('exit 1: reports the error code and writes nothing when rig is stopped', async () => {
    const result = await run(await stoppedPort(), '2026-10-28', out);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('save-preview: fetch failed (ECONNREFUSED)');
    expect(readdirSync(dir)).toEqual([]);
  });

  it.each([
    ['the output path is missing', () => ['2026-10-28']],
    ['the night is empty', () => ['', out]],
  ])('exit 2: prints usage and writes nothing when %s', async (_case, args) => {
    const result = await run(1, ...args());
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('usage:');
    expect(readdirSync(dir)).toEqual([]);
  });
});
