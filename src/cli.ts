#!/usr/bin/env node
import { Command } from "commander";
import fs from "node:fs";
import readline from "node:readline/promises";
import { emitKeypressEvents, type Key } from "node:readline";
import { stdin as defaultInput, stdout as defaultOutput } from "node:process";
import { getPockedioHome } from "./config/paths.js";
import { loadConfig, saveConfig } from "./config/load.js";
import { hasLocalLlmApiKey, saveLlmApiKey } from "./config/llmSecrets.js";
import { runCalendarSetup, runDiarySetup, runNetEaseSetup, runSchedulerSetup, runWeatherSetup } from "./config/setup.js";
import { startDailyContextHeartbeat } from "./context/heartbeat.js";
import { runRefreshContext } from "./context/refreshContext.js";
import { pockedioVersion } from "./index.js";
import { createLlmClient } from "./llm/openaiClient.js";
import { formatLlmPresetPreview, formatLlmPresetSaved, type LlmPresetConfig } from "./llm/setupGuidance.js";
import { discoverVllmModels } from "./llm/vllmDiscovery.js";
import { runProcess } from "./player/afplay.js";
import { runServe } from "./scheduler/serve.js";
import { runInteractiveSession } from "./session/sessionRunner.js";
import { runFullSetupWizard, type FullSetupStepId } from "./setup/fullSetupWizard.js";
import { formatStatusReport, getStatusReport, printStatus } from "./status/status.js";
import { importTasteInput } from "./taste/importTaste.js";
import { importTasteFromNetEasePlaylist } from "./taste/neteasePlaylist.js";
import {
  buildFishVoicePreview,
  buildMacosVoicePreview,
  fishVoiceOptions,
  macosVoiceOptions,
  voicePreviewText
} from "./tts/voiceSetup.js";
import { synthesizeFishAudio } from "./tts/fishAudio.js";
import {
  buildFishSetupInstallCommands,
  detectFishTtsInstall,
  formatDetectedFishSetup,
  type FishSetupDetection
} from "./tts/fishSetup.js";
import {
  buildWelcomeReadiness,
  isFishTtsReady,
  promptDjVoiceChooser,
  promptContextSetup,
  promptLlmProvider,
  promptLlmSetup,
  promptSetupConnections,
  promptTasteMemory,
  promptWelcomeHub,
  promptVoiceSetup,
  renderTasteImportResultSurface,
  renderTasteMemorySurface,
  renderTasteSummarySurface,
  renderVoiceSetupSurface,
  resolveDefaultEntryMode,
  type ContextSetupAction,
  type DjVoiceChoiceId,
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
    const config = loadConfig();
    startDailyContextHeartbeat(config);
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
    await runWelcomeHubAction(await promptWelcomeHub(buildWelcomeReadiness({ config })));
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
    if (section === "weather") {
      await runWeatherSetup();
      return;
    }
    if (section === "diary") {
      await runDiarySetup();
      return;
    }
    if (section === "context") {
      await runContextSetupLoop();
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
    if (section === "scheduler" || section === "schedule") {
      await runSchedulerSetup();
      return;
    }
    if (section) {
      throw new Error(`Unknown setup section: ${section}`);
    }
    await runFullSetup();
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
  .option("--diary-history", "scan historical diary files into summary-only memory")
  .action(async (options: { diaryHistory?: boolean }) => {
    await runRefreshContext({ diaryHistory: Boolean(options.diaryHistory) });
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
    await runSetupConnectionsLoop();
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
    await showInteractiveStatus();
    return;
  }
  if (action === "taste") {
    await runTasteMemoryLoop();
  }
}

async function showInteractiveStatus(): Promise<void> {
  await pauseWithMessage(formatStatusReport(await getStatusReport()));
  await runWelcomeHubAction(await promptWelcomeHub(buildWelcomeReadiness({ config: loadConfig() })));
}

type SetupConnectionsOutcome = "continue" | "back" | "quit";

async function runSetupConnectionsLoop(): Promise<void> {
  while (true) {
    const outcome = await runSetupConnectionsAction(await promptSetupConnections({ config: loadConfig() }));
    if (outcome === "continue") {
      continue;
    }
    if (outcome === "back") {
      await runWelcomeHubAction(await promptWelcomeHub(buildWelcomeReadiness({ config: loadConfig() })));
    }
    return;
  }
}

async function runSetupConnectionsAction(action: SetupConnectionsAction): Promise<SetupConnectionsOutcome> {
  if (action === "full_setup") {
    await runFullSetup();
    return "continue";
  }
  if (action === "llm_setup") {
    await runLlmSetupLoop();
    return "continue";
  }
  if (action === "voice_setup") {
    await runVoiceSetupLoop();
    return "continue";
  }
  if (action === "netease_setup") {
    const outcome = await runNetEaseSetup();
    return outcome === "quit" ? "quit" : "continue";
  }
  if (action === "context_setup") {
    const outcome = await runContextSetupLoop();
    return outcome === "quit" ? "quit" : "continue";
  }
  if (action === "scheduler_setup") {
    const outcome = await runSchedulerSetup();
    return outcome === "quit" ? "quit" : "continue";
  }
  if (action === "back") {
    return "back";
  }
  return "quit";
}

async function runFullSetup(): Promise<void> {
  console.log("Pockedio full setup");
  console.log("");
  console.log("Steps 1-5 guide the required decisions. Schedule DJ is optional.");
  console.log("");
  await runFullSetupWizard({
    runStep: runFullSetupStep,
    confirmOptionalStep: async (step) => {
      if (step === "scheduler") {
        return confirmFullSetupOptionalStep("Step 6/6: Configure Schedule DJ now?", false);
      }
      return confirmFullSetupOptionalStep("Enter the DJ session now and try Pockedio?", true);
    },
    pause: pauseWithMessage,
    enterSession: runInteractiveSession
  });
}

async function runFullSetupStep(step: FullSetupStepId): Promise<"done" | "back" | "quit"> {
  console.log(formatFullSetupStepHeader(step));
  if (step === "llm") {
    return normalizeSetupOutcome(await runLlmSetupLoop({ returnOnConfigured: true }));
  }
  if (step === "voice") {
    return normalizeSetupOutcome(await runVoiceSetupLoop({ returnOnConfigured: true }));
  }
  if (step === "netease") {
    return normalizeSetupOutcome(await runNetEaseSetup());
  }
  if (step === "playlist") {
    return await importNetEasePlaylistFromSetup();
  }
  if (step === "context") {
    console.log("Configure any context sources you want, then press B to continue full setup.");
    return normalizeSetupOutcome(await runContextSetupLoop());
  }
  return normalizeSetupOutcome(await runSchedulerSetup());
}

function normalizeSetupOutcome(outcome: "continue" | "done" | "back" | "quit" | void): "done" | "back" | "quit" {
  if (outcome === "quit") {
    return "quit";
  }
  if (outcome === "back") {
    return "back";
  }
  return "done";
}

function formatFullSetupStepHeader(step: FullSetupStepId): string {
  const labels: Record<FullSetupStepId, string> = {
    llm: "Step 1/6: Configure LLM",
    voice: "Step 2/6: Configure Voice",
    netease: "Step 3/6: Configure NetEase playback",
    playlist: "Step 4/6: Import NetEase playlist",
    context: "Step 5/6: Configure Context",
    scheduler: "Step 6/6: Configure Schedule DJ"
  };
  return ["", labels[step], ""].join("\n");
}

async function confirmFullSetupOptionalStep(label: string, defaultYes: boolean): Promise<boolean> {
  const suffix = defaultYes ? "[Y/n]" : "[y/N]";
  const answer = (await askLine(`${label} ${suffix} `)).trim().toLowerCase();
  if (!answer) {
    return defaultYes;
  }
  return answer === "y" || answer === "yes";
}

async function importNetEasePlaylistFromSetup(): Promise<"done" | "back"> {
  const input = await askLineWithBack("NetEase playlist link or ID");
  if (input === "back") {
    return "back";
  }
  if (!input.trim()) {
    await pauseWithMessage("Skipped playlist import.");
    return "done";
  }
  const result = await withCliProgress("Importing NetEase playlist...", () =>
    importTasteFromNetEasePlaylist(input.trim(), loadConfig())
  );
  await pauseWithMessage(renderTasteImportResultSurface(result));
  return "done";
}

type ContextSetupOutcome = "continue" | "back" | "quit";

async function runContextSetupLoop(): Promise<ContextSetupOutcome> {
  while (true) {
    const outcome = await runContextSetupAction(await promptContextSetup({ config: loadConfig() }));
    if (outcome === "continue") {
      continue;
    }
    return outcome;
  }
}

async function runContextSetupAction(action: ContextSetupAction): Promise<ContextSetupOutcome> {
  if (action === "calendar") {
    const outcome = await runCalendarSetup();
    return outcome === "quit" ? "quit" : "continue";
  }
  if (action === "weather") {
    const outcome = await runWeatherSetup();
    return outcome === "quit" ? "quit" : "continue";
  }
  if (action === "diary") {
    const outcome = await runDiarySetup();
    return outcome === "quit" ? "quit" : "continue";
  }
  if (action === "back") {
    return "back";
  }
  return "quit";
}

type VoiceSetupOutcome = "continue" | "done" | "back" | "quit";

async function runVoiceSetupLoop(options: { returnOnConfigured?: boolean } = {}): Promise<VoiceSetupOutcome> {
  while (true) {
    const outcome = await runVoiceSetupAction(await promptVoiceSetup({ config: loadConfig() }), options);
    if (outcome === "continue") {
      continue;
    }
    if (outcome === "done") {
      return "done";
    }
    if (outcome === "back") {
      if (options.returnOnConfigured) {
        return "back";
      }
      await runSetupConnectionsLoop();
      return "back";
    }
    return outcome;
  }
}

async function runVoiceSetupAction(
  action: VoiceSetupAction,
  options: { returnOnConfigured?: boolean } = {}
): Promise<VoiceSetupOutcome> {
  if (action === "choose_voice") {
    return chooseDjVoice(undefined, options);
  }
  if (action === "fish_tts") {
    return await configureFishTts() === "quit" ? "quit" : "continue";
  }
  if (action === "text_only") {
    saveTtsConfig({ provider: "text" });
    await pauseWithMessage("Saved voice mode: text-only DJ copy.");
    return options.returnOnConfigured ? "done" : "continue";
  }
  if (action === "back") {
    return "back";
  }
  return "quit";
}

async function chooseDjVoice(
  initialVoice?: DjVoiceChoiceId,
  options: { returnOnConfigured?: boolean } = {}
): Promise<VoiceSetupOutcome> {
  let selectedVoice = initialVoice;
  while (true) {
    const result = await promptDjVoiceChooser({ config: loadConfig(), platform: process.platform }, selectedVoice);
    selectedVoice = result.selectedVoice;
    if (result.submit === "preview") {
      await previewDjVoiceChoice(result.selectedVoice);
      continue;
    }
    if (result.submit === "save") {
      await saveDjVoiceChoice(result.selectedVoice);
      return options.returnOnConfigured ? "done" : "continue";
    }
    if (result.submit === "fish_setup") {
      if (await configureFishTts() === "quit") {
        return "quit";
      }
      continue;
    }
    if (result.submit === "back") {
      return "continue";
    }
    if (result.submit === "quit") {
      return "quit";
    }
  }
}

async function previewDjVoiceChoice(choice: DjVoiceChoiceId): Promise<void> {
  const parsed = parseDjVoiceChoice(choice);
  if (parsed.provider === "macos") {
    if (process.platform !== "darwin") {
      await pauseWithMessage("Built-in voice previews require macOS. Configure Fish TTS or use text-only DJ copy on this platform.");
      return;
    }
    await previewMacosVoice(parsed.voice);
    return;
  }
  if (!isFishTtsReady(loadConfig())) {
    await pauseWithMessage(formatFishTtsMissingMessage());
    return;
  }
  await previewFishVoice(parsed.voice);
}

async function saveDjVoiceChoice(choice: DjVoiceChoiceId): Promise<void> {
  const parsed = parseDjVoiceChoice(choice);
  if (parsed.provider === "macos") {
    if (process.platform !== "darwin") {
      await pauseWithMessage("Cannot save a built-in macOS voice on this platform. Configure Fish TTS or use text-only DJ copy.");
      return;
    }
    saveTtsConfig({ provider: "macos", macosVoice: parsed.voice });
    await pauseWithMessage(`Saved built-in voice: ${macosVoiceOptions.find((voice) => voice.id === parsed.voice)?.label ?? parsed.voice}`);
    return;
  }
  if (!isFishTtsReady(loadConfig())) {
    await pauseWithMessage([
      "Configure Fish TTS before saving Mina or Nova.",
      "",
      formatFishTtsMissingMessage()
    ].join("\n"));
    return;
  }
  const preview = buildFishVoicePreview(parsed.voice, getPockedioHome());
  saveTtsConfig({
    provider: "fish",
    fishVoice: parsed.voice,
    fishReferenceAudioPath: preview.args[0],
    fishReferenceText: fishReferenceText(parsed.voice)
  });
  await pauseWithMessage(`Saved Fish voice: ${fishVoiceOptions.find((voice) => voice.id === parsed.voice)?.label ?? parsed.voice}`);
}

async function configureFishTts(): Promise<"back" | "quit"> {
  while (true) {
    const config = loadConfig();
    const answer = await promptFishNumberedSurface(4, (selected) => renderFishTtsSetupSurface(config, selected));
    if (answer === "back" || answer === "quit") {
      return answer;
    }
    if (answer === 1) {
      await installFishTtsLocally();
      continue;
    }
    if (answer === 2) {
      await useExistingFishTtsInstall();
      continue;
    }
    if (answer === 3) {
      await editFishTtsPathsManually();
      continue;
    }
    if (answer === 4) {
      const next = await testFishTtsSetup();
      if (next === "choose") {
        await chooseDjVoice(`fish:${loadConfig().tts.fishVoice}`);
      }
      return "back";
    }
  }
}

async function installFishTtsLocally(): Promise<void> {
  const commands = buildFishSetupInstallCommands();
  console.log([
    "Install Fish TTS locally",
    "",
    "This is optional. Built-in voices work without Fish TTS.",
    "",
    "Requirements:",
    "- Apple Silicon Mac recommended",
    "- Python 3.13 available through uv",
    "- Network access for GitHub and Hugging Face",
    "- Several GB of disk space for the model",
    "",
    "Commands:",
    ...commands.map((command) => `- ${formatCommand(command.command, command.args)}`)
  ].join("\n"));
  const confirm = (await askLine("Run these commands now? [y/N] ")).trim().toLowerCase();
  if (confirm !== "y" && confirm !== "yes") {
    await pauseWithMessage("Fish install was not started. You can run the shown commands yourself, then choose Use existing Fish TTS install.");
    return;
  }

  for (const command of commands) {
    if (command.command === "git" && command.args[0] === "clone" && fs.existsSync(command.args[2]!)) {
      continue;
    }
    const result = await withCliProgress(`Running ${command.label}...`, () => runProcess(command.command, command.args, 600_000));
    if (!result.ok) {
      await pauseWithMessage(`Fish install failed during "${command.label}".\n${result.error ?? `exit ${result.exitCode ?? "null"}`}`);
      return;
    }
  }

  const detection = detectFishTtsInstall(loadConfig(), getPockedioHome());
  saveDetectedFishSetup(detection);
  await pauseWithMessage([
    "Fish TTS install completed.",
    "",
    formatDetectedFishSetup(detection),
    "",
    "Run Test Fish TTS next to verify synthesis."
  ].join("\n"));
}

async function useExistingFishTtsInstall(): Promise<void> {
  while (true) {
    const detection = await withCliProgress("Searching Fish TTS install...", async () => detectFishTtsInstall(loadConfig(), getPockedioHome()));
    const answer = await promptFishNumberedSurface(3, (selected) => renderUseExistingFishTtsSurface(detection, selected));
    if (answer === "back" || answer === "quit") {
      return;
    }
    if (answer === 1) {
      if (detection.missing.length > 0) {
        await pauseWithMessage([
          "Detected setup is incomplete.",
          ...detection.missing.map((item) => `- Missing: ${item}`),
          "",
          "Choose Edit paths, Install Fish TTS locally, or add the missing files and search again."
        ].join("\n"));
        continue;
      }
      await withCliProgress("Saving detected Fish TTS setup...", async () => saveDetectedFishSetup(detection));
      await pauseWithMessage("Saved detected Fish TTS setup. Run Test Fish TTS next.");
      return;
    }
    if (answer === 2) {
      await editFishTtsPathsManually();
      return;
    }
    if (answer === 3) {
      continue;
    }
  }
}

async function editFishTtsPathsManually(): Promise<void> {
  while (true) {
    const config = loadConfig();
    const answer = await promptFishNumberedSurface(6, (selected) => renderFishTtsManualPathSurface(config, selected));
    if (answer === "back" || answer === "quit") {
      return;
    }
    if (answer === 1) {
      const pythonPath = await askLineWithBack("Python path", config.fishAudio.pythonPath);
      if (pythonPath !== "back") {
        saveFishAudioConfig({ pythonPath: pythonPath || config.fishAudio.pythonPath });
      }
      continue;
    }
    if (answer === 2) {
      const scriptPath = await askLineWithBack("Fish script path", config.fishAudio.scriptPath);
      if (scriptPath !== "back") {
        saveFishAudioConfig({ scriptPath: scriptPath || config.fishAudio.scriptPath });
      }
      continue;
    }
    if (answer === 3) {
      const modelDir = await askLineWithBack("Model directory", config.fishAudio.modelDir);
      if (modelDir !== "back") {
        saveFishAudioConfig({ modelDir: modelDir || config.fishAudio.modelDir });
      }
      continue;
    }
    if (answer === 4) {
      saveFishReference("mina");
      await pauseWithMessage("Saved Mina as the Fish reference voice.");
      continue;
    }
    if (answer === 5) {
      saveFishReference("nova");
      await pauseWithMessage("Saved Nova as the Fish reference voice.");
      continue;
    }
    if (answer === 6) {
      await testFishTtsSetup();
      return;
    }
  }
}

async function testFishTtsSetup(): Promise<"choose" | "return" | "keep"> {
  const config = loadConfig();
  if (!isFishTtsReady(config)) {
    await pauseWithMessage(formatFishTtsMissingMessage());
    return "return";
  }
  const result = await withCliProgress("Testing Fish TTS...", () => synthesizeFishAudio(config, voicePreviewText, { timeoutMs: 120_000 }));
  if (!result.ok) {
    await pauseWithMessage(`Fish TTS test failed:\n${result.error}`);
    return "return";
  }
  await previewGeneratedFishAudio(result.audioPath);
  const answer = await promptFishNumberedSurface(3, (selected) => renderFishTtsSuccessSurface(selected));
  if (answer === 1) {
    return "choose";
  }
  if (answer === 3) {
    return "keep";
  }
  return "return";
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

async function previewGeneratedFishAudio(audioPath: string): Promise<void> {
  const result = await runProcess("afplay", [audioPath], 12_000);
  if (!result.ok) {
    await pauseWithMessage(`Fish TTS generated audio, but preview playback failed: ${result.error ?? `exit ${result.exitCode ?? "null"}`}`);
  }
}

function parseDjVoiceChoice(choice: DjVoiceChoiceId):
  | { provider: "macos"; voice: ReturnType<typeof loadConfig>["tts"]["macosVoice"] }
  | { provider: "fish"; voice: ReturnType<typeof loadConfig>["tts"]["fishVoice"] } {
  const [provider, voice] = choice.split(":") as ["macos" | "fish", string];
  if (provider === "fish") {
    return { provider, voice: voice as ReturnType<typeof loadConfig>["tts"]["fishVoice"] };
  }
  return { provider, voice: voice as ReturnType<typeof loadConfig>["tts"]["macosVoice"] };
}

function renderFishTtsSetupSurface(config: ReturnType<typeof loadConfig>, selected = 1): string {
  const detection = detectFishTtsInstall(config, getPockedioHome());
  const actions = [
    "Install Fish TTS locally",
    "Use existing Fish TTS install",
    "Edit paths manually",
    "Test Fish TTS"
  ];
  return [
    "Configure Fish TTS",
    "",
    "Fish TTS unlocks Mina and Nova.",
    "This is optional. Built-in voices work without it.",
    "",
    "Status",
    `  Runtime     ${detection.pythonPath && detection.scriptPath ? "Found" : "Missing"}`,
    `  Model       ${detection.modelDir ? "Found" : "Missing"}`,
    `  References  ${fs.existsSync(detection.minaReferencePath) ? "Mina ready" : "Mina missing"}, ${fs.existsSync(detection.novaReferencePath) ? "Nova ready" : "Nova missing"}`,
    "",
    "Actions",
    ...actions.map((action, index) => formatPromptAction(selected === index + 1, index + 1, action)),
    "",
    "↑↓ Select  |  Enter Open  |  1-4 Open  |  B Back  |  Q Quit"
  ].join("\n");
}

function renderUseExistingFishTtsSurface(detection: ReturnType<typeof detectFishTtsInstall>, selected = 1): string {
  const actions = [
    "Use detected setup",
    "Edit paths",
    "Search again"
  ];
  return [
    "Use existing Fish TTS install",
    "",
    "Searching common locations...",
    "",
    "Found:",
    formatDetectedFishSetup(detection),
    "",
    "Actions",
    ...actions.map((action, index) => formatPromptAction(selected === index + 1, index + 1, action)),
    "",
    "↑↓ Select  |  Enter Open  |  1-3 Open  |  B Back  |  Q Quit"
  ].join("\n");
}

function renderFishTtsManualPathSurface(config: ReturnType<typeof loadConfig>, selected = 1): string {
  const detection = detectFishTtsInstall(config, getPockedioHome());
  const actions = [
    `Python path       ${config.fishAudio.pythonPath}`,
    `Fish script path  ${config.fishAudio.scriptPath}`,
    `Model directory   ${config.fishAudio.modelDir}`,
    `Mina reference    ${fs.existsSync(detection.minaReferencePath) ? "Available" : "Missing"}`,
    `Nova reference    ${fs.existsSync(detection.novaReferencePath) ? "Available" : "Missing"}`,
    "Test Fish TTS"
  ];
  return [
    "Edit Fish TTS paths manually",
    "",
    "Actions",
    ...actions.map((action, index) => formatPromptAction(selected === index + 1, index + 1, action)),
    "",
    "↑↓ Select  |  Enter Open  |  1-6 Open  |  B Back  |  Q Quit"
  ].join("\n");
}

function renderFishTtsSuccessSurface(selected = 1): string {
  const actions = [
    "Choose Mina or Nova",
    "Return to Voice Setup",
    "Keep current voice"
  ];
  return [
    "Fish TTS test passed.",
    "",
    "What next?",
    ...actions.map((action, index) => formatPromptAction(selected === index + 1, index + 1, action)),
    "",
    "↑↓ Select  |  Enter Open  |  1-3 Open"
  ].join("\n");
}

function formatFishTtsMissingMessage(): string {
  const config = loadConfig();
  const detection = detectFishTtsInstall(config, getPockedioHome());
  const missing: string[] = [];
  if (!detection.pythonPath) {
    missing.push(`Python runtime was not found. Current path: ${config.fishAudio.pythonPath}`);
  }
  if (!detection.scriptPath) {
    missing.push(`Fish script was not found. Current path: ${config.fishAudio.scriptPath}`);
  }
  if (!detection.modelDir) {
    missing.push(`Model directory was not found. Current path: ${config.fishAudio.modelDir}`);
  }
  if (!config.fishAudio.referenceAudioPath || !fs.existsSync(config.fishAudio.referenceAudioPath)) {
    missing.push(`Reference audio is missing: ${config.fishAudio.referenceAudioPath || "not set"}`);
  }
  if (!config.fishAudio.referenceText?.trim()) {
    missing.push("Reference text is missing.");
  }
  return [
    "Fish TTS is not ready.",
    ...missing.map((item) => `- ${item}`),
    "",
    "Open Configure Fish TTS and choose Install, Use existing install, or Edit paths manually."
  ].join("\n");
}

function saveDetectedFishSetup(detection: FishSetupDetection): void {
  saveFishAudioConfig({
    pythonPath: detection.pythonPath,
    scriptPath: detection.scriptPath,
    modelDir: detection.modelDir
  });
  if (fs.existsSync(detection.minaReferencePath)) {
    saveFishReference("mina");
  } else if (fs.existsSync(detection.novaReferencePath)) {
    saveFishReference("nova");
  }
}

function formatCommand(command: string, args: string[]): string {
  return [command, ...args.map((arg) => /\s/.test(arg) ? JSON.stringify(arg) : arg)].join(" ");
}

function formatPromptAction(selected: boolean, index: number, label: string): string {
  const line = `${selected ? ">" : " "} ${index}. ${label}`;
  return selected ? `\x1B[7m${line}\x1B[0m` : line;
}

function saveFishReference(voice: ReturnType<typeof loadConfig>["tts"]["fishVoice"]): void {
  const preview = buildFishVoicePreview(voice, getPockedioHome());
  saveTtsConfig({
    provider: loadConfig().tts.provider,
    fishVoice: voice,
    fishReferenceAudioPath: preview.args[0],
    fishReferenceText: fishReferenceText(voice)
  });
}

function fishReferenceText(voice: ReturnType<typeof loadConfig>["tts"]["fishVoice"]): string {
  return voice === "mina"
    ? "Mina is here. Soft lights, warm songs, and a little room to breathe."
    : "Nova here. Bright rhythm, clean motion, and just enough spark to move.";
}

function saveFishAudioConfig(input: {
  pythonPath?: string;
  scriptPath?: string;
  modelDir?: string;
}): void {
  const config = loadConfig();
  saveConfig({
    ...config,
    fishAudio: {
      ...config.fishAudio,
      pythonPath: input.pythonPath?.trim() || config.fishAudio.pythonPath,
      scriptPath: input.scriptPath?.trim() || config.fishAudio.scriptPath,
      modelDir: input.modelDir?.trim() || config.fishAudio.modelDir
    }
  });
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
    const input = await askLineWithBack("NetEase playlist link or ID");
    if (input === "back") {
      return "continue";
    }
    if (input.trim()) {
      const result = await withCliProgress("Importing NetEase playlist...", () => importTasteFromNetEasePlaylist(input.trim(), loadConfig()));
      await pauseWithMessage(renderTasteImportResultSurface(result));
    }
    return "continue";
  }
  if (action === "show_summary") {
    await pauseWithMessage(renderTasteSummarySurface({ config: loadConfig() }));
    return "continue";
  }
  if (action === "back") {
    return "back";
  }
  return "quit";
}

type LlmSetupOutcome = "continue" | "done" | "back" | "quit";

async function runLlmSetupLoop(options: { returnOnConfigured?: boolean } = {}): Promise<LlmSetupOutcome> {
  while (true) {
    const outcome = await runLlmSetupAction(await promptLlmSetup({ config: loadConfig() }), options);
    if (outcome === "continue") {
      continue;
    }
    if (outcome === "done") {
      return "done";
    }
    if (outcome === "back") {
      if (options.returnOnConfigured) {
        return "back";
      }
      await runSetupConnectionsLoop();
      return "back";
    }
    return outcome;
  }
}

async function runLlmSetupAction(
  action: LlmSetupAction,
  options: { returnOnConfigured?: boolean } = {}
): Promise<LlmSetupOutcome> {
  if (action === "custom") {
    return runLlmProviderLoop("custom", options);
  }
  if (isLlmProviderId(action)) {
    return runLlmProviderLoop(action, options);
  }
  if (action === "test_connection") {
    await testLlmConnection();
    return options.returnOnConfigured ? "done" : "continue";
  }
  if (action === "back") {
    return "back";
  }
  return "quit";
}

async function runLlmProviderLoop(
  providerId: LlmProviderId,
  options: { returnOnConfigured?: boolean } = {}
): Promise<LlmSetupOutcome> {
  while (true) {
    const outcome = await runLlmProviderAction(providerId, await promptLlmProvider({ config: loadConfig() }, providerId), options);
    if (outcome === "continue") {
      continue;
    }
    if (outcome === "done") {
      return "done";
    }
    if (outcome === "back") {
      return "continue";
    }
    return outcome;
  }
}

async function runLlmProviderAction(
  providerId: LlmProviderId,
  action: LlmProviderAction,
  options: { returnOnConfigured?: boolean } = {}
): Promise<LlmSetupOutcome> {
  if (action === "paste_key") {
    const preset = getLlmPreset(providerId);
    saveLlmConfig(preset);
    await pasteLlmApiKey(preset.apiKeyEnv);
    return options.returnOnConfigured ? "done" : "continue";
  }
  if (action === "use_shell_env") {
    const preset = getLlmPreset(providerId);
    saveLlmConfig(preset);
    await pauseWithMessage(formatLlmPresetSaved(getLlmProviderLabel(providerId), preset));
    return options.returnOnConfigured ? "done" : "continue";
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
    return options.returnOnConfigured ? "done" : "continue";
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
  const answer = await askLineWithBack("Apply this preset? [y/N]");
  if (answer === "back") {
    return "back";
  }
  const normalizedAnswer = answer.trim().toLowerCase();
  if (normalizedAnswer !== "y" && normalizedAnswer !== "yes") {
    return "continue";
  }
  saveLlmConfig(llm);
  if (!process.env[llm.apiKeyEnv]) {
    const pasteAnswer = await askLineWithBack(`Paste ${llm.apiKeyEnv} now? [y/N]`);
    if (pasteAnswer === "back") {
      return "back";
    }
    const normalizedPasteAnswer = pasteAnswer.trim().toLowerCase();
    if (normalizedPasteAnswer === "y" || normalizedPasteAnswer === "yes") {
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
  const modelInput = await askLineWithBack("Model", preset.model);
  if (modelInput === "back") {
    return;
  }
  const model = modelInput.trim() || preset.model;
  saveLlmConfig({ ...preset, model });
  await pauseWithMessage(`Saved ${getLlmProviderLabel(providerId)} model: ${model}`);
}

async function changeLlmProviderBaseUrl(providerId: LlmProviderId): Promise<void> {
  const preset = getLlmPreset(providerId);
  const currentBaseUrl = preset.baseUrl ?? "OpenAI default";
  const rawBaseUrlInput = await askLineWithBack("Base URL", currentBaseUrl);
  if (rawBaseUrlInput === "back") {
    return;
  }
  const baseUrlInput = rawBaseUrlInput.trim();
  saveLlmConfig({
    ...preset,
    baseUrl: baseUrlInput || preset.baseUrl
  });
  await pauseWithMessage(`Saved ${getLlmProviderLabel(providerId)} base URL: ${baseUrlInput || currentBaseUrl}`);
}

async function changeLlmProviderApiKeyEnv(providerId: LlmProviderId): Promise<void> {
  const preset = getLlmPreset(providerId);
  const apiKeyEnvInput = await askLineWithBack("API key env", preset.apiKeyEnv);
  if (apiKeyEnvInput === "back") {
    return;
  }
  const apiKeyEnv = apiKeyEnvInput.trim() || preset.apiKeyEnv;
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

async function askLineWithBack(message: string, defaultValue?: string): Promise<string | "back"> {
  const promptLabel = `${message}${defaultValue ? ` (${defaultValue})` : ""} [Esc to back]: `;
  if (!defaultInput.isTTY) {
    const answer = await askLine(promptLabel);
    return isBackInput(answer) ? "back" : answer.trim() || defaultValue || "";
  }

  return new Promise((resolve) => {
    let value = "";
    const previousRawMode = defaultInput.isRaw;
    const render = () => {
      defaultOutput.write(`\r\x1B[2K${promptLabel}${value}`);
    };
    const cleanup = (result: string | "back") => {
      defaultInput.off("data", onData);
      defaultInput.setRawMode(previousRawMode);
      defaultInput.pause();
      defaultOutput.write("\n");
      resolve(result);
    };
    const submit = () => {
      const result = value.trim() || defaultValue || "";
      cleanup(isBackInput(result) ? "back" : result);
    };
    const onData = (chunk: Buffer) => {
      for (const char of chunk.toString("utf8")) {
        if (char === "\u001b" || char === "\u0003") {
          cleanup("back");
          return;
        }
        if (char === "\r" || char === "\n") {
          submit();
          return;
        }
        if (char === "\u007f" || char === "\b") {
          value = value.slice(0, -1);
          render();
          continue;
        }
        value += char;
        render();
      }
    };
    defaultInput.resume();
    defaultInput.setRawMode(true);
    defaultInput.on("data", onData);
    render();
  });
}

function isBackInput(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === "b" || normalized === "back";
}

async function withCliProgress<T>(message: string, action: () => Promise<T>): Promise<T> {
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let index = 0;
  const write = () => {
    clearCurrentLine();
    defaultOutput.write(`${frames[index % frames.length]} ${message}`);
    index += 1;
  };
  write();
  const timer = setInterval(write, 120);
  try {
    return await action();
  } finally {
    clearInterval(timer);
    clearCurrentLine();
  }
}

function clearCurrentLine(): void {
  defaultOutput.write("\r\x1B[2K");
}

function promptFishNumberedSurface(max: number, renderSurface: (selected: number) => string): Promise<number | "back" | "quit"> {
  return new Promise((resolve) => {
    let selected = 1;
    const previousRawMode = defaultInput.isRaw;

    const render = () => {
      defaultOutput.write("\x1B[?25l");
      defaultOutput.write("\x1B[H\x1B[2J");
      defaultOutput.write(renderSurface(selected));
    };
    const cleanup = (choice: number | "back" | "quit") => {
      defaultInput.off("keypress", onKeypress);
      if (defaultInput.isTTY) {
        defaultInput.setRawMode(previousRawMode);
      }
      defaultInput.pause();
      defaultOutput.write("\x1B[?25h\n");
      resolve(choice);
    };
    const onKeypress = (_value: string, key: Key) => {
      if (key.name === "up") {
        selected = selected === 1 ? max : selected - 1;
        render();
        return;
      }
      if (key.name === "down") {
        selected = selected === max ? 1 : selected + 1;
        render();
        return;
      }
      if (key.name === "return") {
        cleanup(selected);
        return;
      }
      if (key.name === "b") {
        cleanup("back");
        return;
      }
      if (key.name === "q" || (key.name === "c" && key.ctrl)) {
        cleanup("quit");
        return;
      }
      const numericIndex = Number(key.name);
      if (Number.isInteger(numericIndex) && numericIndex >= 1 && numericIndex <= max) {
        cleanup(numericIndex);
      }
    };

    emitKeypressEvents(defaultInput);
    defaultInput.resume();
    if (defaultInput.isTTY) {
      defaultInput.setRawMode(true);
    }
    defaultInput.on("keypress", onKeypress);
    render();
  });
}

async function pasteLlmApiKey(apiKeyEnv = loadConfig().llm.apiKeyEnv): Promise<void> {
  const config = loadConfig();
  const apiKey = (await askHiddenLine(`Paste API key for ${apiKeyEnv} [Esc to back]: `)).trim();
  if (isBackInput(apiKey)) {
    return;
  }
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
          value = "back";
          finish();
          return;
        }
        if (char === "\u001b") {
          value = "back";
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
