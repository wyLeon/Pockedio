import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { loadConfig } from "../config/load.js";
import { readNetEaseCookie } from "../config/neteaseAuth.js";
import { getConfigPath, type PockedioEnv } from "../config/paths.js";
import type { PockedioConfig } from "../config/schema.js";
import { schemaVersion } from "../db/migrations.js";
import { NetEaseProvider } from "../providers/netease.js";
import { resolveRuntimePath } from "../tts/fishAudio.js";

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
  };
  fishAudio: {
    pythonPath: string;
    scriptPath: string;
    modelDir: string;
    pathsPresent: boolean;
    missing: string[];
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
  const baseReport = {
    config: configStatus,
    runtime: {
      currentPlayback: getCurrentPlayback(config),
      scheduledJobs: formatScheduledJobs(config)
    },
    database,
    llm: {
      provider: "OpenAI-compatible",
      model: config.llm.model,
      baseUrl: config.llm.baseUrl,
      apiKeyEnv: config.llm.apiKeyEnv,
      apiKeyPresent: Boolean(env[config.llm.apiKeyEnv])
    },
    fishAudio,
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
    latestSessionTimestamp: getLatestSessionTimestamp(config)
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

function formatScheduledJobs(config: PockedioConfig): string {
  return [
    formatScheduledProgramStatus("Morning DJ", config.dj.schedule.morning),
    formatScheduledProgramStatus("Evening DJ", config.dj.schedule.evening),
    "mood checks hourly while serve runs"
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

export function formatStatusReport(report: StatusReport): string {
  const lines = [
    "Pockedio status",
    "",
    "Runtime",
    `- Current playback: ${report.runtime.currentPlayback ?? "none"}`,
    `- Last session: ${report.latestSessionTimestamp ?? "none"}`,
    `- Scheduled jobs: ${report.runtime.scheduledJobs}`,
    "",
    "Integrations",
    `- NetEase music: ${formatNetEaseStatus(report.netease)}`,
    `- LLM: ${report.llm.apiKeyPresent ? "configured" : "missing API key"} (${formatLlmStatus(report.llm)})`,
    `- FishAudio: ${report.fishAudio.pathsPresent ? "paths present" : "missing paths"}`,
    `- Calendar: ${report.calendar.enabled ? "enabled" : "disabled"}`,
    `- Weather: ${report.weather.enabled ? report.weather.location : "disabled"}`,
    "",
    "Memory",
    `- Config: ${report.config.present ? "present" : "missing"} (${report.config.path})`,
    `- Database: ${report.database.migrated ? "migrated" : report.database.present ? "not migrated" : "missing"} (${report.database.path})`,
    `- taste.md: ${report.taste.present ? "present" : "missing"} (${report.taste.path})`,
    `- Personas: ${report.personas.present ? "present" : "missing"} (${report.personas.path})`,
    "",
    "Data boundary",
    `- Local home: ${path.dirname(report.config.path)}`,
    "- Pockedio-owned data: local only",
    "- Stored locally: config, SQLite memory, taste.md, personas, DJ audio cache",
    "- External adapters: NetEase music, OpenAI-compatible LLM, Open-Meteo weather",
    "- Diary summary generation may send the latest diary excerpt to the configured LLM.",
    "- External adapter data may leave this machine when used; Pockedio does not store it remotely."
  ];
  if (report.database.error) {
    lines.push(`Database detail: ${report.database.error}`);
  }
  if (report.netease.error) {
    lines.push(`NetEase detail: ${report.netease.error}`);
  }
  if (report.fishAudio.missing.length > 0) {
    lines.push("FishAudio missing:");
    lines.push(...report.fishAudio.missing.map((item) => `- ${item}`));
  }
  return lines.join("\n");
}

function formatNetEaseStatus(netease: StatusReport["netease"]): string {
  const account = netease.authMode === "account" && netease.cookiePresent
    ? `account-backed, ${netease.qualityLevel}`
    : "anonymous";
  return `${netease.reachable ? "reachable" : "unreachable"} (${account}, ${netease.baseUrl})`;
}

function formatLlmStatus(llm: StatusReport["llm"]): string {
  return [
    llm.provider,
    llm.model,
    llm.baseUrl,
    `key env ${llm.apiKeyEnv}`
  ].filter(Boolean).join(", ");
}

export async function printStatus(): Promise<void> {
  console.log(formatStatusReport(await getStatusReport()));
}

function isPockedioConfig(value: PockedioConfig | StatusReportOptions): value is PockedioConfig {
  return typeof (value as PockedioConfig).netease?.baseUrl === "string";
}
