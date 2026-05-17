import { spawn } from "node:child_process";

export type PlayerResult = {
  ok: boolean;
  target: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  error?: string;
};

export type ProcessRunner = (command: string, args: string[], timeoutMs?: number) => Promise<PlayerResult>;

export async function playUrl(url: string, timeoutMs?: number, runner: ProcessRunner = runProcess): Promise<PlayerResult> {
  return runner("afplay", [url], timeoutMs);
}

export async function playFile(filePath: string, timeoutMs?: number, runner: ProcessRunner = runProcess): Promise<PlayerResult> {
  return runner("afplay", [filePath], timeoutMs);
}

export function runProcess(command: string, args: string[], timeoutMs = 0): Promise<PlayerResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    let settled = false;
    let timer: NodeJS.Timeout | undefined;

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        child.kill("SIGTERM");
        setTimeout(() => child.kill("SIGKILL"), 1_000).unref();
      }, timeoutMs);
    }

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer) {
        clearTimeout(timer);
      }
      resolve({
        ok: false,
        target: args[0] ?? "",
        exitCode: null,
        signal: null,
        error: error.message
      });
    });

    child.on("close", (exitCode, signal) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer) {
        clearTimeout(timer);
      }
      resolve({
        ok: exitCode === 0,
        target: args[0] ?? "",
        exitCode,
        signal,
        error: exitCode === 0 ? undefined : stderr.trim() || `Process exited with code ${exitCode ?? "null"}`
      });
    });
  });
}
