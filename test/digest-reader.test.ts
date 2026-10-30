import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/reader.js';

const line = (job: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ at: '2026-10-29T01:00:00+01:00', job, status: 'ok', owner: 'rook', ...extra });

describe('readNight on the real nights', () => {
  it('reads 2026-10-28: 5 jobs, 1 bad line', () => {
    const night = readNight('runs', '2026-10-28');
    expect(night?.badLines).toBe(1);
    expect(night?.rows.map((r) => r.job)).toEqual([
      'digest/render',
      'fixtures/refresh',
      'lane/sync',
      'notes/backup',
      'rig/rotate-logs',
    ]);
    const row = (job: string) => night?.rows.find((r) => r.job === job);

    expect(row('fixtures/refresh')).toMatchObject({
      runs: 4,
      retries: 3,
      lastStatus: 'ok',
      lastError: 'upstream 503',
      firstAt: '2026-10-29T01:30:00+01:00',
      lastAt: '2026-10-29T01:37:00+01:00',
    });
    expect(row('lane/sync')).toMatchObject({
      runs: 8,
      retries: 1,
      lastStatus: 'ok',
      lastError: 'lock held',
      lastAt: '2026-10-29T05:00:04+01:00',
    });
    expect(row('notes/backup')).toMatchObject({ lastStatus: 'fail', lastError: 'quota exceeded' });
    expect(row('rig/rotate-logs')).toMatchObject({
      firstAt: '2026-10-28T23:00:02+01:00',
      lastAt: '2026-10-28T23:00:02+01:00',
      lastError: null,
    });
    expect(row('digest/render')?.owner).toBeNull();
  });

  it('reads 2026-10-27: 4 jobs, no bad lines', () => {
    const night = readNight('runs', '2026-10-27');
    expect(night?.rows).toHaveLength(4);
    expect(night?.badLines).toBe(0);
  });
});

describe('readNight on edge cases', () => {
  let root: string;
  let runs: string;
  const write = (name: string, text: string) => writeFileSync(join(runs, `${name}.jsonl`), text);

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'rig-runs-'));
    runs = join(root, 'runs');
    mkdirSync(runs);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it.each([
    ['not JSON', '{"job":'],
    ['JSON null', 'null'],
    ['a JSON array', '[1,2]'],
    ['a JSON number', '42'],
    ['a JSON string', '"lane/sync"'],
    ['a missing job', JSON.stringify({ at: '2026-10-29T01:00:00+01:00', status: 'ok', owner: 'rook' })],
    ['an empty job', line('')],
    ['a non-string job', line('x', { job: 7 })],
    ['an at without offset', line('x', { at: '2026-10-29T01:00:00' })],
    ['an at that is no date-time', line('x', { at: 'last night' })],
    ['an at that is no real date', line('x', { at: '2026-13-45T01:00:00+01:00' })],
    ['an unknown status', line('x', { status: 'done' })],
    ['a missing owner key', JSON.stringify({ at: '2026-10-29T01:00:00+01:00', job: 'x', status: 'ok' })],
    ['a non-string owner', line('x', { owner: 3 })],
    ['a non-string error', line('x', { error: 503 })],
    ['a null error', line('x', { error: null })],
  ])('counts %s as a bad line and keeps the lines around it', (_, bad) => {
    write('2026-10-28', [line('a/job'), bad, line('a/job')].join('\n'));
    const night = readNight(runs, '2026-10-28');
    expect(night?.badLines).toBe(1);
    expect(night?.rows).toHaveLength(1);
    expect(night?.rows[0]).toMatchObject({ job: 'a/job', runs: 2 });
  });

  it('accepts a Z offset and ignores unknown keys', () => {
    write('2026-10-28', line('a/job', { at: '2026-10-29T01:00:00Z', host: 'h1' }));
    expect(readNight(runs, '2026-10-28')).toEqual({
      badLines: 0,
      rows: [expect.objectContaining({ job: 'a/job', firstAt: '2026-10-29T01:00:00Z' })],
    });
  });

  it('skips blank and whitespace-only lines without counting them', () => {
    write('2026-10-28', `\n${line('a/job')}\n   \n\t\n${line('a/job')}\n\n`);
    const night = readNight(runs, '2026-10-28');
    expect(night?.badLines).toBe(0);
    expect(night?.rows[0]?.runs).toBe(2);
  });

  it('reads CRLF lines as good lines', () => {
    write('2026-10-28', `${line('a/job')}\r\n${line('a/job', { status: 'retry' })}\r\n`);
    const night = readNight(runs, '2026-10-28');
    expect(night?.badLines).toBe(0);
    expect(night?.rows[0]).toMatchObject({ runs: 2, retries: 1, lastStatus: 'retry' });
  });

  it('keeps a job whose owner changes to null, with a null owner', () => {
    write('2026-10-28', [line('a/job'), line('a/job', { owner: null })].join('\n'));
    const night = readNight(runs, '2026-10-28');
    expect(night?.rows).toHaveLength(1);
    expect(night?.rows[0]?.owner).toBeNull();
  });

  it('takes the owner from the last entry', () => {
    write('2026-10-28', [line('a/job', { owner: null }), line('a/job', { owner: 'lane-07' })].join('\n'));
    expect(readNight(runs, '2026-10-28')?.rows[0]?.owner).toBe('lane-07');
  });

  it('keeps the last error after a later ok, and uses the most recent one', () => {
    write(
      '2026-10-28',
      [
        line('a/job', { status: 'retry', error: 'first' }),
        line('a/job', { status: 'retry', error: 'second' }),
        line('a/job'),
      ].join('\n'),
    );
    expect(readNight(runs, '2026-10-28')?.rows[0]).toMatchObject({ lastError: 'second', lastStatus: 'ok' });
  });

  it('matches jobs exactly and sorts rows by job', () => {
    write('2026-10-28', [line('b'), line('a'), line('A'), line(' a'), line('a')].join('\n'));
    const rows = readNight(runs, '2026-10-28')?.rows;
    expect(rows?.map((r) => [r.job, r.runs])).toEqual([[' a', 1], ['A', 1], ['a', 2], ['b', 1]]);
  });

  it('returns null for a missing night', () => {
    expect(readNight(runs, '2026-10-28')).toBeNull();
  });

  it('returns zero rows for a zero-byte file', () => {
    write('2026-10-28', '');
    expect(readNight(runs, '2026-10-28')).toEqual({ rows: [], badLines: 0 });
  });

  it('returns zero rows for a file of blank lines', () => {
    write('2026-10-28', '\n  \r\n\n');
    expect(readNight(runs, '2026-10-28')).toEqual({ rows: [], badLines: 0 });
  });

  it.each([
    ['a trailing newline', '2026-10-28\n'],
    ['a parent path', '../2026-10-28'],
    ['a path through the night', '2026-10-28/../x'],
    ['an absolute path', 'ABSOLUTE'],
    ['an empty string', ''],
  ])('treats a night with %s as missing and reads no file', (_, given) => {
    for (const name of ['2026-10-28', '2026-10-28\n', 'x', '']) write(name, line('a/job'));
    writeFileSync(join(root, '2026-10-28.jsonl'), line('a/job'));
    writeFileSync(join(root, 'outside.jsonl'), line('a/job'));
    expect(readNight(runs, given === 'ABSOLUTE' ? join(root, 'outside') : given)).toBeNull();
  });
});
