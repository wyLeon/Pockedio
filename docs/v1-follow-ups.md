# Pockedio v1 Follow-Ups

## Open

### Add station-building progress feedback

Status: open

When the user asks for music, Pockedio can take a noticeable moment while it builds the five-song station. The CLI should show a short loading/progress message before the station response, so the user knows the request was accepted and work is happening.

Expected behavior:

- After a playback request is classified, print a message such as `Building a five-song station...`.
- Keep the message text concise and CLI-native.
- Do not add spoken DJ audio for this progress state.
- Do not duplicate the final queue or now-playing response.
- Cover the behavior with a session runner test.

### Expand DJ mode into real radio-style programs

Status: open

User-requested DJ audio is currently too short and can collapse to a generic fallback line when LLM copy generation is unavailable. A prompt such as `make me a short DJ intro for tonight` should feel like a real car-radio segment, not an eight-word confirmation.

Expected behavior:

- Provide six selectable DJ personas for the user.
- Let users choose or configure their preferred DJ persona during setup.
- Treat explicit DJ mode as a short radio program, not a one-sentence intro.
- Support program length presets such as short, standard, and extended.
- Even the short preset should have enough substance to feel intentional, roughly 30-60 seconds of spoken copy.
- Standard program mode should include scene-setting, station framing, and a transition into music.
- DJ copy should use the active persona, user taste, mood/context, and current prompt.
- If LLM generation is unavailable, show a clear unavailable/fallback message instead of pretending a generic sentence is a real DJ program.
- Keep ordinary playback silent by default; this applies only when the user explicitly asks for DJ-like audio or scheduled DJ jobs run.
- Cover explicit DJ mode length and fallback behavior with session runner tests.
