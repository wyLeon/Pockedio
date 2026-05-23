# Pockedio Terminal Design System

This document defines a unified terminal UI language for Pockedio. It is designed for real macOS Terminal-compatible output: ANSI color, bold/dim text, Unicode blocks, cursor movement, alternate-screen redraws, and simple timed spinners.

The goal is not to make the CLI look like a web app. The goal is to make Pockedio feel like a calm, high-end music player inside a terminal.

## Principles

1. **Music first**
   The most important surfaces are playback, queue, favorites, and scheduled DJ arrival. Visual hierarchy should make the current track and next action obvious.

2. **Terminal-native**
   Use terminal cells, rows, dividers, rails, Unicode blocks, and ANSI color. Avoid browser-only effects such as radial glow, blur, smooth cursor-follow gradients, and floating cards.

3. **One system, multiple states**
   Favorite lists, loading, playback, and scheduled DJ arrival are not separate styles. They are states built from the same row, section, status, and queue components.

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
NEXT HANDOFF
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
2/5  Blue in Green - Miles Davis                  02:18 / 05:37
▰▰▰▰▰▰▱▱▱▱▱▱▱▱▱  late-night modal jazz, low brightness

NEXT HANDOFF
3/5  My Little Brown Book - John Coltrane         ready
why  keeps the room slow, adds tenor warmth

QUEUE
1    Autumn Leaves - Bill Evans                   played
2    Blue in Green - Miles Davis                  now
3    My Little Brown Book - John Coltrane         next
4    Skylark - Ella Fitzgerald
5    What Are You Doing The Rest Of Your Life?
```

Rules:

- The current song is the strongest visual element.
- The next song is visible and prepared, but secondary.
- Explain the handoff briefly when useful.
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
5. Support reduced motion by disabling spinner animation or lowering frame rate.
6. Never rely on mouse input for core flows.
7. Use plain text output for logs, pipes, and tests.

## MVP Order

1. Playback state: five-song arc, current/next/queue.
2. Selection state: favorite list and queue browser.
3. Loading state: named stages with premium Mina/DJ tone.
4. Scheduled DJ arrival: choice state with expiration and preview.

This order improves real daily use before polishing rarer states.
