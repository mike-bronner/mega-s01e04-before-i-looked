# rig

Keeps a lane's lights on while nobody is in it: a heartbeat every minute, a status board, and
(next) a morning digest of what ran overnight.

```sh
cp .env.example .env   # set LANE_MARKER
pnpm install
pnpm dev               # http://localhost:8787
```

Working on it with an agent: start at [AGENTS.md](AGENTS.md).

## Saving a preview

With rig running, this saves a night's digest page as one HTML file (ADR 0003):

```sh
pnpm save-preview 2026-10-28 var/preview-2026-10-28.html
```

The banner shows whatever `LANE_MARKER` rig was started with. To change it, restart rig and run
the same command. Set `PORT` if rig is not on 8787. The command exits non-zero and writes nothing
when rig does not answer 200, or when the page holds `<script`, `<link`, `src=`, `@import` or
`url(`. `var/` is git-ignored: never commit a preview.
