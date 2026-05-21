import { loadConfig } from "../config/load.js";
import type { PockedioConfig } from "../config/schema.js";
import { runMigrations } from "../db/migrations.js";
import type { LlmClient } from "../llm/llmClient.js";
import { createLlmClient } from "../llm/openaiClient.js";
import { MemoryStore, type CalendarEventSource, type MemorySummaryRecord, type RecentSessionSummary, type TasteProfileSnapshotRecord, type TasteSignalRecord } from "../memory/store.js";
import { readCalendarContext, type CalendarContext, type CalendarProcessRunner, type CalendarReadWindow } from "./calendar.js";
import { readDiaryContextWithLlmSummary, type DiaryContext } from "./diary.js";
import { readWeatherContext, type WeatherContext } from "./weather.js";

export type PockedioContext = {
  now: string;
  timeOfDay: "morning" | "afternoon" | "evening" | "night";
  calendar: CalendarContext;
  weather: WeatherContext | null;
  diary: DiaryContext | null;
  tastePath: string;
  tasteSignals: TasteSignalRecord[];
  tasteProfile: TasteProfileSnapshotRecord | null;
  memorySummaries: MemorySummaryRecord[];
  personality: PockedioConfig["personality"];
  recentSessions: RecentSessionSummary[];
};

export type ContextBuilderOptions = {
  now?: Date;
  calendarRunner?: CalendarProcessRunner;
  calendarWindow?: CalendarReadWindow;
  calendarSource?: CalendarEventSource;
  fetchImpl?: typeof fetch;
  llm?: LlmClient;
};

export async function buildContext(
  config: PockedioConfig = loadConfig(),
  options: ContextBuilderOptions = {}
): Promise<PockedioContext> {
  const now = options.now ?? new Date();
  runMigrations(config);
  const store = new MemoryStore(config);
  try {
    const calendarWindow = options.calendarWindow ?? "today";
    const calendarTimeout = calendarWindow === "today" ? 20_000 : 60_000;
    const [calendar, weather] = await Promise.all([
      readCalendarContext(config.calendar.enabled, calendarTimeout, options.calendarRunner, calendarWindow),
      config.weather.enabled
        ? readWeatherContext(config.weather.location, options.fetchImpl)
        : Promise.resolve(null)
    ]);
    if (calendar.available) {
      store.upsertCalendarEvents(calendar.events.map((event) => ({
        calendarName: event.calendarName,
        title: event.title,
        startTime: event.startTime,
        endTime: event.endTime,
        isAllDay: event.isAllDay,
        source: options.calendarSource ?? "interactive",
        readAt: now.toISOString()
      })));
    }

    return {
      now: now.toISOString(),
      timeOfDay: getTimeOfDay(now),
      calendar,
      weather,
      diary: await readDiaryContextWithLlmSummary(config, options.llm ?? createLlmClient(config)),
      tastePath: config.paths.taste,
      tasteSignals: store.getTasteSignals(30),
      tasteProfile: store.getLatestTasteProfileSnapshot(),
      memorySummaries: store.getRecentMemorySummaries(5),
      personality: config.personality,
      recentSessions: store.getRecentSessionSummaries(5)
    };
  } finally {
    store.close();
  }
}

export function getTimeOfDay(date: Date): PockedioContext["timeOfDay"] {
  const hour = date.getHours();
  if (hour >= 5 && hour < 12) {
    return "morning";
  }
  if (hour >= 12 && hour < 17) {
    return "afternoon";
  }
  if (hour >= 17 && hour < 22) {
    return "evening";
  }
  return "night";
}
