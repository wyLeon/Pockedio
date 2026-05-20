import os from "node:os";
import path from "node:path";

export type PockedioEnv = NodeJS.ProcessEnv;

export function getPockedioHome(env: PockedioEnv = process.env): string {
  return env.POCKEDIO_HOME && env.POCKEDIO_HOME.trim().length > 0
    ? env.POCKEDIO_HOME
    : path.join(os.homedir(), ".pockedio");
}

export function getConfigPath(env: PockedioEnv = process.env): string {
  return path.join(getPockedioHome(env), "config.json");
}

export function getDatabasePath(env: PockedioEnv = process.env): string {
  return path.join(getPockedioHome(env), "pockedio.sqlite");
}

export function getTastePath(env: PockedioEnv = process.env): string {
  return path.join(getPockedioHome(env), "taste.md");
}

export function getPersonaPath(env: PockedioEnv = process.env): string {
  return path.join(getPockedioHome(env), "personas.json");
}

export function getDjAudioDir(env: PockedioEnv = process.env): string {
  return path.join(getPockedioHome(env), "audio", "dj");
}

export function getNetEaseCookiePath(env: PockedioEnv = process.env): string {
  return path.join(getPockedioHome(env), "secrets", "netease.cookie");
}
