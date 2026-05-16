# Leondio v1 Technical Spikes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Validate the external dependencies and local persistence choices required before implementing Leondio v1.

**Architecture:** This plan creates a temporary `spikes/` workspace with small probe scripts and a single results document. Each probe validates one risky dependency from the approved v1 design: NetEase playback, Fish TTS, Apple Calendar, weather, SQLite memory, and taste import shape.

**Tech Stack:** Shell, Node.js 18, AppleScript via `osascript`, SQLite 3, `curl`, `afplay`, and short disposable probe scripts.

---

## Scope Check

The approved design covers multiple independent subsystems. This plan intentionally does not implement the product. It validates the risky dependencies and records decisions so the next plan can implement Leondio with fewer open risks.

## Files Created By This Plan

- `spikes/README.md`: explains the spike workspace and safety rules.
- `spikes/results.md`: records spike outcomes and v1 implementation decisions.
- `spikes/scripts/netease_probe.mjs`: checks a local NetEase Cloud Music API server for search and playable URL retrieval.
- `spikes/scripts/apple_calendar_probe.applescript`: reads current-date Apple Calendar events.
- `spikes/scripts/weather_probe.mjs`: checks geocoding and forecast data through Open-Meteo.
- `spikes/scripts/sqlite_memory_probe.sql`: validates the local memory schema shape in SQLite.
- `spikes/scripts/taste_import_probe.mjs`: validates a normalized CSV import shape for taste data.
- `spikes/fixtures/taste-normalized.csv`: sample taste import data.

## Task 1: Create Spike Workspace

**Files:**
- Create: `spikes/README.md`
- Create: `spikes/results.md`

- [ ] **Step 1: Create directories**

Run:

```bash
mkdir -p spikes/scripts spikes/fixtures
```

Expected: command exits with code `0`.

- [ ] **Step 2: Create `spikes/README.md`**

Write this exact content:

```markdown
# Leondio Technical Spikes

This directory contains disposable probes for Leondio v1 dependencies.

Rules:

- Probe scripts may read local data only when the user has already approved the source.
- Probe scripts should write summaries to `spikes/results.md`, not private raw data.
- Probe scripts should avoid committing credentials, cookies, generated audio, or private diary/calendar text.
- Successful probes inform the production implementation plan.
```

- [ ] **Step 3: Create `spikes/results.md`**

Write this exact content:

```markdown
# Leondio v1 Spike Results

## Environment

- Date:
- macOS:
- Node:
- Python:
- SQLite:

## NetEase Cloud Music

- Search works:
- Playable URL retrieval works:
- Auth required:
- Unavailable track behavior:
- Decision:

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

## Final Recommendation

- Product implementation can start:
- Blockers:
- Required implementation constraints:
```

- [ ] **Step 4: Capture environment versions**

Run:

```bash
{
  echo "macOS: $(sw_vers -productVersion)"
  echo "Node: $(node --version)"
  echo "Python: $(python3 --version)"
  echo "SQLite: $(sqlite3 --version)"
} | tee spikes/environment.txt
```

Expected: `spikes/environment.txt` contains macOS, Node, Python, and SQLite versions.

- [ ] **Step 5: Commit workspace scaffold**

Run:

```bash
git add spikes/README.md spikes/results.md spikes/environment.txt
git commit -m "chore: add technical spike workspace"
```

Expected: commit succeeds.

## Task 2: NetEase Cloud Music API Spike

**Files:**
- Create: `spikes/scripts/netease_probe.mjs`
- Modify: `spikes/results.md`

- [ ] **Step 1: Create `spikes/scripts/netease_probe.mjs`**

Write this exact content:

