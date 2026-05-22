# Pockedio v1 Blocker Burndown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the remaining technical spike blockers into validated, repeatable local probes before any Pockedio product implementation begins.

**Architecture:** This plan stays inside the spike workspace and local tool cache. It does not build the Pockedio CLI. It makes the NetEase API startup repeatable without relying on the broken global npm cache, validates Fish Audio S2 Pro through a real MLX runtime against the already-downloaded model, and replaces the hanging Calendar probe with timeout-safe AppleScript plus an EventKit fallback probe.

**Tech Stack:** Shell, Node.js, `uv`, Python 3.12, MLX/FishAudio S2 Pro through `mlx-speech`, Swift/EventKit, AppleScript, `afplay`, SQLite-free Markdown result updates.

---

## Scope Check

This plan only burns down blockers discovered in `spikes/results.md`.

In scope:

- Make NetEase API startup repeatable with a local npm cache.
- Validate or reject the existing FishAudio S2 Pro MLX model as the v1 local Fish TTS path.
- Validate or reject Apple Calendar access through a timeout-safe AppleScript probe and an EventKit fallback.
- Update `spikes/results.md` with new pass/fail decisions.

Out of scope:

- Pockedio CLI implementation.
- Conversational DJ session.
- Scheduled Morning DJ or Evening DJ jobs.
- Music station generation.
- Durable production database implementation.
- Diary access.
- Replacing Fish TTS with edge-tts. The hand-off states Fish is required for v1 spoken DJ audio; edge-tts remains rejected for v1 voice.

## Current Evidence

- NetEase search and URL retrieval passed, but `npx NeteaseCloudMusicApi@latest` initially failed because `~/.npm` contains root-owned files. It worked with `npm_config_cache=/tmp/pockedio-npm-cache`.
- FishAudio S2 Pro MLX model exists at `~/.cache/huggingface/hub/models--appautomaton--fishaudio-s2-pro-8bit-mlx/snapshots/29ab46393de21f696a82050d8594a677a5797f7e`.
- The user confirmed the model was downloaded by Claude Code, but no `fish-server.py` was written and prior TTS usage went through edge-tts.
- The AppAutomaton model card says the MLX model is intended for `mlx-speech` and shows `scripts/generate/fish_s2_pro.py` with `--model-dir` and `--output`.
- Apple's Calendar scripting guide confirms Calendar supports AppleScript/JXA scripting.
- Apple's EventKit documentation describes requesting calendar event-store access; EventKit is the fallback if AppleScript remains unreliable.

## Files Created Or Modified By This Plan

- Modify: `.gitignore`
- Create: `spikes/scripts/run_netease_api.sh`
- Create: `spikes/scripts/fish_tts_mlx_probe.sh`
- Create: `spikes/scripts/run_osascript_with_timeout.mjs`
- Create: `spikes/scripts/apple_calendar_eventkit_probe.swift`
- Modify: `spikes/apple-calendar-current-day.txt`
- Modify: `spikes/fish-tts-entrypoints.txt`
- Modify: `spikes/fish-tts-latency.txt`
- Modify: `spikes/results.md`

Generated but not committed:

- `.cache/`
- `spikes/fish-tts-sample.wav` unless it is small enough and explicitly useful to keep
- raw Calendar output under `/tmp`

## Task 1: Make NetEase Startup Repeatable

**Files:**
- Modify: `.gitignore`
- Create: `spikes/scripts/run_netease_api.sh`
- Modify: `spikes/results.md`

- [ ] **Step 1: Add local cache directory to `.gitignore`**

Add this line to `.gitignore`:

```gitignore
.cache/
```

Expected: `git status --short` shows `.gitignore` modified.

- [ ] **Step 2: Create `spikes/scripts/run_netease_api.sh`**

Write this exact content:

```bash
#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cache_dir="${POCKEDIO_NPM_CACHE:-"$repo_root/.cache/npm"}"
mkdir -p "$cache_dir"

echo "Using npm cache: $cache_dir"
NPM_CONFIG_CACHE="$cache_dir" npx -y NeteaseCloudMusicApi@latest
```

- [ ] **Step 3: Make the script executable**

Run:

```bash
chmod +x spikes/scripts/run_netease_api.sh
```

Expected: command exits `0`.

- [ ] **Step 4: Start NetEase with the local cache script**

Run in a terminal session:

```bash
spikes/scripts/run_netease_api.sh
```

Expected: output includes `Using npm cache:` and the API server starts on `http://localhost:3000`.

- [ ] **Step 5: Re-run the NetEase probe**

Run:

