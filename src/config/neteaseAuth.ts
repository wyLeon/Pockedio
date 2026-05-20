import fs from "node:fs";
import path from "node:path";
import type { PockedioConfig } from "./schema.js";

export function readNetEaseCookie(config: PockedioConfig): string | null {
  if (config.netease.authMode !== "account" || !fs.existsSync(config.paths.neteaseCookie)) {
    return null;
  }

  const cookie = fs.readFileSync(config.paths.neteaseCookie, "utf8").trim();
  return cookie.length > 0 ? cookie : null;
}

export function saveNetEaseCookie(config: PockedioConfig, cookie: string): void {
  const normalized = normalizeNetEaseCookie(cookie);
  fs.mkdirSync(path.dirname(config.paths.neteaseCookie), { recursive: true });
  fs.writeFileSync(config.paths.neteaseCookie, `${normalized}\n`, { mode: 0o600 });
  fs.chmodSync(config.paths.neteaseCookie, 0o600);
}

export function clearNetEaseCookie(config: PockedioConfig): void {
  fs.rmSync(config.paths.neteaseCookie, { force: true });
}

export function normalizeNetEaseCookie(cookie: string): string {
  const trimmed = cookie.trim();
  if (!trimmed) {
    throw new Error("NetEase cookie is empty.");
  }
  if (trimmed.includes("MUSIC_U=")) {
    return trimmed;
  }
  return `MUSIC_U=${trimmed}`;
}
