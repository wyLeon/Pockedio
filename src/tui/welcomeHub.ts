import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { pockedioVersion } from "../index.js";
import type { PockedioEnv } from "../config/paths.js";
import type { PockedioConfig } from "../config/schema.js";
import { readNetEaseCookie } from "../config/neteaseAuth.js";
import { hasLocalLlmApiKey } from "../config/llmSecrets.js";
import type { TasteImportResult } from "../taste/importTaste.js";
import {
  fishVoiceOptions,
  formatFishVoiceName,
  formatKokoroVoiceName,
  formatMacosVoiceName,
  kokoroVoiceOptions,
  macosVoiceOptions,
  voicePreviewText
} from "../tts/voiceSetup.js";
import {
  renderTuiAccentText,
  renderTuiBulletLine,
  renderTuiFooter,
  renderTuiKeyValue,
  renderTuiPageTitle,
  renderTuiRow,
  renderTuiSectionLabel,
  type TuiRenderOptions
} from "./terminalRenderer.js";

export type WelcomeReadinessItem = {
  label: "Music" | "LLM" | "Voice" | "Taste" | "Calendar";
  value: string;
  ok: boolean;
};

export type WelcomeReadiness = {
  items: WelcomeReadinessItem[];
  updateNotice?: string;
};

export type WelcomeHubAction = "session" | "setup" | "llm_setup" | "voice_setup" | "taste" | "status" | "update" | "quit";
export type SetupConnectionsAction = "full_setup" | "llm_setup" | "voice_setup" | "netease_setup" | "context_setup" | "scheduler_setup" | "back" | "quit";
export type LlmProviderId = "openai" | "deepseek" | "openrouter" | "local_vllm" | "custom";
export type LlmSetupAction = LlmProviderId | "test_connection" | "back" | "quit";
export type LlmProviderAction = "paste_key" | "use_shell_env" | "change_model" | "change_base_url" | "change_api_key_env" | "check_server" | "discover_models" | "test_connection" | "back" | "quit";
export type VoiceSetupAction = "choose_voice" | "kokoro_tts" | "fish_api_tts" | "fish_tts" | "text_only" | "back" | "quit";
export type ContextSetupAction = "calendar" | "weather" | "diary" | "back" | "quit";
export type DjVoiceChoiceId =
  | `macos:${PockedioConfig["tts"]["macosVoice"]}`
  | `kokoro:${PockedioConfig["tts"]["kokoroVoice"]}`
  | `fish:${PockedioConfig["tts"]["fishVoice"]}`;
export type DjVoiceChooserSubmit = "preview" | "save" | "kokoro_setup" | "fish_setup" | "back" | "quit";
export type DjVoiceChooserResult = {
  selectedVoice: DjVoiceChoiceId;
  submit?: DjVoiceChooserSubmit;
};
export type TasteMemoryAction = "import" | "show_summary" | "back" | "quit";

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

type HubRenderOptions<TAction extends string = string> = TuiRenderOptions & {
  selectedAction?: TAction;
};

const welcomeHubEntries: Array<{ action: WelcomeHubAction; label: string; description: string }> = [
  { action: "session", label: "Enter DJ Session", description: "Talk, ask, play, reshape, queue, DJ mode" },
  { action: "setup", label: "Setup & Connections", description: "Music, LLM, voice, context" },
  { action: "taste", label: "Taste & Memory", description: "Import taste, review personalization inputs" },
  { action: "status", label: "Status", description: "Playback, scheduler, health, version" }
];

const setupConnectionsEntries: Array<{ action: SetupConnectionsAction; label: string; description: string }> = [
  { action: "full_setup", label: "Run full setup", description: "review everything from the beginning" },
  { action: "llm_setup", label: "Configure LLM", description: "model, base URL, API key, local vLLM" },
  { action: "voice_setup", label: "Configure Voice", description: "Mina, Nova, macOS voice, text-only" },
  { action: "netease_setup", label: "Configure NetEase", description: "QR, cookie, quality level" },
  { action: "context_setup", label: "Configure Context", description: "calendar, weather, diary" },
  { action: "scheduler_setup", label: "Configure Scheduled DJ", description: "morning and evening programs" }
];

const llmSetupEntries: Array<{ action: LlmSetupAction; label: string; description: string }> = [
  { action: "openai", label: "Use OpenAI", description: "gpt-4.1-mini, OPENAI_API_KEY, OpenAI default URL" },
  { action: "deepseek", label: "Use DeepSeek", description: "deepseek-chat, DEEPSEEK_API_KEY, https://api.deepseek.com" },
  { action: "openrouter", label: "Use OpenRouter", description: "OpenRouter model, OPENROUTER_API_KEY, https://openrouter.ai/api/v1" },
  { action: "local_vllm", label: "Use local vLLM", description: "OpenAI-compatible local server, no hosted provider required" },
  { action: "custom", label: "Custom OpenAI-compatible", description: "Set model, base URL, and API key env manually" },
  { action: "test_connection", label: "Test current setup", description: "Make a minimal LLM call with the current config" }
];

const hostedLlmProviderEntries: Array<{ action: LlmProviderAction; label: string; description: string }> = [
  { action: "paste_key", label: "Paste API key", description: "store a local secret for Pockedio" },
  { action: "use_shell_env", label: "Use shell env", description: "read the key from your terminal environment" },
  { action: "change_model", label: "Change model", description: "override the default model name" },
  { action: "test_connection", label: "Test connection", description: "make a minimal model call" }
];

const customLlmProviderEntries: Array<{ action: LlmProviderAction; label: string; description: string }> = [
  { action: "paste_key", label: "Paste API key", description: "store a local secret for Pockedio" },
  { action: "use_shell_env", label: "Use shell env", description: "read the key from your terminal environment" },
  { action: "change_model", label: "Change model", description: "set any OpenAI-compatible model" },
  { action: "change_base_url", label: "Change base URL", description: "point to a compatible API endpoint" },
  { action: "change_api_key_env", label: "Set API key env", description: "choose which environment variable to read" },
  { action: "test_connection", label: "Test connection", description: "make a minimal model call" }
];

const localVllmProviderEntries: Array<{ action: LlmProviderAction; label: string; description: string }> = [
  { action: "check_server", label: "Check server", description: "verify the local OpenAI-compatible endpoint" },
  { action: "discover_models", label: "Discover models", description: "list models from the local server" },
  { action: "paste_key", label: "Paste API key", description: "optional if your server requires a key" },
  { action: "change_model", label: "Set model manually", description: "enter a model name directly" },
  { action: "change_base_url", label: "Set base URL", description: "change the local endpoint URL" }
];

