import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import inquirer from "inquirer";
import { runMigrations } from "../db/migrations.js";
import { MemoryStore } from "../memory/store.js";
import { ensurePersonaFile } from "../personas/personaStore.js";
import { playFile as playAudioFile } from "../player/afplay.js";
import { normalizeCalendarWarning, readCalendarContext, requestCalendarPermission, type CalendarContext } from "../context/calendar.js";
import { readDiaryContext, type DiaryContext } from "../context/diary.js";
import { readWeatherContext, type WeatherContext } from "../context/weather.js";
import type { TasteImportResult } from "../taste/importTaste.js";
import { importTasteFromNetEasePlaylist } from "../taste/neteasePlaylist.js";
import { ensureRuntimeDirs, loadConfig, saveConfig } from "./load.js";
import {
  djProgramLengths,
  djStyles,
  mbtiTypes,
  pockedioConfigSchema,
  type DjProgramLength,
  type DjStyle,
  type MbtiType,
  type PockedioConfig
} from "./schema.js";

const djChoices = ["Mina", "Nova"] as const;
type DjChoice = typeof djChoices[number];
type DjTrialMenuValue = DjChoice | "choose";
const scheduledDjSetupChoices = ["not_now", "morning", "evening", "both"] as const;
type ScheduledDjSetupChoice = typeof scheduledDjSetupChoices[number];

type SetupAnswers = {
  neteaseBaseUrl: string;
  weatherLocation: string;
  calendarEnabled: boolean;
  diaryEnabled: boolean;
  diaryPath?: string;
  mbti?: MbtiType | "Unset";
  llmModel: string;
  llmBaseUrl?: string;
  llmApiKeyEnv: string;
  fishAudioPythonPath: string;
  fishAudioScriptPath: string;
  fishAudioModelDir: string;
  djLanguage: string;
  djDisplayName: string;
  djProgramLength: DjProgramLength;
  djStyle: DjStyle;
  djPersonaPreference: string;
  morningDjEnabled: boolean;
  morningDjPlayTime: string;
  morningDjPrepareMinutesBefore: number;
  eveningDjEnabled: boolean;
  eveningDjPlayTime: string;
  eveningDjPrepareMinutesBefore: number;
};

export type FirstSetupAnswers = {
  listenToDjTrial: boolean;
  previewDj?: DjChoice;
  djChoice: DjChoice;
  importTasteNow: boolean;
  tastePlaylistInput?: string;
  useWeather: boolean;
  weatherLocation?: string;
  useCalendar: boolean;
  useDiary: boolean;
  diaryPath?: string;
  scheduledDjPrograms?: ScheduledDjSetupChoice;
  morningDjReadyTime?: string;
  eveningDjReadyTime?: string;
};

export async function runSetup(): Promise<void> {
  const current = loadConfig();
  const answers = await promptForSetup(current);
  const config = buildConfigFromFirstSetupAnswers(current, answers);
  ensureRuntimeDirs(config);
  saveConfig(config);
  runMigrations(config);
  ensurePersonaFile(config);

  let calendarStatus = answers.useCalendar ? "enabled" : "skipped";
  if (answers.useCalendar) {
    console.log("");
    console.log("If macOS asks for Calendar permission, choose Allow.");
    const calendar = await withSetupStatus("Checking calendar...", () => setupCalendarContext(config));
    calendarStatus = calendar.available ? "enabled" : "unavailable";
    console.log("");
    console.log(formatCalendarSetupSummary(calendar));
  }

  let diaryStatus = answers.useDiary ? "enabled" : "skipped";
  if (answers.useDiary) {
    console.log("");
    const diary = await withSetupStatus("Checking diary...", () => setupDiaryContext(config));
    diaryStatus = diary ? "enabled" : "unavailable";
    console.log("");
    console.log(formatDiarySetupSummary(diary));
  }

  if (answers.importTasteNow && answers.tastePlaylistInput?.trim()) {
    console.log("");
    console.log("Reading NetEase playlist...");
    const result = await importTasteFromNetEasePlaylist(answers.tastePlaylistInput.trim(), config);
    console.log("");
    console.log(formatSetupTasteImportSummary(result));
  }

  console.log("");
  console.log("Setup complete");
  console.log(`  DJ                ${config.dj.displayName}`);
  console.log(`  Taste             ${answers.importTasteNow ? "imported" : "skipped"}`);
  console.log(`  Calendar          ${calendarStatus}`);
  console.log(`  Diary             ${diaryStatus}`);
  console.log(`  Scheduled DJ      ${formatScheduledDjSetupSummary(config)}`);
  console.log("");
  console.log("Next");
  console.log("  pockedio");
}

