import type { TasteImportRow } from "./csv.js";

export type TasteMarkdownSummary = {
  trackCount: number;
  artists: string[];
  playlists: string[];
  sources: string[];
};

export const generatedTasteProfileStart = "<!-- POCKEDIO:BEGIN GENERATED TASTE PROFILE -->";
export const generatedTasteProfileEnd = "<!-- POCKEDIO:END GENERATED TASTE PROFILE -->";

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
    "## Imported Tracks",
    "",
    ...formatImportedTracks(rows),
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

function formatImportedTracks(rows: TasteImportRow[]): string[] {
  if (rows.length === 0) {
    return ["- No tracks imported yet."];
  }

  return rows.map((row) => {
    const details = [row.album, row.playlist, row.source]
      .map((value) => value.trim())
      .filter(Boolean)
      .join("; ");
    return details
      ? `- ${row.title} - ${row.artist} (${details})`
      : `- ${row.title} - ${row.artist}`;
  });
}

export function upsertGeneratedTasteProfileSection(markdown: string, generatedProfile: string): string {
  const section = [
    generatedTasteProfileStart,
    generatedProfile.trim(),
    generatedTasteProfileEnd
  ].join("\n");
  const pattern = new RegExp(`${escapeRegExp(generatedTasteProfileStart)}[\\s\\S]*?${escapeRegExp(generatedTasteProfileEnd)}`);
  if (pattern.test(markdown)) {
    return `${markdown.replace(pattern, section).trim()}\n`;
  }
  return `${markdown.trim()}\n\n${section}\n`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
