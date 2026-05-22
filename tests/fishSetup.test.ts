import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/load.js";
import {
  buildFishSetupInstallCommands,
  detectFishTtsInstall,
  fishSetupModelRepo,
  formatDetectedFishSetup
} from "../src/tts/fishSetup.js";

function makeConfig() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "pockedio-fish-setup-test-"));
  return { home, config: loadConfig({ POCKEDIO_HOME: home }) };
}

describe("Fish TTS setup detection", () => {
  it("detects an existing local mlx-speech install from common paths", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pockedio-fish-detect-"));
    const { home, config } = makeConfig();
    const pythonPath = path.join(cwd, ".cache", "mlx-speech-venv", "bin", "python");
    const scriptPath = path.join(cwd, ".cache", "mlx-speech", "scripts", "generate", "fish_s2_pro.py");
    const modelDir = path.join(cwd, ".cache", "fishaudio-s2-pro-8bit-mlx");
    config.fishAudio.pythonPath = "missing-python";
    config.fishAudio.scriptPath = "missing-script.py";
    config.fishAudio.modelDir = "missing-model";
    fs.mkdirSync(path.dirname(pythonPath), { recursive: true });
    fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
    fs.mkdirSync(modelDir, { recursive: true });
    fs.writeFileSync(pythonPath, "");
    fs.writeFileSync(scriptPath, "");

    const detection = detectFishTtsInstall(config, home, cwd);

    expect(detection.pythonPath).toBe(pythonPath);
    expect(detection.scriptPath).toBe(scriptPath);
    expect(detection.modelDir).toBe(modelDir);
    expect(detection.missing).toContain("Mina/Nova reference preview audio");
    expect(formatDetectedFishSetup(detection)).toContain("Python");
  });

  it("builds an explicit opt-in install command plan", () => {
    const cwd = "/tmp/pockedio";
    const commands = buildFishSetupInstallCommands(cwd);

    expect(commands.map((command) => command.label)).toEqual([
      "Clone mlx-speech",
      "Create Python venv",
      "Install mlx-speech",
      "Download Fish S2 Pro model"
    ]);
    expect(commands.at(-1)).toMatchObject({
      command: "huggingface-cli",
      args: ["download", fishSetupModelRepo, "--local-dir", path.join(cwd, ".cache", "fishaudio-s2-pro-8bit-mlx")]
    });
  });
});