```bash
node spikes/scripts/netease_probe.mjs | tee spikes/netease-result.json
```

Expected: JSON includes `"songCount": 5` or another positive count, and `"playable": true` for the probed track.

- [ ] **Step 6: Update the NetEase decision in `spikes/results.md`**

Replace the npm cache blocker under `Final Recommendation` with:

```markdown
  - NetEase local API startup now uses `spikes/scripts/run_netease_api.sh`, which isolates npm cache under `.cache/npm`.
```

Keep the provider-adapter and unavailable-track constraints.

- [ ] **Step 7: Stop the NetEase server**

Find the process:

```bash
pgrep -fl 'NeteaseCloudMusicApi|node .*/NeteaseCloudMusicApi' || true
```

Then stop only the matching local spike server process:

```bash
pkill -f 'NeteaseCloudMusicApi' || true
```

Expected: a second `pgrep` shows no NetEase API server.

- [ ] **Step 8: Commit NetEase startup fix**

Run:

```bash
git add .gitignore spikes/scripts/run_netease_api.sh spikes/netease-result.json spikes/results.md
git commit -m "spike: make netease api startup repeatable"
```

Expected: commit succeeds.

## Task 2: Validate FishAudio S2 Pro Through MLX Runtime

**Files:**
- Create: `spikes/scripts/fish_tts_mlx_probe.sh`
- Modify: `spikes/fish-tts-entrypoints.txt`
- Modify: `spikes/fish-tts-latency.txt`
- Modify: `spikes/results.md`

- [ ] **Step 1: Confirm `uv` is available**

Run:

```bash
command -v uv && uv --version
```

Expected: output includes the `uv` path and version. If `uv` is not available, stop this task and record Fish TTS as blocked by missing Python environment manager.

- [ ] **Step 2: Create `spikes/scripts/fish_tts_mlx_probe.sh`**

Write this exact content:

```bash
#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
model_dir="${FISH_AUDIO_MODEL_DIR:-"$HOME/.cache/huggingface/hub/models--appautomaton--fishaudio-s2-pro-8bit-mlx/snapshots/29ab46393de21f696a82050d8594a677a5797f7e"}"
runtime_dir="$repo_root/.cache/mlx-speech"
venv_dir="$repo_root/.cache/mlx-speech-venv"
output_file="$repo_root/spikes/fish-tts-sample.wav"
latency_file="$repo_root/spikes/fish-tts-latency.txt"

if [ ! -f "$model_dir/model.safetensors" ] || [ ! -f "$model_dir/codec-mlx/model.safetensors" ]; then
  echo "FishAudio MLX model is incomplete at $model_dir" | tee "$latency_file"
  exit 2
fi

if [ ! -d "$runtime_dir/.git" ]; then
  git clone https://github.com/appautomaton/mlx-speech.git "$runtime_dir"
fi

uv venv "$venv_dir" --python 3.12
uv pip install --python "$venv_dir/bin/python" -e "$runtime_dir"

{
  echo "Model dir: $model_dir"
  echo "Runtime dir: $runtime_dir"
  echo "Python: $("$venv_dir/bin/python" --version)"
  echo "Command: $venv_dir/bin/python $runtime_dir/scripts/generate/fish_s2_pro.py --text 'Pockedio is on air.' --model-dir '$model_dir' --output '$output_file'"
  time "$venv_dir/bin/python" "$runtime_dir/scripts/generate/fish_s2_pro.py" \
    --text "Pockedio is on air." \
    --model-dir "$model_dir" \
    --output "$output_file"
  file "$output_file"
} 2>&1 | tee "$latency_file"

test -s "$output_file"
```

- [ ] **Step 3: Make the script executable**

Run:

```bash
chmod +x spikes/scripts/fish_tts_mlx_probe.sh
```

Expected: command exits `0`.

- [ ] **Step 4: Run the FishAudio MLX probe**

Run:

```bash
spikes/scripts/fish_tts_mlx_probe.sh
```

Expected success path:

- `.cache/mlx-speech` exists.
- `.cache/mlx-speech-venv` exists.
- `spikes/fish-tts-sample.wav` exists and is non-empty.
- `spikes/fish-tts-latency.txt` includes the exact command and timing output.

Expected failure path:

- `spikes/fish-tts-latency.txt` contains the failing command and error.
- `spikes/results.md` remains blocked for Fish TTS.

- [ ] **Step 5: Play the generated sample if the file exists**

Run:

```bash
test -s spikes/fish-tts-sample.wav && afplay spikes/fish-tts-sample.wav
```

