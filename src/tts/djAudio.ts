import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { PockedioConfig } from "../config/schema.js";
import { runProcess } from "../player/afplay.js";
import {
  resolveRuntimePath,
  synthesizeFishAudio,
  type FishAudioOptions,
  type FishAudioProcessRunner,
  type FishAudioResult
} from "./fishAudio.js";
import { buildMacosVoicePreview } from "./voiceSetup.js";

export type DjAudioProcessResult = {
  ok: boolean;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout?: string;
  stderr?: string;
  error?: string;
};

export type DjAudioProcessRunner = (
  command: string,
  args: string[],
  timeoutMs?: number,
  signal?: AbortSignal
) => Promise<DjAudioProcessResult>;

export type DjAudioOptions = Omit<FishAudioOptions, "runner"> & {
  platform?: NodeJS.Platform;
  runner?: DjAudioProcessRunner;
  fishRunner?: FishAudioProcessRunner;
};

export async function synthesizeDjAudio(
  config: PockedioConfig,
  text: string,
  options: DjAudioOptions = {}
): Promise<FishAudioResult> {
  const provider = config.tts.provider;
  if (provider === "text") {
    return failed(Date.now(), "Text-only DJ copy is selected.");
  }

  if (provider === "fish" || shouldUseFishInAuto(config, provider)) {
    return synthesizeFishAudio(config, text, {
      timeoutMs: options.timeoutMs,
      runner: options.fishRunner,
      signal: options.signal
    });
  }

  if (provider === "macos" || shouldUseMacosInAuto(provider, options.platform ?? process.platform)) {
    return synthesizeMacosDjAudio(config, text, options);
  }

  return failed(Date.now(), "No local TTS provider is available.");
}

async function synthesizeMacosDjAudio(
  config: PockedioConfig,
  text: string,
  options: DjAudioOptions
): Promise<FishAudioResult> {
  const startedAt = Date.now();
  const normalizedText = text.trim();
  if (normalizedText.length === 0) {
    return failed(startedAt, "macOS TTS text is empty.");
  }

  const platform = options.platform ?? process.platform;
  if (platform !== "darwin") {
    return failed(startedAt, "macOS TTS is only available on macOS.");
  }

  const preview = buildMacosVoicePreview(config.tts.macosVoice);
  const sayVoice = preview.args[1] ?? "Samantha";
  const audioPath = path.join(config.paths.djAudioDir, `${Date.now()}-${randomUUID()}.aiff`);
  const runner = options.runner ?? runDjAudioProcess;

  fs.mkdirSync(config.paths.djAudioDir, { recursive: true });

  const result = await runner("say", ["-v", sayVoice, "-o", audioPath, normalizedText], options.timeoutMs, options.signal);
  const latencyMs = Date.now() - startedAt;
  if (!result.ok) {
    return {
      ok: false,
      audioPath,
      latencyMs,
      error: result.error ?? result.stderr?.trim() ?? `macOS TTS exited with code ${result.exitCode ?? "null"}`
    };
  }

  if (!fs.existsSync(audioPath)) {
    return {
      ok: false,
      audioPath,
      latencyMs,
      error: "macOS TTS completed without creating an audio file."
    };
  }

  return {
    ok: true,
    audioPath,
    latencyMs
  };
}

function shouldUseFishInAuto(config: PockedioConfig, provider: PockedioConfig["tts"]["provider"]): boolean {
  if (provider !== "auto") {
    return false;
  }
  const referenceAudioPath = config.fishAudio.referenceAudioPath
    ? resolveRuntimePath(config.fishAudio.referenceAudioPath)
    : undefined;
  return Boolean(referenceAudioPath && config.fishAudio.referenceText?.trim() && fs.existsSync(referenceAudioPath));
}

function shouldUseMacosInAuto(provider: PockedioConfig["tts"]["provider"], platform: NodeJS.Platform): boolean {
  return provider === "auto" && platform === "darwin";
}

async function runDjAudioProcess(
  command: string,
  args: string[],
  timeoutMs?: number
): Promise<DjAudioProcessResult> {
  const result = await runProcess(command, args, timeoutMs);
  return {
    ok: result.ok,
    exitCode: result.exitCode,
    signal: result.signal,
    error: result.error
  };
}

function failed(startedAt: number, error: string): FishAudioResult {
  return {
    ok: false,
    latencyMs: Date.now() - startedAt,
    error
  };
}
