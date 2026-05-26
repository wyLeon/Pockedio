import { parse } from "csv-parse/sync";

export const requiredTasteColumns = ["title", "artist", "album", "source", "playlist", "liked_at"] as const;

export type TasteImportRow = {
  title: string;
  artist: string;
  album: string;
  source: string;
  playlist: string;
  liked_at: string;
  providerTrackId?: string;
};

export function parseTasteCsv(text: string): TasteImportRow[] {
  const rows = parse(text, {
    columns: true,
    skip_empty_lines: true,
    trim: true
  }) as Record<string, string>[];

  const headers = Object.keys(rows[0] ?? parseHeaderOnly(text));
  const missing = requiredTasteColumns.filter((column) => !headers.includes(column));
  if (missing.length > 0) {
    throw new Error(`Missing required taste column(s): ${missing.join(", ")}`);
  }

  return rows.map((row) => ({
    title: row.title ?? "",
    artist: row.artist ?? "",
    album: row.album ?? "",
    source: row.source ?? "",
    playlist: row.playlist ?? "",
    liked_at: row.liked_at ?? ""
  }));
}

function parseHeaderOnly(text: string): Record<string, string> {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  return Object.fromEntries(firstLine.split(",").map((column) => [column.trim(), ""]));
}
