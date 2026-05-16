# Pockedio v1 Design

## Purpose

Pockedio v1 is a CLI-first personal AI music radio. The product should feel like talking to an LLM-powered personal DJ in the terminal, not like operating a cold command-line utility. The first version exists to prove the core loop: understand the user's intent and context, generate a five-song station, play real music, remember the session, and use that memory to improve future choices.

The later web app should preserve the same behavior contract. The CLI is the proving ground for the product experience, not a throwaway technical demo.

## Scope

V1 builds a local, single-user product for Leon. It includes:

- conversational terminal DJ session
- real playback through NetEase Cloud Music
- five-song station generation
- scheduled weekday DJ moments at 8:45 AM and 5:00 PM
- explicit user-requested DJ audio through local Fish TTS
- multiple configurable DJ personas with fixed day schedules
- English as the default DJ language
- automatic mood check prompts while the app server is active
- Apple Calendar current-date context
- weather context for the user's living location
- diary access after explicit permission, including latest diary use for Morning DJ
- optional self-declared MBTI type as a user personality profile
- taste import from exported music app data
- editable `taste.md` as a human-readable taste surface
- local database-backed long-term memory
- full local transcript storage for every session
- graceful fallback when playback or external context fails

## Non-Scope

V1 does not build:

- web app UI
- mobile app
- multi-user accounts
- public hosting or deployment
- social sharing
- automatic mood inference without user signal
- always-on voice conversation
- spoken DJ audio for ordinary playback requests
- commercial billing, analytics, or onboarding flows

## Product Model

Pockedio has two layers:

1. **Conversation layer**: what the user experiences. The user talks naturally with a personal DJ, can discuss music and its wider context, can request playback, can react to tracks, and can say "play it directly" to skip discussion.
2. **Action layer**: what the system performs internally. Pockedio searches for songs, builds a station, plays audio, records feedback, reads context, updates memory, generates DJ copy, synthesizes DJ audio, and handles scheduled jobs.

The user should mostly live in the conversation layer. Fixed CLI commands exist for operational entry points only.

## Command Surface

The v1 command surface stays small:

- `pockedio`: enter the conversational DJ session.
- `pockedio serve`: run scheduled jobs, including weekday 8:45 AM DJ, weekday 5:00 PM DJ, and automatic mood check prompts.
- `pockedio setup`: configure NetEase Cloud Music, Fish TTS, Apple Calendar permission, weather location, diary permission, user personality profile, and the local database.
- `pockedio import-taste <file>`: import exported music app data and update taste memory.
- `pockedio status`: show playback state, scheduled job state, and service health.

Commands such as `play`, `mood`, and `feedback` are not primary commands. They are natural-language intents inside the `pockedio` DJ session.

## Conversational DJ Session

The normal user experience starts with `pockedio`. Inside the session, the user can:

- ask for music directly
- describe mood or intent
- share thoughts about the current song
- discuss an artist, scene, genre, album, or musical moment
- extend the discussion into cultural background, politics, philosophy, history, or personal meaning when relevant
- say "play it directly" or equivalent to skip discussion and start playback
- react to the current track with feedback
- ask for a vibe change
- ask for a DJ-like audio segment

Pockedio should decide from context whether to:

- continue conversation
- ask one follow-up question
- suggest a station
- start playback
- adjust the current station
- store feedback or memory
- generate explicit DJ audio

It should not force every user sentence into a rigid command pattern.

## Product Voice

Pockedio should write like a concise personal radio DJ. It should be warm, musical, and intentional without becoming verbose or sentimental. It can use music language, scene-setting, and light rationale, but the product remains music-first.

This voice applies to:

- station introductions
- mood check prompts
- feedback confirmations
- unavailable-song fallbacks
- setup and status text
- scheduled job messages

Ordinary text personality does not imply spoken DJ audio. Fish TTS DJ voice audio is limited to specific allowed cases.

English is the default language for spoken DJ audio and terminal DJ copy. The user can write naturally in another language, but unless a later preference overrides it, Pockedio's DJ output should default to English.

## DJ Personas

Pockedio should support multiple DJ personas. A persona is a scheduled DJ style that shapes tone, references, music framing, and spoken delivery without changing the core product rules.

