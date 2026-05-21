# Pockedio v1 Acceptance Checklist

This checklist maps the approved v1 design criteria to implementation and verification evidence.

## Automated Verification

- [x] `npm run typecheck`
- [x] `npm test`
- [x] `npm run build`

## Manual Setup

- [ ] Start NetEase API with `spikes/scripts/run_netease_api.sh`.
- [ ] Run `npm run dev -- setup`.
- [ ] Run `npm run dev -- import-taste spikes/fixtures/taste-normalized.csv`.
- [ ] Run `npm run dev -- status`.
- [ ] Confirm status reports NetEase, FishAudio, database, taste, personas, Calendar, weather, and latest session fields.

## Conversational Session

- [x] `npm run dev` opens the conversational DJ session.
- [ ] Natural input such as `play something for deep work` is classified as playback intent.
- [ ] Pockedio generates exactly five station tracks.
- [ ] At least one track starts playback in the successful NetEase path, or unavailable tracks are reported without a crash.
- [ ] The session transcript is stored in SQLite.
- [ ] Station tracks and playback status/failure reasons are stored in SQLite.
- [ ] Ordinary playback does not call FishAudio and does not play spoken DJ audio.
- [ ] User feedback phrases such as `more like this`, `skip this`, and `never play this artist again` are stored as feedback.

## Spoken DJ Program

- [ ] Standalone requests such as `make me a short DJ intro for tonight` do not generate or play loose DJ audio clips.
- [ ] If no station is pending, Pockedio explains that DJ voice belongs to a station/program and asks the user to describe the set first.
- [ ] If a station is pending, `dj` prepares a spoken DJ version.
- [ ] Pockedio generates concise English DJ program copy.
- [ ] FishAudio synthesizes local audio.
- [ ] Generated DJ program audio starts only after the user confirms playback.
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

- Automated verification passed on 2026-05-21:
  - `npm test`: 203 tests passed.
  - `npm run typecheck`: passed.
  - `npm run build`: passed.
- Automated coverage includes config, database, personas, taste import, provider adapters, context adapters, voice rules, intent parsing, station generation, session runner, scheduler, and status command tests.
- Manual PTY smoke checks passed on 2026-05-21:
  - `npm run dev` opens the interactive session and shows startup guidance.
  - 3.14 fallback conversation:
    - `I'm tired today.` replies conversationally and does not start playback.
    - `Something softer maybe?` asks whether to shape a station or keep talking.
    - `Crossfade this into Spotify.` explains the unsupported external-app action and offers nearby controls.
    - `Tell me about this song.` with no current track asks for a song/artist or a station context.
  - 3.15 session boundary:
    - `stop` keeps the CLI prompt open.
    - `exit` closes the session with `Session closed.`
    - `quit` closes the session with `Session closed.`
    - Ctrl+C closes cleanly.
  - Processing interrupt:
    - Interactive status lines include `Ctrl+C to cancel`.
    - Ctrl+C during processing cancels the in-flight turn and returns to the prompt.
- Manual smoke checks still needed before tagging or merging v1:
  - Full first-setup run on the user's machine.
  - Member-only preview/full-length comparison for NetEase account playback.
  - Ear-level FishAudio QA by the user, since this smoke pass verified generation/playback plumbing but not subjective audio quality.
- Real-config smoke pass on 2026-05-21:
  - `pockedio status` reported NetEase reachable with account-backed `exhigh` playback, FishAudio paths present, Calendar enabled, weather set to `guangzhou`, and the database migrated after the interactive run.
  - Conversational fallback: `I'm tired today.` stayed conversational and did not start playback.
  - Explicit playback: `play something for deep work` generated five tracks and started NetEase playback with `Weightless Part 1 - Marconi Union`.
  - Current-track questions worked during playback: `who is the singer?` and `tell me about this song` answered against the active track.
  - Controls worked on the real playback path: `next`, `pause`, `resume`, and `stop`.
  - Pending-station path: `Want some soft jazz for coding` produced the Enter/`dj`/adjust prompt without starting playback.
  - Real FishAudio DJ path: `dj` prepared a DJ program, Enter started the generated Mina intro, and NetEase playback started `Blue in Green - Miles Davis`.
  - DJ transition behavior: first transition stayed quiet; a later manual `next` continued music with the “still preparing” notice instead of blocking.
  - Standalone loose DJ clip request was rejected with the station/program guidance.
  - SQLite stored the smoke transcript, station tracks, playback statuses, and the played DJ audio record.
  - Regression found and fixed: background FishAudio transition synthesis could keep the CLI process alive after `exit`; DJ transition preparation is now cancellable on `stop`/`exit`.