```javascript
const baseUrl = process.env.NETEASE_BASE_URL || "http://127.0.0.1:3000";
const keyword = process.env.NETEASE_KEYWORD || "坂本龙一";

async function getJson(path) {
  const url = `${baseUrl}${path}`;
  const response = await fetch(url);
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON response from ${url}: ${text.slice(0, 200)}`);
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${url}: ${text.slice(0, 200)}`);
  }
  return json;
}

const search = await getJson(`/search?keywords=${encodeURIComponent(keyword)}&limit=5`);
const songs = search?.result?.songs || [];
const first = songs[0];

if (!first?.id) {
  console.log(JSON.stringify({ ok: false, stage: "search", songCount: songs.length }, null, 2));
  process.exit(1);
}

const urlResult = await getJson(`/song/url/v1?id=${first.id}&level=standard`);
const urlItem = urlResult?.data?.[0];

console.log(JSON.stringify({
  ok: Boolean(urlItem?.url),
  baseUrl,
  keyword,
  songCount: songs.length,
  firstSong: {
    id: first.id,
    name: first.name,
    artists: (first.artists || []).map((artist) => artist.name),
  },
  playable: Boolean(urlItem?.url),
  urlType: urlItem?.type || null,
  code: urlItem?.code || null,
  freeTrialInfo: Boolean(urlItem?.freeTrialInfo),
}, null, 2));
```

- [ ] **Step 2: Start a local NetEase API server**

Run in a separate terminal:

```bash
npx NeteaseCloudMusicApi@latest
```

Expected: server starts on `http://127.0.0.1:3000` or prints the port it uses.

- [ ] **Step 3: Run the probe**

Run:

```bash
node spikes/scripts/netease_probe.mjs | tee spikes/netease-result.json
```

Expected: JSON output includes `"songCount"` greater than `0`. If `"playable"` is `false`, record the failure reason from `"code"` and API response behavior.

- [ ] **Step 4: Test audio playback if a URL is returned**

Run:

```bash
node -e 'const fs=require("fs"); const r=JSON.parse(fs.readFileSync("spikes/netease-result.json","utf8")); if(!r.playable){process.exit(2)} console.log("Playable URL confirmed by API probe")'
```

Expected: exits `0` when the API returned a playable URL. If it exits `2`, the implementation must support unavailable-track fallback.

- [ ] **Step 5: Update `spikes/results.md`**

Record:

```markdown
## NetEase Cloud Music

- Search works: yes/no
- Playable URL retrieval works: yes/no
- Auth required: yes/no/unclear
- Unavailable track behavior: describe observed API result
- Decision: use local NetEase API server only if search and URL retrieval work; otherwise implement the music provider behind an adapter and keep fallback playlist output mandatory
```

- [ ] **Step 6: Commit NetEase spike**

Run:

```bash
git add spikes/scripts/netease_probe.mjs spikes/netease-result.json spikes/results.md
git commit -m "spike: validate netease music API"
```

Expected: commit succeeds.

## Task 3: Fish TTS Spike

**Files:**
- Modify: `spikes/results.md`

- [ ] **Step 1: Locate likely Fish TTS entrypoints**

Run:

```bash
{
  command -v fish-speech || true
  command -v fish-tts || true
  python3 -c 'import importlib.util; print("fish_speech", bool(importlib.util.find_spec("fish_speech")))'
} | tee spikes/fish-tts-entrypoints.txt
```

Expected: at least one command or Python module path is reported. If none are found, inspect the user's installed Fish TTS location before implementation planning.

- [ ] **Step 2: Locate local model candidates**

Run:

```bash
find "$HOME" -maxdepth 5 \( -iname '*fish*' -o -iname '*tts*' \) 2>/dev/null | head -100 | tee spikes/fish-tts-candidates.txt
```

Expected: output includes likely Fish TTS directories, model directories, or environment paths.

- [ ] **Step 3: Generate a tiny sample using the local Fish TTS command**

Use the actual entrypoint discovered in Step 1. The target output file must be:

```text
spikes/fish-tts-sample.wav
```

The spoken text must be:

```text
Leondio is on air.
```

Expected: `spikes/fish-tts-sample.wav` exists and is playable.

- [ ] **Step 4: Play the generated sample**

Run:

```bash
afplay spikes/fish-tts-sample.wav
```

Expected: the sample audio plays.

- [ ] **Step 5: Record latency and invocation**

