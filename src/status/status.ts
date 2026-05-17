import { loadConfig } from "../config/load.js";
import type { PockedioConfig } from "../config/schema.js";
import { NetEaseProvider } from "../providers/netease.js";

export type StatusReport = {
  netease: {
    baseUrl: string;
    reachable: boolean;
    error?: string;
  };
};

export async function getStatusReport(config: PockedioConfig = loadConfig()): Promise<StatusReport> {
  const provider = new NetEaseProvider(config);
  try {
    await provider.search({ keyword: "坂本龙一" }, 1);
    return {
      netease: {
        baseUrl: config.netease.baseUrl,
        reachable: true
      }
    };
  } catch (error) {
    return {
      netease: {
        baseUrl: config.netease.baseUrl,
        reachable: false,
        error: error instanceof Error ? error.message : String(error)
      }
    };
  }
}

export function formatStatusReport(report: StatusReport): string {
  const lines = [
    "Pockedio status",
    `NetEase API: ${report.netease.reachable ? "reachable" : "unreachable"} (${report.netease.baseUrl})`
  ];
  if (report.netease.error) {
    lines.push(`NetEase detail: ${report.netease.error}`);
  }
  return lines.join("\n");
}

export async function printStatus(): Promise<void> {
  console.log(formatStatusReport(await getStatusReport()));
}
