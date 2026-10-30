import { writeFileSync } from 'node:fs';

export const EXTERNAL = ['<script', '<link', 'src=', '@import', 'url('];

export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export async function savePreview(url: string, out: string, get: Fetch = fetch): Promise<void> {
  const res = await get(url, { redirect: 'manual' });
  if (res.status !== 200) throw new Error(`${url} answered ${res.status}, expected 200`);
  const body = Buffer.from(await res.arrayBuffer());
  const html = body.toString('utf8').toLowerCase();
  const found = EXTERNAL.filter((needle) => html.includes(needle));
  if (found.length > 0) throw new Error(`${url} is not self-contained: ${found.join(', ')}`);
  writeFileSync(out, body);
}
