# Pockedio Terminal Design System

This document defines a unified terminal UI language for Pockedio. It is designed for real macOS Terminal-compatible output: ANSI color, bold/dim text, Unicode blocks, cursor movement, alternate-screen redraws, and simple timed spinners.

The goal is not to make the CLI look like a web app. The goal is to make Pockedio feel like a calm, high-end music player inside a terminal.

The current interactive session and playback surface are the reference implementation. New setup, selection, scheduled DJ, memory, and status pages should reuse these primitives instead of inventing page-specific visual styles.

## Principles

1. **Music first**
   The most important surfaces are playback, queue, favorites, and scheduled DJ arrival. Visual hierarchy should make the current track and next action obvious.

2. **Terminal-native**
   Use terminal cells, rows, dividers, rails, Unicode blocks, and ANSI color. Avoid browser-only effects such as radial glow, blur, smooth cursor-follow gradients, and floating cards.

3. **One system, multiple states**
   Conversation, submitted user turns, favorite lists, loading, playback, and scheduled DJ arrival are not separate styles. They are states built from the same prompt, row, section, status, and queue components.

4. **Quiet premium**
   Pockedio should feel restrained and intentional: high contrast where the user must decide, muted detail elsewhere, warm accents for Mina/DJ moments.

5. **No dead air**
   Any operation longer than a short instant should show what is happening. Loading copy should be specific: reading context, building station, preparing voice, resolving playback.

## Terminal Capability Boundary

Pockedio may rely on:

- ANSI foreground/background colors
- bold, dim, reverse, and reset styles
- 256-color palettes where available
- Unicode block characters for progress and meters
- alternate-screen TUI redraws for richer screens
- cursor movement and line clearing
- timed spinner frames
- keyboard navigation
- optional mouse reporting only where supported

Pockedio should not rely on:

- smooth pixel-level cursor-follow glow
- CSS-like blur, gradients, or shadows
- arbitrary animation curves
- hover-only interactions
- mouse tracking as the only way to use a screen

## Color Tokens

| Token | Purpose | Approximate color |
| --- | --- | --- |
| `surface.base` | terminal background | near black charcoal |
| `surface.panel` | grouped screen body | dark green-charcoal |
| `text.primary` | important content | warm ivory |
| `text.secondary` | supporting content | muted sage gray |
| `text.dim` | metadata and inactive labels | dim gray-green |
| `accent.primary` | normal selection and confirmation | warm green |
| `accent.playback` | now-playing and progress | muted cyan |
| `accent.dj` | Mina, DJ program, premium loading | muted gold |
| `accent.danger` | cancel, failed playback, unavailable | soft red |

Rules:

- Use green for normal selection and success.
- Use cyan for active playback and progress.
- Use gold for Mina, DJ, scheduled program, and premium loading.
- Use red only for failure, cancellation, or destructive choices.
- Do not create one-off accent colors per feature.

## Text Hierarchy

| Level | Use |
| --- | --- |
| `title` | screen title or major state, one line |
| `section` | uppercase group labels such as `NOW PLAYING`, `NEXT`, `QUEUE` |
| `primary row` | selected row, current track, current choice |
| `secondary row` | normal list items |
| `dim metadata` | time, index, status tags, already-played rows |
| `note` | Mina note, rationale, warning, or fallback |

Rules:

- Keep rows short enough to scan.
- Truncate long titles with ellipsis in fixed-width layouts.
- Avoid paragraphs inside active playback surfaces.
- Put explanation in a `note` area, not inside every row.

## Core Components

### `TuiPrompt`

The active input prompt is a single live marker:

```text
›
```

Rules:

- Use `›` only for active input and submitted user turns.
- Do not use `>` for new interactive surfaces.
- Do not add helper text beside the prompt in normal conversation mode.

### `TuiSubmittedUserTurn`

After Enter, the user's submitted input becomes a transcript item. It is not left as raw terminal echo.

No-color fallback:

```text
› favorite the first song
```

TTY/color form:

```text
▌ ›  favorite the first song
```

Rules:

- Clear the raw readline echo before rendering the submitted block in TTY mode.
- Keep the submitted block visually quieter than playback rows but stronger than plain prose.
- Do not render a submitted block for empty Enter.
- Normalize copied prompt markers, so `› favorite 1` is displayed once as `› favorite 1`.

### `TuiReply`

Normal Mina replies use bullet-led prose, not a `MINA reply` label:

```text
● This song is a live recording with a quiet emotional center.
```

Rules:

- Use this for conversation, questions, confirmations, refusals, and lightweight recommendations.
- Wrap continuation lines with a small hanging indent.
- Do not use the DJ note band for normal replies.
- Do not use playback-colored rows for normal replies.

