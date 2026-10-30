import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { RigConfig } from '../src/config.js';
import type { DigestRow, NightDigest, ReadNight } from '../src/digest/types.js';
import { MARK } from '../src/views/digest.js';

const config: RigConfig = { adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir: 'runs' };

function row(job: string, overrides: Partial<DigestRow> = {}): DigestRow {
  return {
    job,
    owner: 'ops',
    runs: 1,
    retries: 0,
    lastStatus: 'ok',
    lastError: null,
    firstAt: '2026-10-28T22:00:00+01:00',
    lastAt: '2026-10-28T22:00:00+01:00',
    ...overrides,
  };
}

function stub(result: NightDigest | null) {
  const calls: [string, string][] = [];
  const read: ReadNight = (runsDir, night) => {
    calls.push([runsDir, night]);
    return result;
  };
  return { read, calls };
}

async function page(result: NightDigest | null, night = '2026-10-28') {
  const { read, calls } = stub(result);
  const res = await createApp(config, read).request(`/digest/${night}`);
  return { res, html: await res.text(), calls };
}

function bodyRows(html: string): string[] {
  return [...html.matchAll(/<tr>(.*?)<\/tr>/gs)].map((m) => m[1] ?? '').filter((r) => r.includes('<td'));
}

function rowFor(html: string, job: string): string {
  const found = bodyRows(html).find((r) => r.includes(`<td>${job}`));
  if (!found) throw new Error(`no row for ${job}`);
  return found;
}

function cells(rowHtml: string): string[] {
  return [...rowHtml.matchAll(/<td>(.*?)<\/td>/gs)].map((m) => m[1] ?? '');
}

const noScript = (html: string) => {
  expect(html).not.toMatch(/<script/i);
  expect(html).not.toMatch(/<[a-z][^>]*\son[a-z]+\s*=/i);
};

beforeEach(() => {
  process.env.LANE_ID = 'lane-test';
  process.env.LANE_MARKER = 'TEST-MARKER';
});

afterEach(() => {
  delete process.env.LANE_ID;
  delete process.env.LANE_MARKER;
});

