import fs from "node:fs";
import readline from "node:readline";
import type { PockedioEnv } from "../config/paths.js";
import type { PockedioConfig } from "../config/schema.js";
import { readNetEaseCookie } from "../config/neteaseAuth.js";
import { hasLocalLlmApiKey } from "../config/llmSecrets.js";
import type { TasteImportResult } from "../taste/importTaste.js";
import { formatFishVoiceName, formatMacosVoiceName } from "../tts/voiceSetup.js";

export type WelcomeReadinessItem = {
  label: "Music" | "LLM" | "Voice" | "Taste" | "Calendar";
  value: string;
  ok: boolean;
};

export type WelcomeReadiness = {
  items: WelcomeReadinessItem[];
};

export type WelcomeHubAction = "session" | "setup" | "llm_setup" | "voice_setup" | "taste" | "status" | "quit";
export type SetupConnectionsAction = "full_setup" | "llm_setup" | "voice_setup" | "netease_setup" | "calendar_setup" | "back" | "quit";
export type LlmProviderId = "openai" | "deepseek" | "openrouter" | "local_vllm" | "custom";
export type LlmSetupAction = LlmProviderId | "test_connection" | "back" | "quit";
export type LlmProviderAction = "paste_key" | "use_shell_env" | "change_model" | "change_base_url" | "change_api_key_env" | "check_server" | "discover_models" | "test_connection" | "back" | "quit";
export type VoiceSetupAction = "preview" | "choose_builtin" | "fish_tts" | "text_only" | "back" | "quit";
export type TasteMemoryAction = "import" | "rebuild_profile" | "show_summary" | "start_station" | "back" | "quit";

export type DefaultEntryMode = "hub" | "session";

export type DefaultEntryModeInput = {
  stdinIsTty?: boolean;
  stdoutIsTty?: boolean;
  forceSession?: boolean;
  noHub?: boolean;
};

export type SelectableKeyInput = Pick<readline.Key, "name" | "ctrl">;

export type SelectableKeyResult<TAction extends string> = {
  selectedAction: TAction;
  submittedAction?: TAction;
};

export type WelcomeReadinessOptions = {
  config: PockedioConfig;
  env?: PockedioEnv;
  platform?: NodeJS.Platform;
};

const welcomeHubEntries: Array<{ action: WelcomeHubAction; label: string; description: string }> = [
  { action: "session", label: "Enter DJ Session", description: "Talk, ask, play, reshape, queue, DJ mode" },
  { action: "setup", label: "Setup & Connections", description: "Music, LLM, voice, calendar, weather, diary" },
  { action: "taste", label: "Taste & Memory", description: "Import taste, review personalization inputs" },
  { action: "status", label: "Status", description: "Playback, scheduler, health, version" }
];

const setupConnectionsEntries: Array<{ action: SetupConnectionsAction; label: string }> = [
  { action: "full_setup", label: "Run full setup" },
  { action: "llm_setup", label: "Configure LLM" },
  { action: "voice_setup", label: "Configure Voice" },
  { action: "netease_setup", label: "Configure NetEase" },
  { action: "calendar_setup", label: "Configure Calendar" },
  { action: "back", label: "Back" }
];

const llmSetupEntries: Array<{ action: LlmSetupAction; label: string; description: string }> = [
  { action: "openai", label: "Use OpenAI", description: "gpt-4.1-mini, OPENAI_API_KEY, OpenAI default URL" },
  { action: "deepseek", label: "Use DeepSeek", description: "deepseek-chat, DEEPSEEK_API_KEY, https://api.deepseek.com" },
  { action: "openrouter", label: "Use OpenRouter", description: "OpenRouter model, OPENROUTER_API_KEY, https://openrouter.ai/api/v1" },
  { action: "local_vllm", label: "Use local vLLM", description: "OpenAI-compatible local server, no hosted provider required" },
  { action: "custom", label: "Custom OpenAI-compatible", description: "Set model, base URL, and API key env manually" },
  { action: "test_connection", label: "Test current setup", description: "Make a minimal LLM call with the current config" },
  { action: "back", label: "Back", description: "Return to Setup & Connections" }
];

const hostedLlmProviderEntries: Array<{ action: LlmProviderAction; label: string }> = [
  { action: "paste_key", label: "Paste API key" },
  { action: "use_shell_env", label: "Use shell env" },
  { action: "change_model", label: "Change model" },
  { action: "test_connection", label: "Test connection" },
  { action: "back", label: "Back" }
];

const customLlmProviderEntries: Array<{ action: LlmProviderAction; label: string }> = [
  { action: "paste_key", label: "Paste API key" },
  { action: "use_shell_env", label: "Use shell env" },
  { action: "change_model", label: "Change model" },
  { action: "change_base_url", label: "Change base URL" },
  { action: "change_api_key_env", label: "Set API key env" },
  { action: "test_connection", label: "Test connection" },
  { action: "back", label: "Back" }
];

