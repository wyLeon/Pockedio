import fs from "node:fs";
import path from "node:path";
import {
  getConfigPath,
  getDatabasePath,
  getDjAudioDir,
  getPersonaPath,
  getPockedioHome,
  getTastePath,
  type PockedioEnv
} from "./paths.js";
import { pockedioConfigSchema, type PockedioConfig } from "./schema.js";

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

function defaultConfigInput(env: PockedioEnv): DeepPartial<PockedioConfig> {
  return {
    paths: {
      database: getDatabasePath(env),
      taste: getTastePath(env),
      personas: getPersonaPath(env),
      djAudioDir: getDjAudioDir(env)
    }
  };
}

function mergeConfig(base: unknown, override: unknown): unknown {
  if (!isRecord(base) || !isRecord(override)) {
    return override ?? base;
  }

  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    merged[key] = key in merged ? mergeConfig(merged[key], value) : value;
  }
  return merged;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function loadConfig(env: PockedioEnv = process.env): PockedioConfig {
  const configPath = getConfigPath(env);
  const rawConfig = fs.existsSync(configPath)
    ? JSON.parse(fs.readFileSync(configPath, "utf8")) as unknown
    : {};
  return pockedioConfigSchema.parse(mergeConfig(defaultConfigInput(env), rawConfig));
}

export function saveConfig(config: PockedioConfig, env: PockedioEnv = process.env): void {
  const configPath = getConfigPath(env);
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const validated = pockedioConfigSchema.parse(config);
  fs.writeFileSync(configPath, `${JSON.stringify(validated, null, 2)}\n`);
}

export function ensureRuntimeDirs(config: PockedioConfig, env: PockedioEnv = process.env): void {
  fs.mkdirSync(getPockedioHome(env), { recursive: true });
  fs.mkdirSync(path.dirname(config.paths.database), { recursive: true });
  fs.mkdirSync(path.dirname(config.paths.taste), { recursive: true });
  fs.mkdirSync(path.dirname(config.paths.personas), { recursive: true });
  fs.mkdirSync(config.paths.djAudioDir, { recursive: true });
}
