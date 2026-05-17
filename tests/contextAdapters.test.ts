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

  it("parses successful calendar output into event summaries", async () => {
    const context = await readCalendarContext(true, 1, async () => ({
      stdout: "Work | Planning Review | Sun May 17 09:00:00 2026 | Sun May 17 10:00:00 2026\n",
      stderr: "",
      timedOut: false,
      code: 0
    }));

    expect(context.available).toBe(true);
    expect(context.events).toEqual([
      {
        calendarName: "Work",
        title: "Planning Review",
        start: "Sun May 17 09:00:00 2026",
        end: "Sun May 17 10:00:00 2026"
      }
    ]);
    expect(context.summary).toContain("Planning Review");
  });
});

describe("weather adapter", () => {
  it("returns null when weather fetch fails", async () => {
    const failingFetch = async () => {
      throw new Error("network down");
    };

    await expect(readWeatherContext("Shanghai", failingFetch as typeof fetch)).resolves.toBeNull();
  });

  it("returns weather context on successful geocoding and forecast", async () => {
    const responses = [
      new Response(JSON.stringify({
        results: [{ name: "Shanghai", country: "China", latitude: 31.22, longitude: 121.45 }]
      })),
      new Response(JSON.stringify({
        current: {
          temperature_2m: 20,
          relative_humidity_2m: 86,
          precipitation: 0,
          weather_code: 0,
          wind_speed_10m: 10.8
        }
      }))
    ];
    const fetchImpl = async () => responses.shift() ?? new Response("{}", { status: 500 });

    await expect(readWeatherContext("Shanghai", fetchImpl as typeof fetch)).resolves.toMatchObject({
      location: "Shanghai",
      matchedLocation: "Shanghai, China",
      temperatureC: 20,
      relativeHumidity: 86,
      precipitation: 0,
      weatherCode: 0,
      windSpeed: 10.8
    });
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

  it("summarizes only the newest diary file when diary is enabled", () => {
    const diaryDir = fs.mkdtempSync(path.join(os.tmpdir(), "pockedio-diary-"));
    tempDirs.push(diaryDir);
    const older = path.join(diaryDir, "older.md");
    const newer = path.join(diaryDir, "newer.md");
    fs.writeFileSync(older, "older private text");
    fs.writeFileSync(newer, "newer private text");
    const olderDate = new Date("2026-05-16T00:00:00.000Z");
    const newerDate = new Date("2026-05-17T00:00:00.000Z");
    fs.utimesSync(older, olderDate, olderDate);
    fs.utimesSync(newer, newerDate, newerDate);
    const config = makeConfig({ diary: { enabled: true, path: diaryDir } });

    expect(readDiaryContext(config)).toEqual({
      filePath: newer,
      summary: "Latest diary file: newer.md, modified 2026-05-17T00:00:00.000Z."
    });
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
