# Pockedio v1 Product Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Pockedio v1 as a CLI-first, LLM-powered personal DJ that can run conversational sessions, generate five-song stations, play real NetEase music, store local memory, import taste data, synthesize explicit/scheduled DJ audio through FishAudio, and run scheduled context-aware DJ jobs.

**Architecture:** Implement a local Node.js/TypeScript CLI with small adapters around every external dependency validated by the spikes: NetEase API, FishAudio MLX, Apple Calendar, Open-Meteo, SQLite, and `afplay`. Keep the conversational experience in a high-level orchestrator while every side effect goes through testable adapters. Store durable user data under `~/.pockedio/`, with repo-local fixtures and scripts only for development.

**Tech Stack:** Node.js 24+, TypeScript, Commander, Inquirer, Better SQLite3, Zod, Vitest, OpenAI-compatible LLM adapter, AppleScript through `osascript`, Open-Meteo over `fetch`, FishAudio S2 Pro MLX through the validated Python entrypoint, `afplay`, NetEaseCloudMusicApi local server.

---

## Scope Check

This plan implements v1 product behavior from the approved design and spike results.

In scope:

- `pockedio` conversational terminal session.
- `pockedio setup`.
- `pockedio import-taste <file>`.
- `pockedio serve`.
- `pockedio status`.
- Five-song station generation.
- Real NetEase search, URL retrieval, and local audio playback path.
- Full local transcript storage.
- SQLite-backed memory.
- Normalized CSV taste import and `taste.md` generation/update.
- Optional self-declared MBTI user personality profile during setup.
- DJ persona JSON schedule.
- Explicit user-requested DJ audio.
- Weekday Morning DJ and Evening DJ jobs.
- Automatic mood-check prompts while `serve` is active.
- Graceful fallbacks for all external services.

Out of scope:

- Web app UI.
- Mobile app.
- Multi-user accounts.
- Public hosting.
- Billing, analytics, or telemetry.
- Always-on voice conversation.
- Spoken DJ audio for ordinary user-active playback.
- Automatic diary access without explicit permission.
- Automatic MBTI inference.
- Native macOS EventKit helper unless AppleScript becomes unreliable during implementation.

## Current Spike Decisions To Preserve

- NetEase provider must be behind an adapter and handle unavailable tracks.
- NetEase local API startup uses `spikes/scripts/run_netease_api.sh` and ignored `.cache/npm`.
- Fish TTS uses FishAudio S2 Pro MLX through `.cache/mlx-speech-venv/bin/python .cache/mlx-speech/scripts/generate/fish_s2_pro.py`.
- Fish TTS generated WAV playback works through `afplay`.
- Apple Calendar uses timeout-safe AppleScript and must not commit raw event text.
- Weather uses Open-Meteo and must be optional.
- SQLite is the v1 local database.
- Taste import starts with normalized CSV.
- DJ persona schedule starts as JSON with English default output.

## Runtime Data Layout

Production local data lives outside the repo:

```text
~/.pockedio/
  config.json
  pockedio.sqlite
  taste.md
  personas.json
  audio/
    dj/
  logs/
```

Repo development assets live inside the repo:

```text
src/
tests/
scripts/
spikes/
docs/
```

## Public Command Surface

Only these commands are user-facing:

```bash
pockedio
pockedio setup
pockedio import-taste <file>
pockedio serve
pockedio status
```

Implementation-only flags are allowed for testing, but should not be part of the product docs:

```bash
pockedio serve --run-once morning
pockedio serve --run-once evening
pockedio serve --run-once mood-check
```

## External Dependencies And Required Credentials

- NetEaseCloudMusicApi local server: required for real music search and playable URL retrieval. No credential is required for the validated search path, but account-restricted tracks may require future login support.
- FishAudio S2 Pro MLX model: required for spoken DJ audio. Uses existing local model cache.
- OpenAI-compatible LLM API key: required for LLM-powered conversational understanding and station generation in full-quality mode. Store as `OPENAI_API_KEY` or equivalent provider config. If missing, Pockedio should run in degraded deterministic mode for setup/status/tests and tell the user LLM features are unavailable.
- Apple Calendar permission: required for scheduled DJ Calendar context.
- Open-Meteo: no API key.
- Diary path permission: optional and explicit.

