import { createHash } from "node:crypto";
import type { MemoryStore } from "../memory/store.js";
import type { PockedioContext } from "./contextBuilder.js";

export type ContextMemoryRefreshResult = {
  calendar: {
    available: boolean;
    eventsRead: number;
    memoriesUpdated: number;
  };
  diary: {
    available: boolean;
    latestFile?: string;
    memoriesUpdated: number;
  };
};

export function consolidateContextMemory(
  store: MemoryStore,
  context: PockedioContext
): ContextMemoryRefreshResult {
  const calendar = consolidateAgendaMemory(store, context);
  const diary = consolidateDiaryMemory(store, context);
  return { calendar, diary };
}

function consolidateAgendaMemory(
  store: MemoryStore,
  context: PockedioContext
): ContextMemoryRefreshResult["calendar"] {
  if (!context.calendar.available) {
    return {
      available: false,
      eventsRead: 0,
      memoriesUpdated: 0
    };
  }

  const day = context.now.slice(0, 10);
  const sourceKey = `calendar:${day}`;
  const content = [
    "Agenda memory:",
    context.calendar.summary,
    context.calendar.listeningHint
  ].join(" ");
  store.replaceMemoryItemBySourceKey("agenda", sourceKey, content, {
    source: "calendar",
    day,
    eventCount: context.calendar.events.length,
    generatedAt: context.now,
    confidence: context.calendar.events.length > 0 ? "medium" : "low"
  });

  return {
    available: true,
    eventsRead: context.calendar.events.length,
    memoriesUpdated: 1
  };
}

function consolidateDiaryMemory(
  store: MemoryStore,
  context: PockedioContext
): ContextMemoryRefreshResult["diary"] {
  if (!context.diary) {
    return {
      available: false,
      memoriesUpdated: 0
    };
  }

  const sourceMtime = context.diary.sourceMtime ?? hashText(context.diary.summary);
  const sourceKey = `diary:${context.diary.filePath}:${sourceMtime}`;
  const content = [
    "Diary memory:",
    context.diary.summary,
    `Listening fit: ${context.diary.listeningHint}`
  ].join(" ");
  store.replaceMemoryItemBySourceKey("diary", sourceKey, content, {
    source: "diary",
    sourceFile: context.diary.filePath,
    sourceMtime,
    generatedAt: context.now,
    sensitivity: "summary_only"
  });

  return {
    available: true,
    latestFile: context.diary.filePath,
    memoriesUpdated: 1
  };
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}
