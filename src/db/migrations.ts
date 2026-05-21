import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { PockedioConfig } from "../config/schema.js";

export const schemaVersion = 8;

function schemaPath(): string {
  return path.resolve(path.dirname(new URL(import.meta.url).pathname), "schema.sql");
}

export function runMigrations(config: PockedioConfig): void {
  fs.mkdirSync(path.dirname(config.paths.database), { recursive: true });
  const db = new Database(config.paths.database);
  try {
    db.pragma("foreign_keys = ON");
    const schema = fs.readFileSync(schemaPath(), "utf8");
    db.exec(schema);
    applySchemaBackfills(db);
    db.prepare(`
      INSERT INTO settings (key, value_json, updated_at)
      VALUES ('schema_version', json(?), ?)
      ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
    `).run(JSON.stringify(schemaVersion), new Date().toISOString());
  } finally {
    db.close();
  }
}

function applySchemaBackfills(db: Database.Database): void {
  addColumnIfMissing(db, "dj_audio", "audio_cache_expires_at", "TEXT");
  addColumnIfMissing(db, "dj_audio", "voice_model", "TEXT");
  addColumnIfMissing(db, "dj_audio", "latency_ms", "INTEGER");
  addColumnIfMissing(db, "dj_audio", "file_size_bytes", "INTEGER");
  addColumnIfMissing(db, "scheduled_dj_preparations", "audio_cache_expires_at", "TEXT");
  rebuildFeedbackTableIfMissingTasteActions(db);
}

function rebuildFeedbackTableIfMissingTasteActions(db: Database.Database): void {
  if (!tableExists(db, "feedback")) {
    return;
  }
  const row = db.prepare(`
    SELECT sql
    FROM sqlite_master
    WHERE type = 'table' AND name = 'feedback'
    LIMIT 1
  `).get() as { sql: string } | undefined;
  if (row?.sql.includes("less_like_this") && row.sql.includes("favorite") && row.sql.includes("save_vibe")) {
    return;
  }

  db.exec(`
    PRAGMA foreign_keys = OFF;

    CREATE TABLE feedback_migrated (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      track_id TEXT REFERENCES station_tracks(id) ON DELETE SET NULL,
      action TEXT NOT NULL CHECK (action IN ('like', 'skip', 'ban', 'more_like_this', 'change_vibe', 'less_like_this', 'favorite', 'save_vibe', 'stop')),
      note TEXT,
      created_at TEXT NOT NULL
    );

    INSERT INTO feedback_migrated (id, session_id, track_id, action, note, created_at)
    SELECT id, session_id, track_id, action, note, created_at
    FROM feedback;

    DROP TABLE feedback;
    ALTER TABLE feedback_migrated RENAME TO feedback;

    PRAGMA foreign_keys = ON;
  `);
}

function addColumnIfMissing(db: Database.Database, table: string, column: string, definition: string): void {
  if (!tableExists(db, table) || columnExists(db, table, column)) {
    return;
  }
  db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
}

function tableExists(db: Database.Database, table: string): boolean {
  const row = db.prepare(`
    SELECT 1 as present
    FROM sqlite_master
    WHERE type = 'table' AND name = ?
    LIMIT 1
  `).get(table) as { present: number } | undefined;
  return Boolean(row);
}

function columnExists(db: Database.Database, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === column);
}
