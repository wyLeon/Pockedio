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
    const summary = buildGeneratedTasteProfile(signals);
    fs.mkdirSync(path.dirname(config.paths.taste), { recursive: true });
    const existing = fs.existsSync(config.paths.taste)
      ? fs.readFileSync(config.paths.taste, "utf8")
      : "# Pockedio Taste\n";
    fs.writeFileSync(config.paths.taste, upsertGeneratedTasteProfileSection(existing, summary));
    const snapshotId = store.addTasteProfileSnapshot(summary, {
      signalCount: signals.length,
      generatedBy: "local_feedback_signals"
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

export function buildGeneratedTasteProfile(signals: TasteSignalRecord[]): string {
  const favorites = aggregate(signals.filter((signal) => signal.signalType === "favorite"));
  const positives = aggregate(signals.filter((signal) => signal.signalType === "positive_seed"));
  const negatives = aggregate(signals.filter((signal) => signal.signalType === "negative_seed"));
  const hardAvoids = aggregate(signals.filter((signal) => signal.signalType === "ban"));
  const vibes = aggregate(signals.filter((signal) => signal.signalType === "vibe_preset"));

  return [
    "## Generated Taste Profile",
    "",
    "Generated from local listening feedback. Edit anything outside this generated block freely.",
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