const voiceSetupEntries: Array<{ action: VoiceSetupAction; label: string; description: string }> = [
  { action: "fish_api_tts", label: "Fish Audio Cloud", description: "fast cloud Mina or Nova voice" },
  { action: "fish_tts", label: "Fish Local Model", description: "offline Mina or Nova voice from local model" }
];

const contextSetupEntries: Array<{ action: ContextSetupAction; label: string; description: string }> = [
  { action: "calendar", label: "Configure Calendar", description: "local schedule signals for timing and mood" },
  { action: "weather", label: "Configure Weather", description: "city weather for station tone" },
  { action: "diary", label: "Configure Diary", description: "local-first personal context summaries" }
];

const tasteMemoryEntries: Array<{ action: TasteMemoryAction; label: string; description: string }> = [
  { action: "import", label: "Import playlist", description: "refresh taste signals from NetEase" },
  { action: "show_summary", label: "Show taste summary", description: "review artists, playlists, and sample tracks" }
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
  options: HubRenderOptions<WelcomeHubAction> = {}
): string {
  const selectedAction = options.selectedAction ?? "session";
  if (options.color) {
    return [
      renderPockedioSplash(readiness, options),
      "",
      renderTuiSectionLabel("SESSION FLOW", { ...options, accent: "playback" }),
      ...welcomeHubEntries.map((entry, index) => formatHubEntry(entry.action === selectedAction, index + 1, entry.label, entry.description, options)),
      "",
      renderTuiSectionLabel("READINESS", { ...options, accent: "playback" }),
      ...readiness.items.map((item) => formatReadinessItem(item, options)),
      "",
      renderTuiFooter(formatWelcomeFooter(Boolean(readiness.updateNotice)), options)
    ].join("\n");
  }
  return [
    renderPockedioSplash(readiness, options),
    "",
    options.color ? renderTuiSectionLabel("SESSION FLOW", { ...options, accent: "playback" }) : "Session Flow",
    ...welcomeHubEntries.map((entry, index) => formatHubEntry(entry.action === selectedAction, index + 1, entry.label, entry.description, options)),
    "",
    options.color ? renderTuiSectionLabel("Readiness", { ...options, accent: "playback" }) : "Readiness",
    ...readiness.items.map((item) => formatReadinessItem(item, options)),
    "",
    renderTuiFooter(formatWelcomeFooter(Boolean(readiness.updateNotice)), options)
  ].join("\n");
}

function renderPockedioSplash(readiness: WelcomeReadiness, options: TuiRenderOptions): string {
  const title = "POCKEDIO";
  const repo = "https://github.com/wyLeon/Pockedio";
  const titleGap = " ".repeat(Math.max(2, 36 - title.length));
  const titleLine = options.color
    ? `${renderTuiAccentText(title, { ...options, accent: "dj" })}${titleGap}${renderTuiAccentText(repo, { ...options, accent: "playback" })}`
    : `${title.padEnd(36)}${repo}`;
  const tagline = "Music tuned to the moment.";
  const versionLine = `${tagline.padEnd(36)}v${pockedioVersion}`;
  return [
    titleLine,
    renderTuiAccentText(versionLine, { ...options, accent: "dj" }),
    "",
    readiness.updateNotice ? renderTuiAccentText(readiness.updateNotice, { ...options, accent: "dj" }) : undefined
  ].filter((line): line is string => typeof line === "string").join("\n");
}

function formatWelcomeFooter(hasUpdate: boolean): string {
  const entries = [
    "↑↓ Select",
    "Enter Open",
    hasUpdate ? "U Update" : undefined,
    "S Setup",
    "L LLM",
    "V Voice",
    "Q Quit"
  ].filter((entry): entry is string => typeof entry === "string");
  return entries.join("  |  ");
}

export function renderSetupConnectionsSurface(
  options: WelcomeReadinessOptions,
  renderOptions: HubRenderOptions<SetupConnectionsAction> = {}
): string {
  const readiness = buildWelcomeReadiness(options);
  const byLabel = new Map(readiness.items.map((item) => [item.label, item]));
  const selectedAction = renderOptions.selectedAction ?? "full_setup";
  return [
    renderTuiPageTitle("SETUP & CONNECTIONS", renderOptions),
    "",
    formatSetupSummaryLine(readiness, renderOptions),
    "",
    renderTuiSectionLabel("STATUS", { ...renderOptions, accent: "playback" }),
    formatSetupLine("Music", byLabel.get("Music")?.value ?? "Unknown", renderOptions),
    formatSetupLine("LLM", byLabel.get("LLM")?.value ?? "Unknown", renderOptions),
    formatSetupLine("Voice", byLabel.get("Voice")?.value ?? "Unknown", renderOptions),
    formatSetupLine("Context", formatContextSummary(options.config, byLabel.get("Calendar")?.value ?? "Unknown"), renderOptions),
    formatSetupLine("Scheduled", formatScheduledDjSummary(options.config), renderOptions),
    "",
    renderTuiSectionLabel("ACTIONS", { ...renderOptions, accent: "playback" }),
    ...setupConnectionsEntries.map((entry, index) => formatSetupConnectionAction(
      entry.action === selectedAction,
      index + 1,
      entry.label,
      entry.description,
      renderOptions
    )),
    "",
    renderTuiFooter(`↑↓ Select  |  Enter Open  |  1-${setupConnectionsEntries.length} Open  |  B Back  |  Q Quit`, renderOptions)
  ].join("\n");
}

export function renderContextSetupSurface(
  options: Pick<WelcomeReadinessOptions, "config">,
  renderOptions: HubRenderOptions<ContextSetupAction> = {}
): string {
  const selectedAction = renderOptions.selectedAction ?? "calendar";
  return [
    renderTuiPageTitle("CONTEXT SETUP", renderOptions),
    "",
    renderTuiBulletLine("Context helps stations match your day without becoming the main event.", renderOptions),
    "",
    renderTuiSectionLabel("CURRENT", { ...renderOptions, accent: "playback" }),
    formatSetupLine("Calendar", options.config.calendar.enabled ? "Enabled" : "Not enabled", renderOptions),
    formatSetupLine("Weather", options.config.weather.enabled ? options.config.weather.location : "Not enabled", renderOptions),
    formatSetupLine("Diary", options.config.diary.enabled ? "Enabled" : "Not enabled", renderOptions),
    "",
    renderTuiSectionLabel("ACTIONS", { ...renderOptions, accent: "playback" }),
    ...contextSetupEntries.map((entry, index) => formatSetupConnectionAction(
      entry.action === selectedAction,
      index + 1,
      entry.label,
      entry.description,
      renderOptions
    )),
    "",
    renderTuiFooter(`↑↓ Select  |  Enter Open  |  1-${contextSetupEntries.length} Open  |  B Back  |  Q Quit`, renderOptions)
  ].join("\n");
}

