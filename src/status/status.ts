import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import Database from "better-sqlite3";
import { loadConfig } from "../config/load.js";
import { hasLocalLlmApiKey } from "../config/llmSecrets.js";
import { readNetEaseCookie } from "../config/neteaseAuth.js";
import { getConfigPath, type PockedioEnv } from "../config/paths.js";
import type { PockedioConfig } from "../config/schema.js";
import { getLatestContextRefreshRun, type ContextRefreshRunRecord } from "../context/heartbeat.js";
import { schemaVersion } from "../db/migrations.js";
import { NetEaseProvider } from "../providers/netease.js";
import {
  renderTuiBulletLine,
  renderTuiKeyValue,
  renderTuiPageTitle,
  renderTuiSectionLabel,
  type TuiRenderOptions
} from "../tui/terminalRenderer.js";
import { resolveRuntimePath } from "../tts/fishAudio.js";
import { formatFishVoiceName, formatMacosVoiceName } from "../tts/voiceSetup.js";

export type StatusReport = {
  config: {
    path: string;
    present: boolean;
  };
  runtime: {
    currentPlayback: string | null;
    scheduledJobs: string;
  };
  database: {
    path: string;
    present: boolean;
    migrated: boolean;
    schemaVersion?: number;
    error?: string;
  };
	  netease: {
	    baseUrl: string;
	    reachable: boolean;
	    authMode: PockedioConfig["netease"]["authMode"];
	    qualityLevel: PockedioConfig["netease"]["qualityLevel"];
	    cookiePresent: boolean;
	    error?: string;
	  };
  llm: {
    provider: string;
    model: string;
    baseUrl?: string;
    apiKeyEnv: string;
    apiKeyPresent: boolean;
    apiKeySource: "env" | "local_secret" | "missing";
  };
  fishAudio: {
    pythonPath: string;
    scriptPath: string;
    modelDir: string;
    pathsPresent: boolean;
    missing: string[];
  };
  voice: {
    summary: string;
    showFishMissing: boolean;
  };
  calendar: {
    enabled: boolean;
  };
  weather: {
    enabled: boolean;
    location: string;
  };
  taste: {
    path: string;
    present: boolean;
  };
  personas: {
    path: string;
    present: boolean;
  };
  latestSessionTimestamp: string | null;
  contextHeartbeat: ContextRefreshRunRecord | null;
};

export type StatusReportOptions = {
  config?: PockedioConfig;
  env?: PockedioEnv;
  fetchImpl?: typeof fetch;
};

export async function getStatusReport(options: PockedioConfig | StatusReportOptions = {}): Promise<StatusReport> {
  const resolved = resolveStatusOptions(options);
  const { config, env } = resolved;
  const provider = new NetEaseProvider(config, resolved.fetchImpl ?? fetch);
  const fishAudio = getFishAudioStatus(config);
  const neteaseBase = {
    baseUrl: config.netease.baseUrl,
    authMode: config.netease.authMode,
    qualityLevel: config.netease.qualityLevel,
    cookiePresent: Boolean(readNetEaseCookie(config))
  };
  const configStatus = {
    path: getConfigPath(env),
    present: fs.existsSync(getConfigPath(env))
  };
  const database = getDatabaseStatus(config);
  const llmApiKeySource = getLlmApiKeySource(config, env);
  const baseReport = {
    config: configStatus,
    runtime: {
      currentPlayback: getCurrentPlayback(config),
      scheduledJobs: formatScheduledJobs(config, isSchedulerServeRunning())
    },
    database,
    llm: {
      provider: "OpenAI-compatible",
      model: config.llm.model,
      baseUrl: config.llm.baseUrl,
      apiKeyEnv: config.llm.apiKeyEnv,
      apiKeyPresent: llmApiKeySource !== "missing",
      apiKeySource: llmApiKeySource
    },
    fishAudio,
    voice: getVoiceStatus(config, fishAudio),
    calendar: {
      enabled: config.calendar.enabled
    },
    weather: {
      enabled: config.weather.enabled,
      location: config.weather.location
    },
    taste: {
      path: config.paths.taste,
      present: fs.existsSync(config.paths.taste)
    },
    personas: {
      path: config.paths.personas,
      present: fs.existsSync(config.paths.personas)
    },
    latestSessionTimestamp: getLatestSessionTimestamp(config),
    contextHeartbeat: getLatestContextRefreshRun(config)
  };

  try {
    await provider.search({ keyword: "坂本龙一" }, 1);
    return {
      ...baseReport,
	      netease: {
	        ...neteaseBase,
	        reachable: true
      }
    };
  } catch (error) {
    return {
      ...baseReport,
	      netease: {
	        ...neteaseBase,
	        reachable: false,
        error: error instanceof Error ? error.message : String(error)
      }
    };
  }
}

