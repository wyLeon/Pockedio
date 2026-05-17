import { loadConfig } from "../config/load.js";
import type { PockedioConfig } from "../config/schema.js";
import { runMigrations } from "../db/migrations.js";
import { MemoryStore, type RecentSessionSummary } from "../memory/store.js";
import { readCalendarContext, type CalendarContext, type CalendarProcessRunner } from "./calendar.js";
import { readDiaryContext, type DiaryContext } from "./diary.js";
import { readWeatherContext, type WeatherContext } from "./weather.js";

export type PockedioContext = {
  now: string;
  timeOfDay: "morning" | "afternoon" | "evening" | "night";
  calendar: CalendarContext;
  weather: WeatherContext | null;
  diary: DiaryContext | null;
  tastePath: string;
  personality: PockedioConfig["personality"];
  recentSessions: RecentSessionSummary[];
};

export type ContextBuilderOptions = {
  now?: Date;
  calendarRunner?: CalendarProcessRunner;
  fetchImpl?: typeof fetch;
};

export async function buildContext(
  config: PockedioConfig = loadConfig(),
  options: ContextBuilderOptions = {}
): Promise<PockedioContext> {
  const now = options.now ?? new Date();
  runMigrations(config);
  const store = new MemoryStore(config);
  try {
    const [calendar, weather] = await Promise.all([
      readCalendarContext(config.calendar.enabled, 20_000, options.calendarRunner),
      readWeatherContext(config.weather.location, options.fetchImpl)
    ]);

    return {
      now: now.toISOString(),
      timeOfDay: getTimeOfDay(now),
      calendar,
      weather,
      diary: readDiaryContext(config),
      tastePath: config.paths.taste,
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
