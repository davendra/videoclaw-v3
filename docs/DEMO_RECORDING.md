# Recording the quickstart demo

The `docs/assets/demo-quickstart.gif` rendered on the README comes from a narrated
CLI walkthrough in `scripts/demo-quickstart.mjs`, captured with asciinema and
rendered to GIF with [agg](https://github.com/asciinema/agg).

## Prereqs

```bash
brew install asciinema agg
```

## Record

```bash
npm run demo:record
```

That script will:

1. `npm run build`
2. Record `scripts/demo-quickstart.mjs` into `docs/assets/demo-quickstart.cast`
3. Render `docs/assets/demo-quickstart.cast` to `docs/assets/demo-quickstart.gif`

Commit both artifacts.

## Preview without recording

```bash
npm run demo
```

Set `VCLAW_DEMO_PAUSE_MS` to tune the pause between steps (default `900`).

```bash
VCLAW_DEMO_PAUSE_MS=300 npm run demo   # fast preview
VCLAW_DEMO_PAUSE_MS=1400 npm run demo  # slower for recording
```

## Tuning the render

`scripts/record-demo.sh` uses:

- `--cols 100 --rows 28` — wide enough for the longest brief line
- `--idle-time-limit 2` — collapses long pauses in the cast
- `agg --theme monokai --font-size 16` — matches the README dark theme

If you change the demo script to add/remove steps, re-record and re-render.

## What the GIF is for

It lives in the README right after the quickstart section. Its job is to show in
~60 seconds that `vclaw`:

1. produces a canonical JSON artifact at every stage
2. routes to a specific provider without silent fallback
3. refuses to submit on `--dry-run`
4. exposes portfolio metrics + Obsidian export out of the box

Keep it short. If the demo drifts past ~90s of wall-clock, trim steps rather
than raising the speed.
