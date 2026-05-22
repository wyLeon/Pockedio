# Pockedio v1 Follow-Ups

## Open

### Next stabilization checkpoint

Status: open

The CLI interaction contract is broadly implemented through Section 3.15. Before adding more product surface, the next session should stabilize and checkpoint the current batch.

Recommended order:

- Run a real-config manual smoke pass with the user's NetEase account and selected DJ.
- Verify the 3.14/3.15 terminal behaviors still match `docs/v1-acceptance.md`.
- Prioritize NetEase member playback QA, because it affects every music path.
- Then run Manual DJ audio QA with real FishAudio output.
- Push a checkpoint commit once the smoke pass is acceptable.

### Manual DJ audio QA checklist

Status: open

The automated tests now cover DJ mode handoff and prepared transition usage, but the real CLI still needs ear-level QA because FishAudio and macOS audio routing can behave differently from mocks.

Manual checks:

- Setup is using the selected DJ preview file as the FishAudio reference. Verified on 2026-05-21 for Mina with `~/.pockedio/audio/previews/mina.wav`.
- DJ station opening voice is audible before track 1. Verified objectively on 2026-05-21 with real FishAudio/`afplay` playback and SQLite `played` status.
- Standard DJ mode intentionally keeps the first transition quiet; a middle transition voice appears only when selected by the pacing rules and ready in time. Verified in controlled harness on 2026-05-21; transition file was generated and played before track 3.
- Opening voice and transition voice sound like the same DJ. Needs user subjective confirmation; objective evidence shows both used the same Mina reference.
- If a transition voice is not ready, music still advances and the CLI does not show a false success. Verified in prior real-config smoke on 2026-05-21.
- DJ program closing voice is audible after the final playable track before the station-complete prompt. Verified objectively on 2026-05-21 with real FishAudio/`afplay` playback and SQLite `played` status.

### Live DJ station generation timeout

Status: open

During FishAudio QA on 2026-05-21, the real interactive CLI path accepted `dj` but remained on `Building a station...` for more than a minute before manual Ctrl+C cancellation. The cancellation path worked, and controlled FishAudio playback passed, so this appears to be live station generation or LLM latency rather than FishAudio itself.

Expected behavior:

- Station generation should have a bounded timeout or clearer fallback when the configured LLM stalls.
- The terminal should surface whether it fell back to deterministic station generation or is still waiting on the LLM/provider.
- This should be tested independently from FishAudio voice synthesis.

### Scheduled DJ terminal UX manual QA

Status: open

Scheduled DJ jobs now use playback consent: the program arrives silently, Enter starts playback, `later` keeps it, and `skip` dismisses it. This needs one terminal-level pass with real config because the default prompt uses an interactive TTY.

Manual checks:

- `npm run dev -- serve --run-once morning` prints the ready surface and does not start `afplay` before Enter.
- Pressing Enter starts the prepared DJ audio if available, then starts the first playable NetEase track.
- Typing `later` leaves the program available and starts no audio.
- Typing `skip` dismisses the prepared program and starts no audio.
- The displayed expiration is six hours after the configured ready time.

### Expand DJ mode into real radio-style programs

Status: open

DJ station mode now has a spoken opening, pacing-based transition cues, and a short closing voice, but the broader radio-program layer is still not complete. Standalone 10-15 second DJ voice clips are deprecated; DJ voice should belong to a station/program or scheduled job.

Expected behavior:

- Keep Mina and Nova as the current MVP DJs unless we decide to expand choices later.
- Treat DJ mode as a short radio program, not a one-sentence loose clip.
- Support program length presets such as short, standard, and extended.
- Even the short preset should have enough substance to feel intentional, roughly 30-60 seconds of spoken copy.
- Standard program mode should include scene-setting, station framing, selective transition voice, and a closing.
- DJ copy should use the active persona, user taste, mood/context, and current prompt.
- If LLM generation is unavailable, show a clear unavailable/fallback message instead of pretending a generic sentence is a real DJ program.
- Keep ordinary playback silent by default; this applies only when the user chooses `dj` before starting a station/program or scheduled DJ jobs run.
- Cover explicit DJ mode length and fallback behavior with session runner tests.

### Add local execution audit log

Status: open

The CLI needs a lightweight local execution log so slow or failed runs can be audited without relying on spinner text or terminal scrollback.

Expected behavior:

- Write JSONL events to `~/.pockedio/logs/pockedio.log`.
- Log pipeline stages such as intent detection, context loading, station generation, track URL resolution, playable filtering, DJ script generation, TTS, playback start, transition prep, and playback failure.
- Include useful metadata such as session ID, event name, status, latency, selected DJ, track title/artist, unavailable-track reason, and generated audio path.
- Do not log full diary/calendar text, complete LLM prompts, API keys, or other sensitive private context by default.
- Let `pockedio status` surface the latest failure summary later; a dedicated `pockedio logs --tail` command can wait.

