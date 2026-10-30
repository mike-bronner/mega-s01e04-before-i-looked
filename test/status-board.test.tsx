import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { RigConfig } from '../src/config.js';

const config: RigConfig = { adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir: 'runs' };

const line = (status: unknown) => JSON.stringify({ at: '2026-10-20T01:00:00+01:00', job: 'a/job', status, owner: 'ops' });

async function board(runsDir: string) {
  const res = await createApp({ ...config, runsDir }).request('/');
  return { res, html: await res.text() };
}

function entries(html: string): string[] {
  return [...html.matchAll(/<li>(.*?)<\/li>/gs)].map((m) => m[1] ?? '');
}

function entryFor(html: string, night: string): string {
  const found = entries(html).filter((e) => e.includes(`href="/digest/${night}"`));
  if (found.length !== 1) throw new Error(`expected one entry for ${night}, got ${found.length}`);
  return found[0] ?? '';
}

const text = (fragment: string) => fragment.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

function snapshot(dir: string): Record<string, string> {
  return Object.fromEntries(readdirSync(dir).map((f) => [f, readFileSync(join(dir, f), 'utf8')]));
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rig-board-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('status board nights', () => {
  it('counts ok, retry and fail lines and skips a bad line without touching the others', async () => {
    writeFileSync(
      join(dir, '2026-10-20.jsonl'),
      [line('ok'), line('retry'), '{"at":"2026-10-20T01:00:00+01:00","job":"a/j', line('ok'), line('fail'), line('retry'), line('ok'), ''].join('\n'),
    );
    const { res, html } = await board(dir);
    expect(res.status).toBe(200);
    expect(text(entryFor(html, '2026-10-20'))).toBe('2026-10-20 ok 3 retry 2 fail 1');
  });

  it('counts only JSON objects whose status is exactly ok, retry or fail', async () => {
    writeFileSync(
      join(dir, '2026-10-21.jsonl'),
      [
        line('skipped'),
        line('OK'),
        line(' ok'),
        line(null),
        JSON.stringify({ at: '2026-10-21T01:00:00+01:00', job: 'a/job', owner: 'ops' }),
        '"ok"',
        '["ok"]',
        '42',
        'null',
        '',
        '   ',
        'not json',
        JSON.stringify({ status: 'fail' }),
        line('ok'),
      ].join('\n'),
    );
    const { html } = await board(dir);
    expect(text(entryFor(html, '2026-10-21'))).toBe('2026-10-21 ok 1 retry 0 fail 1');
  });

  it('lists an empty or newline-only night with zero counts', async () => {
    writeFileSync(join(dir, '2026-10-22.jsonl'), '');
    writeFileSync(join(dir, '2026-10-23.jsonl'), '\n\n\n');
    const { html } = await board(dir);
    expect(text(entryFor(html, '2026-10-22'))).toBe('2026-10-22 ok 0 retry 0 fail 0');
    expect(text(entryFor(html, '2026-10-23'))).toBe('2026-10-23 ok 0 retry 0 fail 0');
  });

  it('shows — for a night it cannot read and keeps every other night correct', async () => {
    mkdirSync(join(dir, '2026-10-24.jsonl'));
    writeFileSync(join(dir, '2026-10-25.jsonl'), [line('ok'), line('fail')].join('\n'));
    writeFileSync(join(dir, '2026-10-23.jsonl'), line('retry'));
    const { res, html } = await board(dir);
    expect(res.status).toBe(200);
    expect(text(entryFor(html, '2026-10-24'))).toBe('2026-10-24 ok — retry — fail —');
    expect(text(entryFor(html, '2026-10-25'))).toBe('2026-10-25 ok 1 retry 0 fail 1');
    expect(text(entryFor(html, '2026-10-23'))).toBe('2026-10-23 ok 0 retry 1 fail 0');
  });

  it('links every night to its digest, newest first, with the date as the link text', async () => {
    for (const night of ['2026-09-30', '2026-10-02', '2026-10-01']) writeFileSync(join(dir, `${night}.jsonl`), line('ok'));
    const { html } = await board(dir);
    const links = [...html.matchAll(/<a href="([^"]*)">([^<]*)<\/a>/g)].map((m) => [m[1], m[2]]);
    expect(links).toEqual([
      ['/digest/2026-10-02', '2026-10-02'],
      ['/digest/2026-10-01', '2026-10-01'],
      ['/digest/2026-09-30', '2026-09-30'],
    ]);
  });

  it('leaves the temp runs dir as it was', async () => {
    writeFileSync(join(dir, '2026-10-20.jsonl'), [line('ok'), 'bad'].join('\n'));
    writeFileSync(join(dir, '2026-10-21.jsonl'), '');
    const before = snapshot(dir);
    await board(dir);
    expect(snapshot(dir)).toEqual(before);
  });

  it('has no client script and still says nothing in runs/ for an empty runs dir', async () => {
    writeFileSync(join(dir, '2026-10-20.jsonl'), line('ok'));
    const { html } = await board(dir);
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<[a-z][^>]*\son[a-z]+\s*=/i);

    const empty = mkdtempSync(join(tmpdir(), 'rig-board-empty-'));
    try {
      const { res, html: emptyHtml } = await board(empty);
      expect(res.status).toBe(200);
      expect(emptyHtml).toContain('nothing in runs/');
      expect(entries(emptyHtml)).toEqual([]);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});

describe('status board on the real runs/', () => {
  it('shows the real counts, links to digests that render, and writes nothing', async () => {
    const before = snapshot('runs');
    const app = createApp(config);
    const html = await (await app.request('/')).text();

    expect(text(entryFor(html, '2026-10-27'))).toBe('2026-10-27 ok 7 retry 0 fail 0');
    expect(text(entryFor(html, '2026-10-28'))).toBe('2026-10-28 ok 10 retry 4 fail 1');

    const hrefs = [...html.matchAll(/<a href="([^"]*)">/g)].map((m) => m[1] ?? '');
    expect(hrefs).toEqual(['/digest/2026-10-28', '/digest/2026-10-27']);
    for (const href of hrefs) {
      const res = await app.request(href);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain(`<h1>digest · ${href.slice('/digest/'.length)}</h1>`);
    }

    expect(snapshot('runs')).toEqual(before);
  });
});