- NetEase member playback QA on 2026-05-21:
  - Control track: `江南 - 林俊杰` (`provider_track_id` `108914`).
  - Account-backed resolution returned a playable `exhigh` MP3 with `durationMs` `267946`.
  - Anonymous resolution returned a 30-second preview and the provider marked it unavailable with the expected preview/login guidance.
  - Public CLI command `play 江南 by 林俊杰` started the full `04:27` track, then `stop` marked the interactive playback row as `skipped`.
  - `exit` closed the interactive session cleanly and no playback/audio child processes remained.
- FishAudio DJ audio QA on 2026-05-21:
  - Confirmed configured DJ reference: Mina, English, standard program, reference WAV `/Users/leonw/.pockedio/audio/previews/mina.wav`, `6.22s`, mono 44.1kHz Int16.
  - Real CLI DJ attempt reached pending `dj`, but live station generation stayed on `Building a station...` for more than a minute and required Ctrl+C cancellation; this should be tracked as a station-generation/LLM timeout issue, separate from FishAudio.
  - Controlled FishAudio/`afplay` harness played a real opening WAV: `/Users/leonw/.pockedio/audio/dj/1779343963684-d53e8bf0-3f24-4653-9ccf-59177382b771.wav`, `12.03s`, recorded `played`.
  - Controlled harness waited for and played a real mid-program transition WAV: `/Users/leonw/.pockedio/audio/dj/1779344050688-293eb4b2-a9b1-4f6b-a9fd-ee49e11bef5b.wav`, `10.36s`, recorded `played`.
  - Closing-focused harness played a real opening WAV and generated/played a real closing WAV: `/Users/leonw/.pockedio/audio/dj/1779344246545-6558f28b-23f6-4cac-a2b9-da4b9670505e.wav`, `7.76s`, recorded `played`.
  - Final closing surface appeared before the station-complete prompt: `That station’s done. Press Enter to continue this vibe, or tell me where to take it next.`
  - No `afplay`, FishAudio, MLX, or CLI child processes remained after the harnesses.
- Scheduled DJ consent behavior added on 2026-05-21:
  - Scheduled Morning/Evening jobs now announce that the DJ program is ready instead of auto-playing audio.
  - The prompt supports Enter to play now, `later` to keep the program, and `skip` to dismiss it.
  - Scheduled DJ program cache expiry is six hours after the configured ready time.
  - The generated DJ script prompt now explicitly forbids telling the user to press play.
  - Expiry is now shown as user-readable local time, for example `Available for 6 hours, until 23:00 today.`
  - Scheduled DJ program copy is constrained as a short spoken opening, not a full transcript, to reduce FishAudio timeout risk.
  - After confirmation, scheduled DJ playback shows the lineup and `Now playing` surface before starting the first track.
  - Scheduled station generation now sends an explicit scheduled-program brief: morning prioritizes the first useful listening arc of the day, evening prioritizes transition/decompression, and both still request exactly five tracks through the shared station engine.
  - Scheduled preparation now defaults to 20 minutes before the configured ready time, so real scheduled arrivals have enough time to prepare FishAudio before the prompt appears.
  - Scheduled FishAudio preparation now gets a 10-minute timeout because it happens before the ready-time prompt; the prior 120-second timeout produced text fallback during real QA.
