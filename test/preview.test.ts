import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import type { RigConfig } from '../src/config.js';
import { EXTERNAL, type Fetch, savePreview } from '../scripts/preview.js';

const config: RigConfig = { adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir: 'runs' };
const LANE_ID = 'lane-test-3c';
const MARKER = 'test-marker-7f3a';
const URL = 'http://localhost/digest/2026-10-28';

let dir: string;
let out: string;

const rig: Fetch = async (url, init) => createApp(config).request(url, init);

function serving(body: string, init?: ResponseInit) {
  const calls: RequestInit[] = [];
  const get: Fetch = async (_url, request) => {
    calls.push(request);
    return new Response(body, init);
  };
  return { get, calls };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'preview-'));
  out = join(dir, 'preview.html');
  vi.stubEnv('LANE_ID', LANE_ID);
  vi.stubEnv('LANE_MARKER', MARKER);
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

describe('savePreview', () => {
  it('writes the digest page byte-identical to a fresh GET, banner included', async () => {
    await savePreview(URL, out, rig);
    expect(readdirSync(dir)).toEqual(['preview.html']);

    const fresh = Buffer.from(await (await rig(URL, {})).arrayBuffer());
    const file = readFileSync(out);
    expect(file.equals(fresh)).toBe(true);

    const html = file.toString('utf8');
    expect(html).toContain('<table');
    expect(html).toContain(LANE_ID);
    expect(html).toContain(MARKER);
    expect(html).not.toContain('no marker set');
    for (const needle of EXTERNAL) expect(html.toLowerCase()).not.toContain(needle);
  });

  it('refuses a night with no run log (404) and writes nothing', async () => {
    await expect(savePreview('http://localhost/digest/2026-01-01', out, rig)).rejects.toThrow('answered 404');
    expect(readdirSync(dir)).toEqual([]);
  });

  it('refuses a redirect without following it, and writes nothing', async () => {
    const { get, calls } = serving('<p>moved</p>', { status: 302, headers: { location: '/' } });
    await expect(savePreview(URL, out, get)).rejects.toThrow('answered 302');
    expect(calls).toEqual([{ redirect: 'manual' }]);
    expect(readdirSync(dir)).toEqual([]);
  });

  it.each([
    ['<script', '<p>x</p><SCRIPT>1</SCRIPT>'],
    ['<link', '<p>x</p><Link rel="stylesheet" href="x.css">'],
    ['src=', '<p>x</p><img SRC="x.png">'],
    ['@import', '<style>@IMPORT "x.css";</style>'],
    ['url(', '<p style="background: URL(x)">x</p>'],
  ])('refuses a page holding %s and writes nothing', async (needle, body) => {
    const { get } = serving(body);
    await expect(savePreview(URL, out, get)).rejects.toThrow(`not self-contained: ${needle}`);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('fails when the output folder does not exist', async () => {
    await expect(savePreview(URL, join(dir, 'missing', 'preview.html'), rig)).rejects.toThrow('ENOENT');
    expect(readdirSync(dir)).toEqual([]);
  });
});
