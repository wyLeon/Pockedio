import inquirer from "inquirer";
import { runMigrations } from "../db/migrations.js";
import { ensurePersonaFile } from "../personas/personaStore.js";
import { ensureRuntimeDirs, loadConfig, saveConfig } from "./load.js";
import { mbtiTypes, pockedioConfigSchema, type MbtiType, type PockedioConfig } from "./schema.js";

type SetupAnswers = {
  neteaseBaseUrl: string;
  weatherLocation: string;
  calendarEnabled: boolean;
  diaryEnabled: boolean;
  diaryPath?: string;
  mbti?: MbtiType | "Unset";
  llmModel: string;
  fishAudioPythonPath: string;
  fishAudioScriptPath: string;
  fishAudioModelDir: string;
};

export async function runSetup(): Promise<void> {
  const current = loadConfig();
  const answers = await promptForSetup(current);
  const config = buildConfigFromAnswers(current, answers);
  ensureRuntimeDirs(config);
  saveConfig(config);
  runMigrations(config);
  ensurePersonaFile(config);
  console.log("Pockedio setup saved.");
}

export async function promptForSetup(current: PockedioConfig): Promise<SetupAnswers> {
  return inquirer.prompt<SetupAnswers>([
    {
      type: "input",
      name: "neteaseBaseUrl",
      message: "NetEase API base URL",
      default: current.netease.baseUrl
    },
    {
      type: "input",
      name: "weatherLocation",
      message: "Weather city",
      default: current.weather.location
    },
    {
      type: "confirm",
      name: "calendarEnabled",
      message: "Enable Apple Calendar context",
      default: current.calendar.enabled
    },
    {
      type: "confirm",
      name: "diaryEnabled",
      message: "Enable diary context",
      default: current.diary.enabled
    },
    {
      type: "input",
      name: "diaryPath",
      message: "Diary path",
      default: current.diary.path,
      when: (answers) => answers.diaryEnabled
    },
    {
      type: "list",
      name: "mbti",
      message: "Self-declared MBTI type",
      choices: ["Unset", ...mbtiTypes],
      default: current.personality.mbti ?? "Unset"
    },
    {
      type: "input",
      name: "llmModel",
      message: "LLM model",
      default: current.llm.model
    },
    {
      type: "input",
      name: "fishAudioPythonPath",
      message: "FishAudio Python path",
      default: current.fishAudio.pythonPath
    },
    {
      type: "input",
      name: "fishAudioScriptPath",
      message: "FishAudio script path",
      default: current.fishAudio.scriptPath
    },
    {
      type: "input",
      name: "fishAudioModelDir",
      message: "FishAudio model directory",
      default: current.fishAudio.modelDir
    }
  ]);
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
      baseUrl: current.llm.baseUrl,
      apiKeyEnv: current.llm.apiKeyEnv
    },
    fishAudio: {
      pythonPath: answers.fishAudioPythonPath,
      scriptPath: answers.fishAudioScriptPath,
      modelDir: answers.fishAudioModelDir
    }
  });
}