## File Structure

Create these files:

```text
package.json
tsconfig.json
vitest.config.ts
src/cli.ts
src/index.ts
src/config/paths.ts
src/config/schema.ts
src/config/load.ts
src/config/setup.ts
src/db/schema.sql
src/db/migrations.ts
src/db/database.ts
src/memory/store.ts
src/personas/defaultPersonas.ts
src/personas/personaStore.ts
src/taste/csv.ts
src/taste/importTaste.ts
src/taste/tasteMarkdown.ts
src/providers/netease.ts
src/providers/musicProvider.ts
src/player/afplay.ts
src/context/calendar.ts
src/context/weather.ts
src/context/diary.ts
src/context/contextBuilder.ts
src/tts/fishAudio.ts
src/llm/llmClient.ts
src/llm/openaiClient.ts
src/dj/voiceRules.ts
src/dj/productVoice.ts
src/station/stationTypes.ts
src/station/stationGenerator.ts
src/session/intent.ts
src/session/sessionRunner.ts
src/scheduler/jobs.ts
src/scheduler/serve.ts
src/status/status.ts
src/util/result.ts
src/util/time.ts
tests/fixtures/taste-normalized.csv
tests/config.test.ts
tests/db.test.ts
tests/taste.test.ts
tests/personas.test.ts
tests/voiceRules.test.ts
tests/intent.test.ts
tests/stationGenerator.test.ts
tests/contextAdapters.test.ts
tests/status.test.ts
```

## Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `src/index.ts`
- Create: `src/cli.ts`

- [ ] **Step 1: Create Node/TypeScript package**

Create `package.json` with:

```json
{
  "name": "pockedio",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": {
    "pockedio": "dist/cli.js"
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "dev": "tsx src/cli.ts",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "better-sqlite3": "^11.10.0",
    "commander": "^13.1.0",
    "csv-parse": "^5.6.0",
    "inquirer": "^12.5.0",
    "openai": "^4.100.0",
    "zod": "^3.24.4"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.13",
    "@types/node": "^22.15.0",
    "tsx": "^4.19.4",
    "typescript": "^5.8.3",
    "vitest": "^3.1.4"
  }
}
```

- [ ] **Step 2: Create TypeScript config**

Create `tsconfig.json` with:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": ".",
    "types": ["node"]
  },
  "include": ["src/**/*.ts", "tests/**/*.ts", "vitest.config.ts"]
}
```

- [ ] **Step 3: Create Vitest config**

Create `vitest.config.ts` with:

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"]
  }
});
```

- [ ] **Step 4: Create initial CLI entrypoint**

Create `src/index.ts` exporting a version constant:

```typescript
export const pockedioVersion = "0.1.0";
```

Create `src/cli.ts` with Commander wiring for the five public commands. In this first scaffold task, each command should call a temporary `printScaffoldMessage(commandName)` helper that prints `Pockedio <commandName> is wired; implementation continues in the next task.` This helper must be removed as each real command is implemented.

- [ ] **Step 5: Install dependencies and verify scaffold**

Run:

```bash
npm install
npm run typecheck
npm test
```

Expected:

- `npm install` creates `package-lock.json`.
- `npm run typecheck` exits `0`.
- `npm test` exits `0` with no tests found or an empty test suite message accepted by Vitest.

- [ ] **Step 6: Commit scaffold**

