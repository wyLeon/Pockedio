import fs from "node:fs";
import Database from "better-sqlite3";
import { loadConfig } from "../config/load.js";
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
    error?: string;
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
  const configStatus = {
    path: getConfigPath(env),
    present: fs.existsSync(getConfigPath(env))
  };
  const database = getDatabaseStatus(config);
  const baseReport = {
    config: configStatus,
    database,
    fishAudio,
    calendar: {
      enabled: config.calendar.enabled
    },
    weather: {
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
        baseUrl: config.netease.baseUrl,
        reachable: true
      }
    };
  } catch (error) {
    return {
      ...baseReport,
      netease: {
        baseUrl: config.netease.baseUrl,
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

export function formatStatusReport(report: StatusReport): string {
  const lines = [
    "Pockedio status",
    `Config: ${report.config.present ? "present" : "missing"} (${report.config.path})`,
    `Database: ${report.database.migrated ? "migrated" : report.database.present ? "not migrated" : "missing"} (${report.database.path})`,
    `NetEase API: ${report.netease.reachable ? "reachable" : "unreachable"} (${report.netease.baseUrl})`,
    `FishAudio: ${report.fishAudio.pathsPresent ? "paths present" : "missing paths"}`,
    `Calendar: ${report.calendar.enabled ? "enabled" : "disabled"}`,
    `Weather: ${report.weather.location}`,
    `taste.md: ${report.taste.present ? "present" : "missing"} (${report.taste.path})`,
    `Personas: ${report.personas.present ? "present" : "missing"} (${report.personas.path})`,
    `Latest session: ${report.latestSessionTimestamp ?? "none"}`
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

export async function printStatus(): Promise<void> {
  console.log(formatStatusReport(await getStatusReport()));
}

function isPockedioConfig(value: PockedioConfig | StatusReportOptions): value is PockedioConfig {
  return typeof (value as PockedioConfig).netease?.baseUrl === "string";
}
