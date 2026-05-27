# Changelog

All notable public release changes are documented here.

## 0.2.0 - 2026-05-27

Voice setup and CLI polish release.

- Add Kokoro as a local voice category with guided setup and curated voices.
- Improve Fish Speech setup for fresh installs, including proxy-friendly model download commands.
- Add taste candidate retrieval so station planning can draw from more relevant taste context.
- Keep DJ notes directly addressed to the listener and handle negated feedback more naturally.
- Accept compact queue commands such as `play2` in addition to spaced forms.
- Improve playback resilience when a player process exits unexpectedly.
- Fix `q` cancellation behavior while processing.

## 0.1.1 - 2026-05-25

Taste personalization patch.

- Regenerate the generated Taste Brief automatically after playlist or file imports.
- Refresh the Taste Brief once at session end when new listening feedback creates taste signals.
- Use the generated Taste Brief before raw `taste.md` lines during station planning.
- Include imported-library anchors in the Taste Brief so large taste files become compact station context.

## 0.1.0 - 2026-05-25

Initial source-install release candidate.

- CLI-first personal AI DJ session with natural language playback controls.
- Five-track station generation using taste, context, memory, and an OpenAI-compatible LLM.
- NetEase Cloud Music adapter support for search and playback URL lookup.
- Local SQLite memory, session transcript storage, and editable taste profile.
- Optional macOS Calendar, diary, weather, and scheduled DJ context.
- Built-in macOS voice path and optional Fish TTS setup for Mina/Nova DJ voices.
- Source-install documentation, MIT license, contribution guide, and security policy.
