import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/load.js";
import type { PockedioContext } from "../src/context/contextBuilder.js";
import { withDatabase } from "../src/db/database.js";
import { runMigrations } from "../src/db/migrations.js";
import type { LlmClient } from "../src/llm/llmClient.js";
import type { MusicProvider, MusicSearchQuery, MusicTrackCandidate, PlayableTrack } from "../src/providers/musicProvider.js";
import { isEveningDjTime, isMorningDjTime, isWeekday, shouldPromptMoodCheck } from "../src/scheduler/jobs.js";
import { runMoodCheckOnce, runScheduledDjJob } from "../src/scheduler/serve.js";

function makeConfig() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "pockedio-scheduler-test-"));
  const config = loadConfig({ POCKEDIO_HOME: home });
  runMigrations(config);
  fs.writeFileSync(config.paths.taste, "# Pockedio Taste\n\n- Ryuichi Sakamoto\n");
  return config;
}

class FakeProvider implements MusicProvider {
  async search(query: MusicSearchQuery, _limit: number): Promise<MusicTrackCandidate[]> {
    return [{
      provider: "netease",
      providerTrackId: query.keyword,
      title: query.keyword,
      artists: ["Test Artist"],
      album: "Test Album"
    }];
  }

  async getPlayableUrl(trackId: string): Promise<PlayableTrack> {
    return {
      available: true,
      provider: "netease",
      providerTrackId: trackId,
      playableUrl: `https://example.com/${encodeURIComponent(trackId)}.mp3`
    };
  }
}

function fakeLlm(text: string): LlmClient {
  return {
    generateJson: async () => ({ ok: false, errorCode: "llm_unavailable", error: "unused" }),
    generateText: async () => ({ ok: true, value: text })
  };
}

function fakeContext(config = makeConfig(), now = new Date("2026-05-18T08:45:00+08:00")): PockedioContext {
  return {
    now: now.toISOString(),
    timeOfDay: "morning",
    calendar: { available: true, events: [], summary: "No calendar events found for today." },
    weather: null,
    diary: null,
    tastePath: config.paths.taste,
    personality: config.personality,
    recentSessions: []
  };
}

describe("scheduled job decisions", () => {
  it("detects weekday morning and evening DJ windows", () => {
    expect(isWeekday(new Date("2026-05-18T08:45:00+08:00"))).toBe(true);
    expect(isWeekday(new Date("2026-05-17T08:45:00+08:00"))).toBe(false);
    expect(isMorningDjTime(new Date("2026-05-18T08:45:29+08:00"))).toBe(true);
    expect(isMorningDjTime(new Date("2026-05-18T08:46:00+08:00"))).toBe(false);
    expect(isEveningDjTime(new Date("2026-05-18T17:00:20+08:00"))).toBe(true);
  });

  it("prompts mood checks hourly", () => {
    expect(shouldPromptMoodCheck(null, new Date("2026-05-18T09:00:00+08:00"))).toBe(true);
    expect(shouldPromptMoodCheck(
      new Date("2026-05-18T08:15:00+08:00"),
      new Date("2026-05-18T09:00:00+08:00")
    )).toBe(false);
    expect(shouldPromptMoodCheck(
      new Date("2026-05-18T08:00:00+08:00"),
      new Date("2026-05-18T09:00:00+08:00")
    )).toBe(true);
  });
});

describe("scheduled DJ jobs", () => {
  it("generates spoken morning DJ audio, plays it directly, starts music, and stores metadata", async () => {
    const config = makeConfig();
    const playedFiles: string[] = [];
    const playedUrls: string[] = [];

    const result = await runScheduledDjJob({
      kind: "morning",
      now: new Date("2026-05-18T08:45:00+08:00"),
      config,
      context: fakeContext(config),
      provider: new FakeProvider(),
      llm: fakeLlm("Good morning. Here is a focused first hour."),
      synthesizeFishAudio: async (_config, text) => ({
        ok: true,
        audioPath: `/tmp/${text.length}.wav`,
        latencyMs: 5
      }),
      playFile: async (filePath) => {
        playedFiles.push(filePath);
        return { ok: true, target: filePath, exitCode: 0, signal: null };
      },
      playUrl: async (url) => {
        playedUrls.push(url);
        return { ok: true, target: url, exitCode: 0, signal: null };
      }
    });

    expect(result.ran).toBe(true);
    expect(playedFiles).toHaveLength(1);
    expect(playedUrls).toHaveLength(1);

    const rows = withDatabase(config, (db) => ({
      sessions: db.prepare("SELECT trigger_type as triggerType FROM sessions").all(),
      audio: db.prepare("SELECT kind, text, status FROM dj_audio").all(),
      tracks: db.prepare("SELECT COUNT(*) as count FROM station_tracks").get() as { count: number }
    }));
    expect(rows.sessions).toEqual([{ triggerType: "scheduled_morning" }]);
    expect(rows.audio).toEqual([{ kind: "morning", text: "Good morning. Here is a focused first hour.", status: "played" }]);
    expect(rows.tracks.count).toBe(5);
  });

  it("skips scheduled DJ audio when calendar context says a meeting is active", async () => {
    const config = makeConfig();
    const result = await runScheduledDjJob({
      kind: "evening",
      now: new Date("2026-05-18T17:00:00+08:00"),
      config,
      context: {
        ...fakeContext(config, new Date("2026-05-18T17:00:00+08:00")),
        calendar: { available: true, events: [], summary: "A meeting is active now." },
        timeOfDay: "evening"
      },
      provider: new FakeProvider(),
      llm: fakeLlm("Evening transition."),
      synthesizeFishAudio: async () => {
        throw new Error("should not synthesize");
      }
    });

    expect(result).toEqual({ ran: false, reason: "Calendar indicates an active meeting." });
  });
});

describe("mood checks", () => {
  it("stores selected mood and requires confirmation before playback", async () => {
    const config = makeConfig();
    const playedUrls: string[] = [];

    const result = await runMoodCheckOnce({
      config,
      provider: new FakeProvider(),
      llm: fakeLlm("Try a low-friction reset."),
      promptMood: async () => ({ mood: "tired", note: "long day", confirmPlayback: false }),
      playUrl: async (url) => {
        playedUrls.push(url);
        return { ok: true, target: url, exitCode: 0, signal: null };
      }
    });

    expect(result.ran).toBe(true);
    expect(result.playbackStarted).toBe(false);
    expect(playedUrls).toEqual([]);
    const rows = withDatabase(config, (db) => db.prepare("SELECT selected_mood as selectedMood, note FROM mood_checks").all());
    expect(rows).toEqual([{ selectedMood: "tired", note: "long day" }]);
  });
});