function resolveStatusOptions(options: PockedioConfig | StatusReportOptions): Required<Omit<StatusReportOptions, "fetchImpl">> & Pick<StatusReportOptions, "fetchImpl"> {
  if (isPockedioConfig(options)) {
    return { config: options, env: process.env, fetchImpl: undefined };
  }
  const env = options.env ?? process.env;
  return {
    config: options.config ?? loadConfig(env),
    env,
    fetchImpl: options.fetchImpl
  };
}

export function getFishAudioStatus(config: PockedioConfig): StatusReport["fishAudio"] {
  const pythonPath = resolveRuntimePath(config.fishAudio.pythonPath);
  const scriptPath = resolveRuntimePath(config.fishAudio.scriptPath);
  const modelDir = resolveRuntimePath(config.fishAudio.modelDir);
  const checks = [
    ["python", pythonPath],
    ["script", scriptPath],
    ["model", modelDir]
  ] as const;
  const missing = checks
    .filter(([, targetPath]) => !fs.existsSync(targetPath))
    .map(([label, targetPath]) => `${label}: ${targetPath}`);

  return {
    pythonPath,
    scriptPath,
    modelDir,
    pathsPresent: missing.length === 0,
    missing
  };
}

function getVoiceStatus(config: PockedioConfig, fishAudio: StatusReport["fishAudio"]): StatusReport["voice"] {
  if (config.tts.provider === "text") {
    return { summary: "Text-only DJ copy", showFishMissing: false };
  }
  if (config.tts.provider === "macos") {
    return {
      summary: process.platform === "darwin"
        ? `${formatMacosVoiceName(config.tts.macosVoice)}, built-in macOS`
        : "Built-in macOS voice unavailable on this platform",
      showFishMissing: false
    };
  }
  if (config.tts.provider === "fish") {
    return {
      summary: fishAudio.pathsPresent
        ? `${formatFishVoiceName(config.tts.fishVoice)}, Fish TTS ready`
        : `${formatFishVoiceName(config.tts.fishVoice)}, Fish TTS needs setup`,
      showFishMissing: !fishAudio.pathsPresent
    };
  }
  if (process.platform === "darwin") {
    return { summary: `${formatMacosVoiceName(config.tts.macosVoice)}, built-in macOS`, showFishMissing: false };
  }
  if (fishAudio.pathsPresent) {
    return { summary: `${formatFishVoiceName(config.tts.fishVoice)}, Fish TTS ready`, showFishMissing: false };
  }
  return { summary: "Text-only DJ copy; configure voice for spoken DJ audio", showFishMissing: false };
}

function getDatabaseStatus(config: PockedioConfig): StatusReport["database"] {
  if (!fs.existsSync(config.paths.database)) {
    return {
      path: config.paths.database,
      present: false,
      migrated: false
    };
  }

  let db: Database.Database | undefined;
  try {
    db = new Database(config.paths.database, { readonly: true });
    const row = db.prepare("SELECT value_json as valueJson FROM settings WHERE key = 'schema_version'").get() as { valueJson: string } | undefined;
    const version = row ? JSON.parse(row.valueJson) as unknown : undefined;
    const numericVersion = typeof version === "number" ? version : undefined;
    return {
      path: config.paths.database,
      present: true,
      migrated: numericVersion === schemaVersion,
      schemaVersion: numericVersion
    };
  } catch (error) {
    return {
      path: config.paths.database,
      present: true,
      migrated: false,
      error: error instanceof Error ? error.message : String(error)
    };
  } finally {
    db?.close();
  }
}