export function renderLlmSetupSurface(
  options: Pick<WelcomeReadinessOptions, "config" | "env">,
  renderOptions: HubRenderOptions<LlmSetupAction> = {}
): string {
  const env = options.env ?? process.env;
  const keySource = getLlmKeySource(options.config, env);
  const selectedAction = renderOptions.selectedAction ?? inferLlmSetupAction(options.config);
  return [
    renderTuiPageTitle("LLM SETUP", renderOptions),
    "",
    formatLlmSetupSummaryLine(keySource, options.config.llm.apiKeyEnv, renderOptions),
    "",
    renderTuiSectionLabel("CURRENT", { ...renderOptions, accent: "playback" }),
    formatSetupLine("Provider", "OpenAI-compatible", renderOptions),
    formatSetupLine("Model", options.config.llm.model, renderOptions),
    formatSetupLine("API key", formatLlmKeySource(options.config.llm.apiKeyEnv, keySource), renderOptions),
    formatSetupLine("Base URL", options.config.llm.baseUrl ?? "OpenAI default", renderOptions),
    "",
    renderTuiSectionLabel("SUPPORT", { ...renderOptions, accent: "playback" }),
    "Any OpenAI-compatible Chat Completions API.",
    "Presets update model, base URL, and API key env. The client remains configurable.",
    "",
    renderTuiSectionLabel("ACTIONS", { ...renderOptions, accent: "playback" }),
    ...llmSetupEntries.map((entry, index) => formatSetupConnectionAction(
      entry.action === selectedAction,
      index + 1,
      entry.label,
      entry.description,
      renderOptions
    )),
    "",
    renderTuiFooter(`↑↓ Select  |  Enter Open  |  1-${llmSetupEntries.length} Open  |  B Back  |  Q Quit`, renderOptions)
  ].join("\n");
}

export function renderLlmProviderSurface(
  options: Pick<WelcomeReadinessOptions, "config" | "env">,
  providerId: LlmProviderId,
  renderOptions: HubRenderOptions<LlmProviderAction> = {}
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
    renderTuiPageTitle(formatProviderTitle(preset.label), renderOptions),
    "",
    formatLlmProviderSummaryLine(providerId, keySource, preset.apiKeyEnv, renderOptions),
    "",
    renderTuiSectionLabel("CURRENT", { ...renderOptions, accent: "playback" }),
    formatSetupLine("Model", preset.model, renderOptions),
    formatSetupLine("API key", apiKey, renderOptions),
    formatSetupLine("Base URL", preset.baseUrl ?? "OpenAI default", renderOptions),
    "",
    renderTuiSectionLabel("ACTIONS", { ...renderOptions, accent: "playback" }),
    ...entries.map((entry, index) => formatSetupConnectionAction(
      entry.action === selectedAction,
      index + 1,
      entry.label,
      entry.description,
      renderOptions
    )),
    "",
    renderTuiFooter(`↑↓ Select  |  Enter Open  |  1-${entries.length} Open  |  B Back  |  Q Quit`, renderOptions)
  ].join("\n");
}

export function renderVoiceSetupSurface(
  options: Pick<WelcomeReadinessOptions, "config" | "platform">,
  renderOptions: HubRenderOptions<VoiceSetupAction> = {}
): string {
  const platform = options.platform ?? process.platform;
  const fishConfigured = isFishTtsReady(options.config);
  const fishApiConfigured = isFishApiReady(options.config);
  const kokoroConfigured = isKokoroTtsReady(options.config);
  const provider = formatVoiceProvider(options.config, platform, fishConfigured, kokoroConfigured);
  const voice = formatConfiguredVoice(options.config, platform);
  const selectedAction = renderOptions.selectedAction ?? "choose_voice";
  return [
    renderTuiPageTitle("VOICE SETUP", renderOptions),
    "",
    formatVoiceSetupSummaryLine(options.config, platform, fishConfigured, kokoroConfigured, renderOptions),
    "",
    renderTuiSectionLabel("CURRENT", { ...renderOptions, accent: "playback" }),
    formatSetupLine("Provider", provider, renderOptions),
    formatSetupLine("Voice", voice, renderOptions),
    formatSetupLine("Advanced", formatVoiceSetupAdvancedStatus(fishConfigured, fishApiConfigured, kokoroConfigured), renderOptions),
    "",
    renderTuiSectionLabel("ACTIONS", { ...renderOptions, accent: "playback" }),
    ...voiceSetupEntries.map((entry, index) => formatSetupConnectionAction(
      entry.action === selectedAction,
      index + 1,
      entry.label,
      entry.description,
      renderOptions
    )),
    "",
    renderTuiFooter(`↑↓ Select  |  Enter Open  |  1-${voiceSetupEntries.length} Open  |  B Back  |  Q Quit`, renderOptions)
  ].join("\n");
}

export function renderFishApiCloudSetupSurface(
  config: PockedioConfig,
  selected = 1,
  options: TuiRenderOptions = {},
  env: NodeJS.ProcessEnv = process.env
): string {
  const actions = [
    { label: "Set API key", description: config.fishApi.apiKeyEnv },
    { label: "Use Mina", description: fishApiCloudVoiceStatus(config, "mina", env) },
    { label: "Use Nova", description: fishApiCloudVoiceStatus(config, "nova", env) },
    { label: "Test current voice", description: formatFishVoiceName(config.tts.fishVoice) }
  ];
  return [
    renderTuiPageTitle("FISH AUDIO CLOUD", options),
    "",
    renderTuiBulletLine("Fish Audio Cloud uses Pockedio's built-in Mina and Nova voices. You only need an API key.", options),
    "",
    renderTuiSectionLabel("STATUS", { ...options, accent: "playback" }),
    renderTuiKeyValue("API key", env[config.fishApi.apiKeyEnv]?.trim() ? `Present: ${config.fishApi.apiKeyEnv}` : `Missing: ${config.fishApi.apiKeyEnv}`, 15, options),
    renderTuiKeyValue("Voice models", "Built in", 15, options),
    renderTuiKeyValue("Network", env[config.fishApi.proxyEnv]?.trim() ? `Proxy: ${config.fishApi.proxyEnv}` : "Default", 15, options),
    "",
    renderTuiSectionLabel("ACTIONS", { ...options, accent: "playback" }),
    ...actions.map((action, index) => formatSetupConnectionAction(selected === index + 1, index + 1, action.label, action.description, options)),
    "",
    renderTuiFooter("↑↓ Select  |  Enter Open  |  1-4 Open  |  B Back  |  Q Quit", options)
  ].join("\n");
}

function fishApiCloudVoiceStatus(config: PockedioConfig, voice: PockedioConfig["tts"]["fishVoice"], env: NodeJS.ProcessEnv): string {
  if (!env[config.fishApi.apiKeyEnv]?.trim()) {
    return "needs API key";
  }
  return config.tts.provider === "fish_api" && config.tts.fishVoice === voice ? "ready, current" : "ready";
}