const localVllmProviderEntries: Array<{ action: LlmProviderAction; label: string }> = [
  { action: "check_server", label: "Check server" },
  { action: "discover_models", label: "Discover models" },
  { action: "paste_key", label: "Paste API key" },
  { action: "change_model", label: "Set model manually" },
  { action: "change_base_url", label: "Set base URL" },
  { action: "back", label: "Back" }
];

const voiceSetupEntries: Array<{ action: VoiceSetupAction; label: string }> = [
  { action: "preview", label: "Preview voices" },
  { action: "choose_builtin", label: "Choose built-in voice" },
  { action: "fish_tts", label: "Configure Fish TTS" },
  { action: "text_only", label: "Use text-only DJ copy" },
  { action: "back", label: "Back" }
];

const tasteMemoryEntries: Array<{ action: TasteMemoryAction; label: string }> = [
  { action: "import", label: "Import playlist or taste file" },
  { action: "rebuild_profile", label: "Rebuild taste profile" },
  { action: "show_summary", label: "Show taste summary" },
  { action: "start_station", label: "Start station from latest import" },
  { action: "back", label: "Back" }
];

export function buildWelcomeReadiness(options: WelcomeReadinessOptions): WelcomeReadiness {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  return {
    items: [
      buildMusicReadiness(options.config),
      buildLlmReadiness(options.config, env),
      buildVoiceReadiness(options.config, platform),
      buildTasteReadiness(options.config),
      buildCalendarReadiness(options.config)
    ]
  };
}

export function renderWelcomeHub(
  readiness: WelcomeReadiness,
  options: { selectedAction?: WelcomeHubAction } = {}
): string {
  const selectedAction = options.selectedAction ?? "session";
  return [
    "Pockedio",
    "",
    "Personal AI DJ for context-aware listening",
    "",
    ...welcomeHubEntries.map((entry, index) => formatHubEntry(entry.action === selectedAction, index + 1, entry.label, entry.description)),
    "",
    "Readiness",
    ...readiness.items.map(formatReadinessItem),
    "",
    "↑↓ Select  |  Enter Open  |  S Setup  |  L LLM  |  V Voice  |  Q Quit"
  ].join("\n");
}

export function renderSetupConnectionsSurface(
  options: WelcomeReadinessOptions,
  renderOptions: { selectedAction?: SetupConnectionsAction } = {}
): string {
  const readiness = buildWelcomeReadiness(options);
  const byLabel = new Map(readiness.items.map((item) => [item.label, item]));
  const selectedAction = renderOptions.selectedAction ?? "full_setup";
  return [
    "Setup & Connections",
    "",
    formatSetupLine("Music", byLabel.get("Music")?.value ?? "Unknown"),
    formatSetupLine("LLM", byLabel.get("LLM")?.value ?? "Unknown"),
    formatSetupLine("Voice", byLabel.get("Voice")?.value ?? "Unknown"),
    formatSetupLine("Calendar", byLabel.get("Calendar")?.value ?? "Unknown"),
    formatSetupLine("Weather", options.config.weather.enabled ? options.config.weather.location : "Not enabled"),
    formatSetupLine("Diary", options.config.diary.enabled ? "Enabled" : "Not enabled"),
    "",
    "Actions:",
    ...setupConnectionsEntries.map((entry, index) => formatNumberedAction(entry.action === selectedAction, index + 1, entry.label)),
    "",
    "↑↓ Select  |  Enter Open  |  1-6 Open  |  B Back  |  Q Quit"
  ].join("\n");
}

export function renderLlmSetupSurface(
  options: Pick<WelcomeReadinessOptions, "config" | "env">,
  renderOptions: { selectedAction?: LlmSetupAction } = {}
): string {
  const env = options.env ?? process.env;
  const keySource = getLlmKeySource(options.config, env);
  const selectedAction = renderOptions.selectedAction ?? inferLlmSetupAction(options.config);
  return [
    "LLM",
    "",
    "Current config",
    formatSetupLine("Provider", "OpenAI-compatible"),
    formatSetupLine("Model", options.config.llm.model),
    formatSetupLine("API key", formatLlmKeySource(options.config.llm.apiKeyEnv, keySource)),
    formatSetupLine("Base URL", options.config.llm.baseUrl ?? "OpenAI default"),
    "",
    "Supported now",
    "  Any OpenAI-compatible Chat Completions API.",
    "  Presets only fill model, base URL, and API key env; the client remains configurable.",
    "",
    "Actions:",
    ...llmSetupEntries.map((entry, index) => formatNumberedAction(entry.action === selectedAction, index + 1, `${entry.label}  ${entry.description}`)),
    "",
    "↑↓ Select  |  Enter Open  |  1-7 Open  |  B Back  |  Q Quit"
  ].join("\n");
}