export async function runCalendarSetup(): Promise<void> {
  const current = loadConfig();
  console.log("Calendar");
  console.log("");
  console.log("Privacy");
  console.log("  Calendar context stays local.");
  console.log("  Pockedio stores event title and time only.");
  console.log("");

  const answers = await inquirer.prompt<{ calendarEnabled: boolean }>([
    {
      type: "confirm",
      name: "calendarEnabled",
      message: "Enable Apple Calendar context?",
      default: current.calendar.enabled
    }
  ]);

  const config = pockedioConfigSchema.parse({
    ...current,
    calendar: { enabled: answers.calendarEnabled }
  });
  ensureRuntimeDirs(config);
  saveConfig(config);
  runMigrations(config);

  if (!answers.calendarEnabled) {
    console.log("");
    console.log("Saved");
    console.log("  Calendar          disabled");
    return;
  }

  console.log("");
  console.log("If macOS asks for Calendar permission, choose Allow.");
  const calendar = await withSetupStatus("Checking calendar...", () => setupCalendarContext(config));

  console.log("");
  console.log(formatCalendarSetupSummary(calendar));
}

export async function promptForSetup(current: PockedioConfig): Promise<FirstSetupAnswers> {
  console.log("Pockedio first setup");
  console.log("");

  const trialAnswer = await inquirer.prompt<Pick<FirstSetupAnswers, "listenToDjTrial">>([
    {
      type: "confirm",
      name: "listenToDjTrial",
      message: "Hear DJs you can choose?",
      default: true
    }
  ]);

  let previewAnswer: Pick<FirstSetupAnswers, "previewDj"> = {};
  if (trialAnswer.listenToDjTrial) {
    let keepListening = true;
    while (keepListening) {
      const trialMenu = await inquirer.prompt<{ trialAction: DjTrialMenuValue }>([
        {
          type: "list",
          name: "trialAction",
          message: "Hear DJ",
          choices: getDjTrialMenuChoices(),
          default: previewAnswer.previewDj ?? inferCurrentDjChoice(current)
        }
      ]);

      if (trialMenu.trialAction === "choose") {
        keepListening = false;
      } else {
        previewAnswer = { previewDj: trialMenu.trialAction };
        await playDjPreview(trialMenu.trialAction);
      }
    }
  }

  const djAnswers = await inquirer.prompt<Pick<FirstSetupAnswers, "djChoice">>([
    {
      type: "list",
      name: "djChoice",
      message: "Choose your DJ",
      choices: [
        { name: "Mina - warm, calm, young personal radio", value: "Mina" },
        { name: "Nova - calm male broadcast voice", value: "Nova" }
      ],
      default: previewAnswer.previewDj ?? inferCurrentDjChoice(current)
    }
  ]);

  const tasteAnswers = await inquirer.prompt<Pick<FirstSetupAnswers, "importTasteNow" | "tastePlaylistInput">>([
    {
      type: "confirm",
      name: "importTasteNow",
      message: "Import taste from a NetEase playlist?",
      default: false
    },
    {
      type: "input",
      name: "tastePlaylistInput",
      message: "Paste NetEase playlist link",
      when: (answers) => answers.importTasteNow
    }
  ]);

  const weatherGate = await inquirer.prompt<Pick<FirstSetupAnswers, "useWeather">>([
    {
      type: "confirm",
      name: "useWeather",
      message: "Use local weather for better DJ context?",
      default: true
    }
  ]);

  let weatherAnswers: Pick<FirstSetupAnswers, "weatherLocation"> = {};
  if (weatherGate.useWeather) {
    weatherAnswers = await inquirer.prompt<Pick<FirstSetupAnswers, "weatherLocation">>([
      {
        type: "input",
        name: "weatherLocation",
        message: "Weather city",
        default: current.weather.location
      }
    ]);

    console.log("");
    console.log("Checking weather...");
    const weather = await readWeatherContext(weatherAnswers.weatherLocation ?? current.weather.location);
    console.log("");
    console.log(formatWeatherSetupSummary(weather));
  }

  console.log("");
  console.log("Other context");
  console.log("Calendar context stays local and stores event title and time only.");
  const calendarGate = await inquirer.prompt<Pick<FirstSetupAnswers, "useCalendar">>([
    {
      type: "confirm",
      name: "useCalendar",
      message: "Enable Apple Calendar context?",
      default: false
    }
  ]);

  console.log("");
  console.log("Diary summaries are stored locally. If your LLM is remote, summary generation may send a diary excerpt.");
  const diaryGate = await inquirer.prompt<Pick<FirstSetupAnswers, "useDiary" | "diaryPath">>([
    {
      type: "confirm",
      name: "useDiary",
      message: "Enable diary context?",
      default: false
    },
    {
      type: "input",
      name: "diaryPath",
      message: "Diary path",
      default: current.diary.path,
      when: (answers) => answers.useDiary
    }
  ]);

  console.log("");
  console.log("Scheduled DJ programs");
  console.log("Pockedio can prepare weekday spoken DJ programs before the time you choose.");
  const scheduleGate = await inquirer.prompt<Pick<FirstSetupAnswers, "scheduledDjPrograms">>([
    {
      type: "list",
      name: "scheduledDjPrograms",
      message: "Scheduled DJ programs?",
      choices: [
        { name: "Not now", value: "not_now" },
        { name: "Morning only", value: "morning" },
        { name: "Evening only", value: "evening" },
        { name: "Morning and Evening", value: "both" }
      ],
      default: "not_now"
    }
  ]);

  const scheduleAnswers = await inquirer.prompt<Pick<FirstSetupAnswers, "morningDjReadyTime" | "eveningDjReadyTime">>([
    {
      type: "input",
      name: "morningDjReadyTime",
      message: "Morning DJ ready time (HH:mm)",
      default: current.dj.schedule.morning.playTime,
      validate: validateTimeOfDay,
      when: () => scheduleGate.scheduledDjPrograms === "morning" || scheduleGate.scheduledDjPrograms === "both"
    },
    {
      type: "input",
      name: "eveningDjReadyTime",
      message: "Evening DJ ready time (HH:mm)",
      default: current.dj.schedule.evening.playTime,
      validate: validateTimeOfDay,
      when: () => scheduleGate.scheduledDjPrograms === "evening" || scheduleGate.scheduledDjPrograms === "both"
    }
  ]);

  return {
    ...trialAnswer,
    ...previewAnswer,
    ...djAnswers,
    ...tasteAnswers,
    ...weatherGate,
    ...weatherAnswers,
    ...calendarGate,
    ...diaryGate,
    ...scheduleGate,
    ...scheduleAnswers
  };
}