export function renderDjVoiceChooserSurface(
  options: Pick<WelcomeReadinessOptions, "config" | "platform">,
  renderOptions: TuiRenderOptions & { selectedVoice?: DjVoiceChoiceId } = {}
): string {
  const platform = options.platform ?? process.platform;
  const fishReady = isFishTtsReady(options.config);
  const kokoroReady = isKokoroTtsReady(options.config);
  const selectedVoice = renderOptions.selectedVoice ?? getCurrentVoiceChoice(options.config, platform, fishReady, kokoroReady);
  return [
    renderTuiPageTitle("CHOOSE DJ VOICE", renderOptions),
    "",
    renderTuiBulletLine("Pick the voice that should represent Pockedio during spoken DJ moments.", renderOptions),
    "",
    renderTuiSectionLabel("SAMPLE", { ...renderOptions, accent: "playback" }),
    `"${voicePreviewText}"`,
    "",
    renderTuiSectionLabel("BUILT-IN VOICES", { ...renderOptions, accent: "playback" }),
    ...macosVoiceOptions.map((voice, index) => {
      const id: DjVoiceChoiceId = `macos:${voice.id}`;
      const status = platform === "darwin" ? currentVoiceLabel(id, options.config, "ready") : "unavailable";
      return formatVoiceChoiceLine(id === selectedVoice, index + 1, voice.label, status, voice.description, renderOptions);
    }),
    "",
    renderTuiSectionLabel("FAST LOCAL VOICES", { ...renderOptions, accent: "playback" }),
    ...kokoroVoiceOptions.map((voice, index) => {
      const id: DjVoiceChoiceId = `kokoro:${voice.id}`;
      const status = kokoroReady ? currentVoiceLabel(id, options.config, "ready") : "needs Kokoro TTS setup";
      return formatVoiceChoiceLine(id === selectedVoice, index + 1 + macosVoiceOptions.length, voice.label, status, voice.description, renderOptions);
    }),
    "",
    renderTuiSectionLabel("STUDIO VOICES", { ...renderOptions, accent: "playback" }),
    ...fishVoiceOptions.map((voice, index) => {
      const id: DjVoiceChoiceId = `fish:${voice.id}`;
      const status = fishReady ? currentVoiceLabel(id, options.config, "ready") : "needs Fish TTS setup";
      return formatVoiceChoiceLine(id === selectedVoice, index + 1 + macosVoiceOptions.length + kokoroVoiceOptions.length, voice.label, status, voice.description, renderOptions);
    }),
    "",
    renderTuiFooter("↑↓ Select  |  Space Preview  |  Enter Save  |  K Kokoro setup  |  F Fish setup  |  B Back", renderOptions)
  ].join("\n");
}

export function renderTasteMemorySurface(
  options: Pick<WelcomeReadinessOptions, "config">,
  renderOptions: HubRenderOptions<TasteMemoryAction> = {}
): string {
  const summary = readTasteMemorySummary(options.config);
  const selectedAction = renderOptions.selectedAction ?? "import";
  return [
    renderTuiPageTitle("TASTE & MEMORY", renderOptions),
    "",
    renderTuiBulletLine("Taste signals shape future recommendations, favorites, and station direction.", renderOptions),
    "",
    renderTuiSectionLabel("CURRENT", { ...renderOptions, accent: "playback" }),
    formatTasteLine("Imported lists", summary.importedLists, 16, renderOptions),
    formatTasteLine("Last import", summary.lastImport, 16, renderOptions),
    formatTasteLine("Taste profile", summary.profileStatus, 16, renderOptions),
    formatTasteLine("Recent signals", summary.recentSignals, 16, renderOptions),
    formatTasteLine("Session memory", summary.sessionMemory, 16, renderOptions),
    formatTasteLine("Diary", options.config.diary.enabled ? "Summary available if diary has entries" : "Not enabled", 16, renderOptions),
    "",
    renderTuiSectionLabel("ACTIONS", { ...renderOptions, accent: "playback" }),
    ...tasteMemoryEntries.map((entry, index) => formatSetupConnectionAction(
      entry.action === selectedAction,
      index + 1,
      entry.label,
      entry.description,
      renderOptions
    )),
    "",
    renderTuiFooter(`↑↓ Select  |  Enter Open  |  1-${tasteMemoryEntries.length} Open  |  B Back  |  Q Quit`, renderOptions)
  ].join("\n");
}

export function renderTasteImportResultSurface(result: TasteImportResult, options: TuiRenderOptions = {}): string {
  return [
    renderTuiPageTitle("IMPORTED PLAYLIST", options),
    "",
    renderTuiBulletLine("Playlist data was saved into taste memory for future recommendations.", options),
    "",
    renderTuiSectionLabel("RESULT", { ...options, accent: "playback" }),
    formatTasteLine("Tracks", String(result.trackCount), 14, options),
    formatTasteLine("Artists", String(result.artists.length), 14, options),
    formatTasteLine("Playlist", result.playlists.join(", ") || "Unknown", 14, options),
    formatTasteLine("Taste file", result.tastePath, 14, options),
    "",
    renderTuiSectionLabel("UPDATED", { ...options, accent: "playback" }),
    "  Imported taste signals",
    "  Taste memory",
    "",
    renderTuiFooter("Press Enter to return to Taste & Memory.", options)
  ].join("\n");
}

export function renderTasteSummarySurface(
  options: Pick<WelcomeReadinessOptions, "config">,
  renderOptions: TuiRenderOptions = {}
): string {
  const summary = readTasteMemorySummary(options.config);
  const details = readTasteMemoryDetails(options.config);
  if (!details.exists) {
    return [
      renderTuiPageTitle("TASTE SUMMARY", renderOptions),
      "",
      renderTuiBulletLine("No taste file has been created yet.", renderOptions),
      "",
      "Import a NetEase playlist first, then Pockedio can summarize your listening signals.",
      "",
      renderTuiFooter("Press Enter to return to Taste & Memory.", renderOptions)
    ].join("\n");
  }

  return [
    renderTuiPageTitle("TASTE SUMMARY", renderOptions),
    "",
    renderTuiBulletLine("Imported music signals currently available to Pockedio.", renderOptions),
    "",
    renderTuiSectionLabel("CURRENT", { ...renderOptions, accent: "playback" }),
    formatTasteLine("Imported", summary.importedLists, 14, renderOptions),
    formatTasteLine("Last import", summary.lastImport, 14, renderOptions),
    formatTasteLine("Profile", summary.profileStatus, 14, renderOptions),
    formatTasteLine("Taste file", options.config.paths.taste, 14, renderOptions),
    "",
    renderTuiSectionLabel("TOP ARTISTS", { ...renderOptions, accent: "playback" }),
    ...formatRankedList(details.topArtists, "No imported artists yet."),
    "",
    renderTuiSectionLabel("PLAYLISTS", { ...renderOptions, accent: "playback" }),
    ...formatPlainList(details.playlists, "No imported playlists yet.", 5),
    "",
    renderTuiSectionLabel("SAMPLE TRACKS", { ...renderOptions, accent: "playback" }),
    ...formatPlainList(details.sampleTracks, "No imported tracks yet.", 6),
    "",
    renderTuiFooter("Press Enter to return to Taste & Memory.", renderOptions)
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
      output.write(renderWelcomeHub(readiness, {
        selectedAction: welcomeHubEntries[selectedIndex]!.action,
        color: Boolean(output.isTTY),
        width: output.columns
      }));
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
      if (key.name === "u" && readiness.updateNotice) {
        cleanup("update");
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
    render: (action, renderOptions) => renderSetupConnectionsSurface(options, { ...renderOptions, selectedAction: action })
  });
}

