import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ensureRuntimeDirs, loadConfig } from "../src/config/load.js";
import { saveLlmApiKey } from "../src/config/llmSecrets.js";
import { importTaste } from "../src/taste/importTaste.js";
import { applyContextSetupKey, applyDjVoiceChooserKey, applyLlmProviderKey, applyLlmSetupKey, applyTasteMemoryKey, applyVoiceSetupKey, buildWelcomeReadiness, inferLlmSetupAction, resolveContextSetupAction, resolveDefaultEntryMode, resolveLlmProviderAction, resolveLlmSetupAction, resolveSetupConnectionsAction, resolveTasteMemoryAction, resolveVoiceSetupAction, resolveWelcomeHubAction, renderContextSetupSurface, renderDjVoiceChooserSurface, renderLlmProviderSurface, renderLlmSetupSurface, renderSetupConnectionsSurface, renderTasteImportResultSurface, renderTasteMemorySurface, renderTasteSummarySurface, renderVoiceSetupSurface, renderWelcomeHub } from "../src/tui/welcomeHub.js";

function makeConfig() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "pockedio-tui-test-"));
  const env = { POCKEDIO_HOME: home };
  const config = loadConfig(env);
  ensureRuntimeDirs(config, env);
  return { config, env };
}

describe("MOLE-inspired welcome hub", () => {
  it("builds required readiness fields without exposing freshness as a setting", () => {
    const { config, env } = makeConfig();
    fs.writeFileSync(config.paths.taste, "# Pockedio Taste\n\n## Imported Tracks\n\n- Song - Artist\n");

    const readiness = buildWelcomeReadiness({
      config,
      env: { ...env, OPENAI_API_KEY: "test-key" },
      platform: "darwin"
    });

    expect(readiness.items.map((item) => item.label)).toEqual([
      "Music",
      "LLM",
      "Voice",
      "Taste",
      "Calendar"
    ]);
    expect(readiness.items.find((item) => item.label === "Music")?.value).toBe("NetEase anonymous");
    expect(readiness.items.find((item) => item.label === "LLM")?.value).toBe("Configured: shell env");
    expect(readiness.items.find((item) => item.label === "Voice")?.value).toBe("Vale, built-in macOS");
    expect(readiness.items.find((item) => item.label === "Taste")?.value).toBe("Imported");
    expect(readiness.items.find((item) => item.label === "Calendar")?.value).toBe("Enabled");
    expect(readiness.items.some((item) => item.label === "Freshness")).toBe(false);
  });

  it("shows the configured LLM key env when the key is missing", () => {
    const { config, env } = makeConfig();
    const readiness = buildWelcomeReadiness({
      config: {
        ...config,
        llm: {
          ...config.llm,
          apiKeyEnv: "POCKEDIO_TEST_LLM_KEY"
        }
      },
      env,
      platform: "darwin"
    });

    expect(readiness.items.find((item) => item.label === "LLM")?.value).toBe("Missing: POCKEDIO_TEST_LLM_KEY");
  });

  it("shows local secret LLM readiness when a pasted key is stored", () => {
    const { config, env } = makeConfig();
    saveLlmApiKey(config, "OPENAI_API_KEY", "sk-local");

    const readiness = buildWelcomeReadiness({ config, env, platform: "darwin" });
    const llm = renderLlmSetupSurface({ config, env });

    expect(readiness.items.find((item) => item.label === "LLM")?.value).toBe("Configured: local secret");
    expect(llm).toContain("API key         Present: local secret (OPENAI_API_KEY)");
  });

  it("renders a compact hub with four entry points and command hints", () => {
    const { config, env } = makeConfig();
    const readiness = buildWelcomeReadiness({ config, env, platform: "linux" });
    const text = renderWelcomeHub(readiness);

    expect(text).toContain("Pockedio");
    expect(text).toContain("Personal AI DJ for context-aware listening");
    expect(text).toContain("> 1. Enter DJ Session");
    expect(text).toContain("2. Setup & Connections");
    expect(text).toContain("3. Taste & Memory");
    expect(text).toContain("4. Status");
    expect(text).toContain("Readiness");
    expect(text).toContain("Voice        Text-only DJ copy");
    expect(text).toContain("↑↓ Select  |  Enter Open  |  S Setup  |  L LLM  |  V Voice  |  Q Quit");
  });

  it("moves the visible cursor inside the main hub entries", () => {
    const { config, env } = makeConfig();
    const readiness = buildWelcomeReadiness({ config, env, platform: "darwin" });
    const text = renderWelcomeHub(readiness, { selectedAction: "setup" });

    expect(text).toContain("  1. Enter DJ Session");
    expect(text).toContain("> 2. Setup & Connections");
    expect(text).toContain("↑↓ Select  |  Enter Open");
  });

  it("routes hub shortcuts to shallow entry actions", () => {
    expect(resolveWelcomeHubAction("enter")).toBe("session");
    expect(resolveWelcomeHubAction("setup")).toBe("setup");
    expect(resolveWelcomeHubAction("llm")).toBe("llm_setup");
    expect(resolveWelcomeHubAction("voice")).toBe("voice_setup");
    expect(resolveWelcomeHubAction("1")).toBe("session");
    expect(resolveWelcomeHubAction("2")).toBe("setup");
    expect(resolveWelcomeHubAction("3")).toBe("taste");
    expect(resolveWelcomeHubAction("4")).toBe("status");
    expect(resolveWelcomeHubAction("quit")).toBe("quit");
  });

  it("uses the hub only for bare interactive launches", () => {
    expect(resolveDefaultEntryMode({ stdinIsTty: true, stdoutIsTty: true })).toBe("hub");
    expect(resolveDefaultEntryMode({ stdinIsTty: false, stdoutIsTty: true })).toBe("session");
    expect(resolveDefaultEntryMode({ stdinIsTty: true, stdoutIsTty: false })).toBe("session");
    expect(resolveDefaultEntryMode({ stdinIsTty: true, stdoutIsTty: true, forceSession: true })).toBe("session");
    expect(resolveDefaultEntryMode({ stdinIsTty: true, stdoutIsTty: true, noHub: true })).toBe("session");
  });

  it("renders setup and focused LLM/Voice surfaces", () => {
    const { config, env } = makeConfig();

    const setup = renderSetupConnectionsSurface({ config, env, platform: "darwin" });
    expect(setup).toContain("Setup & Connections");
    expect(setup).toContain("Music");
    expect(setup).toContain("LLM");
    expect(setup).toContain("Voice");
    expect(setup).toContain("Context");
    expect(setup).toContain("> 1. Run full setup");
    expect(setup).toContain("Configure LLM");
    expect(setup).toContain("Configure Voice");
    expect(setup).toContain("Configure Context");

    const llm = renderLlmSetupSurface({ config, env });
    expect(llm).toContain("LLM");
    expect(llm).toContain("Provider        OpenAI-compatible");
    expect(llm).toContain("Model           gpt-4.1-mini");
    expect(llm).toContain("API key         Missing: OPENAI_API_KEY");
    expect(llm).toContain("> 1. Use OpenAI");
    expect(llm).toContain("2. Use DeepSeek");
    expect(llm).toContain("3. Use OpenRouter");
    expect(llm).toContain("4. Use local vLLM");
    expect(llm).toContain("5. Custom OpenAI-compatible");
    expect(llm).toContain("6. Test current setup");
    expect(llm).not.toContain("Paste API key  Store a local secret");

    const voice = renderVoiceSetupSurface({ config, platform: "darwin" });
    expect(voice).toContain("Voice");
    expect(voice).toContain("Provider        Built-in macOS voice");
    expect(voice).toContain("Voice           Vale");
    expect(voice).toContain("> 1. Choose DJ voice");
    expect(voice).toContain("Configure Fish TTS");
  });

  it("moves the visible cursor inside setup actions and routes setup shortcuts", () => {
    const { config, env } = makeConfig();
    const setup = renderSetupConnectionsSurface({ config, env, platform: "darwin" }, { selectedAction: "voice_setup" });

    expect(setup).toContain("  1. Run full setup");
    expect(setup).toContain("> 3. Configure Voice");
    expect(setup).toContain("  6. Configure Scheduler");
    expect(setup).toContain("↑↓ Select  |  Enter Open  |  1-6 Open  |  B Back  |  Q Quit");
    expect(resolveSetupConnectionsAction("1")).toBe("full_setup");
    expect(resolveSetupConnectionsAction("2")).toBe("llm_setup");
    expect(resolveSetupConnectionsAction("3")).toBe("voice_setup");
    expect(resolveSetupConnectionsAction("4")).toBe("netease_setup");
    expect(resolveSetupConnectionsAction("5")).toBe("context_setup");
    expect(resolveSetupConnectionsAction("6")).toBe("scheduler_setup");
    expect(resolveSetupConnectionsAction("schedule")).toBe("scheduler_setup");
    expect(resolveSetupConnectionsAction("b")).toBe("back");
  });

  it("renders real Context setup actions for calendar, weather, and diary", () => {
    const { config } = makeConfig();
    const contextConfig = {
      ...config,
      weather: { enabled: true, location: "Guangzhou" },
      diary: { enabled: false, path: "~/Diary" }
    };
    const context = renderContextSetupSurface({ config: contextConfig }, { selectedAction: "weather" });

    expect(context).toContain("Context");
    expect(context).toContain("Calendar        Enabled");
    expect(context).toContain("Weather         Guangzhou");
    expect(context).toContain("Diary           Not enabled");
    expect(context).toContain("  1. Configure Calendar");
    expect(context).toContain("> 2. Configure Weather");
    expect(context).toContain("3. Configure Diary");
    expect(context).toContain("↑↓ Select  |  Enter Open  |  1-3 Open  |  B Back  |  Q Quit");
    expect(resolveContextSetupAction("1")).toBe("calendar");
    expect(resolveContextSetupAction("2")).toBe("weather");
    expect(resolveContextSetupAction("3")).toBe("diary");
    expect(resolveContextSetupAction("4")).toBeUndefined();
    expect(resolveContextSetupAction("b")).toBe("back");
    expect(applyContextSetupKey("calendar", { name: "down" })).toEqual({ selectedAction: "weather" });
    expect(applyContextSetupKey("weather", { name: "return" })).toEqual({
      selectedAction: "weather",
      submittedAction: "weather"
    });
  });

  it("moves the visible cursor inside LLM setup options and routes LLM shortcuts", () => {
    const { config, env } = makeConfig();
    const llm = renderLlmSetupSurface({ config, env }, { selectedAction: "local_vllm" });

    expect(llm).toContain("  1. Use OpenAI");
    expect(llm).toContain("> 4. Use local vLLM");
    expect(llm).toContain("Current config");
    expect(llm).toContain("OpenAI-compatible");
    expect(llm).toContain("↑↓ Select  |  Enter Open  |  1-6 Open  |  B Back  |  Q Quit");
    expect(resolveLlmSetupAction("1")).toBe("openai");
    expect(resolveLlmSetupAction("2")).toBe("deepseek");
    expect(resolveLlmSetupAction("3")).toBe("openrouter");
    expect(resolveLlmSetupAction("4")).toBe("local_vllm");
    expect(resolveLlmSetupAction("5")).toBe("custom");
    expect(resolveLlmSetupAction("6")).toBe("test_connection");
    expect(resolveLlmSetupAction("7")).toBeUndefined();
    expect(resolveLlmSetupAction("b")).toBe("back");
  });

  it("renders hosted LLM provider details with provider-specific key actions", () => {
    const { config, env } = makeConfig();
    const openai = renderLlmProviderSurface({ config, env }, "openai", { selectedAction: "paste_key" });

    expect(openai).toContain("OpenAI");
    expect(openai).toContain("Model       gpt-4.1-mini");
    expect(openai).toContain("API key     Missing: OPENAI_API_KEY");
    expect(openai).toContain("Base URL    OpenAI default");
    expect(openai).toContain("> 1. Paste API key");
    expect(openai).toContain("2. Use shell env");
    expect(openai).toContain("3. Change model");
    expect(openai).toContain("4. Test connection");
    expect(openai).not.toContain("5. Back");
    expect(openai).toContain("↑↓ Select  |  Enter Open  |  1-4 Open  |  B Back  |  Q Quit");
    expect(resolveLlmProviderAction("1", "openai")).toBe("paste_key");
    expect(resolveLlmProviderAction("2", "openai")).toBe("use_shell_env");
    expect(resolveLlmProviderAction("3", "openai")).toBe("change_model");
    expect(resolveLlmProviderAction("4", "openai")).toBe("test_connection");
    expect(resolveLlmProviderAction("5", "openai")).toBeUndefined();
    expect(applyLlmProviderKey("paste_key", { name: "down" }, "openai")).toEqual({ selectedAction: "use_shell_env" });
  });

  it("renders local vLLM provider details with server checks and model discovery", () => {
    const { config, env } = makeConfig();
    const vllm = renderLlmProviderSurface({ config, env }, "local_vllm", { selectedAction: "discover_models" });

    expect(vllm).toContain("Local vLLM");
    expect(vllm).toContain("Base URL    http://127.0.0.1:8000/v1");
    expect(vllm).toContain("API key     Optional: VLLM_API_KEY");
    expect(vllm).toContain("1. Check server");
    expect(vllm).toContain("> 2. Discover models");
    expect(vllm).toContain("3. Paste API key");
    expect(vllm).toContain("4. Set model manually");
    expect(vllm).toContain("5. Set base URL");
    expect(vllm).not.toContain("6. Back");
    expect(resolveLlmProviderAction("1", "local_vllm")).toBe("check_server");
    expect(resolveLlmProviderAction("2", "local_vllm")).toBe("discover_models");
    expect(resolveLlmProviderAction("3", "local_vllm")).toBe("paste_key");
    expect(resolveLlmProviderAction("4", "local_vllm")).toBe("change_model");
    expect(resolveLlmProviderAction("5", "local_vllm")).toBe("change_base_url");
    expect(resolveLlmProviderAction("6", "local_vllm")).toBeUndefined();
  });

  it("keeps edited provider config visible inside provider detail screens", () => {
    const { config, env } = makeConfig();
    const configuredVllm = {
      ...config,
      llm: {
        ...config.llm,
        model: "mock-vllm-model",
        baseUrl: "http://127.0.0.1:18000/v1",
        apiKeyEnv: "VLLM_API_KEY"
      }
    };

    const vllm = renderLlmProviderSurface({ config: configuredVllm, env }, "local_vllm");

    expect(vllm).toContain("Model       mock-vllm-model");
    expect(vllm).toContain("Base URL    http://127.0.0.1:18000/v1");
  });

  it("renders custom LLM provider details with API key env configuration", () => {
    const { config, env } = makeConfig();
    const custom = renderLlmProviderSurface({ config, env }, "custom", { selectedAction: "change_api_key_env" });

    expect(custom).toContain("Custom OpenAI-compatible");
    expect(custom).toContain("4. Change base URL");
    expect(custom).toContain("> 5. Set API key env");
    expect(custom).toContain("6. Test connection");
    expect(custom).not.toContain("7. Back");
    expect(resolveLlmProviderAction("5", "custom")).toBe("change_api_key_env");
    expect(resolveLlmProviderAction("key_env", "custom")).toBe("change_api_key_env");
  });

  it("selects the current LLM provider preset by default", () => {
    const { config, env } = makeConfig();
    const deepseekConfig = {
      ...config,
      llm: {
        ...config.llm,
        model: "deepseek-chat",
        baseUrl: "https://api.deepseek.com",
        apiKeyEnv: "DEEPSEEK_API_KEY"
      }
    };

    expect(inferLlmSetupAction(deepseekConfig)).toBe("deepseek");
    expect(renderLlmSetupSurface({ config: deepseekConfig, env })).toContain("> 2. Use DeepSeek");
  });

  it("updates LLM setup selection from keyboard input", () => {
    expect(applyLlmSetupKey("openai", { name: "down" })).toEqual({
      selectedAction: "deepseek"
    });
    expect(applyLlmSetupKey("openai", { name: "up" })).toEqual({
      selectedAction: "test_connection"
    });
    expect(applyLlmSetupKey("local_vllm", { name: "return" })).toEqual({
      selectedAction: "local_vllm",
      submittedAction: "local_vllm"
    });
    expect(applyLlmSetupKey("openai", { name: "4" })).toEqual({
      selectedAction: "local_vllm",
      submittedAction: "local_vllm"
    });
    expect(applyLlmSetupKey("deepseek", { name: "b" })).toEqual({
      selectedAction: "back",
      submittedAction: "back"
    });
    expect(applyLlmSetupKey("deepseek", { name: "q" })).toEqual({
      selectedAction: "deepseek",
      submittedAction: "quit"
    });
  });

  it("moves and submits Voice setup actions", () => {
    const { config } = makeConfig();
    const voice = renderVoiceSetupSurface({ config, platform: "darwin" }, { selectedAction: "fish_tts" });

    expect(voice).toContain("  1. Choose DJ voice");
    expect(voice).toContain("> 2. Configure Fish TTS");
    expect(voice).toContain("↑↓ Select  |  Enter Open  |  1-3 Open  |  B Back  |  Q Quit");
    expect(resolveVoiceSetupAction("1")).toBe("choose_voice");
    expect(resolveVoiceSetupAction("2")).toBe("fish_tts");
    expect(resolveVoiceSetupAction("3")).toBe("text_only");
    expect(resolveVoiceSetupAction("4")).toBeUndefined();
    expect(applyVoiceSetupKey("choose_voice", { name: "down" })).toEqual({ selectedAction: "fish_tts" });
    expect(applyVoiceSetupKey("fish_tts", { name: "return" })).toEqual({
      selectedAction: "fish_tts",
      submittedAction: "fish_tts"
    });
  });

  it("renders the combined DJ voice chooser and routes preview/save keys", () => {
    const { config } = makeConfig();
    const chooser = renderDjVoiceChooserSurface({ config, platform: "darwin" }, { selectedVoice: "fish:mina" });

    expect(chooser).toContain("Choose DJ voice");
    expect(chooser).toContain("Sample");
    expect(chooser).toContain("Built-in voices");
    expect(chooser).toContain("  4. Vale      ready, current");
    expect(chooser).toContain("Advanced Fish voices");
    expect(chooser).toContain("> 6. Mina      needs Fish TTS setup");
    expect(chooser).toContain("Space Preview  |  Enter Save  |  F Fish setup  |  B Back");
    expect(applyDjVoiceChooserKey("macos:vale", { name: "down" })).toEqual({ selectedVoice: "macos:sol" });
    expect(applyDjVoiceChooserKey("macos:vale", { name: "space" })).toEqual({ selectedVoice: "macos:vale", submit: "preview" });
    expect(applyDjVoiceChooserKey("macos:vale", { name: "return" })).toEqual({ selectedVoice: "macos:vale", submit: "save" });
    expect(applyDjVoiceChooserKey("macos:vale", { name: "7" })).toEqual({ selectedVoice: "fish:nova" });
    expect(applyDjVoiceChooserKey("macos:vale", { name: "f" })).toEqual({ selectedVoice: "macos:vale", submit: "fish_setup" });
  });

  it("renders selected voice provider and voice from TTS config", () => {
    const { config } = makeConfig();
    const macosConfig = {
      ...config,
      tts: {
        provider: "macos" as const,
        macosVoice: "sable" as const,
        fishVoice: "mina" as const
      }
    };
    const textConfig = {
      ...config,
      tts: {
        provider: "text" as const,
        macosVoice: "vale" as const,
        fishVoice: "mina" as const
      }
    };

    expect(renderVoiceSetupSurface({ config: macosConfig, platform: "darwin" })).toContain("Voice           Sable");
    expect(renderVoiceSetupSurface({ config: textConfig, platform: "darwin" })).toContain("Provider        Text-only DJ copy");
  });

  it("renders Taste & Memory summary and post-import result surfaces", () => {
    const { config } = makeConfig();
    const result = importTaste("tests/fixtures/taste-normalized.csv", config);

    const taste = renderTasteMemorySurface({ config });
    expect(taste).toContain("Taste & Memory");
    expect(taste).toContain("Imported lists  3 playlists, 3 tracks");
    expect(taste).toContain("Taste profile   Needs refresh");
    expect(taste).toContain("> 1. Import playlist");
    expect(taste).not.toContain("Start station");

    const imported = renderTasteImportResultSurface(result);
    expect(imported).toContain("Imported playlist");
    expect(imported).toContain("Tracks        3");
    expect(imported).not.toContain("Taste profile needs refresh");
    expect(imported).not.toContain("Rebuild taste profile");
    expect(imported).not.toContain("Start station");
    expect(imported).toContain("Press Enter to return to Taste & Memory.");

    const summary = renderTasteSummarySurface({ config });
    expect(summary).toContain("Taste Summary");
    expect(summary).toContain("Imported      3 playlists, 3 tracks");
    expect(summary).toContain("Top artists");
    expect(summary).toContain("1. Brian Eno (1)");
    expect(summary).toContain("- ambient reset");
    expect(summary).toContain("- Blue in Green - Miles Davis");
  });

  it("moves and submits Taste & Memory actions", () => {
    const { config } = makeConfig();
    const taste = renderTasteMemorySurface({ config }, { selectedAction: "show_summary" });

    expect(taste).toContain("  1. Import playlist");
    expect(taste).toContain("> 2. Show taste summary");
    expect(taste).toContain("↑↓ Select  |  Enter Open  |  1-2 Open  |  B Back  |  Q Quit");
    expect(resolveTasteMemoryAction("1")).toBe("import");
    expect(resolveTasteMemoryAction("2")).toBe("show_summary");
    expect(resolveTasteMemoryAction("3")).toBeUndefined();
    expect(applyTasteMemoryKey("import", { name: "down" })).toEqual({ selectedAction: "show_summary" });
    expect(applyTasteMemoryKey("show_summary", { name: "return" })).toEqual({
      selectedAction: "show_summary",
      submittedAction: "show_summary"
    });
  });
});