export function renderLlmProviderSurface(
  options: Pick<WelcomeReadinessOptions, "config" | "env">,
  providerId: LlmProviderId,
  renderOptions: { selectedAction?: LlmProviderAction } = {}
): string {
  const env = options.env ?? process.env;
  const preset = getLlmProviderPreset(providerId, options.config);
  const entries = getLlmProviderEntries(providerId);
  const selectedAction = renderOptions.selectedAction ?? entries[0]!.action;
  const keySource = getLlmKeySource({
    ...options.config,
    llm: {
      ...options.config.llm,
      apiKeyEnv: preset.apiKeyEnv
    }
  }, env);
  const apiKey = providerId === "local_vllm" && keySource === "missing"
    ? `Optional: ${preset.apiKeyEnv}`
    : formatLlmKeySource(preset.apiKeyEnv, keySource);
  return [
    preset.label,
    "",
    formatProviderLine("Model", preset.model),
    formatProviderLine("API key", apiKey),
    formatProviderLine("Base URL", preset.baseUrl ?? "OpenAI default"),
    "",
    "Actions:",
    ...entries.map((entry, index) => formatNumberedAction(entry.action === selectedAction, index + 1, entry.label)),
    "",
    `↑↓ Select  |  Enter Open  |  1-${entries.length} Open  |  B Back  |  Q Quit`
  ].join("\n");
}

export function renderVoiceSetupSurface(
  options: Pick<WelcomeReadinessOptions, "config" | "platform">,
  renderOptions: { selectedAction?: VoiceSetupAction } = {}
): string {
  const platform = options.platform ?? process.platform;
  const fishConfigured = Boolean(options.config.fishAudio.referenceAudioPath && fs.existsSync(options.config.fishAudio.referenceAudioPath));
  const provider = formatVoiceProvider(options.config, platform, fishConfigured);
  const voice = formatConfiguredVoice(options.config, platform);
  const selectedAction = renderOptions.selectedAction ?? "preview";
  return [
    "Voice",
    "",
    formatSetupLine("Provider", fishConfigured ? "Fish TTS" : provider),
    formatSetupLine("Voice", fishConfigured ? "Mina or Nova" : voice),
    formatSetupLine("Advanced", fishConfigured ? "Fish TTS configured" : "Fish TTS not configured"),
    "",
    "Built-in voices:",
    "  Lumen, Sable, Arden, Vale, Sol",
    "",
    "Actions:",
    ...voiceSetupEntries.map((entry, index) => formatNumberedAction(entry.action === selectedAction, index + 1, entry.label)),
    "",
    "↑↓ Select  |  Enter Open  |  1-5 Open  |  B Back  |  Q Quit"
  ].join("\n");
}

export function renderTasteMemorySurface(
  options: Pick<WelcomeReadinessOptions, "config">,
  renderOptions: { selectedAction?: TasteMemoryAction } = {}
): string {
  const summary = readTasteMemorySummary(options.config);
  const selectedAction = renderOptions.selectedAction ?? "import";
  return [
    "Taste & Memory",
    "",
    formatTasteLine("Imported lists", summary.importedLists, 16),
    formatTasteLine("Last import", summary.lastImport, 16),
    formatTasteLine("Taste profile", summary.profileStatus, 16),
    formatTasteLine("Recent signals", summary.recentSignals, 16),
    formatTasteLine("Session memory", summary.sessionMemory, 16),
    formatTasteLine("Diary", options.config.diary.enabled ? "Summary available if diary has entries" : "Not enabled", 16),
    "",
    "Actions:",
    ...tasteMemoryEntries.map((entry, index) => formatNumberedAction(entry.action === selectedAction, index + 1, entry.label)),
    "",
    "↑↓ Select  |  Enter Open  |  1-5 Open  |  B Back  |  Q Quit"
  ].join("\n");
}

export function renderTasteImportResultSurface(result: TasteImportResult): string {
  return [
    "Imported playlist",
    "",
    formatTasteLine("Tracks", String(result.trackCount), 14),
    formatTasteLine("Artists", String(result.artists.length), 14),
    formatTasteLine("Playlist", result.playlists.join(", ") || "Unknown", 14),
    formatTasteLine("Taste file", result.tastePath, 14),
    "",
    "Updated:",
    "  Imported taste signals",
    "  Taste memory",
    "  Taste profile needs refresh",
    "",
    "Actions:",
    "> Rebuild taste profile",
    "  Start station from this playlist",
    "  Back to Taste & Memory"
  ].join("\n");
}

