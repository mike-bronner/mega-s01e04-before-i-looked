import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, ReadNight, RunStatus } from './types.js';

type Entry = { at: string; job: string; status: RunStatus; owner: string | null; error?: string };

const NIGHT = /^\d{4}-\d{2}-\d{2}$/;
const AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const STATUSES: readonly unknown[] = ['ok', 'retry', 'fail'] satisfies RunStatus[];

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
    typeof e.at === 'string' && AT.test(e.at) && !Number.isNaN(Date.parse(e.at)) &&
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
