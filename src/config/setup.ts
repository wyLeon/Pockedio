import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { stdin as defaultInput, stdout as defaultOutput } from "node:process";
import { createInterface, emitKeypressEvents, type Key } from "node:readline";
import { pathToFileURL } from "node:url";
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
import {
  renderTuiBulletLine,
  renderTuiFooter,
  renderTuiKeyValue,
  renderTuiPageTitle,
  renderTuiRow,
  renderTuiSectionLabel,
  type TuiRenderOptions
} from "../tui/terminalRenderer.js";
import { ensureRuntimeDirs, loadConfig, saveConfig } from "./load.js";
import { clearNetEaseCookie, saveNetEaseCookie } from "./neteaseAuth.js";
import {
  djProgramLengths,
  djStyles,
  mbtiTypes,
  musicProviders,
  neteaseQualityLevels,
  pockedioConfigSchema,
  type DjProgramLength,
  type DjStyle,
  type MbtiType,
  type MusicProviderName,
  type NetEaseQualityLevel,
  type PockedioConfig
} from "./schema.js";

const djChoices = ["Mina", "Nova"] as const;
type DjChoice = typeof djChoices[number];
type DjTrialMenuValue = DjChoice | "choose";
const scheduledDjSetupChoices = ["not_now", "morning", "evening", "both"] as const;
type ScheduledDjSetupChoice = typeof scheduledDjSetupChoices[number];
const neteaseSetupMethods = ["qr", "cookie", "anonymous"] as const;
type NetEaseSetupMethod = typeof neteaseSetupMethods[number];
type NetEaseSetupMenuValue = NetEaseSetupMethod;
type NetEaseQualityMenuValue = NetEaseQualityLevel;
export type SetupRunResult = "done" | "back" | "quit";
type ScheduledDjKind = "morning" | "evening";
type SchedulerSetupAction = ScheduledDjKind | "disable_all";
type ScheduledDjProgramAction = "enable" | "disable" | "change_time";
type SetupTasteImportStatus = "imported" | "failed" | "skipped";

