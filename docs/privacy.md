# Privacy

Pockedio is a local-first, single-user CLI. Its own state lives under `~/.pockedio/` unless `POCKEDIO_HOME` points somewhere else.

## Local Data

Pockedio may create:

- `config.json` for local settings.
- `pockedio.sqlite` for sessions, stations, memory, and playback records.
- `taste.md` for imported and editable music taste.
- `personas.json` for DJ persona settings.
- `secrets/` for pasted LLM API keys or NetEase cookies.
- `audio/` for generated DJ audio.

Do not commit files from `~/.pockedio/`.

## External Services

Pockedio sends data outside your machine only when you configure or enable features that need it:

- LLM provider: conversation text, station planning prompts, DJ copy prompts, and enabled context summaries.
- NetEase adapter: search terms, track IDs, and account-backed cookie requests if you configure account playback.
- Open-Meteo: weather location lookup when weather context is enabled.
- Apple Calendar and diary access: read locally first; summaries may be included in LLM prompts when the related feature is enabled.

If you use a remote LLM provider, enabled diary and calendar summaries may be sent to that provider as part of prompt context.

## Secrets

`.env`, `.env.*`, and local Pockedio secret files are ignored by git. `.env.example` is a template only and must not contain real credentials.

When reporting bugs, do not paste API keys, NetEase cookies, private diary text, calendar details, raw prompts containing sensitive data, or local database files.

## Release Testing

Use a disposable home when testing releases:

```bash
POCKEDIO_HOME=/tmp/pockedio-clean-test node dist/cli.js status
```

This prevents release logs from exposing your normal memory, favorites, taste, secrets, diary context, or prior sessions.