Run:

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts src/index.ts src/cli.ts
git commit -m "feat: scaffold pockedio cli project"
```

## Task 2: Config, Paths, And Setup Data Model

**Files:**
- Create: `src/config/paths.ts`
- Create: `src/config/schema.ts`
- Create: `src/config/load.ts`
- Create: `src/config/setup.ts`
- Test: `tests/config.test.ts`
- Modify: `src/cli.ts`

- [ ] **Step 1: Define local paths**

Implement `src/config/paths.ts`:

- `getPockedioHome(env = process.env)`: returns `env.POCKEDIO_HOME` if set, otherwise `~/.pockedio`.
- `getConfigPath(env)`: `<home>/config.json`.
- `getDatabasePath(env)`: `<home>/pockedio.sqlite`.
- `getTastePath(env)`: `<home>/taste.md`.
- `getPersonaPath(env)`: `<home>/personas.json`.
- `getDjAudioDir(env)`: `<home>/audio/dj`.

- [ ] **Step 2: Define config schema**

Implement `src/config/schema.ts` with Zod:

```typescript
export const mbtiTypes = [
  "INTJ", "INTP", "ENTJ", "ENTP",
  "INFJ", "INFP", "ENFJ", "ENFP",
  "ISTJ", "ISFJ", "ESTJ", "ESFJ",
  "ISTP", "ISFP", "ESTP", "ESFP"
] as const;
```

Config fields:

- `netease.baseUrl`, default `http://127.0.0.1:3000`
- `weather.location`, default `Shanghai`
- `calendar.enabled`, default `true`
- `diary.enabled`, default `false`
- `diary.path`, optional
- `personality.mbti`, optional enum from `mbtiTypes`
- `llm.provider`, default `openai`
- `llm.model`, default `gpt-4.1-mini`
- `fishAudio.pythonPath`, default `.cache/mlx-speech-venv/bin/python`
- `fishAudio.scriptPath`, default `.cache/mlx-speech/scripts/generate/fish_s2_pro.py`
- `fishAudio.modelDir`, default validated Hugging Face cache path
- `paths.database`, `paths.taste`, `paths.personas`, `paths.djAudioDir`

- [ ] **Step 3: Implement config load/save**

Implement `src/config/load.ts`:

- `loadConfig(env)`: read config JSON if present; merge with defaults; validate with Zod.
- `saveConfig(config, env)`: create parent directory and write pretty JSON.
- `ensureRuntimeDirs(config)`: create `~/.pockedio`, audio dir, and parent directories.

- [ ] **Step 4: Implement setup command**

Implement `src/config/setup.ts`:

- Use Inquirer to ask for NetEase URL, weather city, Calendar enabled, diary enabled/path, optional MBTI, LLM model, FishAudio paths.
- Always allow MBTI to be unset.
- Write `config.json`.
- Create runtime directories.
- Copy default personas to `personas.json` if missing after Task 5 exists.
- Initialize database after Task 3 exists.

For this task, setup may skip persona/database initialization until those modules exist, but the final implementation must wire them.

- [ ] **Step 5: Add config tests**

Create `tests/config.test.ts` covering:

- `POCKEDIO_HOME` overrides home path.
- Defaults validate.
- Valid MBTI saves and loads.
- Invalid MBTI fails validation.
- Unset MBTI is accepted.

- [ ] **Step 6: Wire setup command**

Update `src/cli.ts` so `pockedio setup` calls `runSetup()`.

- [ ] **Step 7: Verify and commit**

Run:

```bash
npm run typecheck
npm test -- tests/config.test.ts
git add src/config tests/config.test.ts src/cli.ts
git commit -m "feat: add setup configuration model"
```

## Task 3: SQLite Database And Memory Store

**Files:**
- Create: `src/db/schema.sql`
- Create: `src/db/migrations.ts`
- Create: `src/db/database.ts`
- Create: `src/memory/store.ts`
- Test: `tests/db.test.ts`

- [ ] **Step 1: Create schema**

Create `src/db/schema.sql` with tables:

- `sessions(id, started_at, ended_at, trigger_type, trigger_text)`
- `messages(id, session_id, role, content, created_at)`
- `station_tracks(id, session_id, position, title, artist, album, provider, provider_track_id, playable_url, playback_status, failure_reason)`
- `feedback(id, session_id, track_id, action, note, created_at)`
- `memory_items(id, kind, source_session_id, content, metadata_json, created_at)`
- `mood_checks(id, selected_mood, note, created_at)`
- `context_snapshots(id, session_id, calendar_summary, weather_json, diary_summary, personality_json, created_at)`
- `dj_audio(id, session_id, kind, persona_id, text, audio_path, status, created_at)`
- `taste_imports(id, source_file, imported_at, track_count, summary)`
- `settings(key, value_json, updated_at)`

Use CHECK constraints for known enums where practical.

- [ ] **Step 2: Implement migration runner**