Run the Fish TTS generation command again with `time` and save the terminal output:

```bash
script -q spikes/fish-tts-latency.txt
```

Inside the script session, run the working Fish TTS command from Step 3 with `time`, then type `exit`.

Expected: `spikes/fish-tts-latency.txt` contains the command and timing output.

- [ ] **Step 6: Update `spikes/results.md`**

Record:

```markdown
## Fish TTS

- Local command or Python entrypoint: exact command
- Model path/name: exact model or config used
- Output format: wav/mp3/other
- Generation latency: measured seconds
- Playback command: afplay <file>
- Decision: use this entrypoint if generation and afplay both succeed; otherwise keep DJ copy text fallback in scheduled jobs
```

- [ ] **Step 7: Commit Fish TTS spike**

Run:

```bash
git add spikes/fish-tts-entrypoints.txt spikes/fish-tts-candidates.txt spikes/fish-tts-latency.txt spikes/results.md
git add -f spikes/fish-tts-sample.wav
git commit -m "spike: validate local fish tts"
```

Expected: commit succeeds. If the audio file is too large, remove it from git and commit only the latency/result notes.

## Task 4: Apple Calendar Spike

**Files:**
- Create: `spikes/scripts/apple_calendar_probe.applescript`
- Modify: `spikes/results.md`

- [ ] **Step 1: Create `spikes/scripts/apple_calendar_probe.applescript`**

Write this exact content:

```applescript
set startOfDay to current date
set time of startOfDay to 0
set endOfDay to startOfDay + (24 * 60 * 60)
set outputLines to {}

tell application "Calendar"
  repeat with cal in calendars
    set eventList to (events of cal whose start date ≥ startOfDay and start date < endOfDay)
    repeat with evt in eventList
      set eventTitle to summary of evt
      set eventStart to start date of evt
      set eventEnd to end date of evt
      set end of outputLines to ((name of cal) & " | " & eventTitle & " | " & (eventStart as text) & " | " & (eventEnd as text))
    end repeat
  end repeat
end tell

set AppleScript's text item delimiters to linefeed
return outputLines as text
```

- [ ] **Step 2: Run the Apple Calendar probe**

Run:

```bash
osascript spikes/scripts/apple_calendar_probe.applescript | tee spikes/apple-calendar-current-day.txt
```

Expected: macOS may ask for Calendar permission. After permission is granted, the output lists current-date events or exits cleanly with empty output when no events exist.

- [ ] **Step 3: Update `spikes/results.md`**

Record:

```markdown
## Apple Calendar

- Current-date read works: yes/no
- Permission behavior: describe macOS prompt or failure
- Event fields available: calendar name, summary, start date, end date
- Decision: use AppleScript if permission and current-date reads work; otherwise evaluate EventKit through a native helper
```

- [ ] **Step 4: Commit Apple Calendar spike**

Run:

```bash
git add spikes/scripts/apple_calendar_probe.applescript spikes/apple-calendar-current-day.txt spikes/results.md
git commit -m "spike: validate apple calendar access"
```

Expected: commit succeeds.

## Task 5: Weather Spike

**Files:**
- Create: `spikes/scripts/weather_probe.mjs`
- Modify: `spikes/results.md`

- [ ] **Step 1: Create `spikes/scripts/weather_probe.mjs`**

Write this exact content:

```javascript
const location = process.env.LEONDIO_LOCATION || "Shanghai";

async function getJson(url) {
  const response = await fetch(url);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
  }
  return JSON.parse(text);
}

const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1&language=en&format=json`;
const geo = await getJson(geoUrl);
const place = geo.results?.[0];

if (!place) {
  console.log(JSON.stringify({ ok: false, stage: "geocoding", location }, null, 2));
  process.exit(1);
}

const forecastUrl = `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current=temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m&forecast_days=1`;
const forecast = await getJson(forecastUrl);