type SetupAnswers = {
  neteaseBaseUrl: string;
  weatherEnabled: boolean;
  weatherLocation?: string;
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
  fishApiKeyEnv?: string;
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

const diaryPathCopyHint = [
  "Tip",
  "  Open your journal root directory in Finder.",
  "  Press Option + Command + C to copy its path.",
  "  Paste that path here when asked for the diary path."
].join("\n");
const textInputEscapeHint = "Esc to back";

export type FirstSetupAnswers = {
  musicProvider?: MusicProviderName;
  neteaseSetupMethod?: NetEaseSetupMethod;
  neteaseCookie?: string;
  neteaseQualityLevel?: NetEaseQualityLevel;
  neteaseSetupApplied?: boolean;
  listenToDjTrial: boolean;
  previewDj?: DjChoice;
  djChoice: DjChoice;
  importTasteNow: boolean;
  tastePlaylistInput?: string;
  tasteImportStatus?: SetupTasteImportStatus;
  useWeather: boolean;
  weatherLocation?: string;
  useCalendar: boolean;
  calendarSetupApplied?: boolean;
  calendarSetupAvailable?: boolean;
  useDiary: boolean;
  diarySetupApplied?: boolean;
  diarySetupAvailable?: boolean;
  diaryPath?: string;
  scheduledDjPrograms?: ScheduledDjSetupChoice;
  morningDjReadyTime?: string;
  eveningDjReadyTime?: string;
};

export async function runSetup(): Promise<void> {
  const current = loadConfig();
  const answers = await promptForSetup(current);
  let config = buildConfigFromFirstSetupAnswers(current, answers);
  ensureRuntimeDirs(config);
  saveConfig(config);
  if (!answers.neteaseSetupApplied) {
    config = await applyNetEaseSetupChoice(config, answers);
  }
  runMigrations(config);
  ensurePersonaFile(config);

  if (answers.importTasteNow && answers.tastePlaylistInput?.trim() && !answers.tasteImportStatus) {
    answers.tasteImportStatus = await importNetEasePlaylistTasteDuringSetup(answers.tastePlaylistInput.trim(), config);
  }

  let calendarStatus = answers.useCalendar
    ? answers.calendarSetupApplied
      ? answers.calendarSetupAvailable ? "enabled" : "unavailable"
      : "enabled"
    : "skipped";
  if (answers.useCalendar && !answers.calendarSetupApplied) {
    console.log("");
    console.log("If macOS asks for Calendar permission, choose Allow.");
    const calendar = await withSetupStatus("Checking calendar...", () => setupCalendarContext(config));
    calendarStatus = calendar.available ? "enabled" : "unavailable";
    console.log("");
    console.log(formatCalendarSetupSummary(calendar));
  }

  let diaryStatus = answers.useDiary
    ? answers.diarySetupApplied
      ? answers.diarySetupAvailable ? "enabled" : "unavailable"
      : "enabled"
    : "skipped";
  if (answers.useDiary && !answers.diarySetupApplied) {
    console.log("");
    const diary = await withSetupStatus("Checking diary...", () => setupDiaryContext(config));
    diaryStatus = diary ? "enabled" : "unavailable";
    console.log("");
    console.log(formatDiarySetupSummary(diary));
  }

  console.log("");
  console.log("Setup complete");
  console.log(`  Music            ${formatNetEaseSetupSummary(config)}`);
  console.log(`  DJ                ${config.dj.displayName}`);
  console.log(`  Taste             ${formatSetupTasteStatus(answers)}`);
  console.log(`  Calendar          ${calendarStatus}`);
  console.log(`  Diary             ${diaryStatus}`);
  console.log(`  Scheduled DJ      ${formatScheduledDjSetupSummary(config)}`);
  console.log("");
  console.log("Next");
  console.log("  pockedio");
}

export async function runNetEaseSetup(): Promise<SetupRunResult> {
  const current = loadConfig();

  const answers = await promptForStandaloneNetEaseSetup(current);
  if (answers === "back" || answers === "quit") {
    return answers;
  }
  let config = buildConfigFromNetEaseSetupAnswers(current, answers);
  ensureRuntimeDirs(config);
  saveConfig(config);
  config = await applyNetEaseSetupChoice(config, answers);

  console.log("");
  console.log("Saved");
  console.log(`  Music            ${formatNetEaseSetupSummary(config)}`);
  return "done";
}

export async function runCalendarSetup(): Promise<SetupRunResult> {
  const current = loadConfig();
  const calendarAction = await promptSetupMenu<"enable" | "disable">({
    title: [
      "CALENDAR SETUP",
      "",
      "● Calendar context stays local. Pockedio stores event title and time only.",
      "",
      "ACTIONS"
    ].join("\n"),
    entries: [
      { name: "Enable Apple Calendar context", value: "enable" },
      { name: "Disable Apple Calendar context", value: "disable" }
    ],
    defaultValue: current.calendar.enabled ? "enable" : "disable"
  });
  if (calendarAction === "back" || calendarAction === "quit") {
    return calendarAction;
  }

  if (calendarAction === "disable") {
    const config = pockedioConfigSchema.parse({
      ...current,
      calendar: { enabled: false }
    });
    ensureRuntimeDirs(config);
    saveConfig(config);
    runMigrations(config);
    console.log("");
    console.log("Saved");
    console.log("  Calendar          disabled");
    return "done";
  }

  console.log("");
  console.log("If macOS asks for Calendar permission, choose Allow.");
  const config = pockedioConfigSchema.parse({
    ...current,
    calendar: { enabled: true }
  });
  ensureRuntimeDirs(config);
  runMigrations(config);
  const calendar = await withSetupStatus("Checking Calendar permission and reading recent events...", () => setupCalendarContext(config));

  console.log("");
  console.log(formatCalendarSetupSummary(calendar));
  return "done";
}

export async function runWeatherSetup(): Promise<SetupRunResult> {
  const current = loadConfig();
  const weatherAction = await promptSetupMenu<"enable" | "disable" | "change_location" | "test">({
    title: [
      "WEATHER SETUP",
      "",
      "● Weather context is optional and used lightly for station tone.",
      "",
      "CURRENT",
      `Location         ${current.weather.location}`,
      `Status           ${current.weather.enabled ? "Enabled" : "Not enabled"}`,
      "",
      "ACTIONS"
    ].join("\n"),
    entries: [
      { name: "Enable weather context", value: "enable" },
      { name: "Disable weather context", value: "disable" },
      { name: "Change weather city", value: "change_location" },
      { name: "Test weather lookup", value: "test" }
    ],
    defaultValue: current.weather.enabled ? "test" : "enable"
  });
  if (weatherAction === "back" || weatherAction === "quit") {
    return weatherAction;
  }

  if (weatherAction === "disable") {
    const config = pockedioConfigSchema.parse({
      ...current,
      weather: { ...current.weather, enabled: false }
    });
    ensureRuntimeDirs(config);
    saveConfig(config);
    console.log("");
    console.log("Saved");
    console.log("  Weather           disabled");
    return "done";
  }

  let location = current.weather.location;
  if (weatherAction === "change_location" || weatherAction === "enable") {
    const weatherLocation = await promptSetupTextInput({
      message: "Weather city",
      defaultValue: current.weather.location,
      validate: (value) => value.trim().length > 0 || "Enter a city or location."
    });
    if (weatherLocation === "back") {
      return "back";
    }
    location = weatherLocation.trim();
  }

  const config = pockedioConfigSchema.parse({
    ...current,
    weather: {
      enabled: weatherAction === "test" ? current.weather.enabled : true,
      location
    }
  });
  ensureRuntimeDirs(config);
  saveConfig(config);

  console.log("");
  const weather = await withSetupStatus("Checking weather...", () => readWeatherContext(location));
  console.log("");
  console.log(formatWeatherSetupSummary(weather));
  return "done";
}

export async function runDiarySetup(): Promise<SetupRunResult> {
  const current = loadConfig();
  const diaryAction = await promptSetupMenu<"enable" | "disable" | "change_path" | "test">({
    title: [
      "DIARY SETUP",
      "",
      "● Diary access is explicit and local-first. Remote LLMs may receive excerpts for summaries.",
      "",
      diaryPathCopyHint,
      "",
      "CURRENT",
      `Path             ${formatDiaryPathForSetup(current.diary.path)}`,
      `Status           ${current.diary.enabled ? "Enabled" : "Not enabled"}`,
      "",
      "ACTIONS"
    ].join("\n"),
    entries: [
      { name: "Enable diary context", value: "enable" },
      { name: "Disable diary context", value: "disable" },
      { name: "Change diary path", value: "change_path" },
      { name: "Test diary lookup", value: "test" }
    ],
    defaultValue: current.diary.enabled ? "test" : "enable"
  });
  if (diaryAction === "back" || diaryAction === "quit") {
    return diaryAction;
  }

  if (diaryAction === "disable") {
    const config = pockedioConfigSchema.parse({
      ...current,
      diary: { ...current.diary, enabled: false }
    });
    ensureRuntimeDirs(config);
    saveConfig(config);
    console.log("");
    console.log("Saved");
    console.log("  Diary             disabled");
    return "done";
  }

  let diaryPath = current.diary.path;
  if (diaryAction === "change_path" || diaryAction === "enable") {
    console.log("");
    console.log(diaryPathCopyHint);
    const inputDiaryPath = await promptSetupTextInput({
      message: "Diary path",
      validate: (value) => value.trim().length > 0 || "Enter a diary folder path."
    });
    if (inputDiaryPath === "back") {
      return "back";
    }
    diaryPath = inputDiaryPath.trim();
  }

  const config = pockedioConfigSchema.parse({
    ...current,
    diary: {
      enabled: diaryAction === "test" ? current.diary.enabled : true,
      path: diaryPath
    }
  });
  ensureRuntimeDirs(config);
  saveConfig(config);

  console.log("");
  const diary = await withSetupStatus("Checking diary...", () => setupDiaryContext(config));
  console.log("");
  console.log(formatDiarySetupSummary(diary));
  return "done";
}

export async function runSchedulerSetup(): Promise<SetupRunResult> {
  const current = loadConfig();
  const schedulerAction = await promptSetupMenu<SchedulerSetupAction>({
    title: [
      "SCHEDULED DJ SETUP",
      "",
      "● Weekday DJ programs can be prepared before the time you choose, then wait for confirmation.",
      "",
      "CURRENT",
      `Morning          ${formatScheduledDjProgramSummary("morning", current)}`,
      `Evening          ${formatScheduledDjProgramSummary("evening", current)}`,
      "",
      "ACTIONS"
    ].join("\n"),
    entries: [
      { name: "Configure Morning DJ", value: "morning" },
      { name: "Configure Evening DJ", value: "evening" },
      { name: "Disable scheduled DJ", value: "disable_all" }
    ],
    defaultValue: current.dj.schedule.morning.enabled ? "morning" : current.dj.schedule.evening.enabled ? "evening" : "morning"
  });
  if (schedulerAction === "back" || schedulerAction === "quit") {
    return schedulerAction;
  }

  if (schedulerAction === "disable_all") {
    const config = buildConfigFromSchedulerSetupAction(current, "disable_all");
    ensureRuntimeDirs(config);
    saveConfig(config);
    console.log("");
    console.log("Saved");
    console.log(`  Scheduled DJ      ${formatScheduledDjSetupSummary(config)}`);
    return "done";
  }

  const programAction = await promptSetupMenu<ScheduledDjProgramAction>({
    title: [
      `${formatScheduledDjKind(schedulerAction).toUpperCase()} DJ`,
      "",
      "CURRENT",
      `Program          ${formatScheduledDjProgramSummary(schedulerAction, current)}`,
      "",
      "ACTIONS"
    ].join("\n"),
    entries: [
      { name: `Enable ${formatScheduledDjKind(schedulerAction)} DJ`, value: "enable" },
      { name: `Disable ${formatScheduledDjKind(schedulerAction)} DJ`, value: "disable" },
      { name: `Change ${formatScheduledDjKind(schedulerAction)} ready time`, value: "change_time" }
    ],
    defaultValue: current.dj.schedule[schedulerAction].enabled ? "change_time" : "enable"
  });
  if (programAction === "back" || programAction === "quit") {
    return programAction;
  }

  let playTime: string | undefined;
  if (programAction === "change_time" || programAction === "enable") {
    const inputPlayTime = await promptSetupTextInput({
      message: `${formatScheduledDjKind(schedulerAction)} DJ ready time (HH:mm)`,
      defaultValue: current.dj.schedule[schedulerAction].playTime,
      validate: validateTimeOfDay
    });
    if (inputPlayTime === "back") {
      return "back";
    }
    playTime = inputPlayTime.trim();
  }

  const config = buildConfigFromSchedulerSetupAction(current, schedulerAction, {
    action: programAction,
    playTime
  });
  ensureRuntimeDirs(config);
  saveConfig(config);
  console.log("");
  console.log("Saved");
  console.log(`  Scheduled DJ      ${formatScheduledDjSetupSummary(config)}`);
  return "done";
}

export async function promptForSetup(current: PockedioConfig): Promise<FirstSetupAnswers> {
  console.log("Pockedio first setup");
  console.log("");

  console.log("Music provider");
  const musicProviderAnswer = await promptForMusicProvider(current);
  const neteaseAnswers = musicProviderAnswer.musicProvider === "netease"
    ? await promptForNetEaseSetup(current)
    : { neteaseSetupMethod: "anonymous" as const };
  const neteaseSetupResult = await applyFirstSetupNetEaseChoice(current, {
    ...musicProviderAnswer,
    ...neteaseAnswers
  });
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
  const tasteImportStatus = tasteAnswers.importTasteNow && tasteAnswers.tastePlaylistInput?.trim()
    ? await importNetEasePlaylistTasteDuringSetup(
        tasteAnswers.tastePlaylistInput.trim(),
        buildConfigForImmediateTasteImport(current, {
          ...musicProviderAnswer,
          ...neteaseAnswers,
          ...neteaseSetupResult,
          ...trialAnswer,
          ...previewAnswer,
          ...djAnswers,
          ...tasteAnswers
        })
      )
    : "skipped";

  console.log("");
  console.log("Context");
  const weatherGate = await inquirer.prompt<Pick<FirstSetupAnswers, "useWeather">>([
    {
      type: "confirm",
      name: "useWeather",
      message: "Use local weather for better DJ context?",
      default: current.weather.enabled
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
  const calendarSetupResult = await applyFirstSetupCalendarChoice(current, calendarGate);

  console.log("");
  console.log("Diary summaries are stored locally. If your LLM is remote, summary generation may send a diary excerpt.");
  console.log(diaryPathCopyHint);
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
      validate: (value) => value.trim().length > 0 || "Paste your diary root directory path.",
      when: (answers) => answers.useDiary
    }
  ]);
  const diarySetupResult = await applyFirstSetupDiaryChoice(current, {
    ...diaryGate
  });

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
    ...musicProviderAnswer,
    ...neteaseAnswers,
    ...neteaseSetupResult,
    ...trialAnswer,
    ...previewAnswer,
    ...djAnswers,
    ...tasteAnswers,
    tasteImportStatus,
    ...weatherGate,
    ...weatherAnswers,
    ...calendarGate,
    ...calendarSetupResult,
    ...diaryGate,
    ...diarySetupResult,
    ...scheduleGate,
    ...scheduleAnswers
  };
}

