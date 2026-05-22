import fs from "node:fs";
import path from "node:path";
import type { PockedioConfig } from "./schema.js";

type LlmSecretsFile = {
  apiKeys?: Record<string, string>;
};

export function readLlmApiKey(config: PockedioConfig, apiKeyEnv: string): string | undefined {
  const secrets = readSecrets(config);
  const value = secrets.apiKeys?.[apiKeyEnv];
  return value && value.trim().length > 0 ? value : undefined;
}

export function saveLlmApiKey(config: PockedioConfig, apiKeyEnv: string, apiKey: string): void {
  const trimmedEnv = apiKeyEnv.trim();
  const trimmedKey = apiKey.trim();
  if (!trimmedEnv) {
    throw new Error("LLM API key env name cannot be empty.");
  }
  if (!trimmedKey) {
    throw new Error("LLM API key cannot be empty.");
  }

  const secrets = readSecrets(config);
  const next: LlmSecretsFile = {
    ...secrets,
    apiKeys: {
      ...(secrets.apiKeys ?? {}),
      [trimmedEnv]: trimmedKey
    }
  };
  fs.mkdirSync(path.dirname(config.paths.llmSecrets), { recursive: true, mode: 0o700 });
  fs.writeFileSync(config.paths.llmSecrets, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(config.paths.llmSecrets, 0o600);
}

export function hasLocalLlmApiKey(config: PockedioConfig, apiKeyEnv: string): boolean {
  return Boolean(readLlmApiKey(config, apiKeyEnv));
}

function readSecrets(config: PockedioConfig): LlmSecretsFile {
  if (!fs.existsSync(config.paths.llmSecrets)) {
    return {};
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(config.paths.llmSecrets, "utf8")) as unknown;
    if (!isRecord(parsed)) {
      return {};
    }
    const apiKeys = isRecord(parsed.apiKeys)
      ? Object.fromEntries(Object.entries(parsed.apiKeys).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
      : undefined;
    return { apiKeys };
  } catch {
    return {};
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