export async function promptForAdvancedSetup(current: PockedioConfig): Promise<SetupAnswers> {
  return inquirer.prompt<SetupAnswers>([
    {
      type: "input",
      name: "neteaseBaseUrl",
      message: "Music provider - NetEase API base URL",
      default: current.netease.baseUrl
    },
    {
      type: "input",
      name: "weatherLocation",
      message: "Context permissions - weather city",
      default: current.weather.location
    },
    {
      type: "confirm",
      name: "calendarEnabled",
      message: "Context permissions - enable Apple Calendar context",
      default: current.calendar.enabled
    },
    {
      type: "confirm",
      name: "diaryEnabled",
      message: "Context permissions - enable diary context",
      default: current.diary.enabled
    },
    {
      type: "input",
      name: "diaryPath",
      message: "Context permissions - diary path",
      default: current.diary.path,
      when: (answers) => answers.diaryEnabled
    },
    {
      type: "list",
      name: "mbti",
      message: "Personal profile - self-declared MBTI type",
      choices: ["Unset", ...mbtiTypes],
      default: current.personality.mbti ?? "Unset"
    },
    {
      type: "input",
      name: "llmModel",
      message: "LLM - OpenAI-compatible model",
      default: current.llm.model
    },
    {
      type: "input",
      name: "llmBaseUrl",
      message: "LLM - OpenAI-compatible base URL (blank for OpenAI default)",
      default: current.llm.baseUrl ?? ""
    },
    {
      type: "input",
      name: "llmApiKeyEnv",
      message: "LLM - API key environment variable",
      default: current.llm.apiKeyEnv
    },
    {
      type: "input",
      name: "fishAudioPythonPath",
      message: "Voice - FishAudio Python path",
      default: current.fishAudio.pythonPath
    },
    {
      type: "input",
      name: "fishAudioScriptPath",
      message: "Voice - FishAudio script path",
      default: current.fishAudio.scriptPath
    },
    {
      type: "input",
      name: "fishAudioModelDir",
      message: "Voice - FishAudio model directory",
      default: current.fishAudio.modelDir
    },
    {
      type: "input",
      name: "djLanguage",
      message: "DJ preference - spoken and terminal language",
      default: current.dj.language
    },
    {
      type: "input",
      name: "djDisplayName",
      message: "DJ preference - display name",
      default: current.dj.displayName
    },
    {
      type: "list",
      name: "djProgramLength",
      message: "DJ preference - program length",
      choices: [...djProgramLengths],
      default: current.dj.programLength
    },
    {
      type: "list",
      name: "djStyle",
      message: "DJ preference - style",
      choices: [...djStyles],
      default: current.dj.style
    },
    {
      type: "input",
      name: "djPersonaPreference",
      message: "DJ preference - persona preference",
      default: current.dj.personaPreference
    },
    {
      type: "confirm",
      name: "morningDjEnabled",
      message: "Scheduled DJ - enable Morning DJ",
      default: current.dj.schedule.morning.enabled
    },
    {
      type: "input",
      name: "morningDjPlayTime",
      message: "Scheduled DJ - Morning DJ play time (HH:mm)",
      default: current.dj.schedule.morning.playTime
    },
    {
      type: "number",
      name: "morningDjPrepareMinutesBefore",
      message: "Scheduled DJ - Morning DJ preparation minutes before play time",
      default: current.dj.schedule.morning.prepareMinutesBefore
    },
    {
      type: "confirm",
      name: "eveningDjEnabled",
      message: "Scheduled DJ - enable Evening DJ",
      default: current.dj.schedule.evening.enabled
    },
    {
      type: "input",
      name: "eveningDjPlayTime",
      message: "Scheduled DJ - Evening DJ play time (HH:mm)",
      default: current.dj.schedule.evening.playTime
    },
    {
      type: "number",
      name: "eveningDjPrepareMinutesBefore",
      message: "Scheduled DJ - Evening DJ preparation minutes before play time",
      default: current.dj.schedule.evening.prepareMinutesBefore
    }
  ]);
}