Expected: the sample says `Pockedio is on air.`

- [ ] **Step 6: Update `spikes/fish-tts-entrypoints.txt`**

Append:

```text
FishAudio S2 Pro MLX runtime candidate:
- Runtime: .cache/mlx-speech
- Entrypoint: .cache/mlx-speech/scripts/generate/fish_s2_pro.py
- Model: ~/.cache/huggingface/hub/models--appautomaton--fishaudio-s2-pro-8bit-mlx/snapshots/29ab46393de21f696a82050d8594a677a5797f7e
- Output: spikes/fish-tts-sample.wav
```

- [ ] **Step 7: Update Fish TTS section in `spikes/results.md`**

If the probe and `afplay` succeeded, use:

```markdown
## Fish TTS

- Local command or Python entrypoint: `.cache/mlx-speech-venv/bin/python .cache/mlx-speech/scripts/generate/fish_s2_pro.py`
- Model path/name: `~/.cache/huggingface/hub/models--appautomaton--fishaudio-s2-pro-8bit-mlx/snapshots/29ab46393de21f696a82050d8594a677a5797f7e`
- Output format: wav
- Generation latency: measured in `spikes/fish-tts-latency.txt`
- Playback command: `afplay spikes/fish-tts-sample.wav`
- Decision: use FishAudio S2 Pro through MLX for v1 spoken DJ audio; wrap invocation behind a production TTS adapter and keep text fallback for runtime failures
```

If the probe failed, use:

```markdown
## Fish TTS

- Local command or Python entrypoint: attempted `.cache/mlx-speech-venv/bin/python .cache/mlx-speech/scripts/generate/fish_s2_pro.py`
- Model path/name: `~/.cache/huggingface/hub/models--appautomaton--fishaudio-s2-pro-8bit-mlx/snapshots/29ab46393de21f696a82050d8594a677a5797f7e`
- Output format: not validated
- Generation latency: failed probe recorded in `spikes/fish-tts-latency.txt`
- Playback command: not validated
- Decision: FishAudio S2 Pro model exists but runtime remains blocked; do not implement spoken DJ audio until a local Fish runtime is chosen and validated
```

- [ ] **Step 8: Commit Fish TTS runtime result**

If `spikes/fish-tts-sample.wav` is under 2 MB, commit it with:

```bash
git add spikes/scripts/fish_tts_mlx_probe.sh spikes/fish-tts-entrypoints.txt spikes/fish-tts-latency.txt spikes/results.md
git add -f spikes/fish-tts-sample.wav
git commit -m "spike: validate fishaudio mlx tts runtime"
```

If `spikes/fish-tts-sample.wav` is 2 MB or larger, do not commit the audio:

```bash
git add spikes/scripts/fish_tts_mlx_probe.sh spikes/fish-tts-entrypoints.txt spikes/fish-tts-latency.txt spikes/results.md
git commit -m "spike: validate fishaudio mlx tts runtime"
```

Expected: commit succeeds.

## Task 3: Make Calendar Probe Timeout-Safe

**Files:**
- Create: `spikes/scripts/run_osascript_with_timeout.mjs`
- Modify: `spikes/apple-calendar-current-day.txt`
- Modify: `spikes/results.md`

- [ ] **Step 1: Create `spikes/scripts/run_osascript_with_timeout.mjs`**

Write this exact content:

```javascript
import { spawn } from "node:child_process";
import fs from "node:fs";

const scriptPath = process.argv[2] || "spikes/scripts/apple_calendar_probe.applescript";
const timeoutMs = Number(process.env.POCKEDIO_CALENDAR_TIMEOUT_MS || 20000);
const rawOut = "/tmp/pockedio-apple-calendar-current-day.raw.txt";
const rawErr = "/tmp/pockedio-apple-calendar-error.txt";

const child = spawn("osascript", [scriptPath], { stdio: ["ignore", "pipe", "pipe"] });
let stdout = "";
let stderr = "";
let timedOut = false;

const timer = setTimeout(() => {
  timedOut = true;
  child.kill("SIGTERM");
  setTimeout(() => child.kill("SIGKILL"), 1000).unref();
}, timeoutMs);

child.stdout.on("data", (chunk) => {
  stdout += chunk.toString();
});

child.stderr.on("data", (chunk) => {
  stderr += chunk.toString();
});

child.on("close", (code, signal) => {
  clearTimeout(timer);
  fs.writeFileSync(rawOut, stdout);
  fs.writeFileSync(rawErr, stderr);

  const eventLines = stdout.split(/\r?\n/).filter(Boolean).length;
  const summary = {
    ok: !timedOut && code === 0,
    timedOut,
    code,
    signal,
    timeoutMs,
    eventLines,
    rawOutputPath: rawOut,
    rawErrorPath: rawErr,
    fieldsRequested: ["calendar name", "summary", "start date", "end date"],
    errorSummary: stderr.split(/\r?\n/).find(Boolean) || null
  };

  console.log(JSON.stringify(summary, null, 2));
  process.exit(summary.ok ? 0 : 1);
});
```

