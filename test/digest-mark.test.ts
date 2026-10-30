import { describe, expect, it } from 'vitest';
import { markDigest } from '../src/digest/mark.js';
import type { DigestRow, RunStatus } from '../src/digest/types.js';

const row = (job: string, retries: number, lastStatus: RunStatus): DigestRow => ({
  job,
  owner: job === 'b' ? null : 'ops',
  runs: retries + 1,
  retries,
  lastStatus,
  lastError: lastStatus === 'ok' ? null : `${job} failed`,
  firstAt: '2026-10-28T22:00:00+01:00',
  lastAt: '2026-10-29T01:15:40-04:30',
});

describe('markDigest', () => {
  it.each<[RunStatus, number, boolean]>([
    ['ok', 2, false],
    ['ok', 3, true],
    ['retry', 2, false],
    ['retry', 3, true],
    ['fail', 0, true],
    ['fail', 2, true],
    ['fail', 3, true],
  ])('%s at retries %i: marked is %s', (status, retries, marked) => {
    expect(markDigest({ rows: [row('x', retries, status)], badLines: 0 }).rows[0]?.marked).toBe(marked);
  });

  it('adds marked and passes every other field, the row order and badLines through unchanged', () => {
    const rows = [row('c', 3, 'ok'), row('a', 0, 'fail'), row('b', 1, 'retry'), row('c', 0, 'ok')];
    expect(markDigest({ rows, badLines: 4 })).toStrictEqual({
      rows: [
        { ...rows[0], marked: true },
        { ...rows[1], marked: true },
        { ...rows[2], marked: false },
        { ...rows[3], marked: false },
      ],
      badLines: 4,
    });
  });

  it('marks nothing on a night with no rows', () => {
    expect(markDigest({ rows: [], badLines: 2 })).toStrictEqual({ rows: [], badLines: 2 });
  });
});