### NetEase account QA

Status: open

Account-backed playback setup is implemented, but it still needs real-world listening QA with the user's NetEase member account.

Manual checks:

- QR login succeeds from first setup and `pockedio setup netease`.
- `pockedio status` shows account-backed playback after login. Verified on 2026-05-21 with account-backed `exhigh`.
- Requested quality is applied when resolving song URLs. Verified on 2026-05-21 at the status/config level and by real playback startup.
- Previously preview-only/member-limited tracks resolve to full playable URLs when the account has access. Verified on 2026-05-21 with `江南 - 林俊杰` (`108914`): account-backed `exhigh` returned `267946ms`; anonymous returned a 30-second preview.
- If account playback still returns a preview or unavailable URL, the CLI should explain that NetEase did not provide a full playable stream and continue to the next playable track. Provider fallback verified for anonymous preview detection; still needs an account-side unavailable example if one appears in real use.

### Real-config smoke finding: cancel DJ transition prep on teardown

Status: done

During the 2026-05-21 real-config smoke pass, `exit` printed `Session closed.` but the Node process stayed alive until two background FishAudio transition syntheses finished. Root cause: DJ transition preparation launched cancellable-looking background promises but did not retain a cancellation handle for the spawned Python process. FishAudio synthesis now accepts an abort signal, DJ transition preparation aborts in-flight work on `stop` and `exit`, and regression coverage verifies the signal is aborted.

## Recently Completed

### Context and memory hint layer

Status: done

Pockedio now treats Weather, Calendar, Diary, and session memory as separate local context layers with clearer boundaries. Weather has an explicit enabled flag and a listening hint, so skipped weather no longer fetches the default city. Calendar now derives a local listening hint from event count and event titles, while continuing to store only calendar name, title, start/end time, and all-day flag. Diary summaries now include a safer music-facing listening hint, remain opt-in, cache by file and mtime, and do not store raw diary text. Session memory is saved silently: transcripts, auto-advance surfaces, station-complete messages, and durable summaries are kept locally and used in future station generation without asking the user to manually save memory.

### Immediate setup validation feedback

Status: done

Setup steps that require validation now show feedback immediately before moving on. This applies to NetEase QR/cookie login, weather lookup, Calendar permission/read, diary path/read, taste import, and DJ preview playback. Calendar and diary setup no longer wait until the end of the full setup flow to report whether they worked.

### NetEase account-backed playback setup

Status: done

First setup now starts with Music Provider. NetEase Cloud Music is the only current provider, but the config has an explicit provider field for future expansion. NetEase account-backed playback supports QR login or pasted `MUSIC_U` cookie, asks for playback quality from best to safest fallback, and offers a dedicated `pockedio setup netease` repair/change path. Cookies are stored locally under `~/.pockedio/secrets/`, and `pockedio status` distinguishes anonymous from account-backed playback.

### Station-building progress feedback

Status: done

The CLI now shows concise processing states such as `Thinking...`, `Reading your context...`, `Building a station...`, `Preparing DJ voice...`, and `Starting playback...`.

### DJ mode transition plumbing

Status: done

DJ mode now keeps a resolved ducked-intro playback function in interactive state, prepares the next track's intro while the current track is playing, and uses the prepared intro on manual `next` or auto-advance when available.

### DJ voice consistency references

Status: done

FishAudio now supports configured `referenceAudioPath` and `referenceText`. First setup uses the chosen DJ preview WAV as the canonical reference so Mina/Nova spoken segments do not drift as much between opening and transitions.

### DJ mode before-playback fork

Status: done

### Live in-place playback progress renderer

Status: todo

The CLI now renders duration-aware bars such as `[======>............] 00:42 / 04:13` when track duration is known. A continuously ticking in-place terminal renderer still needs a prompt-safe implementation so it does not corrupt user input while the conversation prompt is waiting.

Open-ended requests such as `Want some soft jazz...` now produce a pending station first, letting the user press Enter for normal playback, type `dj` for DJ mode, or refine before playback. `dj mode` during active playback is explicitly rejected as a mid-station toggle.

### Station completion surface

Status: done

When the last playable track finishes, Pockedio now says the station is done and offers Enter to continue the same vibe or free text to redirect the next station.

### Specific song playback

Status: done

Specific requests such as `play To Be Alone With You by Sufjan Stevens` now play a single track instead of building a five-track station. Ambiguous bare titles ask the user to choose from close matches.

### Contextual processing interrupt

Status: done

Interactive status lines now show `Ctrl+C to cancel`. Ctrl+C at the idle prompt exits the CLI, while Ctrl+C during message processing cancels the in-flight turn, records a local cancellation row, and returns to the prompt.
