import type Database from "better-sqlite3";
import type { PockedioConfig } from "../config/schema.js";
import { runMigrations } from "../db/migrations.js";
import { withDatabase } from "../db/database.js";
import type { TasteSignalRecord } from "../memory/store.js";
import type { TasteImportRow } from "./csv.js";

export type TasteCandidate = {
  title: string;
  artist: string;
  album: string;
  source: string;
  playlist: string;
  provider: string;
  providerTrackId: string | null;
  score: number;
};

type TasteItemRow = Omit<TasteCandidate, "score"> & {
  searchText: string;
  lastImportedAt: string;
};

export function upsertTasteItems(db: Database.Database, rows: TasteImportRow[], importSource: string): void {
  const now = new Date().toISOString();
  const statement = db.prepare(`
    INSERT INTO taste_items (
      dedupe_key, title, artist, album, source, playlist, import_source, provider,
      provider_track_id, search_text, first_imported_at, last_imported_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(dedupe_key) DO UPDATE SET
      title = excluded.title,
      artist = excluded.artist,
      album = excluded.album,
      source = excluded.source,
      playlist = excluded.playlist,
      import_source = excluded.import_source,
      provider = excluded.provider,
      provider_track_id = COALESCE(excluded.provider_track_id, taste_items.provider_track_id),
      search_text = excluded.search_text,
      last_imported_at = excluded.last_imported_at
  `);

  for (const row of rows) {
    statement.run(
      tasteItemDedupeKey(row),
      row.title.trim(),
      row.artist.trim(),
      row.album.trim(),
      row.source.trim(),
      row.playlist.trim(),
      importSource,
      row.source.trim(),
      row.providerTrackId?.trim() || null,
      buildTasteItemSearchText(row),
      now,
      now
    );
  }
}

export function getTasteCandidates(
  config: PockedioConfig,
  request: string,
  signals: TasteSignalRecord[] = [],
  limit = 12
): TasteCandidate[] {
  runMigrations(config);
  return withDatabase(config, (db) => {
    const rows = db.prepare(`
      SELECT title, artist, album, source, playlist, provider,
        provider_track_id as providerTrackId, search_text as searchText, last_imported_at as lastImportedAt
      FROM taste_items
      ORDER BY last_imported_at DESC
      LIMIT 500
    `).all() as TasteItemRow[];
    const bannedArtists = new Set(signals
      .filter((signal) => signal.signalType === "ban" && signal.targetType === "artist")
      .map((signal) => normalizeText(signal.targetValue)));
    const bannedTracks = new Set(signals
      .filter((signal) => signal.signalType === "ban" && signal.targetType === "track")
      .map((signal) => normalizeText(signal.targetValue)));
    const feedbackScores = buildFeedbackScores(signals);
    const requestTokens = tokenize(request);

    return rows
      .map((row) => ({
        ...row,
        score: scoreTasteItem(row, requestTokens, feedbackScores)
      }))
      .filter((row) => row.score > 0)
      .filter((row) => !bannedArtists.has(normalizeText(row.artist)))
      .filter((row) => !bannedTracks.has(normalizeText(`${row.title} - ${row.artist}`)))
      .sort((a, b) => b.score - a.score || `${a.artist} ${a.title}`.localeCompare(`${b.artist} ${b.title}`))
      .slice(0, limit);
  });
}

function buildFeedbackScores(signals: TasteSignalRecord[]): Map<string, number> {
  const scores = new Map<string, number>();
  for (const signal of signals) {
    if (signal.targetType !== "track" && signal.targetType !== "artist") {
      continue;
    }
    const key = `${signal.targetType}:${normalizeText(signal.targetValue)}`;
    scores.set(key, (scores.get(key) ?? 0) + signal.weight);
  }
  return scores;
}

function scoreTasteItem(row: TasteItemRow, requestTokens: string[], feedbackScores: Map<string, number>): number {
  let score = 0;
  for (const token of requestTokens) {
    if (row.searchText.includes(token)) {
      score += 3;
    }
  }
  score += feedbackScores.get(`artist:${normalizeText(row.artist)}`) ?? 0;
  score += feedbackScores.get(`track:${normalizeText(`${row.title} - ${row.artist}`)}`) ?? 0;
  return score;
}

function tasteItemDedupeKey(row: TasteImportRow): string {
  return [
    row.title,
    row.artist,
    row.album,
    row.playlist,
    row.source
  ].map(normalizeText).join("\u0000");
}

function buildTasteItemSearchText(row: TasteImportRow): string {
  return [
    row.title,
    row.artist,
    row.album,
    row.playlist,
    row.source
  ].map(normalizeText).filter(Boolean).join(" ");
}

function tokenize(value: string): string[] {
  return [...new Set(normalizeText(value)
    .split(/\s+/)
    .filter((token) => token.length >= 2)
    .filter((token) => !stopWords.has(token)))];
}

function normalizeText(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

const stopWords = new Set([
  "i",
  "me",
  "my",
  "want",
  "need",
  "would",
  "like",
  "some",
  "play",
  "music",
  "song",
  "songs",
  "track",
  "tracks",
  "for",
  "to",
  "the",
  "a",
  "an"
]);