- [ ] **Step 2: Run the timeout-safe AppleScript probe**

Run:

```bash
POCKEDIO_CALENDAR_TIMEOUT_MS=20000 node spikes/scripts/run_osascript_with_timeout.mjs | tee spikes/apple-calendar-current-day.txt
```

Expected success path: JSON includes `"ok": true` and `"timedOut": false`.

Expected failure path: JSON includes `"ok": false` and either `"timedOut": true` or an `errorSummary`.

- [ ] **Step 3: Update Calendar result if AppleScript succeeds**

If Step 2 succeeds, update `spikes/results.md`:

```markdown
## Apple Calendar

- Current-date read works: yes
- Permission behavior: AppleScript completed through timeout-safe wrapper; raw event text is written only to `/tmp` and not committed
- Event fields available: calendar name, summary, start date, end date
- Decision: use AppleScript through a timeout wrapper for v1 Calendar context; production setup must guide macOS Calendar/Automation permission
```

Then skip Task 4 and continue to Task 5.

- [ ] **Step 4: Commit timeout-safe AppleScript result**

Run:

```bash
git add spikes/scripts/run_osascript_with_timeout.mjs spikes/apple-calendar-current-day.txt spikes/results.md
git commit -m "spike: make apple calendar probe timeout safe"
```

Expected: commit succeeds.

## Task 4: Validate EventKit Calendar Fallback

**Files:**
- Create: `spikes/scripts/apple_calendar_eventkit_probe.swift`
- Modify: `spikes/apple-calendar-current-day.txt`
- Modify: `spikes/results.md`

- [ ] **Step 1: Create `spikes/scripts/apple_calendar_eventkit_probe.swift`**

Write this exact content:

```swift
import EventKit
import Foundation

let store = EKEventStore()
let semaphore = DispatchSemaphore(value: 0)
let calendar = Calendar.current
let startOfDay = calendar.startOfDay(for: Date())
let endOfDay = calendar.date(byAdding: .day, value: 1, to: startOfDay)!

func printJson(_ object: [String: Any]) {
    let data = try! JSONSerialization.data(withJSONObject: object, options: [.prettyPrinted, .sortedKeys])
    print(String(data: data, encoding: .utf8)!)
}

func readEvents() {
    let predicate = store.predicateForEvents(withStart: startOfDay, end: endOfDay, calendars: nil)
    let events = store.events(matching: predicate)
    printJson([
        "ok": true,
        "eventCount": events.count,
        "fieldsAvailable": ["calendarTitle", "title", "startDate", "endDate"],
        "rawEventTextCommitted": false
    ])
}

if #available(macOS 14.0, *) {
    store.requestFullAccessToEvents { granted, error in
        if granted {
            readEvents()
        } else {
            printJson([
                "ok": false,
                "eventCount": 0,
                "fieldsAvailable": [],
                "error": error?.localizedDescription ?? "Calendar access was not granted"
            ])
        }
        semaphore.signal()
    }
} else {
    store.requestAccess(to: .event) { granted, error in
        if granted {
            readEvents()
        } else {
            printJson([
                "ok": false,
                "eventCount": 0,
                "fieldsAvailable": [],
                "error": error?.localizedDescription ?? "Calendar access was not granted"
            ])
        }
        semaphore.signal()
    }
}

_ = semaphore.wait(timeout: .now() + 30)
```

- [ ] **Step 2: Compile the EventKit probe**

Run:

```bash
mkdir -p .cache/bin
swiftc spikes/scripts/apple_calendar_eventkit_probe.swift -framework EventKit -o .cache/bin/apple-calendar-eventkit-probe
```

Expected: command exits `0` and `.cache/bin/apple-calendar-eventkit-probe` exists.

- [ ] **Step 3: Run the EventKit probe**

Run:

```bash
.cache/bin/apple-calendar-eventkit-probe | tee spikes/apple-calendar-current-day.txt
```

Expected success path: JSON includes `"ok": true` and `"fieldsAvailable"` includes `calendarTitle`, `title`, `startDate`, and `endDate`.

Expected failure path: JSON includes `"ok": false` and an `error` string.