describe('digest page reader call', () => {
  it('calls the reader once with the configured runsDir and the night', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rig-digest-'));
    try {
      const { read, calls } = stub({ rows: [row('a/job')], badLines: 0 });
      const res = await createApp({ ...config, runsDir: dir }, read).request('/digest/2026-10-28');
      expect(res.status).toBe(200);
      expect(calls).toEqual([[dir, '2026-10-28']]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('digest page night validation', () => {
  it.each(['..%2F..%2Fx', '2026-10-28.jsonl', '2026-10-28%0A', 'abc', '2026-13-45', '2026-02-30', '2026-1-28', '20261028'])(
    'responds 404 for %s without calling the reader',
    async (night) => {
      const { res, html, calls } = await page({ rows: [row('a/job')], badLines: 0 }, night);
      expect(res.status).toBe(404);
      expect(calls).toEqual([]);
      noScript(html);
    },
  );

  it.each(['..', '%2e%2e'])('never routes %s to the reader, because the URL resolves to /', async (night) => {
    const { res, calls } = await page({ rows: [row('a/job')], badLines: 0 }, night);
    expect(res.status).toBeLessThan(500);
    expect(calls).toEqual([]);
  });

  it('accepts a leap day', async () => {
    const { res, calls } = await page({ rows: [row('a/job')], badLines: 0 }, '2024-02-29');
    expect(res.status).toBe(200);
    expect(calls).toEqual([[config.runsDir, '2024-02-29']]);
  });
});

describe('digest page responses', () => {
  it('responds 404 when the reader returns null', async () => {
    const { res, html, calls } = await page(null);
    expect(res.status).toBe(404);
    expect(calls).toHaveLength(1);
    noScript(html);
  });

  it.each([0, 3])('renders nothing ran with no table for no rows and %i bad lines', async (badLines) => {
    const { res, html } = await page({ rows: [], badLines });
    expect(res.status).toBe(200);
    expect(html).toContain('nothing ran');
    expect(html).not.toContain('<table');
  });

  it('renders every row with a 200 when badLines is above zero', async () => {
    const { res, html } = await page({ rows: [row('a/job'), row('b/job')], badLines: 2 });
    expect(res.status).toBe(200);
    expect(bodyRows(html)).toHaveLength(2);
  });

  it.each<[string, NightDigest]>([
    ['rows', { rows: [row('a/job')], badLines: 0 }],
    ['nothing ran', { rows: [], badLines: 0 }],
  ])('serves the %s page as text/html in the shared layout with the lane banner', async (_name, digest) => {
    const { res, html } = await page(digest);
    expect(res.headers.get('content-type')).toMatch(/^text\/html/);
    expect(html).toContain('<span>lane-test</span>');
    expect(html).toContain('<span class="marker">TEST-MARKER</span>');
    expect(html.match(/<style>/g)).toHaveLength(1);
    expect(html).not.toMatch(/<link[^>]*stylesheet/i);
    noScript(html);
  });

  it('shows no marker set when LANE_MARKER is unset', async () => {
    delete process.env.LANE_MARKER;
    const { html } = await page({ rows: [], badLines: 0 });
    expect(html).toContain('<span class="marker">no marker set</span>');
  });

  it.each(['', '   '])('shows no marker set when LANE_MARKER is %j, as an unset Actions secret passes it', async (value) => {
    process.env.LANE_MARKER = value;
    const { html } = await page({ rows: [], badLines: 0 });
    expect(html).toContain('<span class="marker">no marker set</span>');
  });
});

describe('digest page table', () => {
  it('renders one table with one body row per digest row, in the order the reader returns them', async () => {
    const { html } = await page({ rows: [row('beta'), row('alpha'), row('Zeta')], badLines: 0 });
    expect(html.match(/<table/g)).toHaveLength(1);
    expect(bodyRows(html).map((r) => cells(r)[0])).toEqual(['beta', 'alpha', 'Zeta']);
  });

  it('shows every field as the reader supplied it, offset kept', async () => {
    const supplied = row('fixtures/refresh', {
      owner: 'mira',
      runs: 7,
      retries: 2,
      lastStatus: 'retry',
      lastError: 'timeout after 30s',
      firstAt: '2026-10-28T23:00:02+01:00',
      lastAt: '2026-10-29T01:15:40-04:30',
    });
    const { html } = await page({ rows: [supplied], badLines: 0 });
    expect(cells(rowFor(html, 'fixtures/refresh'))).toEqual([
      'fixtures/refresh',
      'mira',
      '7',
      '2',
      'retry',
      'timeout after 30s',
      '2026-10-28T23:00:02+01:00',
      '2026-10-29T01:15:40-04:30',
    ]);
    expect(html).not.toMatch(/T\d{2}:\d{2}:\d{2}(\.\d+)?Z/);
  });

  it('renders null and empty text as — and zero as 0, dropping no row and leaving no cell empty', async () => {
    const { html } = await page({
      rows: [row('', { owner: null, lastError: '', runs: 0, retries: 0 }), row('b/job', { owner: '', lastError: null })],
      badLines: 0,
    });
    const [blankJob, nulls] = bodyRows(html).map(cells);
    expect(blankJob).toEqual(['—', '—', '0', '0', 'ok', '—', '2026-10-28T22:00:00+01:00', '2026-10-28T22:00:00+01:00']);
    expect(nulls?.slice(0, 2)).toEqual(['b/job', '—']);
    expect(nulls?.[5]).toBe('—');
    expect(bodyRows(html)).toHaveLength(2);
    expect(html).not.toMatch(/<td><\/td>/);
  });
});

describe('digest page mark', () => {
  const rows = [
    row('fixtures/refresh', { retries: 3, lastStatus: 'ok' }),
    row('notes/backup', { retries: 0, lastStatus: 'fail' }),
    row('big/retry', { retries: 5, lastStatus: 'ok' }),
    row('lane/sync', { retries: 1, lastStatus: 'ok' }),
    row('near/miss', { retries: 2, lastStatus: 'retry' }),
    row('both/bad', { retries: 4, lastStatus: 'fail' }),
  ];

  it('marks retries of 3 or more and a fail, in the row text, once per row', async () => {
    const { html } = await page({ rows, badLines: 0 });
    for (const job of ['fixtures/refresh', 'notes/backup', 'big/retry', 'both/bad']) {
      expect(rowFor(html, job).split(MARK)).toHaveLength(2);
    }
    for (const job of ['lane/sync', 'near/miss']) {
      expect(rowFor(html, job)).not.toContain(MARK);
    }
  });

  it('is not the status value itself', () => {
    expect(['ok', 'retry', 'fail']).not.toContain(MARK);
  });
});

describe('digest page escaping', () => {
  it('escapes job, owner and error text', async () => {
    const { html } = await page({
      rows: [row('<b>job</b>', { owner: '<i onmouseover=x>o</i>', lastError: '<img src=x onerror=alert(1)>' })],
      badLines: 0,
    });
    expect(html).toContain('&lt;img');
    expect(html).not.toMatch(/<img/i);
    expect(html).not.toContain('<b>job');
    expect(html).not.toContain('<i ');
    noScript(html);
  });
});

describe('digest page with the default reader', () => {
  it('serves the real 2026-10-28 night from runs/', async () => {
    const res = await createApp(config).request('/digest/2026-10-28');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(bodyRows(html).map((r) => cells(r)[0]?.replace(/<span.*$/s, ''))).toEqual([
      'digest/render',
      'fixtures/refresh',
      'lane/sync',
      'notes/backup',
      'rig/rotate-logs',
    ]);
    const markedJobs = bodyRows(html)
      .filter((r) => r.includes(MARK))
      .map((r) => cells(r)[0]?.replace(/<span.*$/s, ''));
    expect(markedJobs).toEqual(['fixtures/refresh', 'notes/backup']);
  });
});
