import { spawnSync } from "node:child_process";

export type ProcessSnapshot = {
  pid: number;
  ppid: number;
  command: string;
};

export type StopStalePlaybackOptions = {
  currentPid?: number;
  listProcesses?: () => ProcessSnapshot[];
  killProcess?: (pid: number) => void;
};

export function stopStalePockedioPlaybackProcesses(options: StopStalePlaybackOptions = {}): number[] {
  const currentPid = options.currentPid ?? process.pid;
  const processes = options.listProcesses?.() ?? listProcesses();
  const stalePids = findStalePockedioPlaybackPids(processes, currentPid);
  const killProcess = options.killProcess ?? ((pid) => {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // The process may have already exited between ps and kill.
    }
  });

  for (const pid of stalePids) {
    killProcess(pid);
  }
  return stalePids;
}

export function findStalePockedioPlaybackPids(processes: ProcessSnapshot[], currentPid: number): number[] {
  const current = processes.find((processInfo) => processInfo.pid === currentPid);
  const stale = new Set<number>();
  for (const processInfo of processes) {
    if (processInfo.pid === currentPid) {
      continue;
    }
    if (isPockedioOwnedPlayer(processInfo.command) || isSupersededInteractivePockedioProcess(processInfo, current)) {
      stale.add(processInfo.pid);
    }
  }
  return [...stale];
}

function listProcesses(): ProcessSnapshot[] {
  const result = spawnSync("ps", ["-axo", "pid=,ppid=,command="], { encoding: "utf8" });
  if (result.status !== 0 || !result.stdout) {
    return [];
  }
  return result.stdout
    .split("\n")
    .map(parseProcessLine)
    .filter((processInfo): processInfo is ProcessSnapshot => processInfo !== undefined);
}

function parseProcessLine(line: string): ProcessSnapshot | undefined {
  const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);
  if (!match) {
    return undefined;
  }
  return {
    pid: Number(match[1]),
    ppid: Number(match[2]),
    command: match[3]
  };
}

function isPockedioOwnedPlayer(command: string): boolean {
  return /\bmpv\b/.test(command) && /--input-ipc-server=.*pockedio-mpv-/.test(command)
    || /\bafplay\b/.test(command) && /pockedio-playback-/.test(command)
    || /\bffplay\b/.test(command) && /pockedio-playback-/.test(command);
}

function isSupersededInteractivePockedioProcess(
  processInfo: ProcessSnapshot,
  current: ProcessSnapshot | undefined
): boolean {
  if (!current || !isInteractivePockedioCommand(current.command) || !isInteractivePockedioCommand(processInfo.command)) {
    return false;
  }
  return processInfo.pid !== current.pid;
}

function isInteractivePockedioCommand(command: string): boolean {
  if (!/(^|\s|\/)pockedio(\s|$)|\/dist\/cli\.js(\s|$)/.test(command)) {
    return false;
  }
  return !/\b(setup|serve|status|import-taste|refresh-context)\b/.test(command);
}
