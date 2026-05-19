# Pockedio

Pockedio is a CLI-first, LLM-powered personal DJ. The main interface is conversational: run `pockedio`, talk naturally, and let the app decide whether to discuss, generate a five-song station, start playback, store feedback, or create explicit DJ audio.

V1 is local-first and single-user. Pockedio-owned data stays on this machine under `~/.pockedio/`. It uses NetEase Cloud Music for real music search/playback, local FishAudio S2 Pro MLX for spoken DJ audio, Apple Calendar and weather for context, SQLite for durable memory, and editable `taste.md` as a human-readable taste surface.

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

Start the local NetEase Cloud Music adapter before real playback checks:

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

`import-taste` expects a normalized CSV export, not a direct NetEase account login. The importer writes `~/.pockedio/taste.md` and durable taste memories into SQLite. Keep `taste.md` editable; it is the human-readable preference surface Pockedio reads when planning stations.

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

- NetEaseCloudMusicApi local adapter on `http://127.0.0.1:3000` for real music search and playable URL retrieval.
- FishAudio S2 Pro MLX model and Python entrypoint configured through `pockedio setup`.
- `afplay` on macOS for local audio playback.
- Apple Calendar permission when Calendar context is enabled.
- Open-Meteo network access for weather context.
- `OPENAI_API_KEY` for full LLM station planning and DJ copy. Without it, Pockedio uses deterministic fallback paths where available.
- OpenAI-compatible LLMs can be used by setting `llm.baseUrl` and `llm.apiKeyEnv` in `~/.pockedio/config.json`, for example DeepSeek with `baseUrl: "https://api.deepseek.com"` and `apiKeyEnv: "DEEPSEEK_API_KEY"`.

## Data Boundary

Pockedio-owned data is local only:

- Config: `~/.pockedio/config.json`
- Durable memory: `~/.pockedio/pockedio.sqlite`
- Human-editable taste: `~/.pockedio/taste.md`
- DJ personas: `~/.pockedio/personas.json`
- DJ audio cache: `~/.pockedio/audio/`

External adapters may send request data outside the machine when used:

- NetEase music adapter: search terms and track lookup requests.
- OpenAI-compatible LLM: prompts used for conversation, station planning, and DJ copy.
- Open-Meteo weather: configured city/location lookup.

Pockedio does not run a hosted backend, create user accounts, or store user memory remotely.

## Setup Surfaces

`pockedio setup` runs the first setup flow:

- DJ choice: Mina or Nova, with optional local trial audio.
- Taste import: optional NetEase playlist link.
- Weather context: optional city lookup for lighter DJ context.
- Other context: optional Apple Calendar access and diary path; both stay local, and setup checks show spinner-style feedback while reading.
- Scheduled DJ programs: optional weekday Morning DJ, Evening DJ, both, or neither. Setup asks for the ready time for each enabled program; Pockedio prepares audio before that time.

Advanced preference surfaces are still evolving:

- Calendar context can also be revisited with `pockedio setup calendar`.
- Diary context is optional. Pockedio generates and stores a local summary for the latest diary file; if the configured LLM is remote, summary generation may send a diary excerpt to that LLM.
- Developer/runtime config: NetEase music adapter base URL and OpenAI-compatible LLM settings.
- Personal profile: MBTI.
- DJ preference: language, style, persona preference, and program length.
- Scheduled DJ: Morning DJ and Evening DJ can be revisited later; the user-facing setting is ready time, while the preparation offset stays internal by default.

DJ persona schedules are stored in `~/.pockedio/personas.json`. The setup prompt controls the preferred persona direction; the personas file controls the actual weekly persona rotation.

## V1 Behavior

- Ordinary user-active playback creates a five-song station and attempts real playback through NetEase.
- Ordinary user-active playback does not synthesize spoken DJ voice.
- Spoken DJ audio is limited to enabled weekday Morning/Evening DJ programs and explicit user requests for DJ-like audio.
- FishAudio output is played directly; it is not presented for review first.
- Normal conversations can read today's Calendar context when enabled; scheduled DJ reads the last 7 days plus today.
- `pockedio serve` runs scheduled DJ jobs and hourly mood-check prompts.
- Mood checks are app prompts with options and require confirmation before playback.
- Apple Calendar, weather, diary summaries, taste, personality, mood, feedback, and playback context are stored locally when used.
- Diary summaries are cached in SQLite and reused until the source diary file changes.
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

If your local shell picks up a different Node.js version, run CLI smoke checks with Node v24 first on `PATH`:

```bash
PATH=/Users/leonw/.nvm/versions/node/v24.12.0/bin:$PATH npm run dev -- status
PATH=/Users/leonw/.nvm/versions/node/v24.12.0/bin:$PATH npm run dev -- setup
PATH=/Users/leonw/.nvm/versions/node/v24.12.0/bin:$PATH npm run dev
```

In the session:

```text
I'm exhausted now, want some relaxation.
yes, play it
This reminds me of winter evenings in university.
Why did you pick this track?
what's playing?
next
```

Then verify implicit mood requests answer first and ask before playback, confirmation starts the pending station, playback requests show progress statuses, a five-song station is generated when requested, playback starts or unavailable tracks are handled gracefully, the transcript is stored, and no spoken DJ audio plays unless explicitly requested.

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

Built CLI smoke:

```bash
PATH=/Users/leonw/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH npm run build
node dist/cli.js status
node dist/cli.js
```

## Project Docs

- Product requirements: `docs/product-requirements.md`
- Product route: `docs/product-route.md`
- Taste intelligence: `docs/taste-intelligence.md`
- V1 design spec: `docs/superpowers/specs/2026-05-17-pockedio-v1-design.md`
- Technical spike results: `spikes/results.md`
- V1 acceptance checklist: `docs/v1-acceptance.md`