console.log(JSON.stringify({
  ok: true,
  requestedLocation: location,
  matchedLocation: `${place.name}, ${place.country}`,
  latitude: place.latitude,
  longitude: place.longitude,
  current: forecast.current,
}, null, 2));
```

- [ ] **Step 2: Run the weather probe**

Run:

```bash
LEONDIO_LOCATION="Shanghai" node spikes/scripts/weather_probe.mjs | tee spikes/weather-result.json
```

Expected: JSON output includes `"ok": true`, location coordinates, and current weather fields.

- [ ] **Step 3: Update `spikes/results.md`**

Record:

```markdown
## Weather

- Location source: LEONDIO_LOCATION
- Forecast endpoint works: yes/no
- Fields used: temperature_2m, relative_humidity_2m, precipitation, weather_code, wind_speed_10m
- Decision: use Open-Meteo with configured city if the probe succeeds; skip weather context when the endpoint fails
```

- [ ] **Step 4: Commit weather spike**

Run:

```bash
git add spikes/scripts/weather_probe.mjs spikes/weather-result.json spikes/results.md
git commit -m "spike: validate weather context"
```

Expected: commit succeeds.

## Task 6: SQLite Memory Spike

**Files:**
- Create: `spikes/scripts/sqlite_memory_probe.sql`
- Modify: `spikes/results.md`

- [ ] **Step 1: Create `spikes/scripts/sqlite_memory_probe.sql`**

Write this exact content:

```sql
PRAGMA foreign_keys = ON;

DROP TABLE IF EXISTS messages;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS memory_items;

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  trigger_type TEXT NOT NULL,
  trigger_text TEXT NOT NULL
);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  role TEXT NOT NULL CHECK (role IN ('user', 'leondio', 'system')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE memory_items (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('agenda', 'diary', 'taste', 'feedback', 'summary')),
  source_session_id TEXT REFERENCES sessions(id),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);

INSERT INTO sessions VALUES (
  'session_001',
  '2026-05-17T09:00:00+08:00',
  'conversation',
  'I feel scattered. Play it directly.'
);

INSERT INTO messages VALUES
  ('msg_001', 'session_001', 'user', 'I feel scattered. Play it directly.', '2026-05-17T09:00:01+08:00'),
  ('msg_002', 'session_001', 'leondio', 'Copy that. Clean lines, no detour. Starting a five-track set.', '2026-05-17T09:00:04+08:00');

INSERT INTO memory_items VALUES (
  'mem_001',
  'summary',
  'session_001',
  'User wanted direct playback and no extended discussion.',
  '2026-05-17T09:01:00+08:00'
);

SELECT 'sessions', count(*) FROM sessions;
SELECT 'messages', count(*) FROM messages;
SELECT 'memory_items', count(*) FROM memory_items;
SELECT role || ': ' || content FROM messages ORDER BY created_at;
```

- [ ] **Step 2: Run the SQLite probe**

Run:

```bash
sqlite3 spikes/leondio-memory.sqlite < spikes/scripts/sqlite_memory_probe.sql | tee spikes/sqlite-memory-result.txt
```

Expected: output includes:

```text
sessions|1
messages|2
memory_items|1
```

- [ ] **Step 3: Update `spikes/results.md`**

Record:

```markdown
## SQLite Memory

- Schema creation works: yes/no
- Full transcript storage works: yes/no
- Query shape works: yes/no
- Decision: use SQLite for v1 local durable memory if this probe succeeds
```

- [ ] **Step 4: Commit SQLite spike**

Run:

```bash
git add spikes/scripts/sqlite_memory_probe.sql spikes/sqlite-memory-result.txt spikes/results.md
git commit -m "spike: validate sqlite memory store"
```

Expected: commit succeeds. Do not commit `spikes/leondio-memory.sqlite`.

## Task 7: Taste Import Shape Spike

**Files:**
- Create: `spikes/fixtures/taste-normalized.csv`
- Create: `spikes/scripts/taste_import_probe.mjs`
- Modify: `spikes/results.md`

- [ ] **Step 1: Create `spikes/fixtures/taste-normalized.csv`**

Write this exact content:

```csv
title,artist,album,source,playlist,liked_at
Merry Christmas Mr. Lawrence,Ryuichi Sakamoto,Merry Christmas Mr. Lawrence,netease,late night piano,2024-12-12
Blue in Green,Miles Davis,Kind of Blue,spotify,deep focus jazz,2023-08-04
An Ending (Ascent),Brian Eno,Apollo,apple_music,ambient reset,2022-11-02
```

- [ ] **Step 2: Create `spikes/scripts/taste_import_probe.mjs`**

Write this exact content:

```javascript
import fs from "node:fs";

