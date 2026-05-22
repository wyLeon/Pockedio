export type LlmPresetConfig = {
  model: string;
  baseUrl?: string;
  apiKeyEnv: string;
};

export function formatLlmPresetPreview(label: string, llm: LlmPresetConfig, env: NodeJS.ProcessEnv = process.env): string {
  const keyPresent = Boolean(env[llm.apiKeyEnv]);
  return [
    `LLM preset: ${label}`,
    "",
    `Model      ${llm.model}`,
    `Base URL   ${llm.baseUrl ?? "OpenAI default"}`,
    `API key    ${llm.apiKeyEnv} (${keyPresent ? "present" : "missing"})`,
    "",
    "Pockedio first reads the API key from the shell, then falls back to a local secret saved from this setup screen.",
    "This preset only saves provider settings. Choose Paste API key if you want Pockedio to store the key locally.",
    "",
    keyPresent
      ? "Your current shell already has this key. After saving, choose Test connection."
      : "Before starting a DJ session, paste the key here or add it to your shell and restart Pockedio.",
    keyPresent ? "" : "Direct setup: choose Paste API key from the LLM screen.",
    keyPresent ? "" : `Temporary for this terminal: export ${llm.apiKeyEnv}=sk-...`,
    keyPresent ? "" : `Persistent zsh setup: echo 'export ${llm.apiKeyEnv}=sk-...' >> ~/.zshrc && source ~/.zshrc`
  ].filter(Boolean).join("\n");
}

export function formatLlmPresetSaved(label: string, llm: LlmPresetConfig, env: NodeJS.ProcessEnv = process.env): string {
  const keyPresent = Boolean(env[llm.apiKeyEnv]);
  return [
    `Saved LLM preset: ${label}`,
    "",
    keyPresent
      ? `${llm.apiKeyEnv} is present in this shell. Choose Test connection to verify the provider.`
      : `${llm.apiKeyEnv} is still missing in this shell.`,
    keyPresent ? "" : "Pockedio can use this provider after you paste the key here or make it available to the process.",
    keyPresent ? "" : "Direct setup: choose Paste API key from the LLM screen.",
    keyPresent ? "" : `Temporary for this terminal: export ${llm.apiKeyEnv}=sk-...`,
    keyPresent ? "" : `Persistent zsh setup: echo 'export ${llm.apiKeyEnv}=sk-...' >> ~/.zshrc && source ~/.zshrc`,
    keyPresent ? "" : "After setting it, restart Pockedio and choose Test connection."
  ].filter(Boolean).join("\n");
}