function getLatestSessionTimestamp(config: PockedioConfig): string | null {
  if (!fs.existsSync(config.paths.database)) {
    return null;
  }

  let db: Database.Database | undefined;
  try {
    db = new Database(config.paths.database, { readonly: true });
    const row = db.prepare("SELECT MAX(started_at) as latest FROM sessions").get() as { latest: string | null } | undefined;
    return row?.latest ?? null;
  } catch {
    return null;
  } finally {
    db?.close();
  }
}

function getCurrentPlayback(config: PockedioConfig): string | null {
  if (!fs.existsSync(config.paths.database)) {
    return null;
  }

  let db: Database.Database | undefined;
  try {
    db = new Database(config.paths.database, { readonly: true });
    const row = db.prepare(`
      SELECT title, artist
      FROM station_tracks
      WHERE playback_status = 'playing'
      ORDER BY created_at DESC
      LIMIT 1
    `).get() as { title: string; artist: string } | undefined;
    return row ? `${row.title} - ${row.artist}` : null;
  } catch {
    return null;
  } finally {
    db?.close();
  }
}

function formatScheduledJobs(config: PockedioConfig, serveRunning = false): string {
  return [
    formatScheduledProgramStatus("Morning DJ", config.dj.schedule.morning),
    formatScheduledProgramStatus("Evening DJ", config.dj.schedule.evening),
    "mood checks hourly while serve runs",
    serveRunning ? "serve running" : "serve not running"
  ].join("; ");
}

function formatScheduledProgramStatus(
  label: string,
  schedule: PockedioConfig["dj"]["schedule"]["morning"]
): string {
  if (!schedule.enabled) {
    return `${label} disabled`;
  }
  return `${label} weekdays ${schedule.playTime} (prepare ${schedule.prepareMinutesBefore} min before)`;
}

function isSchedulerServeRunning(): boolean {
  const result = spawnSync("ps", ["-axo", "pid=,command="], { encoding: "utf8" });
  if (result.status !== 0 || !result.stdout) {
    return false;
  }
  return result.stdout
    .split("\n")
    .some((line) => isPockedioServeProcessLine(line, process.pid));
}

function isPockedioServeProcessLine(line: string, currentPid: number): boolean {
  const match = line.trim().match(/^(\d+)\s+(.+)$/);
  if (!match) {
    return false;
  }
  const pid = Number(match[1]);
  const command = match[2];
  if (pid === currentPid) {
    return false;
  }
  return /\bpockedio\s+serve\b/.test(command)
    || /\btsx\s+src\/cli\.ts\s+serve\b/.test(command)
    || /\/dist\/cli\.js\s+serve\b/.test(command);
}

