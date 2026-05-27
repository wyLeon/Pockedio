import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/load.js";
import {
  buildKokoroSetupInstallCommands,
  detectKokoroInstall,
  formatDetectedKokoroSetup,
  kokoroModelUrl,
  kokoroVoicesUrl
} from "../src/tts/kokoroSetup.js";

describe("Kokoro TTS setup detection", () => {
  it("requires a Python runtime that can import Kokoro packages", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "pockedio-kokoro-detect-"));
    const pythonPath = path.join(home, "python");
    const modelPath = path.join(home, "kokoro.onnx");
    const voicesPath = path.join(home, "voices.bin");
    fs.writeFileSync(pythonPath, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    fs.writeFileSync(modelPath, "");
    fs.writeFileSync(voicesPath, "");
    const config = loadConfig({ POCKEDIO_HOME: home });
    config.kokoroAudio.pythonPath = pythonPath;
    config.kokoroAudio.modelPath = modelPath;
    config.kokoroAudio.voicesPath = voicesPath;

    const detection = detectKokoroInstall(config, home);

    expect(detection.pythonPath).toBe(pythonPath);
    expect(detection.pythonReady).toBe(false);
    expect(detection.missing).toContain("Python runtime with kokoro-onnx");
    expect(formatDetectedKokoroSetup(detection)).toContain("Python       Missing");
  });

  it("builds an install command plan that works with uv-created venvs", () => {
    const cwd = "/tmp/pockedio";
    const commands = buildKokoroSetupInstallCommands(cwd);

    expect(commands.map((command) => command.label)).toEqual([
      "Create Kokoro Python venv",
      "Install Kokoro packages",
      "Download Kokoro model",
      "Download Kokoro voices"
    ]);
    expect(commands[0]).toMatchObject({
      command: "uv",
      args: ["venv", path.join(cwd, ".cache", "kokoro-spike", ".venv"), "--python", "3.13", "--clear"]
    });
    expect(commands[1]).toMatchObject({
      command: "uv",
      args: ["pip", "install", "--python", path.join(cwd, ".cache", "kokoro-spike", ".venv", "bin", "python"), "kokoro-onnx", "soundfile"]
    });
    expect(commands[2]).toMatchObject({
      command: "curl",
      args: ["-L", "--retry", "5", "--retry-delay", "2", "-o", path.join(cwd, ".cache", "kokoro-spike", "kokoro-v1.0.onnx"), kokoroModelUrl]
    });
    expect(commands[3]).toMatchObject({
      command: "curl",
      args: ["-L", "--retry", "5", "--retry-delay", "2", "-o", path.join(cwd, ".cache", "kokoro-spike", "voices-v1.0.bin"), kokoroVoicesUrl]
    });
  });
});
