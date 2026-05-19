import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getConfigPath, getDatabasePath, getDjAudioDir, getPockedioHome } from "../src/config/paths.js";
import { ensureRuntimeDirs, loadConfig, saveConfig } from "../src/config/load.js";
import {
  buildConfigFromAnswers,
  buildConfigFromFirstSetupAnswers,
  formatCalendarSetupSummary,
  formatDiarySetupSummary,
  formatScheduledDjSetupSummary,
  formatSetupTasteImportSummary,
  formatWeatherSetupSummary,
  getDjPreviewPath,
  getDjTrialMenuChoices
} from "../src/config/setup.js";

const tempDirs: string[] = [];

function makeEnv(): NodeJS.ProcessEnv {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "pockedio-config-test-"));
  tempDirs.push(home);
  return { POCKEDIO_HOME: home };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("config paths", () => {
  it("uses POCKEDIO_HOME when provided", () => {
    const env = makeEnv();

    expect(getPockedioHome(env)).toBe(env.POCKEDIO_HOME);
    expect(getConfigPath(env)).toBe(path.join(env.POCKEDIO_HOME!, "config.json"));
    expect(getDatabasePath(env)).toBe(path.join(env.POCKEDIO_HOME!, "pockedio.sqlite"));
    expect(getDjAudioDir(env)).toBe(path.join(env.POCKEDIO_HOME!, "audio", "dj"));
  });
});

