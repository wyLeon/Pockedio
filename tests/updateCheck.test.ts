import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkForPockedioUpdate,
  compareVersions,
  formatUpdateNotice,
  getUpdateCheckCachePath,
  versionFromTag
} from "../src/update/updateCheck.js";

function makeEnv(): NodeJS.ProcessEnv {
  return { POCKEDIO_HOME: fs.mkdtempSync(path.join(os.tmpdir(), "pockedio-update-check-test-")) };
}

describe("update check", () => {
  it("compares release versions", () => {
    expect(versionFromTag("v0.2.1")).toBe("0.2.1");
    expect(compareVersions("0.2.1", "0.2.0")).toBe(1);
    expect(compareVersions("0.2.0", "0.2.0")).toBe(0);
    expect(compareVersions("0.1.9", "0.2.0")).toBe(-1);
  });

  it("reports an available GitHub release and caches it", async () => {
    const env = makeEnv();
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      return new Response(JSON.stringify({
        tag_name: "v0.2.1",
        html_url: "https://github.com/wyLeon/Pockedio/releases/tag/v0.2.1"
      }), { status: 200 });
    };

    const first = await checkForPockedioUpdate({
      currentVersion: "0.2.0",
      env,
      fetchImpl,
      now: new Date("2026-05-27T00:00:00.000Z")
    });
    const second = await checkForPockedioUpdate({
      currentVersion: "0.2.0",
      env,
      fetchImpl,
      now: new Date("2026-05-27T01:00:00.000Z")
    });

    expect(first).toMatchObject({
      latestVersion: "0.2.1",
      updateAvailable: true,
      source: "network"
    });
    expect(second.source).toBe("cache");
    expect(calls).toBe(1);
    expect(fs.existsSync(getUpdateCheckCachePath(env))).toBe(true);
    expect(formatUpdateNotice(first)).toBe("Update available: Pockedio 0.2.1. Run pockedio update.");
  });

  it("degrades without an update when GitHub is unavailable", async () => {
    const result = await checkForPockedioUpdate({
      currentVersion: "0.2.0",
      env: makeEnv(),
      fetchImpl: async () => {
        throw new Error("offline");
      }
    });

    expect(result.updateAvailable).toBe(false);
    expect(result.error).toContain("offline");
  });
});
