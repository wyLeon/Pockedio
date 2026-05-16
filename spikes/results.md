# Pockedio v1 Spike Results

## Environment

- Date: 2026-05-17
- macOS: 26.5
- Node: v24.12.0
- Python: Python 3.14.4
- SQLite: 3.51.0

## NetEase Cloud Music

- Search works: yes
- Playable URL retrieval works: yes
- Auth required: no for probed search and standard URL retrieval; unclear for broader catalog and account-restricted tracks
- Unavailable track behavior: probed track returned code 200 with a playable mp3 URL and freeTrialInfo present
- Decision: use the local NetEase API server behind a provider adapter; keep unavailable-track fallback mandatory because auth, membership, region, and copyright behavior remain track-dependent

## Fish TTS

- Local command or Python entrypoint:
- Model path/name:
- Output format:
- Generation latency:
- Playback command:
- Decision:

## Apple Calendar

- Current-date read works:
- Permission behavior:
- Event fields available:
- Decision:

## Weather

- Location source:
- Forecast endpoint works:
- Fields used:
- Decision:

## SQLite Memory

- Schema creation works:
- Full transcript storage works:
- Query shape works:
- Decision:

## Taste Import

- First supported format:
- Required fields:
- Derived taste summary possible:
- Decision:

## DJ Personas

- Config shape works:
- Default language:
- Scheduled days:
- Decision:

## Final Recommendation

- Product implementation can start:
- Blockers:
- Required implementation constraints:
