import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ProxyAgent } from "undici";
import { readLlmApiKey } from "../config/llmSecrets.js";
import type { PockedioConfig } from "../config/schema.js";
import type { FishAudioResult } from "./fishAudio.js";

export type FishApiFetch = typeof fetch;

export type FishApiAudioOptions = {
  timeoutMs?: number;
  signal?: AbortSignal;
  fetchImpl?: FishApiFetch;
  env?: NodeJS.ProcessEnv;
};

export async function synthesizeFishApiAudio(
  config: PockedioConfig,
  text: string,
  options: FishApiAudioOptions = {}
): Promise<FishAudioResult> {
  const startedAt = Date.now();
  const normalizedText = text.trim();
  if (normalizedText.length === 0) {
    return failed(startedAt, "Fish API text is empty.");
  }

  const env = options.env ?? process.env;
  const apiKey = env[config.fishApi.apiKeyEnv]?.trim() || readLlmApiKey(config, config.fishApi.apiKeyEnv);
  if (!apiKey) {
    return failed(startedAt, `Fish API key is missing: ${config.fishApi.apiKeyEnv}.`);
  }

  const referenceId = getFishApiReferenceId(config);
  if (!referenceId) {
    return failed(startedAt, `Fish Audio Cloud voice is not configured for ${config.tts.fishVoice}.`);
  }

  const audioPath = path.join(config.paths.djAudioDir, `${Date.now()}-${randomUUID()}.${config.fishApi.format}`);
  fs.mkdirSync(config.paths.djAudioDir, { recursive: true });

  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? 120_000;
  let timer: NodeJS.Timeout | undefined;
  const abort = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) {
    return failed(startedAt, "Fish API synthesis was cancelled.");
  }
  options.signal?.addEventListener("abort", abort, { once: true });
  if (timeoutMs > 0) {
    timer = setTimeout(() => controller.abort(new Error("Fish API synthesis timed out.")), timeoutMs);
    timer.unref();
  }

  try {
    const response = await (options.fetchImpl ?? fetch)(`${config.fishApi.baseUrl.replace(/\/$/, "")}/v1/tts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        model: config.fishApi.model
      },
      body: JSON.stringify({
        text: normalizedText,
        reference_id: referenceId,
        format: config.fishApi.format,
        latency: config.fishApi.latency,
        chunk_length: config.fishApi.chunkLength
      }),
      signal: controller.signal,
      ...fishApiProxyOptions(config, env)
    } as RequestInit);

    const latencyMs = Date.now() - startedAt;
    if (!response.ok) {
      return {
        ok: false,
        latencyMs,
        error: `Fish API returned HTTP ${response.status}: ${await safeErrorBody(response)}`
      };
    }

    const audio = Buffer.from(await response.arrayBuffer());
    if (audio.length === 0) {
      return {
        ok: false,
        latencyMs,
        error: "Fish API completed without returning audio bytes."
      };
    }

    fs.writeFileSync(audioPath, audio);
    return {
      ok: true,
      audioPath,
      latencyMs
    };
  } catch (error) {
    return failed(startedAt, error instanceof Error ? error.message : "Fish API synthesis failed.");
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
    options.signal?.removeEventListener("abort", abort);
  }
}

export function getFishApiReferenceId(config: PockedioConfig): string | undefined {
  return config.fishApi.referenceIds[config.tts.fishVoice]?.trim();
}

function fishApiProxyOptions(config: PockedioConfig, env: NodeJS.ProcessEnv): Partial<RequestInit> {
  const proxyUrl = env[config.fishApi.proxyEnv]?.trim();
  if (!proxyUrl) {
    return {};
  }
  return {
    dispatcher: new ProxyAgent(proxyUrl)
  } as Partial<RequestInit>;
}

async function safeErrorBody(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.trim().slice(0, 300) || response.statusText || "request failed";
  } catch {
    return response.statusText || "request failed";
  }
}

function failed(startedAt: number, error: string): FishAudioResult {
  return {
    ok: false,
    latencyMs: Date.now() - startedAt,
    error
  };
}