Each persona should define:

- name
- default language
- tone notes
- music bias notes
- contextual reference style
- scheduled days

Scheduled Morning DJ and Evening DJ jobs should select the active persona from a fixed weekly schedule. This makes different days feel intentional and gives the product a radio-programming rhythm.

V1 does not need a large persona library. It needs the model and configuration shape to support multiple personas from the start.

## User Personality Profile

Pockedio should support an optional user personality profile collected during setup. The first profile field should be the user's self-declared MBTI type.

The MBTI type is not a music taste source by itself. It should be a major interaction reference for the DJ: how direct the DJ should be, how much context it should offer, whether it should lead with practical structure or emotional atmosphere, and how exploratory the conversation should feel.

MBTI must stay subordinate to explicit user instructions, recent session context, mood checks, playback feedback, and imported taste data. Pockedio should never infer MBTI from diary entries, messages, or listening behavior unless the user explicitly asks for that kind of reflection later.

## Playback Behavior

For user-active playback, Pockedio generates a five-song station and starts real playback through NetEase Cloud Music. User-active playback does not synthesize spoken DJ voice by default.

The target acceptance behavior is:

- user asks naturally for music
- Pockedio understands the intent
- Pockedio generates five tracks
- Pockedio starts playback within 30 seconds in the successful path
- Pockedio records session context and playback results

During playback, natural user replies can become feedback:

- like
- skip
- ban
- more like this
- change vibe
- stop

The feedback should update session memory and future taste decisions.

## DJ Voice Audio Rules

Spoken DJ audio is allowed only in three cases:

1. Weekday 8:45 AM Morning DJ.
2. Weekday 5:00 PM Evening DJ.
3. The user explicitly asks Pockedio to create a DJ-like audio segment.

When DJ audio is generated, it is final output for the user, not an artifact for review. Pockedio should synthesize it through the local Fish TTS model and play the generated audio file directly.

The generated DJ copy should use the active persona. For user-requested DJ audio, the current session persona should be used unless the user asks for a specific style.

## Scheduled DJ Jobs

Scheduled DJ jobs are cron-like behavior managed by `pockedio serve`, not normal commands the user types.

### Morning DJ

Every weekday at 8:45 AM, Pockedio should:

1. Read current-date Apple Calendar context.
2. Read weather for the user's living location.
3. Read the latest diary entry if diary access is granted.
4. Combine durable diary memory, agenda memory, taste memory, and recent feedback.
5. Select the scheduled DJ persona for the day.
6. Generate concise morning DJ copy in English by default.
7. Synthesize the copy through Fish TTS.
8. Play the generated DJ audio directly.
9. Start music.

### Evening DJ

Every weekday at 5:00 PM, Pockedio should:

1. Read current-date Apple Calendar context again.
2. Treat afternoon context as different from morning context because the user's status, attitude, and remaining agenda may have changed.
3. Read weather and time-of-day context.
4. Use recent mood check-ins and playback feedback.
5. Use diary summaries only when explicitly allowed.
6. Select the scheduled DJ persona for the day.
7. Generate concise evening DJ copy in English by default.
8. Synthesize the copy through Fish TTS.
9. Play the generated DJ audio directly.
10. Start music for transition, decompression, commute, or continued focus.

## Mood Check Jobs

When `pockedio serve` is active, Pockedio should prompt the user for mood check-ins hourly or around meaningful context changes. Mood checks are app-initiated jobs, not typed commands.

The prompt should offer a small set of mood options with an optional free-text override. Pockedio should not claim to know the user's real-time mood without a user signal. After the user chooses, Pockedio suggests music based on mood, calendar, time, weather, taste memory, and recent session memory.

Mood check suggestions require confirmation before playback unless the user later enables an automatic-play rule.

## Data Sources

V1 uses these sources:

- NetEase Cloud Music for search and real playback.
- Apple Calendar for current-date agenda context.
- Weather for the user's living location.
- Local Fish TTS for DJ voice generation.
- Exported music app data for taste import.
- `taste.md` as editable human-readable taste memory.
- Diary files after explicit permission.
- Local database for durable memory.
- DJ persona schedule configuration.

## Taste Intelligence

