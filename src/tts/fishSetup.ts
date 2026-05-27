import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PockedioConfig } from "../config/schema.js";
import { buildFishVoicePreview } from "./voiceSetup.js";

export const fishSetupModelRepo = "appautomaton/fishaudio-s2-pro-8bit-mlx";
export const fishSetupGitRepo = "https://github.com/appautomaton/mlx-speech";

export type FishSetupDetection = {
  pythonPath?: string;
  scriptPath?: string;
  modelDir?: string;
  minaReferencePath: string;
  novaReferencePath: string;
  missing: string[];
};

export type FishSetupCommand = {
  command: string;
  args: string[];
  label: string;
};

export function detectFishTtsInstall(config: PockedioConfig, pockedioHome: string, cwd = process.cwd()): FishSetupDetection {
  const pythonPath = firstExistingFile([
    config.fishAudio.pythonPath,
    path.join(cwd, ".cache", "mlx-speech-venv", "bin", "python"),
    path.join(cwd, ".venv", "bin", "python"),
    findOnPath("python3")
  ], cwd);
  const scriptPath = firstExistingFile([
    config.fishAudio.scriptPath,
    path.join(cwd, ".cache", "mlx-speech", "scripts", "generate", "fish_s2_pro.py"),
    path.join(cwd, "mlx-speech", "scripts", "generate", "fish_s2_pro.py")
  ], cwd);
  const modelDir = firstUsableFishModelDirectory([
    config.fishAudio.modelDir,
    path.join(cwd, ".cache", "fishaudio-s2-pro-8bit-mlx"),
    ...findHuggingFaceFishModelSnapshots()
  ], cwd);
  const minaReferencePath = buildFishVoicePreview("mina", pockedioHome).args[0]!;
  const novaReferencePath = buildFishVoicePreview("nova", pockedioHome).args[0]!;
  const missing = [
    pythonPath ? undefined : "Python runtime",
    scriptPath ? undefined : "Fish generation script",
    modelDir ? undefined : "Complete Fish S2 Pro model directory",
    fs.existsSync(minaReferencePath) || fs.existsSync(novaReferencePath) ? undefined : "Mina/Nova reference preview audio"
  ].filter((item): item is string => Boolean(item));

  return {
    pythonPath,
    scriptPath,
    modelDir,
    minaReferencePath,
    novaReferencePath,
    missing
  };
}

export function buildFishSetupInstallCommands(cwd = process.cwd()): FishSetupCommand[] {
  const venvPythonPath = path.join(cwd, ".cache", "mlx-speech-venv", "bin", "python");
  return [
    {
      label: "Clone mlx-speech",
      command: "git",
      args: ["clone", fishSetupGitRepo, path.join(cwd, ".cache", "mlx-speech")]
    },
    {
      label: "Create Python venv",
      command: "uv",
      args: ["venv", path.join(cwd, ".cache", "mlx-speech-venv"), "--python", "3.13", "--clear"]
    },
    {
      label: "Install mlx-speech",
      command: "uv",
      args: ["pip", "install", "--python", venvPythonPath, "-e", path.join(cwd, ".cache", "mlx-speech")]
    },
    {
      label: "Install Hugging Face proxy support",
      command: "uv",
      args: ["pip", "install", "--python", venvPythonPath, "httpx[socks]"]
    },
    {
      label: "Download Fish S2 Pro model",
      command: path.join(cwd, ".cache", "mlx-speech-venv", "bin", "hf"),
      args: ["download", fishSetupModelRepo, "--local-dir", path.join(cwd, ".cache", "fishaudio-s2-pro-8bit-mlx")]
    }
  ];
}

export function formatDetectedFishSetup(detection: FishSetupDetection): string {
  return [
    `Python       ${detection.pythonPath ?? "Missing"}`,
    `Script       ${detection.scriptPath ?? "Missing"}`,
    `Model        ${detection.modelDir ?? "Missing"}`,
    `Mina ref     ${fs.existsSync(detection.minaReferencePath) ? "Available" : "Missing"}`,
    `Nova ref     ${fs.existsSync(detection.novaReferencePath) ? "Available" : "Missing"}`
  ].join("\n");
}

function firstExistingFile(candidates: Array<string | undefined>, cwd: string): string | undefined {
  return candidates.map((candidate) => resolveCandidate(candidate, cwd)).find((candidate): candidate is string => Boolean(candidate && fs.existsSync(candidate) && fs.statSync(candidate).isFile()));
}

function firstUsableFishModelDirectory(candidates: Array<string | undefined>, cwd: string): string | undefined {
  return candidates.map((candidate) => resolveCandidate(candidate, cwd)).find((candidate): candidate is string => Boolean(candidate && isUsableFishModelDirectory(candidate)));
}

export function isUsableFishModelDirectory(candidate: string | undefined): boolean {
  if (!candidate || !fs.existsSync(candidate) || !fs.statSync(candidate).isDirectory()) {
    return false;
  }
  const codecDir = path.join(candidate, "codec-mlx");
  const hasWeights = fs.existsSync(path.join(candidate, "model.safetensors"))
    || fs.existsSync(path.join(candidate, "model.safetensors.index.json"))
    || fs.readdirSync(candidate).some((entry) => /^model.*\.safetensors$/.test(entry));
  return Boolean(
    fs.existsSync(path.join(candidate, "config.json"))
    && hasWeights
    && fs.existsSync(path.join(candidate, "tokenizer_config.json"))
    && fs.existsSync(path.join(codecDir, "config.json"))
    && fs.existsSync(path.join(codecDir, "model.safetensors"))
  );
}

function resolveCandidate(candidate: string | undefined, cwd: string): string | undefined {
  if (!candidate) {
    return undefined;
  }
  return path.isAbsolute(candidate) ? candidate : path.resolve(cwd, candidate);
}

function findOnPath(binary: string): string | undefined {
  for (const directory of (process.env.PATH ?? "").split(path.delimiter)) {
    const candidate = path.join(directory, binary);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function findHuggingFaceFishModelSnapshots(): string[] {
  const snapshotsDir = path.join(os.homedir(), ".cache", "huggingface", "hub", "models--appautomaton--fishaudio-s2-pro-8bit-mlx", "snapshots");
  if (!fs.existsSync(snapshotsDir)) {
    return [];
  }
  return fs.readdirSync(snapshotsDir)
    .map((entry) => path.join(snapshotsDir, entry))
    .filter((entry) => fs.existsSync(entry) && fs.statSync(entry).isDirectory())
    .sort()
    .reverse();
}