`src/db/migrations.ts` should:

- Read schema SQL from `src/db/schema.sql`.
- Ensure database parent directory exists.
- Execute schema with foreign keys enabled.
- Store schema version in `settings`.

- [ ] **Step 3: Implement database open helper**

`src/db/database.ts` should expose:

- `openDatabase(config)`
- `withDatabase(config, fn)`

Always set `PRAGMA foreign_keys = ON`.

- [ ] **Step 4: Implement memory store**

`src/memory/store.ts` should expose:

- `createSession(triggerType, triggerText)`
- `endSession(sessionId)`
- `addMessage(sessionId, role, content)`
- `addStationTrack(sessionId, track)`
- `updateTrackPlayback(trackId, status, failureReason?)`
- `addFeedback(sessionId, trackId, action, note?)`
- `addMemoryItem(kind, content, metadata?, sourceSessionId?)`
- `addContextSnapshot(sessionId, context)`
- `recordDjAudio(sessionId, kind, personaId, text, audioPath, status)`
- `getRecentSessionSummaries(limit)`

- [ ] **Step 5: Add DB tests**

Create `tests/db.test.ts` covering:

- Schema migration creates all tables.
- Full transcript messages can be stored and queried.
- Station tracks and playback failure reasons can be stored.
- Personality JSON can be included in context snapshots.
- Foreign key constraints reject orphan messages.

- [ ] **Step 6: Wire setup initialization**

Update `src/config/setup.ts` so setup initializes the database after saving config.

- [ ] **Step 7: Verify and commit**

Run:

```bash
npm run typecheck
npm test -- tests/db.test.ts tests/config.test.ts
git add src/db src/memory src/config/setup.ts tests/db.test.ts
git commit -m "feat: add sqlite memory store"
```

## Task 4: Persona Schedule Store

**Files:**
- Create: `src/personas/defaultPersonas.ts`
- Create: `src/personas/personaStore.ts`
- Test: `tests/personas.test.ts`
- Modify: `src/config/setup.ts`

- [ ] **Step 1: Add default personas**

Port the validated `spikes/fixtures/dj-personas.json` into `src/personas/defaultPersonas.ts`.

- [ ] **Step 2: Implement persona store**

`src/personas/personaStore.ts` should expose:

- `ensurePersonaFile(config)`
- `loadPersonaConfig(config)`
- `getPersonaForDate(config, date)`
- `validatePersonaConfig(value)`

Rules:

- `defaultLanguage` must be `en` for v1.
- Weekday schedule must cover Monday-Friday.
- Every scheduled persona ID must exist.

- [ ] **Step 3: Add persona tests**

Cover:

- Default config validates.
- Missing scheduled persona fails.
- Monday-Friday schedule resolves.
- Weekend lookup returns a default persona or `null` depending on scheduled-job need; choose `null` for scheduled jobs.

- [ ] **Step 4: Wire setup**

Update setup to create `~/.pockedio/personas.json` if missing.

- [ ] **Step 5: Verify and commit**

Run:

```bash
npm run typecheck
npm test -- tests/personas.test.ts tests/config.test.ts
git add src/personas src/config/setup.ts tests/personas.test.ts
git commit -m "feat: add dj persona schedule config"
```

## Task 5: Taste Import And `taste.md`

**Files:**
- Create: `src/taste/csv.ts`
- Create: `src/taste/importTaste.ts`
- Create: `src/taste/tasteMarkdown.ts`
- Create: `tests/fixtures/taste-normalized.csv`
- Test: `tests/taste.test.ts`
- Modify: `src/cli.ts`

- [ ] **Step 1: Add normalized CSV parser**

Use `csv-parse/sync` in `src/taste/csv.ts`.

Required columns:

- `title`
- `artist`
- `album`
- `source`
- `playlist`
- `liked_at`

Return normalized rows and a validation error listing missing columns.

- [ ] **Step 2: Add taste summary generator**

`src/taste/tasteMarkdown.ts` should generate or update `taste.md` with sections:

- `# Pockedio Taste`
- `## Imported Signals`
- `## High-Confidence Artists`
- `## Situational Playlists`
- `## Source Coverage`
- `## Notes For Future Editing`

