import fs from "node:fs";
import path from "node:path";
import type { PockedioConfig } from "../config/schema.js";

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

function findLatestDiaryFile(root: string): string | null {
  const entries = fs.readdirSync(root, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && /\.(md|markdown|txt)$/i.test(entry.name))
    .map((entry) => path.join(root, entry.name))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);

  return files[0] ?? null;
}
