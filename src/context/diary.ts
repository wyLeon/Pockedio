import fs from "node:fs";
import path from "node:path";
import type { PockedioConfig } from "../config/schema.js";
import { runMigrations } from "../db/migrations.js";
import type { LlmClient } from "../llm/llmClient.js";
import { MemoryStore } from "../memory/store.js";

export type DiaryContext = {
  filePath: string;
  summary: string;
};

export function readDiaryContext(config: PockedioConfig): DiaryContext | null {
  if (!config.diary.enabled || !config.diary.path) {
    return null;
  }

  if (!fs.existsSync(config.diary.path)) {
    return null;
  }

  const latest = findLatestDiaryFile(config.diary.path);
  if (!latest) {
    return null;
  }

  const stat = fs.statSync(latest);
  return {
    filePath: latest,
    summary: `Latest diary file: ${path.basename(latest)}, modified ${stat.mtime.toISOString()}.`
  };
}

export async function readDiaryContextWithLlmSummary(
  config: PockedioConfig,
  llm: LlmClient
): Promise<DiaryContext | null> {
  const latest = getLatestDiaryFileWithMtime(config);
  if (!latest) {
    return null;
  }

  runMigrations(config);
  const store = new MemoryStore(config);
  try {
    const cached = store.getDiarySummary(latest.filePath, latest.sourceMtime);
    if (cached) {
      return {
        filePath: latest.filePath,
        summary: cached.summary
      };
    }

    const result = await llm.generateText(buildDiarySummaryPrompt(latest.filePath));
    if (!result.ok) {
      return metadataDiaryContext(latest.filePath);
    }

    const summary = result.value.trim();
    if (!summary) {
      return metadataDiaryContext(latest.filePath);
    }

    store.upsertDiarySummary({
      sourceFile: latest.filePath,
      sourceMtime: latest.sourceMtime,
      summary
    });

    return {
      filePath: latest.filePath,
      summary
    };
  } finally {
    store.close();
  }
}

function getLatestDiaryFileWithMtime(config: PockedioConfig): { filePath: string; sourceMtime: string } | null {
  if (!config.diary.enabled || !config.diary.path || !fs.existsSync(config.diary.path)) {
    return null;
  }

  const filePath = findLatestDiaryFile(config.diary.path);
  if (!filePath) {
    return null;
  }

  return {
    filePath,
    sourceMtime: fs.statSync(filePath).mtime.toISOString()
  };
}

function metadataDiaryContext(filePath: string): DiaryContext {
  const stat = fs.statSync(filePath);
  return {
    filePath,
    summary: `Latest diary file: ${path.basename(filePath)}, modified ${stat.mtime.toISOString()}.`
  };
}

function buildDiarySummaryPrompt(filePath: string): string {
  const content = fs.readFileSync(filePath, "utf8").slice(0, 8_000);
  return [
    "Summarize this diary entry for Pockedio, a local personal DJ.",
    "Use 3-5 concise sentences.",
    "Focus on recent emotional context, energy level, work/life pressure, and what music setting may fit.",
    "Do not diagnose the user. Do not infer personality type. Do not quote raw diary text.",
    "Avoid names or sensitive details unless essential.",
    "",
    "Diary entry:",
    content
  ].join("\n");
}

function findLatestDiaryFile(root: string): string | null {
  const entries = fs.readdirSync(root, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && /\.(md|markdown|txt)$/i.test(entry.name))
    .map((entry) => path.join(root, entry.name))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);

  return files[0] ?? null;
}