Keep it human editable and deterministic.

- [ ] **Step 3: Implement import workflow**

`src/taste/importTaste.ts` should:

- Parse normalized CSV.
- Store raw imported track signal summaries in SQLite.
- Write/update `taste.md`.
- Add a `taste_imports` row.
- Return `{ trackCount, artists, playlists, tastePath }`.

- [ ] **Step 4: Add tests**

Cover:

- Valid fixture imports 3 tracks.
- Missing required column fails.
- `taste.md` includes artists and playlists.
- Import writes a `taste_imports` row.

- [ ] **Step 5: Wire `pockedio import-taste <file>`**

Update `src/cli.ts` to call import workflow and print a concise result.

- [ ] **Step 6: Verify and commit**

Run:

```bash
npm run typecheck
npm test -- tests/taste.test.ts tests/db.test.ts
git add src/taste tests/fixtures tests/taste.test.ts src/cli.ts
git commit -m "feat: add normalized taste import"
```

## Task 6: Provider Adapters And Playback

**Files:**
- Create: `src/providers/musicProvider.ts`
- Create: `src/providers/netease.ts`
- Create: `src/player/afplay.ts`
- Test: `tests/providerAdapters.test.ts`
- Modify: `src/status/status.ts`

- [ ] **Step 1: Define music provider interface**

`src/providers/musicProvider.ts` should define:

- `MusicSearchQuery`
- `MusicTrackCandidate`
- `PlayableTrack`
- `MusicProvider`

Required methods:

- `search(query, limit)`
- `getPlayableUrl(trackId)`

- [ ] **Step 2: Implement NetEase provider**

`src/providers/netease.ts` should:

- Use configured `baseUrl`.
- Call `/search?keywords=...&limit=...`.
- Call `/song/url/v1?id=...&level=standard`.
- Normalize artist names.
- Return unavailable status when URL is missing.
- Never throw raw API response with sensitive data; wrap errors.

- [ ] **Step 3: Implement `afplay` player**

`src/player/afplay.ts` should:

- `playUrl(url)`
- `playFile(path)`
- Spawn `afplay`.
- Return status and exit code.
- Support timeout for tests and DJ audio.

- [ ] **Step 4: Add adapter tests**

Use fake `fetch` and fake process runner to test:

- Search success.
- No song results.
- Playable URL success.
- Missing URL returns unavailable.
- Player wraps non-zero exit.

- [ ] **Step 5: Verify with real NetEase server manually**

Run:

```bash
spikes/scripts/run_netease_api.sh
npm run dev -- status
```

Expected: status can report NetEase API reachable.

Stop NetEase after the manual check.

- [ ] **Step 6: Verify and commit**

Run:

```bash
npm run typecheck
npm test -- tests/providerAdapters.test.ts
git add src/providers src/player tests/providerAdapters.test.ts src/status/status.ts
git commit -m "feat: add netease music provider"
```

## Task 7: Context Adapters

**Files:**
- Create: `src/context/calendar.ts`
- Create: `src/context/weather.ts`
- Create: `src/context/diary.ts`
- Create: `src/context/contextBuilder.ts`
- Test: `tests/contextAdapters.test.ts`

- [ ] **Step 1: Implement Calendar adapter**

Use the validated timeout-safe pattern:

- Spawn `osascript spikes/scripts/apple_calendar_probe.applescript` or move the AppleScript body into `src/context/calendar.ts` as a string.
- Timeout default: 20 seconds.
- Return sanitized event objects internally.
- Provide a summary string to station generation.
- Never write raw Calendar text into repo files.

- [ ] **Step 2: Implement Weather adapter**

Use Open-Meteo:

- Geocode configured city.
- Fetch current temperature, humidity, precipitation, weather code, wind speed.
- Return `null` on failure with a user-safe warning.

- [ ] **Step 3: Implement Diary adapter**

For v1 foundation:

- If diary disabled, return `null`.
- If enabled, read only the newest text/markdown file under configured path.
- Return a short deterministic local summary containing the latest diary filename and last modified date until LLM summarization exists.
- Do not read diary unless config says enabled.

- [ ] **Step 4: Implement context builder**

