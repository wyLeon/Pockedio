import { describe, expect, it } from "vitest";
import { formatLlmPresetPreview, formatLlmPresetSaved } from "../src/llm/setupGuidance.js";

describe("LLM setup guidance", () => {
  it("explains missing API key setup with concrete shell commands", () => {
    const text = formatLlmPresetPreview("OpenAI", {
      model: "gpt-4.1-mini",
      apiKeyEnv: "OPENAI_API_KEY"
    }, {});

    expect(text).toContain("API key    OPENAI_API_KEY (missing)");
    expect(text).toContain("Choose Paste API key if you want Pockedio to store the key locally");
    expect(text).toContain("Direct setup: choose Paste API key from the LLM screen.");
    expect(text).toContain("Temporary for this terminal: export OPENAI_API_KEY=sk-...");
    expect(text).toContain("Persistent zsh setup: echo 'export OPENAI_API_KEY=sk-...' >> ~/.zshrc && source ~/.zshrc");
  });

  it("tells users to test connection when the configured key is present", () => {
    const text = formatLlmPresetSaved("DeepSeek", {
      model: "deepseek-chat",
      baseUrl: "https://api.deepseek.com",
      apiKeyEnv: "DEEPSEEK_API_KEY"
    }, { DEEPSEEK_API_KEY: "present" });

    expect(text).toContain("DEEPSEEK_API_KEY is present");
    expect(text).toContain("Choose Test connection");
    expect(text).not.toContain("export DEEPSEEK_API_KEY");
  });
});
