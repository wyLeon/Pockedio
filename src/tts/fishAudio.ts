import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { PockedioConfig } from "../config/schema.js";

export type FishAudioProcessResult = {
  ok: boolean;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  error?: string;
};

export type FishAudioProcessRunner = (
  command: string,
  args: string[],
  timeoutMs?: number
) => Promise<FishAudioProcessResult>;

export type FishAudioResult =
  | {
      ok: true;
      audioPath: string;
      latencyMs: number;
    }
  | {
      ok: false;
      audioPath?: string;
      latencyMs: number;
      error: string;
    };

export type FishAudioOptions = {
  timeoutMs?: number;
  runner?: FishAudioProcessRunner;
};

export async function synthesizeFishAudio(
  config: PockedioConfig,
  text: string,
  options: FishAudioOptions = {}
): Promise<FishAudioResult> {
  const startedAt = Date.now();
  const normalizedText = text.trim();
  if (normalizedText.length === 0) {
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: "FishAudio text is empty."
    };
  }

  const audioPath = path.join(config.paths.djAudioDir, `${Date.now()}-${randomUUID()}.wav`);
  const pythonPath = resolveRuntimePath(config.fishAudio.pythonPath);
  const scriptPath = resolveRuntimePath(config.fishAudio.scriptPath);
  const modelDir = resolveRuntimePath(config.fishAudio.modelDir);
  const runner = options.runner ?? runFishAudioProcess;

  fs.mkdirSync(config.paths.djAudioDir, { recursive: true });

  const result = await runner(pythonPath, [
    scriptPath,
    "--text",
    normalizedText,
    "--model-dir",
    modelDir,
    "--output",
    audioPath
  ], options.timeoutMs);

  const latencyMs = Date.now() - startedAt;
  if (!result.ok) {
    return {
      ok: false,
      audioPath,
      latencyMs,
      error: result.error ?? (result.stderr.trim() || `FishAudio exited with code ${result.exitCode ?? "null"}`)
    };
  }

  if (!fs.existsSync(audioPath)) {
    return {
      ok: false,
      audioPath,
      latencyMs,
      error: "FishAudio completed without creating an audio file."
    };
  }

  return {
    ok: true,
    audioPath,
    latencyMs
  };
}

export function resolveRuntimePath(value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(process.cwd(), value);
}

export function runFishAudioProcess(
  command: string,
  args: string[],
  timeoutMs = 120_000
): Promise<FishAudioProcessResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timer: NodeJS.Timeout | undefined;

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        child.kill("SIGTERM");
        setTimeout(() => child.kill("SIGKILL"), 1_000).unref();
      }, timeoutMs);
    }

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
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
        exitCode: null,
        signal: null,
        stdout,
        stderr,
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
        exitCode,
        signal,
        stdout,
        stderr,
        error: exitCode === 0 ? undefined : stderr.trim() || `Process exited with code ${exitCode ?? "null"}`
      });
    });
  });
}
