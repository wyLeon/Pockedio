import { spawn, spawnSync } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { runProcess, type PlaybackHandle, type PlayerResult, type ProcessRunner } from "./afplay.js";

export type MpvOptions = {
  command?: string;
  volume?: number;
};

export type MpvDuckedIntroOptions = MpvOptions & {
  musicVolume?: number;
  introTimeoutMs?: number;
  runner?: ProcessRunner;
  fadeDurationMs?: number;
  fadeSteps?: number;
  sleep?: (ms: number) => Promise<void>;
};

const DEFAULT_DUCKED_MUSIC_VOLUME = 0.18;
const DEFAULT_DUCKED_FADE_DURATION_MS = 1_000;
const DEFAULT_DUCKED_FADE_STEPS = 6;

export function isMpvAvailable(command = "mpv"): boolean {
  const result = spawnSync("which", [command], { stdio: "ignore" });
  return result.status === 0;
}

export async function startMpvUrlPlayback(url: string, options: MpvOptions = {}): Promise<PlaybackHandle> {
  const command = options.command ?? "mpv";
  const target = url;
  const ipcPath = createMpvIpcPath();
  const child = spawn(command, buildMpvArgs(target, ipcPath, options.volume), { stdio: ["ignore", "ignore", "pipe"] });

  let settled = false;
  let stderr = "";

  const done = new Promise<PlayerResult>((resolve) => {
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
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
      if (!settled) {
        child.kill("SIGTERM");
      }
    },
    pause: () => sendMpvCommand(ipcPath, ["set_property", "pause", true]),
    resume: () => sendMpvCommand(ipcPath, ["set_property", "pause", false]),
    setVolume: (volume) => sendMpvCommand(ipcPath, ["set_property", "volume", volume])
  };
}

export async function startMpvDuckedUrlWithIntro(
  url: string,
  introFilePath: string,
  options: MpvDuckedIntroOptions = {}
): Promise<PlaybackHandle> {
  const musicVolume = Math.round((options.musicVolume ?? DEFAULT_DUCKED_MUSIC_VOLUME) * 100);
  const handle = await startMpvUrlPlayback(url, {
    command: options.command,
    volume: musicVolume
  });
  const runner = options.runner ?? runProcess;
  let introResult: PlayerResult;
  try {
    introResult = await runner("afplay", [introFilePath], options.introTimeoutMs);
  } finally {
    const faded = await fadePlaybackVolume(handle, musicVolume, 100, {
      durationMs: options.fadeDurationMs,
      steps: options.fadeSteps,
      sleep: options.sleep
    });
    if (!faded) {
      await handle.setVolume?.(100);
    }
  }
  return {
    ...handle,
    introResult
  };
}

export async function fadePlaybackVolume(
  handle: PlaybackHandle,
  fromVolume: number,
  toVolume: number,
  options: {
    durationMs?: number;
    steps?: number;
    sleep?: (ms: number) => Promise<void>;
  } = {}
): Promise<boolean> {
  if (!handle.setVolume) {
    return false;
  }

  const steps = Math.max(1, Math.floor(options.steps ?? DEFAULT_DUCKED_FADE_STEPS));
  const durationMs = Math.max(0, options.durationMs ?? DEFAULT_DUCKED_FADE_DURATION_MS);
  const intervalMs = durationMs / steps;
  const sleep = options.sleep ?? delay;
  for (let step = 1; step <= steps; step += 1) {
    if (intervalMs > 0) {
      await sleep(intervalMs);
    }
    const nextVolume = Math.round(fromVolume + ((toVolume - fromVolume) * step) / steps);
    const ok = await handle.setVolume(nextVolume);
    if (!ok) {
      return false;
    }
  }
  return true;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function buildMpvArgs(target: string, ipcPath: string, volume?: number): string[] {
  const args = [
    "--no-video",
    "--really-quiet",
    `--input-ipc-server=${ipcPath}`,
    ...(volume === undefined ? [] : [`--volume=${volume}`]),
    target
  ];
  return args;
}

export function createMpvIpcPath(): string {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  return process.platform === "win32"
    ? `\\\\.\\pipe\\pockedio-mpv-${suffix}`
    : path.join("/tmp", `pockedio-mpv-${suffix}.sock`);
}

async function sendMpvCommand(ipcPath: string, command: unknown[]): Promise<boolean> {
  const deadline = Date.now() + 1_000;
  while (Date.now() <= deadline) {
    if (await trySendMpvCommand(ipcPath, command)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

function trySendMpvCommand(ipcPath: string, command: unknown[]): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection(ipcPath);
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve(ok);
    };

    socket.on("connect", () => {
      socket.write(`${JSON.stringify({ command })}\n`, () => finish(true));
    });
    socket.on("error", () => finish(false));
    socket.setTimeout(500, () => finish(false));
  });
}
