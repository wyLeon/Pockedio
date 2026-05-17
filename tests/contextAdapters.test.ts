import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig, saveConfig } from "../src/config/load.js";
import type { PockedioConfig } from "../src/config/schema.js";
import { readCalendarContext } from "../src/context/calendar.js";
import { buildContext } from "../src/context/contextBuilder.js";
import { readDiaryContext } from "../src/context/diary.js";
import { readWeatherContext } from "../src/context/weather.js";

const tempDirs: string[] = [];

function makeConfig(overrides: Partial<PockedioConfig> = {}): PockedioConfig {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "pockedio-context-test-"));
  tempDirs.push(home);
  const base = loadConfig({ POCKEDIO_HOME: home });
  const config = {
    ...base,
    ...overrides,
    calendar: { ...base.calendar, ...overrides.calendar },
    diary: { ...base.diary, ...overrides.diary },
    personality: { ...base.personality, ...overrides.personality },
    paths: { ...base.paths, ...overrides.paths }
  };
  saveConfig(config, { POCKEDIO_HOME: home });
  return config;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("calendar adapter", () => {
  it("returns unavailable instead of hanging on timeout", async () => {
    const context = await readCalendarContext(true, 1, async () => ({
      stdout: "",
      stderr: "",
      timedOut: true,
      code: null
    }));

    expect(context.available).toBe(false);
    expect(context.summary).toBe("Calendar context unavailable.");
    expect(context.warning).toBe("Calendar read timed out.");
  });
});

describe("weather adapter", () => {
  it("returns null when weather fetch fails", async () => {
    const failingFetch = async () => {
      throw new Error("network down");
    };

    await expect(readWeatherContext("Shanghai", failingFetch as typeof fetch)).resolves.toBeNull();
  });
});

describe("diary adapter", () => {
  it("does not read files when diary is disabled", () => {
    const diaryDir = fs.mkdtempSync(path.join(os.tmpdir(), "pockedio-diary-"));
    tempDirs.push(diaryDir);
    fs.writeFileSync(path.join(diaryDir, "entry.md"), "private text");
    const config = makeConfig({ diary: { enabled: false, path: diaryDir } });

    expect(readDiaryContext(config)).toBeNull();
  });
});

describe("context builder", () => {
  it("includes MBTI personality context when configured", async () => {
    const config = makeConfig({ personality: { mbti: "INTJ" } });
    const context = await buildContext(config, {
      now: new Date("2026-05-17T09:00:00+08:00"),
      calendarRunner: async () => ({
        stdout: "",
        stderr: "",
        timedOut: false,
        code: 0
      }),
      fetchImpl: async () => {
        throw new Error("weather offline");
      }
    });

    expect(context.personality).toEqual({ mbti: "INTJ" });
    expect(context.weather).toBeNull();
    expect(context.calendar.available).toBe(true);
    expect(context.tastePath).toBe(config.paths.taste);
  });
});
