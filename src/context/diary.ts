import fs from "node:fs";
import path from "node:path";
import type { PockedioConfig } from "../config/schema.js";
import { runMigrations } from "../db/migrations.js";
import type { LlmClient } from "../llm/llmClient.js";
import { MemoryStore } from "../memory/store.js";

export type DiaryContext = {
  filePath: string;
  sourceMtime?: string;
  summary: string;
  listeningHint: string;
};

export type DiaryHistoryRefreshResult = {
  available: boolean;
  filesScanned: number;
  summariesGenerated: number;
  summariesReused: number;
  memoriesUpdated: number;
};

export type DiaryHistoryRefreshOptions = {
  limit?: number;
  now?: Date;
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
    sourceMtime: stat.mtime.toISOString(),
    ...metadataDiarySummary(latest, stat.mtime.toISOString())
  };
}

export async function refreshDiaryHistoryMemory(
  config: PockedioConfig,
  llm: LlmClient,
  options: DiaryHistoryRefreshOptions = {}
): Promise<DiaryHistoryRefreshResult> {
  const files = listDiaryFiles(config.diary.enabled ? config.diary.path : undefined, options.now).slice(0, options.limit ?? 120);
  if (files.length === 0) {
    return {
      available: false,
      filesScanned: 0,
      summariesGenerated: 0,
      summariesReused: 0,
      memoriesUpdated: 0
    };
  }

  runMigrations(config);
  const store = new MemoryStore(config);
  let summariesGenerated = 0;
  let summariesReused = 0;
  let memoriesUpdated = 0;
  const now = (options.now ?? new Date()).toISOString();
  try {
    for (const filePath of files) {
      const sourceMtime = fs.statSync(filePath).mtime.toISOString();
      let parsed = store.getDiarySummary(filePath, sourceMtime);
      if (parsed) {
        summariesReused += 1;
      } else {
        const result = await llm.generateText(buildDiarySummaryPrompt(filePath));
        const context = result.ok
          ? parseDiarySummaryPayload(result.value.trim())
          : localDiaryFallbackContext(filePath, sourceMtime);
        store.upsertDiarySummary({
          sourceFile: filePath,
          sourceMtime,
          summary: formatDiarySummaryPayload(context),
          generatedAt: now
        });
        parsed = store.getDiarySummary(filePath, sourceMtime);
        summariesGenerated += 1;
      }

      const context = {
        filePath,
        sourceMtime,
        ...parseDiarySummaryPayload(parsed?.summary ?? formatDiarySummaryPayload(metadataDiarySummary(filePath, sourceMtime)))
      };
      store.replaceMemoryItemBySourceKey(
        "diary",
        diaryMemorySourceKey(context),
        formatDiaryMemoryContent(context),
        buildDiaryMemoryMetadata(context, now, "history")
      );
      memoriesUpdated += 1;
    }
  } finally {
    store.close();
  }

  return {
    available: true,
    filesScanned: files.length,
    summariesGenerated,
    summariesReused,
    memoriesUpdated
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
      if (hasUnavailableDiaryListeningHint(parsed.listeningHint)) {
        const fallback = localDiaryFallbackContext(latest.filePath, latest.sourceMtime);
        store.upsertDiarySummary({
          sourceFile: latest.filePath,
          sourceMtime: latest.sourceMtime,
          summary: formatDiarySummaryPayload(fallback)
        });
        return {
          filePath: latest.filePath,
          sourceMtime: latest.sourceMtime,
          ...fallback
        };
      }
      return {
        filePath: latest.filePath,
        sourceMtime: latest.sourceMtime,
        summary: parsed.summary,
        listeningHint: parsed.listeningHint
      };
    }

    const result = await llm.generateText(buildDiarySummaryPrompt(latest.filePath));
    if (!result.ok) {
      return {
        filePath: latest.filePath,
        sourceMtime: latest.sourceMtime,
        ...localDiaryFallbackContext(latest.filePath, latest.sourceMtime)
      };
    }

    const parsed = parseDiarySummaryPayload(result.value.trim());
    if (!parsed.summary) {
      return {
        filePath: latest.filePath,
        sourceMtime: latest.sourceMtime,
        ...localDiaryFallbackContext(latest.filePath, latest.sourceMtime)
      };
    }

    store.upsertDiarySummary({
      sourceFile: latest.filePath,
      sourceMtime: latest.sourceMtime,
      summary: formatDiarySummaryPayload(parsed)
    });

    return {
      filePath: latest.filePath,
      sourceMtime: latest.sourceMtime,
      ...parsed
    };
  } finally {
    store.close();
  }
}