export async function promptWelcomeHub(readiness: WelcomeReadiness): Promise<WelcomeHubAction> {
  return new Promise((resolve) => {
    let selectedIndex = 0;
    const input = process.stdin;
    const output = process.stdout;
    const previousRawMode = input.isRaw;

    const render = () => {
      output.write("\x1B[?25l");
      output.write("\x1B[H\x1B[2J");
      output.write(renderWelcomeHub(readiness, { selectedAction: welcomeHubEntries[selectedIndex]!.action }));
    };
    const cleanup = (action: WelcomeHubAction) => {
      input.off("keypress", onKeypress);
      if (input.isTTY) {
        input.setRawMode(previousRawMode);
      }
      input.pause();
      output.write("\x1B[?25h\n");
      resolve(action);
    };
    const onKeypress = (_value: string, key: readline.Key) => {
      if (key.name === "up") {
        selectedIndex = (selectedIndex - 1 + welcomeHubEntries.length) % welcomeHubEntries.length;
        render();
        return;
      }
      if (key.name === "down") {
        selectedIndex = (selectedIndex + 1) % welcomeHubEntries.length;
        render();
        return;
      }
      if (key.name === "return") {
        cleanup(welcomeHubEntries[selectedIndex]!.action);
        return;
      }
      const numericIndex = Number(key.name) - 1;
      if (Number.isInteger(numericIndex) && numericIndex >= 0 && numericIndex < welcomeHubEntries.length) {
        cleanup(welcomeHubEntries[numericIndex]!.action);
        return;
      }
      if (key.name === "s") {
        cleanup("setup");
        return;
      }
      if (key.name === "l") {
        cleanup("llm_setup");
        return;
      }
      if (key.name === "v") {
        cleanup("voice_setup");
        return;
      }
      if (key.name === "q" || (key.ctrl && key.name === "c")) {
        cleanup("quit");
        return;
      }
    };

    readline.emitKeypressEvents(input);
    input.resume();
    if (input.isTTY) {
      input.setRawMode(true);
    }
    input.on("keypress", onKeypress);
    render();
  });
}

export async function promptSetupConnections(options: WelcomeReadinessOptions): Promise<SetupConnectionsAction> {
  return promptNumberedSurface({
    entries: setupConnectionsEntries,
    initialAction: "full_setup",
    render: (action) => renderSetupConnectionsSurface(options, { selectedAction: action })
  });
}

export async function promptLlmSetup(options: Pick<WelcomeReadinessOptions, "config" | "env">): Promise<LlmSetupAction> {
  return promptNumberedSurface({
    entries: llmSetupEntries,
    initialAction: inferLlmSetupAction(options.config),
    render: (action) => renderLlmSetupSurface(options, { selectedAction: action })
  });
}

export async function promptLlmProvider(
  options: Pick<WelcomeReadinessOptions, "config" | "env">,
  providerId: LlmProviderId
): Promise<LlmProviderAction> {
  return promptNumberedSurface({
    entries: getLlmProviderEntries(providerId),
    initialAction: getLlmProviderEntries(providerId)[0]!.action,
    render: (action) => renderLlmProviderSurface(options, providerId, { selectedAction: action })
  });
}

export function inferLlmSetupAction(config: PockedioConfig): LlmSetupAction {
  if (config.llm.model === "deepseek-chat"
    && config.llm.baseUrl === "https://api.deepseek.com"
    && config.llm.apiKeyEnv === "DEEPSEEK_API_KEY") {
    return "deepseek";
  }
  if (config.llm.baseUrl === "https://openrouter.ai/api/v1" && config.llm.apiKeyEnv === "OPENROUTER_API_KEY") {
    return "openrouter";
  }
  if (config.llm.baseUrl?.includes("127.0.0.1") || config.llm.baseUrl?.includes("localhost")) {
    return "local_vllm";
  }
  if (!config.llm.baseUrl && config.llm.apiKeyEnv === "OPENAI_API_KEY") {
    return "openai";
  }
  return "custom";
}

export async function promptVoiceSetup(options: Pick<WelcomeReadinessOptions, "config" | "platform">): Promise<VoiceSetupAction> {
  return promptNumberedSurface({
    entries: voiceSetupEntries,
    initialAction: "preview",
    render: (action) => renderVoiceSetupSurface(options, { selectedAction: action })
  });
}

export async function promptTasteMemory(options: Pick<WelcomeReadinessOptions, "config">): Promise<TasteMemoryAction> {
  return promptNumberedSurface({
    entries: tasteMemoryEntries,
    initialAction: "import",
    render: (action) => renderTasteMemorySurface(options, { selectedAction: action })
  });
}

export function applyLlmSetupKey(
  selectedAction: LlmSetupAction,
  key: SelectableKeyInput
): SelectableKeyResult<LlmSetupAction> {
  return applySelectableKey({
    entries: llmSetupEntries,
    selectedAction,
    key,
    backAction: "back",
    quitAction: "quit"
  });
}

