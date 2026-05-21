import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/load.js";
import { withDatabase } from "../src/db/database.js";
import { runMigrations } from "../src/db/migrations.js";
import type { LlmClient } from "../src/llm/llmClient.js";
import type { MusicProvider, MusicSearchQuery, MusicTrackCandidate, PlayableTrack } from "../src/providers/musicProvider.js";
import { createDefaultInteractiveStartUrlPlayback, formatInteractiveStartupGuide, formatStartupSetupNote, runSessionTurn, type InteractivePlaybackState } from "../src/session/sessionRunner.js";
import type { GeneratedStation } from "../src/station/stationTypes.js";
import type { FishAudioResult } from "../src/tts/fishAudio.js";

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

class DurationProvider extends FakeProvider {
  async getPlayableUrl(trackId: string): Promise<PlayableTrack> {
    return {
      available: true,
      provider: "netease",
      providerTrackId: trackId,
      playableUrl: `https://example.com/${encodeURIComponent(trackId)}.mp3`,
      urlType: "mp3",
      durationMs: 253_000
    };
  }
}

class AmbiguousSongProvider implements MusicProvider {
  async search(query: MusicSearchQuery, _limit: number): Promise<MusicTrackCandidate[]> {
    if (query.keyword.toLowerCase() === "intro") {
      return [
        { provider: "netease", providerTrackId: "intro-the-xx", title: "Intro", artists: ["The xx"], album: "xx" },
        { provider: "netease", providerTrackId: "intro-m83", title: "Intro", artists: ["M83"], album: "Hurry Up, We're Dreaming" },
        { provider: "netease", providerTrackId: "intro-ariana", title: "Intro", artists: ["Ariana Grande"], album: "My Everything" }
      ];
    }

    return [{
      provider: "netease",
      providerTrackId: query.keyword,
      title: query.keyword.includes("Sufjan") ? "To Be Alone With You" : query.keyword,
      artists: query.keyword.includes("Sufjan") ? ["Sufjan Stevens"] : ["Test Artist"],
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

class ArtistStationProvider implements MusicProvider {
  readonly searches: MusicSearchQuery[] = [];

  async search(query: MusicSearchQuery, _limit: number): Promise<MusicTrackCandidate[]> {
    this.searches.push(query);
    if (query.keyword === "Sufjan Stevens") {
      return [
        { provider: "netease", providerTrackId: "chicago", title: "Chicago", artists: ["Sufjan Stevens"], album: "Illinois" },
        { provider: "netease", providerTrackId: "chicago-dup", title: "Chicago", artists: ["Sufjan Stevens"], album: "Illinois" },
        { provider: "netease", providerTrackId: "other", title: "Mystery of Love", artists: ["Other Artist"], album: "Cover" },
        { provider: "netease", providerTrackId: "known-better", title: "Should Have Known Better", artists: ["Sufjan Stevens"], album: "Carrie & Lowell" }
      ];
    }
    if (query.keyword === "Wang OK") {
      return [
        { provider: "netease", providerTrackId: "before-spring", title: "Before spring ends", artists: ["Wang OK", "Duke Lee"], album: "Single" },
        { provider: "netease", providerTrackId: "before-spring-dup", title: "Before spring ends", artists: ["Wang OK", "Duke Lee"], album: "Single" },
        { provider: "netease", providerTrackId: "evening-wind", title: "晚风", artists: ["Copy", "BT07"], album: "Single" },
        { provider: "netease", providerTrackId: "light-chaser", title: "追光者", artists: ["汪苏泷"], album: "Single" },
        { provider: "netease", providerTrackId: "rainy-day", title: "雨天", artists: ["孙燕姿"], album: "Single" },
        { provider: "netease", providerTrackId: "another-wang-ok", title: "Another Wang OK Song", artists: ["Wang OK"], album: "Single" }
      ];
    }

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

class CjkDirectSongProvider implements MusicProvider {
  async search(_query: MusicSearchQuery, _limit: number): Promise<MusicTrackCandidate[]> {
    return [{
      provider: "netease",
      providerTrackId: "moon-river-lisa-ono",
      title: "Moon River",
      artists: ["小野リサ"],
      album: "Pretty World"
    }];
  }

  async getPlayableUrl(trackId: string): Promise<PlayableTrack> {
    return {
      available: true,
      provider: "netease",
      providerTrackId: trackId,
      playableUrl: `https://example.com/${encodeURIComponent(trackId)}.mp3`,
      urlType: "mp3",
      durationMs: 263_000
    };
  }
}

function fakeLlm(): LlmClient {
  return {
    generateJson: async () => ({ ok: false, errorCode: "llm_unavailable", error: "unused" }),
    generateText: async () => ({ ok: true, value: "Tonight's set stays crisp and nocturnal." })
  };
}

function conversationalLlm(response: string, prompts: string[] = []): LlmClient {
  return {
    generateJson: async () => ({ ok: false, errorCode: "llm_unavailable", error: "unused" }),
    generateText: async (prompt) => {
      prompts.push(prompt);
      return { ok: true, value: response };
    }
  };
}

function misclassifyingPlaybackLlm(response: string, prompts: string[] = []): LlmClient {
  return {
    generateJson: async () => ({ ok: true, value: { type: "playback_request", confidence: "high" } }),
    generateText: async (prompt) => {
      prompts.push(prompt);
      return { ok: true, value: response };
    }
  };
}

function unavailableLlm(): LlmClient {
  return {
    generateJson: async () => ({ ok: false, errorCode: "llm_unavailable", error: "missing key" }),
    generateText: async () => ({ ok: false, errorCode: "llm_unavailable", error: "missing key" })
  };
}

describe("runSessionTurn", () => {
  it("formats a concise startup guide for the interactive CLI", () => {
    const guide = formatInteractiveStartupGuide("Mina");

    expect(guide).toContain("Mina is listening.");
    expect(guide).toContain("What are we tuning for?");
    expect(guide).toContain("I'm exhausted and want something calm.");
    expect(guide).toContain("play something for deep work");
    expect(guide).toContain("When I suggest a station:");
    expect(guide).toContain("press Enter to play it");
    expect(guide).toContain("type dj for a spoken DJ version");
    expect(guide).toContain("setup");
    expect(guide).toContain("next");
    expect(guide).toContain("stop");
    expect(guide).toContain("what's playing?");
    expect(guide).toContain("Ctrl+C exits, or cancels while processing");
  });

  it("shows a concise startup setup note when taste is missing", () => {
    const config = loadConfig({ POCKEDIO_HOME: fs.mkdtempSync(path.join(os.tmpdir(), "pockedio-missing-taste-")) });
    const note = formatStartupSetupNote(config);
    const guide = formatInteractiveStartupGuide("Mina", note);

    expect(note).toContain("Taste is not imported yet.");
    expect(guide).toContain("Setup note:");
    expect(guide).toContain("Run pockedio setup");
  });

  it("starts interactive playback without an automatic timeout", async () => {
    let observedTimeout: number | undefined = 30_000;
    const startPlayback = createDefaultInteractiveStartUrlPlayback((_command, args, timeoutMs) => {
      observedTimeout = timeoutMs;
      return {
        target: args[0],
        done: Promise.resolve({ ok: true, target: args[0], exitCode: 0, signal: null }),
        stop: () => undefined
      };
    }, async () => new Response("audio-bytes", {
      status: 200,
      headers: { "content-type": "audio/mpeg" }
    }));

    await startPlayback("https://example.com/song.mp3");

    expect(observedTimeout).toBeUndefined();
  });

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

  it("prints playback progress statuses while handling a station request", async () => {
    const config = makeConfig();
    const statuses: string[] = [];

    await runSessionTurn({
      input: "play something soft for my exhausted mood",
      config,
      provider: new FakeProvider(),
      llm: fakeLlm(),
      buildContext: async () => ({ personality: config.personality }),
      writeStatus: (text) => {
        statuses.push(text);
        return () => undefined;
      },
      playUrl: async (url) => ({ ok: true, target: url, exitCode: 0, signal: null })
    });

    expect(statuses).toEqual([
      "Thinking...",
      "Reading your context...",
      "Building a station...",
      "Starting playback..."
    ]);
  });

  it("plays a specific song directly instead of building a station", async () => {
    const config = makeConfig();
    config.dj.displayName = "Mina";
    const playbackState: InteractivePlaybackState = {};
    const started: string[] = [];

    const result = await runSessionTurn({
      input: "play To Be Alone With You by Sufjan Stevens",
      config,
      playbackState,
      provider: new AmbiguousSongProvider(),
      llm: fakeLlm(),
      startUrlPlayback: async (url) => {
        started.push(url);
        return {
          target: url,
          done: new Promise(() => undefined),
          stop: () => undefined
        };
      }
    });

    expect(result.intent.type).toBe("single_track_playback");
    expect(result.station).toBeUndefined();
    expect(started).toEqual(["https://example.com/To%20Be%20Alone%20With%20You%20Sufjan%20Stevens.mp3"]);
    expect(result.response).toContain("Now playing: To Be Alone With You - Sufjan Stevens");
    expect(result.response).toContain("Mina's note:");
    expect(result.response).toContain("Playing this one directly.");
    expect(result.response).not.toContain("Queue:");
    expect(playbackState.station).toBeUndefined();
    expect(playbackState.storedTracks).toHaveLength(1);
  });

  it("asks the user to choose when a bare song title is ambiguous", async () => {
    const config = makeConfig();
    const playbackState: InteractivePlaybackState = {};
    const started: string[] = [];

    const result = await runSessionTurn({
      input: "play Intro",
      config,
      playbackState,
      provider: new AmbiguousSongProvider(),
      llm: fakeLlm(),
      startUrlPlayback: async (url) => {
        started.push(url);
        return {
          target: url,
          done: new Promise(() => undefined),
          stop: () => undefined
        };
      }
    });

    expect(result.intent.type).toBe("single_track_playback");
    expect(result.station).toBeUndefined();
    expect(started).toEqual([]);
    expect(result.response).toContain("I found a few close matches:");
    expect(result.response).toContain("1. Intro - The xx");
    expect(result.response).toContain("Which one?");
    expect(playbackState.pendingSingleTrackSelection?.candidates).toHaveLength(3);
  });

  it("plays a requested song from natural listen wording", async () => {
    const config = makeConfig();
    const playbackState: InteractivePlaybackState = {};
    const started: string[] = [];

    const result = await runSessionTurn({
      input: "I want to listen 心中的日月",
      config,
      playbackState,
      provider: new AmbiguousSongProvider(),
      llm: {
        generateJson: async () => ({ ok: true, value: { type: "single_track_playback", confidence: "high" } }),
        generateText: async () => ({ ok: true, value: "unused" })
      },
      startUrlPlayback: async (url) => {
        started.push(url);
        return {
          target: url,
          done: new Promise(() => undefined),
          stop: () => undefined
        };
      }
    });

    expect(result.intent.type).toBe("single_track_playback");
    expect(started).toEqual(["https://example.com/%E5%BF%83%E4%B8%AD%E7%9A%84%E6%97%A5%E6%9C%88.mp3"]);
    expect(result.response).toContain("Now playing: 心中的日月 - Test Artist");
    expect(result.response).not.toContain("I can play a specific song");
  });

  it("ignores a copied prompt marker before natural listen wording", async () => {
    const config = makeConfig();
    const playbackState: InteractivePlaybackState = {};
    const started: string[] = [];

    const result = await runSessionTurn({
      input: "> I want to listen 心中的日月",
      config,
      playbackState,
      provider: new AmbiguousSongProvider(),
      llm: {
        generateJson: async () => ({ ok: true, value: { type: "single_track_playback", confidence: "high" } }),
        generateText: async () => ({ ok: true, value: "unused" })
      },
      startUrlPlayback: async (url) => {
        started.push(url);
        return {
          target: url,
          done: new Promise(() => undefined),
          stop: () => undefined
        };
      }
    });

    expect(result.intent.type).toBe("single_track_playback");
    expect(started).toEqual(["https://example.com/%E5%BF%83%E4%B8%AD%E7%9A%84%E6%97%A5%E6%9C%88.mp3"]);
    expect(result.response).toContain("Now playing: 心中的日月 - Test Artist");
  });

  it("starts the chosen single-track match from an ambiguous result", async () => {
    const config = makeConfig();
    const playbackState: InteractivePlaybackState = {};
    const started: string[] = [];

    await runSessionTurn({
      input: "play Intro",
      config,
      playbackState,
      provider: new AmbiguousSongProvider(),
      llm: fakeLlm()
    });

    const result = await runSessionTurn({
      input: "2",
      config,
      playbackState,
      provider: new AmbiguousSongProvider(),
      llm: fakeLlm(),
      startUrlPlayback: async (url) => {
        started.push(url);
        return {
          target: url,
          done: new Promise(() => undefined),
          stop: () => undefined
        };
      }
    });

    expect(result.intent.type).toBe("single_track_selection");
    expect(started).toEqual(["https://example.com/intro-m83.mp3"]);
    expect(result.response).toContain("Now playing: Intro - M83");
    expect(playbackState.pendingSingleTrackSelection).toBeUndefined();
  });

  it("uses a warmer LLM-authored station reply for emotional playback requests", async () => {
    const config = makeConfig();
    const prompts: string[] = [];

    const result = await runSessionTurn({
      input: "play something soft for my exhausted mood",
      config,
      provider: new FakeProvider(),
      llm: conversationalLlm("I hear the exhaustion. I’m keeping this soft, slow, and low-friction before the first track comes in.", prompts),
      buildContext: async () => ({ personality: config.personality }),
      playUrl: async (url) => ({ ok: true, target: url, exitCode: 0, signal: null })
    });

    expect(result.response).toContain("I hear the exhaustion.");
    expect(result.response).not.toContain("I built a five-track station");
    expect(result.response).toContain("Queue:");
    expect(prompts.some((prompt) => prompt.includes("Write a warm, concise station introduction"))).toBe(true);
    expect(prompts[0]).toContain("Station size: 5 tracks total");
    expect(prompts[0]).toContain("Playable tracks:");
    expect(prompts[0]).toContain("Do not claim a different track count");
  });

  it("keeps station intro copy in English by default when the user writes Chinese", async () => {
    const config = makeConfig();
    config.dj.displayName = "Mina";

    const result = await runSessionTurn({
      input: "我今天很累，想听一点放松的音乐",
      config,
      provider: new FakeProvider(),
      llm: conversationalLlm("我听见你今天很累，这个歌单会轻一点。"),
      buildContext: async () => ({ personality: config.personality }),
      playUrl: async (url) => ({ ok: true, target: url, exitCode: 0, signal: null })
    });

    expect(result.response).toContain("I made a five-track station for this request");
    expect(result.response).not.toContain("我听见");
    expect(result.response).not.toContain("for \"我今天");
  });

  it("prints the five-song queue and starts playback without blocking when state is provided", async () => {
    const config = makeConfig();
    const output: string[] = [];
    const playbackState: InteractivePlaybackState = {};

    const result = await runSessionTurn({
      input: "play something for deep work",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: fakeLlm(),
      buildContext: async () => ({ personality: config.personality }),
      writeOutput: (text) => output.push(text),
      startUrlPlayback: async (url) => ({
        target: url,
        done: new Promise(() => undefined),
        stop: () => undefined
      })
    });

    expect(result.station?.tracks).toHaveLength(5);
    const rendered = output.join("\n");
    expect(rendered).toContain("Queue:");
    expect(rendered).toContain("Now playing: 1/5");
    expect(rendered).toContain("Up next:");
    expect(rendered).toContain("> 1.");
    expect(rendered).toContain("  2.");
    expect(rendered).toContain("Pockedio's note:");
    expect(rendered).toContain("This opens the set with deterministic fallback");
    expect(rendered).not.toContain("I’m playing this because");
    expect(rendered).toContain("[>...................] 00:00 elapsed");
    expect(rendered.indexOf("Pockedio's note:")).toBeGreaterThan(rendered.indexOf("[>...................] 00:00 elapsed"));
    expect(rendered.indexOf("Pockedio's note:")).toBeLessThan(rendered.indexOf("Up next:"));
    expect(rendered.indexOf("Up next:")).toBeLessThan(rendered.indexOf("Queue:"));
    expect(playbackState.station?.tracks).toHaveLength(5);
    expect(playbackState.currentIndex).toBe(0);
    expect(playbackState.currentTrackId).toEqual(expect.any(String));
  });

  it("next stops the current track and starts the next playable track", async () => {
    const config = makeConfig();
    let stopCalls = 0;
    const started: string[] = [];
    const playbackState: InteractivePlaybackState = {};

    await runSessionTurn({
      input: "play something for deep work",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: fakeLlm(),
      buildContext: async () => ({ personality: config.personality }),
      startUrlPlayback: async (url) => {
        started.push(url);
        return {
          target: url,
          done: new Promise(() => undefined),
          stop: () => {
            stopCalls += 1;
          }
        };
      }
    });
    const result = await runSessionTurn({
      input: "next",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: fakeLlm()
    });

    expect(result.response).toContain("Now playing:");
    expect(result.response).toContain("Now playing: 2/5");
    expect(result.response).toContain("Up next:");
    expect(result.response).toContain("> 2.");
    expect(result.response).toContain("Pockedio's note:");
    expect(stopCalls).toBe(1);
    expect(started).toHaveLength(2);
    expect(playbackState.currentIndex).toBe(1);
  });

  it("answers what's next on the final track without skipping or ending playback", async () => {
    const config = makeConfig();
    let stopCalls = 0;
    const started: string[] = [];
    const playbackState: InteractivePlaybackState = {};

    await runSessionTurn({
      input: "play something for deep work",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: fakeLlm(),
      buildContext: async () => ({ personality: config.personality }),
      startUrlPlayback: async (url) => {
        started.push(url);
        return {
          target: url,
          done: new Promise(() => undefined),
          stop: () => {
            stopCalls += 1;
          }
        };
      }
    });

    for (let index = 0; index < 4; index += 1) {
      await runSessionTurn({
        input: "next",
        config,
        playbackState,
        provider: new FakeProvider(),
        llm: fakeLlm(),
        startUrlPlayback: async (url) => {
          started.push(url);
          return {
            target: url,
            done: new Promise(() => undefined),
            stop: () => {
              stopCalls += 1;
            }
          };
        }
      });
    }

    expect(playbackState.currentIndex).toBe(4);
    const result = await runSessionTurn({
      input: "what's next?",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: fakeLlm()
    });

    expect(result.intent.type).toBe("playback_status");
    expect(result.response).toContain("Now playing: 5.");
    expect(result.response).toContain("Queue:");
    expect(result.response).not.toContain("No playable tracks remain");
    expect(playbackState.currentIndex).toBe(4);
    expect(started).toHaveLength(5);
    expect(stopCalls).toBe(4);
  });

  it("keeps the session open when next fails to start playback", async () => {
    const config = makeConfig();
    let stopCalls = 0;
    let startCalls = 0;
    const playbackState: InteractivePlaybackState = {};

    await runSessionTurn({
      input: "play something for deep work",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: fakeLlm(),
      buildContext: async () => ({ personality: config.personality }),
      startUrlPlayback: async (url) => {
        startCalls += 1;
        if (startCalls > 1) {
          throw new Error("fetch failed");
        }
        return {
          target: url,
          done: new Promise(() => undefined),
          stop: () => {
            stopCalls += 1;
          }
        };
      }
    });

    const result = await runSessionTurn({
      input: "next",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: fakeLlm()
    });

    expect(result.shouldExit).toBe(false);
    expect(result.response).toContain("I could not start");
    expect(result.response).toContain("Playback detail: fetch failed");
    expect(result.response).toContain("Type next to try the following track");
    expect(stopCalls).toBe(1);
    expect(playbackState.activePlayback).toBeUndefined();
    expect(playbackState.currentIndex).toBe(1);
    expect(playbackState.currentTrackId).toBeUndefined();
  });

  it("pause stops current playback with clear fallback copy when controls are unavailable", async () => {
    const config = makeConfig();
    let stopCalls = 0;
    const playbackState: InteractivePlaybackState = {};

    await runSessionTurn({
      input: "play something for deep work",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: fakeLlm(),
      buildContext: async () => ({ personality: config.personality }),
      startUrlPlayback: async () => ({
        target: "https://example.com/song.mp3",
        done: new Promise(() => undefined),
        stop: () => {
          stopCalls += 1;
        }
      })
    });

    const result = await runSessionTurn({
      input: "pause",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: fakeLlm()
    });

    expect(result.intent.type).toBe("pause");
    expect(result.shouldExit).toBe(false);
    expect(result.response).toBe("Pause is not available with this player, so I stopped playback instead. Install mpv for pause/resume, or type next to continue.");
    expect(stopCalls).toBe(1);
    expect(playbackState.activePlayback).toBeUndefined();
  });

  it("stop stops playback but keeps the session open", async () => {
    const config = makeConfig();
    let stopCalls = 0;
    const playbackState: InteractivePlaybackState = {};

    await runSessionTurn({
      input: "play something for deep work",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: fakeLlm(),
      buildContext: async () => ({ personality: config.personality }),
      startUrlPlayback: async () => ({
        target: "https://example.com/song.mp3",
        done: new Promise(() => undefined),
        stop: () => {
          stopCalls += 1;
        }
      })
    });

    const result = await runSessionTurn({
      input: "stop",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: fakeLlm()
    });

    expect(result.intent.type).toBe("stop");
    expect(result.shouldExit).toBe(false);
    expect(result.response).toBe("Stopped playback.");
    expect(stopCalls).toBe(1);
    expect(playbackState.activePlayback).toBeUndefined();
  });

  it("quit and exit close the session", async () => {
    const config = makeConfig();

    for (const input of ["quit", "exit"]) {
      const result = await runSessionTurn({
        input,
        config,
        playbackState: {},
        provider: new FakeProvider(),
        llm: fakeLlm()
      });

      expect(result.intent.type).toBe("session_exit");
      expect(result.shouldExit).toBe(true);
      expect(result.response).toBe("Session closed.");
    }
  });

  it("explains the mpv requirement when resume is requested without a paused handle", async () => {
    const config = makeConfig();
    const playbackState: InteractivePlaybackState = {};

    const result = await runSessionTurn({
      input: "resume",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: fakeLlm()
    });

    expect(result.intent.type).toBe("resume");
    expect(result.response).toBe("Nothing resumable is paused right now. Install mpv for pause/resume support with streaming playback.");
  });

  it("pause and resume use a controllable playback handle when available", async () => {
    const config = makeConfig();
    let pauseCalls = 0;
    let resumeCalls = 0;
    let stopCalls = 0;
    const playbackState: InteractivePlaybackState = {};

    await runSessionTurn({
      input: "play something for deep work",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: fakeLlm(),
      buildContext: async () => ({ personality: config.personality }),
      startUrlPlayback: async () => ({
        target: "https://example.com/song.mp3",
        done: new Promise(() => undefined),
        stop: () => {
          stopCalls += 1;
        },
        pause: () => {
          pauseCalls += 1;
          return true;
        },
        resume: () => {
          resumeCalls += 1;
          return true;
        }
      })
    });

    const pauseResult = await runSessionTurn({
      input: "pause",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: fakeLlm()
    });
    const resumeResult = await runSessionTurn({
      input: "resume",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: fakeLlm()
    });

    expect(pauseResult.intent.type).toBe("pause");
    expect(pauseResult.response).toBe("Paused.");
    expect(resumeResult.intent.type).toBe("resume");
    expect(resumeResult.response).toBe("Resumed.");
    expect(pauseCalls).toBe(1);
    expect(resumeCalls).toBe(1);
    expect(stopCalls).toBe(0);
    expect(playbackState.activePlayback).toBeDefined();
    expect(playbackState.activePlaybackPaused).toBe(false);
  });

  it("reports current station status with elapsed time", async () => {
    const config = makeConfig();
    const playbackState: InteractivePlaybackState = {};
    const startedAt = new Date("2026-05-18T10:00:00.000Z");

    await runSessionTurn({
      input: "play something for deep work",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: fakeLlm(),
      buildContext: async () => ({ personality: config.personality }),
      now: () => startedAt,
      startUrlPlayback: async (url) => ({
        target: url,
        done: new Promise(() => undefined),
        stop: () => undefined
      })
    });

    const result = await runSessionTurn({
      input: "what's playing?",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: fakeLlm(),
      now: () => new Date("2026-05-18T10:02:05.000Z")
    });

    expect(result.response).toContain("Now playing: 1.");
    expect(result.response).toContain("[====>...............] 02:05 elapsed");
    expect(result.response).toContain("> 1.");
    expect(result.response).toContain("  2.");
  });

  it("shows elapsed over total duration when the playable track has duration", async () => {
    const config = makeConfig();
    const playbackState: InteractivePlaybackState = {};
    const startedAt = new Date("2026-05-18T10:00:00.000Z");

    await runSessionTurn({
      input: "play something for deep work",
      config,
      playbackState,
      provider: new DurationProvider(),
      llm: fakeLlm(),
      buildContext: async () => ({ personality: config.personality }),
      now: () => startedAt,
      startUrlPlayback: async (url) => ({
        target: url,
        done: new Promise(() => undefined),
        stop: () => undefined
      })
    });

    const result = await runSessionTurn({
      input: "what's playing?",
      config,
      playbackState,
      provider: new DurationProvider(),
      llm: fakeLlm(),
      now: () => new Date("2026-05-18T10:00:42.000Z")
    });

    expect(result.response).toContain("[===>................] 00:42 / 04:13");
  });

  it("answers current-track singer questions through grounded DJ conversation", async () => {
    const config = makeConfig();
    const playbackState: InteractivePlaybackState = {};
    const prompts: string[] = [];

    await runSessionTurn({
      input: "play something for deep work",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: fakeLlm(),
      buildContext: async () => ({ personality: config.personality }),
      startUrlPlayback: async (url) => ({
        target: url,
        done: new Promise(() => undefined),
        stop: () => undefined
      })
    });

    const result = await runSessionTurn({
      input: "Who is the singer?",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: {
        generateJson: async () => ({ ok: true, value: { type: "identity_capability", confidence: "high" } }),
        generateText: async (prompt) => {
          prompts.push(prompt);
          return { ok: true, value: "That’s Test Artist on this track. I’d treat the vocal credit from the current metadata first, then keep listening for the arrangement around it." };
        }
      }
    });

    expect(result.intent.type).toBe("conversation");
    expect(result.response).toContain("Test Artist");
    expect(result.response).not.toContain("I am Pockedio");
    expect(prompts[0]).toContain("For current-track questions");
    expect(prompts[0]).toContain("Current track:");
    expect(prompts[0]).toContain("Test Artist");
  });

  it("auto-advances to the next playable track when playback finishes", async () => {
    const config = makeConfig();
    const playbackState: InteractivePlaybackState = {};
    const started: string[] = [];
    let finishFirst: ((value: { ok: boolean; target: string; exitCode: number; signal: null }) => void) | undefined;

    await runSessionTurn({
      input: "play something for deep work",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: fakeLlm(),
      buildContext: async () => ({ personality: config.personality }),
      startUrlPlayback: async (url) => {
        started.push(url);
        return {
          target: url,
          done: new Promise((resolve) => {
            finishFirst = resolve;
          }),
          stop: () => undefined
        };
      }
    });

    finishFirst?.({ ok: true, target: started[0], exitCode: 0, signal: null });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(started).toHaveLength(2);
    expect(playbackState.currentIndex).toBe(1);
    const rows = withDatabase(config, (db) => db.prepare(`
      SELECT position, playback_status as playbackStatus
      FROM station_tracks
      ORDER BY position
      LIMIT 2
    `).all());
    expect(rows).toEqual([
      { position: 1, playbackStatus: "played" },
      { position: 2, playbackStatus: "playing" }
    ]);
  });

  it("announces the next track when playback auto-advances", async () => {
    const config = makeConfig();
    const playbackState: InteractivePlaybackState = {};
    const output: string[] = [];
    let finishFirst: ((value: { ok: boolean; target: string; exitCode: number; signal: null }) => void) | undefined;

    await runSessionTurn({
      input: "play something for deep work",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: fakeLlm(),
      buildContext: async () => ({ personality: config.personality }),
      writeOutput: (text) => output.push(text),
      startUrlPlayback: async (url) => ({
        target: url,
        done: new Promise((resolve) => {
          if (!finishFirst) {
            finishFirst = resolve;
          }
        }),
        stop: () => undefined
      })
    });

    finishFirst?.({ ok: true, target: "first", exitCode: 0, signal: null });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(output.filter((text) => text.includes("Now playing:"))).toHaveLength(2);
    expect(output.filter((text) => text.includes("Pockedio's note:"))).toHaveLength(2);
    expect(output.at(-1)).toContain("Now playing: 2/5");
    expect(output.at(-1)).toContain("> 2.");
    const storedTransition = withDatabase(config, (db) => db.prepare(`
      SELECT content
      FROM messages
      WHERE role = 'pockedio' AND content LIKE '%Now playing: 2/5%'
      LIMIT 1
    `).get()) as { content: string } | undefined;
    expect(storedTransition?.content).toContain("Now playing: 2/5");
  });

  it("prints auto-advance playback surfaces after the active conversation response", async () => {
    const config = makeConfig();
    const playbackState: InteractivePlaybackState = {};
    const output: string[] = [];
    let finishFirst: ((value: { ok: boolean; target: string; exitCode: number; signal: null }) => void) | undefined;

    await runSessionTurn({
      input: "play something for deep work",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: fakeLlm(),
      buildContext: async () => ({ personality: config.personality }),
      writeOutput: (text) => output.push(text),
      startUrlPlayback: async (url) => ({
        target: url,
        done: new Promise((resolve) => {
          if (!finishFirst) {
            finishFirst = resolve;
          }
        }),
        stop: () => undefined
      })
    });

    const result = await runSessionTurn({
      input: "Tell me about this track",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: {
        generateJson: async () => ({ ok: true, value: { type: "conversation", confidence: "high" } }),
        generateText: async () => {
          finishFirst?.({ ok: true, target: "first", exitCode: 0, signal: null });
          await Promise.resolve();
          await Promise.resolve();
          return { ok: true, value: "This track has a steady, focused pulse." };
        }
      },
      writeOutput: (text) => output.push(text),
      startUrlPlayback: async (url) => ({
        target: url,
        done: new Promise(() => undefined),
        stop: () => undefined
      })
    });

    expect(result.response).toBe("This track has a steady, focused pulse.");
    const conversationIndex = output.findIndex((text) => text === "This track has a steady, focused pulse.");
    const transitionIndex = output.findIndex((text, index) => index > conversationIndex && text.includes("Now playing: 2/5"));
    expect(conversationIndex).toBeGreaterThan(-1);
    expect(transitionIndex).toBeGreaterThan(conversationIndex);
  });

  it("announces station completion when the final track finishes", async () => {
    const config = makeConfig();
    config.dj.displayName = "Mina";
    const playbackState: InteractivePlaybackState = {};
    const output: string[] = [];
    const finishers: Array<(value: { ok: boolean; target: string; exitCode: number; signal: null }) => void> = [];

    await runSessionTurn({
      input: "play something for deep work",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: fakeLlm(),
      buildContext: async () => ({ personality: config.personality }),
      writeOutput: (text) => output.push(text),
      startUrlPlayback: async (url) => ({
        target: url,
        done: new Promise((resolve) => {
          finishers.push(resolve);
        }),
        stop: () => undefined
      })
    });

    for (let index = 0; index < 5; index += 1) {
      finishers[index]?.({ ok: true, target: `track-${index + 1}`, exitCode: 0, signal: null });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    expect(output.at(-1)).toBe("That station’s done. Press Enter to continue this vibe, or tell me where to take it next.");
    expect(playbackState.pendingStationRequest).toBe("play something for deep work");
  });

  it("attaches feedback to the current playing track", async () => {
    const config = makeConfig();
    const playbackState: InteractivePlaybackState = {};

    await runSessionTurn({
      input: "play something for deep work",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: fakeLlm(),
      buildContext: async () => ({ personality: config.personality }),
      startUrlPlayback: async (url) => ({
        target: url,
        done: new Promise(() => undefined),
        stop: () => undefined
      })
    });
    await runSessionTurn({
      input: "more like this",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: fakeLlm()
    });

    const rows = withDatabase(config, (db) => db.prepare(`
      SELECT f.action, st.position
      FROM feedback f
      JOIN station_tracks st ON st.id = f.track_id
    `).all());
    expect(rows).toEqual([{ action: "more_like_this", position: 1 }]);
    const signals = withDatabase(config, (db) => db.prepare(`
      SELECT signal_type as signalType, target_type as targetType, target_value as targetValue, weight
      FROM taste_signals
      ORDER BY weight DESC
    `).all());
    expect(signals).toEqual([
      {
        signalType: "positive_seed",
        targetType: "track",
        targetValue: "something deep work - Test Artist",
        weight: 3
      },
      {
        signalType: "positive_seed",
        targetType: "artist",
        targetValue: "Test Artist",
        weight: 2
      },
      {
        signalType: "positive_seed",
        targetType: "station_request",
        targetValue: "play something for deep work",
        weight: 2
      }
    ]);
  });

  it("records soft negative, favorite, and saved-vibe feedback as taste signals", async () => {
    const config = makeConfig();
    const playbackState: InteractivePlaybackState = {};

    await runSessionTurn({
      input: "play something for deep work",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: fakeLlm(),
      buildContext: async () => ({ personality: config.personality }),
      startUrlPlayback: async (url) => ({
        target: url,
        done: new Promise(() => undefined),
        stop: () => undefined
      })
    });

    for (const input of ["less like this", "favorite this", "save this vibe"]) {
      await runSessionTurn({
        input,
        config,
        playbackState,
        provider: new FakeProvider(),
        llm: fakeLlm()
      });
    }

    const rows = withDatabase(config, (db) => db.prepare(`
      SELECT action FROM feedback ORDER BY created_at
    `).all());
    expect(rows).toEqual([
      { action: "less_like_this" },
      { action: "favorite" },
      { action: "save_vibe" }
    ]);
    const signals = withDatabase(config, (db) => db.prepare(`
      SELECT signal_type as signalType, target_type as targetType, target_value as targetValue, weight
      FROM taste_signals
      ORDER BY created_at
    `).all());
    expect(signals).toEqual(expect.arrayContaining([
      {
        signalType: "negative_seed",
        targetType: "track",
        targetValue: "something deep work - Test Artist",
        weight: -2
      },
      {
        signalType: "favorite",
        targetType: "track",
        targetValue: "something deep work - Test Artist",
        weight: 5
      },
      {
        signalType: "vibe_preset",
        targetType: "vibe",
        targetValue: "play something for deep work",
        weight: 4
      }
    ]));
  });

  it("updates taste.md from local feedback when the user asks", async () => {
    const config = makeConfig();
    const playbackState: InteractivePlaybackState = {};

    await runSessionTurn({
      input: "play something for deep work",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: fakeLlm(),
      buildContext: async () => ({ personality: config.personality }),
      startUrlPlayback: async (url) => ({
        target: url,
        done: new Promise(() => undefined),
        stop: () => undefined
      })
    });
    await runSessionTurn({
      input: "favorite this",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: fakeLlm()
    });

    const result = await runSessionTurn({
      input: "update my taste profile",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: fakeLlm()
    });

    expect(result.intent.type).toBe("taste_profile_update");
    expect(result.response).toContain("Updated your taste profile.");
    expect(fs.readFileSync(config.paths.taste, "utf8")).toContain("## Generated Taste Profile");
    const snapshot = withDatabase(config, (db) => db.prepare("SELECT summary FROM taste_profile_snapshots").get()) as { summary: string };
    expect(snapshot.summary).toContain("High-Confidence Favorites");
  });

  it("updates durable session memory when the user asks", async () => {
    const config = makeConfig();
    const playbackState: InteractivePlaybackState = {};
    const sessionId = "memory-session";

    withDatabase(config, (db) => {
      db.prepare(`
        INSERT INTO sessions (id, started_at, trigger_type, trigger_text)
        VALUES (?, ?, ?, ?)
      `).run(sessionId, new Date().toISOString(), "conversation", "interactive session");
    });

    await runSessionTurn({
      input: "This kind of piano reminds me of winter evenings in university.",
      config,
      sessionId,
      endSession: false,
      playbackState,
      provider: new FakeProvider(),
      llm: conversationalLlm("That memory fits this patient, spacious lane.")
    });

    const result = await runSessionTurn({
      input: "summarize this session",
      config,
      sessionId,
      endSession: false,
      playbackState,
      provider: new FakeProvider(),
      llm: fakeLlm()
    });

    expect(result.intent.type).toBe("session_memory_update");
    expect(result.response).toContain("Updated session memory.");
    const summary = withDatabase(config, (db) => db.prepare(`
      SELECT content
      FROM memory_items
      WHERE kind = 'summary'
      ORDER BY created_at DESC, rowid DESC
      LIMIT 1
    `).get()) as { content: string };
    expect(summary.content).toContain("winter evenings in university");
  });

  it("keeps music playing while responding to personal listening memories", async () => {
    const config = makeConfig();
    const playbackState: InteractivePlaybackState = {};
    let stopCalls = 0;

    await runSessionTurn({
      input: "play something for deep work",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: fakeLlm(),
      buildContext: async () => ({ personality: config.personality }),
      startUrlPlayback: async (url) => ({
        target: url,
        done: new Promise(() => undefined),
        stop: () => {
          stopCalls += 1;
        }
      })
    });

    const currentIndex = playbackState.currentIndex;
    const currentTrackId = playbackState.currentTrackId;
    const prompts: string[] = [];
    const result = await runSessionTurn({
      input: "This kind of piano reminds me of winter evenings in university.",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: conversationalLlm("That memory fits this patient, spacious lane. I will keep the set reflective without turning it into productivity music.", prompts)
    });

    expect(result.intent.type).toBe("conversation");
    expect(result.station).toBeUndefined();
    expect(result.response).toContain("patient, spacious");
    expect(stopCalls).toBe(0);
    expect(playbackState.currentIndex).toBe(currentIndex);
    expect(playbackState.currentTrackId).toBe(currentTrackId);
    expect(prompts[0]).toContain("winter evenings in university");

    const rows = withDatabase(config, (db) => db.prepare("SELECT role, content FROM messages ORDER BY created_at DESC, rowid DESC LIMIT 2").all());
    expect(rows).toEqual([
      { role: "pockedio", content: result.response },
      { role: "user", content: "This kind of piano reminds me of winter evenings in university." }
    ]);
  });

  it("uses calendar context for contextual conversation without starting playback", async () => {
    const config = makeConfig();
    const prompts: string[] = [];
    const result = await runSessionTurn({
      input: "How should I get through this afternoon?",
      config,
      playbackState: {},
      provider: new FakeProvider(),
      llm: conversationalLlm("You have a meeting-heavy afternoon, so I would keep the music low-friction and steady.", prompts),
      buildContext: async () => ({
        calendar: {
          available: true,
          events: [],
          summary: "Calendar has 3 events for today: Design Sync; Planning Review; 1:1.",
          listeningHint: "Calendar listening hint for today: meeting-heavy context suggests focus before events and decompression after them."
        },
        personality: config.personality
      })
    });

    expect(result.intent.type).toBe("conversation");
    expect(result.station).toBeUndefined();
    expect(result.response).toContain("meeting-heavy");
    expect(prompts[0]).toContain("Calendar summary:");
    expect(prompts[0]).toContain("Calendar listening hint:");
  });

  it("uses current track and queue context for music conversation during playback", async () => {
    const config = makeConfig();
    const playbackState: InteractivePlaybackState = {};
    const prompts: string[] = [];

    await runSessionTurn({
      input: "play something for deep work",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: fakeLlm(),
      buildContext: async () => ({ personality: config.personality }),
      startUrlPlayback: async (url) => ({
        target: url,
        done: new Promise(() => undefined),
        stop: () => undefined
      })
    });

    const result = await runSessionTurn({
      input: "Why did you pick this track?",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: conversationalLlm("I opened here because the current track keeps the set focused without crowding the room.", prompts)
    });

    expect(result.intent.type).toBe("conversation");
    expect(result.response).toContain("current track");
    expect(prompts[0]).toContain("Current track:");
    expect(prompts[0]).toContain("Queue:");
  });

  it("keeps current-track questions conversational even if LLM intent misclassifies them", async () => {
    const config = makeConfig();
    const playbackState: InteractivePlaybackState = {};
    const prompts: string[] = [];
    const started: string[] = [];
    let stopCalls = 0;

    await runSessionTurn({
      input: "play something for deep work",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: fakeLlm(),
      buildContext: async () => ({ personality: config.personality }),
      startUrlPlayback: async (url) => {
        started.push(url);
        return {
          target: url,
          done: new Promise(() => undefined),
          stop: () => {
            stopCalls += 1;
          }
        };
      }
    });

    const currentIndex = playbackState.currentIndex;
    const currentTrackId = playbackState.currentTrackId;
    const result = await runSessionTurn({
      input: "Who is the singer?",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: misclassifyingPlaybackLlm("The singer here is Test Artist.", prompts),
      buildContext: async () => ({ personality: config.personality }),
      startUrlPlayback: async (url) => {
        started.push(url);
        return {
          target: url,
          done: new Promise(() => undefined),
          stop: () => {
            stopCalls += 1;
          }
        };
      }
    });

    expect(result.intent.type).toBe("conversation");
    expect(result.station).toBeUndefined();
    expect(result.response).toContain("Test Artist");
    expect(started).toHaveLength(1);
    expect(stopCalls).toBe(0);
    expect(playbackState.currentIndex).toBe(currentIndex);
    expect(playbackState.currentTrackId).toBe(currentTrackId);
    expect(prompts[0]).toContain("For current-track questions");
    expect(prompts[0]).toContain("Current track:");
    expect(prompts[0]).toContain("Test Artist");
  });

  it("routes artist background questions during playback to grounded LLM conversation", async () => {
    const config = makeConfig();
    const playbackState: InteractivePlaybackState = {};
    const prompts: string[] = [];
    const started: string[] = [];

    await runSessionTurn({
      input: "play something for deep work",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: fakeLlm(),
      buildContext: async () => ({ personality: config.personality }),
      startUrlPlayback: async (url) => {
        started.push(url);
        return {
          target: url,
          done: new Promise(() => undefined),
          stop: () => undefined
        };
      }
    });

    const currentIndex = playbackState.currentIndex;
    const currentTrackId = playbackState.currentTrackId;
    const result = await runSessionTurn({
      input: "Tell me about Kenny Dorham",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: {
        generateJson: async () => ({ ok: true, value: { type: "single_track_playback", confidence: "high" } }),
        generateText: async (prompt) => {
          prompts.push(prompt);
          return { ok: true, value: "Kenny Dorham was a lyrical hard bop trumpeter, and I’d keep his lines in mind while this set moves." };
        }
      },
      buildContext: async () => ({ personality: config.personality }),
      startUrlPlayback: async (url) => {
        started.push(url);
        return {
          target: url,
          done: new Promise(() => undefined),
          stop: () => undefined
        };
      }
    });

    expect(result.intent.type).toBe("conversation");
    expect(result.response).toContain("Kenny Dorham");
    expect(result.response).not.toContain("I can play a specific song");
    expect(prompts[0]).toContain("Tell me about Kenny Dorham");
    expect(prompts[0]).toContain("Current track:");
    expect(prompts[0]).toContain("For artist or song background questions");
    expect(started).toHaveLength(1);
    expect(playbackState.currentIndex).toBe(currentIndex);
    expect(playbackState.currentTrackId).toBe(currentTrackId);
  });

  it("resolves 'the singer' background questions against current playback instead of starting music", async () => {
    const config = makeConfig();
    const playbackState: InteractivePlaybackState = {};
    const prompts: string[] = [];
    const started: string[] = [];

    await runSessionTurn({
      input: "play something for deep work",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: fakeLlm(),
      buildContext: async () => ({ personality: config.personality }),
      startUrlPlayback: async (url) => {
        started.push(url);
        return {
          target: url,
          done: new Promise(() => undefined),
          stop: () => undefined
        };
      }
    });

    const currentIndex = playbackState.currentIndex;
    const currentTrackId = playbackState.currentTrackId;
    const result = await runSessionTurn({
      input: "Tell me about the singer",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: {
        generateJson: async () => ({ ok: true, value: { type: "single_track_playback", confidence: "high" } }),
        generateText: async (prompt) => {
          prompts.push(prompt);
          return { ok: true, value: "The listed artist here is Test Artist. I’d start there before guessing at unverified credits." };
        }
      },
      buildContext: async () => ({ personality: config.personality }),
      startUrlPlayback: async (url) => {
        started.push(url);
        return {
          target: url,
          done: new Promise(() => undefined),
          stop: () => undefined
        };
      }
    });

    expect(result.intent.type).toBe("conversation");
    expect(result.station).toBeUndefined();
    expect(result.response).toContain("Test Artist");
    expect(prompts[0]).toContain("Tell me about the singer");
    expect(prompts[0]).toContain("Current track:");
    expect(started).toHaveLength(1);
    expect(playbackState.currentIndex).toBe(currentIndex);
    expect(playbackState.currentTrackId).toBe(currentTrackId);
  });

  it("keeps English LLM music background answers that preserve CJK artist names", async () => {
    const config = makeConfig();
    const playbackState: InteractivePlaybackState = {};
    const prompts: string[] = [];
    const started: string[] = [];

    await runSessionTurn({
      input: "play Moon River",
      config,
      playbackState,
      provider: new CjkDirectSongProvider(),
      llm: fakeLlm(),
      buildContext: async () => ({ personality: config.personality }),
      startUrlPlayback: async (url) => {
        started.push(url);
        return {
          target: url,
          done: new Promise(() => undefined),
          stop: () => undefined
        };
      }
    });

    const result = await runSessionTurn({
      input: "Tell me about this song.",
      config,
      playbackState,
      provider: new CjkDirectSongProvider(),
      llm: {
        generateJson: async () => ({ ok: true, value: { type: "conversation", confidence: "high" } }),
        generateText: async (prompt) => {
          prompts.push(prompt);
          return { ok: true, value: "Moon River began as a Henry Mancini and Johnny Mercer song for Breakfast at Tiffany’s. 小野リサ’s version leans into bossa nova ease, so it lands softer and more intimate here." };
        }
      }
    });

    expect(result.intent.type).toBe("conversation");
    expect(result.response).toContain("Breakfast at Tiffany");
    expect(result.response).toContain("小野リサ");
    expect(result.response).not.toContain("I do not have verified credits");
    expect(prompts[0]).toContain("Moon River - 小野リサ");
    expect(started).toHaveLength(1);
  });

  it("recognizes song background questions even when background comes after the song reference", async () => {
    const config = makeConfig();
    const playbackState: InteractivePlaybackState = {};
    const prompts: string[] = [];
    const started: string[] = [];

    await runSessionTurn({
      input: "play Moon River",
      config,
      playbackState,
      provider: new CjkDirectSongProvider(),
      llm: fakeLlm(),
      buildContext: async () => ({ personality: config.personality }),
      startUrlPlayback: async (url) => {
        started.push(url);
        return {
          target: url,
          done: new Promise(() => undefined),
          stop: () => undefined
        };
      }
    });

    const result = await runSessionTurn({
      input: "I mean the song you are playing, any background?",
      config,
      playbackState,
      provider: new CjkDirectSongProvider(),
      llm: {
        generateJson: async () => ({ ok: true, value: { type: "single_track_playback", confidence: "high" } }),
        generateText: async (prompt) => {
          prompts.push(prompt);
          return { ok: true, value: "Yes, I mean Moon River here: originally a cinematic standard, now softened by 小野リサ’s bossa nova phrasing." };
        }
      },
      startUrlPlayback: async (url) => {
        started.push(url);
        return {
          target: url,
          done: new Promise(() => undefined),
          stop: () => undefined
        };
      }
    });

    expect(result.intent.type).toBe("conversation");
    expect(result.response).toContain("Moon River");
    expect(result.response).toContain("小野リサ");
    expect(result.station).toBeUndefined();
    expect(prompts[0]).toContain("I mean the song you are playing, any background?");
    expect(started).toHaveLength(1);
  });

  it("answers personal taste insights even when no station is playing", async () => {
    const config = makeConfig();

    const result = await runSessionTurn({
      input: "I realized I like spacious instrumental music.",
      config,
      provider: new FakeProvider(),
      llm: conversationalLlm("That is a useful taste signal. I will treat spacious instrumental music as a patient, low-pressure lane for future stations.")
    });

    expect(result.intent.type).toBe("conversation");
    expect(result.response).toContain("taste signal");
    expect(result.response).not.toContain("Tell me what you want to hear");
  });

  it("uses imported taste.md when answering direct taste questions", async () => {
    const config = makeConfig();
    fs.writeFileSync(config.paths.taste, [
      "# Pockedio Taste",
      "",
      "## Imported Tracks",
      "",
      "- Merry Christmas Mr. Lawrence - Ryuichi Sakamoto",
      "- An Ending (Ascent) - Brian Eno",
      ""
    ].join("\n"));
    const prompts: string[] = [];

    const result = await runSessionTurn({
      input: "What is my taste for music?",
      config,
      provider: new FakeProvider(),
      llm: conversationalLlm("Your imported playlist points toward spacious piano and ambient instrumentals.", prompts)
    });

    expect(result.intent.type).toBe("conversation");
    expect(prompts[0]).toContain("Taste context:");
    expect(prompts[0]).toContain("Merry Christmas Mr. Lawrence - Ryuichi Sakamoto");
    expect(prompts[0]).toContain("An Ending (Ascent) - Brian Eno");
    expect(result.response).toContain("imported playlist");
  });

  it("keeps plain fallback conversation human without starting playback", async () => {
    const config = makeConfig();
    const playedUrls: string[] = [];
    const prompts: string[] = [];

    const result = await runSessionTurn({
      input: "I'm tired today.",
      config,
      playbackState: {},
      provider: new FakeProvider(),
      llm: conversationalLlm("That sounds heavy. Keep the evening low-pressure; if you want music for it, I can shape something gentle.", prompts),
      playUrl: async (url) => {
        playedUrls.push(url);
        return { ok: true, target: url, exitCode: 0, signal: null };
      }
    });

    expect(result.intent.type).toBe("conversation");
    expect(result.station).toBeUndefined();
    expect(result.response).toContain("low-pressure");
    expect(playedUrls).toEqual([]);
    expect(prompts[0]).toContain("Normal conversation is the default");
  });

  it("does not surprise-start playback for ambiguous fallback wording", async () => {
    const config = makeConfig();
    const playedUrls: string[] = [];
    const prompts: string[] = [];

    const result = await runSessionTurn({
      input: "Something softer maybe?",
      config,
      playbackState: {},
      provider: new FakeProvider(),
      llm: conversationalLlm("Do you want me to shape a softer station, or just talk through the mood first?", prompts),
      playUrl: async (url) => {
        playedUrls.push(url);
        return { ok: true, target: url, exitCode: 0, signal: null };
      }
    });

    expect(result.intent.type).toBe("conversation");
    expect(result.station).toBeUndefined();
    expect(result.response).toContain("softer station");
    expect(playedUrls).toEqual([]);
    expect(prompts[0]).toContain("Do not turn a question into playback");
  });

  it("answers unsupported fallback actions with available nearby controls", async () => {
    const config = makeConfig();
    const prompts: string[] = [];

    const result = await runSessionTurn({
      input: "Crossfade this into Spotify.",
      config,
      playbackState: {},
      provider: new FakeProvider(),
      llm: conversationalLlm("I can't hand this off to Spotify yet. I can keep playing here, skip, pause, show the queue, or build a new station.", prompts)
    });

    expect(result.intent.type).toBe("conversation");
    expect(result.station).toBeUndefined();
    expect(result.response).toContain("can't hand this off to Spotify yet");
    expect(prompts[0]).toContain("Do not claim spoken audio was generated");
  });

  it("uses current playback facts for fallback music knowledge when the LLM is unavailable", async () => {
    const config = makeConfig();
    const playbackState: InteractivePlaybackState = {};

    await runSessionTurn({
      input: "play something for deep work",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: fakeLlm(),
      buildContext: async () => ({ personality: config.personality }),
      startUrlPlayback: async (url) => ({
        target: url,
        done: new Promise(() => undefined),
        stop: () => undefined
      })
    });

    const result = await runSessionTurn({
      input: "Tell me about this song.",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: unavailableLlm()
    });

    expect(result.intent.type).toBe("conversation");
    expect(result.response).toContain("listed artist");
    expect(result.response).toContain("Test Artist");
    expect(result.response).not.toContain("I can play a specific song");
  });

  it("keeps deterministic fallback conversation useful when the LLM is unavailable", async () => {
    const config = makeConfig();

    const tired = await runSessionTurn({
      input: "I'm tired today.",
      config,
      playbackState: {},
      provider: new FakeProvider(),
      llm: unavailableLlm()
    });
    expect(tired.intent.type).toBe("conversation");
    expect(tired.response).toContain("That sounds heavy");
    expect(tired.station).toBeUndefined();

    const softer = await runSessionTurn({
      input: "Something softer maybe?",
      config,
      playbackState: {},
      provider: new FakeProvider(),
      llm: unavailableLlm()
    });
    expect(softer.intent.type).toBe("conversation");
    expect(softer.response).toContain("Do you want me to shape a station");
    expect(softer.station).toBeUndefined();

    const unsupported = await runSessionTurn({
      input: "Crossfade this into Spotify.",
      config,
      playbackState: {},
      provider: new FakeProvider(),
      llm: unavailableLlm()
    });
    expect(unsupported.intent.type).toBe("conversation");
    expect(unsupported.response).toContain("can't hand this off");
    expect(unsupported.station).toBeUndefined();

    const noTrackKnowledge = await runSessionTurn({
      input: "Tell me about this song.",
      config,
      playbackState: {},
      provider: new FakeProvider(),
      llm: unavailableLlm()
    });
    expect(noTrackKnowledge.intent.type).toBe("conversation");
    expect(noTrackKnowledge.response).toContain("current track");
    expect(noTrackKnowledge.response).not.toContain("I can play a specific song");
  });

  it("aborts an in-flight turn when the signal is cancelled", async () => {
    const config = makeConfig();
    const controller = new AbortController();
    const llm: LlmClient = {
      generateJson: async (_prompt, _schema, options) => new Promise((resolve, reject) => {
        options?.signal?.addEventListener("abort", () => {
          const error = new Error("The operation was aborted.");
          error.name = "AbortError";
          reject(error);
        }, { once: true });
      }),
      generateText: async () => ({ ok: true, value: "unused" })
    };

    const turn = runSessionTurn({
      input: "Talk to me about the room",
      signal: controller.signal,
      config,
      playbackState: {},
      provider: new FakeProvider(),
      llm
    });
    controller.abort();

    await expect(turn).rejects.toMatchObject({ name: "AbortError" });
  });

  it("answers identity and capability questions without treating them as taste", async () => {
    const config = makeConfig();
    config.dj.displayName = "Mina";

    const result = await runSessionTurn({
      input: "Tell me what you can do, who are you.",
      config,
      provider: new FakeProvider(),
      llm: unavailableLlm()
    });

    expect(result.intent.type).toBe("identity_capability");
    expect(result.response).toContain("Mina");
    expect(result.response).toContain("play");
    expect(result.response).not.toContain("listening taste");
    expect(result.response).not.toContain("What are we tuning for?");
  });

  it("recommends music for mood questions without starting playback", async () => {
    const config = makeConfig();
    const playedUrls: string[] = [];
    const prompts: string[] = [];

    const result = await runSessionTurn({
      input: "I'm a little grumpy, what music should I listen to?",
      config,
      provider: new FakeProvider(),
      llm: conversationalLlm("Try low-lit instrumental music with warm bass and no bright vocals. Want me to build that station?", prompts),
      buildContext: async () => ({ personality: config.personality }),
      playUrl: async (url) => {
        playedUrls.push(url);
        return { ok: true, target: url, exitCode: 0, signal: null };
      }
    });

    expect(result.intent.type).toBe("music_recommendation");
    expect(result.station).toBeUndefined();
    expect(playedUrls).toEqual([]);
    expect(result.response).toContain("Want me to build");
    expect(result.response).toContain('type "dj"');
    expect(prompts[0]).toContain("Recommend one clear listening direction");
  });

  it("keeps recommendation replies in English by default", async () => {
    const config = makeConfig();

    const result = await runSessionTurn({
      input: "我有点累，应该听什么？",
      config,
      playbackState: {},
      provider: new FakeProvider(),
      llm: conversationalLlm("你可以听一点轻柔的钢琴和环境音乐。要我播放吗？"),
      buildContext: async () => ({ personality: config.personality })
    });

    expect(result.intent.type).toBe("music_recommendation");
    expect(result.response).toContain("I can still help with the music");
    expect(result.response).not.toContain("你可以听");
  });

  it("replies first and stores a pending station for implicit relaxation requests", async () => {
    const config = makeConfig();
    const playbackState: InteractivePlaybackState = {};
    const started: string[] = [];
    const prompts: string[] = [];

    const result = await runSessionTurn({
      input: "I'm exhausted now, want some relaxation.",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: conversationalLlm("Mina is here. I hear the exhaustion. I would build a soft relaxation station with ambient piano and warm instrumental tracks. Want me to play that station?", prompts),
      buildContext: async () => ({
        personality: config.personality,
        weather: {
          location: "Guangzhou",
          matchedLocation: "Guangzhou, China",
          temperatureC: 31,
          relativeHumidity: 95,
          precipitation: 0,
          weatherCode: 0,
          windSpeed: 8,
          summary: "Guangzhou, 95% humidity",
          listeningHint: "High humidity suggests slower, airier selections."
        }
      }),
      startUrlPlayback: async (url) => {
        started.push(url);
        return {
          target: url,
          done: new Promise(() => undefined),
          stop: () => undefined
        };
      }
    });

    expect(result.intent.type).toBe("music_recommendation");
    expect(result.station).toBeUndefined();
    expect(started).toEqual([]);
    expect(playbackState.pendingStationRequest).toBe("I'm exhausted now, want some relaxation.");
    expect(result.response).toContain("Want me to play");
    expect(result.response).toContain("Press Enter to play it");
    expect(prompts[0]).toContain("Weather summary: Guangzhou, 95% humidity");
  });

  it("replies first for open-ended want-something station requests so DJ mode is available before playback", async () => {
    const config = makeConfig();
    const playbackState: InteractivePlaybackState = {};
    const started: string[] = [];
    const prompts: string[] = [];

    const result = await runSessionTurn({
      input: "Want some soft jazz to start a rainy morning.",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: conversationalLlm("Mina is here. I’d start with soft piano jazz for a rainy morning. Want me to play that station?", prompts),
      buildContext: async () => ({ personality: config.personality }),
      startUrlPlayback: async (url) => {
        started.push(url);
        return {
          target: url,
          done: new Promise(() => undefined),
          stop: () => undefined
        };
      }
    });

    expect(result.intent.type).toBe("music_recommendation");
    expect(result.station).toBeUndefined();
    expect(started).toEqual([]);
    expect(playbackState.pendingStationRequest).toBe("Want some soft jazz to start a rainy morning.");
    expect(result.response).toContain('type "dj"');
  });

  it("does not enable DJ mode in the middle of a playing station", async () => {
    const config = makeConfig();
    const playbackState: InteractivePlaybackState = {};
    const started: string[] = [];

    await runSessionTurn({
      input: "play something for deep work",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: fakeLlm(),
      buildContext: async () => ({ personality: config.personality }),
      startUrlPlayback: async (url) => {
        started.push(url);
        return {
          target: url,
          done: new Promise(() => undefined),
          stop: () => undefined
        };
      }
    });

    const result = await runSessionTurn({
      input: "dj mode",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: fakeLlm(),
      startUrlPlayback: async (url) => {
        started.push(url);
        return {
          target: url,
          done: new Promise(() => undefined),
          stop: () => undefined
        };
      }
    });

    expect(result.intent.type).toBe("conversation");
    expect(result.response).toContain("DJ mode is a before-playback choice");
    expect(started).toHaveLength(1);
    expect(playbackState.currentIndex).toBe(0);
  });

  it("plays the pending station after confirmation", async () => {
    const config = makeConfig();
    const playbackState: InteractivePlaybackState = {};
    const started: string[] = [];

    await runSessionTurn({
      input: "I'm exhausted now, want some relaxation.",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: conversationalLlm("I would keep this soft. Want me to play that station?"),
      buildContext: async () => ({ personality: config.personality }),
      startUrlPlayback: async (url) => {
        started.push(url);
        return {
          target: url,
          done: new Promise(() => undefined),
          stop: () => undefined
        };
      }
    });

    const result = await runSessionTurn({
      input: "yes, play it",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: fakeLlm(),
      buildContext: async () => ({ personality: config.personality }),
      startUrlPlayback: async (url) => {
        started.push(url);
        return {
          target: url,
          done: new Promise(() => undefined),
          stop: () => undefined
        };
      }
    });

    expect(result.intent.type).toBe("pending_station_confirmation");
    expect(result.station?.request).toBe("I'm exhausted now, want some relaxation.");
    expect(started).toHaveLength(1);
    expect(playbackState.pendingStationRequest).toBeUndefined();
    expect(result.response).toContain("Queue:");
    expect(result.response).toContain("Now playing:");
  });

  it("treats Enter as confirmation only when a station is pending", async () => {
    const config = makeConfig();
    const playbackState: InteractivePlaybackState = {};
    const started: string[] = [];

    await runSessionTurn({
      input: "I'm exhausted now, want some relaxation.",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: conversationalLlm("I would keep this soft. Want me to play that station?"),
      buildContext: async () => ({ personality: config.personality })
    });

    const result = await runSessionTurn({
      input: "",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: fakeLlm(),
      buildContext: async () => ({ personality: config.personality }),
      startUrlPlayback: async (url) => {
        started.push(url);
        return {
          target: url,
          done: new Promise(() => undefined),
          stop: () => undefined
        };
      }
    });

    expect(result.intent.type).toBe("pending_station_confirmation");
    expect(result.station?.request).toBe("I'm exhausted now, want some relaxation.");
    expect(started).toHaveLength(1);
    expect(playbackState.pendingStationRequest).toBeUndefined();
  });

  it("does not treat Enter as playback consent when nothing is pending", async () => {
    const config = makeConfig();
    const playbackState: InteractivePlaybackState = {};
    const started: string[] = [];
    const statuses: string[] = [];

    const result = await runSessionTurn({
      input: "",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: {
        generateJson: async () => ({ ok: true, value: { type: "playback_request", confidence: "high" } }),
        generateText: async () => ({ ok: true, value: "unused" })
      },
      writeStatus: (text) => {
        statuses.push(text);
        return () => undefined;
      },
      startUrlPlayback: async (url) => {
        started.push(url);
        return {
          target: url,
          done: new Promise(() => undefined),
          stop: () => undefined
        };
      }
    });

    expect(result.intent.type).toBe("conversation");
    expect(result.station).toBeUndefined();
    expect(result.response).toContain("Tell me what you want to hear");
    expect(started).toEqual([]);
    expect(statuses).toEqual([]);
  });

  it("reshapes a pending station before playback", async () => {
    const config = makeConfig();
    const playbackState: InteractivePlaybackState = {};
    const started: string[] = [];

    await runSessionTurn({
      input: "I'm exhausted now, want some relaxation.",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: conversationalLlm("I would keep this soft. Want me to play that station?"),
      buildContext: async () => ({ personality: config.personality })
    });

    const refinement = await runSessionTurn({
      input: "make it softer and less piano",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: conversationalLlm("Got it. I’ll make it softer and less piano-driven.\n\nPlay this version?"),
      startUrlPlayback: async (url) => {
        started.push(url);
        return {
          target: url,
          done: new Promise(() => undefined),
          stop: () => undefined
        };
      }
    });

    expect(refinement.intent.type).toBe("pending_station_refinement");
    expect(refinement.station).toBeUndefined();
    expect(started).toEqual([]);
    expect(playbackState.pendingStationRequest).toContain("I'm exhausted now, want some relaxation.");
    expect(playbackState.pendingStationRequest).toContain("Refinement: make it softer and less piano");
    expect(refinement.response).toContain("Play this version?");
    expect(refinement.response).toContain('type "dj"');

    const result = await runSessionTurn({
      input: "yes",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: fakeLlm(),
      buildContext: async () => ({ personality: config.personality }),
      startUrlPlayback: async (url) => {
        started.push(url);
        return {
          target: url,
          done: new Promise(() => undefined),
          stop: () => undefined
        };
      }
    });

    expect(result.station?.request).toContain("Refinement: make it softer and less piano");
    expect(started).toHaveLength(1);
  });

  it("answers pending station questions without clearing the pending station", async () => {
    const config = makeConfig();
    const playbackState: InteractivePlaybackState = {};

    await runSessionTurn({
      input: "I'm exhausted now, want some relaxation.",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: conversationalLlm("I would keep this soft. Want me to play that station?"),
      buildContext: async () => ({ personality: config.personality })
    });

    const result = await runSessionTurn({
      input: "what kind of tracks would it include?",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: conversationalLlm("Mostly warm ambient, slow instrumental pieces, and soft downtempo.\n\nPlay this version?")
    });

    expect(result.intent.type).toBe("pending_station_refinement");
    expect(result.station).toBeUndefined();
    expect(result.response).toContain("Play this version?");
    expect(playbackState.pendingStationRequest).toBe("I'm exhausted now, want some relaxation.");
  });

  it("clears pending station when the user declines", async () => {
    const config = makeConfig();
    const playbackState: InteractivePlaybackState = {};

    await runSessionTurn({
      input: "I'm exhausted now, want some relaxation.",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: conversationalLlm("I would keep this soft. Want me to play that station?"),
      buildContext: async () => ({ personality: config.personality })
    });

    const result = await runSessionTurn({
      input: "not now",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: fakeLlm()
    });

    expect(result.intent.type).toBe("pending_station_decline");
    expect(result.station).toBeUndefined();
    expect(playbackState.pendingStationRequest).toBeUndefined();
  });

  it("lets explicit playback replace a pending station", async () => {
    const config = makeConfig();
    const playbackState: InteractivePlaybackState = {};
    const started: string[] = [];

    await runSessionTurn({
      input: "I'm exhausted now, want some relaxation.",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: conversationalLlm("I would keep this soft. Want me to play that station?"),
      buildContext: async () => ({ personality: config.personality })
    });

    const result = await runSessionTurn({
      input: "actually play jazz for work",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: fakeLlm(),
      buildContext: async () => ({ personality: config.personality }),
      startUrlPlayback: async (url) => {
        started.push(url);
        return {
          target: url,
          done: new Promise(() => undefined),
          stop: () => undefined
        };
      }
    });

    expect(result.intent.type).toBe("playback_request");
    expect(result.station?.request).toBe("actually play jazz for work");
    expect(started).toHaveLength(1);
    expect(playbackState.pendingStationRequest).toBeUndefined();
  });

  it("stops existing playback before starting a replacement station", async () => {
    const config = makeConfig();
    const playbackState: InteractivePlaybackState = {};
    const started: string[] = [];
    let stopCalls = 0;

    await runSessionTurn({
      input: "play something for deep work",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: fakeLlm(),
      buildContext: async () => ({ personality: config.personality }),
      startUrlPlayback: async (url) => {
        started.push(url);
        return {
          target: url,
          done: new Promise(() => undefined),
          stop: () => {
            stopCalls += 1;
          }
        };
      }
    });

    const previousTrackId = playbackState.currentTrackId;
    const result = await runSessionTurn({
      input: "play relaxing jazz for dinner",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: fakeLlm(),
      buildContext: async () => ({ personality: config.personality }),
      startUrlPlayback: async (url) => {
        started.push(url);
        return {
          target: url,
          done: new Promise(() => undefined),
          stop: () => {
            stopCalls += 1;
          }
        };
      }
    });

    expect(result.intent.type).toBe("playback_request");
    expect(started).toHaveLength(2);
    expect(stopCalls).toBe(1);
    expect(playbackState.currentTrackId).not.toBe(previousTrackId);
  });

  it("prepares a pending station as a spoken DJ program before playback", async () => {
    const config = makeConfig();
    const playbackState: InteractivePlaybackState = {};
    const started: string[] = [];

    await runSessionTurn({
      input: "I'm exhausted now, want some relaxation.",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: conversationalLlm("I would keep this soft. Want me to play that station?"),
      buildContext: async () => ({ personality: config.personality })
    });

    const result = await runSessionTurn({
      input: "dj",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: conversationalLlm("Pockedio here. I’ll open this softly, then let the first track carry the room."),
      buildContext: async () => ({ personality: config.personality }),
      synthesizeFishAudio: async (_config, text) => ({
        ok: true,
        audioPath: `/tmp/${text.length}.wav`,
        latencyMs: 15
      }),
      startDuckedIntroPlayback: async (url) => {
        started.push(url);
        return {
          target: url,
          introResult: { ok: true, target: `/tmp/${"Pockedio here. I’ll open this softly, then let the first track carry the room.".length}.wav`, exitCode: 0, signal: null },
          done: new Promise(() => undefined),
          stop: () => undefined
        };
      }
    });

    expect(result.intent.type).toBe("pending_station_dj_program");
    expect(result.response).toBe("DJ program is ready.\n\nPress Enter to start it, or tell me how to adjust it.");
    expect(result.response).not.toContain("Pockedio here.");
    expect(result.response).not.toContain("Now playing:");
    expect(started).toHaveLength(0);
    expect(playbackState.pendingStationRequest).toBeUndefined();
    expect(playbackState.pendingDjProgram).toBeDefined();
  });

  it("starts a prepared pending DJ program with ducked music under the spoken intro", async () => {
    const config = makeConfig();
    const playbackState: InteractivePlaybackState = {};
    const duckedStarts: Array<{ url: string; introFilePath: string }> = [];
    const directStarts: string[] = [];
    const playedFiles: string[] = [];

    await runSessionTurn({
      input: "I'm exhausted now, want some relaxation.",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: conversationalLlm("I would keep this soft. Want me to play that station?"),
      buildContext: async () => ({ personality: config.personality })
    });

    const prepared = await runSessionTurn({
      input: "dj",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: conversationalLlm("Pockedio here. I’ll open this softly, then let the first track carry the room."),
      buildContext: async () => ({ personality: config.personality }),
      synthesizeFishAudio: async () => ({
        ok: true,
        audioPath: "/tmp/pockedio-dj-intro.wav",
        latencyMs: 15
      }),
      playFile: async (filePath) => {
        playedFiles.push(filePath);
        return { ok: true, target: filePath, exitCode: 0, signal: null };
      },
      startUrlPlayback: async (url) => {
        directStarts.push(url);
        return {
          target: url,
          done: new Promise(() => undefined),
          stop: () => undefined
        };
      },
      startDuckedIntroPlayback: async (url, introFilePath) => {
        duckedStarts.push({ url, introFilePath });
        return {
          target: url,
          introResult: { ok: true, target: introFilePath, exitCode: 0, signal: null },
          done: new Promise(() => undefined),
          stop: () => undefined
        };
      }
    });

    expect(prepared.response).toContain("DJ program is ready.");
    expect(duckedStarts).toEqual([]);

    const started = await runSessionTurn({
      input: "",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: fakeLlm(),
      startUrlPlayback: async (url) => {
        directStarts.push(url);
        return {
          target: url,
          done: new Promise(() => undefined),
          stop: () => undefined
        };
      },
      startDuckedIntroPlayback: async (url, introFilePath) => {
        duckedStarts.push({ url, introFilePath });
        return {
          target: url,
          introResult: { ok: true, target: introFilePath, exitCode: 0, signal: null },
          done: new Promise(() => undefined),
          stop: () => undefined
        };
      }
    });

    expect(started.intent.type).toBe("pending_station_confirmation");
    expect(started.response).toContain("Pockedio:");
    expect(started.response).toContain("Now playing:");
    expect(duckedStarts).toEqual([{ url: expect.stringContaining("https://example.com/"), introFilePath: "/tmp/pockedio-dj-intro.wav" }]);
    expect(directStarts).toEqual([]);
    expect(playedFiles).toEqual([]);

    const rows = withDatabase(config, (db) => db.prepare("SELECT status, audio_path as audioPath FROM dj_audio ORDER BY created_at DESC LIMIT 1").all());
    expect(rows).toEqual([{ status: "played", audioPath: "/tmp/pockedio-dj-intro.wav" }]);
  });

  it("stops current playback before preparing a pending DJ program", async () => {
    const config = makeConfig();
    const events: string[] = [];
    const playbackState: InteractivePlaybackState = {
      pendingStationRequest: "something calm for late night",
      pendingStationOriginalRequest: "something calm for late night",
      activePlayback: {
        target: "https://example.com/current.mp3",
        done: new Promise(() => undefined),
        stop: () => {
          events.push("stop-current");
        }
      },
      currentTrackId: "track-current"
    };

    const result = await runSessionTurn({
      input: "dj",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: conversationalLlm("Mina here. I’ll bring this in gently."),
      buildContext: async () => {
        events.push("read-context");
        return { personality: config.personality };
      },
      synthesizeFishAudio: async () => {
        events.push("synthesize-intro");
        return {
          ok: true,
          audioPath: "/tmp/pockedio-dj-intro.wav",
          latencyMs: 15
        };
      },
      startDuckedIntroPlayback: async (url, introFilePath) => {
        events.push(`start-ducked:${url}:${introFilePath}`);
        return {
          target: url,
          introResult: { ok: true, target: introFilePath, exitCode: 0, signal: null },
          done: new Promise(() => undefined),
          stop: () => undefined
        };
      }
    });

    expect(result.intent.type).toBe("pending_station_dj_program");
    expect(events[0]).toBe("stop-current");
    expect(events).toContain("read-context");
    expect(events).toContain("synthesize-intro");
    expect(events.some((event) => event.startsWith("start-ducked:"))).toBe(false);
    expect(events.indexOf("stop-current")).toBeLessThan(events.indexOf("read-context"));
    expect(playbackState.pendingDjProgram).toBeDefined();
  });

  it("prepares an explicit DJ program and waits for the user to start it", async () => {
    const config = makeConfig();
    config.dj.displayName = "Mina";
    const events: string[] = [];
    const playbackState: InteractivePlaybackState = {
      activePlayback: {
        target: "https://example.com/current.mp3",
        done: new Promise(() => undefined),
        stop: () => {
          events.push("stop-current");
        }
      },
      currentTrackId: "track-current"
    };
    const llm: LlmClient = {
      generateJson: async () => ({ ok: true, value: { type: "playback_request", confidence: "high" } }),
      generateText: async () => ({ ok: true, value: "Mina here. I’ll turn this into a short radio-style opening." })
    };

    const result = await runSessionTurn({
      input: "play a DJ program for late night focus",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm,
      buildContext: async () => {
        events.push("read-context");
        return { personality: config.personality };
      },
      synthesizeFishAudio: async () => ({
        ok: true,
        audioPath: "/tmp/pockedio-explicit-dj.wav",
        latencyMs: 15
      }),
      startDuckedIntroPlayback: async (_url, introFilePath) => {
        events.push(`start-ducked:${introFilePath}`);
        return {
          target: "unused",
          introResult: { ok: true, target: introFilePath, exitCode: 0, signal: null },
          done: new Promise(() => undefined),
          stop: () => undefined
        };
      }
    });

    expect(result.intent.type).toBe("playback_request");
    expect(events[0]).toBe("stop-current");
    expect(result.response).toBe("DJ program is ready.\n\nPress Enter to start it, or tell me how to adjust it.");
    expect(result.response).not.toContain("Press Enter to play it");
    expect(result.response).not.toContain('type "dj"');
    expect(events.some((event) => event.startsWith("start-ducked:"))).toBe(false);
    expect(playbackState.pendingDjProgram).toBeDefined();
    expect(playbackState.djProgram).toBeUndefined();
  });

  it("keeps the default ducked intro player on interactive playback state", async () => {
    const config = makeConfig();
    const playbackState: InteractivePlaybackState = {};

    await runSessionTurn({
      input: "",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: unavailableLlm()
    });

    expect(playbackState.startDuckedIntroPlayback).toEqual(expect.any(Function));
  });

  it("keeps the first DJ program transition quiet for pacing", async () => {
    const config = makeConfig();
    const playbackState: InteractivePlaybackState = {};
    const synthesized: string[] = [];

    await runSessionTurn({
      input: "I'm exhausted now, want some relaxation.",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: conversationalLlm("I would keep this soft. Want me to play that station?"),
      buildContext: async () => ({ personality: config.personality })
    });

    await runSessionTurn({
      input: "dj",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: conversationalLlm("Mina keeps this short and warm."),
      buildContext: async () => ({ personality: config.personality }),
      synthesizeFishAudio: async (_config, text) => {
        synthesized.push(text);
        return {
          ok: true,
          audioPath: `/tmp/intro-${synthesized.length}.wav`,
          latencyMs: 15
        };
      },
      startDuckedIntroPlayback: async (url, introFilePath) => ({
        target: url,
        introResult: { ok: true, target: introFilePath, exitCode: 0, signal: null },
        done: new Promise(() => undefined),
        stop: () => undefined
      })
    });

    await runSessionTurn({
      input: "",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: fakeLlm(),
      startDuckedIntroPlayback: async (url, introFilePath) => ({
        target: url,
        introResult: { ok: true, target: introFilePath, exitCode: 0, signal: null },
        done: new Promise(() => undefined),
        stop: () => undefined
      })
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(synthesized).toHaveLength(1);
    expect(playbackState.djProgram?.quietTrackIndexes.has(1)).toBe(true);
  });

  it("uses a prepared DJ intro at the first standard middle transition", async () => {
    const config = makeConfig();
    config.dj.displayName = "Mina";
    const playbackState: InteractivePlaybackState = {};
    const output: string[] = [];
    const duckedStarts: Array<{ url: string; introFilePath: string }> = [];
    const directStarts: string[] = [];
    const finishers: Array<(result: { ok: boolean; target: string; exitCode: number | null; signal: NodeJS.Signals | null }) => void> = [];
    const directFinishers: Array<(result: { ok: boolean; target: string; exitCode: number | null; signal: NodeJS.Signals | null }) => void> = [];

    await runSessionTurn({
      input: "I'm exhausted now, want some relaxation.",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: conversationalLlm("I would keep this soft. Want me to play that station?"),
      buildContext: async () => ({ personality: config.personality })
    });

    await runSessionTurn({
      input: "dj",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: {
        generateJson: async () => ({ ok: false, errorCode: "llm_unavailable", error: "unused" }),
        generateText: async (prompt) => ({
          ok: true,
          value: prompt.includes("Track 3") ? "Track 3 intro is ready." : "Mina keeps this short and warm."
        })
      },
      buildContext: async () => ({ personality: config.personality }),
      writeOutput: (text) => output.push(text),
      synthesizeFishAudio: async (_config, text) => ({
        ok: true,
        audioPath: text.includes("Track 3") ? "/tmp/track-3-intro.wav" : "/tmp/opening-intro.wav",
        latencyMs: 15
      }),
      startUrlPlayback: async (url) => {
        directStarts.push(url);
        return {
          target: url,
          done: new Promise((resolve) => {
            directFinishers.push(resolve);
          }),
          stop: () => undefined
        };
      },
      startDuckedIntroPlayback: async (url, introFilePath) => {
        duckedStarts.push({ url, introFilePath });
        return {
          target: url,
          introResult: { ok: true, target: introFilePath, exitCode: 0, signal: null },
          done: new Promise((resolve) => {
            finishers.push(resolve);
          }),
          stop: () => undefined
        };
      }
    });

    await runSessionTurn({
      input: "",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: fakeLlm(),
      startUrlPlayback: async (url) => {
        directStarts.push(url);
        return {
          target: url,
          done: new Promise((resolve) => {
            directFinishers.push(resolve);
          }),
          stop: () => undefined
        };
      },
      startDuckedIntroPlayback: async (url, introFilePath) => {
        duckedStarts.push({ url, introFilePath });
        return {
          target: url,
          introResult: { ok: true, target: introFilePath, exitCode: 0, signal: null },
          done: new Promise((resolve) => {
            finishers.push(resolve);
          }),
          stop: () => undefined
        };
      }
    });

    await Promise.resolve();
    await Promise.resolve();
    finishers[0]?.({ ok: true, target: duckedStarts[0].url, exitCode: 0, signal: null });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await Promise.resolve();
    await Promise.resolve();
    directFinishers[0]?.({ ok: true, target: directStarts[0], exitCode: 0, signal: null });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(duckedStarts).toHaveLength(2);
    expect(duckedStarts[1]).toEqual({
      url: expect.stringContaining("https://example.com/"),
      introFilePath: "/tmp/track-3-intro.wav"
    });
    expect(directStarts).toHaveLength(1);
    expect(output.join("\n")).toContain("Mina:");
    expect(output.join("\n")).toContain("Track 3 intro is ready.");
    expect(output.join("\n")).toContain("Track 3 intro is ready.\n\nNow playing:");
  });

  it("keeps manual next moving with feedback when DJ intro is not ready", async () => {
    const config = makeConfig();
    config.dj.displayName = "Mina";
    const playbackState: InteractivePlaybackState = {};
    const duckedStarts: Array<{ url: string; introFilePath: string }> = [];
    const directStarts: string[] = [];
    let resolveTrackThreeIntro: ((result: FishAudioResult) => void) | undefined;

    await runSessionTurn({
      input: "I'm exhausted now, want some relaxation.",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: conversationalLlm("I would keep this soft. Want me to play that station?"),
      buildContext: async () => ({ personality: config.personality })
    });

    await runSessionTurn({
      input: "dj",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: {
        generateJson: async () => ({ ok: false, errorCode: "llm_unavailable", error: "unused" }),
        generateText: async (prompt) => ({
          ok: true,
          value: prompt.includes("Track 3") ? "Track 3 intro is still rendering." : "Mina opens this softly."
        })
      },
      buildContext: async () => ({ personality: config.personality }),
      synthesizeFishAudio: async (_config, text) => {
        if (text.includes("Track 3")) {
          return new Promise((resolve) => {
            resolveTrackThreeIntro = resolve;
          });
        }
        return {
          ok: true,
          audioPath: "/tmp/opening-intro.wav",
          latencyMs: 15
        };
      },
      startUrlPlayback: async (url) => {
        directStarts.push(url);
        return {
          target: url,
          done: new Promise(() => undefined),
          stop: () => undefined
        };
      },
      startDuckedIntroPlayback: async (url, introFilePath) => {
        duckedStarts.push({ url, introFilePath });
        return {
          target: url,
          introResult: { ok: true, target: introFilePath, exitCode: 0, signal: null },
          done: new Promise(() => undefined),
          stop: () => undefined
        };
      }
    });

    await runSessionTurn({
      input: "",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: fakeLlm(),
      startUrlPlayback: async (url) => {
        directStarts.push(url);
        return {
          target: url,
          done: new Promise(() => undefined),
          stop: () => undefined
        };
      },
      startDuckedIntroPlayback: async (url, introFilePath) => {
        duckedStarts.push({ url, introFilePath });
        return {
          target: url,
          introResult: { ok: true, target: introFilePath, exitCode: 0, signal: null },
          done: new Promise(() => undefined),
          stop: () => undefined
        };
      }
    });

    const quietResult = await runSessionTurn({
      input: "next",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: fakeLlm()
    });

    expect(quietResult.response).not.toContain("still preparing");
    expect(quietResult.response).toContain("Now playing: 2/5");

    const result = await runSessionTurn({
      input: "next",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: fakeLlm()
    });

    expect(result.response).toContain("Mina is still preparing the next voice break");
    expect(result.response).toContain("Now playing: 3/5");
    expect(duckedStarts).toHaveLength(1);
    expect(directStarts).toHaveLength(2);

    resolveTrackThreeIntro?.({
      ok: true,
      audioPath: "/tmp/track-3-intro.wav",
      latencyMs: 15
    });
  });

  it("cancels in-flight DJ transition preparation on session exit", async () => {
    const config = makeConfig();
    config.dj.displayName = "Mina";
    const playbackState: InteractivePlaybackState = {};
    let transitionSignal: AbortSignal | undefined;
    let transitionCancelled = false;

    await runSessionTurn({
      input: "I'm exhausted now, want some relaxation.",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: conversationalLlm("I would keep this soft. Want me to play that station?"),
      buildContext: async () => ({ personality: config.personality })
    });

    await runSessionTurn({
      input: "dj",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: {
        generateJson: async () => ({ ok: false, errorCode: "llm_unavailable", error: "unused" }),
        generateText: async (prompt) => ({
          ok: true,
          value: prompt.includes("Track 3") ? "Track 3 intro is still rendering." : "Mina opens this softly."
        })
      },
      buildContext: async () => ({ personality: config.personality }),
      synthesizeFishAudio: async (_config, text, options) => {
        if (text.includes("Track 3")) {
          transitionSignal = options?.signal;
          return new Promise((resolve) => {
            options?.signal?.addEventListener("abort", () => {
              transitionCancelled = true;
              resolve({ ok: false, latencyMs: 15, error: "cancelled" });
            }, { once: true });
          });
        }
        return {
          ok: true,
          audioPath: "/tmp/opening-intro.wav",
          latencyMs: 15
        };
      },
      startDuckedIntroPlayback: async (url, introFilePath) => ({
        target: url,
        introResult: { ok: true, target: introFilePath, exitCode: 0, signal: null },
        done: new Promise(() => undefined),
        stop: () => undefined
      })
    });

    await runSessionTurn({
      input: "",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: fakeLlm(),
      startDuckedIntroPlayback: async (url, introFilePath) => ({
        target: url,
        introResult: { ok: true, target: introFilePath, exitCode: 0, signal: null },
        done: new Promise(() => undefined),
        stop: () => undefined
      })
    });

    await runSessionTurn({
      input: "next",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: fakeLlm()
    });

    await runSessionTurn({
      input: "exit",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: fakeLlm()
    });

    expect(transitionSignal?.aborted).toBe(true);
    expect(transitionCancelled).toBe(true);
  });

  it("plays a short DJ outro when a DJ program station finishes", async () => {
    const config = makeConfig();
    config.dj.displayName = "Mina";
    const playbackState: InteractivePlaybackState = {};
    const output: string[] = [];
    const playedFiles: string[] = [];
    const finishers: Array<(result: { ok: boolean; target: string; exitCode: number | null; signal: NodeJS.Signals | null }) => void> = [];

    await runSessionTurn({
      input: "I'm exhausted now, want some relaxation.",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: conversationalLlm("I would keep this soft. Want me to play that station?"),
      buildContext: async () => ({ personality: config.personality })
    });

    await runSessionTurn({
      input: "dj",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: {
        generateJson: async () => ({ ok: false, errorCode: "llm_unavailable", error: "unused" }),
        generateText: async (prompt) => ({
          ok: true,
          value: prompt.includes("completed DJ program")
            ? "Mina here. That set has landed softly. Press Enter and I can keep the room in this glow, or point me somewhere new."
            : prompt.includes("Track 3")
              ? "Track 3 intro is ready."
              : "Mina opens this softly."
        })
      },
      buildContext: async () => ({ personality: config.personality }),
      writeOutput: (text) => output.push(text),
      synthesizeFishAudio: async (_config, text) => ({
        ok: true,
        audioPath: text.includes("landed softly") ? "/tmp/outro.wav" : `/tmp/${text.length}.wav`,
        latencyMs: 15
      }),
      playFile: async (filePath) => {
        playedFiles.push(filePath);
        return { ok: true, target: filePath, exitCode: 0, signal: null };
      },
      startUrlPlayback: async (url) => ({
        target: url,
        done: new Promise((resolve) => {
          finishers.push(resolve);
        }),
        stop: () => undefined
      }),
      startDuckedIntroPlayback: async (url, introFilePath) => ({
        target: url,
        introResult: { ok: true, target: introFilePath, exitCode: 0, signal: null },
        done: new Promise((resolve) => {
          finishers.push(resolve);
        }),
        stop: () => undefined
      })
    });

    await runSessionTurn({
      input: "",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: fakeLlm(),
      startUrlPlayback: async (url) => ({
        target: url,
        done: new Promise((resolve) => {
          finishers.push(resolve);
        }),
        stop: () => undefined
      }),
      startDuckedIntroPlayback: async (url, introFilePath) => ({
        target: url,
        introResult: { ok: true, target: introFilePath, exitCode: 0, signal: null },
        done: new Promise((resolve) => {
          finishers.push(resolve);
        }),
        stop: () => undefined
      })
    });

    for (let index = 0; index < 5; index += 1) {
      finishers[index]?.({ ok: true, target: `track-${index + 1}`, exitCode: 0, signal: null });
      await new Promise((resolve) => setTimeout(resolve, 0));
      await Promise.resolve();
      await Promise.resolve();
    }

    expect(playedFiles).toContain("/tmp/outro.wav");
    expect(output.at(-1)).toContain("Mina:");
    expect(output.at(-1)).toContain("That set has landed softly");
    expect(output.at(-1)).toContain("That station’s done. Press Enter to continue this vibe");
  });

  it("keeps explicit mood playback requests as playback", async () => {
    const config = makeConfig();
    const playedUrls: string[] = [];

    const result = await runSessionTurn({
      input: "play something for my grumpy mood",
      config,
      provider: new FakeProvider(),
      llm: fakeLlm(),
      buildContext: async () => ({ personality: config.personality }),
      playUrl: async (url) => {
        playedUrls.push(url);
        return { ok: true, target: url, exitCode: 0, signal: null };
      }
    });

    expect(result.intent.type).toBe("playback_request");
    expect(result.station?.tracks).toHaveLength(5);
    expect(playedUrls).toHaveLength(1);
  });

  it("starts explicit station playback from the 3.8 examples", async () => {
    const config = makeConfig();
    const playbackState: InteractivePlaybackState = {};
    const started: string[] = [];
    const output: string[] = [];

    const result = await runSessionTurn({
      input: "put on something for a rainy commute",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: fakeLlm(),
      buildContext: async () => ({ personality: config.personality }),
      writeOutput: (text) => output.push(text),
      startUrlPlayback: async (url) => {
        started.push(url);
        return {
          target: url,
          done: new Promise(() => undefined),
          stop: () => undefined
        };
      }
    });

    expect(result.intent.type).toBe("playback_request");
    expect(result.station?.request).toBe("put on something for a rainy commute");
    expect(result.station?.tracks).toHaveLength(5);
    expect(started).toHaveLength(1);
    expect(output.join("\n")).toContain("Now playing: 1/5");
    expect(playbackState.pendingStationRequest).toBeUndefined();
  });

  it("starts artist-only stations without unrelated artists or duplicate songs", async () => {
    const config = makeConfig();
    const provider = new ArtistStationProvider();
    const playbackState: InteractivePlaybackState = {};
    const started: string[] = [];

    const result = await runSessionTurn({
      input: "play songs by Sufjan Stevens",
      config,
      playbackState,
      provider,
      llm: fakeLlm(),
      buildContext: async () => ({ personality: config.personality }),
      startUrlPlayback: async (url) => {
        started.push(url);
        return {
          target: url,
          done: new Promise(() => undefined),
          stop: () => undefined
        };
      }
    });

    expect(result.intent.type).toBe("playback_request");
    expect(provider.searches.map((query) => query.keyword)).toEqual(["Sufjan Stevens"]);
    expect(result.station?.tracks.map((track) => `${track.title} - ${track.artist}`)).toEqual([
      "Chicago - Sufjan Stevens",
      "Should Have Known Better - Sufjan Stevens"
    ]);
    expect(started).toEqual(["https://example.com/chicago.mp3"]);
    expect(result.response).not.toContain("five-track station");
    expect(result.response).toContain("Now playing: 1/2  Chicago - Sufjan Stevens");
  });

  it("keeps Wang OK artist-only station results unique and artist-scoped", async () => {
    const config = makeConfig();
    const provider = new ArtistStationProvider();
    const playbackState: InteractivePlaybackState = {};
    const started: string[] = [];

    const result = await runSessionTurn({
      input: "play songs by Wang OK",
      config,
      playbackState,
      provider,
      llm: fakeLlm(),
      buildContext: async () => ({ personality: config.personality }),
      startUrlPlayback: async (url) => {
        started.push(url);
        return {
          target: url,
          done: new Promise(() => undefined),
          stop: () => undefined
        };
      }
    });

    expect(result.intent.type).toBe("playback_request");
    expect(provider.searches.map((query) => query.keyword)).toEqual(["Wang OK"]);
    expect(result.station?.tracks.map((track) => `${track.title} - ${track.artist}`)).toEqual([
      "Before spring ends - Wang OK, Duke Lee",
      "Another Wang OK Song - Wang OK"
    ]);
    expect(started).toEqual(["https://example.com/before-spring.mp3"]);
    expect(result.response).toContain("Now playing: 1/2  Before spring ends - Wang OK, Duke Lee");
    expect(result.response).not.toContain("晚风");
    expect(result.response).not.toContain("追光者");
    expect(result.response).not.toContain("雨天");
  });

  it("does not generate standalone explicit DJ audio clips", async () => {
    const config = makeConfig();
    config.dj.displayName = "Mina";
    const playedFiles: string[] = [];
    let fishAudioCalls = 0;

    const result = await runSessionTurn({
      input: "make me a spoken DJ intro",
      config,
      provider: new FakeProvider(),
      llm: fakeLlm(),
      synthesizeFishAudio: async (_config, text) => {
        fishAudioCalls += 1;
        return {
          ok: true,
          audioPath: `/tmp/${text.length}.wav`,
          latencyMs: 12
        };
      },
      playFile: async (filePath) => {
        playedFiles.push(filePath);
        return { ok: true, target: filePath, exitCode: 0, signal: null };
      }
    });

    expect(result.djAudio).toBeUndefined();
    expect(result.response).toContain("DJ voice belongs to a station");
    expect(result.response).toContain("type \"dj\"");
    expect(fishAudioCalls).toBe(0);
    expect(playedFiles).toHaveLength(0);

    const rows = withDatabase(config, (db) => ({
      audio: db.prepare("SELECT text, audio_path as audioPath, status FROM dj_audio").all(),
      messages: db.prepare("SELECT role, content FROM messages ORDER BY created_at").all()
    }));
    expect(rows.audio).toEqual([]);
    expect(rows.messages).toContainEqual({
      role: "pockedio",
      content: result.response
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
