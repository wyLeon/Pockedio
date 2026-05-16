# Pockedio Product Route

## Confirmed Direction

Pockedio will be built as a personal AI music radio product. The intended experience is a dedicated station that can respond to the user's current intent, mood, and schedule, while gradually reflecting the user's music taste and feeling more like a personal DJ than a static playlist generator.

The development route is CLI-first. The first useful version should run in the terminal and prove the core station-generation behavior before the product becomes a web app.

## Priority Order

1. **Contextual station generation**: The MVP should first prove that Pockedio can generate a useful station from intent, mood, and schedule context.
2. **Personal DJ feel**: The product should feel curated and alive through concise commentary, track rationale, transitions, or session framing.
3. **Taste learning**: The system should incorporate explicit preferences and listening feedback, but deep personalization can mature after the core context loop works.
4. **DJ personas**: Scheduled DJ moments should support different fixed personas on different days, with English as the default DJ language.

## CLI-First Milestone

The CLI version should define the product contract for the later web app. It should answer these questions:

- What does the user tell Pockedio before starting a station?
- What does Pockedio output before playback starts?
- How does the DJ explain or frame the station?
- How does the user give feedback such as liking, skipping, rejecting, or adjusting the vibe?
- What data needs to be saved between sessions?

The first CLI MVP should include real playback rather than a simulated playlist. The intended music source is NetEase Cloud Music through an API integration. Because this is likely to depend on unofficial or changing interfaces, the implementation plan must include a short validation step for login, search, playable URL retrieval, playback reliability, and rate-limit or account constraints.

DJ voice output should use the Fish TTS model that is already installed locally. The CLI should treat voice generation as a local capability: generate concise DJ speech, synthesize it through Fish TTS, and play it before or between music segments when appropriate. The first version should keep spoken segments short so the station remains music-first.

DJ output should speak in English by default. Scheduled DJ moments should choose a persona from a fixed day-based schedule so different days can have different DJ styles.

Schedule context should come from Apple Calendar, because it is the user's primary planning tool. The CLI should use real calendar context to understand the current or upcoming day, then translate that context into station intent such as focus, commute, transition, recovery, or wind-down. The implementation plan must validate the safest local access path for Apple Calendar data before building higher-level scheduling behavior.

Product requirements are tracked in [`docs/product-requirements.md`](product-requirements.md). Taste learning is tracked separately in [`docs/taste-intelligence.md`](taste-intelligence.md).

## Web App Milestone

The web app should be built after the CLI proves the product loop. It should preserve the same core behavior while adding a visual station interface, playback controls, history, preference editing, and a more expressive DJ layer.

## Open Decisions

- Exact NetEase Cloud Music API approach, authentication method, and playback constraints.
- Local Fish TTS invocation path, model name, voice preset, and expected audio output format.
- Exact Apple Calendar integration path and permission model.
- How much personalization data is explicit onboarding versus learned from feedback.
- What success means for the first CLI demo.
