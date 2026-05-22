#!/usr/bin/env node
import { Command } from "commander";
import fs from "node:fs";
import readline from "node:readline/promises";
import { stdin as defaultInput, stdout as defaultOutput } from "node:process";
import { getPockedioHome } from "./config/paths.js";
import { loadConfig, saveConfig } from "./config/load.js";
import { hasLocalLlmApiKey, saveLlmApiKey } from "./config/llmSecrets.js";
import { runCalendarSetup, runNetEaseSetup, runSetup } from "./config/setup.js";
import { runRefreshContext } from "./context/refreshContext.js";
import { pockedioVersion } from "./index.js";
import { createLlmClient } from "./llm/openaiClient.js";
import { formatLlmPresetPreview, formatLlmPresetSaved, type LlmPresetConfig } from "./llm/setupGuidance.js";
import { discoverVllmModels } from "./llm/vllmDiscovery.js";
import { runProcess } from "./player/afplay.js";
import { runServe } from "./scheduler/serve.js";
import { runInteractiveSession } from "./session/sessionRunner.js";
import { printStatus } from "./status/status.js";
import { importTasteInput } from "./taste/importTaste.js";
import { updateTasteProfile } from "./taste/profile.js";
import {
  buildFishVoicePreview,
  buildMacosVoicePreview,
  fishVoiceOptions,
  macosVoiceOptions,
  voicePreviewText
} from "./tts/voiceSetup.js";
import {
  buildWelcomeReadiness,
  promptLlmProvider,
  promptLlmSetup,
  promptSetupConnections,
  promptTasteMemory,
  promptWelcomeHub,
  promptVoiceSetup,
  renderTasteImportResultSurface,
  renderTasteMemorySurface,
  renderVoiceSetupSurface,
  resolveDefaultEntryMode,
  type LlmProviderAction,
  type LlmProviderId,
  type LlmSetupAction,
  type SetupConnectionsAction,
  type TasteMemoryAction,
  type VoiceSetupAction,
  type WelcomeHubAction
} from "./tui/welcomeHub.js";

const program = new Command();

program
  .name("pockedio")
  .description("CLI-first personal AI music radio")
  .version(pockedioVersion)
  .option("--session", "skip the welcome hub and enter the DJ session")
  .option("--no-hub", "skip the welcome hub and enter the DJ session")
  .action(async (options: { session?: boolean; hub?: boolean }) => {
    const mode = resolveDefaultEntryMode({
      stdinIsTty: process.stdin.isTTY,
      stdoutIsTty: process.stdout.isTTY,
      forceSession: options.session,
      noHub: options.hub === false
    });
    if (mode === "session") {
      await runInteractiveSession();
      return;
    }
    await runWelcomeHubAction(await promptWelcomeHub(buildWelcomeReadiness({ config: loadConfig() })));
  });

program
  .command("setup")
  .description("Configure local Pockedio integrations and memory")
  .argument("[section]", "optional setup section, for example calendar")
  .action(async (section?: string) => {
    if (section === "calendar") {
      await runCalendarSetup();
      return;
    }
    if (section === "netease") {
      await runNetEaseSetup();
      return;
    }
    if (section === "llm") {
      await runLlmSetupLoop();
      return;
    }
    if (section === "voice") {
      await runVoiceSetupLoop();
      return;
    }
    if (section) {
      throw new Error(`Unknown setup section: ${section}`);
    }
    await runSetup();
  });

program
  .command("import-taste")
  .description("Import normalized music taste data or a NetEase playlist")
  .argument("<input>", "normalized taste CSV file, NetEase playlist link, or NetEase playlist ID")
  .action(async (input: string) => {
    const result = await importTasteInput(input);
    console.log(`Imported ${result.trackCount} tracks into ${result.tastePath}.`);
    console.log(`Artists: ${result.artists.join(", ") || "none"}`);
    console.log(`Playlists: ${result.playlists.join(", ") || "none"}`);
    console.log("Taste profile: needs refresh");
  });

program
  .command("refresh-context")
  .description("Refresh Calendar and diary context memory")
  .action(async () => {
    await runRefreshContext();
  });

program
  .command("serve")
  .description("Run scheduled DJ jobs and mood checks")
  .option("--run-once <job>", "run one implementation test job")
  .action(async (options: { runOnce?: string }) => {
    await runServe({ runOnce: options.runOnce });
  });