`src/context/contextBuilder.ts` should combine:

- time of day
- weather
- calendar summary
- diary summary
- taste summary path
- personality profile
- recent memory summaries

- [ ] **Step 5: Add tests**

Cover:

- Calendar timeout returns unavailable instead of hanging.
- Weather failure returns optional context.
- Diary disabled does not read files.
- MBTI appears in context when configured.

- [ ] **Step 6: Verify and commit**

Run:

```bash
npm run typecheck
npm test -- tests/contextAdapters.test.ts tests/config.test.ts
git add src/context tests/contextAdapters.test.ts
git commit -m "feat: add local context adapters"
```

## Task 8: FishAudio TTS Adapter And Voice Rules

**Files:**
- Create: `src/tts/fishAudio.ts`
- Create: `src/dj/voiceRules.ts`
- Test: `tests/voiceRules.test.ts`

- [x] **Step 1: Implement voice rules**

`src/dj/voiceRules.ts` should expose:

- `shouldUseSpokenDjAudio({ triggerType, userExplicitlyRequestedDjAudio, now })`

Return `true` only for:

- scheduled morning DJ
- scheduled evening DJ
- explicit user-requested DJ audio

Return `false` for normal playback requests.

- [x] **Step 2: Implement FishAudio adapter**

`src/tts/fishAudio.ts` should:

- Use config paths from spike result.
- Generate unique WAV path under `~/.pockedio/audio/dj`.
- Spawn Python with `fish_s2_pro.py --text ... --model-dir ... --output ...`.
- Return `{ ok, audioPath, latencyMs, error? }`.
- Never require user review before playback.
- Let caller decide text fallback if generation fails.

- [x] **Step 3: Add tests**

Cover:

- Normal playback does not trigger voice.
- Morning/evening triggers voice.
- Explicit request triggers voice.
- Failed TTS returns structured failure.

- [x] **Step 4: Add manual FishAudio check**

Run:

```bash
npm run dev -- status
```

Expected: status reports FishAudio paths present.

- [x] **Step 5: Verify and commit**

Run:

```bash
npm run typecheck
npm test -- tests/voiceRules.test.ts
git add src/tts src/dj tests/voiceRules.test.ts
git commit -m "feat: add fishaudio tts adapter"
```

## Task 9: LLM Adapter, Intent Parsing, And Station Generation

**Files:**
- Create: `src/llm/llmClient.ts`
- Create: `src/llm/openaiClient.ts`
- Create: `src/station/stationTypes.ts`
- Create: `src/station/stationGenerator.ts`
- Create: `src/session/intent.ts`
- Test: `tests/intent.test.ts`
- Test: `tests/stationGenerator.test.ts`

- [x] **Step 1: Define LLM interface**

`src/llm/llmClient.ts` should expose:

- `generateJson(prompt, schemaDescription)`
- `generateText(prompt)`

If no API key is configured, return a structured `llm_unavailable` result.

- [x] **Step 2: Implement OpenAI-compatible client**

`src/llm/openaiClient.ts` should use the `openai` package and configured model.

Behavior:

- Read API key from `OPENAI_API_KEY`.
- Keep prompts free of raw diary text unless diary context is already summarized.
- Request JSON for station planning.

- [x] **Step 3: Implement intent parser**

`src/session/intent.ts` should classify:

- `conversation`
- `playback_request`
- `direct_playback_request`
- `feedback_like`
- `feedback_skip`
- `feedback_ban`
- `feedback_more_like_this`
- `feedback_change_vibe`
- `stop`
- `explicit_dj_audio_request`

Use lightweight deterministic rules first, then LLM fallback when available.

- [x] **Step 4: Implement station generator**

`src/station/stationGenerator.ts` should:

- Produce exactly five track search queries.
- Include context summary, taste summary, recent feedback, and personality profile.
- Ask LLM for JSON with `tracks: [{ title, artist, rationale }]`.
- If LLM unavailable, use deterministic fallback queries from user intent and taste data.
- Resolve each query through NetEase provider.
- Return station with unavailable-track entries included, not thrown.

- [x] **Step 5: Add tests**

Cover:

- "play it directly" maps to direct playback.
- Explicit DJ audio request maps to `explicit_dj_audio_request`.
- Ordinary "play jazz" does not trigger spoken DJ audio.
- Station generator returns five planned tracks.
- Missing LLM key uses fallback path.
- Unavailable provider result does not crash station generation.

- [x] **Step 6: Verify and commit**

Run:

```bash
npm run typecheck
npm test -- tests/intent.test.ts tests/stationGenerator.test.ts
git add src/llm src/station src/session tests/intent.test.ts tests/stationGenerator.test.ts
git commit -m "feat: add intent and station generation"
```

## Task 10: Conversational Session Runner

**Files:**
- Create: `src/session/sessionRunner.ts`
- Create: `src/dj/productVoice.ts`
- Modify: `src/cli.ts`

- [x] **Step 1: Implement product voice helpers**

`src/dj/productVoice.ts` should format:

- station intro
- direct playback confirmation
- unavailable-track fallback
- feedback confirmation
- DJ audio fallback text

Default output language: English.

- [x] **Step 2: Implement session runner**

`src/session/sessionRunner.ts` should:

- Start a SQLite session.
- Read terminal input line by line.
- Store every user message.
- Parse intent.
- For playback intent, build context, generate station, store station, start playback.
- For feedback intent, store feedback.
- For explicit DJ audio, generate text, synthesize FishAudio, play audio, store metadata.
- Store every Pockedio response.
- Exit cleanly on `stop`, `quit`, or Ctrl-C.

- [x] **Step 3: Enforce voice rule**

Normal user-active playback must not call FishAudio unless intent is explicit DJ audio.

- [x] **Step 4: Wire default `pockedio` command**

Update `src/cli.ts` so no subcommand runs the session.

- [x] **Step 5: Manual acceptance check**

Run:

```bash
spikes/scripts/run_netease_api.sh
npm run dev
```

Type:

```text
play something for deep work
```

Expected:

- Pockedio stores the input.
- Pockedio creates five tracks.
- Pockedio starts playback or reports unavailable tracks gracefully.
- No FishAudio voice plays.

- [x] **Step 6: Verify and commit**

Run:

```bash
npm run typecheck
npm test
git add src/session src/dj src/cli.ts
git commit -m "feat: add conversational dj session"
```

## Task 11: Status Command

**Files:**
- Create: `src/status/status.ts`
- Test: `tests/status.test.ts`
- Modify: `src/cli.ts`

- [x] **Step 1: Implement health checks**

`src/status/status.ts` should report:

- config present/missing
- database present/migrated
- NetEase API reachable
- FishAudio paths present
- Calendar enabled
- weather location
- taste.md present
- persona config present
- latest session timestamp

- [x] **Step 2: Wire status command**

`pockedio status` should print concise text, not JSON by default.

- [x] **Step 3: Add tests**

Cover missing config and healthy configured home.

- [x] **Step 4: Verify and commit**

Run:

```bash
npm run typecheck
npm test -- tests/status.test.ts
git add src/status src/cli.ts tests/status.test.ts
git commit -m "feat: add status command"
```

## Task 12: Scheduled DJ Jobs And Mood Checks

**Files:**
- Create: `src/scheduler/jobs.ts`
- Create: `src/scheduler/serve.ts`
- Modify: `src/cli.ts`

- [x] **Step 1: Implement scheduled job decision logic**

`src/scheduler/jobs.ts` should expose:

- `isWeekday(date)`
- `isMorningDjTime(date)` for 8:45 AM.
- `isEveningDjTime(date)` for 5:00 PM.
- `shouldPromptMoodCheck(lastPromptAt, now)` hourly.

- [x] **Step 2: Implement Morning DJ job**

Morning job should:

- Build context with Calendar, weather, diary if enabled, taste, memory, MBTI.
- Select weekday persona.
- Generate concise English DJ copy.
- Synthesize FishAudio.
- Play audio directly.
- Start music.
- Store all text/audio/playback metadata.
- If FishAudio fails, show text and continue to music when appropriate.

- [x] **Step 3: Implement Evening DJ job**

Evening job should follow Morning DJ but emphasize remaining agenda, decompression, commute, continued focus, or transition.

