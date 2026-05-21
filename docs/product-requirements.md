# Pockedio Product Requirements

## Core Modes

### 1. Conversational DJ Session

The primary v1 interface should be a conversational terminal DJ session, not a command-first CLI. The user should be able to talk to Pockedio in natural language, share thoughts, describe mood, ask for music, react to the current track, or request a change in direction.

The normal entry point should be `pockedio`, which opens the DJ conversation. Fixed commands should exist for setup, background jobs, imports, and status, but the core product experience should feel like talking to a personal DJ.

Pockedio should interpret natural language into internal actions such as:

- generating a five-song station
- adjusting the current vibe
- skipping, liking, banning, or asking for more like the current track
- creating a DJ-like audio segment when explicitly requested
- updating mood and session memory
- explaining a station choice briefly
- starting or stopping playback

Pockedio should respond with DJ-like written copy in the terminal. It should be concise, music-first, and personal without becoming verbose.

Pockedio should also support open conversation about music. The user and Pockedio can talk about a song, artist, album, scene, genre, or musical moment, including extended context such as cultural background, politics, philosophy, history, or personal meaning when the conversation naturally goes there.

The user can say "play it directly" or an equivalent phrase to skip discussion and move straight into playback. In that case, Pockedio should stop elaborating and start the relevant music as directly as possible.

Pockedio should decide whether to ask a follow-up, continue discussion, suggest music, or start playback based on the conversation context. The product should not force every user sentence into a fixed command pattern.

### 2. User-Active Playback

The user can ask Pockedio to play music, either generally or with a specific intent, genre, or activity. Example inputs include "play some music", "play some jazz", "play pure meditation music", or "play something for deep work".

For the first CLI version, Pockedio should create a five-song playlist and start real playback through NetEase Cloud Music.

User-active playback must not trigger DJ voice mode by default. In this mode, Pockedio can show concise text rationale in the terminal, but it should not synthesize or play DJ speech unless the user explicitly asks Pockedio to create a DJ-like audio segment.

### 3. Pockedio-Active Morning DJ

Every weekday at the configured Morning DJ ready time, Pockedio should announce that the morning DJ program is ready. It should prepare the spoken opening before arrival, 20 minutes before the ready time by default, so the ready-time prompt can reuse prepared audio instead of generating on the slow path. Scheduled FishAudio preparation may run for up to 10 minutes because it happens before arrival. It should not start audio by itself. The terminal prompt should let the user press Enter to play now, type `later` to keep the program available, or type `skip` to dismiss it. A scheduled morning program expires six hours after the configured ready time.

For MVP, a scheduled DJ program means a context-aware spoken host opening plus a five-track station. It still shows the lineup and normal now-playing surface in the terminal once playback starts. Compared with a normal five-song station, the difference is that the station is scheduled, uses morning/evening context, and starts with the selected DJ voice when FishAudio succeeds.

Scheduled morning suggestion logic should prioritize the first useful listening arc of the day: focus, energy, weather, calendar pressure, diary state, and user taste. It should still resolve exactly five real playable tracks through the shared station engine.

The morning DJ should use:

- weather for the user's living location
- current-date Apple Calendar context
- the latest diary entry plus diary memory, if the user has granted diary access
- taste memory from imported music data, `taste.md`, and listening feedback

The morning segment should feel like a personal radio host: concise, contextual, and musically useful. It should not over-explain private source material.

The user is the listener, not the reviewer of the generated file. The prompt is playback consent, not content approval. Only after the user confirms should Pockedio play the DJ audio and start the music station.

### 4. Pockedio-Active Evening DJ

Every weekday at the configured Evening DJ ready time, Pockedio should announce that the evening DJ program is ready. It should prepare the spoken opening before arrival, 20 minutes before the ready time by default, so the ready-time prompt can reuse prepared audio instead of generating on the slow path. Scheduled FishAudio preparation may run for up to 10 minutes because it happens before arrival. It should not start audio by itself. The terminal prompt should let the user press Enter to play now, type `later` to keep the program available, or type `skip` to dismiss it. A scheduled evening program expires six hours after the configured ready time.

The evening program has the same MVP shape: a short spoken DJ opening, then a visible five-track station with normal playback controls and queue display.

Scheduled evening suggestion logic should prioritize transition out of the workday: decompression, commute, remaining focus, weather, calendar residue, diary state, and user taste. It should still resolve exactly five real playable tracks through the shared station engine.

The evening DJ should use:

- current-date Apple Calendar context
- weather and time-of-day context
- recent mood check-ins and playback feedback
- diary summaries only when explicitly allowed

The evening segment is the second scheduled DJ voice moment. Outside enabled scheduled DJ windows, Pockedio should avoid spoken DJ audio unless the user chooses a spoken DJ station/program before playback starts.

### 5. User-Requested DJ Program Audio

The user can choose a spoken DJ version after Pockedio shapes a station. This is a before-playback fork, not a standalone voice-clip command.

When this happens, Pockedio should generate station/program DJ copy, synthesize it through the local Fish TTS model, and start only after the user confirms playback. This mode is opt-in and should not be inferred from a normal "play music" request.

Standalone 10-15 second DJ voice clips should not be generated; they add latency and routing complexity without a meaningful listening payoff.

### 6. Automatic Mood Check-In Suggestions

When the Pockedio server is active, it should prompt the user for a mood check on an hourly basis or around meaningful context changes. It should not claim to know the user's real-time mood without a user signal.

