import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/load.js";
import { saveLlmApiKey } from "../src/config/llmSecrets.js";
import { createLlmClient } from "../src/llm/openaiClient.js";

describe("LLM client config", () => {
  it("reports the configured API key env when unavailable", async () => {
    const config = loadConfig({
      POCKEDIO_HOME: "/tmp/pockedio-llm-client-test",
      OPENAI_API_KEY: undefined,
      DEEPSEEK_API_KEY: undefined
    });
    const client = createLlmClient({
      ...config,
      llm: {
        ...config.llm,
        apiKeyEnv: "DEEPSEEK_API_KEY"
      }
    }, {});

    const result = await client.generateText("hello");

    expect(result).toEqual({
      ok: false,
      errorCode: "llm_unavailable",
      error: "DEEPSEEK_API_KEY is not configured."
    });
  });

  it("uses a locally stored API key when the shell env is missing", async () => {
    const config = loadConfig({ POCKEDIO_HOME: "/tmp/pockedio-llm-local-secret-test" });
    saveLlmApiKey(config, "OPENAI_API_KEY", "local-secret");

    const client = createLlmClient(config, {});

    expect(client.constructor.name).toBe("OpenAiLlmClient");
  });
});
