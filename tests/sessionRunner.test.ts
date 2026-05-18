import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/load.js";
import { withDatabase } from "../src/db/database.js";
import { runMigrations } from "../src/db/migrations.js";
import type { LlmClient } from "../src/llm/llmClient.js";
import type { MusicProvider, MusicSearchQuery, MusicTrackCandidate, PlayableTrack } from "../src/providers/musicProvider.js";
import { runSessionTurn } from "../src/session/sessionRunner.js";
import type { GeneratedStation } from "../src/station/stationTypes.js";

function makeConfig() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "pockedio-session-test-"));
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
      playableUrl: `https://example.com/${encodeURIComponent(trackId)}.mp3`,
      urlType: "mp3"
    };
  }
}

function fakeLlm(): LlmClient {
  return {
    generateJson: async () => ({ ok: false, errorCode: "llm_unavailable", error: "unused" }),
    generateText: async () => ({ ok: true, value: "Tonight's set stays crisp and nocturnal." })
  };
}

describe("runSessionTurn", () => {
  it("stores playback input, response, five tracks, and does not call FishAudio", async () => {
    const config = makeConfig();
    let fishAudioCalls = 0;
    const playedUrls: string[] = [];

    const result = await runSessionTurn({
      input: "play something for deep work",
      config,
      provider: new FakeProvider(),
      llm: fakeLlm(),
      buildContext: async () => ({ personality: config.personality }),
      playUrl: async (url) => {
        playedUrls.push(url);
        return { ok: true, target: url, exitCode: 0, signal: null };
      },
      synthesizeFishAudio: async () => {
        fishAudioCalls += 1;
        return { ok: true, audioPath: "/tmp/should-not-run.wav", latencyMs: 1 };
      }
    });

    expect(result.shouldExit).toBe(false);
    expect(result.station?.tracks).toHaveLength(5);
    expect(playedUrls).toHaveLength(1);
    expect(fishAudioCalls).toBe(0);

    const rows = withDatabase(config, (db) => ({
      messages: db.prepare("SELECT role, content FROM messages ORDER BY created_at").all(),
      tracks: db.prepare("SELECT title, playback_status as playbackStatus FROM station_tracks ORDER BY position").all()
    }));
    expect(rows.messages).toContainEqual({ role: "user", content: "play something for deep work" });
    expect(rows.messages.some((row) => (row as { role: string }).role === "pockedio")).toBe(true);
    expect(rows.tracks).toHaveLength(5);
    expect(rows.tracks[0]).toMatchObject({ playbackStatus: "playing" });
  });

  it("generates and records FishAudio only for explicit DJ audio", async () => {
    const config = makeConfig();
    const playedFiles: string[] = [];

    const result = await runSessionTurn({
      input: "make me a spoken DJ intro",
      config,
      provider: new FakeProvider(),
      llm: fakeLlm(),
      synthesizeFishAudio: async (_config, text) => ({
        ok: true,
        audioPath: `/tmp/${text.length}.wav`,
        latencyMs: 12
      }),
      playFile: async (filePath) => {
        playedFiles.push(filePath);
        return { ok: true, target: filePath, exitCode: 0, signal: null };
      }
    });

    expect(result.djAudio?.ok).toBe(true);
    expect(playedFiles).toHaveLength(1);

    const rows = withDatabase(config, (db) => ({
      audio: db.prepare("SELECT text, audio_path as audioPath, status FROM dj_audio").all(),
      messages: db.prepare("SELECT role, content FROM messages ORDER BY created_at").all()
    }));
    expect(rows.audio).toEqual([{
      text: "Tonight's set stays crisp and nocturnal.",
      audioPath: "/tmp/40.wav",
      status: "played"
    }]);
    expect(rows.messages).toContainEqual({
      role: "pockedio",
      content: "Tonight's set stays crisp and nocturnal."
    });
  });

  it("stores feedback without generating a station", async () => {
    const config = makeConfig();

    const result = await runSessionTurn({
      input: "more like this",
      config,
      provider: new FakeProvider(),
      llm: fakeLlm()
    });

    expect(result.station).toBeUndefined();
    const rows = withDatabase(config, (db) => db.prepare("SELECT action, note FROM feedback").all());
    expect(rows).toEqual([{ action: "more_like_this", note: "more like this" }]);
  });

  it("can append multiple turns to an existing session", async () => {
    const config = makeConfig();
    const sessionId = withDatabase(config, (db) => {
      const row = db.prepare("INSERT INTO sessions (id, started_at, trigger_type, trigger_text) VALUES ('session_shared', '2026-05-18T00:00:00.000Z', 'conversation', 'interactive')").run();
      expect(row.changes).toBe(1);
      return "session_shared";
    });

    await runSessionTurn({
      input: "play deep focus",
      config,
      sessionId,
      endSession: false,
      provider: new FakeProvider(),
      llm: fakeLlm(),
      buildContext: async () => ({ personality: config.personality }),
      playUrl: async (url) => ({ ok: true, target: url, exitCode: 0, signal: null })
    });
    await runSessionTurn({
      input: "more like this",
      config,
      sessionId,
      endSession: false,
      provider: new FakeProvider(),
      llm: fakeLlm()
    });

    const rows = withDatabase(config, (db) => db.prepare("SELECT COUNT(*) as count FROM messages WHERE session_id = ?").get(sessionId) as { count: number });
    expect(rows.count).toBeGreaterThanOrEqual(3);
  });
});
