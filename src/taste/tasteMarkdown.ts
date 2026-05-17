import type { TasteImportRow } from "./csv.js";

export type TasteMarkdownSummary = {
  trackCount: number;
  artists: string[];
  playlists: string[];
  sources: string[];
};

export function summarizeTasteRows(rows: TasteImportRow[]): TasteMarkdownSummary {
  return {
    trackCount: rows.length,
    artists: sortedUnique(rows.map((row) => row.artist).filter(Boolean)),
    playlists: sortedUnique(rows.map((row) => row.playlist).filter(Boolean)),
    sources: sortedUnique(rows.map((row) => row.source).filter(Boolean))
  };
}

export function generateTasteMarkdown(rows: TasteImportRow[], importedAt = new Date()): string {
  const summary = summarizeTasteRows(rows);
  const importedDate = importedAt.toISOString();

  return [
    "# Pockedio Taste",
    "",
    "## Imported Signals",
    "",
    `- Last import: ${importedDate}`,
    `- Imported tracks: ${summary.trackCount}`,
    "",
    "## High-Confidence Artists",
    "",
    ...listOrEmpty(summary.artists),
    "",
    "## Situational Playlists",
    "",
    ...listOrEmpty(summary.playlists),
    "",
    "## Source Coverage",
    "",
    ...listOrEmpty(summary.sources),
    "",
    "## Notes For Future Editing",
    "",
    "- Add durable taste statements here after listening feedback confirms them.",
    "- Add negative constraints for artists, sounds, moods, or production styles to avoid.",
    "- Add situational preferences for work, late night, travel, reset, and decompression.",
    ""
  ].join("\n");
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function listOrEmpty(values: string[]): string[] {
  return values.length > 0 ? values.map((value) => `- ${value}`) : ["- No signals yet."];
}
