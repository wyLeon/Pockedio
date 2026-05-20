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
};

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
  const handle = await startMpvUrlPlayback(url, {
    command: options.command,
    volume: Math.round((options.musicVolume ?? 0.18) * 100)
  });
  const runner = options.runner ?? runProcess;
  let introResult: PlayerResult;
  try {
    introResult = await runner("afplay", [introFilePath], options.introTimeoutMs);
  } finally {
    await handle.setVolume?.(100);
  }
  return {
    ...handle,
    introResult
  };
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
