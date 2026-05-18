import fs from "node:fs";
import { loadConfig } from "../config/load.js";
import type { PockedioConfig } from "../config/schema.js";
import { NetEaseProvider } from "../providers/netease.js";
import { resolveRuntimePath } from "../tts/fishAudio.js";

export type StatusReport = {
  netease: {
    baseUrl: string;
    reachable: boolean;
    error?: string;
  };
  fishAudio: {
    pythonPath: string;
    scriptPath: string;
    modelDir: string;
    pathsPresent: boolean;
    missing: string[];
  };
};

export async function getStatusReport(config: PockedioConfig = loadConfig()): Promise<StatusReport> {
  const provider = new NetEaseProvider(config);
  const fishAudio = getFishAudioStatus(config);
  try {
    await provider.search({ keyword: "坂本龙一" }, 1);
    return {
      netease: {
        baseUrl: config.netease.baseUrl,
        reachable: true
      },
      fishAudio
    };
  } catch (error) {
    return {
      netease: {
        baseUrl: config.netease.baseUrl,
        reachable: false,
        error: error instanceof Error ? error.message : String(error)
      },
      fishAudio
    };
  }
}

export function getFishAudioStatus(config: PockedioConfig): StatusReport["fishAudio"] {
  const pythonPath = resolveRuntimePath(config.fishAudio.pythonPath);
  const scriptPath = resolveRuntimePath(config.fishAudio.scriptPath);
  const modelDir = resolveRuntimePath(config.fishAudio.modelDir);
  const checks = [
    ["python", pythonPath],
    ["script", scriptPath],
    ["model", modelDir]
  ] as const;
  const missing = checks
    .filter(([, targetPath]) => !fs.existsSync(targetPath))
    .map(([label, targetPath]) => `${label}: ${targetPath}`);

  return {
    pythonPath,
    scriptPath,
    modelDir,
    pathsPresent: missing.length === 0,
    missing
  };
}

export function formatStatusReport(report: StatusReport): string {
  const lines = [
    "Pockedio status",
    `NetEase API: ${report.netease.reachable ? "reachable" : "unreachable"} (${report.netease.baseUrl})`,
    `FishAudio: ${report.fishAudio.pathsPresent ? "paths present" : "missing paths"}`
  ];
  if (report.netease.error) {
    lines.push(`NetEase detail: ${report.netease.error}`);
  }
  if (report.fishAudio.missing.length > 0) {
    lines.push("FishAudio missing:");
    lines.push(...report.fishAudio.missing.map((item) => `- ${item}`));
  }
  return lines.join("\n");
}

export async function printStatus(): Promise<void> {
  console.log(formatStatusReport(await getStatusReport()));
}