export function applyLlmProviderKey(
  selectedAction: LlmProviderAction,
  key: SelectableKeyInput,
  providerId: LlmProviderId
): SelectableKeyResult<LlmProviderAction> {
  return applySelectableKey({
    entries: getLlmProviderEntries(providerId),
    selectedAction,
    key,
    backAction: "back",
    quitAction: "quit"
  });
}

export function applyVoiceSetupKey(
  selectedAction: VoiceSetupAction,
  key: SelectableKeyInput
): SelectableKeyResult<VoiceSetupAction> {
  return applySelectableKey({
    entries: voiceSetupEntries,
    selectedAction,
    key,
    backAction: "back",
    quitAction: "quit"
  });
}

export function applyTasteMemoryKey(
  selectedAction: TasteMemoryAction,
  key: SelectableKeyInput
): SelectableKeyResult<TasteMemoryAction> {
  return applySelectableKey({
    entries: tasteMemoryEntries,
    selectedAction,
    key,
    backAction: "back",
    quitAction: "quit"
  });
}

function promptNumberedSurface<TAction extends string>(options: {
  entries: Array<{ action: TAction; label: string }>;
  initialAction: TAction;
  render: (selectedAction: TAction) => string;
}): Promise<TAction> {
  return new Promise((resolve) => {
    let selectedAction = options.initialAction;
    const input = process.stdin;
    const output = process.stdout;
    const previousRawMode = input.isRaw;

    const render = () => {
      output.write("\x1B[?25l");
      output.write("\x1B[H\x1B[2J");
      output.write(options.render(selectedAction));
    };
    const cleanup = (action: TAction) => {
      input.off("keypress", onKeypress);
      if (input.isTTY) {
        input.setRawMode(previousRawMode);
      }
      input.pause();
      output.write("\x1B[?25h\n");
      resolve(action);
    };
    const onKeypress = (_value: string, key: readline.Key) => {
      const previousSelectedAction = selectedAction;
      const result = applySelectableKey({
        entries: options.entries,
        selectedAction,
        key,
        backAction: "back" as TAction,
        quitAction: "quit" as TAction
      });
      selectedAction = result.selectedAction;
      if (result.submittedAction) {
        cleanup(result.submittedAction);
      } else if (previousSelectedAction !== selectedAction) {
        render();
      }
    };

    readline.emitKeypressEvents(input);
    input.resume();
    if (input.isTTY) {
      input.setRawMode(true);
    }
    input.on("keypress", onKeypress);
    render();
  });
}

function applySelectableKey<TAction extends string>(input: {
  entries: Array<{ action: TAction }>;
  selectedAction: TAction;
  key: SelectableKeyInput;
  backAction?: TAction;
  quitAction?: TAction;
}): SelectableKeyResult<TAction> {
  const selectedIndex = Math.max(0, input.entries.findIndex((entry) => entry.action === input.selectedAction));
  if (input.key.name === "up") {
    return {
      selectedAction: input.entries[(selectedIndex - 1 + input.entries.length) % input.entries.length]!.action
    };
  }
  if (input.key.name === "down") {
    return {
      selectedAction: input.entries[(selectedIndex + 1) % input.entries.length]!.action
    };
  }
  if (input.key.name === "return") {
    return {
      selectedAction: input.entries[selectedIndex]!.action,
      submittedAction: input.entries[selectedIndex]!.action
    };
  }
  const numericIndex = Number(input.key.name) - 1;
  if (Number.isInteger(numericIndex) && numericIndex >= 0 && numericIndex < input.entries.length) {
    const action = input.entries[numericIndex]!.action;
    return { selectedAction: action, submittedAction: action };
  }
  if (input.key.name === "b" && input.backAction) {
    return { selectedAction: input.backAction, submittedAction: input.backAction };
  }
  if ((input.key.name === "q" || (input.key.ctrl && input.key.name === "c")) && input.quitAction) {
    return { selectedAction: input.selectedAction, submittedAction: input.quitAction };
  }
  return { selectedAction: input.selectedAction };
}

export function resolveWelcomeHubAction(input: string): WelcomeHubAction {
  const normalized = input.trim().toLowerCase();
  if (normalized === "" || normalized === "enter" || normalized === "session" || normalized === "dj") {
    return "session";
  }
  const numericIndex = Number(normalized) - 1;
  if (Number.isInteger(numericIndex) && numericIndex >= 0 && numericIndex < welcomeHubEntries.length) {
    return welcomeHubEntries[numericIndex]!.action;
  }
  if (normalized === "s" || normalized === "setup") {
    return "setup";
  }
  if (normalized === "l" || normalized === "llm") {
    return "llm_setup";
  }
  if (normalized === "v" || normalized === "voice") {
    return "voice_setup";
  }
  if (normalized === "taste" || normalized === "memory") {
    return "taste";
  }
  if (normalized === "status") {
    return "status";
  }
  if (normalized === "q" || normalized === "quit") {
    return "quit";
  }
  return "session";
}

