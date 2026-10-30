import type { MarkedDigest, NightDigest } from './types.js';

export const markDigest = ({ rows, badLines }: NightDigest): MarkedDigest => ({
  rows: rows.map((row) => ({ ...row, marked: row.retries >= 3 || row.lastStatus === 'fail' })),
  badLines,
});
