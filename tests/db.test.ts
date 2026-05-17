import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/load.js";
import { runMigrations } from "../src/db/migrations.js";
import { openDatabase, withDatabase } from "../src/db/database.js";
import { MemoryStore } from "../src/memory/store.js";

const tempDirs: string[] = [];

function makeConfig() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "pockedio-db-test-"));
  tempDirs.push(home);
  const env = { POCKEDIO_HOME: home };
  const config = loadConfig(env);
  runMigrations(config);
  return config;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("database migrations", () => {
  it("creates all schema tables", () => {
    const config = makeConfig();
    const tables = withDatabase(config, (db) => db.prepare(`
      SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name
    `).all().map((row) => (row as { name: string }).name));

    expect(tables).toEqual([
      "context_snapshots",
      "dj_audio",
      "feedback",
      "memory_items",
      "messages",
      "mood_checks",
      "sessions",
      "settings",
      "station_tracks",
      "taste_imports"
    ]);
  });

  it("stores and queries full transcript messages", () => {
    const config = makeConfig();
    withDatabase(config, (db) => {
      const store = new MemoryStore(db);
      const sessionId = store.createSession("conversation", "play something for focus");

      store.addMessage(sessionId, "user", "play something for focus");
      store.addMessage(sessionId, "pockedio", "I will keep it clean and direct.");

      const rows = db.prepare("SELECT role, content FROM messages ORDER BY created_at").all();
      expect(rows).toEqual([
        { role: "user", content: "play something for focus" },
        { role: "pockedio", content: "I will keep it clean and direct." }
      ]);
    });
  });

  it("stores station tracks and playback failure reasons", () => {
    const config = makeConfig();
    withDatabase(config, (db) => {
      const store = new MemoryStore(db);
      const sessionId = store.createSession("conversation", "play ambient");
      const trackId = store.addStationTrack(sessionId, {
        position: 1,
        title: "An Ending (Ascent)",
        artist: "Brian Eno",
        album: "Apollo",
        provider: "netease",
        providerTrackId: "123",
        playbackStatus: "planned"
      });

      store.updateTrackPlayback(trackId, "unavailable", "No playable URL");

      const row = db.prepare(`
        SELECT playback_status as playbackStatus, failure_reason as failureReason
        FROM station_tracks WHERE id = ?
      `).get(trackId);
      expect(row).toEqual({ playbackStatus: "unavailable", failureReason: "No playable URL" });
    });
  });

  it("stores personality JSON in context snapshots", () => {
    const config = makeConfig();
    withDatabase(config, (db) => {
      const store = new MemoryStore(db);
      const sessionId = store.createSession("conversation", "talk with me");

      store.addContextSnapshot(sessionId, {
        calendarSummary: "No events today.",
        personality: { mbti: "INTJ" }
      });

      const row = db.prepare("SELECT personality_json as personalityJson FROM context_snapshots WHERE session_id = ?").get(sessionId) as { personalityJson: string };
      expect(JSON.parse(row.personalityJson)).toEqual({ mbti: "INTJ" });
    });
  });

  it("rejects orphan messages through foreign key constraints", () => {
    const config = makeConfig();
    const db = openDatabase(config);
    try {
      expect(() => {
        db.prepare(`
          INSERT INTO messages (id, session_id, role, content, created_at)
          VALUES ('message_orphan', 'missing_session', 'user', 'hello', '2026-05-17T00:00:00.000Z')
        `).run();
      }).toThrow();
    } finally {
      db.close();
    }
  });
});