export function resolveSetupConnectionsAction(input: string): SetupConnectionsAction {
  const normalized = input.trim().toLowerCase();
  const numericIndex = Number(normalized) - 1;
  if (Number.isInteger(numericIndex) && numericIndex >= 0 && numericIndex < setupConnectionsEntries.length) {
    return setupConnectionsEntries[numericIndex]!.action;
  }
  if (normalized === "" || normalized === "enter") {
    return "full_setup";
  }
  if (normalized === "l" || normalized === "llm") {
    return "llm_setup";
  }
  if (normalized === "v" || normalized === "voice") {
    return "voice_setup";
  }
  if (normalized === "n" || normalized === "netease") {
    return "netease_setup";
  }
  if (normalized === "c" || normalized === "calendar") {
    return "calendar_setup";
  }
  if (normalized === "b" || normalized === "back") {
    return "back";
  }
  if (normalized === "q" || normalized === "quit") {
    return "quit";
  }
  return "full_setup";
}

export function resolveLlmSetupAction(input: string): LlmSetupAction {
  const normalized = input.trim().toLowerCase();
  const numericIndex = Number(normalized) - 1;
  if (Number.isInteger(numericIndex) && numericIndex >= 0 && numericIndex < llmSetupEntries.length) {
    return llmSetupEntries[numericIndex]!.action;
  }
  if (normalized === "" || normalized === "enter" || normalized === "openai") {
    return "openai";
  }
  if (normalized === "deepseek") {
    return "deepseek";
  }
  if (normalized === "openrouter") {
    return "openrouter";
  }
  if (normalized === "vllm" || normalized === "local") {
    return "local_vllm";
  }
  if (normalized === "custom") {
    return "custom";
  }
  if (normalized === "test") {
    return "test_connection";
  }
  if (normalized === "b" || normalized === "back") {
    return "back";
  }
  if (normalized === "q" || normalized === "quit") {
    return "quit";
  }
  return "openai";
}

export function resolveLlmProviderAction(input: string, providerId: LlmProviderId): LlmProviderAction {
  const normalized = input.trim().toLowerCase();
  const entries = getLlmProviderEntries(providerId);
  const numericIndex = Number(normalized) - 1;
  if (Number.isInteger(numericIndex) && numericIndex >= 0 && numericIndex < entries.length) {
    return entries[numericIndex]!.action;
  }
  if (normalized === "" || normalized === "enter" || normalized === "paste" || normalized === "key") {
    return entries[0]!.action;
  }
  if (normalized === "env" || normalized === "shell") {
    return "use_shell_env";
  }
  if (normalized === "model") {
    return "change_model";
  }
  if (normalized === "url" || normalized === "base") {
    return "change_base_url";
  }
  if (normalized === "api_key_env" || normalized === "key_env") {
    return "change_api_key_env";
  }
  if (normalized === "check") {
    return "check_server";
  }
  if (normalized === "discover") {
    return "discover_models";
  }
  if (normalized === "test") {
    return "test_connection";
  }
  if (normalized === "b" || normalized === "back") {
    return "back";
  }
  if (normalized === "q" || normalized === "quit") {
    return "quit";
  }
  return entries[0]!.action;
}

export function resolveVoiceSetupAction(input: string): VoiceSetupAction {
  const normalized = input.trim().toLowerCase();
  const numericIndex = Number(normalized) - 1;
  if (Number.isInteger(numericIndex) && numericIndex >= 0 && numericIndex < voiceSetupEntries.length) {
    return voiceSetupEntries[numericIndex]!.action;
  }
  if (normalized === "" || normalized === "enter" || normalized === "preview") {
    return "preview";
  }
  if (normalized === "builtin" || normalized === "choose") {
    return "choose_builtin";
  }
  if (normalized === "fish") {
    return "fish_tts";
  }
  if (normalized === "text") {
    return "text_only";
  }
  if (normalized === "b" || normalized === "back") {
    return "back";
  }
  if (normalized === "q" || normalized === "quit") {
    return "quit";
  }
  return "preview";
}

export function resolveTasteMemoryAction(input: string): TasteMemoryAction {
  const normalized = input.trim().toLowerCase();
  const numericIndex = Number(normalized) - 1;
  if (Number.isInteger(numericIndex) && numericIndex >= 0 && numericIndex < tasteMemoryEntries.length) {
    return tasteMemoryEntries[numericIndex]!.action;
  }
  if (normalized === "" || normalized === "enter" || normalized === "import") {
    return "import";
  }
  if (normalized === "rebuild" || normalized === "profile") {
    return "rebuild_profile";
  }
  if (normalized === "summary") {
    return "show_summary";
  }
  if (normalized === "start") {
    return "start_station";
  }
  if (normalized === "b" || normalized === "back") {
    return "back";
  }
  if (normalized === "q" || normalized === "quit") {
    return "quit";
  }
  return "import";
}

