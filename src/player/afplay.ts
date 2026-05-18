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

export async function playUrl(
  url: string,
  timeoutMs?: number,
  runner: ProcessRunner = runProcess,
  fetchImpl: typeof fetch = fetch
): Promise<PlayerResult> {
  const target = isRemoteUrl(url) ? await downloadRemoteAudio(url, fetchImpl) : url;
  return runner("afplay", [target], timeoutMs);
}

export async function playFile(filePath: string, timeoutMs?: number, runner: ProcessRunner = runProcess): Promise<PlayerResult> {
  return runner("afplay", [filePath], timeoutMs);
}

async function downloadRemoteAudio(url: string, fetchImpl: typeof fetch): Promise<string> {
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
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    let settled = false;
    let timer: NodeJS.Timeout | undefined;

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        child.kill("SIGTERM");
        setTimeout(() => child.kill("SIGKILL"), 1_000).unref();
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
      resolve({
        ok: false,
        target: args[0] ?? "",
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
      resolve({
        ok: exitCode === 0,
        target: args[0] ?? "",
        exitCode,
        signal,
        error: exitCode === 0 ? undefined : stderr.trim() || `Process exited with code ${exitCode ?? "null"}`
      });
    });
  });
}
