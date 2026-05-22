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

- Local command or Python entrypoint: `.cache/mlx-speech-venv/bin/python .cache/mlx-speech/scripts/generate/fish_s2_pro.py`
- Model path/name: local candidate found at `~/.cache/huggingface/hub/models--appautomaton--fishaudio-s2-pro-8bit-mlx/snapshots/29ab46393de21f696a82050d8594a677a5797f7e`
- Output format: wav, 44100 Hz mono PCM
- Generation latency: 17.075 seconds for `Pockedio is on air.` on the first validated generation; measured in `spikes/fish-tts-latency.txt`
- Playback command: `afplay spikes/fish-tts-sample.wav`
- Decision: use FishAudio S2 Pro through MLX for v1 spoken DJ audio; wrap invocation behind a production TTS adapter and keep text fallback for runtime failures

## Apple Calendar

- Current-date read works: yes
- Permission behavior: AppleScript completed through timeout-safe wrapper; raw event text is written only to `/tmp` and not committed
- Event fields available: calendar name, summary, start date, end date
- Decision: use AppleScript through a timeout wrapper for v1 Calendar context; production setup must guide macOS Calendar/Automation permission and keep EventKit/native helper as fallback if AppleScript becomes unreliable

## Weather

- Location source: `LEONDIO_LOCATION`, probed with `Shanghai`
- Forecast endpoint works: yes
- Fields used: temperature_2m, relative_humidity_2m, precipitation, weather_code, wind_speed_10m
- Decision: use Open-Meteo with configured city for v1; skip weather context gracefully when geocoding or forecast endpoint fails

## SQLite Memory

- Schema creation works: yes
- Full transcript storage works: yes
- Query shape works: yes
- Decision: use SQLite for v1 local durable memory; production schema should extend this with playlists, playback results, feedback actions, and summarized context rows

## Taste Import

- First supported format: normalized CSV with title, artist, album, source, playlist, liked_at
- Required fields: title, artist, album, source, playlist, liked_at
- Derived taste summary possible: yes
- Decision: support normalized CSV first; add app-specific converters after real export samples are available, and use a production CSV parser instead of simple string splitting

## DJ Personas

- Config shape works: yes
- Default language: en
- Scheduled days: monday, tuesday, wednesday, thursday, friday
- Decision: use JSON-backed persona schedule for v1; scheduled DJ jobs select the persona by weekday and default DJ output to English

## Final Recommendation

- Product implementation can start: yes for the CLI foundation and provider adapters
- Blockers: none for v1 foundation; scheduled DJ implementation must still keep runtime fallbacks
- Required implementation constraints:
  - NetEase provider must be behind an adapter and handle unavailable tracks.
  - NetEase local API startup uses `spikes/scripts/run_netease_api.sh`, which isolates npm cache under `.cache/npm`.
  - Fish TTS must be behind a TTS adapter and keep text fallback for runtime failures.
  - Apple Calendar access must be configured during setup and never commit raw event text.
  - Weather context must be optional.
  - SQLite is the v1 local database if the memory probe passed.
  - Taste import starts with normalized CSV.
  - DJ persona schedule starts as JSON config with English default output.
