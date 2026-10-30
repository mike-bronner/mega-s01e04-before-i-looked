import { writeFileSync } from 'node:fs';

const EXTERNAL = ['<script', '<link', 'src=', '@import', 'url('];

async function savePreview(url: string, out: string): Promise<void> {
  const res = await fetch(url, { redirect: 'manual' });
  if (res.status !== 200) throw new Error(`${url} answered ${res.status}, expected 200`);
  const body = Buffer.from(await res.arrayBuffer());
  const html = body.toString('utf8').toLowerCase();
  const found = EXTERNAL.filter((needle) => html.includes(needle));
  if (found.length > 0) throw new Error(`${url} is not self-contained: ${found.join(', ')}`);
  writeFileSync(out, body);
}

const [night, out] = process.argv.slice(2);
if (!night || !out) {
  console.error('usage: pnpm save-preview <night> <out-file>');
  process.exit(2);
}
const url = `http://localhost:${process.env.PORT ?? 8787}/digest/${encodeURIComponent(night)}`;
savePreview(url, out).then(
  () => console.log(`saved ${url} to ${out}`),
  (error: Error & { cause?: { code?: string } }) => {
    console.error(`save-preview: ${error.message}${error.cause?.code ? ` (${error.cause.code})` : ''}`);
    process.exit(1);
  },
);
