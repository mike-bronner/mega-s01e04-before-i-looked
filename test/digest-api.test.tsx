import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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

async function json(app: ReturnType<typeof createApp>, night: string) {
  const res = await app.request(`/api/digest/${night}`);
  return { res, body: await res.json() };
}

const entities: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };
const decode = (text: string) => text.replace(/&(?:amp|lt|gt|quot|#39);/g, (e) => entities[e] ?? e);

function pageRows(html: string): { job: string; marked: boolean }[] {
  return [...html.matchAll(/<tr>(.*?)<\/tr>/gs)]
    .map((m) => m[1] ?? '')
    .filter((r) => r.includes('<td'))
    .map((r) => {
      const first = /<td>(.*?)<\/td>/s.exec(r)?.[1] ?? '';
      return { job: decode(first.replace(/<span.*$/s, '')), marked: first.includes(MARK) };
    });
}

const expectJson = (res: Response) => expect(res.headers.get('content-type')).toMatch(/^application\/json/);

const nights = readdirSync(config.runsDir)
  .filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f))
  .map((f) => f.slice(0, 10));

const snapshot = () =>
  readdirSync(config.runsDir).map((f) => {
    const path = join(config.runsDir, f);
    return [f, readFileSync(path, 'utf8'), statSync(path).mtimeMs];
  });

let before: ReturnType<typeof snapshot>;

beforeAll(() => {
  before = snapshot();
});

afterAll(() => {
  expect(snapshot()).toEqual(before);
});

beforeEach(() => {
  process.env.LANE_ID = 'lane-test';
  process.env.LANE_MARKER = 'TEST-MARKER';
});

afterEach(() => {
  delete process.env.LANE_ID;
  delete process.env.LANE_MARKER;
});

describe('digest JSON matches the page for every night in runs/', () => {
  it('finds at least one night', () => {
    expect(nights.length).toBeGreaterThan(0);
  });

  it.each(nights)('%s: same jobs, same order, same marks', async (night) => {
    const app = createApp(config);
    const page = await app.request(`/digest/${night}`);
    const { res, body } = await json(app, night);
    expect(page.status).toBe(200);
    expect(res.status).toBe(200);
    const expected = pageRows(await page.text());
    expect(expected.length).toBeGreaterThan(0);
    expect(body.rows.map((r: { job: string; marked: boolean }) => ({ job: r.job, marked: r.marked }))).toEqual(expected);
  });
});

describe('digest JSON body', () => {
  it('serves the reader values with marked added, keeping nulls, numbers and offsets', async () => {
    const rows = [
      row('fixtures/refresh', {
        owner: null,
        runs: 7,
        retries: 2,
        lastStatus: 'retry',
        lastError: 'timeout after 30s',
        firstAt: '2026-10-28T23:00:02+01:00',
        lastAt: '2026-10-29T01:15:40-04:30',
      }),
      row('notes/backup', { lastStatus: 'fail', lastError: '' }),
    ];
    const { res, body } = await json(createApp(config, stub({ rows, badLines: 3 }).read), '2026-10-28');
    expect(res.status).toBe(200);
    expectJson(res);
    expect(body).toStrictEqual({
      rows: [
        { ...rows[0], marked: false },
        { ...rows[1], marked: true },
      ],
      badLines: 3,
    });
    expect(JSON.stringify(body)).not.toContain('—');
  });

  it('matches the page for a job name the page has to escape', async () => {
    const rows = [row(`a&b<c>"d'e&amp;`), row('plain', { lastStatus: 'fail' })];
    const app = createApp(config, stub({ rows, badLines: 0 }).read);
    const { body } = await json(app, '2026-10-28');
    const html = await (await app.request('/digest/2026-10-28')).text();
    expect(html).toContain('a&amp;b&lt;c&gt;&quot;d&#39;e&amp;amp;');
    expect(pageRows(html)).toEqual([
      { job: `a&b<c>"d'e&amp;`, marked: false },
      { job: 'plain', marked: true },
    ]);
    expect(body.rows.map((r: { job: string; marked: boolean }) => ({ job: r.job, marked: r.marked }))).toEqual(
      pageRows(html),
    );
  });

  it('keeps the reader order and every row, for the page and the JSON alike', async () => {
    const rows = [row('beta'), row(''), row('Zeta'), row('alpha'), row('beta')];
    const app = createApp(config, stub({ rows, badLines: 0 }).read);
    const { body } = await json(app, '2026-10-28');
    const html = await (await app.request('/digest/2026-10-28')).text();
    expect(body.rows.map((r: { job: string }) => r.job)).toEqual(['beta', '', 'Zeta', 'alpha', 'beta']);
    expect(pageRows(html).map((r) => r.job)).toEqual(['beta', '—', 'Zeta', 'alpha', 'beta']);
  });

  it('calls the reader once with the configured runsDir and the night', async () => {
    const { read, calls } = stub({ rows: [], badLines: 0 });
    await json(createApp({ ...config, runsDir: '/some/runs' }, read), '2026-10-28');
    expect(calls).toEqual([['/some/runs', '2026-10-28']]);
  });
});

