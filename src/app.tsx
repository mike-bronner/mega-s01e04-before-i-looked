import { Hono } from 'hono';
import { loadConfig, type RigConfig } from './config.js';
import { markDigest } from './digest/mark.js';
import { readNight } from './digest/reader.js';
import type { ReadNight } from './digest/types.js';
import { lane } from './lane.js';
import { readStatus } from './status.js';
import { Digest } from './views/digest.js';
import { Layout } from './views/layout.js';
import { StatusBoard } from './views/status.js';

function isNight(value: string): boolean {
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function createApp(config: RigConfig = loadConfig(), read: ReadNight = readNight) {
  const app = new Hono();
  const loadDigest = (night: string) => {
    const digest = isNight(night) ? read(config.runsDir, night) : null;
    return digest && markDigest(digest);
  };

  app.get('/health', (c) => c.json({ ok: true, lane: lane().id }));

  app.get('/', (c) =>
    c.html(
      <Layout title="status" lane={lane()}>
        <StatusBoard status={readStatus(config)} />
      </Layout>,
    ),
  );

  app.get('/digest/:night', (c) => {
    const night = c.req.param('night');
    const digest = loadDigest(night);
    if (!digest) return c.notFound();
    return c.html(
      <Layout title={`digest ${night}`} lane={lane()}>
        <Digest night={night} digest={digest} />
      </Layout>,
    );
  });

  const api = new Hono();
  api.onError((err, c) => {
    console.error(err);
    return c.json({ error: 'internal error' }, 500);
  });
  api.get('/digest/:night', (c) => {
    const digest = loadDigest(c.req.param('night'));
    return digest ? c.json(digest) : c.json({ error: 'not found' }, 404);
  });
  app.route('/api', api);

  return app;
}