export async function promptLlmSetup(options: Pick<WelcomeReadinessOptions, "config" | "env">): Promise<LlmSetupAction> {
  return promptNumberedSurface({
    entries: llmSetupEntries,
    initialAction: inferLlmSetupAction(options.config),
    render: (action, renderOptions) => renderLlmSetupSurface(options, { ...renderOptions, selectedAction: action })
  });
}

export async function promptLlmProvider(
  options: Pick<WelcomeReadinessOptions, "config" | "env">,
  providerId: LlmProviderId
): Promise<LlmProviderAction> {
  return promptNumberedSurface({
    entries: getLlmProviderEntries(providerId),
    initialAction: getLlmProviderEntries(providerId)[0]!.action,
    render: (action, renderOptions) => renderLlmProviderSurface(options, providerId, { ...renderOptions, selectedAction: action })
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
    initialAction: "choose_voice",
    render: (action, renderOptions) => renderVoiceSetupSurface(options, { ...renderOptions, selectedAction: action })
  });
}

export async function promptContextSetup(options: Pick<WelcomeReadinessOptions, "config">): Promise<ContextSetupAction> {
  return promptNumberedSurface({
    entries: contextSetupEntries,
    initialAction: "calendar",
    render: (action, renderOptions) => renderContextSetupSurface(options, { ...renderOptions, selectedAction: action })
  });
}

