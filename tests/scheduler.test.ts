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
import { isEveningDjTime, isMorningDjPrepareTime, isMorningDjTime, isWeekday, shouldPromptMoodCheck } from "../src/scheduler/jobs.js";
import { prepareScheduledDjJob, runMoodCheckOnce, runScheduledDjJob } from "../src/scheduler/serve.js";

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

function capturingLlm(text: string, prompts: string[]): LlmClient {
  return {
    generateJson: async () => ({ ok: false, errorCode: "llm_unavailable", error: "unused" }),
    generateText: async (prompt) => {
      prompts.push(prompt);
      return { ok: true, value: text };
    }
  };
}

function fakeContext(config = makeConfig(), now = new Date("2026-05-18T08:45:00+08:00")): PockedioContext {
  return {
    now: now.toISOString(),
    timeOfDay: "morning",
    calendar: {
      available: true,
      events: [],
      summary: "No calendar events found for today.",
      listeningHint: "Calendar listening hint for today: no events found, so do not overfit music to calendar pressure."
    },
    weather: null,
    diary: null,
    tastePath: config.paths.taste,
    tasteSignals: [],
    tasteProfile: null,
    memorySummaries: [],
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

  it("uses configured scheduled DJ play and preparation windows", () => {
    const config = makeConfig();
    config.dj.schedule.morning.playTime = "08:30";
    config.dj.schedule.morning.prepareMinutesBefore = 12;
    config.dj.schedule.evening.enabled = false;

    expect(isMorningDjTime(new Date("2026-05-18T08:30:00+08:00"), config)).toBe(true);
    expect(isMorningDjTime(new Date("2026-05-18T08:45:00+08:00"), config)).toBe(false);
    expect(isMorningDjPrepareTime(new Date("2026-05-18T08:18:00+08:00"), config)).toBe(true);
    expect(isEveningDjTime(new Date("2026-05-18T17:00:00+08:00"), config)).toBe(false);
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
  it("prepares scheduled DJ audio before play time, announces readiness, and reuses it after confirmation", async () => {
    const config = makeConfig();
    const playedFiles: string[] = [];
    const output: string[] = [];
    let synthCalls = 0;

    const preparation = await prepareScheduledDjJob({
      kind: "morning",
      now: new Date("2026-05-18T08:35:00+08:00"),
      config,
      context: fakeContext(config),
      llm: fakeLlm("Prepared morning program."),
      synthesizeFishAudio: async (_config, text) => {
        synthCalls += 1;
        return { ok: true, audioPath: `/tmp/prepared-${text.length}.wav`, latencyMs: 4 };
      }
    });

    expect(preparation).toMatchObject({ ran: true, text: "Prepared morning program." });

    const result = await runScheduledDjJob({
      kind: "morning",
      now: new Date("2026-05-18T08:45:00+08:00"),
      config,
      context: fakeContext(config),
      provider: new FakeProvider(),
      llm: fakeLlm("Should not regenerate."),
      synthesizeFishAudio: async () => {
        throw new Error("should not synthesize at play time");
      },
      playFile: async (filePath) => {
        playedFiles.push(filePath);
        return { ok: true, target: filePath, exitCode: 0, signal: null };
      },
      playUrl: async (url) => ({ ok: true, target: url, exitCode: 0, signal: null }),
      promptPlayback: async () => "play",
      writeOutput: (text) => output.push(text)
    });

    expect(result.ran).toBe(true);
    expect(result.playbackStarted).toBe(true);
    expect(result.decision).toBe("play");
    expect(synthCalls).toBe(1);
    expect(playedFiles).toEqual(["/tmp/prepared-25.wav"]);
    expect(output[0]).toBe("Using prepared DJ program.");
    expect(output[1]).toBe("Morning DJ program is ready.\n\nPress Enter to play now, type \"later\" to keep it, or type \"skip\" to dismiss.\nAvailable for 6 hours, until 14:45 on 2026-05-18.");
    expect(output[2]).toBe("Building scheduled station...");
    expect(output[3]).toContain("DJ program lineup:");
    expect(output[3]).toContain("> 1.");
    expect(output[4]).toContain("Now playing: 1/5");
    const rows = withDatabase(config, (db) => ({
      prep: db.prepare("SELECT kind, target_play_time as targetPlayTime, text, audio_path as audioPath, audio_cache_expires_at as audioCacheExpiresAt, status FROM scheduled_dj_preparations").all(),
      audio: db.prepare("SELECT kind, text, audio_path as audioPath, audio_cache_expires_at as audioCacheExpiresAt, status FROM dj_audio").all()
    }));
    expect(rows.prep).toEqual([{
      kind: "morning",
      targetPlayTime: "2026-05-18T08:45:00.000+08:00",
      text: "Prepared morning program.",
      audioPath: "/tmp/prepared-25.wav",
      audioCacheExpiresAt: "2026-05-18T14:45:00.000+08:00",
      status: "played"
    }]);
    expect(rows.audio).toEqual([{
      kind: "morning",
      text: "Prepared morning program.",
      audioPath: "/tmp/prepared-25.wav",
      audioCacheExpiresAt: "2026-05-18T14:45:00.000+08:00",
      status: "played"
    }]);
  });

  it("prompts the LLM for a short FishAudio-safe scheduled DJ opening", async () => {
    const config = makeConfig();
    const prompts: string[] = [];

    await runScheduledDjJob({
      kind: "evening",
      now: new Date("2026-05-18T17:00:00+08:00"),
      config,
      context: { ...fakeContext(config, new Date("2026-05-18T17:00:00+08:00")), timeOfDay: "evening" },
      provider: new FakeProvider(),
      llm: capturingLlm("Evening reset. One breath first, then the first track.", prompts),
      synthesizeFishAudio: async (_config, text) => ({ ok: true, audioPath: `/tmp/${text.length}.wav`, latencyMs: 5 }),
      playFile: async (filePath) => ({ ok: true, target: filePath, exitCode: 0, signal: null }),
      playUrl: async (url) => ({ ok: true, target: url, exitCode: 0, signal: null }),
      promptPlayback: async () => "play"
    });

    expect(prompts[0]).toContain("Keep it under 70 words.");
    expect(prompts[0]).toContain("This is a spoken opening, not the full program transcript.");
    expect(prompts[0]).toContain("Do not list every track.");
  });

  it("uses scheduled-program station logic for five time-of-day tracks", async () => {
    const config = makeConfig();

    const result = await runScheduledDjJob({
      kind: "evening",
      now: new Date("2026-05-18T17:00:00+08:00"),
      config,
      context: { ...fakeContext(config, new Date("2026-05-18T17:00:00+08:00")), timeOfDay: "evening" },
      provider: new FakeProvider(),
      llm: fakeLlm("Evening reset. One breath first, then the first track."),
      synthesizeFishAudio: async (_config, text) => ({ ok: true, audioPath: `/tmp/${text.length}.wav`, latencyMs: 5 }),
      playFile: async (filePath) => ({ ok: true, target: filePath, exitCode: 0, signal: null }),
      playUrl: async (url) => ({ ok: true, target: url, exitCode: 0, signal: null }),
      promptPlayback: async () => "play"
    });

    expect(result.ran).toBe(true);
    expect(result.station?.tracks).toHaveLength(5);
    expect(result.station?.request).toContain("scheduled evening DJ program");
    expect(result.station?.request).toContain("exactly five tracks");
    expect(result.station?.request).toContain("decompression");
  });

  it("holds a generated scheduled DJ program without playback when the user chooses later", async () => {
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
      },
      promptPlayback: async () => "later"
    });

    expect(result).toMatchObject({
      ran: true,
      decision: "later",
      playbackStarted: false,
      text: "Good morning. Here is a focused first hour."
    });
    expect(playedFiles).toEqual([]);
    expect(playedUrls).toEqual([]);

    const rows = withDatabase(config, (db) => ({
      sessions: db.prepare("SELECT trigger_type as triggerType FROM sessions").all(),
      prep: db.prepare("SELECT kind, text, status, audio_cache_expires_at as audioCacheExpiresAt FROM scheduled_dj_preparations").all(),
      audio: db.prepare("SELECT kind, text, status FROM dj_audio").all(),
      tracks: db.prepare("SELECT COUNT(*) as count FROM station_tracks").get() as { count: number }
    }));
    expect(rows.sessions).toEqual([{ triggerType: "scheduled_morning" }]);
    expect(rows.prep).toEqual([{
      kind: "morning",
      text: "Good morning. Here is a focused first hour.",
      status: "generated",
      audioCacheExpiresAt: "2026-05-18T14:45:00.000+08:00"
    }]);
    expect(rows.audio).toEqual([]);
    expect(rows.tracks.count).toBe(0);
  });

  it("does not replay a prepared scheduled DJ program after the six-hour window", async () => {
    const config = makeConfig();

    await prepareScheduledDjJob({
      kind: "morning",
      now: new Date("2026-05-18T08:35:00+08:00"),
      config,
      context: fakeContext(config),
      llm: fakeLlm("Prepared morning program."),
      synthesizeFishAudio: async () => ({ ok: true, audioPath: "/tmp/prepared.wav", latencyMs: 4 })
    });

    const result = await runScheduledDjJob({
      kind: "morning",
      now: new Date("2026-05-18T14:45:01+08:00"),
      config,
      context: fakeContext(config, new Date("2026-05-18T14:45:01+08:00")),
      provider: new FakeProvider(),
      llm: fakeLlm("Should not generate."),
      synthesizeFishAudio: async () => {
        throw new Error("should not synthesize after expiry");
      },
      playFile: async () => {
        throw new Error("should not play after expiry");
      },
      playUrl: async () => {
        throw new Error("should not start music after expiry");
      },
      promptPlayback: async () => "play"
    });

    expect(result).toEqual({ ran: false, reason: "Scheduled morning DJ program expired at 2026-05-18T14:45:00.000+08:00." });
  });

  it("generates spoken morning DJ audio, waits for confirmation, starts music, and stores metadata", async () => {
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
      },
      promptPlayback: async () => "play"
    });

    expect(result.ran).toBe(true);
    expect(result.playbackStarted).toBe(true);
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
        calendar: {
          available: true,
          events: [],
          summary: "A meeting is active now.",
          listeningHint: "Calendar listening hint for today: meeting-heavy context suggests focus before events and decompression after them."
        },
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
