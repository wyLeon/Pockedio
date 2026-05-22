# Contributing

Thanks for helping improve Pockedio.

## Development Setup

```bash
git clone https://github.com/wyLeon/Pockedio.git
cd Pockedio
npm install
npm run build
npm test
```

For real playback, start the local NetEase adapter in a separate terminal:

```bash
spikes/scripts/run_netease_api.sh
```

## Before Opening A PR

Run:

```bash
npm run typecheck
npm test
npm run build
```

If your change touches setup or interactive terminal behavior, also run a manual CLI pass:

```bash
node dist/cli.js setup
node dist/cli.js status
node dist/cli.js
```

Check that nested setup prompts can return without using Ctrl+C. Selectable screens use `B Back`; text and password prompts use `Esc to back`.

## Secrets

Never commit:

- API keys
- NetEase cookies
- `.env` files
- `~/.pockedio/` config, database, secrets, or generated audio
- local model paths that only work on your machine

Use `.env.example` for placeholder names only.

## Coding Notes

- Keep the CLI local-first and single-user unless a design document explicitly changes that.
- Prefer existing setup surfaces and config helpers over adding one-off prompts.
- Treat Fish TTS as optional. Built-in macOS voices should remain the low-friction path where available.
- Keep user-facing command surface small; most controls should remain natural-language session intents.
