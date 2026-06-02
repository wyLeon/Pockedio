import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getConfigPath, getDatabasePath, getDjAudioDir, getLlmSecretsPath, getNetEaseCookiePath, getPockedioHome } from "../src/config/paths.js";
import { ensureRuntimeDirs, loadConfig, saveConfig } from "../src/config/load.js";
import { normalizeNetEaseCookie, readNetEaseCookie, saveNetEaseCookie } from "../src/config/neteaseAuth.js";
import { readLlmApiKey, saveLlmApiKey } from "../src/config/llmSecrets.js";
import {
  __netEaseQrLoginForTests,
  buildConfigFromAnswers,
  buildConfigFromFirstSetupAnswers,
  buildConfigFromSchedulerSetupAction,
  formatCalendarSetupSummary,
  formatDiarySetupSummary,
  formatSetupMenuEntry,
  formatSetupMenuTitle,
  formatScheduledDjSetupSummary,
  formatSetupTasteImportFailure,
  formatSetupTasteImportSummary,
  formatSetupTasteStatus,
  formatNetEaseSetupSummary,
  formatWeatherSetupSummary,
  getDjPreviewPath,
  getDjTrialMenuChoices,
  getNetEaseQualityMenuChoices,
  getNetEaseSetupMethodChoices
} from "../src/config/setup.js";

const tempDirs: string[] = [];

function makeEnv(): NodeJS.ProcessEnv {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "pockedio-config-test-"));
  tempDirs.push(home);
  return { POCKEDIO_HOME: home };
}

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, "");
}

function saveConfigAndReload(env: NodeJS.ProcessEnv, config: ReturnType<typeof loadConfig>): ReturnType<typeof loadConfig> {
  ensureRuntimeDirs(config, env);
  saveConfig(config, env);
  return loadConfig(env);
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
    expect(getNetEaseCookiePath(env)).toBe(path.join(env.POCKEDIO_HOME!, "secrets", "netease.cookie"));
    expect(getLlmSecretsPath(env)).toBe(path.join(env.POCKEDIO_HOME!, "secrets", "llm-api-keys.json"));
  });
});