Mood check-ins should be lightweight and option-based. Pockedio should present a small set of mood options for the user to pick from, with an optional free-text override. After the user chooses, Pockedio should suggest music based on that answer plus calendar, time, weather, and taste memory.

Mood check-ins are automatic app jobs, not commands the user has to type manually. They should suggest music first. Playback should require user confirmation unless the user later enables an automatic-play rule.

## Product Voice

Pockedio should behave and write like a personal radio DJ, not a cold terminal utility. Even in the CLI, its text should feel concise, warm, and intentional.

This applies to:

- playlist introductions
- mood check prompts
- playback feedback confirmations
- fallback messages when a song cannot play
- scheduled DJ setup/status text

The product voice should stay music-first. It should not become chatty, sentimental, or verbose. User-active playback still should not synthesize DJ voice audio by default, but terminal copy should carry the DJ personality.

Pockedio should speak in English by default. This applies to spoken DJ audio and the default terminal DJ voice. The user can still talk naturally in another language, and future versions may add explicit language switching.

## DJ Personas And Schedule

Pockedio should support multiple DJ styles or personalities. These personas should affect DJ copy, spoken delivery style, music framing, and the kinds of contextual references the DJ naturally makes.

Different DJ personas should have a fixed schedule on different days. Scheduled Morning DJ and Evening DJ jobs should select the persona from this schedule, so the weekly rhythm feels intentional instead of random.

The first implementation should keep persona behavior configurable and simple: a persona name, language, tone notes, music bias notes, and scheduled days. The exact persona lineup can be edited later without changing the product model.

## Command Philosophy

Commands are operational entry points, not the main user experience. The v1 command surface should stay small:

- `pockedio`: enter the conversational DJ session
- `pockedio serve`: run scheduled jobs, including configured weekday Morning DJ, configured weekday Evening DJ, and automatic mood check prompts
- `pockedio setup`: configure NetEase Cloud Music, Fish TTS, Apple Calendar, weather location, diary permission, user personality profile, and database
- `pockedio import-taste <file>`: import exported music app data
- `pockedio status`: check playback, scheduled jobs, and service health

Natural-language requests inside the DJ session should replace command-first interactions such as `play`, `mood`, or `feedback`.

## Accepted Additional Requirements

### Taste Import Flow

Pockedio should support importing favorite tracks, liked playlists, and historical playlist data from multiple music apps. Imported data should seed a generated `taste.md` draft, which the user can edit.

### Feedback Controls

During playback, Pockedio should support feedback actions such as:

- like
- skip
- ban
- more like this
- change vibe

These actions should update future station generation and taste memory.

### Privacy Contract

Diary access must be explicit and local-first. Pockedio should not read raw diary files by default. When diary information is used, Pockedio should prefer summarized patterns over raw entries and should be able to explain which source categories influenced a recommendation.

### Fallback Mode

If NetEase Cloud Music cannot play a track because of API failure, login state, region, membership, copyright, or unavailable URL, Pockedio should degrade gracefully. It should skip the unavailable track, replace it when possible, or still provide the playlist and rationale rather than failing the whole session.

### Session Memory

Pockedio should save every word in every session locally. Text is cheap to store, and the full conversation is part of the product memory.

Each session should store:

- full user messages and Pockedio responses
- user input or trigger reason
- generated playlist
- playback results
- feedback actions
- summarized calendar, weather, and mood context used for the session

### User Personality Profile

During setup, Pockedio should optionally record the user's self-declared MBTI type. This is not required for the first working playback demo, but it should be part of the long-term personalization model.

MBTI should be treated as a strong interaction reference for DJ behavior: how much explanation to give, how direct or exploratory the DJ should be, how it frames choices, and how it balances emotional resonance against practical usefulness. It should not override explicit user instructions, recent mood, playback feedback, or actual taste data.

Pockedio should not infer or assign an MBTI type without the user providing it. The user should be able to leave it unset, update it, or remove it later.

### Context And Long-Term Memory

Apple Calendar should be read for the current date in both the morning and afternoon active DJ scenes. Pockedio should not treat the two reads as identical: the user's status, attitude, and remaining agenda may change between morning and afternoon.

Pockedio should maintain memory about the user's agendas over time. Session memory can be one source for this, but agenda memory should become a durable long-term context layer so Pockedio can understand recurring work patterns, important projects, meeting-heavy days, and transitions between obligations.

Morning DJ should read the latest diary entry when diary access is granted. Pockedio should also maintain memory about diary themes over time, so it can understand recent emotional context without repeatedly exposing raw diary text to every generation step.

Long-term context should be stored permanently in the database. This includes agenda memory, diary memory, taste memory, user personality profile, session memory, playback feedback, and generated summaries. Human-readable files such as `taste.md` can remain editable surfaces, but the product should not rely on files alone for durable memory.

### Interrupt Rules

Pockedio-active behavior should respect quiet hours, calendar events, focus periods, and sleep or rest assumptions. It should not interrupt meetings or other blocked calendar time.

### Success Criteria

The first CLI demo is successful if:

- user-active playback starts within 30 seconds after a simple request
- Pockedio creates a five-song playlist
- at least three of the five songs feel aligned with the user's stated intent
- unavailable songs do not crash the session
- DJ voice appears only in enabled scheduled DJ moments or when the user explicitly requests DJ-like audio
- DJ audio outputs are played directly and do not require a user review step
- scheduled DJ jobs use the persona assigned to that day
- spoken DJ audio and default terminal DJ output use English by default