function buildConfigForImmediateTasteImport(
  current: PockedioConfig,
  answers: Partial<FirstSetupAnswers> & Pick<FirstSetupAnswers, "listenToDjTrial" | "djChoice" | "importTasteNow">
): PockedioConfig {
  return buildConfigFromFirstSetupAnswers(current, {
    ...answers,
    useWeather: current.weather.enabled,
    weatherLocation: current.weather.location,
    useCalendar: current.calendar.enabled,
    useDiary: current.diary.enabled,
    diaryPath: current.diary.path,
    scheduledDjPrograms: inferCurrentScheduledDjChoice(current)
  });
}

async function applyFirstSetupNetEaseChoice(
  current: PockedioConfig,
  answers: Pick<FirstSetupAnswers, "musicProvider" | "neteaseSetupMethod" | "neteaseCookie" | "neteaseQualityLevel">
): Promise<Pick<FirstSetupAnswers, "neteaseSetupApplied" | "neteaseSetupMethod" | "neteaseQualityLevel">> {
  if (answers.musicProvider !== "netease") {
    return {};
  }

  const config = buildConfigFromNetEaseSetupAnswers(current, answers);
  ensureRuntimeDirs(config);
  saveConfig(config);
  const appliedConfig = await applyNetEaseSetupChoice(config, answers);
  return {
    neteaseSetupApplied: true,
    neteaseSetupMethod: appliedConfig.netease.authMode === "account" ? answers.neteaseSetupMethod : "anonymous",
    neteaseQualityLevel: appliedConfig.netease.qualityLevel
  };
}