describe("config load and save", () => {
  it("loads defaults", () => {
    const config = loadConfig(makeEnv());

    expect(config.netease.baseUrl).toBe("http://127.0.0.1:3000");
    expect(config.music.provider).toBe("netease");
    expect(config.netease.authMode).toBe("anonymous");
    expect(config.netease.qualityLevel).toBe("standard");
    expect(config.paths.neteaseCookie).toContain(path.join("secrets", "netease.cookie"));
    expect(config.paths.llmSecrets).toContain(path.join("secrets", "llm-api-keys.json"));
    expect(config.weather.location).toBe("Shanghai");
    expect(config.weather.enabled).toBe(false);
    expect(config.calendar.enabled).toBe(false);
    expect(config.diary.enabled).toBe(false);
    expect(config.diary.path).toBeUndefined();
    expect(config.memory).toEqual({ dailyHeartbeat: true, heartbeatIntervalHours: 6, heartbeatHistoryLimit: 20 });
    expect(config.personality.mbti).toBeUndefined();
    expect(config.llm.model).toBe("gpt-4.1-mini");
    expect(config.llm.baseUrl).toBeUndefined();
    expect(config.llm.apiKeyEnv).toBe("OPENAI_API_KEY");
    expect(config.tts).toEqual({
      provider: "auto",
      macosVoice: "vale",
      kokoroVoice: "af_nicole",
      fishVoice: "mina"
    });
    expect(config.kokoroAudio).toEqual({
      pythonPath: ".cache/kokoro-spike/.venv/bin/python",
      modelPath: ".cache/kokoro-spike/kokoro-v1.0.onnx",
      voicesPath: ".cache/kokoro-spike/voices-v1.0.bin"
    });
    expect(config.dj.language).toBe("English");
    expect(config.dj.displayName).toBe("Pockedio");
    expect(config.dj.programLength).toBe("standard");
    expect(config.dj.style).toBe("warm");
    expect(config.dj.personaPreference).toBe("scheduled");
    expect(config.dj.schedule.morning).toMatchObject({
      enabled: true,
      playTime: "08:45",
      prepareMinutesBefore: 20
    });
    expect(config.dj.schedule.evening).toMatchObject({
      enabled: true,
      playTime: "17:00",
      prepareMinutesBefore: 20
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

  it("loads FishAudio reference voice settings", () => {
    const env = makeEnv();
    const current = loadConfig(env);
    current.fishAudio.referenceAudioPath = "/tmp/mina.wav";
    current.fishAudio.referenceText = "Mina is here.";

    saveConfig(current, env);
    const config = loadConfig(env);

    expect(config.fishAudio.referenceAudioPath).toBe("/tmp/mina.wav");
    expect(config.fishAudio.referenceText).toBe("Mina is here.");
  });

  it("stores NetEase account cookies outside normal config", () => {
    const env = makeEnv();
    const current = loadConfig(env);
    const config = saveConfigAndReload(env, {
      ...current,
      netease: {
        ...current.netease,
        authMode: "account",
        qualityLevel: "exhigh"
      }
    });

    ensureRuntimeDirs(config, env);
    saveNetEaseCookie(config, "abc123");

    expect(readNetEaseCookie(config)).toBe("MUSIC_U=abc123");
    expect(fs.readFileSync(config.paths.neteaseCookie, "utf8")).toContain("MUSIC_U=abc123");
  });

  it("stores LLM API keys outside normal config with owner-only permissions", () => {
    const env = makeEnv();
    const config = loadConfig(env);
    ensureRuntimeDirs(config, env);

    saveLlmApiKey(config, "OPENAI_API_KEY", "sk-test");

    expect(readLlmApiKey(config, "OPENAI_API_KEY")).toBe("sk-test");
    expect(fs.readFileSync(config.paths.llmSecrets, "utf8")).toContain("OPENAI_API_KEY");
    expect(JSON.stringify(loadConfig(env))).not.toContain("sk-test");
    const mode = fs.statSync(config.paths.llmSecrets).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("normalizes pasted NetEase cookies", () => {
    expect(normalizeNetEaseCookie("MUSIC_U=abc; other=1")).toBe("MUSIC_U=abc; other=1");
    expect(normalizeNetEaseCookie("abc")).toBe("MUSIC_U=abc");
  });

  it("saves and loads a valid MBTI type", () => {
    const env = makeEnv();
    const current = loadConfig(env);
    const config = buildConfigFromAnswers(current, {
      neteaseBaseUrl: current.netease.baseUrl,
      weatherEnabled: current.weather.enabled,
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
      weatherEnabled: current.weather.enabled,
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
    const diaryPath = path.join(os.homedir(), "Diary");
    const config = buildConfigFromFirstSetupAnswers(current, {
      djChoice: "Nova",
      listenToDjTrial: true,
      importTasteNow: false,
      useWeather: true,
      weatherLocation: "Guangzhou",
      useCalendar: false,
      useDiary: true,
      diaryPath
    });

    expect(config.netease.baseUrl).toBe("http://localhost:3000");
    expect(config.netease).toMatchObject({
      authMode: "anonymous",
      qualityLevel: "standard"
    });
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
    expect(config.fishAudio.referenceAudioPath).toBe(path.join(os.homedir(), ".pockedio", "audio", "previews", "nova.wav"));
    expect(config.fishAudio.referenceText).toBe("Nova here. Bright rhythm, clean motion, and just enough spark to move.");
    expect(config.weather.enabled).toBe(true);
    expect(config.weather.location).toBe("Guangzhou");
    expect(config.calendar.enabled).toBe(false);
    expect(config.diary).toEqual({ enabled: true, path: diaryPath });
  });

  it("disables weather from first setup when user skips weather context", () => {
    const env = makeEnv();
    const current = loadConfig(env);
    current.weather.location = "Guangzhou";

    const config = buildConfigFromFirstSetupAnswers(current, {
      djChoice: "Mina",
      listenToDjTrial: false,
      importTasteNow: false,
      useWeather: false,
      useCalendar: false,
      useDiary: false
    });

    expect(config.weather).toEqual({
      enabled: false,
      location: "Guangzhou"
    });
  });

  it("builds first setup music provider account settings", () => {
    const env = makeEnv();
    const current = loadConfig(env);

    const config = buildConfigFromFirstSetupAnswers(current, {
      neteaseSetupMethod: "cookie",
      musicProvider: "netease",
      neteaseQualityLevel: "lossless",
      djChoice: "Mina",
      listenToDjTrial: false,
      importTasteNow: false,
      useWeather: false,
      useCalendar: false,
      useDiary: false
    });

    expect(config.netease).toMatchObject({
      authMode: "account",
      qualityLevel: "lossless"
    });
    expect(config.music.provider).toBe("netease");
    expect(formatNetEaseSetupSummary(config)).toBe("NetEase Cloud Music - account-backed (lossless)");
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

  it("configures scheduler setup without resetting the other scheduled program", () => {
    const env = makeEnv();
    const current = loadConfig(env);
    current.dj.schedule.morning.prepareMinutesBefore = 12;
    current.dj.schedule.evening.enabled = true;
    current.dj.schedule.evening.playTime = "18:30";
    current.dj.schedule.evening.prepareMinutesBefore = 20;

    const config = buildConfigFromSchedulerSetupAction(current, "morning", {
      action: "change_time",
      playTime: "08:10"
    });

    expect(config.dj.schedule).toMatchObject({
      morning: { enabled: true, playTime: "08:10", prepareMinutesBefore: 12 },
      evening: { enabled: true, playTime: "18:30", prepareMinutesBefore: 20 }
    });
    expect(formatScheduledDjSetupSummary(config)).toBe("Morning weekdays 08:10; Evening weekdays 18:30");
  });

  it("disables all scheduled DJ programs from scheduler setup", () => {
    const env = makeEnv();
    const current = loadConfig(env);
    current.dj.schedule.morning.enabled = true;
    current.dj.schedule.evening.enabled = true;

    const config = buildConfigFromSchedulerSetupAction(current, "disable_all");

    expect(config.dj.schedule.morning.enabled).toBe(false);
    expect(config.dj.schedule.evening.enabled).toBe(false);
    expect(formatScheduledDjSetupSummary(config)).toBe("skipped");
  });

  it("uses accepted setup trial audio paths for Mina and Nova", () => {
    expect(getDjPreviewPath("Mina")).toBe(path.join(os.homedir(), ".pockedio", "audio", "previews", "mina.wav"));
    expect(getDjPreviewPath("Nova")).toBe(path.join(os.homedir(), ".pockedio", "audio", "previews", "nova.wav"));
  });

  it("lets first setup hear multiple DJ trials before choosing", () => {
    expect(getDjTrialMenuChoices()).toEqual([
      { name: "Mina", value: "Mina" },
      { name: "Nova", value: "Nova" },
      { name: "Choose your DJ", value: "choose" }
    ]);
  });

  it("labels NetEase setup options for first setup", () => {
    expect(getNetEaseSetupMethodChoices()).toEqual([
      { name: "Yes, scan QR", value: "qr" },
      { name: "Yes, paste MUSIC_U cookie", value: "cookie" },
      { name: "Not now, use anonymous playback", value: "anonymous" }
    ]);
    expect(getNetEaseQualityMenuChoices()).toEqual([
      { name: "hires - best quality, may be unavailable", value: "hires" },
      { name: "lossless - very high quality, needs support", value: "lossless" },
      { name: "exhigh - best daily default", value: "exhigh" },
      { name: "higher - good fallback", value: "higher" },
      { name: "standard - safest fallback", value: "standard" }
    ]);
  });

  it("renders NetEase and Scheduled DJ setup menus with the shared colored TUI language", () => {
    const neteaseTitle = formatSetupMenuTitle([
      "NETEASE PLAYBACK",
      "",
      "● Connecting your account can reduce unavailable tracks and preview-only playback.",
      "",
      "ACTIONS"
    ].join("\n"), { color: true, width: 88 });
    const scheduleTitle = formatSetupMenuTitle([
      "SCHEDULED DJ SETUP",
      "",
      "● Weekday DJ programs can be prepared before the time you choose, then wait for confirmation.",
      "",
      "CURRENT",
      "Morning          weekdays 08:45",
      "Evening          disabled",
      "",
      "ACTIONS"
    ].join("\n"), { color: true, width: 88 });
    const selected = formatSetupMenuEntry(true, 1, "Configure Morning DJ", { color: true, width: 88 });

    expect(neteaseTitle).toMatch(/\u001b\[[0-9;]*38;5;116mACTIONS\u001b\[0m/);
    expect(scheduleTitle).toMatch(/\u001b\[[0-9;]*38;5;116mCURRENT\u001b\[0m/);
    expect(stripAnsi(scheduleTitle)).toContain("Morning         weekdays 08:45");
    expect(selected).toMatch(/\u001b\[[0-9;]*48;5;23m/);
    expect(stripAnsi(selected)).toContain("▌ > 1. Configure Morning DJ");
  });

  it("creates a visible NetEase QR image before polling", async () => {
    const env = makeEnv();
    const config = loadConfig(env);
    ensureRuntimeDirs(config, env);
    const pngBase64 = Buffer.from("fake-png").toString("base64");
    const fetchImpl: typeof fetch = async (url) => {
      const pathname = new URL(String(url)).pathname;
      if (pathname === "/login/qr/key") {
        return new Response(JSON.stringify({ data: { unikey: "qr-key" } }), { status: 200 });
      }
      if (pathname === "/login/qr/create") {
        return new Response(JSON.stringify({ data: { qrimg: `data:image/png;base64,${pngBase64}` } }), { status: 200 });
      }
      throw new Error(`unexpected URL ${String(url)}`);
    };

    const result = await __netEaseQrLoginForTests.start(config, fetchImpl);

    expect(result).toMatchObject({
      ok: true,
      key: "qr-key",
      qrPath: path.join(env.POCKEDIO_HOME!, "secrets", "netease-login-qr.png")
    });
    if (result.ok && result.qrPath) {
      expect(fs.readFileSync(result.qrPath, "utf8")).toBe("fake-png");
      expect(__netEaseQrLoginForTests.formatInstructions(result)).toContain(
        `Link: file://${result.qrPath}`
      );
      expect(__netEaseQrLoginForTests.formatInstructions(result)).toContain(
        `File: ${result.qrPath}`
      );
    }
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

  it("formats setup taste import failures without stopping setup", () => {
    expect(formatSetupTasteImportFailure(new Error("NetEase playlist import failed with HTTP 404."))).toEqual([
      "Could not import this NetEase playlist.",
      "  Reason            NetEase playlist import failed with HTTP 404.",
      "Setup will continue without playlist taste import."
    ].join("\n"));
  });

  it("formats final setup taste status from import result", () => {
    expect(formatSetupTasteStatus({ importTasteNow: false })).toBe("skipped");
    expect(formatSetupTasteStatus({ importTasteNow: true, tasteImportStatus: "imported" })).toBe("imported");
    expect(formatSetupTasteStatus({ importTasteNow: true, tasteImportStatus: "failed" })).toBe("failed");
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
      summary: "Weather in Guangzhou, China: 28C, humidity 95%, precipitation 0, wind 8 km/h.",
      listeningHint: "Weather listening hint for Guangzhou, China: high humidity suggests slower, airier, less heavy selections."
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
      listeningHint: "Calendar listening hint unavailable.",
      warning: "Not authorized to send Apple events to Calendar."
    })).toBe([
      "Calendar unavailable.",
      "Not authorized to send Apple events to Calendar. Enable Calendar access for your terminal in System Settings > Privacy & Security > Automation or Calendars, then run setup again.",
      "You can skip it now and set it later."
    ].join("\n"));
  });

  it("formats diary setup checks", () => {
    const diaryFile = path.join(os.homedir(), "Diary", "2026-05-18.md");
    const diaryDir = path.dirname(diaryFile);
    expect(formatDiarySetupSummary({
      filePath: diaryFile,
      summary: "Latest diary file: 2026-05-18.md, modified 2026-05-18T10:00:00.000Z.",
      listeningHint: "Diary listening hint unavailable; do not overfit music to diary context."
    })).toBe([
      "Diary ready",
      `  Path              ${diaryDir}`,
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