export function formatDiaryMemoryContent(context: DiaryContext): string {
  return [
    "Diary memory:",
    context.summary,
    `Listening fit: ${context.listeningHint}`
  ].join(" ");
}

export function buildDiaryMemoryMetadata(
  context: DiaryContext,
  generatedAt: string,
  source: "latest" | "history"
): Record<string, unknown> {
  const date = inferDiaryDate(context.filePath, context.sourceMtime);
  return {
    source: "diary",
    sourceFile: context.filePath,
    sourceMtime: context.sourceMtime,
    date,
    month: date?.slice(0, 7),
    moodTags: extractMoodTags(`${context.summary} ${context.listeningHint}`),
    lifeContextTags: extractLifeContextTags(`${context.summary} ${context.listeningHint}`),
    musicHint: context.listeningHint,
    generatedAt,
    sensitivity: "summary_only",
    scope: source
  };
}

export function diaryMemorySourceKey(context: DiaryContext): string {
  const sourceMtime = context.sourceMtime ?? hashText(context.summary);
  return `diary:${context.filePath}:${sourceMtime}`;
}

export function rankDiaryMemoryItems<T extends { content: string; metadata: unknown; createdAt: string }>(
  items: T[],
  query = "",
  limit = 5
): T[] {
  const queryTokens = tokenizeForDiaryRank(query);
  const queryMoodTags = extractMoodTags(query);
  const queryLifeContextTags = extractLifeContextTags(query);
  return items
    .map((item, index) => ({
      item,
      score: scoreDiaryMemory(item, queryTokens, queryMoodTags, queryLifeContextTags, index)
    }))
    .sort((a, b) => b.score - a.score || b.item.createdAt.localeCompare(a.item.createdAt))
    .slice(0, limit)
    .map(({ item }) => item);
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
    sourceMtime: stat.mtime.toISOString(),
    ...metadataDiarySummary(filePath, stat.mtime.toISOString())
  };
}

function localDiaryFallbackContext(filePath: string, sourceMtime: string): Omit<DiaryContext, "filePath"> {
  const metadata = metadataDiarySummary(filePath, sourceMtime);
  let content = "";
  try {
    content = fs.readFileSync(filePath, "utf8").slice(0, 8_000);
  } catch {
    return metadata;
  }
  return {
    summary: metadata.summary,
    listeningHint: deriveDiaryListeningHint(content)
  };
}

function hasUnavailableDiaryListeningHint(hint: string): boolean {
  return /^diary listening hint unavailable/i.test(hint.trim());
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
  if (/\b(exhausted|tired|drained|overloaded|burned out|heavy work|pressure|stress|stressed)\b|累|疲惫|疲劳|压力|焦虑|忙|熬夜|失眠|生病|不舒服|崩溃|低落|难过|烦躁/.test(text)) {
    return "Choose low-pressure, warm, emotionally steady music; avoid harsh textures, hype language, or dense vocals.";
  }
  if (/\b(peaceful|calm|quiet|relieved|gentle)\b|平静|轻松|安静|舒缓|放松|自在/.test(text)) {
    return "Support the calm with gentle pacing and uncluttered textures.";
  }
  if (/\b(excited|celebrat|energized|momentum|breakthrough)\b|开心|兴奋|期待|顺利|突破|进展|庆祝/.test(text)) {
    return "Allow brighter momentum while keeping the set personal rather than generic hype.";
  }
  if (/\b(reflective|nostalg|transition|closure|miss|memory)\b|反思|怀念|回忆|告别|转折|想念|感慨/.test(text)) {
    return "Favor reflective, warm, and spacious music that can hold memory without becoming too heavy.";
  }
  return "Use diary context lightly; choose music that fits the user's recent emotional energy without over-explaining it.";
}

