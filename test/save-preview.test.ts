import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type RequestListener, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { RigConfig } from '../src/config.js';

const config: RigConfig = { adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir: 'runs' };
const MARKER = 'test-marker-7f3a';

let dir: string;
let out: string;
let server: Server | undefined;
let savedMarker: string | undefined;

function run(port: number, ...args: string[]): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/save-preview.ts', ...args], {
      env: { ...process.env, PORT: String(port) },
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('close', (code) => resolve({ code, stderr }));
  });
}

function listen(s: Server): Promise<number> {
  server = s;
  return new Promise((resolve) => s.listen(0, '127.0.0.1', () => resolve((s.address() as AddressInfo).port)));
}

function rig(): Promise<number> {
  return new Promise((resolve) => {
    server = serve({ fetch: createApp(config).fetch, port: 0 }, (info) => resolve(info.port)) as Server;
  });
}

function stub(handler: RequestListener): Promise<number> {
  return listen(createServer(handler));
}

function close(): Promise<void> {
  const s = server;
  server = undefined;
  return new Promise((resolve) => (s ? s.close(() => resolve()) : resolve()));
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'save-preview-'));
  out = join(dir, 'preview.html');
  savedMarker = process.env.LANE_MARKER;
  process.env.LANE_MARKER = MARKER;
});

afterEach(async () => {
  await close();
  if (savedMarker === undefined) delete process.env.LANE_MARKER;
  else process.env.LANE_MARKER = savedMarker;
  rmSync(dir, { recursive: true, force: true });
});

describe('save-preview against a running rig', () => {
  it('saves the digest page as one file, byte-identical to a fresh GET', async () => {
    const port = await rig();
    const result = await run(port, '2026-10-28', out);
    expect(result.code).toBe(0);
    expect(readdirSync(dir)).toEqual(['preview.html']);

    const fresh = Buffer.from(await (await fetch(`http://localhost:${port}/digest/2026-10-28`)).arrayBuffer());
    const saved = readFileSync(out);
    expect(saved.equals(fresh)).toBe(true);

    const html = saved.toString('utf8');
    expect(html).toContain('<table');
    expect(html).toContain('lane-07');
    expect(html).toContain(MARKER);
    expect(html).not.toContain('no marker set');
    for (const needle of ['<script', '<link', 'src=', '@import', 'url(']) expect(html).not.toContain(needle);
  });

  it('fails and writes nothing for a night with no run log (404)', async () => {
    const port = await rig();
    const result = await run(port, '2026-01-01', out);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('answered 404');
    expect(readdirSync(dir)).toEqual([]);
  });
});

describe('save-preview fails closed', () => {
  it('fails and writes nothing when rig is stopped', async () => {
    const port = await stub((_req, res) => res.end());
    await close();
    const result = await run(port, '2026-10-28', out);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('fetch failed (ECONNREFUSED)');
    expect(readdirSync(dir)).toEqual([]);
  });

  it('fails and writes nothing on a redirect, without following it', async () => {
    const port = await stub((_req, res) => res.writeHead(302, { location: '/' }).end('<p>moved</p>'));
    const result = await run(port, '2026-10-28', out);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('answered 302');
    expect(readdirSync(dir)).toEqual([]);
  });

  it('fails and writes nothing when the page is not self-contained', async () => {
    const port = await stub((_req, res) => res.end('<!doctype html><LINK rel="stylesheet" href="x.css">'));
    const result = await run(port, '2026-10-28', out);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('not self-contained: <link');
    expect(readdirSync(dir)).toEqual([]);
  });

  it('exits 2 with usage and writes nothing when the output path is missing', async () => {
    const result = await run(1, '2026-10-28');
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('usage:');
    expect(readdirSync(dir)).toEqual([]);
  });
});
