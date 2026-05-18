# Pockedio v1 Acceptance Checklist

This checklist maps the approved v1 design criteria to implementation and verification evidence.

## Automated Verification

- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] `npm run build`

## Manual Setup

- [ ] Start NetEase API with `spikes/scripts/run_netease_api.sh`.
- [ ] Run `npm run dev -- setup`.
- [ ] Run `npm run dev -- import-taste spikes/fixtures/taste-normalized.csv`.
- [ ] Run `npm run dev -- status`.
- [ ] Confirm status reports NetEase, FishAudio, database, taste, personas, Calendar, weather, and latest session fields.

## Conversational Session

- [ ] `npm run dev` opens the conversational DJ session.
- [ ] Natural input such as `play something for deep work` is classified as playback intent.
- [ ] Pockedio generates exactly five station tracks.
- [ ] At least one track starts playback in the successful NetEase path, or unavailable tracks are reported without a crash.
- [ ] The session transcript is stored in SQLite.
- [ ] Station tracks and playback status/failure reasons are stored in SQLite.
- [ ] Ordinary playback does not call FishAudio and does not play spoken DJ audio.
- [ ] User feedback phrases such as `more like this`, `skip this`, and `never play this artist again` are stored as feedback.

## Explicit DJ Audio

- [ ] Input such as `make me a short DJ intro for tonight` maps to explicit DJ audio intent.
- [ ] Pockedio generates concise English DJ copy.
- [ ] FishAudio synthesizes local audio.
- [ ] Generated DJ audio plays directly without a review step.
- [ ] DJ audio text, audio path, and status are stored in SQLite.
- [ ] If FishAudio fails, Pockedio shows fallback text and records `text_fallback`.

## Scheduled DJ Jobs

- [ ] `npm run dev -- serve --run-once morning` generates Morning DJ copy.
- [ ] Morning DJ selects the weekday persona for the current date.
- [ ] Morning DJ builds context with Calendar, weather, diary summary when enabled, taste, memory, and MBTI profile.
- [ ] Morning DJ synthesizes FishAudio and plays it directly.
- [ ] Morning DJ starts music or handles unavailable tracks gracefully.
- [ ] Morning DJ stores text, audio metadata, context snapshot, station tracks, and playback metadata.
- [ ] `npm run dev -- serve --run-once evening` follows the same storage/audio/playback path.
- [ ] Evening DJ copy emphasizes remaining agenda, decompression, commute, continued focus, or transition.
- [ ] Scheduled jobs skip spoken audio if Calendar summary indicates an active meeting.
- [ ] `pockedio serve` avoids duplicate morning/evening jobs within the same date/time window.

## Mood Checks

- [ ] `npm run dev -- serve --run-once mood-check` prompts from the app.
- [ ] Mood options include focused, scattered, tired, restless, calm, heavy, and free text.
- [ ] Mood selection is stored in SQLite.
- [ ] Pockedio suggests music from the mood signal.
- [ ] Playback requires confirmation before starting.

## Context And Memory

- [ ] Apple Calendar context is summarized before use.
- [ ] Weather lookup is optional and does not crash if unavailable.
- [ ] Diary context is read only when explicitly enabled.
- [ ] Morning DJ uses only the latest diary summary when diary access is enabled.
- [ ] MBTI is optional, self-declared, and stored as personality context.
- [ ] MBTI is used as interaction context, not inferred from user content.
- [ ] `taste.md` is generated from imported music app data.
- [ ] Imported taste rows are also stored as durable database memory.
- [ ] Every user message and every Pockedio response is stored locally.

## Failure Behavior

- [ ] NetEase API unreachable produces a graceful status/playback failure instead of crashing.
- [ ] Missing playable song URLs stay in the station as unavailable entries.
- [ ] Apple Calendar unavailable returns an unavailable context summary.
- [ ] Weather unavailable returns `null` context and the session continues.
- [ ] FishAudio failure does not block text output or music when appropriate.

## Command Surface

- [ ] Public commands remain limited to `pockedio`, `pockedio setup`, `pockedio import-taste <file>`, `pockedio serve`, and `pockedio status`.
- [ ] Playback, mood, and feedback are natural-language intents inside the session, not extra public commands.

## Current Evidence

- Automated coverage includes config, database, personas, taste import, provider adapters, context adapters, voice rules, intent parsing, station generation, session runner, scheduler, and status command tests.
- Manual smoke checks should be re-run before tagging or merging v1.
