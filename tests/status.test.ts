import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ensureRuntimeDirs, loadConfig, saveConfig } from "../src/config/load.js";
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
    expect(formatStatusReport(report)).toContain("Config: missing");
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
    expect(report.calendar.enabled).toBe(true);
    expect(report.weather.location).toBe("Shanghai");
    expect(report.llm).toMatchObject({
      provider: "OpenAI-compatible",
      model: "gpt-4.1-mini",
      apiKeyEnv: "OPENAI_API_KEY",
      apiKeyPresent: false
    });
    expect(report.taste.present).toBe(true);
    expect(report.personas.present).toBe(true);
    expect(report.latestSessionTimestamp).toEqual(expect.any(String));

    const text = formatStatusReport(report);
    expect(text).toContain("Runtime");
    expect(text).toContain("Integrations");
    expect(text).toContain("Memory");
    expect(text).toContain("Data boundary");
    expect(text).toContain("- Pockedio-owned data: local only");
    expect(text).toContain("- External adapters: NetEase music, OpenAI-compatible LLM, Open-Meteo weather");
    expect(text).toContain("- Current playback:");
    expect(text).toContain("- Scheduled jobs: Morning DJ weekdays 08:45");
    expect(text).toContain("prepare 10 min before");
    expect(text).toContain("- LLM: missing API key");
    expect(text).toContain("- Database: migrated");
    expect(text).toContain("- Last session:");
  });

  it("formats status as runtime, integrations, and memory surfaces", () => {
    const text = formatStatusReport({
      config: { path: "/tmp/config.json", present: true },
      database: { path: "/tmp/pockedio.sqlite", present: true, migrated: true, schemaVersion: 1 },
      runtime: {
        currentPlayback: "Title - Artist",
        scheduledJobs: "Morning DJ weekdays 08:30 (prepare 12 min before); Evening DJ disabled; mood checks hourly while serve runs"
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
        apiKeyPresent: true
      },
      fishAudio: {
        pythonPath: "/python",
        scriptPath: "/script.py",
        modelDir: "/model",
        pathsPresent: true,
        missing: []
      },
      calendar: { enabled: true },
      weather: { location: "Shanghai" },
      taste: { path: "/tmp/taste.md", present: true },
      personas: { path: "/tmp/personas.json", present: true },
      latestSessionTimestamp: "2026-05-19T02:00:00.000Z"
    });

    expect(text).toContain("Runtime");
    expect(text).toContain("- Current playback: Title - Artist");
    expect(text).toContain("- Scheduled jobs: Morning DJ weekdays 08:30 (prepare 12 min before); Evening DJ disabled");
    expect(text).toContain("Integrations");
    expect(text).toContain("- NetEase music: reachable (account-backed, exhigh, http://127.0.0.1:3000)");
    expect(text).toContain("- LLM: configured (OpenAI-compatible, deepseek-chat, https://api.deepseek.com, key env DEEPSEEK_API_KEY)");
    expect(text).toContain("Memory");
    expect(text).toContain("- Last session: 2026-05-19T02:00:00.000Z");
    expect(text).toContain("Data boundary");
    expect(text).toContain("- Local home: /tmp");
    expect(text).toContain("- Pockedio-owned data: local only");
    expect(text).toContain("- External adapter data may leave this machine when used; Pockedio does not store it remotely.");
    expect(text).toContain("- Diary summary generation may send the latest diary excerpt to the configured LLM.");
  });
});