### `TuiDjNote`

DJ mode, station intros, playback notes, and spoken-program copy use a labeled note band:

```text
MINA  DJ note
This opens the set with warm, low-pressure motion.
```

Rules:

- Use only when the content is DJ/program/playback narration.
- Keep it distinct from normal Mina replies.
- Prefer gold accent.

### `TuiFrame`

The top-level terminal screen container. In a normal REPL, this may be a compact block of lines. In alternate-screen mode, it owns the full redraw.

Required fields:

- title or state label
- optional mode tag, such as `DJ`, `QUEUE`, `FAVORITES`
- body rows

### `TuiSectionLabel`

An uppercase label that separates groups:

```text
NOW PLAYING
QUEUE
CHOOSE
```

Use gold for section labels unless the entire screen is playback-only, where cyan is acceptable.

### `TuiRow`

Base row shape:

```text
<left label>  <main text>                         <right meta>
```

Examples:

```text
2/5  Blue in Green - Miles Davis                  02:18 / 05:37
why  keeps the room slow, adds tenor warmth
```

### `TuiSelectedRow`

The selected row must be visually stronger than a plain background strip:

- bright foreground
- bold text
- dark colored background
- left rail using the relevant accent
- optional subtle divider line

Use this for keyboard focus, current menu choice, and selected list item.

### `TuiProgress`

Use Unicode blocks and a fixed width:

```text
▰▰▰▰▰▰▱▱▱▱▱▱▱▱▱
```

Use cyan for playback progress. Use green or gold for loading depending on state.

### `TuiSpinner`

Use simple, terminal-safe frames:

```text
◐ ◓ ◑ ◒
```

or a premium static/pulsing marker where animation is limited:

```text
◆ Reading your listening context
```

Avoid excessive motion. In reduced-motion mode, keep the marker static and update text only when the stage changes.

### `TuiActionMenu`

Use for scheduled DJ arrival and confirmation states:

```text
↵  Play now
L  Later, keep available
S  Skip this program
Q  Preview queue
```

The default action should be selected with `TuiSelectedRow`.

### `TuiQueue`

The five-song queue should always distinguish:

- played
- now
- next
- remaining
- unavailable or failed

Example:

```text
1  Autumn Leaves - Bill Evans                     played
2  Blue in Green - Miles Davis                    now
3  My Little Brown Book - John Coltrane           next
4  Skylark - Ella Fitzgerald
5  What Are You Doing The Rest Of Your Life?
```

## State Designs

### Conversation State

Use during the normal REPL session.

Design:

```text
▌ ›  Want some comforting music to soothe me.

● Given the humid afternoon heat in Guangzhou and your need for comfort, try the gentle
  ambient washes of Music for Airports by Brian Eno. Shall I build this station or play it for you?

Press Enter to play it, type "dj" for a spoken DJ version, or tell me how to adjust it.

›
```

Rules:

- The live prompt and submitted turn are separate states.
- The submitted turn is the official transcript item.
- Mina's response uses `TuiReply` unless playback or DJ narration starts.
- Follow-up hints are plain prose, not selected rows.
- Keep enough vertical space between submitted user turns, replies, and the next prompt.

### Selection And List State

Use for:

- favorite songs
- queue browsing
- setup choices
- search results
- scheduled DJ choices

Design:

- `TuiFrame`
- `TuiSectionLabel`
- list rows
- one `TuiSelectedRow`
- compact action hints

Primary accent: green.

### Setup Page Template

Use for setup, provider, context, memory, voice, FishAudio, and scheduled DJ pages.

Design:

```text
VOICE SETUP

● Built-in macOS voice is ready. Fish TTS can add Mina or Nova later.

CURRENT
Provider        Built-in macOS voice
Voice           Vale
Advanced        Fish TTS not configured

ACTIONS
▌ > 1. Choose DJ voice              preview Mina, Nova, or built-in voices
    2. Configure Fish TTS           enable generated Mina or Nova audio
    3. Use text-only DJ copy        keep DJ notes without spoken audio

↑↓ Select  |  Enter Open  |  1-3 Open  |  B Back  |  Q Quit
```

Rules:

- Title is uppercase and names the exact surface.
- Put one `●` summary line below the title.
- Use `CURRENT`, `STATUS`, `RESULT`, `UPDATED`, or `ACTIONS` section labels.
- Use the same selected-row grammar as playback and queue rows: `▌ >`.
- Keep setup descriptions concise. The action row should explain outcome, not teach the whole feature.
- Do not mix old title-case section labels such as `Actions:` or `Current config` into new setup pages.