const file = process.argv[2] || "spikes/fixtures/taste-normalized.csv";
const text = fs.readFileSync(file, "utf8").trim();
const [headerLine, ...lines] = text.split(/\r?\n/);
const headers = headerLine.split(",");
const required = ["title", "artist", "album", "source", "playlist", "liked_at"];

for (const key of required) {
  if (!headers.includes(key)) {
    throw new Error(`Missing required column: ${key}`);
  }
}

const rows = lines.map((line) => {
  const values = line.split(",");
  return Object.fromEntries(headers.map((header, index) => [header, values[index] || ""]));
});

const artists = [...new Set(rows.map((row) => row.artist))];
const sources = [...new Set(rows.map((row) => row.source))];
const playlists = [...new Set(rows.map((row) => row.playlist))];

console.log(JSON.stringify({
  ok: true,
  file,
  trackCount: rows.length,
  artists,
  sources,
  playlists,
  tasteDraft: `Early signal: ${artists.join(", ")} across ${playlists.join(", ")}.`,
}, null, 2));
```

- [ ] **Step 3: Run the taste import probe**

Run:

```bash
node spikes/scripts/taste_import_probe.mjs | tee spikes/taste-import-result.json
```

Expected: JSON output includes `"ok": true`, `"trackCount": 3`, and a `"tasteDraft"` string.

- [ ] **Step 4: Update `spikes/results.md`**

Record:

```markdown
## Taste Import

- First supported format: normalized CSV with title, artist, album, source, playlist, liked_at
- Required fields: title, artist, album, source, playlist, liked_at
- Derived taste summary possible: yes/no
- Decision: support normalized CSV first; add app-specific converters after real export samples are available
```

- [ ] **Step 5: Commit taste import spike**

Run:

```bash
git add spikes/fixtures/taste-normalized.csv spikes/scripts/taste_import_probe.mjs spikes/taste-import-result.json spikes/results.md
git commit -m "spike: validate taste import shape"
```

Expected: commit succeeds.

## Task 8: Final Spike Recommendation

**Files:**
- Modify: `spikes/results.md`

- [ ] **Step 1: Review all spike outputs**

Run:

```bash
ls -1 spikes/*result* spikes/*calendar* spikes/*fish* spikes/*environment* 2>/dev/null
```

Expected: output lists the result files created by Tasks 1 through 7.

- [ ] **Step 2: Fill `Final Recommendation` in `spikes/results.md`**

Use this exact shape:

```markdown
## Final Recommendation

- Product implementation can start: yes/no
- Blockers: list concrete blockers or write "none"
- Required implementation constraints:
  - NetEase provider must be behind an adapter and handle unavailable tracks.
  - Fish TTS must have text fallback for scheduled jobs.
  - Apple Calendar access must request or document macOS permission.
  - Weather context must be optional.
  - SQLite is the v1 local database if the memory probe passed.
  - Taste import starts with normalized CSV.
```

- [ ] **Step 3: Commit final recommendation**

Run:

```bash
git add spikes/results.md
git commit -m "docs: summarize technical spike results"
```

Expected: commit succeeds.

## Self-Review Checklist

- The plan covers every technical spike required by `docs/superpowers/specs/2026-05-17-leondio-v1-design.md`.
- The plan avoids product implementation and focuses on dependency validation.
- Every task produces a concrete artifact or recorded decision.
- NetEase, Fish TTS, Apple Calendar, weather, SQLite memory, and taste import each have a pass/fail decision.
- The next implementation plan can use `spikes/results.md` as input.
