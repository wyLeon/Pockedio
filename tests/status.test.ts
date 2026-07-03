import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ensureRuntimeDirs, loadConfig, saveConfig } from "../src/config/load.js";
import { saveLlmApiKey } from "../src/config/llmSecrets.js";
import { withDatabase } from "../src/db/database.js";
import { runMigrations } from "../src/db/migrations.js";
import { MemoryStore } from "../src/memory/store.js";
import { ensurePersonaFile } from "../src/personas/personaStore.js";
import { formatStatusReport, getStatusReport } from "../src/status/status.js";

function makeHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pockedio-status-test-"));
}

describe("status report", () => {
  it("reports missing local setup files", async () => {
    const home = makeHome();
    const report = await getStatusReport({
      env: { POCKEDIO_HOME: home },
      fetchImpl: async () => {
        throw new Error("offline");
      }
    });

    expect(report.config.present).toBe(false);
    expect(report.database.present).toBe(false);
    expect(report.taste.present).toBe(false);
    expect(report.personas.present).toBe(false);
    expect(report.netease.reachable).toBe(false);
    expect(formatStatusReport(report)).toContain("Config    missing");
  });

  it("reports a healthy configured home", async () => {
    const home = makeHome();
    const env = { POCKEDIO_HOME: home };
    const config = loadConfig(env);
    ensureRuntimeDirs(config, env);
    saveConfig(config, env);
    runMigrations(config);
    ensurePersonaFile(config);
    fs.writeFileSync(config.paths.taste, "# Pockedio Taste\n");
    withDatabase(config, (db) => {
      const store = new MemoryStore(db);
      const sessionId = store.createSession("conversation", "play focus");
      store.addMessage(sessionId, "user", "play focus");
      store.endSession(sessionId);
    });

    const report = await getStatusReport({
      env,
      fetchImpl: async () => new Response(JSON.stringify({ result: { songs: [{ id: 1, name: "Song", artists: [{ name: "Artist" }] }] } }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    });

    expect(report.config.present).toBe(true);
    expect(report.database).toMatchObject({ present: true, migrated: true });
    expect(report.netease.reachable).toBe(true);
    expect(report.calendar.enabled).toBe(false);
    expect(report.weather.enabled).toBe(false);
    expect(report.weather.location).toBe("Shanghai");
    expect(report.llm).toMatchObject({
      provider: "OpenAI-compatible",
      model: "gpt-4.1-mini",
      apiKeyEnv: "OPENAI_API_KEY",
      apiKeyPresent: false
    });
    expect(report.llm.apiKeySource).toBe("missing");
    expect(report.taste.present).toBe(true);
    expect(report.personas.present).toBe(true);
    expect(report.latestSessionTimestamp).toEqual(expect.any(String));

    const text = formatStatusReport(report);
    expect(text).toContain("RUNTIME");
    expect(text).toContain("SETUP");
    expect(text).toContain("MEMORY");
    expect(text).toContain("LOCAL DATA");
    expect(text).toContain("External  NetEase, configured LLM, weather, and diary summaries may leave this machine when used.");
    expect(text).toContain("Playback   none");
    expect(text).toContain("Schedule   Morning DJ weekdays 08:45");
    expect(text).toContain("prepare 20 min before");
    expect(text).toContain("LLM       gpt-4.1-mini (missing key)");
    expect(text).toContain("Music     NetEase API reachable (anonymous playback, not logged in)");
    expect(text).toContain("Context   Calendar off, Weather off");
    expect(text).not.toContain("Music     NetEase connected (anonymous)");
    expect(text).toContain(process.platform === "darwin"
      ? "Voice     Vale, built-in macOS"
      : "Voice     Text-only DJ copy; configure voice for spoken DJ audio");
    expect(text).toContain("Database  ok");
    expect(text).toContain("Session");
  });

  it("reports locally stored LLM API keys", async () => {
    const home = makeHome();
    const env = { POCKEDIO_HOME: home };
    const config = loadConfig(env);
    ensureRuntimeDirs(config, env);
    saveConfig(config, env);
    saveLlmApiKey(config, "OPENAI_API_KEY", "sk-local");

    const report = await getStatusReport({
      env,
      fetchImpl: async () => {
        throw new Error("offline");
      }
    });

    expect(report.llm.apiKeyPresent).toBe(true);
    expect(report.llm.apiKeySource).toBe("local_secret");
    expect(formatStatusReport(report)).toContain("LLM       gpt-4.1-mini (local secret)");
  });

  it("uses shared colored section labels for TTY status output", () => {
    const text = formatStatusReport({
      config: { path: "/tmp/config.json", present: true },
      database: { path: "/tmp/pockedio.sqlite", present: true, migrated: true, schemaVersion: 1 },
      runtime: { currentPlayback: null, scheduledJobs: "none" },
      netease: {
        baseUrl: "http://127.0.0.1:3000",
        reachable: true,
        authMode: "anonymous",
        qualityLevel: "exhigh",
        cookiePresent: false
      },
      llm: {
        provider: "OpenAI-compatible",
        model: "gpt-4.1-mini",
        apiKeyEnv: "OPENAI_API_KEY",
        apiKeyPresent: false,
        apiKeySource: "missing"
      },
      fishAudio: { pythonPath: "", scriptPath: "", modelDir: "", pathsPresent: false, missing: [] },
      fishApi: {
        baseUrl: "https://api.fish.audio",
        model: "s2-pro",
        apiKeyEnv: "FISH_API_KEY",
        apiKeyPresent: false,
        proxyEnv: "POCKEDIO_FISH_PROXY",
        proxyPresent: false,
        referenceIdPresent: false,
        ready: false,
        missing: []
      },
      kokoroAudio: { pythonPath: "", modelPath: "", voicesPath: "", pathsPresent: false, missing: [] },
      voice: { summary: "Text-only DJ copy", showFishMissing: false, showFishApiMissing: false, showKokoroMissing: false },
      calendar: { enabled: false },
      weather: { enabled: false },
      taste: { path: "/tmp/taste.md", present: false },
      personas: { path: "/tmp/personas.json", present: true },
      latestSessionTimestamp: null,
      contextHeartbeat: null
    }, { color: true, width: 96 });

    expect(text).toMatch(/\u001b\[[0-9;]*38;5;116mRUNTIME\u001b\[0m/);
    expect(text).toMatch(/\u001b\[[0-9;]*38;5;116mSETUP\u001b\[0m/);
    expect(stripAnsi(text)).toContain("Playback   none");
  });

  it("formats status as runtime, integrations, and memory surfaces", () => {
    const text = formatStatusReport({
      config: { path: "/tmp/config.json", present: true },
      database: { path: "/tmp/pockedio.sqlite", present: true, migrated: true, schemaVersion: 1 },
      runtime: {
        currentPlayback: "Title - Artist",
        scheduledJobs: "Morning DJ weekdays 08:30 (prepare 12 min before); Evening DJ disabled; mood checks hourly while serve runs; serve not running"
      },
      netease: {
        baseUrl: "http://127.0.0.1:3000",
        reachable: true,
        authMode: "account",
        qualityLevel: "exhigh",
        cookiePresent: true
      },
      llm: {
        provider: "OpenAI-compatible",
        model: "deepseek-chat",
        baseUrl: "https://api.deepseek.com",
        apiKeyEnv: "DEEPSEEK_API_KEY",
        apiKeyPresent: true,
        apiKeySource: "env"
      },
      fishAudio: {
        pythonPath: "/python",
        scriptPath: "/script.py",
        modelDir: "/model",
        pathsPresent: true,
        missing: []
      },
      fishApi: {
        baseUrl: "https://api.fish.audio",
        model: "s2-pro",
        apiKeyEnv: "FISH_API_KEY",
        apiKeyPresent: true,
        proxyEnv: "POCKEDIO_FISH_PROXY",
        proxyPresent: false,
        referenceIdPresent: true,
        ready: true,
        missing: []
      },
      kokoroAudio: {
        pythonPath: "/kokoro-python",
        modelPath: "/kokoro.onnx",
        voicesPath: "/voices.bin",
        pathsPresent: true,
        missing: []
      },
      voice: {
        summary: "Mina, Fish TTS ready",
        showFishMissing: false,
        showFishApiMissing: false,
        showKokoroMissing: false
      },
      calendar: { enabled: true },
      weather: { enabled: true, location: "Shanghai" },
      taste: { path: "/tmp/taste.md", present: true },
      personas: { path: "/tmp/personas.json", present: true },
      latestSessionTimestamp: "2026-05-19T02:00:00.000Z",
      contextHeartbeat: {
        id: "heartbeat-1",
        startedAt: "2026-05-19T01:00:00.000Z",
        finishedAt: "2026-05-19T01:00:02.000Z",
        status: "completed",
        trigger: "startup_heartbeat",
        localDay: "2026-05-19",
        calendarEventsRead: 3,
        agendaMemoriesUpdated: 1,
        diaryLatestAvailable: true,
        diaryLatestFile: "/tmp/diary/entry.md",
        diaryFilesScanned: 2,
        diarySummariesGenerated: 1,
        diarySummariesReused: 1,
        diaryMemoriesUpdated: 3,
        error: null
      }
    });

    expect(text).toContain("RUNTIME");
    expect(text).toContain("Playback   Title - Artist");
    expect(text).toContain("Schedule   Morning DJ weekdays 08:30 (prepare 12 min before); Evening DJ disabled");
    expect(text).toContain("serve not running");
    expect(text).toContain("SETUP");
    expect(text).toContain("Music     NetEase account connected (exhigh)");
    expect(text).toContain("LLM       deepseek-chat (shell env)");
    expect(text).toContain("Voice     Mina, Fish TTS ready");
    expect(text).toContain("Context   Calendar on, Weather Shanghai");
    expect(text).toContain("MEMORY");
    expect(text).toContain("Session    2026-05-19T02:00:00.000Z");
    expect(text).toContain("Heartbeat completed 2026-05-19T01:00:02.000Z (3 calendar; 2 diary, 1 new)");
    expect(text).toContain("LOCAL DATA");
    expect(text).toContain("Local     /tmp");
    expect(text).toContain("External  NetEase, configured LLM, weather, and diary summaries may leave this machine when used.");
  });

  it("reports Fish API readiness without making a synthesis call", async () => {
    const home = makeHome();
    const env = { POCKEDIO_HOME: home, FISH_API_KEY: "fish-test-key" };
    const config = loadConfig(env);
    config.tts.provider = "fish_api";
    config.tts.fishVoice = "mina";
    config.fishApi.referenceIds.mina = "mina-reference";
    ensureRuntimeDirs(config, env);
    saveConfig(config, env);

    const report = await getStatusReport({
      env,
      fetchImpl: async () => {
        throw new Error("music offline");
      }
    });

    expect(report.fishApi.ready).toBe(true);
    expect(report.voice.summary).toBe("Mina, Fish API ready");
    expect(formatStatusReport(report)).toContain("Voice     Mina, Fish API ready");
  });

  it("reports missing Fish API key for the selected cloud voice", async () => {
    const home = makeHome();
    const env = { POCKEDIO_HOME: home };
    const config = loadConfig(env);
    config.tts.provider = "fish_api";
    config.tts.fishVoice = "nova";
    ensureRuntimeDirs(config, env);
    saveConfig(config, env);

    const report = await getStatusReport({
      env,
      fetchImpl: async () => {
        throw new Error("music offline");
      }
    });
    const text = formatStatusReport(report);

    expect(report.fishApi.ready).toBe(false);
    expect(report.voice.summary).toBe("Nova, Fish API needs setup");
    expect(text).toContain("Fish API missing:");
    expect(text).toContain("- api key: FISH_API_KEY");
    expect(text).not.toContain("reference id");
  });
});

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, "");
}
