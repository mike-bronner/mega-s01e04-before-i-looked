import type { RunStatus } from './types.js';

export type NightCounts = Record<RunStatus, number>;

export function countStatuses(text: string): NightCounts {
  const counts: NightCounts = { ok: 0, retry: 0, fail: 0 };
  for (const line of text.split('\n')) {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof value !== 'object' || value === null) continue;
    const status = (value as Record<string, unknown>).status;
    if (status === 'ok' || status === 'retry' || status === 'fail') counts[status]++;
  }
  return counts;
}
