import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { loadConfig } from "../config/load.js";
import type { PockedioConfig } from "../config/schema.js";
import { runMigrations } from "../db/migrations.js";
import { withDatabase } from "../db/database.js";
import { MemoryStore } from "../memory/store.js";
import { parseTasteCsv } from "./csv.js";
import { generateTasteMarkdown, summarizeTasteRows } from "./tasteMarkdown.js";

export type TasteImportResult = {
  trackCount: number;
  artists: string[];
  playlists: string[];
  tastePath: string;
};

export function importTaste(file: string, config: PockedioConfig = loadConfig()): TasteImportResult {
  runMigrations(config);
  const rows = parseTasteCsv(fs.readFileSync(file, "utf8"));
  const summary = summarizeTasteRows(rows);
  const markdown = generateTasteMarkdown(rows);

  fs.mkdirSync(path.dirname(config.paths.taste), { recursive: true });
  fs.writeFileSync(config.paths.taste, markdown);

  withDatabase(config, (db) => {
    const store = new MemoryStore(db);
    for (const row of rows) {
      store.addMemoryItem("taste", `${row.title} by ${row.artist}`, {
        album: row.album,
        source: row.source,
        playlist: row.playlist,
        likedAt: row.liked_at
      });
    }
    recordTasteImport(db, file, summary.trackCount, `Imported ${summary.trackCount} tracks from ${summary.sources.join(", ") || "unknown sources"}.`);
  });

  return {
    trackCount: summary.trackCount,
    artists: summary.artists,
    playlists: summary.playlists,
    tastePath: config.paths.taste
  };
}

function recordTasteImport(db: Database.Database, sourceFile: string, trackCount: number, summary: string): void {
  db.prepare(`
    INSERT INTO taste_imports (id, source_file, imported_at, track_count, summary)
    VALUES (?, ?, ?, ?, ?)
  `).run(randomUUID(), sourceFile, new Date().toISOString(), trackCount, summary);
}