export function buildConfigFromFirstSetupAnswers(current: PockedioConfig, answers: FirstSetupAnswers): PockedioConfig {
  const djProfile = getDjProfile(answers.djChoice);
  const scheduledChoice = answers.scheduledDjPrograms ?? inferCurrentScheduledDjChoice(current);
  return pockedioConfigSchema.parse({
    ...current,
    weather: {
      location: answers.useWeather
        ? answers.weatherLocation || current.weather.location
        : current.weather.location
    },
    calendar: {
      enabled: answers.useCalendar
    },
    diary: {
      enabled: answers.useDiary,
      path: answers.useDiary ? answers.diaryPath : undefined
    },
    dj: {
      ...current.dj,
      displayName: answers.djChoice,
      style: djProfile.style,
      personaPreference: djProfile.personaPreference,
      schedule: {
        morning: {
          ...current.dj.schedule.morning,
          enabled: scheduledChoice === "morning" || scheduledChoice === "both",
          playTime: answers.morningDjReadyTime || current.dj.schedule.morning.playTime
        },
        evening: {
          ...current.dj.schedule.evening,
          enabled: scheduledChoice === "evening" || scheduledChoice === "both",
          playTime: answers.eveningDjReadyTime || current.dj.schedule.evening.playTime
        }
      }
    }
  });
}