- [ ] **Step 4: Update Calendar result after EventKit**

If Step 3 succeeds, update `spikes/results.md`:

```markdown
## Apple Calendar

- Current-date read works: yes
- Permission behavior: EventKit requested Calendar access and returned a sanitized current-date event count
- Event fields available: calendar title, title, start date, end date
- Decision: use EventKit/native helper for v1 Calendar context instead of raw AppleScript when running under `pockedio setup` or `pockedio serve`
```

If Step 3 fails, update `spikes/results.md`:

```markdown
## Apple Calendar

- Current-date read works: no
- Permission behavior: AppleScript timed out or failed, and EventKit fallback also failed; see `spikes/apple-calendar-current-day.txt`
- Event fields available: not validated
- Decision: Calendar remains a hard blocker for scheduled DJ context; do not implement Morning DJ or Evening DJ Calendar reads until macOS permission flow is fixed
```

- [ ] **Step 5: Commit EventKit fallback result**

Run:

```bash
git add spikes/scripts/apple_calendar_eventkit_probe.swift spikes/apple-calendar-current-day.txt spikes/results.md
git commit -m "spike: validate eventkit calendar fallback"
```

Expected: commit succeeds.

## Task 5: Final Gate Update

**Files:**
- Modify: `spikes/results.md`

- [ ] **Step 1: Review blocker state**

Run:

```bash
sed -n '1,220p' spikes/results.md
```

Expected: Fish TTS and Apple Calendar sections now each have a pass/fail decision based on rerun probes.

- [ ] **Step 2: Set final recommendation**

If Fish TTS and Apple Calendar both pass, set:

```markdown
## Final Recommendation

- Product implementation can start: yes for the CLI foundation and provider adapters
- Blockers: none for v1 foundation; scheduled DJ implementation must still keep runtime fallbacks
- Required implementation constraints:
  - NetEase provider must be behind an adapter and handle unavailable tracks.
  - Fish TTS must be behind a TTS adapter and keep text fallback for runtime failures.
  - Apple Calendar access must be configured during setup and never commit raw event text.
  - Weather context must be optional.
  - SQLite is the v1 local database if the memory probe passed.
  - Taste import starts with normalized CSV.
  - DJ persona schedule starts as JSON config with English default output.
```

If either Fish TTS or Apple Calendar fails, set:

```markdown
## Final Recommendation

- Product implementation can start: only for non-scheduled, non-spoken CLI foundation; do not implement scheduled DJ voice or Calendar-dependent scenes yet
- Blockers:
  - Fish TTS: pass/fail state is recorded above.
  - Apple Calendar: pass/fail state is recorded above.
- Required implementation constraints:
  - NetEase provider must be behind an adapter and handle unavailable tracks.
  - Fish TTS must be behind a TTS adapter and keep text fallback for runtime failures.
  - Apple Calendar access must be configured during setup and never commit raw event text.
  - Weather context must be optional.
  - SQLite is the v1 local database if the memory probe passed.
  - Taste import starts with normalized CSV.
  - DJ persona schedule starts as JSON config with English default output.
```

- [ ] **Step 3: Verify generated artifacts**

Run:

```bash
node -e 'for (const file of ["spikes/netease-result.json","spikes/weather-result.json","spikes/taste-import-result.json","spikes/dj-personas-result.json","spikes/fixtures/dj-personas.json"]) { JSON.parse(require("fs").readFileSync(file,"utf8")); console.log(`json ok ${file}`) }'
test -f spikes/fish-tts-latency.txt
test -f spikes/apple-calendar-current-day.txt
git status --short
```

Expected:

- JSON parsing prints `json ok` for each file.
- Both `test` commands exit `0`.
- `git status --short` shows only the intended `spikes/results.md` modification.

- [ ] **Step 4: Commit final blocker gate**

Run:

```bash
git add spikes/results.md
git commit -m "docs: update blocker burn-down recommendation"
```

Expected: commit succeeds.

## Self-Review Checklist

- NetEase npm cache issue is handled without requiring `sudo chown`.
- Fish TTS is validated against the actual existing FishAudio S2 Pro MLX model or remains a hard blocker with a precise failure log.
- Calendar reads cannot hang indefinitely because AppleScript runs through a timeout wrapper.
- EventKit fallback is attempted when AppleScript remains blocked.
- Raw Calendar event text is never committed.
- edge-tts is not accepted as a replacement for the v1 Fish TTS requirement.
- No product code is implemented by this plan.
- `spikes/results.md` remains the single source of truth for whether product implementation can start.
