import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, ReadNight, RunStatus } from './types.js';

type Entry = { at: string; job: string; status: RunStatus; owner: string | null; error?: string };

const NIGHT = /^\d{4}-\d{2}-\d{2}$/;
const AT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-](\d{2}):(\d{2}))$/;
const STATUSES: readonly unknown[] = ['ok', 'retry', 'fail'] satisfies RunStatus[];

function isDateTime(at: string): boolean {
  const m = AT.exec(at);
  if (!m) return false;
  const [y = 0, mo = 0, d = 0, h = 0, mi = 0, s = 0, oh = 0, om = 0] = m.slice(1).map((g) => Number(g ?? 0));
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1] ?? 0;
  return d >= 1 && d <= days && h <= 23 && mi <= 59 && s <= 59 && oh <= 23 && om <= 59;
}

function parseEntry(line: string): Entry | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const e = value as Record<string, unknown>;
  const valid =
    typeof e.job === 'string' && e.job !== '' &&
    typeof e.at === 'string' && isDateTime(e.at) &&
    STATUSES.includes(e.status) &&
    (typeof e.owner === 'string' || e.owner === null) &&
    (!('error' in e) || typeof e.error === 'string');
  return valid ? (e as Entry) : null;
}

function readLog(file: string): string | null {
  try {
    return readFileSync(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

export const readNight: ReadNight = (runsDir, night) => {
  if (!NIGHT.test(night)) return null;
  const text = readLog(join(runsDir, `${night}.jsonl`));
  if (text === null) return null;

  const rows = new Map<string, DigestRow>();
  let badLines = 0;
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    const entry = parseEntry(line);
    if (!entry) {
      badLines++;
      continue;
    }
    const row = rows.get(entry.job);
    if (!row) {
      rows.set(entry.job, {
        job: entry.job,
        owner: entry.owner,
        runs: 1,
        retries: entry.status === 'retry' ? 1 : 0,
        lastStatus: entry.status,
        lastError: entry.error ?? null,
        firstAt: entry.at,
        lastAt: entry.at,
      });
      continue;
    }
    row.owner = entry.owner;
    row.runs++;
    if (entry.status === 'retry') row.retries++;
    row.lastStatus = entry.status;
    if (entry.error !== undefined) row.lastError = entry.error;
    row.lastAt = entry.at;
  }

  return {
    rows: [...rows.values()].sort((a, b) => (a.job < b.job ? -1 : a.job > b.job ? 1 : 0)),
    badLines,
  };
};
