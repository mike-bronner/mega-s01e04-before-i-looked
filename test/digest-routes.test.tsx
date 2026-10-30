import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { RigConfig } from '../src/config.js';

const VALID = '2099-01-01';
const EMPTY = '2099-01-02';
const BAD = '2099-01-03';
const MISSING = '2099-01-04';

const record = (job: string, at: string, status = 'ok') => JSON.stringify({ at, job, status, owner: 'rook' });

const fixtures: Record<string, string> = {
  [VALID]: [
    record('zeta/report', '2099-01-01T22:00:00+01:00'),
    record('alpha/sync', '2099-01-01T22:05:00+01:00'),
    record('mid/backup', '2099-01-01T22:10:00+01:00'),
    record('alpha/sync', '2099-01-01T23:05:00+01:00'),
  ].join('\n'),
  [EMPTY]: '',
  [BAD]: [
    record('zeta/report', '2099-01-03T22:00:00+01:00'),
    record('alpha/sync', '2099-01-03T22:05:00+01:00'),
    '{"job":"bad/line",',
    record('mid/backup', '2099-01-03T22:10:00+01:00'),
  ].join('\n'),
};

const created: string[] = [];
let dir: string;

const app = () => {
  const config: RigConfig = { adapter: 'shim', installed: '2099-01-01T00:00:00Z', beatEverySeconds: 60, runsDir: dir };
  return createApp(config);
};

function pageJobs(html: string): string[] {
  return [...html.matchAll(/<tr>\s*<td>(.*?)<\/td>/gs)].map((m) => (m[1] ?? '').replace(/<span.*$/s, ''));
}

async function page(night: string) {
  const res = await app().request(`/digest/${night}`);
  return { res, html: await res.text() };
}

async function json(night: string) {
  const res = await app().request(`/api/digest/${night}`);
  return { res, body: await res.json() };
}

beforeEach(() => {
  process.env.LANE_ID = 'lane-test';
  process.env.LANE_MARKER = 'TEST-MARKER';
  dir = mkdtempSync(join(tmpdir(), 'rig-digest-routes-'));
  created.push(dir);
  for (const [night, text] of Object.entries(fixtures)) writeFileSync(join(dir, `${night}.jsonl`), text);
});

afterEach(() => {
  delete process.env.LANE_ID;
  delete process.env.LANE_MARKER;
  rmSync(dir, { recursive: true, force: true });
});

afterAll(() => {
  expect(created.filter((d) => existsSync(d))).toEqual([]);
});

describe('GET /digest/:night (page)', () => {
  it('page, valid night: 200 with one row per job, sorted by job', async () => {
    const { res, html } = await page(VALID);
    expect(res.status).toBe(200);
    expect(pageJobs(html)).toEqual(['alpha/sync', 'mid/backup', 'zeta/report']);
    expect(html).not.toContain('nothing ran');
  });

  it('page, missing night: 404 for a well-formed night with no file', async () => {
    expect(existsSync(join(dir, `${VALID}.jsonl`))).toBe(true);
    const { res } = await page(MISSING);
    expect(res.status).toBe(404);
  });

  it('page, empty night: 200 with "nothing ran" and no job rows', async () => {
    const { res, html } = await page(EMPTY);
    expect(res.status).toBe(200);
    expect(html).toContain('nothing ran');
    expect(html).not.toContain('<td');
  });

  it('page, bad-line night: 200 with exactly the valid jobs', async () => {
    const { res, html } = await page(BAD);
    expect(res.status).toBe(200);
    expect(pageJobs(html)).toEqual(['alpha/sync', 'mid/backup', 'zeta/report']);
    expect(html).not.toContain('bad/line');
  });
});

describe('GET /api/digest/:night (JSON)', () => {
  it('JSON, valid night: 200 with one row per job, sorted by job', async () => {
    const { res, body } = await json(VALID);
    expect(res.status).toBe(200);
    expect(body.rows.map((r: { job: string }) => r.job)).toEqual(['alpha/sync', 'mid/backup', 'zeta/report']);
  });

  it('JSON, missing night: 404 for a well-formed night with no file', async () => {
    expect(existsSync(join(dir, `${VALID}.jsonl`))).toBe(true);
    const { res } = await json(MISSING);
    expect(res.status).toBe(404);
  });

  it('JSON, empty night: 200 with an empty rows list', async () => {
    const { res, body } = await json(EMPTY);
    expect(res.status).toBe(200);
    expect(body.rows).toEqual([]);
  });

  it('JSON, bad-line night: 200 with exactly the valid jobs', async () => {
    const { res, body } = await json(BAD);
    expect(res.status).toBe(200);
    expect(body.rows.map((r: { job: string }) => r.job)).toEqual(['alpha/sync', 'mid/backup', 'zeta/report']);
  });
});
