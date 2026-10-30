// The digest's shared shapes. The reader, the page and the JSON route all start from this file,
// so it imports nothing from src/.

export type RunStatus = 'ok' | 'retry' | 'fail';

// One job's night, folded from its lines in runs/<night>.jsonl.
// "None" is null, never an omitted field, so the JSON route shows what the page shows.
export type DigestRow = {
  job: string;
  owner: string | null;
  runs: number;
  retries: number;
  lastStatus: RunStatus;
  lastError: string | null;
  // The log's `at` values as written, offset kept.
  firstAt: string;
  lastAt: string;
};

// A night that has a file. An empty file is { rows: [], badLines: 0 }.
export type NightDigest = {
  rows: DigestRow[];
  badLines: number;
};

// null means runs/<night>.jsonl does not exist.
// Implement as: export const readNight: ReadNight = (runsDir, night) => ...
export type ReadNight = (runsDir: string, night: string) => NightDigest | null;