export function buildConfigFromAnswers(current: PockedioConfig, answers: SetupAnswers): PockedioConfig {
  return pockedioConfigSchema.parse({
    ...current,
    netease: {
      baseUrl: answers.neteaseBaseUrl
    },
    weather: {
      location: answers.weatherLocation
    },
    calendar: {
      enabled: answers.calendarEnabled
    },
    diary: {
      enabled: answers.diaryEnabled,
      path: answers.diaryEnabled ? answers.diaryPath : undefined
    },
    personality: {
      mbti: answers.mbti === "Unset" ? undefined : answers.mbti
    },
    llm: {
      provider: "openai",
      model: answers.llmModel,
      baseUrl: answers.llmBaseUrl?.trim() ? answers.llmBaseUrl.trim() : undefined,
      apiKeyEnv: answers.llmApiKeyEnv
    },
    fishAudio: {
      pythonPath: answers.fishAudioPythonPath,
      scriptPath: answers.fishAudioScriptPath,
      modelDir: answers.fishAudioModelDir
    },
    dj: {
      language: answers.djLanguage,
      displayName: answers.djDisplayName,
      programLength: answers.djProgramLength,
      style: answers.djStyle,
      personaPreference: answers.djPersonaPreference,
      schedule: {
        morning: {
          enabled: answers.morningDjEnabled,
          playTime: answers.morningDjPlayTime,
          prepareMinutesBefore: answers.morningDjPrepareMinutesBefore
        },
        evening: {
          enabled: answers.eveningDjEnabled,
          playTime: answers.eveningDjPlayTime,
          prepareMinutesBefore: answers.eveningDjPrepareMinutesBefore
        }
      }
    }
  });
}

export function getDjPreviewPath(choice: DjChoice): string {
  const filename = choice === "Mina" ? "mina.wav" : "nova.wav";
  return path.join(os.homedir(), ".pockedio", "audio", "previews", filename);
}

export function getDjTrialMenuChoices(): Array<{ name: string; value: DjTrialMenuValue }> {
  return [
    { name: "Mina", value: "Mina" },
    { name: "Nova", value: "Nova" },
    { name: "Choose your DJ", value: "choose" }
  ];
}

export function formatSetupTasteImportSummary(result: TasteImportResult): string {
  return [
    "Imported",
    `  Tracks            ${result.trackCount}`,
    `  Artists           ${formatDetectedCount(result.artists.length, "detected")}`,
    `  Playlists         ${formatDetectedCount(result.playlists.length, "imported")}`,
    `  taste.md          ${result.tastePath}`,
    "",
    "taste.md will grow as we talk and listen, so Pockedio can understand you better."
  ].join("\n");
}

export function formatWeatherSetupSummary(weather: WeatherContext | null): string {
  if (!weather) {
    return [
      "Weather not found.",
      "You can skip it now and set it later."
    ].join("\n");
  }

  return [
    "Weather ready",
    `  Location          ${weather.matchedLocation}`,
    `  Current           ${formatWeatherCurrentLine(weather)}`,
    "",
    "Pockedio may use weather lightly when choosing music and replying."
  ].join("\n");
}

export function formatCalendarSetupSummary(calendar: CalendarContext): string {
  if (!calendar.available) {
    return [
      "Calendar unavailable.",
      normalizeCalendarWarning(calendar.warning),
      "You can skip it now and set it later."
    ].join("\n");
  }

  return [
    "Calendar ready",
    `  Events read       ${calendar.events.length}`,
    "  Window            Last 7 days",
    "",
    "Pockedio may use this lightly when replying and planning scheduled DJ."
  ].join("\n");
}

export function formatDiarySetupSummary(diary: DiaryContext | null): string {
  if (!diary) {
    return [
      "Diary unavailable.",
      "Check the path and set it later if needed."
    ].join("\n");
  }

  return [
    "Diary ready",
    `  Path              ${path.dirname(diary.filePath)}`,
    `  Latest entry      ${path.basename(diary.filePath)}`,
    "",
    "Pockedio will use diary context lightly and locally."
  ].join("\n");
}

export function formatScheduledDjSetupSummary(config: PockedioConfig): string {
  const morning = config.dj.schedule.morning;
  const evening = config.dj.schedule.evening;
  if (!morning.enabled && !evening.enabled) {
    return "skipped";
  }

  const parts = [];
  if (morning.enabled) {
    parts.push(`Morning weekdays ${morning.playTime}`);
  }
  if (evening.enabled) {
    parts.push(`Evening weekdays ${evening.playTime}`);
  }
  return parts.join("; ");
}