### Status Page Template

Use for diagnostic status output.

Design:

```text
POCKEDIO STATUS

● Current runtime, setup, memory, and local data state.

RUNTIME
Playback   none
Session    2026-05-24T07:26:21.563Z
Schedule   Morning DJ weekdays 08:45

SETUP
Music     NetEase API reachable
LLM       gpt-4.1-mini
Voice     Mina, Fish TTS ready
Context   Calendar off, Weather Guangzhou

MEMORY
Config    ok
Database  ok
Taste     ok

LOCAL DATA
Local     /Users/example/.pockedio
External  NetEase, configured LLM, weather, and diary summaries may leave this machine when used.
```

Rules:

- Status is for diagnosis, not onboarding.
- Keep section names uppercase.
- Keep row labels aligned and stable so users can scan repeated checks.
- Details and warnings come after the main report.

### Loading State

Use for:

- reading context
- building station
- preparing DJ intro
- resolving playable URLs
- starting playback
- updating taste memory

Design:

```text
◆ Reading your listening context
│ calendar window: evening decompression
│ taste memory: late-night jazz, soft vocals, piano
◒ Preparing Mina's opening line
└ ███████████░░░░░ voice cache warming
```

Rules:

- Name the work being done.
- Show `Ctrl+C cancels this step only` where cancellation is available.
- Clear loading rows before final response in normal REPL mode.
- Keep loading copy calm and concrete.

Primary accent: gold for DJ/Mina work, green for normal local operations.

### Playback State

Use when music is playing.

Design:

```text
NOW PLAYING
2/5  Blue in Green - Miles Davis
[========>...........] 02:18 / 05:37

MINA  DJ note
Blue in Green keeps the room slow and reflective.

QUEUE
1    Autumn Leaves - Bill Evans                   played
2    Blue in Green - Miles Davis                  now
3    My Little Brown Book - John Coltrane         next
4    Skylark - Ella Fitzgerald
5    What Are You Doing The Rest Of Your Life?
```

Rules:

- The current song is the strongest visual element.
- The next song is visible in the queue, but secondary.
- Do not add a separate `UP NEXT` or `NEXT HANDOFF` section in the default playback surface.
- Explain the current track in the DJ note area, not inside the queue.
- Keep DJ voice separate from normal playback unless DJ mode is active.

Primary accent: cyan.

### Scheduled DJ Arrival State

Use when a scheduled DJ program is ready.

Design:

```text
◆ Morning DJ program is ready                     08:45
ttl Available for 6 hours, until 14:45 today
set 5 songs, prepared from calendar + taste + morning context

CHOOSE
↵  Play now
L  Later, keep available
S  Skip this program
Q  Preview queue
```

Rules:

- Do not auto-play on arrival.
- Make the expiration time human-readable.
- Default to `Play now`, but allow later/skip/preview.
- Keep the program available until expiration.

Primary accent: gold for arrival, green for selected action.

## Implementation Rules

1. Build a small renderer layer before spreading formatting across handlers.
2. Keep all color tokens in one place.
3. Keep row layout width-aware.
4. Provide a no-color fallback for non-TTY output.
5. Clear live status/loading rows before final replies in normal REPL mode.
6. Clear raw readline echo before rendering `TuiSubmittedUserTurn` in TTY mode.
7. Support reduced motion by disabling spinner animation or lowering frame rate.
8. Never rely on mouse input for core flows.
9. Use plain text output for logs, pipes, and tests.
10. New pages should first ask: can this be expressed with `TuiPrompt`, `TuiSubmittedUserTurn`, `TuiReply`, `TuiDjNote`, `TuiSectionLabel`, and `TuiRow`?

## MVP Order

1. Playback state: five-song arc, current/queue/DJ note.
2. Conversation state: live prompt, submitted user turn, Mina reply, pending-station hint.
3. Selection state: favorite list, queue browser, setup choices.
4. Loading state: named stages with premium Mina/DJ tone.
5. Scheduled DJ arrival: choice state with expiration and preview.

This order improves real daily use before polishing rarer states.

## Alignment Checklist

Use this checklist before adding or changing any CLI page:

- Does the page use `›` for live input?
- If the user submits text, is it re-rendered as `TuiSubmittedUserTurn` rather than left as raw echo?
- Is Mina speaking as a normal reply (`●`) or as DJ narration (`MINA DJ note`), and is that distinction intentional?
- Are selected rows using the same left rail and selected-row grammar?
- Are section labels uppercase and drawn from the shared accent roles?
- Are loading rows specific, cancellable when possible, and cleared before the final response?
- Does non-TTY output remain readable without ANSI color?
