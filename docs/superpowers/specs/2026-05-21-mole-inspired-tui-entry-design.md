# MOLE-Inspired TUI Entry Design

## Purpose

Pockedio needs a first-level terminal entry surface that helps users understand what the tool does before they enter the main DJ conversation. The design references the MOLE CLI style: clear terminal identity, a compact option list, and a bottom command hint bar.

This entry surface should reduce first-run confusion without turning Pockedio into a command-first product. The conversational DJ session remains the core experience.

## Current Direction

Build a thin Welcome Hub before the main interactive session. The hub is an orientation and readiness surface, not a deep menu hierarchy.

The hub should answer three questions quickly:

- What is this? A personal AI DJ session.
- Am I ready? Show setup and context readiness.
- What can I do next? Enter the DJ session, fix setup, inspect taste/memory, or check status.

This first-level surface is also the product's setup map. Voice selection and LLM configuration belong here because they determine whether the core experience can work: the user needs an LLM to converse and generate stations, and they need a voice provider to hear DJ programs.

## Non-Goals

This design does not add:

- separate `Start Radio`, `Quick Station`, and `Scheduled DJ` top-level modes
- a deep nested settings hierarchy
- a replacement for existing scriptable commands such as `pockedio setup`, `pockedio status`, `pockedio serve`, or `pockedio import-taste`
- a Go/Bubble Tea rewrite by default
- a landing-page style screen
- a Fish-first voice setup requirement

## Product Principle

The first-level page should not create hierarchy for hierarchy's sake. It should expose product readiness and give the user confidence about what will happen next.

`Quick Station` and `Scheduled DJ` are not separate first-level destinations. They are intents and behaviors inside the main DJ session or background scheduler.

## Welcome Hub Draft

```text
Pockedio

Personal AI DJ for context-aware listening

> Enter DJ Session        Talk, ask, play, reshape, queue, DJ mode
  Setup & Connections     Music, LLM, voice, calendar, weather, diary
  Taste & Memory          Import taste, review personalization inputs
  Status                  Playback, scheduler, health, version

Readiness
  Music        NetEase connected
  LLM          Configured
  Voice        Vale, built-in macOS
  Taste        Imported
  Calendar     Enabled

↑↓ Select  |  Enter Open  |  S Setup  |  L LLM  |  V Voice  |  Q Quit
```

## Entry Point 1: Enter DJ Session

### Intent

Open the current conversational DJ interface. This is the main product surface.

### Draft Surface

```text
Pockedio is listening.
What are we tuning for?

Try:
  I'm exhausted and want something calm.
  play something for deep work
  what's playing?

Controls:
  next
  previous
  stop
  pause / keep playing
  show queue
```

### Behavior

- Enter opens the existing interactive session.
- No submenu.
- No extra confirmation.
- Current natural-language routing remains responsible for playback, pause, resume, previous, queue, recommendations, and discussion.

## Entry Point 2: Setup & Connections

### Intent

Show whether the product is operational and route users to existing setup flows.

### Draft Surface

```text
Setup & Connections

Music           NetEase connected
LLM             OpenAI key missing
Voice           Vale, built-in macOS
Calendar        Enabled
Weather         Shanghai
Diary           Not enabled

Actions:
> Run full setup
  Configure LLM
  Configure Voice
  Configure NetEase
  Configure Calendar
  Back
```

### Behavior

- `Run full setup` maps to existing setup flow.
- `Configure LLM` maps to a focused LLM setup flow.
- `Configure Voice` maps to a focused voice setup flow.
- `Configure NetEase` maps to existing NetEase setup flow.
- `Configure Calendar` maps to existing Calendar setup flow.
- The setup flow should stay shallow. Each action opens one focused configuration surface and returns to `Setup & Connections`.

### LLM Setup Surface

```text
LLM

Provider        OpenAI-compatible
Model           gpt-4.1-mini
API key         Missing: OPENAI_API_KEY
Base URL        OpenAI default

Actions:
> Use OpenAI
  Use DeepSeek
  Use OpenRouter
  Use local vLLM
  Custom OpenAI-compatible
  Test current setup
  Back
```

Behavior:

- Default to the current config values from `llm.provider`, `llm.model`, `llm.baseUrl`, and `llm.apiKeyEnv`.
- The top-level LLM setup is provider-first. Selecting a provider opens a focused provider detail surface instead of immediately applying a preset.
- Hosted provider detail surfaces expose `Paste API key`, `Use shell env`, `Change model`, `Test connection`, and `Back`.
- Custom OpenAI-compatible detail also exposes `Change base URL` and `Set API key env`.
- Local vLLM detail exposes `Check server`, `Discover models`, optional key paste, manual model entry, and base URL entry.
- Users can paste an API key directly in the terminal from the provider detail screen. Pockedio stores it in the local secret file outside the normal config, with owner-only permissions.
- Runtime key lookup order is shell environment first, local secret second. This keeps advanced shell-based setup working while giving new users a lower-friction path.
- vLLM discovery queries the OpenAI-compatible `/models` endpoint and can save the first discovered model as the current model.
- `Test connection` should make the smallest practical LLM call and report configured / missing key / connection failed.
- Missing LLM configuration should be a readiness warning, not a crash in the hub.

### Voice Setup Surface

```text
Voice

Provider        Built-in macOS voice
Voice           Vale
Advanced        Fish TTS not configured

Actions:
> Preview voices
  Choose built-in voice
  Configure Fish TTS
  Use text-only DJ copy
  Back
```

Behavior:

- On macOS, default to the built-in Siri voice path from the macOS Siri TTS design.
- Offer the Pockedio-facing voice names: Lumen, Sable, Arden, Vale, Sol.
- Default to Vale.
- `Preview voices` should play the currently configured voice with a fixed DJ sample sentence.
- `Choose built-in voice` should let users select one of the five named macOS voices, play a true preview, and persist `tts.provider = "macos"` plus the chosen voice.
- `Configure Fish TTS` should let users select Mina or Nova, play the local preview WAV when present, and persist `tts.provider = "fish"` plus the chosen Fish voice.
- `Use text-only DJ copy` should persist `tts.provider = "text"`.
- Runtime DJ audio should consume this same `tts` config: macOS selections generate local AIFF files through `say`, Fish selections use the existing FishAudio path, and text-only selections skip synthesis while keeping DJ copy visible.
- Fish TTS is an advanced path for Mina and Nova, not a first-run requirement.
- On non-macOS platforms, show text-only as the default and Fish TTS as the optional configured path.
- Voice setup details and provider behavior are defined in `docs/superpowers/specs/2026-05-22-macos-siri-tts-fallback-design.md`.

## Entry Point 3: Taste & Memory

### Intent

Give users a compact view of personalization inputs without exposing raw private data.

### Draft Surface

```text
Taste & Memory

Imported lists  4 playlists, 312 tracks
Last import     Late Night Piano, today 11:42
Taste profile   Needs refresh
Recent signals  Feedback signal count if available
Session memory  Last updated if available
Diary           Summary available / not enabled

Actions:
> Import playlist or taste file
  Rebuild taste profile
  Show taste summary
  Start station from latest import
  Back
```

### Behavior

- `Import playlist or taste file` should accept a normalized taste CSV file, a NetEase playlist link, or a NetEase playlist ID.
- Import can be run at any time. It should not stop current playback, skip tracks, or replace the current station silently.
- A new import is a taste signal, not an immediate playback command.
- Imports should merge into the existing taste surface and preserve user-authored `taste.md` notes.
- After importing, show a compact result screen:

```text
Imported playlist

Tracks        42
Artists       31
Playlist      Late Night Piano
Taste file    ~/.pockedio/taste.md

Updated:
  Imported taste signals
  Taste memory
  Taste profile needs refresh

Actions:
> Rebuild taste profile
  Start station from this playlist
  Back to Taste & Memory
```

- `Rebuild taste profile` should map to the current taste profile update behavior.
- `Start station from latest import` should open the main DJ session with the playlist context available as the station seed. It should not start automatically right after import.
- `Show taste summary` should show a compact summary, not raw diary or full transcripts.

## Entry Point 4: Status

### Intent

Show operational health and current playback state.

### Draft Surface

```text
Status

Playback        Playing: title - artist / Not playing
Queue           Track N / 5 when available
Scheduler       Running / Not running / Unknown
LLM             Configured / Missing key
Version         0.1.0

Actions:
> Refresh
  Show queue
  Back
```

### Behavior