async function setupCalendarContext(config: PockedioConfig): Promise<CalendarContext> {
  const permission = await requestCalendarPermission(20_000);
  if (!permission.available) {
    saveConfig(pockedioConfigSchema.parse({
      ...config,
      calendar: { enabled: false }
    }));
    return {
      available: false,
      events: [],
      summary: "Calendar context unavailable.",
      warning: permission.warning
    };
  }

  const calendar = await readCalendarContext(true, 60_000, undefined, "last7Days");
  if (calendar.available) {
    const store = new MemoryStore(config);
    try {
      const readAt = new Date().toISOString();
      store.upsertCalendarEvents(calendar.events.map((event) => ({
        calendarName: event.calendarName,
        title: event.title,
        startTime: event.startTime,
        endTime: event.endTime,
        isAllDay: event.isAllDay,
        source: "setup",
        readAt
      })));
    } finally {
      store.close();
    }
  } else {
    saveConfig(pockedioConfigSchema.parse({
      ...config,
      calendar: { enabled: false }
    }));
  }
  return calendar;
}

async function setupDiaryContext(config: PockedioConfig): Promise<DiaryContext | null> {
  const diary = readDiaryContext(config);
  if (!diary) {
    saveConfig(pockedioConfigSchema.parse({
      ...config,
      diary: { enabled: false, path: config.diary.path }
    }));
  }
  return diary;
}

async function withSetupStatus<T>(text: string, action: () => Promise<T> | T): Promise<T> {
  const done = startSetupStatus(text);
  try {
    return await action();
  } finally {
    done();
  }
}

function startSetupStatus(text: string): () => void {
  if (!process.stdout.isTTY) {
    console.log(text);
    return () => undefined;
  }

  const frames = ["|", "/", "-", "\\"];
  let index = 0;
  const render = () => {
    process.stdout.write(`\r${frames[index % frames.length]} ${text}`);
    index += 1;
  };
  render();
  const timer = setInterval(render, 80);
  return () => {
    clearInterval(timer);
    process.stdout.write(`\r${" ".repeat(text.length + 4)}\r`);
  };
}

function formatWeatherCurrentLine(weather: WeatherContext): string {
  const temperature = weather.temperatureC === null ? "unknown" : `${weather.temperatureC}C`;
  const humidity = weather.relativeHumidity === null ? "humidity unknown" : `humidity ${weather.relativeHumidity}%`;
  return `${temperature}, ${humidity}`;
}

function formatDetectedCount(count: number, label: string): string {
  return count === 0 ? "none" : `${count} ${label}`;
}

function getDjProfile(choice: DjChoice): Pick<PockedioConfig["dj"], "style" | "personaPreference"> {
  if (choice === "Mina") {
    return {
      style: "warm",
      personaPreference: "soft young personal radio DJ"
    };
  }

  return {
    style: "direct",
    personaPreference: "modern male radio DJ"
  };
}

function inferCurrentDjChoice(current: PockedioConfig): DjChoice {
  return current.dj.displayName.toLowerCase().includes("nova") ? "Nova" : "Mina";
}

function inferCurrentScheduledDjChoice(current: PockedioConfig): ScheduledDjSetupChoice {
  const morning = current.dj.schedule.morning.enabled;
  const evening = current.dj.schedule.evening.enabled;
  if (morning && evening) {
    return "both";
  }
  if (morning) {
    return "morning";
  }
  if (evening) {
    return "evening";
  }
  return "not_now";
}

function validateTimeOfDay(value: string): true | string {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
    ? true
    : "Time must use HH:mm, for example 08:45.";
}

async function playDjPreview(choice: DjChoice | undefined): Promise<void> {
  if (!choice) {
    return;
  }

  const previewPath = getDjPreviewPath(choice);
  if (!fs.existsSync(previewPath)) {
    console.log("");
    console.log("Voice preview is not ready yet.");
    console.log("You can still choose the DJ style now and configure voice later.");
    return;
  }

  console.log("");
  console.log("Preparing DJ voice preview...");
  console.log(`Playing ${choice} preview...`);
  const result = await playAudioFile(previewPath, 30_000);
  if (!result.ok) {
    console.log(`Preview playback failed: ${result.error}`);
  }
}
