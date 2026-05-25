# Changelog

All notable public release changes are documented here.

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
