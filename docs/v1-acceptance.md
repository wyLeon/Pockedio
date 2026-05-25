# Pockedio v1 Acceptance Checklist

This checklist maps the approved v1 design criteria to implementation and verification evidence.

## Automated Verification

- [x] `npm run typecheck`
- [x] `npm test`
- [x] `npm run build`

Latest automated pass on 2026-05-25:

- `npm test`: 363 tests passed.
- `npm run build`: passed.
- `npm run typecheck`: passed.

## Manual Setup

- [ ] Start NetEase API with `spikes/scripts/run_netease_api.sh`.
- [ ] Run `npm run dev -- setup`.
- [ ] Confirm setup hub exposes LLM, Voice, NetEase, Context, and Scheduler.
- [ ] Confirm selectable setup pages support `B Back`.
- [ ] Confirm nested text/password prompts support `Esc to back`.
- [ ] Confirm built-in macOS voice setup works without Fish TTS.
- [ ] Confirm Fish TTS remains optional.
- [ ] Run `npm run dev -- import-taste <netease-playlist-link-or-id>`.
- [ ] Run `npm run dev -- status`.
- [ ] Confirm status reports NetEase, voice/TTS, database, taste, personas, Calendar, weather, scheduler, and latest session fields.

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

- [ ] Public commands remain centered on `pockedio`, `pockedio setup`, `pockedio import-taste <playlist-link-or-id>`, `pockedio refresh-context`, `pockedio serve`, and `pockedio status`.
- [ ] Setup section commands remain repair paths, not separate product modes: `setup llm`, `setup voice`, `setup netease`, `setup context`, and `setup scheduler`.
- [ ] Playback, mood, and feedback are natural-language intents inside the session, not extra public commands.

## Current Evidence

- Automated verification passed on 2026-05-25:
  - `npm test`: 363 tests passed.
  - `npm run build`: passed.
  - `npm run typecheck`: passed.
- Automated coverage includes config, database, personas, taste import, provider adapters, context adapters, voice rules, intent parsing, station generation, session runner, scheduler, and status command tests.
- Open-source release docs were added on 2026-05-22:
  - Source-install README.
  - MIT license.
  - Contribution and security guidance.
  - `.env.example` with placeholders only.
  - GitHub Actions CI for typecheck, tests, and build.
- Fresh-clone release smoke passed on 2026-05-25 with Node v24.12.0:
  - `npm ci --prefer-offline --no-audit --progress=false`, `npm run typecheck`, `npm test`, and `npm run build` passed from `/tmp/pockedio-release-smoke-oss`.
  - An earlier exact `npm ci` attempt stalled during package fetch through the local proxy without a project error; rerun exact `npm ci` on a clean network before tagging if release evidence must be strict.
  - Node v18.20.8 produced expected engine warnings and failed native install for `better-sqlite3`; the public requirement remains Node 22+.
  - `node dist/cli.js status` worked with isolated `POCKEDIO_HOME=/tmp/pockedio-clean-test`.
  - Fresh status showed default voice as `Vale, built-in macOS`, not mandatory Fish TTS.
  - PTY `node dist/cli.js setup` skip path completed all optional setup gates and returned cleanly.
  - Main hub opened, Setup & Connections opened, Context > Diary opened, `Esc` returned from diary path input, and `B` returned to Setup & Connections.
  - Fixture taste import wrote `taste.md` and database memory into the isolated local home.
  - No-key session fallback built a five-track station for `play something soft for piano focus`, resolved NetEase tracks through anonymous playback, retained one unavailable entry, handled playback process exit code 2 without crashing, accepted `stop`, and exited cleanly.
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
  - `pockedio status` reported NetEase reachable with account-backed `exhigh` playback, FishAudio paths present, Calendar enabled, weather configured, and the database migrated after the interactive run.
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
  - Confirmed configured DJ reference: Mina, English, standard program, local preview WAV, `6.22s`, mono 44.1kHz Int16.
  - Real CLI DJ attempt reached pending `dj`, but live station generation stayed on `Building a station...` for more than a minute and required Ctrl+C cancellation; this should be tracked as a station-generation/LLM timeout issue, separate from FishAudio.
  - Controlled FishAudio/`afplay` harness played a real opening WAV, `12.03s`, recorded `played`.
  - Controlled harness waited for and played a real mid-program transition WAV, `10.36s`, recorded `played`.
  - Closing-focused harness played a real opening WAV and generated/played a real closing WAV, `7.76s`, recorded `played`.
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
  - Scheduled DJ playback now uses the same ducked first-track handoff as DJ-mode station instead of playing voice and music as separate sequential calls.
  - `pockedio serve` now guards mood checks around scheduled DJ windows so a mood prompt cannot block scheduled preparation or the ready-time prompt.