- [x] **Step 4: Implement mood check prompt**

Mood check should:

- Prompt from `serve`, not require typed command.
- Offer options: focused, scattered, tired, restless, calm, heavy, free text.
- Store selected mood.
- Suggest music.
- Require confirmation before playback.

- [x] **Step 5: Wire `pockedio serve`**

`src/scheduler/serve.ts` should:

- Run loop every 30 seconds.
- Avoid duplicate scheduled jobs in the same day/time window.
- Respect Calendar busy blocks in future refinement; for v1, at least avoid starting scheduled audio if current Calendar summary indicates a meeting is active.
- Support implementation flags:
  - `--run-once morning`
  - `--run-once evening`
  - `--run-once mood-check`

- [x] **Step 6: Manual acceptance checks**

Run:

```bash
npm run dev -- serve --run-once morning
npm run dev -- serve --run-once evening
npm run dev -- serve --run-once mood-check
```

Expected:

- Morning/evening generate DJ copy, attempt FishAudio, and do not ask for audio review.
- Mood check prompts with options and requires confirmation before playback.

- [x] **Step 7: Verify and commit**

Run:

```bash
npm run typecheck
npm test
git add src/scheduler src/cli.ts
git commit -m "feat: add scheduled dj jobs"
```

## Task 13: End-To-End Product Acceptance

**Files:**
- Modify: `README.md`
- Create: `docs/v1-acceptance.md`

- [ ] **Step 1: Document local setup**

Update `README.md` with:

- `npm install`
- `npm run build`
- `npm link` or `npm run dev`
- starting NetEase API through `spikes/scripts/run_netease_api.sh`
- `pockedio setup`
- `pockedio import-taste <file>`
- `pockedio`
- `pockedio serve`
- `pockedio status`

- [ ] **Step 2: Create acceptance checklist**

Create `docs/v1-acceptance.md` with checks for every acceptance criterion in the design spec.

- [ ] **Step 3: Run full automated verification**

Run:

```bash
npm run typecheck
npm test
npm run build
```

Expected: all pass.

- [ ] **Step 4: Run manual smoke test**

Run:

```bash
spikes/scripts/run_netease_api.sh
npm run dev -- setup
npm run dev -- import-taste spikes/fixtures/taste-normalized.csv
npm run dev -- status
npm run dev
```

Manual input:

```text
play something for deep work
```

Expected:

- five-song station generated
- real playback starts or unavailable tracks are handled
- session transcript stored in SQLite
- no spoken DJ audio for ordinary playback

Then run:

```bash
npm run dev
```

Manual input:

```text
make me a short DJ intro for tonight
```

Expected:

- FishAudio generates and plays DJ audio directly
- audio metadata is stored

- [ ] **Step 5: Commit docs and acceptance**

Run:

```bash
git add README.md docs/v1-acceptance.md
git commit -m "docs: add v1 acceptance checklist"
```

## Self-Review Checklist

- The command surface remains limited to `pockedio`, `setup`, `import-taste`, `serve`, and `status`.
- Ordinary playback never triggers spoken DJ audio.
- Spoken DJ audio only happens for Morning DJ, Evening DJ, or explicit user request.
- FishAudio is wrapped behind an adapter with text fallback.
- NetEase is wrapped behind an adapter with unavailable-track fallback.
- Calendar raw text is never committed.
- Diary is never read unless explicitly enabled.
- MBTI is optional, self-declared, updateable, and not inferred.
- Every session message is stored in SQLite.
- `taste.md` is generated but not the only durable memory.
- Scheduled jobs use weekday persona config.
- Weather is optional.
- Full product verification includes automated tests plus manual playback/audio checks.

## Execution Recommendation

Execute this plan in order. Do not start Task 10 before Tasks 2-9 are complete because the session runner depends on config, memory, personas, taste, providers, context, TTS, voice rules, and station generation.

The most useful first PR boundary is Tasks 1-5: CLI scaffold, setup, SQLite memory, personas, and taste import. The second boundary is Tasks 6-11: provider adapters, context, TTS, station generation, session runner, and status. The third boundary is Tasks 12-13: scheduled jobs and acceptance docs.