async function applyFirstSetupCalendarChoice(
  current: PockedioConfig,
  answers: Pick<FirstSetupAnswers, "useCalendar">
): Promise<Pick<FirstSetupAnswers, "calendarSetupApplied" | "calendarSetupAvailable">> {
  if (!answers.useCalendar) {
    return {};
  }

  const config = pockedioConfigSchema.parse({
    ...current,
    calendar: { enabled: true }
  });
  ensureRuntimeDirs(config);
  saveConfig(config);
  runMigrations(config);

  console.log("");
  console.log("If macOS asks for Calendar permission, choose Allow.");
  const calendar = await withSetupStatus("Checking calendar...", () => setupCalendarContext(config));
  console.log("");
  console.log(formatCalendarSetupSummary(calendar));
  return {
    calendarSetupApplied: true,
    calendarSetupAvailable: calendar.available
  };
}

async function applyFirstSetupDiaryChoice(
  current: PockedioConfig,
  answers: Pick<FirstSetupAnswers, "useDiary" | "diaryPath">
): Promise<Pick<FirstSetupAnswers, "diarySetupApplied" | "diarySetupAvailable">> {
  if (!answers.useDiary) {
    return {};
  }

  const config = pockedioConfigSchema.parse({
    ...current,
    diary: {
      enabled: true,
      path: answers.diaryPath
    }
  });
  ensureRuntimeDirs(config);
  saveConfig(config);

  console.log("");
  const diary = await withSetupStatus("Checking diary...", () => setupDiaryContext(config));
  console.log("");
  console.log(formatDiarySetupSummary(diary));
  return {
    diarySetupApplied: true,
    diarySetupAvailable: Boolean(diary)
  };
}

async function promptForMusicProvider(current: PockedioConfig): Promise<Pick<FirstSetupAnswers, "musicProvider">> {
  return inquirer.prompt<Pick<FirstSetupAnswers, "musicProvider">>([
    {
      type: "list",
      name: "musicProvider",
      message: "Music provider",
      choices: [
        { name: "NetEase Cloud Music", value: "netease" }
      ],
      default: musicProviders.includes(current.music.provider) ? current.music.provider : "netease"
    }
  ]);
}

async function promptForNetEaseSetup(current: PockedioConfig): Promise<Pick<FirstSetupAnswers, "neteaseSetupMethod" | "neteaseCookie" | "neteaseQualityLevel">> {
  while (true) {
    const methodAnswer = await inquirer.prompt<Pick<FirstSetupAnswers, "neteaseSetupMethod">>([
      {
        type: "list",
        name: "neteaseSetupMethod",
        message: "Connect NetEase account now?",
        choices: getNetEaseSetupMethodChoices(),
        default: inferCurrentNetEaseSetupMethod(current)
      }
    ]);

    if (methodAnswer.neteaseSetupMethod === "anonymous") {
      return methodAnswer;
    }

    const qualityAnswer = await inquirer.prompt<{ neteaseQualityLevel: NetEaseQualityMenuValue }>([
      {
        type: "list",
        name: "neteaseQualityLevel",
        message: "Preferred playback quality",
        choices: getNetEaseQualityMenuChoices(),
        default: current.netease.qualityLevel === "standard" ? "exhigh" : current.netease.qualityLevel
      }
    ]);

    const cookieAnswer: Pick<FirstSetupAnswers, "neteaseCookie"> = {};
    if (methodAnswer.neteaseSetupMethod === "cookie") {
      const neteaseCookie = await promptSetupTextInput({
        message: "Paste MUSIC_U cookie",
        mask: true,
        validate: (value) => value.trim().length > 0 || "Paste MUSIC_U=... or the MUSIC_U value."
      });
      if (neteaseCookie === "back") {
        continue;
      }
      cookieAnswer.neteaseCookie = neteaseCookie;
    }

    return {
      ...methodAnswer,
      neteaseQualityLevel: qualityAnswer.neteaseQualityLevel,
      ...cookieAnswer
    };
  }
}

