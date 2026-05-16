# Leondio Product Requirements

## Core Modes

### 1. User-Active Playback

The user can ask Leondio to play music, either generally or with a specific intent, genre, or activity. Example inputs include "play some music", "play some jazz", "play pure meditation music", or "play something for deep work".

For the first CLI version, Leondio should create a five-song playlist and start real playback through NetEase Cloud Music.

User-active playback must not trigger DJ voice mode. In this mode, Leondio can show concise text rationale in the terminal, but it should not synthesize or play DJ speech.

### 2. Leondio-Active Morning DJ

Every weekday at 8:45 AM, Leondio should generate a morning DJ audio segment and start the day with music.

The morning DJ should use:

- weather for the user's living location
- Apple Calendar context for the day
- diary summaries from the past few days, if the user has granted diary access
- taste memory from imported music data, `taste.md`, and listening feedback

The morning segment should feel like a personal radio host: concise, contextual, and musically useful. It should not over-explain private source material.

### 3. Leondio-Active Evening DJ

Every weekday at 5:00 PM, Leondio should generate an evening DJ audio segment and offer or start a station for transition, decompression, commute, or continued focus.

The evening DJ should use:

- the day's Apple Calendar context
- weather and time-of-day context
- recent mood check-ins and playback feedback
- diary summaries only when explicitly allowed

The evening segment is the second allowed DJ voice moment. Outside the weekday 8:45 AM and 5:00 PM active DJ windows, Leondio should avoid spoken DJ audio unless the user explicitly changes this rule later.

### 4. Mood Check-In Suggestions

When the Leondio server is active, it should check mood on an hourly basis or around meaningful context changes. It should not claim to know the user's real-time mood without a user signal.

Mood check-ins should be lightweight. Leondio can ask the user to choose or describe the current mood, then suggest music based on that answer plus calendar, time, weather, and taste memory.

Mood check-ins should suggest music first. Playback should require user confirmation unless the user later enables an automatic-play rule.

## Accepted Additional Requirements

### Taste Import Flow

Leondio should support importing favorite tracks, liked playlists, and historical playlist data from multiple music apps. Imported data should seed a generated `taste.md` draft, which the user can edit.

### Feedback Controls

During playback, Leondio should support feedback actions such as:

- like
- skip
- ban
- more like this
- change vibe

These actions should update future station generation and taste memory.

### Privacy Contract

Diary access must be explicit and local-first. Leondio should not read raw diary files by default. When diary information is used, Leondio should prefer summarized patterns over raw entries and should be able to explain which source categories influenced a recommendation.

### Fallback Mode

If NetEase Cloud Music cannot play a track because of API failure, login state, region, membership, copyright, or unavailable URL, Leondio should degrade gracefully. It should skip the unavailable track, replace it when possible, or still provide the playlist and rationale rather than failing the whole session.

### Session Memory

Leondio should save each station session with:

- user input or trigger reason
- generated playlist
- playback results
- feedback actions
- summarized calendar, weather, and mood context used for the session

### Interrupt Rules

Leondio-active behavior should respect quiet hours, calendar events, focus periods, and sleep or rest assumptions. It should not interrupt meetings or other blocked calendar time.

### Success Criteria

The first CLI demo is successful if:

- user-active playback starts within 30 seconds after a simple request
- Leondio creates a five-song playlist
- at least three of the five songs feel aligned with the user's stated intent
- unavailable songs do not crash the session
- weekday DJ voice is limited to the 8:45 AM and 5:00 PM active DJ moments