export function resolveDefaultEntryMode(input: DefaultEntryModeInput): DefaultEntryMode {
  if (input.forceSession || input.noHub) {
    return "session";
  }
  return input.stdinIsTty && input.stdoutIsTty ? "hub" : "session";
}

function buildMusicReadiness(config: PockedioConfig): WelcomeReadinessItem {
  if (config.music.provider !== "netease") {
    return { label: "Music", value: config.music.provider, ok: true };
  }
  const accountReady = config.netease.authMode === "account" && Boolean(readNetEaseCookie(config));
  return {
    label: "Music",
    value: accountReady ? "NetEase connected" : "NetEase anonymous",
    ok: true
  };
}

function buildLlmReadiness(config: PockedioConfig, env: PockedioEnv): WelcomeReadinessItem {
  const keySource = getLlmKeySource(config, env);
  return {
    label: "LLM",
    value: keySource === "env"
      ? "Configured: shell env"
      : keySource === "local_secret"
        ? "Configured: local secret"
        : `Missing: ${config.llm.apiKeyEnv}`,
    ok: keySource !== "missing"
  };
}

function getLlmKeySource(config: PockedioConfig, env: PockedioEnv): "env" | "local_secret" | "missing" {
  if (env[config.llm.apiKeyEnv]) {
    return "env";
  }
  if (hasLocalLlmApiKey(config, config.llm.apiKeyEnv)) {
    return "local_secret";
  }
  return "missing";
}

function formatLlmKeySource(apiKeyEnv: string, source: "env" | "local_secret" | "missing"): string {
  if (source === "env") {
    return `Present: shell env (${apiKeyEnv})`;
  }
  if (source === "local_secret") {
    return `Present: local secret (${apiKeyEnv})`;
  }
  return `Missing: ${apiKeyEnv}`;
}

function buildVoiceReadiness(config: PockedioConfig, platform: NodeJS.Platform): WelcomeReadinessItem {
  if (config.tts.provider === "text") {
    return { label: "Voice", value: "Text-only DJ copy", ok: true };
  }
  if (config.tts.provider === "fish") {
    return { label: "Voice", value: `${formatFishVoiceName(config.tts.fishVoice)}, Fish TTS`, ok: true };
  }
  if (config.fishAudio.referenceAudioPath && fs.existsSync(config.fishAudio.referenceAudioPath)) {
    return { label: "Voice", value: "Fish TTS configured", ok: true };
  }
  if (platform === "darwin") {
    return { label: "Voice", value: `${formatMacosVoiceName(config.tts.macosVoice)}, built-in macOS`, ok: true };
  }
  return { label: "Voice", value: "Text-only DJ copy", ok: true };
}

function buildTasteReadiness(config: PockedioConfig): WelcomeReadinessItem {
  const tastePresent = fs.existsSync(config.paths.taste) && fs.readFileSync(config.paths.taste, "utf8").trim().length > 0;
  return {
    label: "Taste",
    value: tastePresent ? "Imported" : "Not imported",
    ok: tastePresent
  };
}

function buildCalendarReadiness(config: PockedioConfig): WelcomeReadinessItem {
  return {
    label: "Calendar",
    value: config.calendar.enabled ? "Enabled" : "Disabled",
    ok: config.calendar.enabled
  };
}

function formatHubEntry(selected: boolean, index: number, label: string, description: string): string {
  return `${selected ? ">" : " "} ${`${index}. ${label}`.padEnd(27)} ${description}`;
}

function formatNumberedAction(selected: boolean, index: number, label: string): string {
  return `${selected ? ">" : " "} ${index}. ${label}`;
}

function formatReadinessItem(item: WelcomeReadinessItem): string {
  return `  ${item.label.padEnd(12)} ${item.value}`;
}

function formatSetupLine(label: string, value: string): string {
  return `${label.padEnd(16)}${value}`;
}

function formatProviderLine(label: string, value: string): string {
  return `${label.padEnd(12)}${value}`;
}

function formatVoiceProvider(config: PockedioConfig, platform: NodeJS.Platform, fishConfigured: boolean): string {
  if (config.tts.provider === "text") {
    return "Text-only DJ copy";
  }
  if (config.tts.provider === "fish") {
    return "Fish TTS";
  }
  if (config.tts.provider === "macos") {
    return platform === "darwin" ? "Built-in macOS voice" : "macOS voice unavailable here";
  }
  if (fishConfigured) {
    return "Fish TTS";
  }
  return platform === "darwin" ? "Built-in macOS voice" : "Text-only DJ copy";
}