async function promptForStandaloneNetEaseSetup(
  current: PockedioConfig
): Promise<Pick<FirstSetupAnswers, "neteaseSetupMethod" | "neteaseCookie" | "neteaseQualityLevel"> | "back" | "quit"> {
  while (true) {
    const neteaseSetupMethod = await promptSetupMenu<NetEaseSetupMethod>({
      title: [
        "NETEASE PLAYBACK",
        "",
        "● Connecting your account can reduce unavailable tracks and preview-only playback.",
        "",
        "ACTIONS"
      ].join("\n"),
      entries: getNetEaseSetupMethodChoices(),
      defaultValue: inferCurrentNetEaseSetupMethod(current)
    });

    if (neteaseSetupMethod === "back" || neteaseSetupMethod === "quit") {
      return neteaseSetupMethod;
    }
    if (neteaseSetupMethod === "anonymous") {
      return { neteaseSetupMethod: "anonymous" };
    }

    const neteaseQualityLevel = await promptSetupMenu<NetEaseQualityLevel>({
      title: [
        "PLAYBACK QUALITY",
        "",
        "● Pick the best quality your NetEase account can reliably play.",
        "",
        "ACTIONS"
      ].join("\n"),
      entries: getNetEaseQualityMenuChoices(),
      defaultValue: current.netease.qualityLevel === "standard" ? "exhigh" : current.netease.qualityLevel
    });
    if (neteaseQualityLevel === "back") {
      continue;
    }
    if (neteaseQualityLevel === "quit") {
      return "quit";
    }

    const cookieAnswer: Pick<FirstSetupAnswers, "neteaseCookie"> = {};
    if (neteaseSetupMethod === "cookie") {
      const neteaseCookie = await promptSetupTextInput({
        message: "Paste MUSIC_U cookie",
        mask: true,
        validate: (value) => value.trim().length > 0 || "Paste MUSIC_U=... or the MUSIC_U value."
      });
      if (neteaseCookie === "back") {
        continue;
      }
      cookieAnswer.neteaseCookie = neteaseCookie;
    }

    return {
      neteaseSetupMethod,
      neteaseQualityLevel,
      ...cookieAnswer
    };
  }
}

function promptSetupMenu<TValue extends string>(options: {
  title: string;
  entries: Array<{ name: string; value: TValue }>;
  defaultValue?: TValue;
}): Promise<TValue | "back" | "quit"> {
  return new Promise((resolve) => {
    let selected = Math.max(0, options.entries.findIndex((entry) => entry.value === options.defaultValue));
    if (selected < 0) {
      selected = 0;
    }
    const previousRawMode = defaultInput.isRaw;

    const render = () => {
      const renderOptions = {
        color: Boolean(defaultOutput.isTTY),
        width: defaultOutput.columns
      };
      defaultOutput.write("\x1B[?25l");
      defaultOutput.write("\x1B[H\x1B[2J");
      defaultOutput.write([
        formatSetupMenuTitle(options.title, renderOptions),
        "",
        ...options.entries.map((entry, index) => formatSetupMenuEntry(selected === index, index + 1, entry.name, renderOptions)),
        "",
        renderTuiFooter(`↑↓ Select  |  Enter Open  |  1-${options.entries.length} Open  |  B Back  |  Q Quit`, renderOptions)
      ].join("\n"));
    };
    const cleanup = (choice: TValue | "back" | "quit") => {
      defaultInput.off("keypress", onKeypress);
      if (defaultInput.isTTY) {
        defaultInput.setRawMode(previousRawMode);
      }
      defaultInput.pause();
      defaultOutput.write("\x1B[?25h\n");
      resolve(choice);
    };
    const onKeypress = (_value: string, key: Key) => {
      if (key.name === "up") {
        selected = selected === 0 ? options.entries.length - 1 : selected - 1;
        render();
        return;
      }
      if (key.name === "down") {
        selected = selected === options.entries.length - 1 ? 0 : selected + 1;
        render();
        return;
      }
      if (key.name === "return") {
        cleanup(options.entries[selected]!.value);
        return;
      }
      if (key.name === "b") {
        cleanup("back");
        return;
      }
      if (key.name === "q" || (key.name === "c" && key.ctrl)) {
        cleanup("quit");
        return;
      }
      const numericIndex = Number(key.name) - 1;
      if (Number.isInteger(numericIndex) && numericIndex >= 0 && numericIndex < options.entries.length) {
        cleanup(options.entries[numericIndex]!.value);
      }
    };

    emitKeypressEvents(defaultInput);
    defaultInput.resume();
    if (defaultInput.isTTY) {
      defaultInput.setRawMode(true);
    }
    defaultInput.on("keypress", onKeypress);
    render();
  });
}

