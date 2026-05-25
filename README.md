# Pockedio

Pockedio is a CLI-first personal AI DJ. It helps you talk naturally about what you want to hear, builds a short station, plays music through NetEase Cloud Music, and can optionally add spoken DJ program audio.

Pockedio is local-first and single-user. Its own config, memory, taste profile, and generated audio live under `~/.pockedio/`. External services are used only when you enable or configure them.

## Status

Pockedio is an early open-source release. Install from source for now. The npm package is not published yet.

The current release target is a working local developer/user setup, not a hosted service.

## What It Does

- Opens a terminal setup and session entry screen.
- Lets you configure LLM, voice, NetEase, context, and Schedule DJ from setup screens.
- Understands natural language playback controls such as play, pause, resume, next, previous, favorite, and questions about the current song.
- Builds five-track stations from your prompt, taste, context, and memory.
- Imports NetEase playlists into a local taste profile.
- Supports built-in macOS voices with no model install.
- Supports optional Fish TTS for Mina/Nova DJ voices if you already use or install Fish locally.
- Stores local memory in SQLite and a human-editable `taste.md`.

## Requirements

Required:

- Node.js 22 or newer.
- A terminal with interactive input support.
- An OpenAI-compatible LLM provider for full station planning and conversational behavior.
- NetEase Cloud Music API adapter for real playback.

Optional:

- macOS for built-in `say` voices and Apple Calendar context.
- `mpv` for stronger pause/resume control. Pockedio falls back to macOS `afplay` where available.
- Fish TTS for local Mina/Nova voice synthesis.
- Apple Calendar permission.
- Diary folder access.
- Weather lookup through Open-Meteo.

## Install From Source

```bash
git clone https://github.com/wyLeon/Pockedio.git
cd Pockedio
npm install
npm run build
```

Run from source:

```bash
npm run dev
```

Or link the built CLI locally:

```bash
npm link
pockedio
```

## Start The NetEase Adapter

Pockedio expects a local NetEase Cloud Music API adapter for search and playable URL lookup.

In a separate terminal:

```bash
spikes/scripts/run_netease_api.sh
```

By default this starts the adapter at `http://127.0.0.1:3000`.

## Configure Pockedio

Run:

```bash
pockedio setup
```

This runs the full setup prompt. You can also run `pockedio`, choose `Setup & Connections`, and configure the same areas from the setup hub:

- LLM provider and API key.
- Voice selection.
- Optional Fish TTS.
- NetEase account or anonymous playback.
- Calendar, weather, and diary context.
- Optional Schedule DJ.

Use `Esc` to go back from nested text/password prompts. Use `B` to go back on selectable setup screens.

### LLM Providers

Pockedio supports OpenAI-compatible providers. The setup flow currently includes:

- OpenAI
- DeepSeek
- OpenRouter
- local vLLM
- custom OpenAI-compatible endpoint

You can paste a key during setup or use a shell environment variable.

Example environment variables:

```bash
export OPENAI_API_KEY="..."
export DEEPSEEK_API_KEY="..."
export OPENROUTER_API_KEY="..."
```

Do not commit API keys. `.env` and `.env.*` are ignored by git. Use `.env.example` only as a template.

### Voice

The lowest-friction path is the built-in macOS voice option. It needs no model download.

Fish TTS is optional. Use it if you want the local Mina/Nova voice path and are comfortable installing the local runtime and model. Pockedio can help detect an existing Fish install or guide a local install.

### Diary Path Tip

When configuring Diary context on macOS:

1. Open your journal root directory in Finder.
2. Press `Option + Command + C` to copy its path.
3. Paste that path into Pockedio.

Diary is opt-in. If your configured LLM is remote, diary summary generation may send a diary excerpt to that LLM.

## Import Taste

Import a NetEase playlist:

```bash
pockedio import-taste "https://music.163.com/#/playlist?id=..."
```

The importer updates:

```text
~/.pockedio/taste.md
~/.pockedio/pockedio.sqlite
```

`taste.md` is intentionally editable. It is the human-readable taste surface.

## Use It

Start the CLI:

```bash
pockedio
```

Example prompts:

```text
play something soft for late-night focus
who is the singer?
favorite this
next one
pause
resume
make it warmer and more acoustic
```

When Pockedio suggests a station, press Enter to play it, type `dj` for a spoken DJ version, or describe how to adjust it.

## Commands

```bash
pockedio
pockedio --session
pockedio setup
pockedio setup llm
pockedio setup voice
pockedio setup netease
pockedio setup context
pockedio setup scheduler
pockedio import-taste <netease-playlist-link-or-id>
pockedio refresh-context
pockedio status
pockedio serve
```

`pockedio serve` must stay running for scheduled DJ prompts and mood checks to fire.
If it is not running at the scheduled minute, Pockedio will not wake up by itself.
Use `pockedio status` to confirm whether the scheduler process is currently alive.

Development smoke commands:

```bash
pockedio serve --run-once morning
pockedio serve --run-once evening
pockedio serve --run-once mood-check
```

## Local Data

Pockedio-owned data stays local by default:

```text
~/.pockedio/
  config.json
  pockedio.sqlite
  taste.md
  personas.json
  secrets/
  audio/
```

The `secrets/` directory is for local credentials such as pasted LLM keys or NetEase cookies. Do not commit it.

External services may receive data when enabled:

- LLM provider: conversation, station-planning, and DJ-copy prompts.
- NetEase adapter: music search and playable URL requests.
- Open-Meteo: configured city/location.
- Fish TTS: local text/audio synthesis only when configured locally.

Pockedio does not run a hosted backend, create user accounts, or store your memory remotely.

## Development

```bash
npm run typecheck
npm test
npm run build
```

Fresh local smoke test:

```bash
export POCKEDIO_HOME=/tmp/pockedio-clean-test
rm -rf "$POCKEDIO_HOME"
npm ci
npm run build
node dist/cli.js status
node dist/cli.js setup
node dist/cli.js
```

Keep `POCKEDIO_HOME` set for the whole smoke test. Otherwise Pockedio will use your real `~/.pockedio` memory, favorites, taste, secrets, and config, which is useful for personal use but not a clean release test.

## Release Readiness

Before a public tag:

- Run automated checks.
- Run a fresh-clone setup with a disposable `POCKEDIO_HOME`.
- Confirm setup back paths work, especially `Esc` from nested prompts.
- Confirm no real API keys, cookies, local config, or `.env` files are tracked.
- Confirm README setup matches the current CLI behavior.

See [docs/open-source-release-checklist.md](docs/open-source-release-checklist.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Security

See [SECURITY.md](SECURITY.md).

## License

MIT. See [LICENSE](LICENSE).
