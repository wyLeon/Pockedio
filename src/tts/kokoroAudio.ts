import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { PockedioConfig } from "../config/schema.js";
import { resolveRuntimePath, type FishAudioResult } from "./fishAudio.js";
import { kokoroVoiceLanguage } from "./voiceSetup.js";

export type KokoroAudioProcessResult = {
  ok: boolean;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  error?: string;
};

export type KokoroAudioProcessRunner = (
  command: string,
  args: string[],
  timeoutMs?: number,
  signal?: AbortSignal
) => Promise<KokoroAudioProcessResult>;

export type KokoroAudioOptions = {
  timeoutMs?: number;
  runner?: KokoroAudioProcessRunner;
  signal?: AbortSignal;
};

const kokoroPythonScript = `
import sys
from kokoro_onnx import Kokoro
import soundfile as sf

model_path, voices_path, voice, lang, text, output_path = sys.argv[1:]
kokoro = Kokoro(model_path, voices_path)
samples, sample_rate = kokoro.create(text, voice=voice, speed=1.0, lang=lang)
sf.write(output_path, samples, sample_rate)
`;

export async function synthesizeKokoroAudio(
  config: PockedioConfig,
  text: string,
  options: KokoroAudioOptions = {}
): Promise<FishAudioResult> {
  const startedAt = Date.now();
  const normalizedText = text.trim();
  if (normalizedText.length === 0) {
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: "Kokoro text is empty."
    };
  }

  const audioPath = path.join(config.paths.djAudioDir, `${Date.now()}-${randomUUID()}.wav`);
  const pythonPath = resolveRuntimePath(config.kokoroAudio.pythonPath);
  const modelPath = resolveRuntimePath(config.kokoroAudio.modelPath);
  const voicesPath = resolveRuntimePath(config.kokoroAudio.voicesPath);
  const runner = options.runner ?? runKokoroAudioProcess;

  fs.mkdirSync(config.paths.djAudioDir, { recursive: true });

  const result = await runner(pythonPath, [
    "-c",
    kokoroPythonScript,
    modelPath,
    voicesPath,
    config.tts.kokoroVoice,
    kokoroVoiceLanguage(config.tts.kokoroVoice),
    normalizedText,
    audioPath
  ], options.timeoutMs, options.signal);

  const latencyMs = Date.now() - startedAt;
  if (!result.ok) {
    return {
      ok: false,
      audioPath,
      latencyMs,
      error: result.error ?? (result.stderr.trim() || `Kokoro exited with code ${result.exitCode ?? "null"}`)
    };
  }

  if (!fs.existsSync(audioPath)) {
    return {
      ok: false,
      audioPath,
      latencyMs,
      error: "Kokoro completed without creating an audio file."
    };
  }

  return {
    ok: true,
    audioPath,
    latencyMs
  };
}

export function runKokoroAudioProcess(
  command: string,
  args: string[],
  timeoutMs = 60_000,
  signal?: AbortSignal
): Promise<KokoroAudioProcessResult> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve({
        ok: false,
        exitCode: null,
        signal: null,
        stdout: "",
        stderr: "",
        error: "Kokoro synthesis was cancelled."
      });
      return;
    }

    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    let forceKillTimer: NodeJS.Timeout | undefined;

    const abort = () => {
      if (settled) {
        return;
      }
      child.kill("SIGTERM");
      forceKillTimer = setTimeout(() => child.kill("SIGKILL"), 1_000);
      forceKillTimer.unref();
    };

    signal?.addEventListener("abort", abort, { once: true });

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        child.kill("SIGTERM");
        forceKillTimer = setTimeout(() => child.kill("SIGKILL"), 1_000);
        forceKillTimer.unref();
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
      if (forceKillTimer) {
        clearTimeout(forceKillTimer);
      }
      signal?.removeEventListener("abort", abort);
      resolve({
        ok: false,
        exitCode: null,
        signal: null,
        stdout,
        stderr,
        error: error.message
      });
    });

    child.on("close", (exitCode, processSignal) => {
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
      signal?.removeEventListener("abort", abort);
      resolve({
        ok: exitCode === 0,
        exitCode,
        signal: processSignal,
        stdout,
        stderr,
        error: exitCode === 0 ? undefined : stderr.trim() || `Process exited with code ${exitCode ?? "null"}`
      });
    });
  });
}