describe("config load and save", () => {
  it("loads defaults", () => {
    const config = loadConfig(makeEnv());

    expect(config.netease.baseUrl).toBe("http://127.0.0.1:3000");
    expect(config.weather.location).toBe("Shanghai");
    expect(config.calendar.enabled).toBe(true);
    expect(config.diary.enabled).toBe(false);
    expect(config.personality.mbti).toBeUndefined();
    expect(config.llm.model).toBe("gpt-4.1-mini");
    expect(config.llm.baseUrl).toBeUndefined();
    expect(config.llm.apiKeyEnv).toBe("OPENAI_API_KEY");
    expect(config.dj.language).toBe("English");
    expect(config.dj.displayName).toBe("Pockedio");
    expect(config.dj.programLength).toBe("standard");
    expect(config.dj.style).toBe("warm");
    expect(config.dj.personaPreference).toBe("scheduled");
    expect(config.dj.schedule.morning).toMatchObject({
      enabled: true,
      playTime: "08:45",
      prepareMinutesBefore: 10
    });
    expect(config.dj.schedule.evening).toMatchObject({
      enabled: true,
      playTime: "17:00",
      prepareMinutesBefore: 10
    });
  });

  it("loads OpenAI-compatible LLM endpoint settings", () => {
    const env = makeEnv();
    const configPath = getConfigPath(env);
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({
      llm: {
        model: "deepseek-v4-flash",
        baseUrl: "https://api.deepseek.com",
        apiKeyEnv: "DEEPSEEK_API_KEY"
      }
    }));

    const config = loadConfig(env);

    expect(config.llm.model).toBe("deepseek-v4-flash");
    expect(config.llm.baseUrl).toBe("https://api.deepseek.com");
    expect(config.llm.apiKeyEnv).toBe("DEEPSEEK_API_KEY");
  });

  it("saves and loads a valid MBTI type", () => {
    const env = makeEnv();
    const current = loadConfig(env);
    const config = buildConfigFromAnswers(current, {
      neteaseBaseUrl: current.netease.baseUrl,
      weatherLocation: current.weather.location,
      calendarEnabled: current.calendar.enabled,
      diaryEnabled: false,
      mbti: "INTJ",
      llmModel: current.llm.model,
      llmBaseUrl: current.llm.baseUrl,
      llmApiKeyEnv: current.llm.apiKeyEnv,
      fishAudioPythonPath: current.fishAudio.pythonPath,
      fishAudioScriptPath: current.fishAudio.scriptPath,
      fishAudioModelDir: current.fishAudio.modelDir,
      djLanguage: "English",
      djDisplayName: "Mina",
      djProgramLength: "short",
      djStyle: "direct",
      djPersonaPreference: "late-night",
      morningDjEnabled: true,
      morningDjPlayTime: "08:30",
      morningDjPrepareMinutesBefore: 12,
      eveningDjEnabled: false,
      eveningDjPlayTime: "18:15",
      eveningDjPrepareMinutesBefore: 20
    });

    ensureRuntimeDirs(config, env);
    saveConfig(config, env);

    expect(loadConfig(env).personality.mbti).toBe("INTJ");
    expect(loadConfig(env).dj).toMatchObject({
      language: "English",
      displayName: "Mina",
      programLength: "short",
      style: "direct",
      personaPreference: "late-night",
      schedule: {
        morning: { enabled: true, playTime: "08:30", prepareMinutesBefore: 12 },
        evening: { enabled: false, playTime: "18:15", prepareMinutesBefore: 20 }
      }
    });
  });

  it("rejects an invalid MBTI type", () => {
    const env = makeEnv();
    const configPath = getConfigPath(env);
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({ personality: { mbti: "NOPE" } }));

    expect(() => loadConfig(env)).toThrow();
  });

  it("accepts unset MBTI", () => {
    const env = makeEnv();
    const current = loadConfig(env);
    const config = buildConfigFromAnswers(current, {
      neteaseBaseUrl: current.netease.baseUrl,
      weatherLocation: current.weather.location,
      calendarEnabled: current.calendar.enabled,
      diaryEnabled: false,
      mbti: "Unset",
      llmModel: current.llm.model,
      llmBaseUrl: current.llm.baseUrl,
      llmApiKeyEnv: current.llm.apiKeyEnv,
      fishAudioPythonPath: current.fishAudio.pythonPath,
      fishAudioScriptPath: current.fishAudio.scriptPath,
      fishAudioModelDir: current.fishAudio.modelDir,
      djLanguage: current.dj.language,
      djDisplayName: current.dj.displayName,
      djProgramLength: current.dj.programLength,
      djStyle: current.dj.style,
      djPersonaPreference: current.dj.personaPreference,
      morningDjEnabled: current.dj.schedule.morning.enabled,
      morningDjPlayTime: current.dj.schedule.morning.playTime,
      morningDjPrepareMinutesBefore: current.dj.schedule.morning.prepareMinutesBefore,
      eveningDjEnabled: current.dj.schedule.evening.enabled,
      eveningDjPlayTime: current.dj.schedule.evening.playTime,
      eveningDjPrepareMinutesBefore: current.dj.schedule.evening.prepareMinutesBefore
    });

    expect(config.personality.mbti).toBeUndefined();
  });

  it("builds the first setup config from the selected DJ trial", () => {
    const env = makeEnv();
    const current = loadConfig(env);
    current.netease.baseUrl = "http://localhost:3000";
    current.llm.model = "deepseek-chat";
    current.llm.baseUrl = "https://api.deepseek.com";
    current.llm.apiKeyEnv = "DEEPSEEK_API_KEY";
    const config = buildConfigFromFirstSetupAnswers(current, {
      djChoice: "Nova",
      listenToDjTrial: true,
      importTasteNow: false,
      useWeather: true,
      weatherLocation: "Guangzhou",
      useCalendar: false,
      useDiary: true,
      diaryPath: "/Users/leonw/Diary"
    });

    expect(config.netease.baseUrl).toBe("http://localhost:3000");
    expect(config.llm).toMatchObject({
      model: "deepseek-chat",
      baseUrl: "https://api.deepseek.com",
      apiKeyEnv: "DEEPSEEK_API_KEY"
    });
    expect(config.dj).toMatchObject({
      displayName: "Nova",
      style: "direct",
      personaPreference: "modern male radio DJ"
    });
    expect(config.weather.location).toBe("Guangzhou");
    expect(config.calendar.enabled).toBe(false);
    expect(config.diary).toEqual({ enabled: true, path: "/Users/leonw/Diary" });
  });

  it("enables calendar from first setup when user chooses other context", () => {
    const env = makeEnv();
    const current = loadConfig(env);

    const config = buildConfigFromFirstSetupAnswers(current, {
      djChoice: "Mina",
      listenToDjTrial: false,
      importTasteNow: false,
      useWeather: false,
      useCalendar: true,
      useDiary: false
    });

    expect(config.calendar.enabled).toBe(true);
  });

  it("disables diary from first setup when user skips diary context", () => {
    const env = makeEnv();
    const current = loadConfig(env);

    const config = buildConfigFromFirstSetupAnswers(current, {
      djChoice: "Mina",
      listenToDjTrial: false,
      importTasteNow: false,
      useWeather: false,
      useCalendar: false,
      useDiary: false
    });

    expect(config.diary).toEqual({ enabled: false, path: undefined });
  });

  it("configures first setup scheduled DJ programs with user-facing ready times", () => {
    const env = makeEnv();
    const current = loadConfig(env);
    current.dj.schedule.morning.prepareMinutesBefore = 12;
    current.dj.schedule.evening.prepareMinutesBefore = 20;

    const config = buildConfigFromFirstSetupAnswers(current, {
      djChoice: "Mina",
      listenToDjTrial: false,
      importTasteNow: false,
      useWeather: false,
      useCalendar: false,
      useDiary: false,
      scheduledDjPrograms: "morning",
      morningDjReadyTime: "08:20"
    });

    expect(config.dj.schedule).toMatchObject({
      morning: { enabled: true, playTime: "08:20", prepareMinutesBefore: 12 },
      evening: { enabled: false, playTime: "17:00", prepareMinutesBefore: 20 }
    });
    expect(formatScheduledDjSetupSummary(config)).toBe("Morning weekdays 08:20");
  });

  it("formats skipped first setup scheduled DJ programs", () => {
    const env = makeEnv();
    const current = loadConfig(env);

    const config = buildConfigFromFirstSetupAnswers(current, {
      djChoice: "Mina",
      listenToDjTrial: false,
      importTasteNow: false,
      useWeather: false,
      useCalendar: false,
      useDiary: false,
      scheduledDjPrograms: "not_now"
    });

    expect(config.dj.schedule.morning.enabled).toBe(false);
    expect(config.dj.schedule.evening.enabled).toBe(false);
    expect(formatScheduledDjSetupSummary(config)).toBe("skipped");
  });

  it("uses accepted setup trial audio paths for Mina and Nova", () => {
    expect(getDjPreviewPath("Mina")).toBe("/Users/leonw/.pockedio/audio/previews/mina.wav");
    expect(getDjPreviewPath("Nova")).toBe("/Users/leonw/.pockedio/audio/previews/nova.wav");
  });

  it("lets first setup hear multiple DJ trials before choosing", () => {
    expect(getDjTrialMenuChoices()).toEqual([
      { name: "Mina", value: "Mina" },
      { name: "Nova", value: "Nova" },
      { name: "Choose your DJ", value: "choose" }
    ]);
  });

  it("keeps setup taste import summaries concise", () => {
    expect(formatSetupTasteImportSummary({
      trackCount: 548,
      artists: ["A", "B", "C"],
      playlists: ["NetEase playlist 68177095"],
      tastePath: "/tmp/pockedio/taste.md"
    })).toEqual([
      "Imported",
      "  Tracks            548",
      "  Artists           3 detected",
      "  Playlists         1 imported",
      "  taste.md          /tmp/pockedio/taste.md",
      "",
      "taste.md will grow as we talk and listen, so Pockedio can understand you better."
    ].join("\n"));
  });

  it("formats weather setup checks", () => {
    expect(formatWeatherSetupSummary({
      location: "Guangzhou",
      matchedLocation: "Guangzhou, China",
      temperatureC: 28,
      relativeHumidity: 95,
      precipitation: 0,
      weatherCode: 0,
      windSpeed: 8,
      summary: "Weather in Guangzhou, China: 28C, humidity 95%, precipitation 0, wind 8 km/h."
    })).toBe([
      "Weather ready",
      "  Location          Guangzhou, China",
      "  Current           28C, humidity 95%",
      "",
      "Pockedio may use weather lightly when choosing music and replying."
    ].join("\n"));
    expect(formatWeatherSetupSummary(null)).toBe([
      "Weather not found.",
      "You can skip it now and set it later."
    ].join("\n"));
  });

  it("formats calendar setup checks", () => {
    expect(formatCalendarSetupSummary({
      available: true,
      events: [
        {
          calendarName: "Work",
          title: "Planning Review",
          startTime: "Sun May 17 09:00:00 2026",
          endTime: "Sun May 17 10:00:00 2026",
          isAllDay: false
        },
        {
          calendarName: "Personal",
          title: "Dinner",
          startTime: "Mon May 18 19:00:00 2026",
          endTime: "Mon May 18 20:00:00 2026",
          isAllDay: false
        }
      ],
      summary: "Calendar has 2 events in the last 7 days."
    })).toBe([
      "Calendar ready",
      "  Events read       2",
      "  Window            Last 7 days",
      "",
      "Pockedio may use this lightly when replying and planning scheduled DJ."
    ].join("\n"));

    expect(formatCalendarSetupSummary({
      available: false,
      events: [],
      summary: "Calendar context unavailable.",
      warning: "Not authorized to send Apple events to Calendar."
    })).toBe([
      "Calendar unavailable.",
      "Not authorized to send Apple events to Calendar. Enable Calendar access for your terminal in System Settings > Privacy & Security > Automation or Calendars, then run setup again.",
      "You can skip it now and set it later."
    ].join("\n"));
  });

  it("formats diary setup checks", () => {
    expect(formatDiarySetupSummary({
      filePath: "/Users/leonw/Diary/2026-05-18.md",
      summary: "Latest diary file: 2026-05-18.md, modified 2026-05-18T10:00:00.000Z."
    })).toBe([
      "Diary ready",
      "  Path              /Users/leonw/Diary",
      "  Latest entry      2026-05-18.md",
      "",
      "Pockedio will use diary context lightly and locally."
    ].join("\n"));

    expect(formatDiarySetupSummary(null)).toBe([
      "Diary unavailable.",
      "Check the path and set it later if needed."
    ].join("\n"));
  });
});
