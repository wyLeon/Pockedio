import fs from "node:fs";
import path from "node:path";
import type { PockedioConfig } from "../config/schema.js";
import { runMigrations } from "../db/migrations.js";
import type { LlmClient } from "../llm/llmClient.js";
import { MemoryStore } from "../memory/store.js";

export type DiaryContext = {
  filePath: string;
  summary: string;
  listeningHint: string;
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
    ...metadataDiarySummary(latest, stat.mtime.toISOString())
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
      const parsed = parseDiarySummaryPayload(cached.summary);
      return {
        filePath: latest.filePath,
        summary: parsed.summary,
        listeningHint: parsed.listeningHint
      };
    }

    const result = await llm.generateText(buildDiarySummaryPrompt(latest.filePath));
    if (!result.ok) {
      return metadataDiaryContext(latest.filePath);
    }

    const parsed = parseDiarySummaryPayload(result.value.trim());
    if (!parsed.summary) {
      return metadataDiaryContext(latest.filePath);
    }

    store.upsertDiarySummary({
      sourceFile: latest.filePath,
      sourceMtime: latest.sourceMtime,
      summary: formatDiarySummaryPayload(parsed)
    });

    return {
      filePath: latest.filePath,
      ...parsed
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
    ...metadataDiarySummary(filePath, stat.mtime.toISOString())
  };
}

function buildDiarySummaryPrompt(filePath: string): string {
  const content = fs.readFileSync(filePath, "utf8").slice(0, 8_000);
  return [
    "Summarize this diary entry for Pockedio, a local personal DJ.",
    "Return exactly two labeled lines:",
    "Summary: 2-3 concise sentences about recent emotional context, energy level, and work/life pressure.",
    "Listening hint: one concise sentence about what music setting may fit.",
    "Do not diagnose the user. Do not infer personality type. Do not quote raw diary text.",
    "Avoid names or sensitive details unless essential.",
    "",
    "Diary entry:",
    content
  ].join("\n");
}

function metadataDiarySummary(filePath: string, sourceMtime: string): Omit<DiaryContext, "filePath"> {
  const summary = `Latest diary file: ${path.basename(filePath)}, modified ${sourceMtime}.`;
  return {
    summary,
    listeningHint: "Diary listening hint unavailable; do not overfit music to diary context."
  };
}

function parseDiarySummaryPayload(value: string): Omit<DiaryContext, "filePath"> {
  const summaryMatch = value.match(/^Summary:\s*(.+?)(?:\nListening hint:|\n*$)/is);
  const hintMatch = value.match(/^Listening hint:\s*(.+)$/im);
  const summary = summaryMatch?.[1]?.trim() || value.trim();
  const listeningHint = hintMatch?.[1]?.trim() || deriveDiaryListeningHint(summary);
  return {
    summary,
    listeningHint
  };
}

function formatDiarySummaryPayload(input: Omit<DiaryContext, "filePath">): string {
  return [
    `Summary: ${input.summary}`,
    `Listening hint: ${input.listeningHint}`
  ].join("\n");
}

function deriveDiaryListeningHint(summary: string): string {
  const text = summary.toLowerCase();
  if (/\b(exhausted|tired|drained|overloaded|burned out|heavy work|pressure|stress|stressed)\b/.test(text)) {
    return "Choose low-pressure, warm, emotionally steady music; avoid harsh textures, hype language, or dense vocals.";
  }
  if (/\b(peaceful|calm|quiet|relieved|gentle)\b/.test(text)) {
    return "Support the calm with gentle pacing and uncluttered textures.";
  }
  if (/\b(excited|celebrat|energized|momentum|breakthrough)\b/.test(text)) {
    return "Allow brighter momentum while keeping the set personal rather than generic hype.";
  }
  if (/\b(reflective|nostalg|transition|closure|miss|memory)\b/.test(text)) {
    return "Favor reflective, warm, and spacious music that can hold memory without becoming too heavy.";
  }
  return "Use diary context lightly; choose music that fits the user's recent emotional energy without over-explaining it.";
}

function findLatestDiaryFile(root: string): string | null {
  const entries = fs.readdirSync(root, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && /\.(md|markdown|txt)$/i.test(entry.name))
    .map((entry) => path.join(root, entry.name))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);

  return files[0] ?? null;
}
