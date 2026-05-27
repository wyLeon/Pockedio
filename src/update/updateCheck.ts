import fs from "node:fs";
import path from "node:path";
import { getPockedioHome, type PockedioEnv } from "../config/paths.js";

export const pockedioLatestReleaseUrl = "https://api.github.com/repos/wyLeon/Pockedio/releases/latest";
export const updateCacheTtlMs = 24 * 60 * 60 * 1000;

export type UpdateCheckResult = {
  currentVersion: string;
  latestVersion?: string;
  latestTag?: string;
  releaseUrl?: string;
  updateAvailable: boolean;
  checkedAt: string;
  source: "network" | "cache";
  error?: string;
};

export type UpdateCheckOptions = {
  currentVersion: string;
  env?: PockedioEnv;
  fetchImpl?: typeof fetch;
  force?: boolean;
  now?: Date;
  timeoutMs?: number;
};

type CachedUpdateCheck = Omit<UpdateCheckResult, "source">;

type GitHubLatestRelease = {
  tag_name?: unknown;
  html_url?: unknown;
};

export async function checkForPockedioUpdate(options: UpdateCheckOptions): Promise<UpdateCheckResult> {
  const env = options.env ?? process.env;
  const now = options.now ?? new Date();
  const cachePath = getUpdateCheckCachePath(env);
  if (!options.force) {
    const cached = readUsableCache(cachePath, options.currentVersion, now);
    if (cached) {
      return { ...cached, source: "cache" };
    }
  }

  try {
    const latest = await fetchLatestRelease(options.fetchImpl ?? fetch, options.timeoutMs ?? 2500);
    const latestVersion = versionFromTag(latest.tag);
    const result: UpdateCheckResult = {
      currentVersion: options.currentVersion,
      latestVersion,
      latestTag: latest.tag,
      releaseUrl: latest.url,
      updateAvailable: compareVersions(latestVersion, options.currentVersion) > 0,
      checkedAt: now.toISOString(),
      source: "network"
    };
    writeUpdateCache(cachePath, result);
    return result;
  } catch (error) {
    const fallback = readAnyCache(cachePath, options.currentVersion);
    if (fallback) {
      return { ...fallback, source: "cache" };
    }
    return {
      currentVersion: options.currentVersion,
      updateAvailable: false,
      checkedAt: now.toISOString(),
      source: "network",
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export function formatUpdateNotice(result: Pick<UpdateCheckResult, "updateAvailable" | "latestVersion">): string | null {
  if (!result.updateAvailable || !result.latestVersion) {
    return null;
  }
  return `Update available: Pockedio ${result.latestVersion}. Run pockedio update.`;
}

export function getUpdateCheckCachePath(env: PockedioEnv = process.env): string {
  return path.join(getPockedioHome(env), "update-check.json");
}

export function versionFromTag(tag: string): string {
  return tag.trim().replace(/^v/i, "");
}

export function compareVersions(left: string, right: string): number {
  const leftParts = parseVersion(left);
  const rightParts = parseVersion(right);
  for (let index = 0; index < 3; index += 1) {
    const diff = leftParts[index]! - rightParts[index]!;
    if (diff !== 0) {
      return diff > 0 ? 1 : -1;
    }
  }
  return 0;
}

async function fetchLatestRelease(fetchImpl: typeof fetch, timeoutMs: number): Promise<{ tag: string; url?: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(pockedioLatestReleaseUrl, {
      headers: {
        "accept": "application/vnd.github+json",
        "user-agent": "pockedio-update-check"
      },
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`GitHub latest release returned HTTP ${response.status}`);
    }
    const json = await response.json() as GitHubLatestRelease;
    if (typeof json.tag_name !== "string" || json.tag_name.length === 0) {
      throw new Error("GitHub latest release did not include a tag.");
    }
    return {
      tag: json.tag_name,
      url: typeof json.html_url === "string" ? json.html_url : undefined
    };
  } finally {
    clearTimeout(timeout);
  }
}

function readUsableCache(cachePath: string, currentVersion: string, now: Date): CachedUpdateCheck | null {
  const cached = readAnyCache(cachePath, currentVersion);
  if (!cached) {
    return null;
  }
  const checkedAt = Date.parse(cached.checkedAt);
  if (!Number.isFinite(checkedAt) || now.getTime() - checkedAt > updateCacheTtlMs) {
    return null;
  }
  return cached;
}

function readAnyCache(cachePath: string, currentVersion: string): CachedUpdateCheck | null {
  if (!fs.existsSync(cachePath)) {
    return null;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(cachePath, "utf8")) as Partial<CachedUpdateCheck>;
    if (parsed.currentVersion !== currentVersion || typeof parsed.checkedAt !== "string") {
      return null;
    }
    return {
      currentVersion,
      latestVersion: typeof parsed.latestVersion === "string" ? parsed.latestVersion : undefined,
      latestTag: typeof parsed.latestTag === "string" ? parsed.latestTag : undefined,
      releaseUrl: typeof parsed.releaseUrl === "string" ? parsed.releaseUrl : undefined,
      updateAvailable: Boolean(parsed.updateAvailable),
      checkedAt: parsed.checkedAt,
      error: typeof parsed.error === "string" ? parsed.error : undefined
    };
  } catch {
    return null;
  }
}

function writeUpdateCache(cachePath: string, result: UpdateCheckResult): void {
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  const cache: CachedUpdateCheck = {
    currentVersion: result.currentVersion,
    latestVersion: result.latestVersion,
    latestTag: result.latestTag,
    releaseUrl: result.releaseUrl,
    updateAvailable: result.updateAvailable,
    checkedAt: result.checkedAt,
    error: result.error
  };
  fs.writeFileSync(cachePath, `${JSON.stringify(cache, null, 2)}\n`);
}

function parseVersion(version: string): [number, number, number] {
  const match = version.trim().match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  return [
    match?.[1] ? Number(match[1]) : 0,
    match?.[2] ? Number(match[2]) : 0,
    match?.[3] ? Number(match[3]) : 0
  ];
}
