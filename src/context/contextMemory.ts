import type { MemoryStore } from "../memory/store.js";
import type { PockedioContext } from "./contextBuilder.js";
import { buildDiaryMemoryMetadata, diaryMemorySourceKey, formatDiaryMemoryContent } from "./diary.js";

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
    nowStatus: context.calendar.state.nowStatus,
    tags: context.calendar.state.tags,
    nextDaysHighlights: context.calendar.state.nextDaysHighlights,
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

  const sourceKey = diaryMemorySourceKey(context.diary);
  const content = formatDiaryMemoryContent(context.diary);
  store.replaceMemoryItemBySourceKey("diary", sourceKey, content, {
    ...buildDiaryMemoryMetadata(context.diary, context.now, "latest"),
    sourceKey
  });

  return {
    available: true,
    latestFile: context.diary.filePath,
    memoriesUpdated: 1
  };
}
