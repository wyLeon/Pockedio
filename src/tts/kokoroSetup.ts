import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type { PockedioConfig } from "../config/schema.js";

export const kokoroModelUrl = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx";
export const kokoroVoicesUrl = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin";

export type KokoroSetupDetection = {
  pythonPath?: string;
  pythonReady: boolean;
  modelPath?: string;
  voicesPath?: string;
  missing: string[];
};

export type KokoroSetupCommand = {
  command: string;
  args: string[];
  label: string;
};

export function detectKokoroInstall(config: PockedioConfig, cwd = process.cwd()): KokoroSetupDetection {
  const pythonPath = firstExistingFile([
    config.kokoroAudio.pythonPath,
    path.join(cwd, ".cache", "kokoro-spike", ".venv", "bin", "python"),
    path.join(cwd, ".cache", "kokoro", ".venv", "bin", "python")
  ], cwd);
  const modelPath = firstExistingFile([
    config.kokoroAudio.modelPath,
    path.join(cwd, ".cache", "kokoro-spike", "kokoro-v1.0.onnx"),
    path.join(cwd, ".cache", "kokoro", "kokoro-v1.0.onnx")
  ], cwd);
  const voicesPath = firstExistingFile([
    config.kokoroAudio.voicesPath,
    path.join(cwd, ".cache", "kokoro-spike", "voices-v1.0.bin"),
    path.join(cwd, ".cache", "kokoro", "voices-v1.0.bin")
  ], cwd);
  const pythonReady = pythonPath ? canImportKokoro(pythonPath) : false;
  const missing = [
    pythonReady ? undefined : "Python runtime with kokoro-onnx",
    modelPath ? undefined : "Kokoro ONNX model",
    voicesPath ? undefined : "Kokoro voices file"
  ].filter((item): item is string => Boolean(item));

  return {
    pythonPath,
    pythonReady,
    modelPath,
    voicesPath,
    missing
  };
}

export function buildKokoroSetupInstallCommands(cwd = process.cwd()): KokoroSetupCommand[] {
  const installDir = path.join(cwd, ".cache", "kokoro-spike");
  return [
    {
      label: "Create Kokoro Python venv",
      command: "uv",
      args: ["venv", path.join(installDir, ".venv"), "--python", "3.13", "--clear"]
    },
    {
      label: "Install Kokoro packages",
      command: "uv",
      args: ["pip", "install", "--python", path.join(installDir, ".venv", "bin", "python"), "kokoro-onnx", "soundfile"]
    },
    {
      label: "Download Kokoro model",
      command: "curl",
      args: ["-L", "--retry", "5", "--retry-delay", "2", "-o", path.join(installDir, "kokoro-v1.0.onnx"), kokoroModelUrl]
    },
    {
      label: "Download Kokoro voices",
      command: "curl",
      args: ["-L", "--retry", "5", "--retry-delay", "2", "-o", path.join(installDir, "voices-v1.0.bin"), kokoroVoicesUrl]
    }
  ];
}

export function formatDetectedKokoroSetup(detection: KokoroSetupDetection): string {
  return [
    `Python       ${detection.pythonReady ? detection.pythonPath : "Missing"}`,
    `Model        ${detection.modelPath ?? "Missing"}`,
    `Voices       ${detection.voicesPath ?? "Missing"}`
  ].join("\n");
}

function firstExistingFile(candidates: Array<string | undefined>, cwd: string): string | undefined {
  return candidates.map((candidate) => resolveCandidate(candidate, cwd)).find((candidate): candidate is string => Boolean(candidate && fs.existsSync(candidate) && fs.statSync(candidate).isFile()));
}

function resolveCandidate(candidate: string | undefined, cwd: string): string | undefined {
  if (!candidate) {
    return undefined;
  }
  return path.isAbsolute(candidate) ? candidate : path.resolve(cwd, candidate);
}

function canImportKokoro(pythonPath: string): boolean {
  const result = spawnSync(pythonPath, ["-c", "import kokoro_onnx, soundfile"], {
    stdio: "ignore",
    timeout: 10_000
  });
  return result.status === 0;
}
