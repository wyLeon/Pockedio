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
