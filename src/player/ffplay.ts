import { spawnSync } from "node:child_process";
import { startProcess, type PlaybackHandle } from "./afplay.js";

export type FfplayOptions = {
  command?: string;
};

export function isFfplayAvailable(command = "ffplay"): boolean {
  const result = spawnSync("which", [command], { stdio: "ignore" });
  return result.status === 0;
}

export async function startFfplayUrlPlayback(url: string, options: FfplayOptions = {}): Promise<PlaybackHandle> {
  const command = options.command ?? "ffplay";
  return startProcess(command, buildFfplayArgs(url));
}

export function buildFfplayArgs(url: string): string[] {
  return [
    "-nodisp",
    "-autoexit",
    "-loglevel",
    "error",
    url
  ];
}
