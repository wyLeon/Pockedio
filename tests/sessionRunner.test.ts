import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/load.js";
import { withDatabase } from "../src/db/database.js";
import { runMigrations } from "../src/db/migrations.js";
import type { LlmClient } from "../src/llm/llmClient.js";
import type { MusicProvider, MusicSearchQuery, MusicTrackCandidate, PlayableTrack } from "../src/providers/musicProvider.js";
import { createDefaultInteractiveStartUrlPlayback, formatInteractiveStartupGuide, runSessionTurn, type InteractivePlaybackState } from "../src/session/sessionRunner.js";
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
    expect(guide).toContain("after a station suggestion, type dj");
    expect(guide).toContain("setup");
    expect(guide).toContain("next");
    expect(guide).toContain("stop");
    expect(guide).toContain("what's playing?");
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
    expect(output.join("\n")).toContain("Queue:");
    expect(output.join("\n")).toContain("Now playing:");
    expect(output.join("\n")).toContain("Pockedio's note:");
    expect(output.join("\n")).toContain("I’m playing this because deterministic fallback");
    expect(output.join("\n")).toContain("[>...................] 00:00 elapsed");
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
    expect(result.response).toContain("Pockedio's note:");
    expect(stopCalls).toBe(1);
    expect(started).toHaveLength(2);
    expect(playbackState.currentIndex).toBe(1);
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

    const rows = withDatabase(config, (db) => db.prepare("SELECT role, content FROM messages ORDER BY created_at DESC LIMIT 2").all());
    expect(rows).toEqual([
      { role: "pockedio", content: result.response },
      { role: "user", content: "This kind of piano reminds me of winter evenings in university." }
    ]);
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
    expect(prompts[0]).toContain("Current track:");
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
        weather: { summary: "Guangzhou, 95% humidity" }
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

    const result = await runSessionTurn({
      input: "",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: unavailableLlm()
    });

    expect(result.intent.type).toBe("conversation");
    expect(result.station).toBeUndefined();
    expect(result.response).toContain("Tell me what you want to hear");
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

  it("lets pending station choose a spoken DJ program intro before playback", async () => {
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
          done: new Promise(() => undefined),
          stop: () => undefined
        };
      }
    });

    expect(result.intent.type).toBe("pending_station_dj_program");
    expect(result.response).toContain("DJ program intro:");
    expect(result.response).toContain("Pockedio here.");
    expect(result.response).toContain("Queue:");
    expect(result.response).toContain("Now playing:");
    expect(started).toHaveLength(1);
    expect(playbackState.pendingStationRequest).toBeUndefined();
  });

  it("starts a pending DJ program with ducked music under the spoken intro", async () => {
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

    await runSessionTurn({
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
          done: new Promise(() => undefined),
          stop: () => undefined
        };
      }
    });

    expect(duckedStarts).toEqual([{ url: expect.stringContaining("https://example.com/"), introFilePath: "/tmp/pockedio-dj-intro.wav" }]);
    expect(directStarts).toEqual([]);
    expect(playedFiles).toEqual([]);
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
