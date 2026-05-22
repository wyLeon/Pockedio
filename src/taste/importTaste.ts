import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { loadConfig } from "../config/load.js";
import type { PockedioConfig } from "../config/schema.js";
import { runMigrations } from "../db/migrations.js";
import { withDatabase } from "../db/database.js";
import { MemoryStore } from "../memory/store.js";
import { parseTasteCsv, type TasteImportRow } from "./csv.js";
import { generateTasteMarkdown, summarizeTasteRows } from "./tasteMarkdown.js";

export type TasteImportResult = {
  trackCount: number;
  artists: string[];
  playlists: string[];
  tastePath: string;
  source?: "file" | "netease_playlist";
  profileStatus: "needs_refresh";
};

export function importTaste(file: string, config: PockedioConfig = loadConfig()): TasteImportResult {
  const rows = parseTasteCsv(fs.readFileSync(file, "utf8"));
  return {
    ...importTasteRows(rows, file, config),
    source: "file"
  };
}

export async function importTasteInput(
  input: string,
  config: PockedioConfig = loadConfig(),
  fetchImpl?: typeof fetch
): Promise<TasteImportResult> {
  if (fs.existsSync(input)) {
    return importTaste(input, config);
  }

  const { importTasteFromNetEasePlaylist } = await import("./neteasePlaylist.js");
  return {
    ...await importTasteFromNetEasePlaylist(input, config, fetchImpl ?? fetch),
    source: "netease_playlist"
  };
}

export function importTasteRows(rows: TasteImportRow[], sourceFile: string, config: PockedioConfig = loadConfig()): TasteImportResult {
  runMigrations(config);
  const summary = summarizeTasteRows(rows);
  const existingMarkdown = fs.existsSync(config.paths.taste) ? fs.readFileSync(config.paths.taste, "utf8") : "";
  const markdown = mergeTasteMarkdown(existingMarkdown, rows);

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
    recordTasteImport(db, sourceFile, summary.trackCount, `Imported ${summary.trackCount} tracks from ${summary.sources.join(", ") || "unknown sources"}.`);
  });

  return {
    trackCount: summary.trackCount,
    artists: summary.artists,
    playlists: summary.playlists,
    tastePath: config.paths.taste,
    profileStatus: "needs_refresh"
  };
}

function mergeTasteMarkdown(existingMarkdown: string, newRows: TasteImportRow[]): string {
  if (!existingMarkdown.trim()) {
    return generateTasteMarkdown(newRows);
  }

  const existingRows = parseImportedTrackRows(existingMarkdown);
  const mergedRows = dedupeTasteRows([...existingRows, ...newRows]);
  const preservedNotes = extractUserTasteNotes(existingMarkdown);
  const generatedProfile = extractGeneratedTasteProfile(existingMarkdown);
  const nextMarkdown = generateTasteMarkdown(mergedRows).trim();
  return [
    nextMarkdown,
    ...(preservedNotes.length > 0 ? ["", ...preservedNotes] : []),
    ...(generatedProfile ? ["", generatedProfile] : []),
    ""
  ].join("\n");
}

function parseImportedTrackRows(markdown: string): TasteImportRow[] {
  return extractSection(markdown, "Imported Tracks")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- ") && !line.includes("No tracks imported yet."))
    .flatMap(parseImportedTrackLine);
}

function parseImportedTrackLine(line: string): TasteImportRow[] {
  const content = line.replace(/^- /, "");
  const match = content.match(/^(.+?) - (.+?)(?: \((.+)\))?$/);
  if (!match) {
    return [];
  }

  const details = parseImportedTrackDetails(match[3] ?? "");
  return [{
    title: match[1].trim(),
    artist: match[2].trim(),
    album: details.album,
    playlist: details.playlist,
    source: details.source,
    liked_at: ""
  }];
}

function parseImportedTrackDetails(value: string): Pick<TasteImportRow, "album" | "playlist" | "source"> {
  const parts = value.split(";").map((part) => part.trim()).filter(Boolean);
  return {
    album: parts[0] ?? "",
    playlist: parts[1] ?? "",
    source: parts[2] ?? ""
  };
}

function extractSection(markdown: string, heading: string): string[] {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start < 0) {
    return [];
  }
  const end = lines.findIndex((line, index) => index > start && /^##\s+/.test(line.trim()));
  return lines.slice(start + 1, end < 0 ? undefined : end);
}

function extractUserTasteNotes(markdown: string): string[] {
  return markdown
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => /^User note:/i.test(line.trim()));
}

function extractGeneratedTasteProfile(markdown: string): string | null {
  const match = markdown.match(/<!-- POCKEDIO:BEGIN GENERATED TASTE PROFILE -->[\s\S]*?<!-- POCKEDIO:END GENERATED TASTE PROFILE -->/);
  return match?.[0] ?? null;
}

function dedupeTasteRows(rows: TasteImportRow[]): TasteImportRow[] {
  const seen = new Set<string>();
  const deduped: TasteImportRow[] = [];
  for (const row of rows) {
    const key = [
      row.title.trim().toLowerCase(),
      row.artist.trim().toLowerCase(),
      row.album.trim().toLowerCase(),
      row.playlist.trim().toLowerCase(),
      row.source.trim().toLowerCase()
    ].join("\u0000");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(row);
  }
  return deduped;
}

function recordTasteImport(db: Database.Database, sourceFile: string, trackCount: number, summary: string): void {
  db.prepare(`
    INSERT INTO taste_imports (id, source_file, imported_at, track_count, summary)
    VALUES (?, ?, ?, ?, ?)
  `).run(randomUUID(), sourceFile, new Date().toISOString(), trackCount, summary);
}