program
  .command("status")
  .description("Show Pockedio health and runtime status")
  .action(async () => {
    await printStatus();
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function runWelcomeHubAction(action: WelcomeHubAction): Promise<void> {
  if (action === "session") {
    await runInteractiveSession();
    return;
  }
  if (action === "setup") {
    await runSetupConnectionsAction(await promptSetupConnections({ config: loadConfig() }));
    return;
  }
  if (action === "llm_setup") {
    await runLlmSetupLoop();
    return;
  }
  if (action === "voice_setup") {
    await runVoiceSetupLoop();
    return;
  }
  if (action === "status") {
    await printStatus();
    return;
  }
  if (action === "taste") {
    await runTasteMemoryLoop();
  }
}

async function runSetupConnectionsAction(action: SetupConnectionsAction): Promise<void> {
  if (action === "full_setup") {
    await runSetup();
    return;
  }
  if (action === "llm_setup") {
    await runLlmSetupLoop();
    return;
  }
  if (action === "voice_setup") {
    await runVoiceSetupLoop();
    return;
  }
  if (action === "netease_setup") {
    await runNetEaseSetup();
    return;
  }
  if (action === "calendar_setup") {
    await runCalendarSetup();
    return;
  }
  if (action === "back") {
    await runWelcomeHubAction(await promptWelcomeHub(buildWelcomeReadiness({ config: loadConfig() })));
  }
}

type VoiceSetupOutcome = "continue" | "back" | "quit";

async function runVoiceSetupLoop(): Promise<void> {
  while (true) {
    const outcome = await runVoiceSetupAction(await promptVoiceSetup({ config: loadConfig() }));
    if (outcome === "continue") {
      continue;
    }
    if (outcome === "back") {
      await runSetupConnectionsAction(await promptSetupConnections({ config: loadConfig() }));
    }
    return;
  }
}

async function runVoiceSetupAction(action: VoiceSetupAction): Promise<VoiceSetupOutcome> {
  if (action === "preview") {
    await previewConfiguredVoice();
    return "continue";
  }
  if (action === "choose_builtin") {
    await chooseMacosVoice();
    return "continue";
  }
  if (action === "fish_tts") {
    await chooseFishVoice();
    return "continue";
  }
  if (action === "text_only") {
    saveTtsConfig({ provider: "text" });
    await pauseWithMessage("Saved voice mode: text-only DJ copy.");
    return "continue";
  }
  if (action === "back") {
    return "back";
  }
  return "quit";
}

async function previewConfiguredVoice(): Promise<void> {
  const config = loadConfig();
  if (config.tts.provider === "text") {
    await pauseWithMessage(`Text-only mode is selected. Preview copy:\n${voicePreviewText}`);
    return;
  }
  if (config.tts.provider === "fish") {
    await previewFishVoice(config.tts.fishVoice);
    return;
  }
  if (process.platform !== "darwin") {
    await pauseWithMessage("Built-in macOS voice preview is only available on macOS. Use text-only or configure Fish TTS.");
    return;
  }
  await previewMacosVoice(config.tts.macosVoice);
}

async function chooseMacosVoice(): Promise<void> {
  if (process.platform !== "darwin") {
    await pauseWithMessage("Built-in macOS voice selection is only available on macOS. Use text-only or configure Fish TTS.");
    return;
  }
  console.log("Built-in macOS voices");
  for (const [index, voice] of macosVoiceOptions.entries()) {
    console.log(`${index + 1}. ${voice.label} - ${voice.description}`);
  }
  const current = loadConfig().tts.macosVoice;
  const answer = (await askLine(`Choose voice 1-${macosVoiceOptions.length} (${current}): `)).trim();
  const selected = macosVoiceOptions[Number(answer) - 1]?.id ?? current;
  await previewMacosVoice(selected);
  saveTtsConfig({ provider: "macos", macosVoice: selected });
  await pauseWithMessage(`Saved built-in voice: ${macosVoiceOptions.find((voice) => voice.id === selected)?.label ?? selected}`);
}

async function chooseFishVoice(): Promise<void> {
  console.log("Fish TTS voices");
  for (const [index, voice] of fishVoiceOptions.entries()) {
    console.log(`${index + 1}. ${voice.label} - ${voice.description}`);
  }
  const current = loadConfig().tts.fishVoice;
  const answer = (await askLine(`Choose Fish voice 1-${fishVoiceOptions.length} (${current}): `)).trim();
  const selected = fishVoiceOptions[Number(answer) - 1]?.id ?? current;
  await previewFishVoice(selected);
  const preview = buildFishVoicePreview(selected, getPockedioHome());
  saveTtsConfig({
    provider: "fish",
    fishVoice: selected,
    fishReferenceAudioPath: preview.args[0],
    fishReferenceText: selected === "mina"
      ? "Mina is here. Soft lights, warm songs, and a little room to breathe."
      : "Nova here. Bright rhythm, clean motion, and just enough spark to move."
  });
  await pauseWithMessage(`Saved Fish voice: ${fishVoiceOptions.find((voice) => voice.id === selected)?.label ?? selected}`);
}

async function previewMacosVoice(voiceId: ReturnType<typeof loadConfig>["tts"]["macosVoice"]): Promise<void> {
  const preview = buildMacosVoicePreview(voiceId);
  console.log(`Playing ${preview.label} preview...`);
  const result = await runProcess(preview.command, preview.args, 12_000);
  if (!result.ok) {
    await pauseWithMessage(`Voice preview failed: ${result.error ?? `exit ${result.exitCode ?? "null"}`}`);
  }
}

async function previewFishVoice(voiceId: ReturnType<typeof loadConfig>["tts"]["fishVoice"]): Promise<void> {
  const preview = buildFishVoicePreview(voiceId, getPockedioHome());
  if (!fs.existsSync(preview.args[0]!)) {
    await pauseWithMessage([
      `${preview.label} preview file was not found.`,
      `Expected: ${preview.args[0]}`,
      "Run full setup or add the preview WAV before using Fish voice previews."
    ].join("\n"));
    return;
  }
  console.log(`Playing ${preview.label} preview...`);
  const result = await runProcess(preview.command, preview.args, 12_000);
  if (!result.ok) {
    await pauseWithMessage(`Fish voice preview failed: ${result.error ?? `exit ${result.exitCode ?? "null"}`}`);
  }
}

function saveTtsConfig(input: {
  provider: ReturnType<typeof loadConfig>["tts"]["provider"];
  macosVoice?: ReturnType<typeof loadConfig>["tts"]["macosVoice"];
  fishVoice?: ReturnType<typeof loadConfig>["tts"]["fishVoice"];
  fishReferenceAudioPath?: string;
  fishReferenceText?: string;
}): void {
  const config = loadConfig();
  saveConfig({
    ...config,
    tts: {
      ...config.tts,
      provider: input.provider,
      macosVoice: input.macosVoice ?? config.tts.macosVoice,
      fishVoice: input.fishVoice ?? config.tts.fishVoice
    },
    fishAudio: {
      ...config.fishAudio,
      referenceAudioPath: input.fishReferenceAudioPath ?? config.fishAudio.referenceAudioPath,
      referenceText: input.fishReferenceText ?? config.fishAudio.referenceText
    }
  });
}

type TasteMemoryOutcome = "continue" | "back" | "quit";

async function runTasteMemoryLoop(): Promise<void> {
  while (true) {
    const outcome = await runTasteMemoryAction(await promptTasteMemory({ config: loadConfig() }));
    if (outcome === "continue") {
      continue;
    }
    if (outcome === "back") {
      await runWelcomeHubAction(await promptWelcomeHub(buildWelcomeReadiness({ config: loadConfig() })));
    }
    return;
  }
}

async function runTasteMemoryAction(action: TasteMemoryAction): Promise<TasteMemoryOutcome> {
  if (action === "import") {
    const input = await askLine("Playlist link, NetEase playlist ID, or taste CSV path: ");
    if (input.trim()) {
      const result = await importTasteInput(input.trim());
      await pauseWithMessage(renderTasteImportResultSurface(result));
    }
    return "continue";
  }
  if (action === "rebuild_profile") {
    const result = updateTasteProfile(loadConfig());
    await pauseWithMessage(`Taste profile rebuilt from ${result.signalCount} local feedback signals.\nTaste file: ${result.tastePath}`);
    return "continue";
  }
  if (action === "show_summary") {
    await pauseWithMessage(renderTasteMemorySurface({ config: loadConfig() }));
    return "continue";
  }
  if (action === "start_station") {
    await pauseWithMessage("Start station from latest import is planned for the next Taste & Memory slice.");
    return "continue";
  }
  if (action === "back") {
    return "back";
  }
  return "quit";
}

type LlmSetupOutcome = "continue" | "back" | "quit";

async function runLlmSetupLoop(): Promise<void> {
  while (true) {
    const outcome = await runLlmSetupAction(await promptLlmSetup({ config: loadConfig() }));
    if (outcome === "continue") {
      continue;
    }
    if (outcome === "back") {
      await runSetupConnectionsAction(await promptSetupConnections({ config: loadConfig() }));
    }
    return;
  }
}

async function runLlmSetupAction(action: LlmSetupAction): Promise<LlmSetupOutcome> {
  if (action === "custom") {
    return runLlmProviderLoop("custom");
  }
  if (isLlmProviderId(action)) {
    return runLlmProviderLoop(action);
  }
  if (action === "test_connection") {
    await testLlmConnection();
    return "continue";
  }
  if (action === "back") {
    return "back";
  }
  return "quit";
}

async function runLlmProviderLoop(providerId: LlmProviderId): Promise<LlmSetupOutcome> {
  while (true) {
    const outcome = await runLlmProviderAction(providerId, await promptLlmProvider({ config: loadConfig() }, providerId));
    if (outcome === "continue") {
      continue;
    }
    if (outcome === "back") {
      return "continue";
    }
    return outcome;
  }
}

async function runLlmProviderAction(
  providerId: LlmProviderId,
  action: LlmProviderAction
): Promise<LlmSetupOutcome> {
  if (action === "paste_key") {
    const preset = getLlmPreset(providerId);
    saveLlmConfig(preset);
    await pasteLlmApiKey(preset.apiKeyEnv);
    return "continue";
  }
  if (action === "use_shell_env") {
    const preset = getLlmPreset(providerId);
    saveLlmConfig(preset);
    await pauseWithMessage(formatLlmPresetSaved(getLlmProviderLabel(providerId), preset));
    return "continue";
  }
  if (action === "change_model") {
    await changeLlmProviderModel(providerId);
    return "continue";
  }
  if (action === "change_base_url") {
    await changeLlmProviderBaseUrl(providerId);
    return "continue";
  }
  if (action === "change_api_key_env") {
    await changeLlmProviderApiKeyEnv(providerId);
    return "continue";
  }
  if (action === "check_server") {
    await checkVllmServer();
    return "continue";
  }
  if (action === "discover_models") {
    await discoverAndSaveVllmModel();
    return "continue";
  }
  if (action === "test_connection") {
    saveLlmConfig(getLlmPreset(providerId));
    await testLlmConnection();
    return "continue";
  }
  if (action === "back") {
    return "back";
  }
  return "quit";
}

async function applyLlmPresetWithConfirmation(
  label: string,
  llm: LlmPresetConfig
): Promise<LlmSetupOutcome> {
  console.log(formatLlmPresetPreview(label, llm));
  const answer = (await askLine("Apply this preset? [y/N] ")).trim().toLowerCase();
  if (answer !== "y" && answer !== "yes") {
    return "continue";
  }
  saveLlmConfig(llm);
  if (!process.env[llm.apiKeyEnv]) {
    const answer = (await askLine(`Paste ${llm.apiKeyEnv} now? [y/N] `)).trim().toLowerCase();
    if (answer === "y" || answer === "yes") {
      await pasteLlmApiKey(llm.apiKeyEnv);
      return "continue";
    }
  }
  await pauseWithMessage(formatLlmPresetSaved(label, llm));
  return "continue";
}

function isLlmProviderId(action: LlmSetupAction): action is LlmProviderId {
  return action === "openai" || action === "deepseek" || action === "openrouter" || action === "local_vllm" || action === "custom";
}

function getLlmProviderLabel(providerId: LlmProviderId): string {
  if (providerId === "openai") {
    return "OpenAI";
  }
  if (providerId === "deepseek") {
    return "DeepSeek";
  }
  if (providerId === "openrouter") {
    return "OpenRouter";
  }
  if (providerId === "local_vllm") {
    return "local vLLM";
  }
  return "custom OpenAI-compatible";
}

function getLlmPreset(providerId: LlmProviderId): LlmPresetConfig {
  const current = loadConfig();
  const currentProvider = inferLlmProviderId(current);
  const currentConfig = currentProvider === providerId
    ? {
        model: current.llm.model,
        baseUrl: current.llm.baseUrl,
        apiKeyEnv: current.llm.apiKeyEnv
      }
    : undefined;
  if (providerId === "openai") {
    return { model: currentConfig?.model ?? "gpt-4.1-mini", baseUrl: currentConfig?.baseUrl, apiKeyEnv: currentConfig?.apiKeyEnv ?? "OPENAI_API_KEY" };
  }
  if (providerId === "deepseek") {
    return { model: currentConfig?.model ?? "deepseek-chat", baseUrl: currentConfig?.baseUrl ?? "https://api.deepseek.com", apiKeyEnv: currentConfig?.apiKeyEnv ?? "DEEPSEEK_API_KEY" };
  }
  if (providerId === "openrouter") {
    return { model: currentConfig?.model ?? "openai/gpt-4.1-mini", baseUrl: currentConfig?.baseUrl ?? "https://openrouter.ai/api/v1", apiKeyEnv: currentConfig?.apiKeyEnv ?? "OPENROUTER_API_KEY" };
  }
  if (providerId === "local_vllm") {
    return { model: currentConfig?.model ?? "local-model", baseUrl: currentConfig?.baseUrl ?? "http://127.0.0.1:8000/v1", apiKeyEnv: currentConfig?.apiKeyEnv ?? "VLLM_API_KEY" };
  }
  return {
    model: current.llm.model,
    baseUrl: current.llm.baseUrl,
    apiKeyEnv: current.llm.apiKeyEnv
  };
}

function inferLlmProviderId(config: ReturnType<typeof loadConfig>): LlmProviderId {
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

function saveLlmConfig(llm: LlmPresetConfig): void {
  const config = loadConfig();
  saveConfig({
    ...config,
    llm: {
      provider: "openai",
      model: llm.model,
      baseUrl: llm.baseUrl,
      apiKeyEnv: llm.apiKeyEnv
    }
  });
}

function printSavedLlm(label: string): void {
  console.log(`Saved LLM preset: ${label}`);
}

async function changeLlmProviderModel(providerId: LlmProviderId): Promise<void> {
  const preset = getLlmPreset(providerId);
  const model = (await askLine(`Model (${preset.model}): `)).trim() || preset.model;
  saveLlmConfig({ ...preset, model });
  await pauseWithMessage(`Saved ${getLlmProviderLabel(providerId)} model: ${model}`);
}

async function changeLlmProviderBaseUrl(providerId: LlmProviderId): Promise<void> {
  const preset = getLlmPreset(providerId);
  const currentBaseUrl = preset.baseUrl ?? "OpenAI default";
  const baseUrlInput = (await askLine(`Base URL (${currentBaseUrl}): `)).trim();
  saveLlmConfig({
    ...preset,
    baseUrl: baseUrlInput || preset.baseUrl
  });
  await pauseWithMessage(`Saved ${getLlmProviderLabel(providerId)} base URL: ${baseUrlInput || currentBaseUrl}`);
}

async function changeLlmProviderApiKeyEnv(providerId: LlmProviderId): Promise<void> {
  const preset = getLlmPreset(providerId);
  const apiKeyEnv = (await askLine(`API key env (${preset.apiKeyEnv}): `)).trim() || preset.apiKeyEnv;
  saveLlmConfig({ ...preset, apiKeyEnv });
  await pauseWithMessage(`Saved ${getLlmProviderLabel(providerId)} API key env: ${apiKeyEnv}`);
}

async function checkVllmServer(): Promise<void> {
  const preset = getLlmPreset("local_vllm");
  const result = await discoverVllmModels(preset.baseUrl ?? "http://127.0.0.1:8000/v1");
  if (result.ok) {
    await pauseWithMessage(`vLLM server is reachable. Found ${result.models.length} model${result.models.length === 1 ? "" : "s"}.`);
    return;
  }
  await pauseWithMessage(`vLLM server check failed: ${result.error}`);
}

async function discoverAndSaveVllmModel(): Promise<void> {
  const preset = getLlmPreset("local_vllm");
  const baseUrl = preset.baseUrl ?? "http://127.0.0.1:8000/v1";
  const result = await discoverVllmModels(baseUrl);
  if (!result.ok) {
    await pauseWithMessage(`vLLM model discovery failed: ${result.error}`);
    return;
  }
  const selected = result.models[0]!;
  saveLlmConfig({ ...preset, model: selected, baseUrl });
  const config = loadConfig();
  if (!process.env[preset.apiKeyEnv] && !hasLocalLlmApiKey(config, preset.apiKeyEnv)) {
    saveLlmApiKey(config, preset.apiKeyEnv, "vllm-local");
  }
  await pauseWithMessage(`Saved local vLLM model: ${selected}`);
}

async function runCustomLlmSetup(): Promise<void> {
  const current = loadConfig();
  const rl = readline.createInterface({ input: defaultInput, output: defaultOutput });
  let apiKeyEnv = current.llm.apiKeyEnv;
  try {
    const model = (await rl.question(`Model (${current.llm.model}): `)).trim() || current.llm.model;
    const baseUrlInput = (await rl.question(`Base URL (${current.llm.baseUrl ?? "OpenAI default"}): `)).trim();
    apiKeyEnv = (await rl.question(`API key env (${current.llm.apiKeyEnv}): `)).trim() || current.llm.apiKeyEnv;
    saveLlmConfig({
      model,
      baseUrl: baseUrlInput || undefined,
      apiKeyEnv
    });
  } finally {
    rl.close();
  }
  printSavedLlm("custom OpenAI-compatible");
  if (!process.env[apiKeyEnv] && !hasLocalLlmApiKey(loadConfig(), apiKeyEnv)) {
    const answer = (await askLine(`Paste ${apiKeyEnv} now? [y/N] `)).trim().toLowerCase();
    if (answer === "y" || answer === "yes") {
      await pasteLlmApiKey(apiKeyEnv);
    }
  }
}

async function testLlmConnection(): Promise<void> {
  const config = loadConfig();
  console.log("Testing LLM connection...");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  const result = await createLlmClient(config).generateText("Reply with: ok", { signal: controller.signal });
  clearTimeout(timeout);
  if (result.ok) {
    await pauseWithMessage("LLM connection: configured");
    return;
  }
  await pauseWithMessage([
    `LLM connection: ${result.errorCode === "llm_unavailable" ? "missing key" : "failed"}`,
    result.error
  ].join("\n"));
}

async function askLine(message: string): Promise<string> {
  const rl = readline.createInterface({ input: defaultInput, output: defaultOutput });
  try {
    return await rl.question(message);
  } finally {
    rl.close();
  }
}

async function pasteLlmApiKey(apiKeyEnv = loadConfig().llm.apiKeyEnv): Promise<void> {
  const config = loadConfig();
  const apiKey = (await askHiddenLine(`Paste API key for ${apiKeyEnv}: `)).trim();
  if (!apiKey) {
    await pauseWithMessage("No API key saved.");
    return;
  }
  saveLlmApiKey(config, apiKeyEnv, apiKey);
  await pauseWithMessage(`Saved local secret for ${apiKeyEnv}. Choose Test connection to verify it.`);
}

async function askHiddenLine(message: string): Promise<string> {
  if (!defaultInput.isTTY) {
    return askLine(message);
  }
  return new Promise((resolve) => {
    let value = "";
    const previousRawMode = defaultInput.isRaw;
    const cleanup = () => {
      defaultInput.off("data", onData);
      defaultInput.setRawMode(previousRawMode);
      defaultInput.pause();
      defaultOutput.write("\n");
    };
    const finish = () => {
      cleanup();
      resolve(value);
    };
    const onData = (chunk: Buffer) => {
      for (const char of chunk.toString("utf8")) {
        if (char === "\u0003") {
          value = "";
          finish();
          return;
        }
        if (char === "\r" || char === "\n") {
          finish();
          return;
        }
        if (char === "\u007f" || char === "\b") {
          value = value.slice(0, -1);
          continue;
        }
        value += char;
      }
    };
    defaultOutput.write(message);
    defaultInput.resume();
    defaultInput.setRawMode(true);
    defaultInput.on("data", onData);
  });
}

async function pauseWithMessage(message: string): Promise<void> {
  console.log(message);
  console.log("");
  await askLine("Press Enter to return.");
}
