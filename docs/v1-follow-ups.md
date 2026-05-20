# Pockedio v1 Follow-Ups

## Open

### Manual DJ audio QA checklist

Status: open

The automated tests now cover DJ mode handoff and prepared transition usage, but the real CLI still needs ear-level QA because FishAudio and macOS audio routing can behave differently from mocks.

Manual checks:

- Setup is using the selected DJ preview file as the FishAudio reference.
- DJ station opening voice is audible before track 1.
- `next` from track 1 plays the prepared track 2 DJ voice before music resumes normally.
- Opening voice and transition voice sound like the same DJ.
- If a transition voice is not ready, music still advances and the CLI does not show a false success.

### Expand DJ mode into real radio-style programs

Status: open

DJ station mode now has a spoken opening and prepared transition intros, but the broader radio-program layer is still not complete. A prompt such as `make me a short DJ intro for tonight` should feel like a real car-radio segment, not an eight-word confirmation.

Expected behavior:

- Keep Mina and Nova as the current MVP DJs unless we decide to expand choices later.
- Treat explicit DJ mode as a short radio program, not a one-sentence intro.
- Support program length presets such as short, standard, and extended.
- Even the short preset should have enough substance to feel intentional, roughly 30-60 seconds of spoken copy.
- Standard program mode should include scene-setting, station framing, and a transition into music.
- DJ copy should use the active persona, user taste, mood/context, and current prompt.
- If LLM generation is unavailable, show a clear unavailable/fallback message instead of pretending a generic sentence is a real DJ program.
- Keep ordinary playback silent by default; this applies only when the user explicitly asks for DJ-like audio or scheduled DJ jobs run.
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
- `pockedio status` shows account-backed playback after login.
- Requested quality is applied when resolving song URLs.
- Previously preview-only/member-limited tracks resolve to full playable URLs when the account has access.
- If account playback still returns a preview or unavailable URL, the CLI should explain that NetEase did not provide a full playable stream and continue to the next playable track.

## Recently Completed

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

Open-ended requests such as `Want some soft jazz...` now produce a pending station first, letting the user press Enter for normal playback, type `dj` for DJ mode, or refine before playback. `dj mode` during active playback is explicitly rejected as a mid-station toggle.

### Station completion surface

Status: done

When the last playable track finishes, Pockedio now says the station is done and offers Enter to continue the same vibe or free text to redirect the next station.

### Specific song playback

Status: done

Specific requests such as `play To Be Alone With You by Sufjan Stevens` now play a single track instead of building a five-track station. Ambiguous bare titles ask the user to choose from close matches.
