import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../config/load.js";
import type { PockedioConfig } from "../config/schema.js";
import { runMigrations } from "../db/migrations.js";
import { MemoryStore, type TasteSignalRecord } from "../memory/store.js";
import { upsertGeneratedTasteProfileSection } from "./tasteMarkdown.js";

export type TasteProfileUpdateResult = {
  tastePath: string;
  signalCount: number;
  snapshotId: string;
  summary: string;
};

type ProfileBucket = {
  value: string;
  weight: number;
};

export function updateTasteProfile(config: PockedioConfig = loadConfig()): TasteProfileUpdateResult {
  runMigrations(config);
  const store = new MemoryStore(config);
  try {
    const signals = store.getTasteSignals(80);
    fs.mkdirSync(path.dirname(config.paths.taste), { recursive: true });
    const existing = fs.existsSync(config.paths.taste)
      ? fs.readFileSync(config.paths.taste, "utf8")
      : "# Pockedio Taste\n";
    const summary = buildGeneratedTasteProfile(signals, existing);
    fs.writeFileSync(config.paths.taste, upsertGeneratedTasteProfileSection(existing, summary));
    const snapshotId = store.addTasteProfileSnapshot(summary, {
      signalCount: signals.length,
      generatedBy: "local_imports_and_feedback_signals"
    });
    return {
      tastePath: config.paths.taste,
      signalCount: signals.length,
      snapshotId,
      summary
    };
  } finally {
    store.close();
  }
}

export function buildGeneratedTasteProfile(signals: TasteSignalRecord[], tasteMarkdown = ""): string {
  const imported = summarizeImportedTasteMarkdown(tasteMarkdown);
  const favorites = aggregate(signals.filter((signal) => signal.signalType === "favorite"));
  const positives = aggregate(signals.filter((signal) => signal.signalType === "positive_seed"));
  const negatives = aggregate(signals.filter((signal) => signal.signalType === "negative_seed"));
  const hardAvoids = aggregate(signals.filter((signal) => signal.signalType === "ban"));
  const vibes = aggregate(signals.filter((signal) => signal.signalType === "vibe_preset"));

  return [
    "## Generated Taste Profile",
    "",
    "Generated from imported taste and local listening feedback. Edit anything outside this generated block freely.",
    "",
    "### Imported Library Anchors",
    ...formatImportedAnchors(imported),
    "",
    "### High-Confidence Favorites",
    ...formatBuckets(favorites),
    "",
    "### Situational Preferences",
    ...formatBuckets(vibes),
    "",
    "### Positive Signals",
    ...formatBuckets(positives),
    "",
    "### Negative Signals",
    ...formatBuckets(negatives),
    "",
    "### Hard Avoids",
    ...formatBuckets(hardAvoids),
    "",
    "### Open Questions",
    ...formatOpenQuestions(signals)
  ].join("\n");
}

type ImportedTasteSummary = {
  trackCount: number;
  artists: string[];
  playlists: string[];
  sourceCoverage: string[];
  trackAnchors: string[];
};

function summarizeImportedTasteMarkdown(markdown: string): ImportedTasteSummary {
  const importedTracks = extractMarkdownSection(markdown, "Imported Tracks")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- ") && !line.includes("No tracks imported yet."))
    .map((line) => line.replace(/^- /, ""));

  return {
    trackCount: importedTracks.length,
    artists: extractMarkdownListSection(markdown, "High-Confidence Artists").slice(0, 12),
    playlists: extractMarkdownListSection(markdown, "Situational Playlists").slice(0, 8),
    sourceCoverage: extractMarkdownListSection(markdown, "Source Coverage").slice(0, 4),
    trackAnchors: importedTracks.slice(0, 10)
  };
}

function extractMarkdownListSection(markdown: string, heading: string): string[] {
  return extractMarkdownSection(markdown, heading)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- ") && !line.includes("No signals yet."))
    .map((line) => line.replace(/^- /, "").trim())
    .filter(Boolean);
}

function extractMarkdownSection(markdown: string, heading: string): string[] {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start < 0) {
    return [];
  }
  const end = lines.findIndex((line, index) => index > start && /^##\s+/.test(line.trim()));
  return lines.slice(start + 1, end < 0 ? undefined : end);
}

function formatImportedAnchors(summary: ImportedTasteSummary): string[] {
  if (summary.trackCount === 0 && summary.artists.length === 0 && summary.playlists.length === 0) {
    return ["- No imported library signals yet."];
  }
  return [
    `- Imported tracks: ${summary.trackCount}`,
    ...formatCompactList("Artists", summary.artists),
    ...formatCompactList("Playlists", summary.playlists),
    ...formatCompactList("Sources", summary.sourceCoverage),
    ...formatCompactList("Track anchors", summary.trackAnchors)
  ];
}

function formatCompactList(label: string, values: string[]): string[] {
  return values.length > 0 ? [`- ${label}: ${values.join(", ")}`] : [];
}

function aggregate(signals: TasteSignalRecord[]): ProfileBucket[] {
  const buckets = new Map<string, ProfileBucket>();
  for (const signal of signals) {
    const label = `${signal.targetType}: ${signal.targetValue}`;
    const existing = buckets.get(label);
    if (existing) {
      existing.weight += signal.weight;
    } else {
      buckets.set(label, { value: label, weight: signal.weight });
    }
  }
  return [...buckets.values()]
    .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight) || a.value.localeCompare(b.value))
    .slice(0, 8);
}

function formatBuckets(buckets: ProfileBucket[]): string[] {
  if (buckets.length === 0) {
    return ["- No confirmed signals yet."];
  }
  return buckets.map((bucket) => `- ${bucket.value} (weight ${formatWeight(bucket.weight)})`);
}

function formatOpenQuestions(signals: TasteSignalRecord[]): string[] {
  if (signals.length === 0) {
    return ["- No feedback yet. Import taste or react during playback to grow this profile."];
  }
  const negativeCount = signals.filter((signal) => signal.signalType === "negative_seed").length;
  if (negativeCount === 0) {
    return ["- Which sounds should Pockedio reduce or avoid?"];
  }
  return ["- Which positive signals are durable taste, and which were just right for that moment?"];
}

function formatWeight(weight: number): string {
  return Number.isInteger(weight) ? String(weight) : weight.toFixed(1);
}
