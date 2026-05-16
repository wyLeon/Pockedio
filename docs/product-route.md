# Leondio Product Route

## Confirmed Direction

Leondio will be built as a personal AI music radio product. The intended experience is a dedicated station that can respond to the user's current intent, mood, and schedule, while gradually reflecting the user's music taste and feeling more like a personal DJ than a static playlist generator.

The development route is CLI-first. The first useful version should run in the terminal and prove the core station-generation behavior before the product becomes a web app.

## Priority Order

1. **Contextual station generation**: The MVP should first prove that Leondio can generate a useful station from intent, mood, and schedule context.
2. **Personal DJ feel**: The product should feel curated and alive through concise commentary, track rationale, transitions, or session framing.
3. **Taste learning**: The system should incorporate explicit preferences and listening feedback, but deep personalization can mature after the core context loop works.

## CLI-First Milestone

The CLI version should define the product contract for the later web app. It should answer these questions:

- What does the user tell Leondio before starting a station?
- What does Leondio output before playback starts?
- How does the DJ explain or frame the station?
- How does the user give feedback such as liking, skipping, rejecting, or adjusting the vibe?
- What data needs to be saved between sessions?

## Web App Milestone

The web app should be built after the CLI proves the product loop. It should preserve the same core behavior while adding a visual station interface, playback controls, history, preference editing, and a more expressive DJ layer.

## Open Decisions

- Music source for the first playable version: Spotify, Apple Music, YouTube, local files, or metadata-only simulation.
- Whether calendar/schedule context is manually entered first or connected to a real calendar later.
- Whether the DJ voice is text-only in the CLI, spoken audio, or both.
- How much personalization data is explicit onboarding versus learned from feedback.
- What success means for the first CLI demo.
