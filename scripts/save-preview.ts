import { savePreview } from './preview.js';

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
