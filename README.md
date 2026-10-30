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
mkdir -p var
pnpm save-preview 2026-10-28 var/preview-2026-10-28.html
```

The banner shows whatever `LANE_MARKER` rig was started with. To change it, restart rig and run
the same command. Like `pnpm start`, it reads `PORT` from `.env`, else uses 8787. The command
exits non-zero and writes nothing when rig does not answer 200, when the page holds `<script`,
`<link`, `src=`, `@import` or `url(`, or when the output folder does not exist. `var/` is
git-ignored: never commit a preview.

## Publishing the preview

The `Preview` workflow (`.github/workflows/preview.yml`, run by hand) starts rig, saves
`/digest/2026-10-28` as `index.html`, and deploys that one file to this repo's GitHub Pages
site. The banner carries the repository secret `LANE_MARKER`, so the run log masks it. When the
secret is unset or empty, the banner reads "no marker set". If the save fails, the run fails and
deploys nothing.

```sh
gh workflow run preview.yml --ref <branch>
```

To take the marker off, delete the secret or set it empty, then run the workflow again: it
uploads over the same link.
