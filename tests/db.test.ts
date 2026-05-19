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
      "calendar_events",
      "context_snapshots",
      "diary_summaries",
      "dj_audio",
      "feedback",
      "memory_items",
      "messages",
      "mood_checks",
      "scheduled_dj_preparations",
      "sessions",
      "settings",
      "station_tracks",
      "taste_imports"
    ]);
  });

  it("backfills DJ audio cache columns into an existing local database", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "pockedio-db-test-"));
    tempDirs.push(home);
    const config = loadConfig({ POCKEDIO_HOME: home });
    fs.mkdirSync(path.dirname(config.paths.database), { recursive: true });

    const legacy = new Database(config.paths.database);
    try {
      legacy.exec(`
        CREATE TABLE sessions (
          id TEXT PRIMARY KEY,
          started_at TEXT NOT NULL,
          ended_at TEXT,
          trigger_type TEXT NOT NULL CHECK (trigger_type IN ('conversation', 'scheduled_morning', 'scheduled_evening', 'mood_check', 'explicit_dj_audio')),
          trigger_text TEXT NOT NULL
        );

        CREATE TABLE dj_audio (
          id TEXT PRIMARY KEY,
          session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
          kind TEXT NOT NULL CHECK (kind IN ('morning', 'evening', 'explicit')),
          persona_id TEXT,
          text TEXT NOT NULL,
          audio_path TEXT,
          status TEXT NOT NULL CHECK (status IN ('generated', 'played', 'failed', 'text_fallback')),
          created_at TEXT NOT NULL
        );

        CREATE TABLE scheduled_dj_preparations (
          id TEXT PRIMARY KEY,
          kind TEXT NOT NULL CHECK (kind IN ('morning', 'evening')),
          target_play_time TEXT NOT NULL,
          prepared_at TEXT NOT NULL,
          persona_id TEXT,
          text TEXT NOT NULL,
          audio_path TEXT,
          status TEXT NOT NULL CHECK (status IN ('generated', 'played', 'failed', 'text_fallback')),
          context_summary TEXT
        );
      `);
    } finally {
      legacy.close();
    }

    runMigrations(config);

    withDatabase(config, (db) => {
      const djAudioColumns = db.prepare("PRAGMA table_info(dj_audio)").all().map((row) => (row as { name: string }).name);
      const prepColumns = db.prepare("PRAGMA table_info(scheduled_dj_preparations)").all().map((row) => (row as { name: string }).name);
      expect(djAudioColumns).toEqual(expect.arrayContaining([
        "audio_cache_expires_at",
        "voice_model",
        "latency_ms",
        "file_size_bytes"
      ]));
      expect(prepColumns).toContain("audio_cache_expires_at");

      const store = new MemoryStore(db);
      const sessionId = store.createSession("explicit_dj_audio", "make me a DJ intro");
      expect(() => store.recordDjAudio(sessionId, "explicit", null, "A migrated DJ script.", "/tmp/pockedio.wav", "played", {
        cacheExpiresAt: "2026-05-26T00:00:00.000Z",
        latencyMs: 12,
        fileSizeBytes: 2048
      })).not.toThrow();
    });
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

  it("stores calendar events in a dedicated table and dedupes repeated reads", () => {
    const config = makeConfig();
    withDatabase(config, (db) => {
      const store = new MemoryStore(db);

      const first = store.upsertCalendarEvents([
        {
          calendarName: "Work",
          title: "Planning Review",
          startTime: "2026-05-17T09:00:00.000Z",
          endTime: "2026-05-17T10:00:00.000Z",
          isAllDay: false,
          source: "setup",
          readAt: "2026-05-19T00:00:00.000Z"
        }
      ]);
      const second = store.upsertCalendarEvents([
        {
          calendarName: "Work",
          title: "Planning Review",
          startTime: "2026-05-17T09:00:00.000Z",
          endTime: "2026-05-17T10:00:00.000Z",
          isAllDay: false,
          source: "interactive",
          readAt: "2026-05-19T01:00:00.000Z"
        }
      ]);

      expect(first).toBe(1);
      expect(second).toBe(1);
      const rows = db.prepare(`
        SELECT calendar_name as calendarName, title, start_time as startTime, end_time as endTime,
          is_all_day as isAllDay, source, read_at as readAt
        FROM calendar_events
      `).all();
      expect(rows).toEqual([
        {
          calendarName: "Work",
          title: "Planning Review",
          startTime: "2026-05-17T09:00:00.000Z",
          endTime: "2026-05-17T10:00:00.000Z",
          isAllDay: 0,
          source: "interactive",
          readAt: "2026-05-19T01:00:00.000Z"
        }
      ]);
    });
  });

  it("stores and reuses diary summaries by source file version", () => {
    const config = makeConfig();
    withDatabase(config, (db) => {
      const store = new MemoryStore(db);

      store.upsertDiarySummary({
        sourceFile: "/Users/leonw/Diary/2026-05-18.md",
        sourceMtime: "2026-05-18T10:00:00.000Z",
        summary: "A quiet but demanding workday. Good fit: calm recovery music.",
        generatedAt: "2026-05-19T00:00:00.000Z"
      });

      expect(store.getDiarySummary(
        "/Users/leonw/Diary/2026-05-18.md",
        "2026-05-18T10:00:00.000Z"
      )).toEqual({
        sourceFile: "/Users/leonw/Diary/2026-05-18.md",
        sourceMtime: "2026-05-18T10:00:00.000Z",
        summary: "A quiet but demanding workday. Good fit: calm recovery music.",
        generatedAt: "2026-05-19T00:00:00.000Z"
      });
      expect(store.getDiarySummary(
        "/Users/leonw/Diary/2026-05-18.md",
        "2026-05-18T11:00:00.000Z"
      )).toBeNull();
    });
  });

  it("stores DJ script as history and audio path as expiring cache metadata", () => {
    const config = makeConfig();
    withDatabase(config, (db) => {
      const store = new MemoryStore(db);
      const sessionId = store.createSession("explicit_dj_audio", "make me a DJ intro");

      store.recordDjAudio(sessionId, "explicit", null, "A durable DJ script.", "/tmp/pockedio.wav", "played", {
        cacheExpiresAt: "2026-05-26T00:00:00.000Z",
        voiceModel: "fish-s2-pro",
        latencyMs: 12,
        fileSizeBytes: 2048
      });

      const row = db.prepare(`
        SELECT text, audio_path as audioPath, audio_cache_expires_at as audioCacheExpiresAt,
          voice_model as voiceModel, latency_ms as latencyMs, file_size_bytes as fileSizeBytes
        FROM dj_audio
      `).get();
      expect(row).toEqual({
        text: "A durable DJ script.",
        audioPath: "/tmp/pockedio.wav",
        audioCacheExpiresAt: "2026-05-26T00:00:00.000Z",
        voiceModel: "fish-s2-pro",
        latencyMs: 12,
        fileSizeBytes: 2048
      });
    });
  });

  it("cleans expired DJ audio cache files without deleting DJ script history", () => {
    const config = makeConfig();
    const cachedAudioPath = path.join(path.dirname(config.paths.database), "expired.wav");
    fs.writeFileSync(cachedAudioPath, "audio");

    withDatabase(config, (db) => {
      const store = new MemoryStore(db);
      const sessionId = store.createSession("explicit_dj_audio", "make me a DJ intro");
      store.recordDjAudio(sessionId, "explicit", null, "Keep this script.", cachedAudioPath, "played", {
        cacheExpiresAt: "2026-05-18T00:00:00.000Z"
      });

      const result = store.cleanupExpiredDjAudioCache(new Date("2026-05-19T00:00:00.000Z"));

      expect(result).toEqual({ rowsCleared: 1, filesDeleted: 1 });
      expect(fs.existsSync(cachedAudioPath)).toBe(false);
      const row = db.prepare("SELECT text, audio_path as audioPath FROM dj_audio").get();
      expect(row).toEqual({ text: "Keep this script.", audioPath: null });
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