function findLatestDiaryFile(root: string, now = new Date()): string | null {
  return listDiaryFiles(root, now)[0] ?? null;
}

function listDiaryFiles(root: string | undefined, now = new Date()): string[] {
  if (!root || !fs.existsSync(root)) {
    return [];
  }
  const entries = fs.readdirSync(root, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && /\.(md|markdown|txt)$/i.test(entry.name))
    .map((entry) => path.join(root, entry.name))
    .filter((filePath) => !isFutureDatedDiaryFile(filePath, now))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
}

function isFutureDatedDiaryFile(filePath: string, now: Date): boolean {
  const diaryDate = inferDiaryDate(filePath, undefined);
  if (!diaryDate) {
    return false;
  }
  return diaryDate > localDateKey(now);
}

function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function inferDiaryDate(filePath: string, sourceMtime: string | undefined): string | undefined {
  const basename = path.basename(filePath);
  const match = basename.match(/(20\d{2})[-_]?([01]\d)[-_]?([0-3]\d)/);
  if (match) {
    return `${match[1]}-${match[2]}-${match[3]}`;
  }
  return sourceMtime?.slice(0, 10);
}

function extractMoodTags(text: string): string[] {
  return extractTags(text, {
    tired: /\b(exhausted|tired|drained|burned out|burnout|fatigue)\b/i,
    calm: /\b(calm|peaceful|quiet|relieved|gentle)\b/i,
    excited: /\b(excited|celebrat|energized|breakthrough|momentum)\b/i,
    reflective: /\b(reflective|nostalg|memory|closure|transition)\b/i,
    stressed: /\b(stress|stressed|pressure|overloaded|anxious)\b/i
  });
}

function extractLifeContextTags(text: string): string[] {
  return extractTags(text, {
    work: /\b(work|meeting|deadline|project|focus|deep work|writing|study)\b/i,
    travel: /\b(travel|commute|flight|train|trip)\b/i,
    recovery: /\b(recovery|rest|sleep|decompress|reset)\b/i,
    social: /\b(friend|family|dinner|date|social)\b/i,
    weather: /\b(rain|rainy|winter|summer|humid|cold|hot)\b/i
  });
}

function extractTags(text: string, patterns: Record<string, RegExp>): string[] {
  return Object.entries(patterns)
    .filter(([, pattern]) => pattern.test(text))
    .map(([tag]) => tag);
}

function scoreDiaryMemory(
  item: { content: string; metadata: unknown },
  queryTokens: string[],
  queryMoodTags: string[],
  queryLifeContextTags: string[],
  index: number
): number {
  const metadata = isRecord(item.metadata) ? item.metadata : {};
  const moodTags = Array.isArray(metadata.moodTags) ? metadata.moodTags.filter((tag): tag is string => typeof tag === "string") : [];
  const lifeContextTags = Array.isArray(metadata.lifeContextTags) ? metadata.lifeContextTags.filter((tag): tag is string => typeof tag === "string") : [];
  const searchable = [
    item.content,
    metadata.date,
    metadata.month,
    metadata.musicHint,
    ...moodTags,
    ...lifeContextTags
  ].join(" ").toLowerCase();
  const queryScore = queryTokens.reduce((score, token) => score + (searchable.includes(token) ? 4 : 0), 0);
  const moodScore = queryMoodTags.reduce(
    (score, tag, tagIndex) => score + (moodTags.includes(tag) ? Math.max(3, 8 - tagIndex) : 0),
    0
  );
  const lifeContextScore = queryLifeContextTags.reduce(
    (score, tag) => score + (lifeContextTags.includes(tag) ? 4 : 0),
    0
  );
  return queryScore + moodScore + lifeContextScore + Math.max(0, 3 - index * 0.1);
}

function tokenizeForDiaryRank(query: string): string[] {
  return [...new Set(query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((token) => token.length >= 3))].slice(0, 12);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hashText(value: string): string {
  let hash = 0;
  for (const char of value) {
    hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  }
  return Math.abs(hash).toString(16);
}
