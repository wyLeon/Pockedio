import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type SourceInstallStatus =
  | { kind: "source"; root: string; originUrl: string; clean: boolean; dirtyFiles: string[] }
  | { kind: "unsupported"; root?: string; reason: string };

export type SourceUpdateStep = {
  label: string;
  command: string;
  args: string[];
};

export type SourceUpdateOptions = {
  root?: string;
  runner?: ProcessRunner;
  onStepStart?: (step: SourceUpdateStep) => void;
};

export type SourceUpdateResult = {
  ok: boolean;
  root: string;
  failedStep?: string;
  error?: string;
};

export type ProcessRunner = (command: string, args: string[], cwd: string) => Promise<ProcessResult>;

export type ProcessResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
};

export function detectSourceInstall(root = getDefaultProjectRoot()): SourceInstallStatus {
  const worktree = runGit(["rev-parse", "--show-toplevel"], root);
  if (worktree.status !== 0 || !worktree.stdout.trim()) {
    return { kind: "unsupported", root, reason: "Pockedio is not running from a Git source install." };
  }
  const resolvedRoot = worktree.stdout.trim();
  const origin = runGit(["remote", "get-url", "origin"], resolvedRoot);
  if (origin.status !== 0 || !origin.stdout.trim()) {
    return { kind: "unsupported", root: resolvedRoot, reason: "No Git origin remote was found." };
  }
  const originUrl = origin.stdout.trim();
  if (!isPockedioOrigin(originUrl)) {
    return { kind: "unsupported", root: resolvedRoot, reason: `Git origin is not wyLeon/Pockedio: ${originUrl}` };
  }
  const status = runGit(["status", "--porcelain"], resolvedRoot);
  if (status.status !== 0) {
    return { kind: "unsupported", root: resolvedRoot, reason: "Could not read Git working tree status." };
  }
  const dirtyFiles = status.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
  return {
    kind: "source",
    root: resolvedRoot,
    originUrl,
    clean: dirtyFiles.length === 0,
    dirtyFiles
  };
}

export async function runSourceUpdate(options: SourceUpdateOptions = {}): Promise<SourceUpdateResult> {
  const root = options.root ?? getDefaultProjectRoot();
  const status = detectSourceInstall(root);
  if (status.kind !== "source") {
    return { ok: false, root: status.root ?? root, error: status.reason };
  }
  if (!status.clean) {
    return {
      ok: false,
      root: status.root,
      error: `Local changes detected. Commit, stash, or discard them before running pockedio update.\n${status.dirtyFiles.join("\n")}`
    };
  }

  const runner = options.runner ?? runProcess;
  for (const step of buildSourceUpdateSteps()) {
    options.onStepStart?.(step);
    const result = await runner(step.command, step.args, status.root);
    if (result.exitCode !== 0) {
      return {
        ok: false,
        root: status.root,
        failedStep: step.label,
        error: result.stderr.trim() || result.stdout.trim() || `${step.command} exited with ${result.exitCode ?? "null"}`
      };
    }
  }
  return { ok: true, root: status.root };
}

export function buildSourceUpdateSteps(): SourceUpdateStep[] {
  return [
    { label: "Pull latest source", command: "git", args: ["pull", "origin", "main"] },
    { label: "Install dependencies", command: "npm", args: ["install"] },
    { label: "Build CLI", command: "npm", args: ["run", "build"] },
    { label: "Refresh global link", command: "npm", args: ["link"] }
  ];
}

export function getDefaultProjectRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
}

function isPockedioOrigin(originUrl: string): boolean {
  return /github\.com[:/]wyLeon\/Pockedio(?:\.git)?$/i.test(originUrl);
}

function runGit(args: string[], cwd: string): { status: number | null; stdout: string } {
  if (!fs.existsSync(cwd)) {
    return { status: 1, stdout: "" };
  }
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  return { status: result.status, stdout: result.stdout ?? "" };
}

function runProcess(command: string, args: string[], cwd: string): Promise<ProcessResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      resolve({ exitCode: 1, stdout, stderr: error.message });
    });
    child.on("close", (exitCode) => {
      resolve({ exitCode, stdout, stderr });
    });
  });
}