function promptSetupTextInput(options: {
  message: string;
  defaultValue?: string;
  mask?: boolean;
  validate?: (value: string) => true | string;
}): Promise<string | "back"> {
  const promptLabel = `${options.message}${options.defaultValue ? ` (${options.defaultValue})` : ""} [${textInputEscapeHint}]: `;
  if (!defaultInput.isTTY) {
    const rl = createInterface({ input: defaultInput, output: defaultOutput });
    return new Promise((resolve) => {
      rl.question(promptLabel, (answer) => {
        rl.close();
        resolve(isBackInput(answer) ? "back" : answer.trim() || options.defaultValue || "");
      });
    });
  }

  return new Promise((resolve) => {
    let value = "";
    const previousRawMode = defaultInput.isRaw;

    const render = (error?: string) => {
      if (error) {
        defaultOutput.write(`\n${error}\n`);
      }
      const shownValue = options.mask ? "*".repeat(value.length) : value;
      defaultOutput.write(`\r\x1B[2K${promptLabel}${shownValue}`);
    };
    const cleanup = (result: string | "back") => {
      defaultInput.off("data", onData);
      if (defaultInput.isTTY) {
        defaultInput.setRawMode(previousRawMode);
      }
      defaultInput.pause();
      defaultOutput.write("\n");
      resolve(result);
    };
    const submit = () => {
      const result = value.trim() || options.defaultValue || "";
      if (isBackInput(result)) {
        cleanup("back");
        return;
      }
      const validation = options.validate?.(result) ?? true;
      if (validation !== true) {
        render(validation);
        return;
      }
      cleanup(result);
    };
    const onData = (chunk: Buffer) => {
      for (const char of chunk.toString("utf8")) {
        if (char === "\u001b") {
          cleanup("back");
          return;
        }
        if (char === "\u0003") {
          cleanup("back");
          return;
        }
        if (char === "\r" || char === "\n") {
          submit();
          return;
        }
        if (char === "\u007f" || char === "\b") {
          value = value.slice(0, -1);
          render();
          continue;
        }
        value += char;
        render();
      }
    };

    defaultInput.resume();
    defaultInput.setRawMode(true);
    defaultInput.on("data", onData);
    render();
  });
}

