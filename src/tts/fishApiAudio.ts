import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { encode } from "@msgpack/msgpack";
import { ProxyAgent } from "undici";
import { readLlmApiKey } from "../config/llmSecrets.js";
import type { PockedioConfig } from "../config/schema.js";
import type { FishAudioResult } from "./fishAudio.js";
import { buildFishVoicePreview } from "./voiceSetup.js";

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

  const voiceReference = getFishApiVoiceReference(config);
  if (!voiceReference) {
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
    const requestBody = buildFishApiRequestBody(config, normalizedText, voiceReference);
    const response = await (options.fetchImpl ?? fetch)(`${config.fishApi.baseUrl.replace(/\/$/, "")}/v1/tts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": requestBody.contentType,
        model: config.fishApi.model
      },
      body: requestBody.body,
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

type FishApiVoiceReference =
  | { type: "audio"; references: Array<{ audio: Buffer; text: string }> }
  | { type: "id"; referenceId: string };

function getFishApiVoiceReference(config: PockedioConfig): FishApiVoiceReference | undefined {
  const pockedioHome = getPockedioHomeFromConfig(config);
  const preview = buildFishVoicePreview(config.tts.fishVoice, getPockedioHomeFromConfig(config));
  const referencePath = preview.args[0];
  if (referencePath && fs.existsSync(referencePath)) {
    const references = [{
      audio: fs.readFileSync(referencePath),
      text: preview.sampleText
    }];
    const secondaryMinaReferencePath = path.join(pockedioHome, "audio", "previews", "mina-fish-ref.wav");
    if (config.tts.fishVoice === "mina" && fs.existsSync(secondaryMinaReferencePath)) {
      references.push({
        audio: fs.readFileSync(secondaryMinaReferencePath),
        text: "Mina is here. Soft lights, warm songs, and room to breathe."
      });
    }
    return {
      type: "audio",
      references
    };
  }
  const referenceId = getFishApiReferenceId(config);
  return referenceId ? { type: "id", referenceId } : undefined;
}

function getPockedioHomeFromConfig(config: PockedioConfig): string {
  return path.dirname(path.dirname(config.paths.djAudioDir));
}

function buildFishApiRequestBody(
  config: PockedioConfig,
  text: string,
  voiceReference: FishApiVoiceReference
): { contentType: "application/json"; body: string } | { contentType: "application/msgpack"; body: Buffer } {
  const basePayload = {
    text: formatFishApiSynthesisText(config, text, voiceReference),
    format: config.fishApi.format,
    latency: config.fishApi.latency,
    chunk_length: config.fishApi.chunkLength
  };
  if (voiceReference.type === "audio") {
    return {
      contentType: "application/msgpack",
      body: Buffer.from(encode({
        ...basePayload,
        references: voiceReference.references
      }))
    };
  }
  return {
    contentType: "application/json",
    body: JSON.stringify({
      ...basePayload,
      reference_id: voiceReference.referenceId
    })
  };
}

function formatFishApiSynthesisText(config: PockedioConfig, text: string, voiceReference: FishApiVoiceReference): string {
  if (voiceReference.type === "audio" && config.tts.fishVoice === "mina") {
    return `[soft young voice][warm tone][low volume] ${text}`;
  }
  return text;
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