- Reuse existing `pockedio status` logic where possible.
- If no playback is active, say so directly.
- `Refresh` rerenders this surface.
- `Show queue` only appears or does something useful when queue state exists.

## Interaction Rules

- Default selection is always `Enter DJ Session`.
- Returning users should be able to press Enter immediately.
- Every destination is shallow: one screen plus two to four actions.
- Every destination has a Back path.
- Existing commands remain available and scriptable.
- The hub should not block non-interactive CLI use.
- In non-TTY contexts, keep output plain and avoid interactive rendering.
- Current-fact checking stays an internal default capability. Do not expose it as a readiness item or user setting.

## Implementation Goals

The implementation should be judged against these goals:

1. A first-run user can understand the product from the first screen without reading docs.
2. A returning user can press Enter from the hub and reach the main DJ session immediately.
3. A user with missing LLM config can see the problem and open LLM setup from the hub.
4. A macOS user can choose a built-in DJ voice without installing Fish TTS.
5. A user who wants Mina or Nova can find Fish TTS setup as an advanced voice path.
6. The hub does not create fake product modes; station generation, DJ mode, and scheduled DJ remain behaviors inside the session or scheduler.
7. Non-TTY and existing scriptable commands keep working without the hub interfering.
8. A user can import a new playlist from Taste & Memory without losing previous imports or user-authored taste notes.

## Acceptance Checks

After implementation, verify the goals with these checks:

- Launch `pockedio` in a TTY with a complete config. Expected: MOLE-like hub appears, `Enter DJ Session` is selected, readiness shows Music, LLM, Voice, Taste, and Calendar.
- Press Enter from the hub. Expected: existing main DJ session opens without extra confirmation.
- Launch with the configured LLM API key env missing. Expected: readiness shows the missing key and `Configure LLM` is reachable from `Setup & Connections`.
- Choose an LLM provider, open `Paste API key`, and paste the key from the provider detail screen. Expected: readiness changes to local secret, normal config does not contain the raw key, and the secret file has owner-only permissions.
- Open local vLLM, run `Discover models` against a running vLLM-compatible server. Expected: Pockedio saves the discovered model and keeps the base URL under the local vLLM provider setup.
- Run the LLM connection test with a valid key. Expected: setup reports configured and returns to the setup surface.
- Open `Configure Voice` on macOS. Expected: Lumen, Sable, Arden, Vale, and Sol are available, with Vale as default.
- Select a built-in voice and request a spoken DJ station. Expected: Pockedio prepares DJ voice without requiring Fish TTS.
- Select Fish TTS / Mina or Nova. Expected: Pockedio asks for Fish runtime details only in that advanced path.
- Open `Taste & Memory`, import a NetEase playlist link, and return to the surface. Expected: latest import, imported playlist count, and `Taste profile needs refresh` are visible.
- Import a second playlist. Expected: previous playlist tracks and user-authored `taste.md` notes are preserved.
- Import while playback is active. Expected: playback continues and the current queue is not replaced unless the user chooses `Start station from this playlist`.
- Run a non-TTY command such as `pockedio status` or piped invocation. Expected: plain command behavior, no interactive hub.
- Run the automated tests covering hub routing, readiness formatting, LLM config detection, voice provider defaults, and non-TTY bypass.

## Implementation Decisions

1. Bare `pockedio` opens the Welcome Hub in TTY mode.
2. Direct session entry should remain available through an explicit flag such as `pockedio --session` or `pockedio --no-hub`.
3. Implement the hub with the current Node CLI stack first. Do not add Bubble Tea or a Go rewrite for this pass.
4. Required readiness fields for this pass are Music, LLM, Voice, Taste, and Calendar.
5. `Taste & Memory` shows summary-level metadata only. It must not expose raw diary entries, raw transcripts, or full private memory records.

## Implementation Planning Order

1. Add config/readiness helpers for Music, LLM, Voice, Taste, and Calendar.
2. Add the Welcome Hub renderer and keyboard routing for the four entry points.
3. Add focused LLM setup and Voice setup surfaces.
4. Add anytime playlist import and post-import actions to Taste & Memory.
5. Add direct session bypass for non-TTY and explicit session flags.
6. Add automated tests for routing, readiness, setup surfaces, anytime import, and non-TTY behavior.
7. Run the manual acceptance checks listed above.
