import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type PlayerResult = {
  ok: boolean;
  target: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  error?: string;
};

export type ProcessRunner = (command: string, args: string[], timeoutMs?: number) => Promise<PlayerResult>;

export type PlaybackHandle = {
  target: string;
  done: Promise<PlayerResult>;
  stop: () => void;
  pause?: () => Promise<boolean> | boolean;
  resume?: () => Promise<boolean> | boolean;
  introResult?: PlayerResult;
};

export type ProcessStarter = (command: string, args: string[], timeoutMs?: number) => PlaybackHandle;

export type DuckedIntroOptions = {
  musicVolume?: number;
  introTimeoutMs?: number;
  starter?: ProcessStarter;
  runner?: ProcessRunner;
  fetchImpl?: typeof fetch;
};

export async function playUrl(
  url: string,
  timeoutMs?: number,
  runner: ProcessRunner = runProcess,
  fetchImpl: typeof fetch = fetch
): Promise<PlayerResult> {
  const handle = await startUrlPlayback(url, timeoutMs, starterFromRunner(runner), fetchImpl);
  return handle.done;
}

export async function startUrlPlayback(
  url: string,
  timeoutMs?: number,
  starter: ProcessStarter = startProcess,
  fetchImpl: typeof fetch = fetch
): Promise<PlaybackHandle> {
  const target = isRemoteUrl(url) ? await downloadRemoteAudio(url, fetchImpl) : url;
  return starter("afplay", [target], timeoutMs);
}

export async function startDuckedUrlWithIntro(
  url: string,
  introFilePath: string,
  options: DuckedIntroOptions = {}
): Promise<PlaybackHandle> {
  const starter = options.starter ?? startProcess;
  const runner = options.runner ?? runProcess;
  const target = isRemoteUrl(url) ? await downloadRemoteAudio(url, options.fetchImpl ?? fetch) : url;
  const quietHandle = starter("afplay", ["-v", String(options.musicVolume ?? 0.18), target]);
  let introResult: PlayerResult;
  try {
    introResult = await runner("afplay", [introFilePath], options.introTimeoutMs);
  } finally {
    quietHandle.stop();
  }
  return {
    ...starter("afplay", [target]),
    introResult
  };
}

export async function playFile(filePath: string, timeoutMs?: number, runner: ProcessRunner = runProcess): Promise<PlayerResult> {
  return runner("afplay", [filePath], timeoutMs);
}

export async function downloadRemoteAudio(url: string, fetchImpl: typeof fetch): Promise<string> {
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`Audio download failed with HTTP ${response.status}.`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const filePath = path.join(os.tmpdir(), `pockedio-playback-${randomUUID()}${extensionForResponse(url, response)}`);
  fs.writeFileSync(filePath, bytes);
  return filePath;
}

function isRemoteUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function extensionForResponse(url: string, response: Response): string {
  const pathname = new URL(url).pathname;
  const ext = path.extname(pathname);
  if (ext) {
    return ext;
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("mpeg") || contentType.includes("mp3")) {
    return ".mp3";
  }
  if (contentType.includes("wav")) {
    return ".wav";
  }
  if (contentType.includes("aac")) {
    return ".aac";
  }
  if (contentType.includes("mp4") || contentType.includes("m4a")) {
    return ".m4a";
  }
  return ".audio";
}

export function runProcess(command: string, args: string[], timeoutMs = 0): Promise<PlayerResult> {
  return startProcess(command, args, timeoutMs).done;
}

export function startProcess(command: string, args: string[], timeoutMs = 0): PlaybackHandle {
  const target = args.at(-1) ?? "";
  const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
  let settled = false;
  let timer: NodeJS.Timeout | undefined;
  let forceKillTimer: NodeJS.Timeout | undefined;

  const done = new Promise<PlayerResult>((resolve) => {
    let stderr = "";

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        child.kill("SIGTERM");
        forceKillTimer = setTimeout(() => child.kill("SIGKILL"), 1_000);
        forceKillTimer.unref();
      }, timeoutMs);
    }

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer) {
        clearTimeout(timer);
      }
      if (forceKillTimer) {
        clearTimeout(forceKillTimer);
      }
      resolve({
        ok: false,
        target,
        exitCode: null,
        signal: null,
        error: error.message
      });
    });

    child.on("close", (exitCode, signal) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer) {
        clearTimeout(timer);
      }
      if (forceKillTimer) {
        clearTimeout(forceKillTimer);
      }
      resolve({
        ok: exitCode === 0,
        target,
        exitCode,
        signal,
        error: exitCode === 0 ? undefined : stderr.trim() || `Process exited with code ${exitCode ?? "null"}`
      });
    });
  });

  return {
    target,
    done,
    stop: () => {
      if (settled) {
        return;
      }
      child.kill("SIGTERM");
      forceKillTimer = setTimeout(() => child.kill("SIGKILL"), 1_000);
      forceKillTimer.unref();
    }
  };
}

function starterFromRunner(runner: ProcessRunner): ProcessStarter {
  return (command, args, timeoutMs) => ({
    target: args[0] ?? "",
    done: runner(command, args, timeoutMs),
    stop: () => undefined
  });
}
