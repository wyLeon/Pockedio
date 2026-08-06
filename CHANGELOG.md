# Changelog

All notable public release changes are documented here.

## 0.5.0 - 2026-08-06

Fish Audio Cloud and runtime resilience release.

- Add Fish Audio Cloud as an alternative to the local Fish model for Mina and Nova DJ voices, with guided cloud/local setup, built-in voice references, status reporting, and optional proxy support.
- Use the local Mina and Nova voice references for Cloud Fish synthesis, and retry transient Cloud Fish network and server failures before falling back.
- Make Cloud Fish setup use the default free model and complete the full setup flow after a voice is selected.
- Keep recommendation replies useful when an LLM is unavailable by deriving listening hints from diary context and summarizing saved `taste.md` signals.
- Bound interactive LLM requests to 45 seconds without implicit retries so temporary provider failures do not stall the CLI.
- Prevent duplicate playback when automatic advance races with a manual track change, and clean up played or orphaned DJ audio files.
- Render long interactive input as explicit terminal rows so editing multi-line text does not leave stale characters in the terminal.

## 0.4.0 - 2026-06-02

Context heartbeat, DJ handoff, and continuation release.

- Add six-hour Calendar and diary context heartbeat refreshes during long-running `pockedio serve` sessions.
- Add confirmed mid-playback DJ handoff so users can prepare a spoken DJ version of the current station before stopping playback.
- Persist the last station vibe so `continue this vibe` can recover after the immediate pending station is gone.
- Improve station change, favorite picker, and queue redraw handling during interactive playback.
- Guard recommendation replies and DJ intros against false current-time claims.
- Add a Chinese beginner install and usage guide for Mac source installs.

## 0.3.0 - 2026-05-28

Source update, DJ-mode, and direct-song version release.

- Add `pockedio update --check` and source-tree update guidance for source installs.
- Improve inline DJ-mode station requests and mid-playback DJ-mode guidance.
- Keep generated DJ program intros aligned to the local daypart.
- Ask whether short ambiguous CJK `play` requests should be treated as a song match or a five-song station.
- Let direct song playback reopen close matches with `v` or `versions` so users can switch between versions repeatedly.
- Improve Kokoro spoken DJ audio by using provider-specific pronunciation-safe text while preserving visible metadata.
- Align close-match and choice-list rows with the terminal playback design language.

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
