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
    expect(report.taste.present).toBe(true);
    expect(report.personas.present).toBe(true);
    expect(report.latestSessionTimestamp).toEqual(expect.any(String));

    const text = formatStatusReport(report);
    expect(text).toContain("Database: migrated");
    expect(text).toContain("Latest session:");
  });
});