describe('digest JSON against a temporary runs directory', () => {
  let dir: string;
  const app = () => createApp({ ...config, runsDir: dir });
  const record = (job: string, status = 'ok') =>
    JSON.stringify({ at: '2026-10-28T23:00:02+01:00', job, status, owner: 'rook' });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rig-digest-api-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns a JSON 404 for a night with no file', async () => {
    const { res, body } = await json(app(), '2026-10-28');
    expect(res.status).toBe(404);
    expectJson(res);
    expect(body).toEqual({ error: 'not found' });
  });

  it('returns 200 with no rows for an empty file', async () => {
    writeFileSync(join(dir, '2026-10-28.jsonl'), '');
    const { res, body } = await json(app(), '2026-10-28');
    expect(res.status).toBe(200);
    expect(body).toStrictEqual({ rows: [], badLines: 0 });
  });

  it('returns 200 with badLines 0 for a clean night', async () => {
    writeFileSync(join(dir, '2026-10-28.jsonl'), `${record('a/job')}\n`);
    const { body } = await json(app(), '2026-10-28');
    expect(body.badLines).toBe(0);
    expect(body.rows.map((r: { job: string }) => r.job)).toEqual(['a/job']);
  });

  it('serves the parsed rows and counts bad lines, a non-record JSON line included', async () => {
    const lines = [record('b/job'), '{not json', '{"foo":1}', '[]', record('a/job', 'fail')];
    writeFileSync(join(dir, '2026-10-28.jsonl'), lines.join('\n'));
    const { res, body } = await json(app(), '2026-10-28');
    expect(res.status).toBe(200);
    expect(body.badLines).toBe(3);
    expect(body.rows.map((r: { job: string; marked: boolean }) => [r.job, r.marked])).toEqual([
      ['a/job', true],
      ['b/job', false],
    ]);
  });

  it('returns a JSON 500 when the night cannot be read', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    mkdirSync(join(dir, '2026-10-28.jsonl'));
    const res = await app().request('/api/digest/2026-10-28');
    expect(res.status).toBe(500);
    expectJson(res);
    expect(await res.json()).toEqual({ error: 'internal error' });
    expect(error).toHaveBeenCalledOnce();
    error.mockRestore();
  });
});

describe('digest JSON rejects a night that is not a real date', () => {
  it.each(['abc', '..%2Fpackage.json', '2026-02-30', '2025-02-29', '2026-13-45', '2026-10-28.jsonl', '20261028'])(
    '%s: JSON 4xx, reader never called',
    async (night) => {
      const { read, calls } = stub({ rows: [row('x')], badLines: 0 });
      const { res, body } = await json(createApp(config, read), night);
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
      expectJson(res);
      expect(body).toEqual({ error: 'not found' });
      expect(calls).toEqual([]);
    },
  );

  it('accepts a real leap day', async () => {
    const { read, calls } = stub({ rows: [], badLines: 0 });
    const { res } = await json(createApp(config, read), '2024-02-29');
    expect(res.status).toBe(200);
    expect(calls).toEqual([[config.runsDir, '2024-02-29']]);
  });
});