Taste learning starts from imported music app data because the user may not be able to describe their exact taste manually. Imports should seed taste memory and draft or update `taste.md`.

Taste memory should combine:

- exported favorites and playlists
- high-confidence artists, songs, genres, moods, and eras
- negative constraints
- situational preferences
- listening feedback
- diary-derived context summaries
- session history

Raw imports should be kept separate from derived summaries so taste memory can be regenerated later.

## Diary And Calendar Memory

Apple Calendar should be read for the current date in both scheduled DJ scenes. Pockedio should also maintain agenda memory over time, using session memory and generated summaries to understand recurring work patterns, meeting-heavy days, important projects, and transitions between obligations.

Morning DJ should read the latest diary entry when diary access is granted. Pockedio should also maintain durable diary memory, so it can understand recent emotional context without repeatedly exposing raw diary text to every generation step.

Diary access is explicit and local-first. Pockedio should prefer diary summaries and memory over raw diary reuse whenever possible.

## Memory Contract

Pockedio stores every word in every session locally. Full user messages and Pockedio responses are part of the product memory.

The local database should permanently store:

- full conversation transcripts
- station sessions
- generated playlists
- playback results
- user feedback
- mood check selections
- summarized calendar context
- agenda memory
- diary memory
- taste memory
- user personality profile
- generated summaries
- DJ audio metadata

Human-readable files such as `taste.md` can remain editable surfaces, but they are not the only durable store.

## Privacy Rules

Pockedio is local-first. Sensitive sources should not be read silently.

Rules:

- Diary access requires explicit permission.
- Raw diary text should not be repeatedly passed into generation when a summary or durable memory is enough.
- Calendar context should be summarized for station generation.
- Pockedio should be able to explain which source categories influenced a recommendation.
- Full session transcripts are stored locally because the user explicitly wants every word saved.
- External service failures should not leak private context in logs.

## Failure Behavior

Pockedio should degrade gracefully:

- If NetEase search fails, explain briefly and do not crash the session.
- If a song URL is unavailable because of copyright, membership, region, login, or API failure, skip or replace it when possible.
- If real playback fails for the whole station, still provide the planned playlist and rationale.
- If Apple Calendar is unavailable, use memory and ask for current context if needed.
- If diary access is unavailable, proceed without diary context.
- If weather is unavailable, proceed with time and calendar context.
- If Fish TTS fails, scheduled DJ jobs should show the DJ copy in text and continue to music when appropriate.

## Architecture Boundaries

The design implies these boundaries for later implementation planning:

- conversation orchestrator
- station generator
- music provider adapter
- player
- scheduler
- mood check job
- calendar adapter
- weather adapter
- diary reader and summarizer
- taste importer
- memory store
- Fish TTS adapter
- DJ persona scheduler
- product voice layer

The exact file structure and library choices are deferred to the implementation plan after technical spikes.

## Technical Spikes Required Before Implementation

Before full implementation, validate:

1. NetEase Cloud Music login, search, playable URL retrieval, playback reliability, unavailable-track behavior, and API limits.
2. Fish TTS local invocation path, model name, output format, generation latency, and playback command.
3. Apple Calendar local access path and permission model.
4. Weather API and location configuration.
5. Local database choice and transcript storage format.
6. First supported music app export format for taste import.
7. DJ persona schedule configuration shape and default persona set.

## Acceptance Criteria

V1 is acceptable when:

- `pockedio` opens a conversational DJ session.
- The user can ask naturally for music and Pockedio starts a five-song station.
- In the happy path, playback begins within 30 seconds of a simple request.
- At least three of five generated songs feel aligned with the stated intent.
- User-active playback does not synthesize DJ voice unless explicitly requested.
- Explicit DJ audio requests generate and directly play Fish TTS audio.
- Weekday 8:45 AM and 5:00 PM scheduled jobs generate DJ audio, play it directly, and start music.
- Scheduled DJ jobs use the persona assigned to that day.
- DJ spoken output defaults to English.
- Mood checks are automatic app prompts with options, not user-typed commands.
- Calendar, weather, diary, taste, mood, playback, and feedback context are captured in memory.
- Every session message is stored locally.
- Unavailable songs and failed external context sources do not crash the session.