export async function promptDjVoiceChooser(
  options: Pick<WelcomeReadinessOptions, "config" | "platform">,
  initialVoice?: DjVoiceChoiceId
): Promise<DjVoiceChooserResult> {
  return new Promise((resolve) => {
    const entries = getDjVoiceChoiceEntries();
    let selectedVoice = initialVoice ?? getCurrentVoiceChoice(
      options.config,
      options.platform ?? process.platform,
      isFishTtsReady(options.config),
      isKokoroTtsReady(options.config)
    );
    const input = process.stdin;
    const output = process.stdout;
    const previousRawMode = input.isRaw;
    let pendingNumber = "";
    let pendingNumberTimer: NodeJS.Timeout | undefined;

    const render = () => {
      output.write("\x1B[?25l");
      output.write("\x1B[H\x1B[2J");
      output.write(renderDjVoiceChooserSurface(options, {
        selectedVoice,
        color: Boolean(output.isTTY),
        width: output.columns
      }));
    };
    const cleanup = (submit: DjVoiceChooserSubmit) => {
      if (pendingNumberTimer) {
        clearTimeout(pendingNumberTimer);
      }
      input.off("keypress", onKeypress);
      if (input.isTTY) {
        input.setRawMode(previousRawMode);
      }
      input.pause();
      output.write("\x1B[?25h\n");
      resolve({ selectedVoice, submit });
    };
    const flushPendingNumber = (): boolean => {
      if (!pendingNumber) {
        return false;
      }
      if (pendingNumberTimer) {
        clearTimeout(pendingNumberTimer);
        pendingNumberTimer = undefined;
      }
      const result = applyDjVoiceChooserNumberInput(pendingNumber);
      pendingNumber = "";
      if (result) {
        selectedVoice = result;
        return true;
      }
      return false;
    };
    const onKeypress = (_value: string, key: readline.Key) => {
      if (/^\d$/.test(key.name ?? "")) {
        pendingNumber += key.name;
        if (pendingNumberTimer) {
          clearTimeout(pendingNumberTimer);
        }
        pendingNumberTimer = setTimeout(() => {
          if (flushPendingNumber()) {
            render();
          }
        }, 350);
        pendingNumberTimer.unref();
        return;
      }
      flushPendingNumber();
      const result = applyDjVoiceChooserKey(selectedVoice, key);
      selectedVoice = result.selectedVoice;
      if (result.submit) {
        cleanup(result.submit);
        return;
      }
      render();
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

export async function promptTasteMemory(options: Pick<WelcomeReadinessOptions, "config">): Promise<TasteMemoryAction> {
  return promptNumberedSurface({
    entries: tasteMemoryEntries,
    initialAction: "import",
    render: (action, renderOptions) => renderTasteMemorySurface(options, { ...renderOptions, selectedAction: action })
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

export function applyContextSetupKey(
  selectedAction: ContextSetupAction,
  key: SelectableKeyInput
): SelectableKeyResult<ContextSetupAction> {
  return applySelectableKey({
    entries: contextSetupEntries,
    selectedAction,
    key,
    backAction: "back",
    quitAction: "quit"
  });
}

export function applyDjVoiceChooserKey(
  selectedVoice: DjVoiceChoiceId,
  key: SelectableKeyInput
): DjVoiceChooserResult {
  const entries = getDjVoiceChoiceEntries();
  const selectedIndex = Math.max(0, entries.findIndex((entry) => entry === selectedVoice));
  if (key.name === "up") {
    return {
      selectedVoice: entries[(selectedIndex - 1 + entries.length) % entries.length]!
    };
  }
  if (key.name === "down") {
    return {
      selectedVoice: entries[(selectedIndex + 1) % entries.length]!
    };
  }
  if (key.name === "space") {
    return { selectedVoice, submit: "preview" };
  }
  if (key.name === "return") {
    return { selectedVoice, submit: "save" };
  }
  const numericIndex = Number(key.name) - 1;
  if (Number.isInteger(numericIndex) && numericIndex >= 0 && numericIndex < entries.length) {
    return { selectedVoice: entries[numericIndex]! };
  }
  if (key.name === "f") {
    return { selectedVoice, submit: "fish_setup" };
  }
  if (key.name === "k") {
    return { selectedVoice, submit: "kokoro_setup" };
  }
  if (key.name === "b") {
    return { selectedVoice, submit: "back" };
  }
  if (key.name === "q" || (key.ctrl && key.name === "c")) {
    return { selectedVoice, submit: "quit" };
  }
  return {
    selectedVoice
  };
}

export function applyDjVoiceChooserNumberInput(input: string): DjVoiceChoiceId | undefined {
  const entries = getDjVoiceChoiceEntries();
  const numericIndex = Number(input) - 1;
  if (Number.isInteger(numericIndex) && numericIndex >= 0 && numericIndex < entries.length) {
    return entries[numericIndex]!;
  }
  return undefined;
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
  render: (selectedAction: TAction, renderOptions: TuiRenderOptions) => string;
}): Promise<TAction> {
  return new Promise((resolve) => {
    let selectedAction = options.initialAction;
    const input = process.stdin;
    const output = process.stdout;
    const previousRawMode = input.isRaw;

    const render = () => {
      output.write("\x1B[?25l");
      output.write("\x1B[H\x1B[2J");
      output.write(options.render(selectedAction, {
        color: Boolean(output.isTTY),
        width: output.columns
      }));
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
  if (normalized === "u" || normalized === "update") {
    return "update";
  }
  if (normalized === "q" || normalized === "quit") {
    return "quit";
  }
  return "session";
}

export function resolveSetupConnectionsAction(input: string): SetupConnectionsAction | undefined {
  const normalized = input.trim().toLowerCase();
  const numericIndex = Number(normalized) - 1;
  if (Number.isInteger(numericIndex) && numericIndex >= 0 && numericIndex < setupConnectionsEntries.length) {
    return setupConnectionsEntries[numericIndex]!.action;
  }
  if (/^\d+$/.test(normalized)) {
    return undefined;
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
  if (normalized === "c" || normalized === "context" || normalized === "calendar") {
    return "context_setup";
  }
  if (normalized === "s" || normalized === "scheduler" || normalized === "schedule") {
    return "scheduler_setup";
  }
  if (normalized === "b" || normalized === "back") {
    return "back";
  }
  if (normalized === "q" || normalized === "quit") {
    return "quit";
  }
  return "full_setup";
}

export function resolveContextSetupAction(input: string): ContextSetupAction | undefined {
  const normalized = input.trim().toLowerCase();
  const numericIndex = Number(normalized) - 1;
  if (Number.isInteger(numericIndex) && numericIndex >= 0 && numericIndex < contextSetupEntries.length) {
    return contextSetupEntries[numericIndex]!.action;
  }
  if (/^\d+$/.test(normalized)) {
    return undefined;
  }
  if (normalized === "" || normalized === "enter" || normalized === "calendar") {
    return "calendar";
  }
  if (normalized === "weather") {
    return "weather";
  }
  if (normalized === "diary") {
    return "diary";
  }
  if (normalized === "b" || normalized === "back") {
    return "back";
  }
  if (normalized === "q" || normalized === "quit") {
    return "quit";
  }
  return "calendar";
}

export function resolveLlmSetupAction(input: string): LlmSetupAction | undefined {
  const normalized = input.trim().toLowerCase();
  const numericIndex = Number(normalized) - 1;
  if (Number.isInteger(numericIndex) && numericIndex >= 0 && numericIndex < llmSetupEntries.length) {
    return llmSetupEntries[numericIndex]!.action;
  }
  if (/^\d+$/.test(normalized)) {
    return undefined;
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

export function resolveLlmProviderAction(input: string, providerId: LlmProviderId): LlmProviderAction | undefined {
  const normalized = input.trim().toLowerCase();
  const entries = getLlmProviderEntries(providerId);
  const numericIndex = Number(normalized) - 1;
  if (Number.isInteger(numericIndex) && numericIndex >= 0 && numericIndex < entries.length) {
    return entries[numericIndex]!.action;
  }
  if (/^\d+$/.test(normalized)) {
    return undefined;
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

export function resolveVoiceSetupAction(input: string): VoiceSetupAction | undefined {
  const normalized = input.trim().toLowerCase();
  const numericIndex = Number(normalized) - 1;
  if (Number.isInteger(numericIndex) && numericIndex >= 0 && numericIndex < voiceSetupEntries.length) {
    return voiceSetupEntries[numericIndex]!.action;
  }
  if (/^\d+$/.test(normalized)) {
    return undefined;
  }
  if (normalized === "" || normalized === "enter" || normalized === "choose" || normalized === "voice") {
    return "fish_api_tts";
  }
  if (normalized === "kokoro" || normalized === "fast") {
    return undefined;
  }
  if (normalized === "fish api" || normalized === "fish_api" || normalized === "cloud" || normalized === "api") {
    return "fish_api_tts";
  }
  if (normalized === "fish" || normalized === "local" || normalized === "local fish") {
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
  return undefined;
}

export function resolveTasteMemoryAction(input: string): TasteMemoryAction | undefined {
  const normalized = input.trim().toLowerCase();
  const numericIndex = Number(normalized) - 1;
  if (Number.isInteger(numericIndex) && numericIndex >= 0 && numericIndex < tasteMemoryEntries.length) {
    return tasteMemoryEntries[numericIndex]!.action;
  }
  if (/^\d+$/.test(normalized)) {
    return undefined;
  }
  if (normalized === "" || normalized === "enter" || normalized === "import") {
    return "import";
  }
  if (normalized === "summary") {
    return "show_summary";
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

function formatContextSummary(config: PockedioConfig, calendarStatus: string): string {
  const parts = [
    `Calendar ${calendarStatus.toLowerCase()}`,
    config.weather.enabled ? `Weather ${config.weather.location}` : "Weather off",
    config.diary.enabled ? "Diary on" : "Diary off"
  ];
  return parts.join(", ");
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
  if (config.tts.provider === "fish_api") {
    return { label: "Voice", value: `${formatFishVoiceName(config.tts.fishVoice)}, Fish API`, ok: isFishApiReady(config) };
  }
  if (config.tts.provider === "fish") {
    return { label: "Voice", value: `${formatFishVoiceName(config.tts.fishVoice)}, local Fish TTS`, ok: true };
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

function formatHubEntry(selected: boolean, index: number, label: string, description: string, options: TuiRenderOptions = {}): string {
  if (options.color) {
    return renderTuiRow({
      marker: selected ? ">" : " ",
      label: `${index}.`,
      text: `${label.padEnd(24)} ${description}`,
      selected,
      accent: selected ? "playback" : "dim"
    }, options);
  }
  return formatSelectableLine(selected, `${selected ? ">" : " "} ${`${index}. ${label}`.padEnd(27)} ${description}`);
}

function formatNumberedAction(selected: boolean, index: number, label: string): string {
  return formatSelectableLine(selected, `${selected ? ">" : " "} ${index}. ${label}`);
}

function formatSetupSummaryLine(readiness: WelcomeReadiness, options: TuiRenderOptions = {}): string {
  const missing = readiness.items.filter((item) => !item.ok).map((item) => item.label);
  if (missing.length === 0) {
    return renderTuiBulletLine("Ready for a listening session.", options);
  }
  return renderTuiBulletLine(`Pockedio is almost ready. ${missing.join(", ")} ${missing.length === 1 ? "needs" : "need"} attention.`, options);
}

function formatLlmSetupSummaryLine(
  keySource: ReturnType<typeof getLlmKeySource>,
  apiKeyEnv: string,
  options: TuiRenderOptions = {}
): string {
  if (keySource === "missing") {
    return renderTuiBulletLine(`LLM needs an API key before recommendations and DJ chat can run. Expected ${apiKeyEnv}.`, options);
  }
  return renderTuiBulletLine("LLM is ready for recommendations, chat, and DJ copy.", options);
}

function formatLlmProviderSummaryLine(
  providerId: LlmProviderId,
  keySource: ReturnType<typeof getLlmKeySource>,
  apiKeyEnv: string,
  options: TuiRenderOptions = {}
): string {
  if (providerId === "local_vllm") {
    return renderTuiBulletLine("Local vLLM keeps model traffic on your machine when the server is running.", options);
  }
  if (keySource === "missing") {
    return renderTuiBulletLine(`This provider needs an API key before use. Expected ${apiKeyEnv}.`, options);
  }
  return renderTuiBulletLine("This provider is ready to test with the current credentials.", options);
}

function formatProviderTitle(label: string): string {
  return `${label.toUpperCase()} SETUP`;
}

function formatVoiceSetupSummaryLine(
  config: PockedioConfig,
  platform: NodeJS.Platform,
  fishConfigured: boolean,
  kokoroConfigured: boolean,
  options: TuiRenderOptions = {}
): string {
  if (config.tts.provider === "text") {
    return renderTuiBulletLine("Spoken DJ audio is off. Pockedio can still write DJ notes.", options);
  }
  if (config.tts.provider === "fish_api") {
    return renderTuiBulletLine(isFishApiReady(config)
      ? "Fish API is ready for cloud Mina or Nova voice."
      : "Fish Audio Cloud needs an API key before cloud DJ audio works.", options);
  }
  if (fishConfigured || config.tts.provider === "fish") {
    return renderTuiBulletLine("Local Fish TTS is ready for generated Mina or Nova voice.", options);
  }
  if (kokoroConfigured || config.tts.provider === "kokoro") {
    return renderTuiBulletLine("Kokoro TTS is ready for fast local voices.", options);
  }
  if (platform === "darwin") {
    return renderTuiBulletLine("Built-in macOS voice is ready. Kokoro or Fish can add generated voices later.", options);
  }
  return renderTuiBulletLine("Spoken DJ audio needs Kokoro TTS or Fish TTS on this platform.", options);
}

function formatScheduledDjSummary(config: PockedioConfig): string {
  const morning = config.dj.schedule.morning;
  const evening = config.dj.schedule.evening;
  if (!morning.enabled && !evening.enabled) {
    return "Off";
  }

  const parts = [];
  parts.push(morning.enabled ? `Morning DJ ${morning.playTime}` : "Morning off");
  parts.push(evening.enabled ? `Evening DJ ${evening.playTime}` : "Evening off");
  return parts.join(", ");
}

function formatSetupConnectionAction(
  selected: boolean,
  index: number,
  label: string,
  description: string,
  options: TuiRenderOptions = {}
): string {
  if (options.color) {
    return renderTuiRow({
      marker: selected ? ">" : " ",
      label: `${index}.`,
      text: `${label.padEnd(29)} ${description}`,
      selected,
      accent: selected ? "playback" : "dim"
    }, options);
  }
  const marker = selected ? "▌ >" : "   ";
  const actionLabel = `${index}. ${label}`.padEnd(32);
  return formatSelectableLine(selected, `${marker} ${actionLabel} ${description}`);
}

function formatVoiceChoiceLine(
  selected: boolean,
  index: number,
  label: string,
  status: string,
  description: string,
  options: TuiRenderOptions = {}
): string {
  if (options.color) {
    return renderTuiRow({
      marker: selected ? ">" : " ",
      label: `${index}.`,
      text: `${label.padEnd(12)} ${status.padEnd(23)} ${description}`,
      selected,
      accent: selected ? "playback" : "dim"
    }, options);
  }
  return formatSelectableLine(selected, `${selected ? "▌ >" : "   "} ${`${index}. ${label}`.padEnd(12)} ${status.padEnd(23)} ${description}`);
}

function formatSelectableLine(selected: boolean, line: string): string {
  return selected ? `\x1B[7m${line}\x1B[0m` : line;
}

function formatReadinessItem(item: WelcomeReadinessItem, options: TuiRenderOptions = {}): string {
  if (!options.color) {
    return `  ${item.label.padEnd(12)} ${item.value}`;
  }
  return formatSetupLine(item.label, item.value, { ...options, accent: item.ok ? "dj" : "danger" });
}

function formatSetupLine(label: string, value: string, options: TuiRenderOptions = {}): string {
  return renderTuiKeyValue(label, value, 15, options);
}

function formatProviderLine(label: string, value: string): string {
  return `${label.padEnd(12)}${value}`;
}

function formatVoiceProvider(config: PockedioConfig, platform: NodeJS.Platform, fishConfigured: boolean, kokoroConfigured: boolean): string {
  if (config.tts.provider === "text") {
    return "Text-only DJ copy";
  }
  if (config.tts.provider === "fish_api") {
    return "Fish API";
  }
  if (config.tts.provider === "fish") {
    return "Local Fish TTS";
  }
  if (config.tts.provider === "kokoro") {
    return "Kokoro TTS";
  }
  if (config.tts.provider === "macos") {
    return platform === "darwin" ? "Built-in macOS voice" : "macOS voice unavailable here";
  }
  if (fishConfigured) {
    return "Local Fish TTS";
  }
  if (kokoroConfigured) {
    return "Kokoro TTS";
  }
  return platform === "darwin" ? "Built-in macOS voice" : "Text-only DJ copy";
}

function formatConfiguredVoice(config: PockedioConfig, platform: NodeJS.Platform): string {
  if (config.tts.provider === "text") {
    return "None";
  }
  if (config.tts.provider === "fish" || config.tts.provider === "fish_api") {
    return formatFishVoiceName(config.tts.fishVoice);
  }
  if (config.tts.provider === "kokoro") {
    return formatKokoroVoiceName(config.tts.kokoroVoice);
  }
  if (config.tts.provider === "macos" || platform === "darwin") {
    return formatMacosVoiceName(config.tts.macosVoice);
  }
  return "None";
}

function formatVoiceSetupAdvancedStatus(fishConfigured: boolean, fishApiConfigured: boolean, kokoroConfigured: boolean): string {
  const configured = [
    fishApiConfigured ? "Fish API" : undefined,
    fishConfigured ? "local Fish TTS" : undefined,
    kokoroConfigured ? "Kokoro TTS" : undefined
  ].filter((item): item is string => Boolean(item));
  if (configured.length > 0) {
    return `${configured.join(", ")} configured`;
  }
  return "Generated voices not configured";
}

export function isFishTtsReady(config: PockedioConfig): boolean {
  const pythonPath = resolveLocalPath(config.fishAudio.pythonPath);
  const scriptPath = resolveLocalPath(config.fishAudio.scriptPath);
  const modelDir = resolveLocalPath(config.fishAudio.modelDir);
  const referenceAudioPath = config.fishAudio.referenceAudioPath
    ? resolveLocalPath(config.fishAudio.referenceAudioPath)
    : undefined;
  return Boolean(
    pythonPath
    && fs.existsSync(pythonPath)
    && scriptPath
    && fs.existsSync(scriptPath)
    && modelDir
    && fs.existsSync(modelDir)
    && referenceAudioPath
    && fs.existsSync(referenceAudioPath)
    && config.fishAudio.referenceText?.trim()
  );
}

export function isKokoroTtsReady(config: PockedioConfig): boolean {
  const pythonPath = resolveLocalPath(config.kokoroAudio.pythonPath);
  const modelPath = resolveLocalPath(config.kokoroAudio.modelPath);
  const voicesPath = resolveLocalPath(config.kokoroAudio.voicesPath);
  return Boolean(
    pythonPath
    && fs.existsSync(pythonPath)
    && modelPath
    && fs.existsSync(modelPath)
    && voicesPath
    && fs.existsSync(voicesPath)
  );
}

function resolveLocalPath(value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(process.cwd(), value);
}

function getDjVoiceChoiceEntries(): DjVoiceChoiceId[] {
  return [
    ...macosVoiceOptions.map((voice) => `macos:${voice.id}` as const),
    ...kokoroVoiceOptions.map((voice) => `kokoro:${voice.id}` as const),
    ...fishVoiceOptions.map((voice) => `fish:${voice.id}` as const)
  ];
}

function getCurrentVoiceChoice(
  config: PockedioConfig,
  platform: NodeJS.Platform,
  fishReady: boolean,
  kokoroReady: boolean
): DjVoiceChoiceId {
  if (config.tts.provider === "fish" && fishReady) {
    return `fish:${config.tts.fishVoice}`;
  }
  if (config.tts.provider === "fish_api" && isFishApiReady(config)) {
    return `fish:${config.tts.fishVoice}`;
  }
  if (config.tts.provider === "kokoro" && kokoroReady) {
    return `kokoro:${config.tts.kokoroVoice}`;
  }
  if ((config.tts.provider === "macos" || config.tts.provider === "auto") && platform === "darwin") {
    return `macos:${config.tts.macosVoice}`;
  }
  return platform === "darwin" ? `macos:${config.tts.macosVoice}` : "fish:mina";
}

function currentVoiceLabel(
  id: DjVoiceChoiceId,
  config: PockedioConfig,
  status: string
): string {
  const isCurrent = (id.startsWith("macos:")
    && config.tts.provider !== "fish"
    && config.tts.provider !== "fish_api"
    && config.tts.provider !== "kokoro"
    && config.tts.provider !== "text"
    && id === `macos:${config.tts.macosVoice}`)
    || (id.startsWith("kokoro:") && config.tts.provider === "kokoro" && id === `kokoro:${config.tts.kokoroVoice}`)
    || (id.startsWith("fish:")
      && (config.tts.provider === "fish" || config.tts.provider === "fish_api")
      && id === `fish:${config.tts.fishVoice}`);
  return isCurrent ? `${status}, current` : status;
}

export function isFishApiReady(config: PockedioConfig, env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(
    env[config.fishApi.apiKeyEnv]?.trim()
    && config.fishApi.referenceIds[config.tts.fishVoice]?.trim()
  );
}

function formatTasteLine(label: string, value: string, width: number, options: TuiRenderOptions = {}): string {
  return renderTuiKeyValue(label, value, width - 1, options);
}

function getLlmProviderEntries(providerId: LlmProviderId): Array<{ action: LlmProviderAction; label: string; description: string }> {
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

function readTasteMemoryDetails(config: PockedioConfig): {
  exists: boolean;
  topArtists: Array<{ label: string; count: number }>;
  playlists: string[];
  sampleTracks: string[];
} {
  if (!fs.existsSync(config.paths.taste)) {
    return {
      exists: false,
      topArtists: [],
      playlists: [],
      sampleTracks: []
    };
  }

  const markdown = fs.readFileSync(config.paths.taste, "utf8");
  const tracks = extractMarkdownSection(markdown, "Imported Tracks")
    .map((line) => parseImportedTrackSummaryLine(line.trim()))
    .filter((track): track is { title: string; artist: string } => Boolean(track));
  const artistCounts = new Map<string, number>();
  for (const track of tracks) {
    artistCounts.set(track.artist, (artistCounts.get(track.artist) ?? 0) + 1);
  }

  return {
    exists: true,
    topArtists: [...artistCounts.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
      .slice(0, 8),
    playlists: extractMarkdownSection(markdown, "Situational Playlists")
      .map((line) => line.match(/^- (.+)$/)?.[1]?.trim())
      .filter((value): value is string => Boolean(value) && value !== "No signals yet.")
      .slice(0, 5),
    sampleTracks: tracks
      .slice(0, 6)
      .map((track) => `${track.title} - ${track.artist}`)
  };
}

function parseImportedTrackSummaryLine(line: string): { title: string; artist: string } | null {
  if (!line.startsWith("- ") || line.includes("No tracks imported yet.")) {
    return null;
  }
  const content = line.replace(/^- /, "");
  const withoutDetails = content.replace(/\s+\([^)]*\)$/, "");
  const separator = withoutDetails.lastIndexOf(" - ");
  if (separator < 0) {
    return null;
  }
  return {
    title: withoutDetails.slice(0, separator).trim(),
    artist: withoutDetails.slice(separator + 3).trim()
  };
}

function formatRankedList(items: Array<{ label: string; count: number }>, emptyLabel: string): string[] {
  if (items.length === 0) {
    return [`  ${emptyLabel}`];
  }
  return items.map((item, index) => `  ${index + 1}. ${item.label} (${item.count})`);
}

function formatPlainList(items: string[], emptyLabel: string, max: number): string[] {
  if (items.length === 0) {
    return [`  ${emptyLabel}`];
  }
  return items.slice(0, max).map((item) => `  - ${item}`);
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
