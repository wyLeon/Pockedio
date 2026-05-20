import { spawn, spawnSync } from "node:child_process";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { downloadRemoteAudio, type PlaybackHandle, type PlayerResult } from "./afplay.js";

export type MpvOptions = {
  command?: string;
  fetchImpl?: typeof fetch;
};

export function isMpvAvailable(command = "mpv"): boolean {
  const result = spawnSync("which", [command], { stdio: "ignore" });
  return result.status === 0;
}

export async function startMpvUrlPlayback(url: string, options: MpvOptions = {}): Promise<PlaybackHandle> {
  const command = options.command ?? "mpv";
  const target = /^https?:\/\//i.test(url) ? await downloadRemoteAudio(url, options.fetchImpl ?? fetch) : url;
  const ipcPath = path.join(os.tmpdir(), `pockedio-mpv-${randomUUID()}.sock`);
  const child = spawn(command, [
    "--no-video",
    "--really-quiet",
    `--input-ipc-server=${ipcPath}`,
    target
  ], { stdio: ["ignore", "ignore", "pipe"] });

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
    resume: () => sendMpvCommand(ipcPath, ["set_property", "pause", false])
  };
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
