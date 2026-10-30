import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';

const config = { adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir: 'runs' };

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('status board', () => {
  it('shows the lane banner and the nights on disk', async () => {
    vi.stubEnv('LANE_MARKER', 'TEST-MARKER');
    const res = await createApp(config).request('/');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('TEST-MARKER');
    expect(html).toContain('2026-10-28');
  });

  it('health answers with the lane id', async () => {
    vi.stubEnv('LANE_ID', 'lane-test-3c');
    const res = await createApp(config).request('/health');
    expect(await res.json()).toEqual({ ok: true, lane: 'lane-test-3c' });
  });
});
