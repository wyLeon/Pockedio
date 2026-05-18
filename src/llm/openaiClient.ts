import OpenAI from "openai";
import type { PockedioConfig } from "../config/schema.js";
import type { LlmClient, LlmResult } from "./llmClient.js";
import { UnavailableLlmClient } from "./llmClient.js";

export function createLlmClient(config: PockedioConfig, env: NodeJS.ProcessEnv = process.env): LlmClient {
  const apiKey = env[config.llm.apiKeyEnv];
  if (!apiKey) {
    return new UnavailableLlmClient();
  }

  return new OpenAiLlmClient(config, apiKey);
}

export class OpenAiLlmClient implements LlmClient {
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(config: PockedioConfig, apiKey: string) {
    this.client = new OpenAI({ apiKey, baseURL: config.llm.baseUrl });
    this.model = config.llm.model;
  }

  async generateJson<T = unknown>(prompt: string, schemaDescription: string): Promise<LlmResult<T>> {
    try {
      const completion = await this.client.chat.completions.create({
        model: this.model,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: [
              "You are Pockedio's music planning engine.",
              "Return JSON only.",
              "Never include raw diary text; use only summarized diary context when provided.",
              `Schema: ${schemaDescription}`
            ].join(" ")
          },
          { role: "user", content: prompt }
        ]
      });
      const content = completion.choices[0]?.message.content;
      if (!content) {
        return { ok: false, errorCode: "llm_error", error: "OpenAI returned empty content." };
      }
      return { ok: true, value: JSON.parse(content) as T };
    } catch (error) {
      if (error instanceof SyntaxError) {
        return { ok: false, errorCode: "invalid_json", error: error.message };
      }
      return {
        ok: false,
        errorCode: "llm_error",
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  async generateText(prompt: string): Promise<LlmResult<string>> {
    try {
      const completion = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: "system",
            content: "You are Pockedio, a concise English-first personal DJ. Do not expose raw diary text."
          },
          { role: "user", content: prompt }
        ]
      });
      const content = completion.choices[0]?.message.content;
      if (!content) {
        return { ok: false, errorCode: "llm_error", error: "OpenAI returned empty content." };
      }
      return { ok: true, value: content };
    } catch (error) {
      return {
        ok: false,
        errorCode: "llm_error",
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
}
