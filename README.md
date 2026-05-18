# Pockedio

Pockedio is a CLI-first, LLM-powered personal DJ. The main interface is conversational: run `pockedio`, talk naturally, and let the app decide whether to discuss, generate a five-song station, start playback, store feedback, or create explicit DJ audio.

V1 is local-first and single-user. It uses NetEase Cloud Music for real music search/playback, local FishAudio S2 Pro MLX for spoken DJ audio, Apple Calendar and weather for context, SQLite for durable memory, and editable `taste.md` as a human-readable taste surface.

## Command Surface

Only these user-facing commands are part of v1:

```bash
pockedio
pockedio setup
pockedio import-taste <file>
pockedio serve
pockedio status
```

Development-only `serve` flags are available for smoke checks:

```bash
pockedio serve --run-once morning
pockedio serve --run-once evening
pockedio serve --run-once mood-check
```

## Local Setup

Install dependencies and build:

```bash
npm install
npm run build
```

Run from source during development:

```bash
npm run dev
```

Or link the built CLI:

```bash
npm link
pockedio status
```

Start the local NetEase Cloud Music API before real playback checks:

```bash
spikes/scripts/run_netease_api.sh
```

For a detached local dev session:

```bash
screen -dmS pockedio-netease bash -lc 'cd /Users/leonw/repos/Pockedio && exec spikes/scripts/run_netease_api.sh > .cache/netease-api.log 2>&1'
```

Configure local runtime data:

```bash
npm run dev -- setup
```

Setup writes local files under `~/.pockedio/`:

```text
~/.pockedio/
  config.json
  pockedio.sqlite
  taste.md
  personas.json
  audio/
    dj/
```

Import normalized taste data:

```bash
npm run dev -- import-taste spikes/fixtures/taste-normalized.csv
```

Check health:

```bash
npm run dev -- status
```

Enter the conversational DJ session:

```bash
npm run dev
```

Run scheduled DJ jobs and mood checks:

```bash
npm run dev -- serve
```

## Runtime Dependencies

- NetEaseCloudMusicApi local server on `http://127.0.0.1:3000` for real music search and playable URL retrieval.
- FishAudio S2 Pro MLX model and Python entrypoint configured through `pockedio setup`.
- `afplay` on macOS for local audio playback.
- Apple Calendar permission when Calendar context is enabled.
- Open-Meteo network access for weather context.
- `OPENAI_API_KEY` for full LLM station planning and DJ copy. Without it, Pockedio uses deterministic fallback paths where available.

## V1 Behavior

- Ordinary user-active playback creates a five-song station and attempts real playback through NetEase.
- Ordinary user-active playback does not synthesize spoken DJ voice.
- Spoken DJ audio is limited to weekday 8:45 AM Morning DJ, weekday 5:00 PM Evening DJ, and explicit user requests for DJ-like audio.
- FishAudio output is played directly; it is not presented for review first.
- `pockedio serve` runs scheduled DJ jobs and hourly mood-check prompts.
- Mood checks are app prompts with options and require confirmation before playback.
- Apple Calendar, weather, diary summaries, taste, personality, mood, feedback, and playback context are stored locally when used.
- Every user and Pockedio message in a session is stored in SQLite.
- `taste.md` is editable, but durable memory also lives in the database.

## Verification

Automated checks:

```bash
npm run typecheck
npm test
npm run build
```

Manual smoke checks:

```bash
spikes/scripts/run_netease_api.sh
npm run dev -- setup
npm run dev -- import-taste spikes/fixtures/taste-normalized.csv
npm run dev -- status
npm run dev
```

In the session:

```text
play something for deep work
```

Then verify a five-song station is generated, playback starts or unavailable tracks are handled gracefully, the transcript is stored, and no spoken DJ audio plays.

Explicit DJ audio smoke:

```bash
npm run dev
```

```text
make me a short DJ intro for tonight
```

Expected: FishAudio generates and plays audio directly, with DJ audio metadata stored locally.

Scheduled job smoke:

```bash
npm run dev -- serve --run-once morning
npm run dev -- serve --run-once evening
npm run dev -- serve --run-once mood-check
```

## Project Docs

- Product requirements: `docs/product-requirements.md`
- Product route: `docs/product-route.md`
- Taste intelligence: `docs/taste-intelligence.md`
- V1 design spec: `docs/superpowers/specs/2026-05-17-pockedio-v1-design.md`
- Technical spike results: `spikes/results.md`
- V1 acceptance checklist: `docs/v1-acceptance.md`