export async function promptForAdvancedSetup(current: PockedioConfig): Promise<SetupAnswers> {
  console.log(diaryPathCopyHint);
  return inquirer.prompt<SetupAnswers>([
    {
      type: "input",
      name: "neteaseBaseUrl",
      message: "Music provider - NetEase API base URL",
      default: current.netease.baseUrl
    },
    {
      type: "confirm",
      name: "weatherEnabled",
      message: "Context permissions - enable weather context",
      default: current.weather.enabled
    },
    {
      type: "input",
      name: "weatherLocation",
      message: "Context permissions - weather city",
      default: current.weather.location,
      when: (answers) => answers.weatherEnabled
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
      validate: (value) => value.trim().length > 0 || "Paste your diary root directory path.",
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
      message: "Voice - local FishAudio model directory",
      default: current.fishAudio.modelDir
    },
    {
      type: "input",
      name: "fishApiKeyEnv",
      message: "Voice - Fish API key environment variable",
      default: current.fishApi.apiKeyEnv
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
  const musicProvider = answers.musicProvider ?? current.music.provider;
  const neteaseSetupMethod = answers.neteaseSetupMethod ?? inferCurrentNetEaseSetupMethod(current);
  return pockedioConfigSchema.parse({
    ...current,
    music: {
      provider: musicProvider
    },
    netease: {
      ...current.netease,
      authMode: neteaseSetupMethod === "anonymous" ? "anonymous" : "account",
      qualityLevel: neteaseSetupMethod === "anonymous"
        ? "standard"
        : answers.neteaseQualityLevel ?? current.netease.qualityLevel
    },
    weather: {
      enabled: answers.useWeather,
      location: answers.useWeather
        ? answers.weatherLocation || current.weather.location
        : current.weather.location
    },
    calendar: {
      enabled: answers.calendarSetupApplied
        ? Boolean(answers.calendarSetupAvailable)
        : answers.useCalendar
    },
    diary: {
      enabled: answers.diarySetupApplied
        ? Boolean(answers.diarySetupAvailable)
        : answers.useDiary,
      path: answers.useDiary ? answers.diaryPath : undefined
    },
    fishAudio: {
      ...current.fishAudio,
      referenceAudioPath: getDjVoiceReferencePath(answers.djChoice),
      referenceText: getDjVoiceReferenceText(answers.djChoice)
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

export function buildConfigFromNetEaseSetupAnswers(
  current: PockedioConfig,
  answers: Pick<FirstSetupAnswers, "neteaseSetupMethod" | "neteaseQualityLevel">
): PockedioConfig {
  const neteaseSetupMethod = answers.neteaseSetupMethod ?? inferCurrentNetEaseSetupMethod(current);
  return pockedioConfigSchema.parse({
    ...current,
    netease: {
      ...current.netease,
      authMode: neteaseSetupMethod === "anonymous" ? "anonymous" : "account",
      qualityLevel: neteaseSetupMethod === "anonymous"
        ? "standard"
        : answers.neteaseQualityLevel ?? current.netease.qualityLevel
    }
  });
}

export function buildConfigFromSchedulerSetupAction(
  current: PockedioConfig,
  target: SchedulerSetupAction,
  options: { action?: ScheduledDjProgramAction; playTime?: string } = {}
): PockedioConfig {
  if (target === "disable_all") {
    return pockedioConfigSchema.parse({
      ...current,
      dj: {
        ...current.dj,
        schedule: {
          morning: {
            ...current.dj.schedule.morning,
            enabled: false
          },
          evening: {
            ...current.dj.schedule.evening,
            enabled: false
          }
        }
      }
    });
  }

  const action = options.action ?? "enable";
  const nextProgram = {
    ...current.dj.schedule[target],
    enabled: action === "disable" ? false : true,
    playTime: options.playTime?.trim() || current.dj.schedule[target].playTime
  };
  return pockedioConfigSchema.parse({
    ...current,
    dj: {
      ...current.dj,
      schedule: {
        ...current.dj.schedule,
        [target]: nextProgram
      }
    }
  });
}

export function buildConfigFromAnswers(current: PockedioConfig, answers: SetupAnswers): PockedioConfig {
  return pockedioConfigSchema.parse({
    ...current,
    netease: {
      ...current.netease,
      baseUrl: answers.neteaseBaseUrl
    },
    weather: {
      enabled: answers.weatherEnabled,
      location: answers.weatherEnabled
        ? answers.weatherLocation || current.weather.location
        : current.weather.location
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
    fishApi: {
      ...current.fishApi,
      apiKeyEnv: answers.fishApiKeyEnv ?? current.fishApi.apiKeyEnv
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

export function getDjVoiceReferencePath(choice: DjChoice): string {
  return getDjPreviewPath(choice);
}

export function getDjVoiceReferenceText(choice: DjChoice): string {
  return choice === "Mina"
    ? "Mina is here. Soft lights, warm songs, and a little room to breathe."
    : "Nova here. Bright rhythm, clean motion, and just enough spark to move.";
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

export function formatSetupTasteImportFailure(error: unknown): string {
  const reason = error instanceof Error ? error.message : String(error);
  return [
    "Could not import this NetEase playlist.",
    `  Reason            ${reason}`,
    "Setup will continue without playlist taste import."
  ].join("\n");
}

export function formatSetupTasteStatus(answers: Pick<FirstSetupAnswers, "importTasteNow" | "tasteImportStatus">): string {
  if (!answers.importTasteNow) {
    return "skipped";
  }
  return answers.tasteImportStatus ?? "pending";
}

async function importNetEasePlaylistTasteDuringSetup(playlistInput: string, config: PockedioConfig): Promise<SetupTasteImportStatus> {
  console.log("");
  console.log("Reading NetEase playlist...");
  try {
    const result = await importTasteFromNetEasePlaylist(playlistInput, config);
    console.log("");
    console.log(formatSetupTasteImportSummary(result));
    return "imported";
  } catch (error) {
    console.log("");
    console.log(formatSetupTasteImportFailure(error));
    return "failed";
  }
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

function formatScheduledDjProgramSummary(kind: ScheduledDjKind, config: PockedioConfig): string {
  const program = config.dj.schedule[kind];
  return program.enabled
    ? `Enabled, weekdays ${program.playTime}`
    : `Disabled, saved time ${program.playTime}`;
}

function formatScheduledDjKind(kind: ScheduledDjKind): string {
  return kind === "morning" ? "Morning" : "Evening";
}

export function formatNetEaseSetupSummary(config: PockedioConfig): string {
  return [
    "NetEase Cloud Music",
    config.netease.authMode === "account"
      ? `account-backed (${config.netease.qualityLevel})`
      : "anonymous"
  ].join(" - ");
}

export function getNetEaseSetupMethodChoices(): Array<{ name: string; value: NetEaseSetupMenuValue }> {
  return [
    { name: "Yes, scan QR", value: "qr" },
    { name: "Yes, paste MUSIC_U cookie", value: "cookie" },
    { name: "Not now, use anonymous playback", value: "anonymous" }
  ];
}

export function getNetEaseQualityMenuChoices(): Array<{ name: string; value: NetEaseQualityMenuValue }> {
  return [
    { name: "hires - best quality, may be unavailable", value: "hires" },
    { name: "lossless - very high quality, needs support", value: "lossless" },
    { name: "exhigh - best daily default", value: "exhigh" },
    { name: "higher - good fallback", value: "higher" },
    { name: "standard - safest fallback", value: "standard" }
  ];
}

export const __netEaseQrLoginForTests = {
  start: startNetEaseQrLogin,
  poll: pollNetEaseQrLogin,
  formatInstructions: formatNetEaseQrLoginInstructions
};

async function applyNetEaseSetupChoice(
  config: PockedioConfig,
  answers: Pick<FirstSetupAnswers, "neteaseSetupMethod" | "neteaseCookie">
): Promise<PockedioConfig> {
  const neteaseSetupMethod = answers.neteaseSetupMethod ?? inferCurrentNetEaseSetupMethod(config);
  if (neteaseSetupMethod === "anonymous") {
    clearNetEaseCookie(config);
    return config;
  }

  if (neteaseSetupMethod === "cookie") {
    saveNetEaseCookie(config, answers.neteaseCookie ?? "");
    return config;
  }

  const result = await loginNetEaseWithQr(config);
  if (!result.ok) {
    console.log("");
    console.log("Could not verify NetEase login.");
    console.log(result.error);
    console.log("Continuing with anonymous playback for now.");
    clearNetEaseCookie(config);
    const fallback = pockedioConfigSchema.parse({
      ...config,
      netease: {
        ...config.netease,
        authMode: "anonymous",
        qualityLevel: "standard"
      }
    });
    saveConfig(fallback);
    return fallback;
  }
  return config;
}

type NetEaseQrLoginResult = { ok: true } | { ok: false; error: string };
type NetEaseQrLoginStart =
  | { ok: true; key: string; qrPath?: string; qrUrl?: string }
  | { ok: false; error: string };

async function loginNetEaseWithQr(config: PockedioConfig, fetchImpl: typeof fetch = fetch): Promise<NetEaseQrLoginResult> {
  try {
    const start = await startNetEaseQrLogin(config, fetchImpl);
    if (!start.ok) {
      return start;
    }

    console.log("");
    console.log(formatNetEaseQrLoginInstructions(start));

    const result = await withSetupStatus("Waiting for NetEase QR confirmation...", () => pollNetEaseQrLogin(config, start.key, fetchImpl));
    if (result.ok) {
      console.log("");
      console.log("NetEase connected.");
      console.log("Pockedio will use your account for playback when available.");
    }
    return result;
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function formatNetEaseQrLoginInstructions(start: NetEaseQrLoginStart): string {
  if (!start.ok) {
    return start.error;
  }

  const lines: string[] = [];
  if (start.qrPath) {
    lines.push("Scan this QR image with NetEase Cloud Music:");
    lines.push(`  Link: ${pathToFileURL(start.qrPath).href}`);
    lines.push(`  File: ${start.qrPath}`);
  } else if (start.qrUrl) {
    lines.push("Open this NetEase login URL:");
    lines.push(`  Link: ${start.qrUrl}`);
  } else {
    lines.push("Scan the NetEase QR code in your browser or app.");
  }
  lines.push("The QR code is valid for about 90 seconds.");
  return lines.join("\n");
}

async function startNetEaseQrLogin(config: PockedioConfig, fetchImpl: typeof fetch = fetch): Promise<NetEaseQrLoginStart> {
  const timestamp = () => String(Date.now());
  const keyJson = await fetchJson(`${config.netease.baseUrl}/login/qr/key?timestamp=${timestamp()}`, fetchImpl);
  const key = valueToString(asRecord(keyJson.data)?.unikey);
  if (!key) {
    return { ok: false, error: "NetEase did not return a QR login key." };
  }

  const qrJson = await fetchJson(`${config.netease.baseUrl}/login/qr/create?key=${encodeURIComponent(key)}&qrimg=true&timestamp=${timestamp()}`, fetchImpl);
  const qrData = asRecord(qrJson.data);
  const qrImage = valueToString(qrData?.qrimg);
  const qrUrl = valueToString(qrData?.qrurl);
  if (qrImage) {
    const qrPath = path.join(path.dirname(config.paths.neteaseCookie), "netease-login-qr.png");
    fs.mkdirSync(path.dirname(qrPath), { recursive: true });
    fs.writeFileSync(qrPath, Buffer.from(qrImage.replace(/^data:image\/png;base64,/, ""), "base64"));
    return { ok: true, key, qrPath };
  } else if (qrUrl) {
    return { ok: true, key, qrUrl };
  }
  return { ok: true, key };
}

async function pollNetEaseQrLogin(config: PockedioConfig, key: string, fetchImpl: typeof fetch = fetch): Promise<NetEaseQrLoginResult> {
  const timestamp = () => String(Date.now());
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    const status = await fetchJson(`${config.netease.baseUrl}/login/qr/check?key=${encodeURIComponent(key)}&timestamp=${timestamp()}&noCookie=true`, fetchImpl);
    const code = valueToNumber(status.code);
    if (code === 803) {
      const cookie = valueToString(status.cookie);
      if (!cookie) {
        return { ok: false, error: "NetEase QR login succeeded without returning a cookie." };
      }
      saveNetEaseCookie(config, cookie);
      return { ok: true };
    }
    if (code === 800) {
      return { ok: false, error: "NetEase QR code expired." };
    }
  }

  return { ok: false, error: "NetEase QR login timed out." };
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
      listeningHint: "Calendar listening hint unavailable.",
      warning: permission.warning
    };
  }

  const calendar = await readCalendarContext(true, 60_000, undefined, "last7Days");
  if (calendar.available) {
    saveConfig(config);
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

export function formatSetupMenuTitle(title: string, options: TuiRenderOptions = {}): string {
  if (!options.color) {
    return title;
  }
  let firstHeading = true;
  return title.split("\n").map((line) => {
    if (!line.trim()) {
      return line;
    }
    if (line.startsWith("● ")) {
      return renderTuiBulletLine(line.slice(2), options);
    }
    if (/^[A-Z][A-Z0-9 &-]+$/.test(line)) {
      if (firstHeading) {
        firstHeading = false;
        return renderTuiPageTitle(line, options);
      }
      return renderTuiSectionLabel(line, { ...options, accent: "playback" });
    }
    const keyValue = line.match(/^([A-Za-z][A-Za-z ]+?)\s{2,}(.+)$/);
    if (keyValue) {
      return renderTuiKeyValue(keyValue[1]!.trim(), keyValue[2]!.trim(), 15, options);
    }
    return line;
  }).join("\n");
}

export function formatSetupMenuEntry(selected: boolean, index: number, name: string, options: TuiRenderOptions = {}): string {
  if (options.color) {
    return renderTuiRow({
      marker: selected ? ">" : " ",
      label: `${index}.`,
      text: name,
      selected,
      accent: selected ? "playback" : "dim"
    }, options);
  }
  const line = `${selected ? "▌ >" : "   "} ${index}. ${name}`;
  return selected ? `\x1B[7m${line}\x1B[0m` : line;
}

function formatDiaryPathForSetup(pathValue: string | undefined): string {
  return pathValue?.trim() || "Not set";
}

function inferCurrentNetEaseSetupMethod(current: PockedioConfig): NetEaseSetupMethod {
  return current.netease.authMode === "account" ? "cookie" : "anonymous";
}

function validateTimeOfDay(value: string): true | string {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
    ? true
    : "Time must use HH:mm, for example 08:45.";
}

function isBackInput(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === "b" || normalized === "back";
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

type UnknownJson = Record<string, unknown>;

async function fetchJson(url: string, fetchImpl: typeof fetch): Promise<UnknownJson> {
  const response = await fetchImpl(url);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`NetEase request failed with HTTP ${response.status}.`);
  }
  return JSON.parse(text) as UnknownJson;
}

function valueToString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function valueToNumber(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