export function formatStatusReport(report: StatusReport, options: TuiRenderOptions = {}): string {
  const lines = [
    renderTuiPageTitle("POCKEDIO STATUS", options),
    "",
    renderTuiBulletLine("Current runtime, setup, memory, and local data state.", options),
    "",
    renderTuiSectionLabel("RUNTIME", { ...options, accent: "playback" }),
    formatStatusLine("Playback", report.runtime.currentPlayback ?? "none", options),
    formatStatusLine("Session", report.latestSessionTimestamp ?? "none", options),
    formatStatusLine("Schedule", report.runtime.scheduledJobs, options),
    "",
    renderTuiSectionLabel("SETUP", { ...options, accent: "playback" }),
    formatStatusLine("Music", formatNetEaseStatus(report.netease), options),
    formatStatusLine("LLM", formatLlmStatus(report.llm), options),
    formatStatusLine("Voice", report.voice.summary, options),
    formatStatusLine("Context", `Calendar ${report.calendar.enabled ? "on" : "off"}, Weather ${report.weather.enabled ? report.weather.location : "off"}`, options),
    "",
    renderTuiSectionLabel("MEMORY", { ...options, accent: "playback" }),
    formatStatusLine("Config", report.config.present ? "ok" : "missing", options),
    formatStatusLine("Database", report.database.migrated ? "ok" : report.database.present ? "needs migration" : "missing", options),
    formatStatusLine("Taste", report.taste.present ? "ok" : "missing", options),
    formatStatusLine("Voices", report.personas.present ? "ok" : "missing", options),
    formatStatusLine("Heartbeat", formatContextHeartbeatStatus(report.contextHeartbeat), options),
    "",
    renderTuiSectionLabel("LOCAL DATA", { ...options, accent: "playback" }),
    formatStatusLine("Local", path.dirname(report.config.path), options),
    formatStatusLine("External", "NetEase, configured LLM, weather, and diary summaries may leave this machine when used.", options)
  ];
  if (report.database.error) {
    lines.push(`Database detail: ${report.database.error}`);
  }
  if (report.netease.error) {
    lines.push(`NetEase detail: ${report.netease.error}`);
  }
  if (report.voice.showFishMissing && report.fishAudio.missing.length > 0) {
    lines.push("FishAudio missing:");
    lines.push(...report.fishAudio.missing.map((item) => `- ${item}`));
  }
  return lines.join("\n");
}

function formatStatusLine(label: string, value: string, options: TuiRenderOptions): string {
  const width = ["Playback", "Session", "Schedule"].includes(label) ? 11 : 10;
  if (!options.color) {
    return `${label.padEnd(width)}${value}`;
  }
  return renderTuiKeyValue(label, value, width - 1, options);
}

function formatContextHeartbeatStatus(run: ContextRefreshRunRecord | null): string {
  if (!run) {
    return "not run yet";
  }
  const finished = run.finishedAt ?? run.startedAt;
  const calendar = `${run.calendarEventsRead} calendar`;
  const diary = `${run.diaryFilesScanned} diary, ${run.diarySummariesGenerated} new`;
  return `${run.status} ${finished} (${calendar}; ${diary})`;
}

function formatNetEaseStatus(netease: StatusReport["netease"]): string {
  if (netease.authMode === "account" && netease.cookiePresent) {
    return `${netease.reachable ? "NetEase account connected" : "NetEase API unreachable"} (${netease.qualityLevel})`;
  }
  return `${netease.reachable ? "NetEase API reachable" : "NetEase API unreachable"} (anonymous playback, not logged in)`;
}

function formatLlmStatus(llm: StatusReport["llm"]): string {
  const keyStatus = llm.apiKeyPresent ? formatLlmKeySource(llm.apiKeySource) : "missing key";
  return `${llm.model} (${keyStatus})`;
}

function getLlmApiKeySource(config: PockedioConfig, env: PockedioEnv): StatusReport["llm"]["apiKeySource"] {
  if (env[config.llm.apiKeyEnv]) {
    return "env";
  }
  if (hasLocalLlmApiKey(config, config.llm.apiKeyEnv)) {
    return "local_secret";
  }
  return "missing";
}

function formatLlmKeySource(source: StatusReport["llm"]["apiKeySource"]): string {
  return source === "local_secret" ? "local secret" : source === "env" ? "shell env" : "missing";
}

export async function printStatus(): Promise<void> {
  console.log(formatStatusReport(await getStatusReport(), {
    color: Boolean(process.stdout.isTTY),
    width: process.stdout.columns
  }));
}

function isPockedioConfig(value: PockedioConfig | StatusReportOptions): value is PockedioConfig {
  return typeof (value as PockedioConfig).netease?.baseUrl === "string";
}
