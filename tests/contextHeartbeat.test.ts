import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig, saveConfig } from "../src/config/load.js";
import { getLatestContextRefreshRun, runDailyContextHeartbeat } from "../src/context/heartbeat.js";
import type { RefreshContextResult } from "../src/context/refreshContext.js";
import { withDatabase } from "../src/db/database.js";

const tempDirs: string[] = [];

function makeConfig() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "pockedio-heartbeat-test-"));
  tempDirs.push(home);
  const config = loadConfig({ POCKEDIO_HOME: home });
  config.calendar.enabled = true;
  saveConfig(config, { POCKEDIO_HOME: home });
  return config;
}

function refreshResult(): RefreshContextResult {
  return {
    calendar: {
      available: true,
      eventsRead: 4,
      memoriesUpdated: 1
    },
    diary: {
      available: true,
      latestFile: "/tmp/diary/2026-05-22.md",
      memoriesUpdated: 1
    },
    diaryHistory: {
      available: true,
      filesScanned: 3,
      summariesGenerated: 1,
      summariesReused: 2,
      memoriesUpdated: 3
    },
    tastePath: "/tmp/taste.md"
  };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("daily context heartbeat", () => {
  it("runs once per configured interval and records completed background refreshes", async () => {
    const config = makeConfig();
    let refreshes = 0;

    const first = await runDailyContextHeartbeat(config, {
      now: new Date("2026-05-22T09:00:00+08:00"),
      finishedAt: new Date("2026-05-22T09:00:00+08:00"),
      refresh: async () => {
        refreshes += 1;
        return refreshResult();
      }
    });
    const second = await runDailyContextHeartbeat(config, {
      now: new Date("2026-05-22T18:00:00+08:00"),
      finishedAt: new Date("2026-05-22T18:00:00+08:00"),
      refresh: async () => {
        refreshes += 1;
        return refreshResult();
      }
    });

    expect(refreshes).toBe(2);
    expect(first).toMatchObject({
      status: "completed",
      trigger: "startup_heartbeat",
      localDay: "2026-05-22",
      calendarEventsRead: 4,
      diaryFilesScanned: 3,
      diarySummariesGenerated: 1,
      diarySummariesReused: 2,
      diaryMemoriesUpdated: 4
    });
    expect(second).toMatchObject({
      status: "completed",
      trigger: "startup_heartbeat",
      localDay: "2026-05-22"
    });
    expect(getLatestContextRefreshRun(config)).toMatchObject({ status: "completed" });
  });

  it("skips when the last completed heartbeat is still fresh", async () => {
    const config = makeConfig();
    let refreshes = 0;

    await runDailyContextHeartbeat(config, {
      now: new Date("2026-05-22T09:00:00+08:00"),
      finishedAt: new Date("2026-05-22T09:00:00+08:00"),
      refresh: async () => {
        refreshes += 1;
        return refreshResult();
      }
    });
    const second = await runDailyContextHeartbeat(config, {
      now: new Date("2026-05-22T14:59:00+08:00"),
      refresh: async () => {
        refreshes += 1;
        return refreshResult();
      }
    });

    expect(refreshes).toBe(1);
    expect(second).toBeNull();
  });

  it("retries failed heartbeats after a short cooldown", async () => {
    const config = makeConfig();
    let refreshes = 0;

    await runDailyContextHeartbeat(config, {
      now: new Date("2026-05-22T09:00:00+08:00"),
      finishedAt: new Date("2026-05-22T09:00:00+08:00"),
      refresh: async () => {
        refreshes += 1;
        throw new Error("calendar permission denied");
      }
    });
    const blocked = await runDailyContextHeartbeat(config, {
      now: new Date("2026-05-22T09:20:00+08:00"),
      refresh: async () => {
        refreshes += 1;
        return refreshResult();
      }
    });
    const retried = await runDailyContextHeartbeat(config, {
      now: new Date("2026-05-22T09:31:00+08:00"),
      finishedAt: new Date("2026-05-22T09:31:00+08:00"),
      refresh: async () => {
        refreshes += 1;
        return refreshResult();
      }
    });

    expect(refreshes).toBe(2);
    expect(blocked).toBeNull();
    expect(retried).toMatchObject({ status: "completed" });
  });

  it("records failures without throwing or blocking startup", async () => {
    const config = makeConfig();

    const run = await runDailyContextHeartbeat(config, {
      now: new Date("2026-05-22T09:00:00+08:00"),
      finishedAt: new Date("2026-05-22T09:00:00+08:00"),
      refresh: async () => {
        throw new Error("calendar permission denied");
      }
    });

    expect(run).toMatchObject({
      status: "failed",
      error: "calendar permission denied"
    });
    expect(getLatestContextRefreshRun(config)).toMatchObject({ status: "failed" });
  });

  it("skips when heartbeat or all context sources are disabled", async () => {
    const disabled = {
      ...makeConfig(),
      memory: { dailyHeartbeat: false, heartbeatIntervalHours: 6, heartbeatHistoryLimit: 20 }
    };
    const noSources = {
      ...makeConfig(),
      calendar: { enabled: false },
      diary: { enabled: false, path: undefined }
    };

    expect(await runDailyContextHeartbeat(disabled)).toBeNull();
    expect(await runDailyContextHeartbeat(noSources)).toBeNull();
  });

  it("creates the persistent run table through migrations", async () => {
    const config = makeConfig();

    await runDailyContextHeartbeat(config, {
      now: new Date("2026-05-22T09:00:00+08:00"),
      finishedAt: new Date("2026-05-22T09:00:00+08:00"),
      refresh: async () => refreshResult()
    });

    const row = withDatabase(config, (db) => db.prepare(`
      SELECT COUNT(*) as count
      FROM context_refresh_runs
    `).get()) as { count: number };

    expect(row.count).toBe(1);
  });
});
