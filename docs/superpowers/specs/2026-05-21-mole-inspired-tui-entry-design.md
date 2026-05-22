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
> Set API key env name
  Change model
  Change base URL
  Test connection
  Back
```

Behavior:

- Default to the current config values from `llm.provider`, `llm.model`, `llm.baseUrl`, and `llm.apiKeyEnv`.
- Do not ask users to paste raw API keys into Pockedio. Ask for the environment variable name and show whether it is present.
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
- Fish TTS is an advanced path for Mina and Nova, not a first-run requirement.
- On non-macOS platforms, show text-only as the default and Fish TTS as the optional configured path.
- Voice setup details and provider behavior are defined in `docs/superpowers/specs/2026-05-22-macos-siri-tts-fallback-design.md`.

## Entry Point 3: Taste & Memory

### Intent

Give users a compact view of personalization inputs without exposing raw private data.

### Draft Surface

```text
Taste & Memory

Taste file      Imported, track count if available
Recent signals  Feedback signal count if available
Session memory  Last updated if available
Diary           Summary available / not enabled

Actions:
> Import taste
  Rebuild taste profile
  Show taste summary
  Back
```

### Behavior

- `Import taste` should route to existing taste import behavior or explain the required file path.
- `Rebuild taste profile` should map to the current taste profile update behavior.
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

## Acceptance Checks

After implementation, verify the goals with these checks:

- Launch `pockedio` in a TTY with a complete config. Expected: MOLE-like hub appears, `Enter DJ Session` is selected, readiness shows Music, LLM, Voice, Taste, and Calendar.
- Press Enter from the hub. Expected: existing main DJ session opens without extra confirmation.
- Launch with the configured LLM API key env missing. Expected: readiness shows the missing key and `Configure LLM` is reachable from `Setup & Connections`.
- Run the LLM connection test with a valid key. Expected: setup reports configured and returns to the setup surface.
- Open `Configure Voice` on macOS. Expected: Lumen, Sable, Arden, Vale, and Sol are available, with Vale as default.
- Select a built-in voice and request a spoken DJ station. Expected: Pockedio prepares DJ voice without requiring Fish TTS.
- Select Fish TTS / Mina or Nova. Expected: Pockedio asks for Fish runtime details only in that advanced path.
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
4. Add direct session bypass for non-TTY and explicit session flags.
5. Add automated tests for routing, readiness, setup surfaces, and non-TTY behavior.
6. Run the manual acceptance checks listed above.