function formatConfiguredVoice(config: PockedioConfig, platform: NodeJS.Platform): string {
  if (config.tts.provider === "text") {
    return "None";
  }
  if (config.tts.provider === "fish") {
    return formatFishVoiceName(config.tts.fishVoice);
  }
  if (config.tts.provider === "macos" || platform === "darwin") {
    return formatMacosVoiceName(config.tts.macosVoice);
  }
  return "None";
}

function formatTasteLine(label: string, value: string, width: number): string {
  return `${label.padEnd(width)}${value}`;
}

function getLlmProviderEntries(providerId: LlmProviderId): Array<{ action: LlmProviderAction; label: string }> {
  if (providerId === "local_vllm") {
    return localVllmProviderEntries;
  }
  if (providerId === "custom") {
    return customLlmProviderEntries;
  }
  return hostedLlmProviderEntries;
}

function getLlmProviderPreset(providerId: LlmProviderId, config: PockedioConfig): {
  label: string;
  model: string;
  baseUrl?: string;
  apiKeyEnv: string;
} {
  const currentProvider = inferLlmSetupAction(config);
  const currentConfig = currentProvider === providerId
    ? {
        model: config.llm.model,
        baseUrl: config.llm.baseUrl,
        apiKeyEnv: config.llm.apiKeyEnv
      }
    : undefined;
  if (providerId === "openai") {
    return { label: "OpenAI", model: currentConfig?.model ?? "gpt-4.1-mini", baseUrl: currentConfig?.baseUrl, apiKeyEnv: currentConfig?.apiKeyEnv ?? "OPENAI_API_KEY" };
  }
  if (providerId === "deepseek") {
    return { label: "DeepSeek", model: currentConfig?.model ?? "deepseek-chat", baseUrl: currentConfig?.baseUrl ?? "https://api.deepseek.com", apiKeyEnv: currentConfig?.apiKeyEnv ?? "DEEPSEEK_API_KEY" };
  }
  if (providerId === "openrouter") {
    return { label: "OpenRouter", model: currentConfig?.model ?? "openai/gpt-4.1-mini", baseUrl: currentConfig?.baseUrl ?? "https://openrouter.ai/api/v1", apiKeyEnv: currentConfig?.apiKeyEnv ?? "OPENROUTER_API_KEY" };
  }
  if (providerId === "local_vllm") {
    return { label: "Local vLLM", model: currentConfig?.model ?? "local-model", baseUrl: currentConfig?.baseUrl ?? "http://127.0.0.1:8000/v1", apiKeyEnv: currentConfig?.apiKeyEnv ?? "VLLM_API_KEY" };
  }
  return {
    label: "Custom OpenAI-compatible",
    model: config.llm.model,
    baseUrl: config.llm.baseUrl,
    apiKeyEnv: config.llm.apiKeyEnv
  };
}

function readTasteMemorySummary(config: PockedioConfig): {
  importedLists: string;
  lastImport: string;
  profileStatus: string;
  recentSignals: string;
  sessionMemory: string;
} {
  if (!fs.existsSync(config.paths.taste)) {
    return {
      importedLists: "Not imported",
      lastImport: "None",
      profileStatus: "Not built",
      recentSignals: "No local feedback yet",
      sessionMemory: "Not updated",
      };
  }
  const markdown = fs.readFileSync(config.paths.taste, "utf8");
  const trackCount = Number(markdown.match(/^- Imported tracks:\s*(\d+)/m)?.[1] ?? countImportedTrackLines(markdown));
  const playlistCount = countSectionListItems(markdown, "Situational Playlists", "No signals yet.");
  const lastImport = markdown.match(/^- Last import:\s*(.+)$/m)?.[1]?.trim() ?? "Unknown";
  const hasGeneratedProfile = /POCKEDIO:BEGIN GENERATED TASTE PROFILE/.test(markdown);
  return {
    importedLists: `${playlistCount} playlists, ${trackCount} tracks`,
    lastImport,
    profileStatus: hasGeneratedProfile ? "Ready" : "Needs refresh",
    recentSignals: "Stored locally when feedback exists",
    sessionMemory: "Updated during sessions"
  };
}

function countImportedTrackLines(markdown: string): number {
  return extractMarkdownSection(markdown, "Imported Tracks")
    .filter((line) => line.trim().startsWith("- ") && !line.includes("No tracks imported yet."))
    .length;
}

function countSectionListItems(markdown: string, heading: string, emptyMarker: string): number {
  return extractMarkdownSection(markdown, heading)
    .filter((line) => line.trim().startsWith("- ") && !line.includes(emptyMarker))
    .length;
}

function extractMarkdownSection(markdown: string, heading: string): string[] {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start < 0) {
    return [];
  }
  const end = lines.findIndex((line, index) => index > start && /^##\s+/.test(line.trim()));
  return lines.slice(start + 1, end < 0 ? undefined : end);
}
