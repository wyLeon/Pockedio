import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig, saveConfig } from "../src/config/load.js";
import type { PockedioConfig } from "../src/config/schema.js";
import { normalizeCalendarWarning, readCalendarContext, requestCalendarPermission } from "../src/context/calendar.js";
import { buildContext } from "../src/context/contextBuilder.js";
import { readDiaryContext, readDiaryContextWithLlmSummary } from "../src/context/diary.js";
import { formatRefreshContextResult, refreshContext } from "../src/context/refreshContext.js";
import { readWeatherContext } from "../src/context/weather.js";
import { withDatabase } from "../src/db/database.js";

const tempDirs: string[] = [];

function makeConfig(overrides: Partial<PockedioConfig> = {}): PockedioConfig {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "pockedio-context-test-"));
  tempDirs.push(home);
  const base = loadConfig({ POCKEDIO_HOME: home });
  const config = {
    ...base,
    ...overrides,
    calendar: { ...base.calendar, ...overrides.calendar },
    weather: { ...base.weather, ...overrides.weather },
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
    expect(context.listeningHint).toBe("Calendar listening hint unavailable.");
    expect(context.warning).toBe("Calendar read timed out.");
  });

  it("parses successful calendar output into event summaries", async () => {
    const context = await readCalendarContext(true, 1, async () => ({
      stdout: "Work | Planning Review | Sun May 17 09:00:00 2026 | Sun May 17 10:00:00 2026 | false\n",
      stderr: "",
      timedOut: false,
      code: 0
    }));

    expect(context.available).toBe(true);
    expect(context.events).toEqual([
      {
        calendarName: "Work",
        title: "Planning Review",
        startTime: "Sun May 17 09:00:00 2026",
        endTime: "Sun May 17 10:00:00 2026",
        isAllDay: false
      }
    ]);
    expect(context.summary).toContain("Planning Review");
    expect(context.listeningHint).toContain("meeting-heavy context");
  });

  it("builds distinct Apple Calendar windows for today, setup, and scheduled DJ reads", async () => {
    const scripts: string[] = [];
    const runner = async (script: string) => {
      scripts.push(script);
      return {
        stdout: "",
        stderr: "",
        timedOut: false,
        code: 0
      };
    };

    await readCalendarContext(true, 1, runner, "today");
    await readCalendarContext(true, 1, runner, "last7Days");
    await readCalendarContext(true, 1, runner, "last7DaysAndToday");

    expect(scripts.join("\n")).not.toContain("≥");
    expect(scripts[0]).toContain("set endOfWindow to startOfWindow + (24 * 60 * 60)");
    expect(scripts[1]).toContain("set startOfWindow to startOfWindow - (7 * 24 * 60 * 60)");
    expect(scripts[1]).toContain("set endOfWindow to current date");
    expect(scripts[2]).toContain("set startOfWindow to startOfWindow - (7 * 24 * 60 * 60)");
    expect(scripts[2]).toContain("set endOfWindow to startOfToday + (24 * 60 * 60)");
  });

  it("normalizes macOS calendar permission errors into actionable setup guidance", async () => {
    const context = await readCalendarContext(true, 1, async () => ({
      stdout: "",
      stderr: "Not authorized to send Apple events to Calendar.",
      timedOut: false,
      code: 1
    }));

    expect(context.available).toBe(false);
    expect(context.warning).toBe(
      "Not authorized to send Apple events to Calendar. Enable Calendar access for your terminal in System Settings > Privacy & Security > Automation or Calendars, then run setup again."
    );
    expect(normalizeCalendarWarning("Calendar got an error: Not authorized.")).toContain("System Settings");
  });

  it("can make a small calendar request to trigger macOS permission", async () => {
    const scripts: string[] = [];
    const result = await requestCalendarPermission(1, async (script) => {
      scripts.push(script);
      return {
        stdout: "0",
        stderr: "",
        timedOut: false,
        code: 0
      };
    });

    expect(result.available).toBe(true);
    expect(scripts[0]).toContain("count of calendars");
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
      windSpeed: 10.8,
      listeningHint: expect.stringContaining("high humidity")
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
      sourceMtime: "2026-05-17T00:00:00.000Z",
      summary: "Latest diary file: newer.md, modified 2026-05-17T00:00:00.000Z.",
      listeningHint: "Diary listening hint unavailable; do not overfit music to diary context."
    });
  });

  it("generates and caches an LLM diary summary for the latest diary file", async () => {
    const diaryDir = fs.mkdtempSync(path.join(os.tmpdir(), "pockedio-diary-"));
    tempDirs.push(diaryDir);
    const entry = path.join(diaryDir, "entry.md");
    fs.writeFileSync(entry, "I felt exhausted after a heavy workday, but the evening was peaceful.");
    const entryDate = new Date("2026-05-18T10:00:00.000Z");
    fs.utimesSync(entry, entryDate, entryDate);
    const config = makeConfig({ diary: { enabled: true, path: diaryDir } });
    const prompts: string[] = [];
    const llm = {
      generateJson: async () => ({ ok: false as const, errorCode: "llm_unavailable" as const, error: "unused" }),
      generateText: async (prompt: string) => {
        prompts.push(prompt);
        return {
          ok: true as const,
          value: [
            "Summary: Recent diary summary: tired after work, better suited to warm recovery music.",
            "Listening hint: Choose low-pressure, warm, emotionally steady music."
          ].join("\n")
        };
      }
    };

    const first = await readDiaryContextWithLlmSummary(config, llm);
    const second = await readDiaryContextWithLlmSummary(config, {
      ...llm,
      generateText: async () => {
        throw new Error("should use cached summary");
      }
    });

    expect(first).toEqual({
      filePath: entry,
      sourceMtime: "2026-05-18T10:00:00.000Z",
      summary: "Recent diary summary: tired after work, better suited to warm recovery music.",
      listeningHint: "Choose low-pressure, warm, emotionally steady music."
    });
    expect(second).toEqual(first);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("Do not quote raw diary text");
    expect(prompts[0]).toContain("Listening hint:");
  });

  it("derives a diary listening hint for legacy cached summaries", async () => {
    const diaryDir = fs.mkdtempSync(path.join(os.tmpdir(), "pockedio-diary-"));
    tempDirs.push(diaryDir);
    const entry = path.join(diaryDir, "entry.md");
    fs.writeFileSync(entry, "I felt exhausted after a heavy workday.");
    const entryDate = new Date("2026-05-18T10:00:00.000Z");
    fs.utimesSync(entry, entryDate, entryDate);
    const config = makeConfig({ diary: { enabled: true, path: diaryDir } });

    const first = await readDiaryContextWithLlmSummary(config, {
      generateJson: async () => ({ ok: false as const, errorCode: "llm_unavailable" as const, error: "unused" }),
      generateText: async () => ({ ok: true as const, value: "Recent diary summary: exhausted after work." })
    });

    expect(first?.listeningHint).toContain("low-pressure");
  });

  it("falls back to metadata diary summary when LLM summary is unavailable", async () => {
    const diaryDir = fs.mkdtempSync(path.join(os.tmpdir(), "pockedio-diary-"));
    tempDirs.push(diaryDir);
    const entry = path.join(diaryDir, "entry.md");
    fs.writeFileSync(entry, "private text");
    const entryDate = new Date("2026-05-18T10:00:00.000Z");
    fs.utimesSync(entry, entryDate, entryDate);
    const config = makeConfig({ diary: { enabled: true, path: diaryDir } });

    const context = await readDiaryContextWithLlmSummary(config, {
      generateJson: async () => ({ ok: false as const, errorCode: "llm_unavailable" as const, error: "unused" }),
      generateText: async () => ({ ok: false as const, errorCode: "llm_unavailable" as const, error: "missing key" })
    });

    expect(context).toEqual({
      filePath: entry,
      sourceMtime: "2026-05-18T10:00:00.000Z",
      summary: "Latest diary file: entry.md, modified 2026-05-18T10:00:00.000Z.",
      listeningHint: "Diary listening hint unavailable; do not overfit music to diary context."
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

  it("does not fetch weather when weather context is disabled", async () => {
    const config = makeConfig({ weather: { enabled: false, location: "Shanghai" } });
    let fetchCalls = 0;

    const context = await buildContext(config, {
      now: new Date("2026-05-17T09:00:00+08:00"),
      calendarRunner: async () => ({
        stdout: "",
        stderr: "",
        timedOut: false,
        code: 0
      }),
      fetchImpl: async () => {
        fetchCalls += 1;
        throw new Error("weather should not be fetched");
      }
    });

    expect(context.weather).toBeNull();
    expect(fetchCalls).toBe(0);
  });

  it("stores today's calendar events during normal context building", async () => {
    const config = makeConfig({ calendar: { enabled: true } });
    const context = await buildContext(config, {
      now: new Date("2026-05-19T09:00:00+08:00"),
      calendarRunner: async () => ({
        stdout: "Personal | Gym | Tue May 19 07:30:00 2026 | Tue May 19 08:30:00 2026 | false\n",
        stderr: "",
        timedOut: false,
        code: 0
      }),
      fetchImpl: async () => {
        throw new Error("weather offline");
      }
    });

    expect(context.calendar.available).toBe(true);
    const db = await import("../src/db/database.js");
    const rows = db.withDatabase(config, (database) => database.prepare(`
      SELECT title, source FROM calendar_events
    `).all());
    expect(rows).toEqual([{ title: "Gym", source: "interactive" }]);
  });

  it("consolidates calendar and diary context into durable memory on refresh", async () => {
    const diaryDir = fs.mkdtempSync(path.join(os.tmpdir(), "pockedio-diary-"));
    tempDirs.push(diaryDir);
    const entry = path.join(diaryDir, "entry.md");
    fs.writeFileSync(entry, "Today felt meeting-heavy, but I want a calmer evening.");
    const entryDate = new Date("2026-05-19T06:00:00.000Z");
    fs.utimesSync(entry, entryDate, entryDate);
    const config = makeConfig({
      calendar: { enabled: true },
      diary: { enabled: true, path: diaryDir }
    });

    const result = await refreshContext(config, {
      now: new Date("2026-05-19T09:00:00+08:00"),
      calendarRunner: async () => ({
        stdout: [
          "Work | Planning Review | Tue May 19 09:30:00 2026 | Tue May 19 10:30:00 2026 | false",
          "Work | Design Sync | Tue May 19 11:00:00 2026 | Tue May 19 12:00:00 2026 | false"
        ].join("\n"),
        stderr: "",
        timedOut: false,
        code: 0
      }),
      llm: {
        generateJson: async () => ({ ok: false as const, errorCode: "llm_unavailable" as const, error: "unused" }),
        generateText: async () => ({
          ok: true as const,
          value: [
            "Summary: Meeting-heavy day with a preference for a calmer evening transition.",
            "Listening hint: Favor steady, low-pressure music with soft momentum."
          ].join("\n")
        })
      }
    });

    expect(result.calendar).toMatchObject({ available: true, eventsRead: 2, memoriesUpdated: 1 });
    expect(result.diary).toMatchObject({ available: true, latestFile: entry, memoriesUpdated: 1 });

    const rows = withDatabase(config, (database) => database.prepare(`
      SELECT kind, content
      FROM memory_items
      WHERE kind IN ('agenda', 'diary')
      ORDER BY kind
    `).all()) as Array<{ kind: string; content: string }>;

    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.kind === "agenda")?.content).toContain("Planning Review");
    expect(rows.find((row) => row.kind === "diary")?.content).toContain("Meeting-heavy day");
  });

  it("formats refresh-context output for manual QA", () => {
    expect(formatRefreshContextResult({
      calendar: { available: true, eventsRead: 3, memoriesUpdated: 1 },
      diary: { available: true, latestFile: "/tmp/diary/entry.md", memoriesUpdated: 1 },
      tastePath: "/tmp/pockedio/taste.md"
    })).toContain("Context memory is ready for future stations.");
  });
});
