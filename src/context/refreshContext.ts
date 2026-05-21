import path from "node:path";
import { loadConfig } from "../config/load.js";
import type { PockedioConfig } from "../config/schema.js";
import { MemoryStore } from "../memory/store.js";
import { buildContext, type ContextBuilderOptions } from "./contextBuilder.js";
import { consolidateContextMemory, type ContextMemoryRefreshResult } from "./contextMemory.js";

export type RefreshContextResult = ContextMemoryRefreshResult & {
  tastePath: string;
};

export async function refreshContext(
  config: PockedioConfig = loadConfig(),
  options: ContextBuilderOptions = {}
): Promise<RefreshContextResult> {
  const context = await buildContext(config, {
    ...options,
    calendarWindow: options.calendarWindow ?? "last7DaysAndToday",
    calendarSource: options.calendarSource ?? "interactive"
  });
  const store = new MemoryStore(config);
  try {
    const refreshed = consolidateContextMemory(store, context);
    return {
      ...refreshed,
      tastePath: context.tastePath
    };
  } finally {
    store.close();
  }
}

export async function runRefreshContext(): Promise<void> {
  const result = await refreshContext();
  console.log(formatRefreshContextResult(result));
}

export function formatRefreshContextResult(result: RefreshContextResult): string {
  return [
    "Refreshing context...",
    "",
    "Calendar",
    `  Status            ${result.calendar.available ? "available" : "unavailable"}`,
    `  Events read       ${result.calendar.eventsRead}`,
    `  Agenda memories   ${formatUpdatedCount(result.calendar.memoriesUpdated)}`,
    "",
    "Diary",
    `  Status            ${result.diary.available ? "available" : "unavailable"}`,
    result.diary.latestFile ? `  Latest file       ${path.basename(result.diary.latestFile)}` : "",
    `  Diary memories    ${formatUpdatedCount(result.diary.memoriesUpdated)}`,
    "",
    `taste.md           ${result.tastePath}`,
    "",
    "Context memory is ready for future stations."
  ].filter((line) => line !== "").join("\n");
}

function formatUpdatedCount(count: number): string {
  return count === 1 ? "1 updated" : `${count} updated`;
}
