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

## Non-Goals

This design does not add:

- separate `Start Radio`, `Quick Station`, and `Scheduled DJ` top-level modes
- a deep nested settings hierarchy
- a replacement for existing scriptable commands such as `pockedio setup`, `pockedio status`, `pockedio serve`, or `pockedio import-taste`
- a Go/Bubble Tea rewrite by default
- a landing-page style screen

## Product Principle

The first-level page should not create hierarchy for hierarchy's sake. It should expose product readiness and give the user confidence about what will happen next.

`Quick Station` and `Scheduled DJ` are not separate first-level destinations. They are intents and behaviors inside the main DJ session or background scheduler.

## Welcome Hub Draft

```text
Pockedio

Personal AI DJ for context-aware listening

> Enter DJ Session        Talk, ask, play, reshape, queue, DJ mode
  Setup & Connections     NetEase, voice, calendar, weather, diary
  Taste & Memory          Import taste, review personalization inputs
  Status                  Playback, scheduler, health, version

Readiness
  NetEase       Connected
  Voice         Configured
  Taste         Imported
  Calendar      Enabled

↑↓ Select  |  Enter Open  |  S Setup  |  T Taste  |  V Version  |  Q Quit
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

NetEase         Connected
Voice           Configured
Calendar        Enabled
Weather         Shanghai
Diary           Not enabled

Actions:
> Run full setup
  Configure NetEase
  Configure Calendar
  Back
```

### Behavior

- `Run full setup` maps to existing setup flow.
- `Configure NetEase` maps to existing NetEase setup flow.
- `Configure Calendar` maps to existing Calendar setup flow.
- Do not add a new setup model unless a current setup gap blocks the surface.

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

## Open Questions

1. Should bare `pockedio` always open the Welcome Hub, or should it open only on first run / setup-incomplete states?
2. Should there be a flag such as `pockedio --session` or `pockedio --no-hub` for direct session entry?
3. Should the Welcome Hub be implemented with current Node dependencies first, or should we add a TUI library?
4. Which readiness fields are required for v1, and which can be best-effort?
5. Should `Taste & Memory` allow showing any stored memory, or only summary-level metadata?

## Suggested Review Order

1. Confirm the four entry points.
2. Confirm each destination surface.
3. Decide whether the hub appears always or conditionally.
4. Decide implementation technology.
5. Write the implementation plan.
