import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/load.js";
import { withDatabase } from "../src/db/database.js";
import { runMigrations } from "../src/db/migrations.js";
import type { LlmClient } from "../src/llm/llmClient.js";
import type { MusicProvider, MusicSearchQuery, MusicTrackCandidate, PlayableTrack } from "../src/providers/musicProvider.js";
import { clearInteractiveSubmittedInputEcho, createDefaultInteractiveStartUrlPlayback, createPromptSafeOutputWriter, createTurnScopedOutputWriter, formatInitialInteractiveTurnStatus, formatInteractiveLivePrompt, formatInteractiveLivePromptBox, formatInteractiveLivePromptRule, formatInteractiveStartupDisplayName, formatInteractiveStartupGuide, formatInteractiveStatusDisplayText, formatInteractiveSubmittedUserTurn, formatRuntimeDjDisplayName, formatStartupSetupNote, handleInteractiveInterrupt, questionWithInteractiveFrame, restoreInputAfterInlinePrompt, runSessionTurn, stopPlaybackForSessionExit, watchProcessingQuitKeypress, type InteractiveInterruptState, type InteractivePlaybackState } from "../src/session/sessionRunner.js";
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

class ChineseTitleProvider extends FakeProvider {
  async search(query: MusicSearchQuery, _limit: number): Promise<MusicTrackCandidate[]> {
    if (query.keyword === "献给永远的") {
      return [
        { provider: "netease", providerTrackId: "forever-main", title: "献给永远的", artists: ["大粉乐队"], album: "Single" },
        { provider: "netease", providerTrackId: "forever-memory", title: "献给永远的 (也许对你的记忆就是这爱情本身)", artists: ["大粉乐队", "钱正昊"], album: "Single" },
        { provider: "netease", providerTrackId: "forever-cover", title: "献给永远的", artists: ["曼小步"], album: "Single" }
      ];
    }
    return super.search(query, _limit);
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

    expect(guide).toContain("POCKEDIO SESSION");
    expect(guide).toContain("● Mina is listening.");
    expect(guide).toContain("START WITH");
    expect(guide).toContain("  › I'm exhausted and want something calm.");
    expect(guide).toContain("  › play something for deep work");
    expect(guide).toContain("  › what's playing?");
    expect(guide).toContain("STATION FLOW");
    expect(guide).toContain("Enter       play suggested station");
    expect(guide).toContain("dj          spoken DJ version");
    expect(guide).toContain("adjust      tell Mina how to change it");
    expect(guide).toContain("SETUP");
    expect(guide).toContain("setup");
    expect(guide).toContain("next");
    expect(guide).toContain("stop");
    expect(guide).toContain("menu        return to main menu");
    expect(guide).toContain("what's playing?");
    expect(guide).toContain("q           cancel processing");
    expect(guide).not.toContain("████");
  });

  it("does not render the hub splash symbol inside the colored session guide", () => {
    const guide = formatInteractiveStartupGuide("Mina", "", { color: true, width: 96 });
    const plain = stripAnsi(guide);

    expect(plain).toContain("POCKEDIO SESSION");
    expect(plain).toContain("Mina is listening");
    expect(plain).toContain("  › I'm exhausted and want something calm.");
    expect(plain).not.toContain("▌ ›");
    expect(plain).not.toContain("████");
    expect(plain).not.toContain("Music tuned to the moment.");
  });

  it("uses the selected DJ display name in the startup guide", () => {
    const guide = formatInteractiveStartupGuide("Nova");

    expect(guide).toContain("● Nova is listening.");
    expect(guide).toContain("adjust      tell Nova how to change it");
    expect(guide).not.toContain("tell Mina how to change it");
  });

  it("uses the selected voice as the interactive startup identity", () => {
    const config = makeConfig();
    config.dj.displayName = "Mina";
    config.tts.provider = "macos";
    config.tts.macosVoice = "sable";

    expect(formatInteractiveStartupDisplayName(config, "darwin")).toBe("Sable");
    expect(formatRuntimeDjDisplayName(config, "darwin")).toBe("Sable");
    expect(formatRuntimeDjDisplayName(config, "linux")).toBe("Sable");

    config.tts.provider = "fish";
    config.tts.fishVoice = "nova";
    expect(formatInteractiveStartupDisplayName(config, "darwin")).toBe("Nova");
    expect(formatRuntimeDjDisplayName(config, "darwin")).toBe("Nova");

    config.tts.provider = "text";
    expect(formatInteractiveStartupDisplayName(config, "darwin")).toBe("Pockedio");
    expect(formatRuntimeDjDisplayName(config, "darwin")).toBe("Pockedio");
  });

  it("shows a concise startup setup note when taste is missing", () => {
    const config = loadConfig({ POCKEDIO_HOME: fs.mkdtempSync(path.join(os.tmpdir(), "pockedio-missing-taste-")) });
    const note = formatStartupSetupNote(config);
    const guide = formatInteractiveStartupGuide("Mina", note);

    expect(note).toContain("Taste signals are not imported yet.");
    expect(guide).toContain("SETUP NOTE");
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
      "Preparing station intro...",
      "Starting playback..."
    ]);
  });

  it("chooses immediate interactive status labels before slower turn work begins", () => {
    expect(formatInitialInteractiveTurnStatus("play something calm", {})).toBe("Thinking...");
    expect(formatInitialInteractiveTurnStatus("", {})).toBeUndefined();
    expect(formatInitialInteractiveTurnStatus("", { pendingStationRequest: "soft focus" })).toBe("Starting station...");
    expect(formatInitialInteractiveTurnStatus("dj", { pendingStationRequest: "soft focus" })).toBe("Preparing DJ program...");
    expect(formatInitialInteractiveTurnStatus("Want some soft jazz, dj mode", {})).toBe("Preparing DJ program...");
    expect(formatInitialInteractiveTurnStatus("", {
      pendingDjProgram: {
        sessionId: "session-1",
        requestText: "morning focus",
        station: { request: "morning focus", source: "fallback", tracks: [] },
        storedTracks: [],
        intro: { text: "Good morning.", rawText: "Good morning.", audioPath: "/tmp/intro.wav" },
        llm: fakeLlm(),
        synthesize: async () => ({ ok: true, audioPath: "/tmp/intro.wav", latencyMs: 1 })
      }
    })).toBe("Starting DJ program...");
  });

  it("formats processing status with q as the cancel key", () => {
    expect(formatInteractiveStatusDisplayText("Thinking...")).toBe("Thinking...  press q to cancel");
  });

  it("clears the interactive status before printing turn output", () => {
    const events: string[] = [];
    const writeOutput = createTurnScopedOutputWriter(
      (text) => events.push(`output:${text}`),
      () => events.push("status:clear")
    );

    writeOutput("Bill Evans is a legendary American jazz pianist.");

    expect(events).toEqual([
      "status:clear",
      "output:Bill Evans is a legendary American jazz pianist."
    ]);
  });

  it("prints background playback output without swallowing the active prompt input", () => {
    const writes: string[] = [];
    const output = {
      isTTY: true,
      write: (chunk: string | Uint8Array) => {
        writes.push(String(chunk));
        return true;
      }
    };
    const writeOutput = createPromptSafeOutputWriter(
      { line: "Who is the singer? The background of this song?", cursor: 18 },
      output,
      () => true
    );

    writeOutput("Now playing: 3/5  Misty - Ella Fitzgerald");

    const outputText = stripAnsi(writes.join(""));
    expect(outputText).toContain("Now playing: 3/5  Misty - Ella Fitzgerald\n");
    expect(outputText).toContain("› Who is the singer? The background of this song?");
    expect(outputText).not.toContain("▌");
    expect(outputText).toContain("─".repeat(32));
  });

  it("restores the live prompt cursor using CJK display width", () => {
    const writes: string[] = [];
    const output = {
      isTTY: true,
      columns: 32,
      write: (chunk: string | Uint8Array) => {
        writes.push(String(chunk));
        return true;
      }
    };
    const writeOutput = createPromptSafeOutputWriter(
      { line: "我想听", cursor: 3 },
      output,
      () => true
    );

    writeOutput("Now playing: 3/5  Misty - Ella Fitzgerald");

    expect(stripAnsi(writes.join(""))).toContain("› 我想听");
    expect(stripAnsi(writes.join(""))).not.toContain("▌");
    expect(writes.join("")).toContain("\u001b[9G");
  });

  it("formats submitted user turns separately from the live prompt", () => {
    expect(formatInteractiveSubmittedUserTurn("› favorite the first song")).toBe("\n› favorite the first song\n\n");
    expect(formatInteractiveSubmittedUserTurn("   ")).toBe("");

    const colored = formatInteractiveSubmittedUserTurn("favorite 1", { color: true, width: 48 });
    expect(colored).toMatch(/\u001b\[[0-9;]*48;5;/);
    expect(colored.startsWith("\n")).toBe(true);
    expect(stripAnsi(colored)).toContain("▌ ›  favorite 1");
  });

  it("renders live input as a ruled plain prompt area", () => {
    expect(formatInteractiveLivePrompt()).toBe("› ");
    expect(formatInteractiveLivePrompt({ color: true, width: 32 })).toContain("›");

    const rule = stripAnsi(formatInteractiveLivePromptRule({ color: true, width: 32 }));
    expect(rule).toBe("─".repeat(32));
    expect(stripAnsi(formatInteractiveLivePromptBox("hello", { color: true, width: 32 })))
      .toContain("› hello");
    expect(stripAnsi(formatInteractiveLivePromptBox("hello", { color: true, width: 32 })))
      .not.toContain("▌");
    expect(stripAnsi(formatInteractiveLivePromptBox("hello", { color: true, width: 32 })))
      .not.toContain("─");
  });

  it("does not clear previous output before the first live prompt render", async () => {
    const writes: string[] = [];
    const input = new EventEmitter() as EventEmitter & {
      isTTY: boolean;
      isRaw: boolean;
      setRawMode: (value: boolean) => void;
      resume: () => typeof input;
      pause: () => typeof input;
    };
    input.isTTY = true;
    input.isRaw = false;
    input.setRawMode = (value: boolean) => {
      input.isRaw = value;
    };
    input.resume = () => input;
    input.pause = () => input;
    const output = {
      isTTY: true,
      columns: 32,
      write: (chunk: string | Uint8Array) => {
        writes.push(String(chunk));
        return true;
      }
    };
    const promptView = { line: "", cursor: 0 };
    const question = questionWithInteractiveFrame(
      {} as never,
      input as never,
      output as never,
      promptView,
      () => undefined,
      { color: true, width: 32 }
    );

    expect(writes.join("")).not.toContain("\u001b[2K");
    expect(writes.join("")).not.toContain("\u001b[1G");
    const plain = stripAnsi(writes.join(""));
    expect(plain).toContain("› ");
    expect(plain).not.toContain("▌");
    expect(plain.match(/─{32}/g)).toHaveLength(2);
    expect(writes.join("")).toContain("\u001b[3G");

    input.emit("keypress", "\r", { name: "return" });
    await expect(question).resolves.toBe("");
  });

  it("clears the live prompt frame when Ctrl+C exits from idle input", async () => {
    const writes: string[] = [];
    const input = new EventEmitter() as EventEmitter & {
      isTTY: boolean;
      isRaw: boolean;
      setRawMode: (value: boolean) => void;
      resume: () => typeof input;
      pause: () => typeof input;
    };
    let interrupted = false;
    let paused = false;
    input.isTTY = true;
    input.isRaw = false;
    input.setRawMode = (value: boolean) => {
      input.isRaw = value;
    };
    input.resume = () => input;
    input.pause = () => {
      paused = true;
      return input;
    };
    const output = {
      isTTY: true,
      columns: 32,
      write: (chunk: string | Uint8Array) => {
        writes.push(String(chunk));
        return true;
      }
    };
    const question = questionWithInteractiveFrame(
      {} as never,
      input as never,
      output as never,
      { line: "", cursor: 0 },
      () => {
        interrupted = true;
      },
      { color: true, width: 32 }
    );

    input.emit("keypress", "\u0003", { name: "c", ctrl: true });

    await expect(question).rejects.toThrow("readline was closed");
    expect(interrupted).toBe(true);
    expect(input.isRaw).toBe(false);
    expect(paused).toBe(true);
    expect(writes.join("")).toContain("\u001b[2K");
    expect(writes.join("")).toContain("\u001b[1G");
  });

  it("clears the raw readline echo only for TTY submitted input", () => {
    const writes: string[] = [];
    const output = {
      isTTY: true,
      write: (chunk: string | Uint8Array) => {
        writes.push(String(chunk));
        return true;
      }
    };

    clearInteractiveSubmittedInputEcho(output);

    const joined = writes.join("");
    expect(joined).toContain("\u001b[2K");
    expect(joined).toContain("\u001b[1G");
    expect(joined).toContain("\u001b[1A");
    expect(joined).toContain("\u001b[2B");
    expect(joined).toContain("\u001b[2A");

    const nonTtyWrites: string[] = [];
    clearInteractiveSubmittedInputEcho({
      isTTY: false,
      write: (chunk: string | Uint8Array) => {
        nonTtyWrites.push(String(chunk));
        return true;
      }
    });
    expect(nonTtyWrites).toEqual([]);
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

  it("labels playback notes with the selected built-in voice, not the legacy DJ name", async () => {
    const config = makeConfig();
    config.dj.displayName = "Mina";
    config.tts.provider = "macos";
    config.tts.macosVoice = "lumen";
    const playbackState: InteractivePlaybackState = {};

    const result = await runSessionTurn({
      input: "play To Be Alone With You by Sufjan Stevens",
      config,
      playbackState,
      provider: new AmbiguousSongProvider(),
      llm: fakeLlm(),
      startUrlPlayback: async (url) => ({
        target: url,
        done: new Promise(() => undefined),
        stop: () => undefined
      })
    });

    expect(result.response).toContain("Lumen's note:");
    expect(result.response).not.toContain("Mina's note:");
  });

  it("opens a station continuation prompt after a direct song finishes", async () => {
    const config = makeConfig();
    config.dj.displayName = "Mina";
    const playbackState: InteractivePlaybackState = {};
    const output: string[] = [];
    let finishPlayback: ((result: { ok: boolean; target: string; exitCode: number; signal: null }) => void) | undefined;

    const result = await runSessionTurn({
      input: "play To Be Alone With You by Sufjan Stevens",
      config,
      playbackState,
      provider: new AmbiguousSongProvider(),
      llm: fakeLlm(),
      writeOutput: (text) => output.push(text),
      startUrlPlayback: async (url) => ({
        target: url,
        done: new Promise((resolve) => {
          finishPlayback = resolve;
        }),
        stop: () => undefined
      })
    });

    expect(result.response).toContain("Playing this one directly.");
    finishPlayback?.({ ok: true, target: "direct-track", exitCode: 0, signal: null });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(output.at(-1)).toBe("That song’s done. Press Enter to build a station from this direction, or tell me where to take it next.");
    expect(playbackState.pendingStationRequest).toBe("music like To Be Alone With You - Sufjan Stevens");
    expect(playbackState.pendingStationNeedsChoice).toBe(true);
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
    expect(result.response).toContain("> 1.  Intro - The xx");
    expect(result.response).toContain("↑↓ Select  |  Enter Play");
    expect(playbackState.pendingSingleTrackSelection?.candidates).toHaveLength(3);
  });

  it("asks whether glued play text is a song or station before starting playback", async () => {
    const config = makeConfig();
    const playbackState: InteractivePlaybackState = {};
    const started: string[] = [];

    const result = await runSessionTurn({
      input: "play献给永远的",
      config,
      playbackState,
      provider: new ChineseTitleProvider(),
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

    expect(result.intent.type).toBe("playback_request");
    expect(result.station).toBeUndefined();
    expect(started).toEqual([]);
    expect(result.response).toContain("How should I use \"献给永远的\"?");
    expect(result.response).toContain("> 1.  Play a song match");
    expect(result.response).toContain("  2.  Build a 5-song station");
    expect(playbackState.pendingSongOrStationSelection?.query).toBe("献给永远的");
  });

  it("asks whether short CJK play text is a song or station before showing song matches", async () => {
    const config = makeConfig();
    const playbackState: InteractivePlaybackState = {};
    const started: string[] = [];

    const result = await runSessionTurn({
      input: "play 献给永远的",
      config,
      playbackState,
      provider: new ChineseTitleProvider(),
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
    expect(result.response).toContain("How should I use \"献给永远的\"?");
    expect(result.response).toContain("> 1.  Play a song match");
    expect(result.response).toContain("  2.  Build a 5-song station");
    expect(playbackState.pendingSongOrStationSelection?.query).toBe("献给永远的");
  });

  it("continues to song matches when the user chooses song for ambiguous text", async () => {
    const config = makeConfig();
    const playbackState: InteractivePlaybackState = {};
    const started: string[] = [];

    await runSessionTurn({
      input: "play献给永远的",
      config,
      playbackState,
      provider: new ChineseTitleProvider(),
      llm: fakeLlm()
    });

    const result = await runSessionTurn({
      input: "1",
      config,
      playbackState,
      provider: new ChineseTitleProvider(),
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
    expect(result.response).toContain("I found a few close matches:");
    expect(result.response).toContain("> 1.  献给永远的 - 大粉乐队");
    expect(started).toEqual([]);
    expect(playbackState.pendingSongOrStationSelection).toBeUndefined();
    expect(playbackState.pendingSingleTrackSelection?.candidates).toHaveLength(3);
  });

  it("builds a station when the user chooses station for ambiguous text", async () => {
    const config = makeConfig();
    const playbackState: InteractivePlaybackState = {};
    const started: string[] = [];

    await runSessionTurn({
      input: "play献给永远的",
      config,
      playbackState,
      provider: new ChineseTitleProvider(),
      llm: fakeLlm()
    });

    const result = await runSessionTurn({
      input: "2",
      config,
      playbackState,
      provider: new ChineseTitleProvider(),
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
    expect(result.station?.request).toBe("play something for 献给永远的");
    expect(started).toHaveLength(1);
    expect(playbackState.pendingSongOrStationSelection).toBeUndefined();
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

  it("lets the user back out of an ambiguous single-track picker", async () => {
    const config = makeConfig();
    const playbackState: InteractivePlaybackState = {};
    const started: string[] = [];

    const picker = await runSessionTurn({
      input: "play Intro",
      config,
      playbackState,
      provider: new AmbiguousSongProvider(),
      llm: fakeLlm()
    });

    expect(picker.response).toContain("B Back");
    expect(picker.response).toContain("Esc Cancel");
    expect(playbackState.pendingSingleTrackSelection).toBeDefined();

    const result = await runSessionTurn({
      input: "back",
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

    expect(result.response).toBe("Selection cancelled.");
    expect(playbackState.pendingSingleTrackSelection).toBeUndefined();
    expect(started).toEqual([]);
  });

  it("keeps stdin flowing after the inline single-track picker returns to readline", () => {
    const calls: string[] = [];
    const input = {
      isTTY: true,
      isRaw: true,
      setRawMode(value: boolean) {
        calls.push(`raw:${value}`);
      },
      resume() {
        calls.push("resume");
        return this;
      }
    };

    restoreInputAfterInlinePrompt(input, false);

    expect(calls).toEqual(["raw:false", "resume"]);
  });

  it("uses a warmer LLM-authored station reply for emotional playback requests", async () => {
    const config = makeConfig();
    config.dj.displayName = "Mina";
    const prompts: string[] = [];

    const result = await runSessionTurn({
      input: "play something soft for my exhausted mood",
      config,
      provider: new FakeProvider(),
      llm: conversationalLlm("I hear the exhaustion, Mina. I’m keeping this soft, slow, and low-friction before the first track comes in.", prompts),
      buildContext: async () => ({ personality: config.personality }),
      playUrl: async (url) => ({ ok: true, target: url, exitCode: 0, signal: null })
    });

    expect(result.response).toContain("I hear the exhaustion.");
    expect(result.response).not.toContain("Mina.");
    expect(result.response).not.toContain("I built a five-track station");
    expect(result.response).toContain("Queue:");
    expect(prompts.some((prompt) => prompt.includes("Write a warm, concise station introduction"))).toBe(true);
    expect(prompts[0]).toContain("Mina is the DJ/assistant name, not the user's name.");
    expect(prompts[0]).toContain("Station size: 5 tracks total");
    expect(prompts[0]).toContain("Playable tracks:");
    expect(prompts[0]).toContain("Do not claim a different track count");
  });

  it("keeps generated station intros aligned to the device-local daypart", async () => {
    const config = makeConfig();
    config.dj.displayName = "Mina";

    const result = await runSessionTurn({
      input: "play something soft for my exhausted mood",
      config,
      provider: new FakeProvider(),
      llm: conversationalLlm("Tonight, soft songs will wrap around you."),
      buildContext: async () => ({
        now: "2026-05-25T06:30:00.000Z",
        timeOfDay: "afternoon",
        personality: config.personality
      }),
      playUrl: async (url) => ({ ok: true, target: url, exitCode: 0, signal: null })
    });

    expect(result.response).toContain("This afternoon, soft songs will wrap around you.");
    expect(result.response).not.toContain("Tonight, soft songs");
  });

  it("preserves a generated daypart when the user explicitly asks for it", async () => {
    const config = makeConfig();
    config.dj.displayName = "Mina";

    const result = await runSessionTurn({
      input: "play something soft for tonight",
      config,
      provider: new FakeProvider(),
      llm: conversationalLlm("Tonight, soft songs will wrap around you."),
      buildContext: async () => ({
        now: "2026-05-25T06:30:00.000Z",
        timeOfDay: "afternoon",
        personality: config.personality
      }),
      playUrl: async (url) => ({ ok: true, target: url, exitCode: 0, signal: null })
    });

    expect(result.response).toContain("Tonight, soft songs will wrap around you.");
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
    expect(rendered).not.toContain("Up next:");
    expect(rendered).toContain("> 1.");
    expect(rendered).toContain("  2.  something deep work instrumental - Test Artist  next");
    expect(rendered).toContain("Pockedio's note:");
    expect(rendered).toContain("This opens the set with deterministic fallback");
    expect(rendered).not.toContain("I’m playing this because");
    expect(rendered).toContain("[>...................] 00:00 elapsed");
    const playbackNoteIndex = rendered.lastIndexOf("Pockedio's note:");
    expect(playbackNoteIndex).toBeGreaterThan(rendered.indexOf("[>...................] 00:00 elapsed"));
    expect(playbackNoteIndex).toBeLessThan(rendered.indexOf("Queue:"));
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
    expect(result.response).not.toContain("Up next:");
    expect(result.response).toContain("> 2.");
    expect(result.response).toContain("  3.  something deep work calm - Test Artist          next");
    expect(result.response).toContain("Pockedio's note:");
    expect(stopCalls).toBe(1);
    expect(started).toHaveLength(2);
    expect(playbackState.currentIndex).toBe(1);
  });

  it("next on the final track completes the station without reporting a player failure", async () => {
    const config = makeConfig();
    const playbackState: InteractivePlaybackState = {};
    const output: string[] = [];
    const finishers: Array<(value: { ok: boolean; target: string; exitCode: number; signal: null; error?: string }) => void> = [];

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
        stop: () => {
          finishers.at(-1)?.({ ok: false, target: url, exitCode: 2, signal: null, error: "Process exited with code 2" });
        }
      })
    });

    for (let index = 0; index < 4; index += 1) {
      finishers[index]?.({ ok: true, target: `track-${index + 1}`, exitCode: 0, signal: null });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    const result = await runSessionTurn({
      input: "next",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: fakeLlm(),
      writeOutput: (text) => output.push(text)
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(result.response).toBe("That station’s done. Press Enter to choose how to continue this vibe, or tell me where to take it next.");
    expect(output.join("\n")).not.toContain("Playback stopped unexpectedly");
    expect(output.join("\n")).not.toContain("No playable tracks remain");
    expect(playbackState.pendingStationRequest).toBe("play something for deep work");
    expect(playbackState.pendingStationNeedsChoice).toBe(true);
  });

  it("treats next one as a skip control during playback", async () => {
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
      input: "next one",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: conversationalLlm("Coming up next: the first song again.")
    });

    expect(result.intent.type).toBe("feedback_skip");
    expect(result.response).toContain("Now playing: 2/5");
    expect(result.response).not.toContain("Coming up next");
    expect(stopCalls).toBe(1);
    expect(started).toHaveLength(2);
    expect(playbackState.currentIndex).toBe(1);
  });

  it("ignores the killed player process from manual next after replacement playback starts", async () => {
    const config = makeConfig();
    const output: string[] = [];
    const playbackState: InteractivePlaybackState = {};
    const finishers: Array<(value: { ok: boolean; target: string; exitCode: number; signal: null; error?: string }) => void> = [];

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

    const result = await runSessionTurn({
      input: "next",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: fakeLlm(),
      writeOutput: (text) => output.push(text)
    });

    finishers[0]?.({ ok: false, target: "track-1", exitCode: 2, signal: null, error: "Process exited with code 2" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(result.response).toContain("Now playing: 2/5");
    expect(output.join("\n")).not.toContain("Playback stopped unexpectedly");
    expect(playbackState.currentIndex).toBe(1);
  });

  it("previous stops the current track and returns to the previous playable track", async () => {
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
    await runSessionTurn({
      input: "next",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: fakeLlm()
    });

    const result = await runSessionTurn({
      input: "previous",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: fakeLlm()
    });

    expect(result.intent.type).toBe("previous");
    expect(result.response).toContain("Now playing: 1/5");
    expect(result.response).toContain("> 1.");
    expect(result.response).toContain("Pockedio's note:");
    expect(stopCalls).toBe(2);
    expect(started).toHaveLength(3);
    expect(playbackState.currentIndex).toBe(0);

    const rows = withDatabase(config, (db) => db.prepare(`
      SELECT position, playback_status as playbackStatus
      FROM station_tracks
      ORDER BY position
      LIMIT 2
    `).all());
    expect(rows).toEqual([
      { position: 1, playbackStatus: "playing" },
      { position: 2, playbackStatus: "skipped" }
    ]);
  });

  it("replay stops and restarts the current playable track", async () => {
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
      input: "replay this song",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: fakeLlm()
    });

    expect(result.intent.type).toBe("replay");
    expect(result.response).toContain("Now playing: 1/5");
    expect(result.response).toContain("> 1.");
    expect(stopCalls).toBe(1);
    expect(started).toHaveLength(2);
    expect(started[1]).toBe(started[0]);
    expect(playbackState.currentIndex).toBe(0);
  });

  it("plays a visible queue position instead of searching for a numeric song title", async () => {
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
      input: "play 5",
      config,
      playbackState,
      provider: new AmbiguousSongProvider(),
      llm: fakeLlm()
    });

    expect(result.intent.type).toBe("queue_position_playback");
    expect(result.response).toContain("Now playing: 5/5");
    expect(result.response).toContain("> 5.");
    expect(result.response).not.toContain("I found a few close matches");
    expect(stopCalls).toBe(1);
    expect(started).toHaveLength(2);
    expect(started[1]).toContain("something%20deep%20work%20Ryuichi%20Sakamoto");
    expect(playbackState.currentIndex).toBe(4);
  });

  it("plays a compact queue position command while a station is active", async () => {
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
      input: "play2",
      config,
      playbackState,
      provider: new AmbiguousSongProvider(),
      llm: fakeLlm()
    });

    expect(result.intent.type).toBe("queue_position_playback");
    expect(result.response).toContain("Now playing: 2/5");
    expect(result.response).toContain("> 2.");
    expect(stopCalls).toBe(1);
    expect(started).toHaveLength(2);
    expect(playbackState.currentIndex).toBe(1);
  });

  it("explains when previous has no earlier playable track", async () => {
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
      input: "previous",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: fakeLlm()
    });

    expect(result.intent.type).toBe("previous");
    expect(result.response).toBe("No previous track is available right now.");
    expect(playbackState.currentIndex).toBe(0);
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
    const originalIsTty = process.stdout.isTTY;
    const originalColumns = process.stdout.columns;
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    Object.defineProperty(process.stdout, "columns", { value: 96, configurable: true });
    let result;
    try {
      result = await runSessionTurn({
        input: "what's next?",
        config,
        playbackState,
        provider: new FakeProvider(),
        llm: fakeLlm()
      });
    } finally {
      Object.defineProperty(process.stdout, "isTTY", { value: originalIsTty, configurable: true });
      Object.defineProperty(process.stdout, "columns", { value: originalColumns, configurable: true });
    }

    expect(result.intent.type).toBe("playback_status");
    const plain = stripAnsi(result.response);
    expect(plain).toContain("NOW PLAYING");
    expect(plain).toContain("5/5");
    expect(plain).toContain("QUEUE");
    expect(plain).not.toContain("Now playing:");
    expect(plain).not.toContain("Queue:");
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

  it("returns to the main menu from the DJ session", async () => {
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

    const result = await runSessionTurn({
      input: "menu",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: fakeLlm()
    });

    expect(result.intent.type).toBe("main_menu");
    expect(result.shouldExit).toBe(true);
    expect(result.shouldReturnToMenu).toBe(true);
    expect(result.response).toBe("Returning to main menu.");
    expect(stopCalls).toBe(1);
    expect(playbackState.activePlayback).toBeUndefined();
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
      input: "keep playing",
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

  it("keeps a paused station resumable if the player exits while paused", async () => {
    const config = makeConfig();
    let pauseCalls = 0;
    let stopCalls = 0;
    const playbackState: InteractivePlaybackState = {};
    const playbackDoneResolvers: Array<(result: { ok: boolean; target: string; exitCode: number; signal: null }) => void> = [];
    const startedTargets: string[] = [];

    await runSessionTurn({
      input: "play something for deep work",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: fakeLlm(),
      buildContext: async () => ({ personality: config.personality }),
      startUrlPlayback: async (url) => {
        startedTargets.push(url);
        return {
          target: url,
          done: new Promise((resolve) => playbackDoneResolvers.push(resolve)),
          stop: () => {
            stopCalls += 1;
          },
          pause: () => {
            pauseCalls += 1;
            return true;
          }
        };
      }
    });

    await runSessionTurn({
      input: "pause",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: fakeLlm()
    });

    playbackDoneResolvers[0]?.({ ok: true, target: startedTargets[0]!, exitCode: 0, signal: null });
    await new Promise((resolve) => setImmediate(resolve));

    expect(playbackState.currentIndex).toBe(0);
    expect(playbackState.activePlaybackPaused).toBe(true);
    expect(startedTargets).toHaveLength(1);

    const result = await runSessionTurn({
      input: "resume",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: fakeLlm()
    });

    expect(result.intent.type).toBe("resume");
    expect(result.response).toContain("Resuming from the paused track.");
    expect(result.response).toContain("Now playing: 1/5");
    expect(startedTargets).toHaveLength(2);
    expect(startedTargets[1]).toBe(startedTargets[0]);
    expect(playbackState.currentIndex).toBe(0);
    expect(playbackState.activePlaybackPaused).toBe(false);
    expect(pauseCalls).toBe(1);
    expect(stopCalls).toBe(0);
  });

  it("uses semantic LLM control classification for natural resume wording", async () => {
    const config = makeConfig();
    let pauseCalls = 0;
    let resumeCalls = 0;
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
        stop: () => undefined,
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

    await runSessionTurn({
      input: "pause",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: fakeLlm()
    });

    const resumeResult = await runSessionTurn({
      input: "let it roll again",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: {
        generateJson: async () => ({ ok: true, value: { type: "resume", confidence: "high" } }),
        generateText: async () => ({ ok: true, value: "unused" })
      }
    });

    expect(resumeResult.intent.type).toBe("resume");
    expect(resumeResult.response).toBe("Resumed.");
    expect(pauseCalls).toBe(1);
    expect(resumeCalls).toBe(1);
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

    expect(result.response).toContain("NOW PLAYING");
    expect(result.response).toContain("Now playing: 1/5");
    expect(result.response).toContain("[====>...............] 02:05 elapsed");
    expect(result.response).toContain("QUEUE");
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

  it("does not auto-advance when session exit stops active playback", async () => {
    const config = makeConfig();
    const playbackState: InteractivePlaybackState = {};
    const started: string[] = [];
    let finishFirst: ((value: { ok: boolean; target: string; exitCode: null; signal: NodeJS.Signals }) => void) | undefined;

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
          stop: () => {
            finishFirst?.({ ok: false, target: url, exitCode: null, signal: "SIGTERM" });
          }
        };
      }
    });

    stopPlaybackForSessionExit(playbackState);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(started).toHaveLength(1);
    expect(playbackState.activePlayback).toBeUndefined();
  });

  it("stops active playback before closing on idle Ctrl+C", async () => {
    const playbackState: InteractivePlaybackState = {};
    let stopped = false;
    let closed = false;
    const events: string[] = [];
    playbackState.activePlayback = {
      target: "track-1",
      done: new Promise(() => undefined),
      stop: () => {
        stopped = true;
        events.push("stop");
      }
    };
    const state: InteractiveInterruptState = {
      playbackState,
      exiting: false,
      suppressIdleInterruptUntil: 0,
      closeReadline: () => {
        closed = true;
        events.push("close");
      }
    };

    handleInteractiveInterrupt(state, () => new Date(1_000));

    expect(stopped).toBe(true);
    expect(closed).toBe(true);
    expect(events).toEqual(["stop", "close"]);
    expect(playbackState.activePlayback).toBeUndefined();
    expect(state.exiting).toBe(true);
  });

  it("stops active playback and closes when Ctrl+C lands during an active turn", async () => {
    const playbackState: InteractivePlaybackState = {};
    const activeTurnController = new AbortController();
    let stopped = false;
    let closed = false;
    const events: string[] = [];
    playbackState.activePlayback = {
      target: "track-1",
      done: new Promise(() => undefined),
      stop: () => {
        stopped = true;
        events.push("stop");
      }
    };
    const state: InteractiveInterruptState = {
      activeTurnController,
      playbackState,
      exiting: false,
      suppressIdleInterruptUntil: 0,
      closeReadline: () => {
        closed = true;
        events.push("close");
      }
    };

    handleInteractiveInterrupt(state, () => new Date(1_000));

    expect(activeTurnController.signal.aborted).toBe(true);
    expect(stopped).toBe(true);
    expect(closed).toBe(true);
    expect(events).toEqual(["stop", "close"]);
    expect(playbackState.activePlayback).toBeUndefined();
    expect(state.exiting).toBe(true);
    expect(state.suppressIdleInterruptUntil).toBe(0);
  });

  it("lets q cancel a turn while keeping the session open", async () => {
    const input = new EventEmitter() as EventEmitter & {
      isTTY: boolean;
      isRaw: boolean;
      setRawMode: (value: boolean) => void;
      resume: () => typeof input;
      pause: () => typeof input;
    };
    const playbackState: InteractivePlaybackState = {};
    const activeTurnController = new AbortController();
    let closed = false;
    let paused = false;
    input.isTTY = true;
    input.isRaw = false;
    input.setRawMode = (value: boolean) => {
      input.isRaw = value;
    };
    input.resume = () => input;
    input.pause = () => {
      paused = true;
      return input;
    };
    const state: InteractiveInterruptState = {
      activeTurnController,
      playbackState,
      exiting: false,
      suppressIdleInterruptUntil: 0,
      closeReadline: () => {
        closed = true;
      }
    };

    const cleanup = watchProcessingQuitKeypress(input as never, state);
    expect(input.isRaw).toBe(true);
    input.emit("keypress", "q", { name: "q" });
    cleanup();

    expect(activeTurnController.signal.aborted).toBe(true);
    expect(closed).toBe(false);
    expect(playbackState.activePlayback).toBeUndefined();
    expect(state.exiting).toBe(false);
    expect(input.isRaw).toBe(false);
    expect(paused).toBe(true);
  });

  it("cancels pending DJ voice preparation before closing on idle Ctrl+C", async () => {
    const playbackState: InteractivePlaybackState = {};
    let cancelled = false;
    playbackState.djProgram = {
      sessionId: "session-1",
      requestText: "late afternoon set",
      station: {} as never,
      llm: fakeLlm(),
      synthesize: async () => ({ ok: false, latencyMs: 0, error: "unused" }),
      playFile: async () => ({ ok: false, target: "unused", exitCode: null, signal: null }),
      preparations: new Map([[
        4,
        {
          ready: false,
          cancel: () => {
            cancelled = true;
          },
          intro: {
            ready: false,
            rawText: "still rendering"
          }
        } as never
      ]]),
      quietTrackIndexes: new Set(),
      spokenTrackIndexes: new Set()
    };
    const state: InteractiveInterruptState = {
      playbackState,
      exiting: false,
      suppressIdleInterruptUntil: 0,
      closeReadline: () => undefined
    };

    handleInteractiveInterrupt(state, () => new Date(1_000));

    expect(cancelled).toBe(true);
    expect(playbackState.djProgram.preparations.size).toBe(0);
    expect(state.exiting).toBe(true);
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

  it("marks a failed active player process and tries the next track", async () => {
    const config = makeConfig();
    const playbackState: InteractivePlaybackState = {};
    const output: string[] = [];
    const finishers: Array<(value: { ok: boolean; target: string; exitCode: number; signal: null; error?: string }) => void> = [];

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

    finishers[0]?.({ ok: false, target: "first", exitCode: 4, signal: null, error: "Audio output failed." });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(playbackState.currentIndex).toBe(1);
    expect(output.at(-1)).toContain("Playback stopped unexpectedly");
    expect(output.at(-1)).toContain("Audio output failed.");
    expect(output.at(-1)).toContain("Now playing: 2/5");

    const rows = withDatabase(config, (db) => db.prepare(`
      SELECT position, playback_status as playbackStatus, failure_reason as failureReason
      FROM station_tracks
      ORDER BY position
      LIMIT 2
    `).all());
    expect(rows).toEqual([
      { position: 1, playbackStatus: "failed", failureReason: "Audio output failed." },
      { position: 2, playbackStatus: "playing", failureReason: null }
    ]);
  });

  it("stops automatic advance after consecutive player process failures", async () => {
    const config = makeConfig();
    const playbackState: InteractivePlaybackState = {};
    const output: string[] = [];
    const finishers: Array<(value: { ok: boolean; target: string; exitCode: number; signal: null; error?: string }) => void> = [];

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

    finishers[0]?.({ ok: false, target: "first", exitCode: 2, signal: null, error: "Process exited with code 2" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    finishers[1]?.({ ok: false, target: "second", exitCode: 2, signal: null, error: "Process exited with code 2" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const text = output.join("\n");
    expect(text).toContain("Playback stopped unexpectedly");
    expect(text).toContain("Trying the next track.");
    expect(text).toContain("I stopped automatic advance because multiple tracks failed in a row.");
    expect(text).not.toContain("Now playing: 3/5");
    expect(playbackState.currentIndex).toBe(1);
    expect(playbackState.currentTrackId).toBeUndefined();
    expect(playbackState.activePlayback).toBeUndefined();
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

    expect(result.response).toBe("● This track has a steady, focused pulse.");
    const conversationIndex = output.findIndex((text) => text === "● This track has a steady, focused pulse.");
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

    expect(output.at(-1)).toBe("That station’s done. Press Enter to choose how to continue this vibe, or tell me where to take it next.");
    expect(playbackState.pendingStationRequest).toBe("play something for deep work");
    expect(playbackState.pendingStationNeedsChoice).toBe(true);
  });

  it("keeps the prompt-safe background writer after a station turn starts playback", async () => {
    const config = makeConfig();
    const turnOutput: string[] = [];
    const backgroundOutput: string[] = [];
    const playbackState: InteractivePlaybackState = {
      writeOutput: (text) => backgroundOutput.push(text)
    };
    const finishers: Array<(value: { ok: boolean; target: string; exitCode: number; signal: null }) => void> = [];

    await runSessionTurn({
      input: "play something for deep work",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: fakeLlm(),
      buildContext: async () => ({ personality: config.personality }),
      writeOutput: (text) => turnOutput.push(text),
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

    expect(backgroundOutput.at(-1)).toBe("That station’s done. Press Enter to choose how to continue this vibe, or tell me where to take it next.");
    expect(turnOutput.at(-1)).not.toBe("That station’s done. Press Enter to choose how to continue this vibe, or tell me where to take it next.");
  });

  it("asks for normal or DJ mode before continuing a completed station", async () => {
    const config = makeConfig();
    const playbackState: InteractivePlaybackState = {};
    const started: string[] = [];
    const finishers: Array<(value: { ok: boolean; target: string; exitCode: number; signal: null }) => void> = [];

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
            finishers.push(resolve);
          }),
          stop: () => undefined
        };
      }
    });

    for (let index = 0; index < 5; index += 1) {
      finishers[index]?.({ ok: true, target: `track-${index + 1}`, exitCode: 0, signal: null });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    const choice = await runSessionTurn({
      input: "",
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

    expect(choice.intent.type).toBe("pending_station_refinement");
    expect(choice.response).toContain("Continue this vibe?");
    expect(choice.response).toContain("type \"dj\" for a spoken DJ version");
    expect(started).toHaveLength(5);
    expect(playbackState.pendingStationNeedsChoice).toBe(false);
    expect(playbackState.pendingStationRequest).toBe("play something for deep work");

    const playback = await runSessionTurn({
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

    expect(playback.intent.type).toBe("pending_station_confirmation");
    expect(playback.response).toContain("Now playing: 1/5");
    expect(started).toHaveLength(6);
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

  it("reshapes the remaining queue for more-like-this feedback", async () => {
    const config = makeConfig();
    const playbackState: InteractivePlaybackState = {};
    let stationPlanCalls = 0;
    const llm: LlmClient = {
      generateJson: async () => {
        stationPlanCalls += 1;
        if (stationPlanCalls === 1) {
          return { ok: false as const, errorCode: "llm_unavailable" as const, error: "use fallback first" };
        }
        return {
          ok: true as const,
          value: {
            tracks: [
              { title: "Near Lane 1", artist: "Reshape Artist", rationale: "closer to current track" },
              { title: "Near Lane 2", artist: "Reshape Artist", rationale: "closer to current track" },
              { title: "Near Lane 3", artist: "Reshape Artist", rationale: "closer to current track" },
              { title: "Near Lane 4", artist: "Reshape Artist", rationale: "closer to current track" },
              { title: "Near Lane 5", artist: "Reshape Artist", rationale: "closer to current track" }
            ]
          }
        };
      },
      generateText: async () => ({ ok: true as const, value: "Tonight's set stays crisp and nocturnal." })
    };

    await runSessionTurn({
      input: "play something for deep work",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm,
      buildContext: async () => ({ personality: config.personality }),
      startUrlPlayback: async (url) => ({
        target: url,
        done: new Promise(() => undefined),
        stop: () => undefined
      })
    });

    const originalCurrent = playbackState.storedTracks?.[0]?.track.title;
    const statuses: string[] = [];
    const result = await runSessionTurn({
      input: "more like this",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm,
      buildContext: async () => ({ personality: config.personality }),
      writeStatus: (text) => {
        statuses.push(text);
        return () => undefined;
      }
    });

    expect(result.response).toContain("reshaped the rest of the queue");
    expect(statuses).toContain("Reshaping queue...");
    expect(playbackState.currentIndex).toBe(0);
    expect(playbackState.storedTracks?.[0]?.track.title).toBe(originalCurrent);
    expect(playbackState.storedTracks?.slice(1).map((entry) => entry.track.title)).toEqual([
      "Near Lane 1 Reshape Artist",
      "Near Lane 2 Reshape Artist",
      "Near Lane 3 Reshape Artist",
      "Near Lane 4 Reshape Artist"
    ]);
  });

  it("treats negated like-this feedback as less-like-this during playback", async () => {
    const config = makeConfig();
    const playbackState: InteractivePlaybackState = {};
    let stationPlanCalls = 0;
    const llm: LlmClient = {
      generateJson: async () => {
        stationPlanCalls += 1;
        if (stationPlanCalls === 1) {
          return {
            ok: true as const,
            value: {
              tracks: [
                { title: "Superheroes", artist: "Chief Keef", rationale: "driving piano and a husky vocal deliver a steady, forward-moving energy that aligns with the listener's post-exercise mindset" },
                { title: "Sparks", artist: "Coldplay", rationale: "steady piano" },
                { title: "Bloom", artist: "The Paper Kites", rationale: "soft acoustic drift" },
                { title: "Weightless Part 1", artist: "Marconi Union", rationale: "quiet ambient landing" },
                { title: "Run", artist: "Snow Patrol", rationale: "anthemic lift" }
              ]
            }
          };
        }
        return {
          ok: true as const,
          value: {
            tracks: [
              { title: "Soft Reset", artist: "Reshape Artist", rationale: "less like current track" },
              { title: "Low Light", artist: "Reshape Artist", rationale: "less like current track" },
              { title: "Easy Turn", artist: "Reshape Artist", rationale: "less like current track" },
              { title: "Calm Road", artist: "Reshape Artist", rationale: "less like current track" },
              { title: "Quiet Finish", artist: "Reshape Artist", rationale: "less like current track" }
            ]
          }
        };
      },
      generateText: async () => ({ ok: true as const, value: "Tonight's set stays crisp and nocturnal." })
    };

    await runSessionTurn({
      input: "play something for deep work",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm,
      buildContext: async () => ({ personality: config.personality }),
      startUrlPlayback: async (url) => ({
        target: url,
        done: new Promise(() => undefined),
        stop: () => undefined
      })
    });

    const result = await runSessionTurn({
      input: "dont like this one",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm,
      buildContext: async () => ({ personality: config.personality })
    });

    expect(result.intent.type).toBe("feedback_less_like_this");
    expect(result.response).toContain("I’ll ease away from");
    expect(result.response).toContain("I reshaped the rest of the queue");
    expect(result.response).not.toContain("I’ll lean more toward");
    expect(result.response).not.toContain("listener's");
    expect(result.response).not.toContain("the user's");
  });

  it("reshapes the remaining queue for grief-informed tone changes during playback", async () => {
    const config = makeConfig();
    const playbackState: InteractivePlaybackState = {};
    let stationPlanCalls = 0;
    const llm: LlmClient = {
      generateJson: async () => {
        stationPlanCalls += 1;
        if (stationPlanCalls === 1) {
          return { ok: false as const, errorCode: "llm_unavailable" as const, error: "use fallback first" };
        }
        return {
          ok: true as const,
          value: {
            tracks: [
              { title: "Quiet Table", artist: "Comfort Artist", rationale: "gentler tone" },
              { title: "Small Light", artist: "Comfort Artist", rationale: "gentler tone" },
              { title: "Low Window", artist: "Comfort Artist", rationale: "gentler tone" },
              { title: "After Rain", artist: "Comfort Artist", rationale: "gentler tone" },
              { title: "Still Room", artist: "Comfort Artist", rationale: "gentler tone" }
            ]
          }
        };
      },
      generateText: async () => ({ ok: true as const, value: "I hear you. I’ll soften the rest of the queue." })
    };

    await runSessionTurn({
      input: "play something bright for Monday",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm,
      buildContext: async () => ({ personality: config.personality }),
      startUrlPlayback: async (url) => ({
        target: url,
        done: new Promise(() => undefined),
        stop: () => undefined
      })
    });

    const result = await runSessionTurn({
      input: "still in the depression of my gradpa's pass, change the tone.",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm,
      buildContext: async () => ({ personality: config.personality })
    });

    expect(result.intent.type).toBe("feedback_change_vibe");
    expect(result.response).toContain("I’ll change the tone from here.");
    expect(result.response).toContain("reshaped the rest of the queue");
    expect(playbackState.storedTracks?.slice(1).map((entry) => entry.track.title)).toEqual([
      "Quiet Table Comfort Artist",
      "Small Light Comfort Artist",
      "Low Window Comfort Artist",
      "After Rain Comfort Artist"
    ]);
  });

  it("does not treat station tone changes as standalone DJ voice requests", async () => {
    const config = makeConfig();
    const playbackState: InteractivePlaybackState = {};
    const llm: LlmClient = {
      generateJson: async () => ({ ok: true as const, value: { type: "explicit_dj_audio_request", confidence: "high" } }),
      generateText: async () => ({ ok: true as const, value: "I’ll move the station toward something gentler." })
    };

    await runSessionTurn({
      input: "play something bright for Monday",
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
      input: "change the station tone",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm,
      buildContext: async () => ({ personality: config.personality })
    });

    expect(result.intent.type).toBe("feedback_change_vibe");
    expect(result.response).not.toContain("DJ voice belongs to a station");
    expect(result.response).toContain("I’ll change the tone from here.");
  });

  it("confirms favorites with human-facing current-track copy", async () => {
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
      input: "favorite this",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: fakeLlm()
    });

    expect(result.response).toContain("Saved \"something deep work\" as a favorite.");
    expect(result.response).not.toMatch(/\b(high-confidence|signal|weight|locally)\b/i);
  });

  it("treats combined love and favorite wording as a favorite action", async () => {
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
      input: "Love this song, favorite it",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: fakeLlm()
    });

    expect(result.intent.type).toBe("feedback_favorite");
    expect(result.response).toContain("Saved \"something deep work\" as a favorite.");
    expect(result.response).not.toContain("I’ll lean more toward");

    const rows = withDatabase(config, (db) => db.prepare(`
      SELECT action FROM feedback ORDER BY created_at
    `).all());
    expect(rows).toEqual([{ action: "favorite" }]);
  });

  it("favorites a named queued track instead of the currently playing track", async () => {
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
      input: "next",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: fakeLlm()
    });
    await runSessionTurn({
      input: "next",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: fakeLlm()
    });

    expect(playbackState.currentIndex).toBe(2);
    const firstTrack = playbackState.storedTracks?.[0]?.track;
    expect(firstTrack?.title).toBeTruthy();

    const result = await runSessionTurn({
      input: `Favorite ${firstTrack!.title}`,
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: fakeLlm()
    });

    expect(result.intent.type).toBe("feedback_favorite");
    expect(result.response).toContain(`Saved "${firstTrack!.title}" as a favorite.`);
    expect(result.response).not.toContain("Your favorite songs:");

    const favoriteSignals = withDatabase(config, (db) => db.prepare(`
      SELECT target_value as targetValue
      FROM taste_signals
      WHERE signal_type = 'favorite'
    `).all());
    expect(favoriteSignals).toEqual([{ targetValue: `${firstTrack!.title} - ${firstTrack!.artist}` }]);
  });

  it("favorites a referenced queue position instead of falling back to the current track", async () => {
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
      input: "next",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: fakeLlm()
    });

    expect(playbackState.currentIndex).toBe(1);
    const firstTrack = playbackState.storedTracks?.[0]?.track;
    const currentTrack = playbackState.storedTracks?.[1]?.track;
    expect(firstTrack?.title).toBeTruthy();
    expect(currentTrack?.title).toBeTruthy();

    const result = await runSessionTurn({
      input: "favorite the first song of this track",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: fakeLlm()
    });

    expect(result.intent.type).toBe("feedback_favorite");
    expect(result.response).toContain(`Saved "${firstTrack!.title}" as a favorite.`);
    expect(result.response).not.toContain(`Saved "${currentTrack!.title}" as a favorite.`);

    const favoriteSignals = withDatabase(config, (db) => db.prepare(`
      SELECT target_value as targetValue
      FROM taste_signals
      WHERE signal_type = 'favorite'
    `).all());
    expect(favoriteSignals).toEqual([{ targetValue: `${firstTrack!.title} - ${firstTrack!.artist}` }]);
  });

  it("does not add duplicate favorite signals for the same current track", async () => {
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
    const duplicate = await runSessionTurn({
      input: "favorite this",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: fakeLlm()
    });

    expect(duplicate.response).toContain("\"something deep work\" is already in your favorites.");
    expect(duplicate.response).not.toMatch(/\b(high-confidence|signal|weight|locally)\b/i);

    const favoriteSignals = withDatabase(config, (db) => db.prepare(`
      SELECT signal_type as signalType, target_type as targetType, target_value as targetValue
      FROM taste_signals
      WHERE signal_type = 'favorite'
    `).all());
    expect(favoriteSignals).toEqual([
      {
        signalType: "favorite",
        targetType: "track",
        targetValue: "something deep work - Test Artist"
      }
    ]);
  });

  it("lists locally saved favorite songs without starting playback", async () => {
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
    await runSessionTurn({
      input: "favorite this",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: fakeLlm()
    });

    const result = await runSessionTurn({
      input: "List my favorite songs",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: fakeLlm()
    });

    expect(result.intent.type).toBe("favorite_list_request");
    expect(result.response).toBe([
      "Your favorite songs:",
      "1. something deep work - Test Artist"
    ].join("\n"));
    expect(started).toHaveLength(1);
  });

  it("deduplicates historical favorite rows when listing favorite songs", async () => {
    const config = makeConfig();
    withDatabase(config, (db) => {
      const insert = db.prepare(`
        INSERT INTO taste_signals (id, source_feedback_id, track_id, signal_type, target_type, target_value, weight, context_json, created_at)
        VALUES (?, NULL, NULL, 'favorite', 'track', ?, 5, NULL, ?)
      `);
      insert.run("favorite-a", "我们俩 - 郭顶", "2026-05-21T15:21:11.514Z");
      insert.run("favorite-b", "我们俩 - 郭顶", "2026-05-21T15:39:37.832Z");
      insert.run("favorite-c", "Fly Me To The Moon - 小野リサ", "2026-05-21T15:00:22.128Z");
    });

    const result = await runSessionTurn({
      input: "List my favorite songs",
      config,
      provider: new FakeProvider(),
      llm: fakeLlm()
    });

    expect(result.intent.type).toBe("favorite_list_request");
    expect(result.response).toBe([
      "Your favorite songs:",
      "1. 我们俩 - 郭顶",
      "2. Fly Me To The Moon - 小野リサ"
    ].join("\n"));
  });

  it("explains when favorite-song listing is empty", async () => {
    const config = makeConfig();

    const result = await runSessionTurn({
      input: "show my favorite tracks",
      config,
      provider: new FakeProvider(),
      llm: fakeLlm()
    });

    expect(result.intent.type).toBe("favorite_list_request");
    expect(result.response).toContain("No favorite songs saved yet");
    expect(result.response).toContain("favorite this");
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

  it("automatically refreshes the taste profile after feedback creates new signals", async () => {
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

    const markdown = fs.readFileSync(config.paths.taste, "utf8");
    const snapshot = withDatabase(config, (db) => db.prepare("SELECT summary FROM taste_profile_snapshots").get()) as { summary: string };

    expect(markdown).toContain("## Generated Taste Profile");
    expect(snapshot.summary).toContain("High-Confidence Favorites");
    expect(snapshot.summary).toContain("track:");
  });

  it("plays a locally saved favorite song", async () => {
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
    await runSessionTurn({
      input: "favorite this",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: fakeLlm()
    });

    const result = await runSessionTurn({
      input: "play my favorite song",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: fakeLlm()
    });

    expect(result.intent.type).toBe("favorite_playback_request");
    expect(result.response).toContain("Now playing: something deep work - Test Artist");
    expect(result.response).toContain("Pockedio's note:");
    expect(result.response).toContain("saved favorite");
    expect(result.response).not.toMatch(/\b(high-confidence|signal|weight|locally)\b/i);
    expect(started).toHaveLength(2);
    expect(stopCalls).toBe(1);
    expect(playbackState.storedTracks).toHaveLength(1);
  });

  it("explains when no favorite song has been saved yet", async () => {
    const config = makeConfig();
    const playbackState: InteractivePlaybackState = {};
    const started: string[] = [];

    const result = await runSessionTurn({
      input: "play one of my favorites",
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

    expect(result.intent.type).toBe("favorite_playback_request");
    expect(result.response).toContain("No favorite songs saved yet");
    expect(started).toEqual([]);
  });

  it("explains when saved favorites cannot be resolved to playable streams", async () => {
    const config = makeConfig();
    const playbackState: InteractivePlaybackState = {};
    withDatabase(config, (db) => {
      db.prepare(`
        INSERT INTO taste_signals (id, source_feedback_id, track_id, signal_type, target_type, target_value, weight, context_json, created_at)
        VALUES (lower(hex(randomblob(16))), NULL, NULL, 'favorite', 'track', 'Blue in Green - Miles Davis', 5, NULL, ?)
      `).run(new Date().toISOString());
    });

    const result = await runSessionTurn({
      input: "play my favorite song",
      config,
      playbackState,
      provider: {
        search: async () => [{
          provider: "netease",
          providerTrackId: "blue",
          title: "Blue in Green",
          artists: ["Miles Davis"],
          album: "Kind of Blue"
        }],
        getPlayableUrl: async () => ({
          available: false,
          provider: "netease",
          providerTrackId: "blue",
          reason: "No playable URL."
        })
      },
      llm: fakeLlm()
    });

    expect(result.intent.type).toBe("favorite_playback_request");
    expect(result.response).toContain("saved favorites");
    expect(result.response).toContain("playable stream");
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

  it("stores LLM-extracted structured DJ memory for useful session signals", async () => {
    const config = makeConfig();
    const playbackState: InteractivePlaybackState = {};
    const llm: LlmClient = {
      generateJson: async (prompt) => {
        if (prompt.includes("Extract reusable DJ memory")) {
          return {
            ok: true,
            value: {
              durable: true,
              summary: "User likes quiet piano for night reading and wants busy percussion avoided.",
              musicTags: ["quiet piano", "spacious"],
              contextTags: ["reading", "night"],
              avoidTags: ["busy percussion"],
              useCases: ["reading"],
              confidence: "high"
            }
          };
        }
        return { ok: false, errorCode: "llm_unavailable", error: "unused" };
      },
      generateText: async () => ({ ok: true, value: "That sounds like a quiet reading lane." })
    };

    await runSessionTurn({
      input: "This kind of quiet piano helps me read at night, but busy percussion distracts me.",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm,
      endSession: true
    });

    const memory = withDatabase(config, (db) => db.prepare(`
      SELECT content, metadata_json as metadataJson
      FROM memory_items
      WHERE kind = 'summary'
      ORDER BY created_at DESC, rowid DESC
      LIMIT 1
    `).get()) as { content: string; metadataJson: string };
    expect(memory.content).toContain("quiet piano for night reading");
    expect(JSON.parse(memory.metadataJson)).toMatchObject({
      generatedBy: "llm_session_memory_extractor",
      musicTags: ["quiet piano", "spacious"],
      contextTags: ["reading", "night"],
      avoidTags: ["busy percussion"],
      useCases: ["reading"],
      confidence: "high"
    });
  });

  it("uses LLM extraction when manually updating session memory", async () => {
    const config = makeConfig();
    const playbackState: InteractivePlaybackState = {};
    const sessionId = "manual-llm-memory-session";
    const llm: LlmClient = {
      generateJson: async (prompt) => {
        if (prompt.includes("Extract reusable DJ memory")) {
          return {
            ok: true,
            value: {
              durable: true,
              summary: "User wants spacious evening jazz for decompression.",
              musicTags: ["spacious jazz"],
              contextTags: ["evening", "decompression"],
              avoidTags: ["sharp percussion"],
              useCases: ["recovery"],
              confidence: "high"
            }
          };
        }
        return { ok: false, errorCode: "llm_unavailable", error: "unused" };
      },
      generateText: async () => ({ ok: true, value: "I’ll keep that evening decompression lane in mind." })
    };

    withDatabase(config, (db) => {
      db.prepare(`
        INSERT INTO sessions (id, started_at, trigger_type, trigger_text)
        VALUES (?, ?, ?, ?)
      `).run(sessionId, new Date().toISOString(), "conversation", "interactive session");
    });

    await runSessionTurn({
      input: "Spacious evening jazz helps me decompress, but sharp percussion is too much.",
      config,
      sessionId,
      endSession: false,
      playbackState,
      provider: new FakeProvider(),
      llm
    });

    await runSessionTurn({
      input: "summarize this session",
      config,
      sessionId,
      endSession: false,
      playbackState,
      provider: new FakeProvider(),
      llm
    });

    const memory = withDatabase(config, (db) => db.prepare(`
      SELECT content, metadata_json as metadataJson
      FROM memory_items
      WHERE kind = 'summary'
      ORDER BY created_at DESC, rowid DESC
      LIMIT 1
    `).get()) as { content: string; metadataJson: string };
    expect(memory.content).toContain("spacious evening jazz");
    expect(JSON.parse(memory.metadataJson)).toMatchObject({
      generatedBy: "llm_session_memory_extractor",
      avoidTags: ["sharp percussion"]
    });
  });

  it("does not promote generic playback requests into durable session memory", async () => {
    const config = makeConfig();
    const playbackState: InteractivePlaybackState = {};
    const sessionId = "generic-memory-session";

    withDatabase(config, (db) => {
      db.prepare(`
        INSERT INTO sessions (id, started_at, trigger_type, trigger_text)
        VALUES (?, ?, ?, ?)
      `).run(sessionId, new Date().toISOString(), "conversation", "interactive session");
    });

    await runSessionTurn({
      input: "play something",
      config,
      sessionId,
      endSession: false,
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
      input: "summarize this session",
      config,
      sessionId,
      endSession: false,
      playbackState,
      provider: new FakeProvider(),
      llm: fakeLlm()
    });

    expect(result.intent.type).toBe("session_memory_update");
    expect(result.response).toContain("I do not have a durable session memory");
    const row = withDatabase(config, (db) => db.prepare(`
      SELECT COUNT(*) as count
      FROM memory_items
      WHERE kind = 'summary'
    `).get()) as { count: number };
    expect(row.count).toBe(0);
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

  it("records conversational current-artist preferences as taste signals", async () => {
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
    const result = await runSessionTurn({
      input: "I like her songs.",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: conversationalLlm("Glad to hear that. This artist fits your quieter listening lane.")
    });

    expect(result.intent.type).toBe("conversation");
    expect(stopCalls).toBe(0);
    expect(playbackState.currentIndex).toBe(currentIndex);
    expect(playbackState.currentTrackId).toBe(currentTrackId);

    const signals = withDatabase(config, (db) => db.prepare(`
      SELECT signal_type as signalType, target_type as targetType, target_value as targetValue, weight, context_json as contextJson
      FROM taste_signals
      ORDER BY created_at DESC, rowid DESC
      LIMIT 1
    `).get()) as { signalType: string; targetType: string; targetValue: string; weight: number; contextJson: string };
    expect(signals).toMatchObject({
      signalType: "positive_seed",
      targetType: "artist",
      targetValue: "Test Artist",
      weight: 2
    });
    expect(JSON.parse(signals.contextJson)).toMatchObject({
      note: "I like her songs.",
      inferredFrom: "conversation_current_artist_preference",
      currentTrack: "something deep work - Test Artist"
    });
  });

  it("treats liking the singer voice as current-artist taste, not DJ voice mode", async () => {
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
      input: "I like her voice",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: conversationalLlm("I’ll remember that this singer’s voice works for you.")
    });

    expect(result.intent.type).toBe("conversation");
    expect(result.response).not.toContain("DJ voice belongs to a station");

    const signals = withDatabase(config, (db) => db.prepare(`
      SELECT signal_type as signalType, target_type as targetType, target_value as targetValue, weight, context_json as contextJson
      FROM taste_signals
      ORDER BY created_at DESC, rowid DESC
      LIMIT 1
    `).get()) as { signalType: string; targetType: string; targetValue: string; weight: number; contextJson: string };
    expect(signals).toMatchObject({
      signalType: "positive_seed",
      targetType: "artist",
      targetValue: "Test Artist",
      weight: 2
    });
    expect(JSON.parse(signals.contextJson)).toMatchObject({
      note: "I like her voice",
      inferredFrom: "conversation_current_artist_preference"
    });
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
          listeningHint: "Calendar listening hint for today: meeting-heavy context suggests focus before events and decompression after them.",
          state: {
            nowStatus: "before_next_event",
            currentEvent: null,
            nextEvent: {
              title: "Design Sync",
              startTime: "2026-05-19T14:00:00+08:00",
              endTime: "2026-05-19T15:00:00+08:00",
              calendarName: "Work",
              isAllDay: false,
              tags: ["meeting"]
            },
            minutesUntilNext: 30,
            freeWindowMinutes: 30,
            todayEventCount: 3,
            nextDaysHighlights: [],
            recentSchedulePattern: "No recent calendar events found.",
            tags: ["meeting"]
          }
        },
        personality: config.personality
      })
    });

    expect(result.intent.type).toBe("conversation");
    expect(result.station).toBeUndefined();
    expect(result.response).toContain("meeting-heavy");
    expect(prompts[0]).toContain("Calendar summary:");
    expect(prompts[0]).toContain("Calendar listening hint:");
    expect(prompts[0]).toContain("Calendar state:");
    expect(prompts[0]).toContain("Use calendar only as schedule evidence");
  });

  it("uses a wider calendar window for future schedule questions", async () => {
    const config = makeConfig();
    const calendarWindows: unknown[] = [];
    await runSessionTurn({
      input: "What should I listen to tomorrow morning?",
      config,
      playbackState: {},
      provider: new FakeProvider(),
      llm: conversationalLlm("Tomorrow has planning, so keep it focused."),
      buildContext: async (_config, options) => {
        calendarWindows.push(options?.calendarWindow);
        return {
          calendar: {
            available: true,
            events: [],
            summary: "Calendar has 1 event for the next few days: Tomorrow Planning.",
            listeningHint: "Calendar listening hint for the next few days: some scheduled context favors clear transitions.",
            state: {
              nowStatus: "free",
              currentEvent: null,
              nextEvent: null,
              minutesUntilNext: null,
              freeWindowMinutes: null,
              todayEventCount: 0,
              nextDaysHighlights: ["Tomorrow Planning at 2026-05-20T09:00:00+08:00"],
              recentSchedulePattern: "No recent calendar events found.",
              tags: ["meeting"]
            }
          },
          personality: config.personality
        };
      }
    });

    expect(calendarWindows).toEqual(["last7DaysTodayAndNext3Days"]);
  });

  it("uses diary context for personal mood conversation without starting playback", async () => {
    const config = makeConfig();
    const prompts: string[] = [];
    const result = await runSessionTurn({
      input: "The diary mood still feels heavy.",
      config,
      playbackState: {},
      provider: new FakeProvider(),
      llm: conversationalLlm("I hear the heaviness. Keep this gentle and close, without turning it into advice.", prompts),
      buildContext: async () => ({
        diary: {
          filePath: "/tmp/diary/2026-05-20.md",
          sourceMtime: "2026-05-20T10:00:00.000Z",
          summary: "Recent diary summary: loss has made the week feel heavy and quiet.",
          listeningHint: "Favor warm, spacious songs that can hold grief without becoming too bleak."
        },
        memorySummaries: [{
          id: "memory_1",
          kind: "diary",
          sourceSessionId: null,
          content: "Diary memory: A reflective night about missing family. Listening fit: warm spacious music.",
          metadata: { source: "diary", moodTags: ["reflective"] },
          createdAt: "2026-05-20T10:00:00.000Z"
        }],
        personality: config.personality
      })
    });

    expect(result.intent.type).toBe("conversation");
    expect(result.station).toBeUndefined();
    expect(prompts[0]).toContain("Diary summary: Recent diary summary: loss has made the week feel heavy and quiet.");
    expect(prompts[0]).toContain("Diary listening hint: Favor warm, spacious songs");
    expect(prompts[0]).toContain("Diary memory summaries: Diary memory: A reflective night about missing family.");
  });

  it("does not address the user by the selected DJ name during personal conversation", async () => {
    const config = makeConfig();
    config.dj.displayName = "Mina";
    const prompts: string[] = [];

    const result = await runSessionTurn({
      input: "I'm sad, I lost my grandpa.",
      config,
      provider: new FakeProvider(),
      llm: conversationalLlm("I'm so sorry for your loss, Mina.", prompts),
      buildContext: async () => ({ personality: config.personality })
    });

    expect(result.intent.type).toBe("conversation");
    expect(result.response).toBe("● I'm so sorry for your loss.");
    expect(prompts[0]).toContain("Mina is the DJ/assistant name, not the user's name.");
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

  it("keeps current-track lyric requests conversational instead of starting a station", async () => {
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
      input: "can you give me the full lyrics?",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: conversationalLlm("I can’t provide the full lyrics, but I can summarize the song’s mood.", prompts),
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
    expect(result.response).toContain("full lyrics");
    expect(started).toHaveLength(1);
    expect(stopCalls).toBe(0);
    expect(playbackState.currentIndex).toBe(currentIndex);
    expect(playbackState.currentTrackId).toBe(currentTrackId);
    expect(playbackState.pendingStationRequest).toBeUndefined();
    expect(prompts[0]).toContain("For lyric requests, do not provide full copyrighted lyrics");
    expect(prompts[0]).toContain("Current track:");
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

  it("keeps pronoun artist biography follow-ups grounded without LLM instead of storing personal context", async () => {
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

    const currentIndex = playbackState.currentIndex;
    const currentTrackId = playbackState.currentTrackId;
    const result = await runSessionTurn({
      input: "When did she born?",
      config,
      playbackState,
      provider: new FakeProvider(),
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
    expect(result.response).toContain("verified");
    expect(result.response).not.toContain("personal context");
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

  it("does not answer freshness-sensitive artist updates from stale model memory", async () => {
    const config = makeConfig();
    config.freshness.enabled = false;
    const prompts: string[] = [];

    const result = await runSessionTurn({
      input: "Tell me recent updates from 方大同",
      config,
      playbackState: {},
      provider: new FakeProvider(),
      llm: conversationalLlm("方大同 is still active behind the scenes and dropping occasional singles.", prompts)
    });

    expect(result.intent.type).toBe("conversation");
    expect(result.station).toBeUndefined();
    expect(result.response).toContain("current sources");
    expect(result.response).not.toContain("still active");
    expect(prompts).toHaveLength(0);
  });

  it("answers freshness-sensitive artist updates from supplied current sources", async () => {
    const config = makeConfig();
    const prompts: string[] = [];

    const result = await runSessionTurn({
      input: "Tell me recent updates from 方大同",
      config,
      playbackState: {},
      provider: new FakeProvider(),
      llm: conversationalLlm("unused stale answer", prompts),
      musicFreshness: {
        lookup: async () => ({
          sources: [{
            title: "Award winner and singer-songwriter Khalil Fong passes away at age 41",
            url: "https://example.com/khalil-fong",
            source: "Taipei Times",
            publishedAt: "2025-03-02",
            snippet: "Fong's record label confirmed Khalil Fong passed away on the morning of February 21, 2025."
          }]
        })
      }
    });

    expect(result.intent.type).toBe("conversation");
    expect(result.station).toBeUndefined();
    expect(result.response).toContain("February 21, 2025");
    expect(result.response).toContain("Taipei Times");
    expect(result.response).not.toContain("still active");
    expect(prompts).toHaveLength(0);
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

  it("confirms a queue offer made during artist background conversation", async () => {
    const config = makeConfig();
    const playbackState: InteractivePlaybackState = {};
    const started: string[] = [];
    const provider: MusicProvider = {
      async search(query: MusicSearchQuery): Promise<MusicTrackCandidate[]> {
        if (query.keyword === "郭顶") {
          return [
            { provider: "netease", providerTrackId: "mercury", title: "水星记", artists: ["郭顶"], album: "飞行器的执行周期" },
            { provider: "netease", providerTrackId: "flight", title: "飞行器的执行周期", artists: ["郭顶"], album: "飞行器的执行周期" },
            { provider: "netease", providerTrackId: "thinking", title: "想着你", artists: ["郭顶"], album: "微微" },
            { provider: "netease", providerTrackId: "baoshui", title: "保留", artists: ["郭顶"], album: "飞行器的执行周期" },
            { provider: "netease", providerTrackId: "lucky", title: "幸运大门", artists: ["郭顶"], album: "飞行器的执行周期" }
          ];
        }
        return new FakeProvider().search(query, 5);
      },
      async getPlayableUrl(trackId: string): Promise<PlayableTrack> {
        return {
          available: true,
          provider: "netease",
          providerTrackId: trackId,
          playableUrl: `https://example.com/${encodeURIComponent(trackId)}.mp3`,
          urlType: "mp3"
        };
      }
    };

    const setup = await runSessionTurn({
      input: "Tell me about 郭顶",
      config,
      playbackState,
      provider,
      llm: conversationalLlm("郭顶 is a Chinese singer-songwriter and producer. Want me to pull something of his into the queue?")
    });

    expect(setup.intent.type).toBe("conversation");
    expect(setup.station).toBeUndefined();
    expect(playbackState.pendingStationRequest).toBe("play songs by 郭顶");

    const result = await runSessionTurn({
      input: "Sure",
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

    expect(result.intent.type).toBe("pending_station_confirmation");
    expect(result.station?.request).toBe("play songs by 郭顶");
    expect(started).toHaveLength(1);
    expect(result.response).toContain("Now playing:");
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

  it("asks for station direction when the user wants a bare DJ program", async () => {
    const config = makeConfig();
    config.dj.displayName = "Mina";
    const playbackState: InteractivePlaybackState = {};
    let readContext = false;

    const result = await runSessionTurn({
      input: "I want a DJ program.",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: fakeLlm(),
      buildContext: async () => {
        readContext = true;
        return { personality: config.personality };
      }
    });

    expect(result.intent.type).toBe("playback_request");
    expect(result.response).toBe("Sure. What kind of set should I build it around?");
    expect(result.station).toBeUndefined();
    expect(playbackState.pendingDjProgram).toBeUndefined();
    expect(readContext).toBe(false);
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

  it("keeps selected DJ name in generated identity answers", async () => {
    const config = makeConfig();
    config.dj.displayName = "Mina";

    const result = await runSessionTurn({
      input: "Who are you?",
      config,
      provider: new FakeProvider(),
      llm: conversationalLlm("I'm Pockedio, your concise personal DJ.")
    });

    expect(result.intent.type).toBe("identity_capability");
    expect(result.response).toContain("Mina");
    expect(result.response).not.toContain("I'm Pockedio");
  });

  it("recommends music for mood questions without starting playback", async () => {
    const config = makeConfig();
    const playedUrls: string[] = [];
    const prompts: string[] = [];
    const statuses: string[] = [];

    const result = await runSessionTurn({
      input: "I'm a little grumpy, what music should I listen to?",
      config,
      provider: new FakeProvider(),
      llm: conversationalLlm("Try low-lit instrumental music with warm bass and no bright vocals. Want me to build that station?", prompts),
      buildContext: async () => ({ personality: config.personality }),
      writeStatus: (text) => {
        statuses.push(text);
        return () => undefined;
      },
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
    expect(prompts[0]).toContain("Do not claim the user has current tasks");
    expect(statuses).toEqual(["Thinking...", "Reading your context...", "Preparing recommendation..."]);
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
    expect(result.response).toContain("I could not get a polished recommendation reply this turn");
    expect(result.response).not.toContain("你可以听");
  });

  it("does not describe a single failed recommendation reply as a global LLM outage", async () => {
    const config = makeConfig();

    const result = await runSessionTurn({
      input: "What should I listen to tonight?",
      config,
      playbackState: {},
      provider: new FakeProvider(),
      llm: unavailableLlm(),
      buildContext: async () => ({ personality: config.personality })
    });

    expect(result.intent.type).toBe("music_recommendation");
    expect(result.response).toContain("I could not get a polished recommendation reply this turn");
    expect(result.response).toContain("Want me to search directly from your request");
    expect(result.response).not.toContain("offline");
    expect(result.response).not.toContain("deeper conversation layer");
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
        now: "2026-05-24T06:05:00.000Z",
        timeOfDay: "afternoon",
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
    expect(prompts[0]).toContain("Local time context: device-local daypart=afternoon");
    expect(prompts[0]).toContain("Treat the device-local daypart as authoritative");
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
    expect(result.response).toBe("● DJ program is ready.\n\n● Press Enter to start it, or tell me how to adjust it.");
    expect(result.response).not.toContain("DJ note");
    expect(result.response).not.toContain("Pockedio here.");
    expect(result.response).not.toContain("Now playing:");
    expect(started).toHaveLength(0);
    expect(playbackState.pendingStationRequest).toBeUndefined();
    expect(playbackState.pendingDjProgram).toBeDefined();
  });

  it("prepares a replacement station as a spoken DJ program when the change request includes DJ mode", async () => {
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

    const result = await runSessionTurn({
      input: "change to some soft jazz, dj mode",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: conversationalLlm("Pockedio here. I’ll open this with soft jazz and keep the room low-lit."),
      buildContext: async () => ({ personality: config.personality }),
      synthesizeFishAudio: async (_config, text) => ({
        ok: true,
        audioPath: `/tmp/${text.length}.wav`,
        latencyMs: 15
      }),
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

    expect(result.intent.type).toBe("pending_station_dj_program");
    expect(result.response).toBe("● DJ program is ready.\n\n● Press Enter to start it, or tell me how to adjust it.");
    expect(result.response).not.toContain("DJ voice belongs to a station");
    expect(started).toHaveLength(1);
    expect(stopCalls).toBe(1);
    expect(playbackState.pendingDjProgram?.requestText).toBe("change to some soft jazz");
  });

  it("prepares an idle DJ-mode station request without requiring a playback verb", async () => {
    const config = makeConfig();
    const playbackState: InteractivePlaybackState = {};
    const started: string[] = [];

    const result = await runSessionTurn({
      input: "Want some soft jazz, dj mode",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: conversationalLlm("Pockedio here. I’ll open this with soft jazz and keep the room low-lit."),
      buildContext: async () => ({ personality: config.personality }),
      synthesizeFishAudio: async (_config, text) => ({
        ok: true,
        audioPath: `/tmp/${text.length}.wav`,
        latencyMs: 15
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

    expect(result.intent.type).toBe("playback_request");
    expect(result.response).toBe("● DJ program is ready.\n\n● Press Enter to start it, or tell me how to adjust it.");
    expect(result.response).not.toContain("DJ voice belongs to a station");
    expect(started).toHaveLength(0);
    expect(playbackState.pendingDjProgram?.requestText).toBe("Want some soft jazz");
  });

  it("keeps prepared DJ program intros aligned to the device-local daypart", async () => {
    const config = makeConfig();
    const playbackState: InteractivePlaybackState = {};
    const synthesized: string[] = [];
    const prompts: string[] = [];

    await runSessionTurn({
      input: "Want some soft jazz, dj mode",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: conversationalLlm("Tonight, soft jazz can ease into the first track.", prompts),
      buildContext: async () => ({
        now: "2026-05-27T03:30:00.000Z",
        timeOfDay: "morning",
        personality: config.personality
      }),
      synthesizeFishAudio: async (_config, text) => {
        synthesized.push(text);
        return {
          ok: true,
          audioPath: "/tmp/pockedio-dj-intro.wav",
          latencyMs: 15
        };
      }
    });

    expect(playbackState.pendingDjProgram?.intro.rawText).toBe("This morning, soft jazz can ease into the first track.");
    expect(synthesized).toEqual(["This morning, soft jazz can ease into the first track."]);
    expect(prompts.some((prompt) => prompt.includes("Local time context: device-local daypart=morning"))).toBe(true);
  });

  it("preserves explicit requested night language in prepared DJ program intros", async () => {
    const config = makeConfig();
    const playbackState: InteractivePlaybackState = {};

    await runSessionTurn({
      input: "Want some soft jazz for tonight, dj mode",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: conversationalLlm("Tonight, soft jazz can ease into the first track."),
      buildContext: async () => ({
        now: "2026-05-27T03:30:00.000Z",
        timeOfDay: "morning",
        personality: config.personality
      }),
      synthesizeFishAudio: async () => ({
        ok: true,
        audioPath: "/tmp/pockedio-dj-intro.wav",
        latencyMs: 15
      })
    });

    expect(playbackState.pendingDjProgram?.intro.rawText).toBe("Tonight, soft jazz can ease into the first track.");
  });

  it("prepares a new DJ version of the current station when requested mid-playback", async () => {
    const config = makeConfig();
    const playbackState: InteractivePlaybackState = {};
    const started: string[] = [];
    let stopCalls = 0;

    await runSessionTurn({
      input: "play some morning soft jazz",
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
      input: "a new dj version",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: conversationalLlm("Pockedio here. I’ll reopen this soft jazz morning as a DJ program."),
      buildContext: async () => ({ personality: config.personality }),
      synthesizeFishAudio: async (_config, text) => ({
        ok: true,
        audioPath: `/tmp/${text.length}.wav`,
        latencyMs: 15
      })
    });

    expect(result.intent.type).toBe("pending_station_dj_program");
    expect(result.response).toBe("● DJ program is ready.\n\n● Press Enter to start it, or tell me how to adjust it.");
    expect(result.response).not.toContain("DJ mode is a before-playback choice");
    expect(started).toHaveLength(1);
    expect(stopCalls).toBe(1);
    expect(playbackState.pendingDjProgram?.requestText).toBe("play some morning soft jazz");
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
    expect(started.response).toContain("Pockedio's note:");
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
    config.tts.provider = "macos";
    config.tts.macosVoice = "lumen";
    const events: string[] = [];
    const prompts: string[] = [];
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
      generateText: async (prompt) => {
        prompts.push(prompt);
        return { ok: true, value: "Lumen here. I’ll turn this into a short radio-style opening." };
      }
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
    expect(result.response).toBe("● DJ program is ready.\n\n● Press Enter to start it, or tell me how to adjust it.");
    expect(result.response).not.toContain("DJ note");
    expect(result.response).not.toContain("Press Enter to play it");
    expect(result.response).not.toContain('type "dj"');
    expect(prompts.some((prompt) => prompt.includes("You are Lumen, Pockedio's spoken DJ."))).toBe(true);
    expect(prompts.some((prompt) => prompt.includes("You are Mina, Pockedio's spoken DJ."))).toBe(false);
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
          value: prompt.includes("Track 3")
            ? "I’m bringing this in because it aligns with the user's love for warm jazz."
            : "Mina keeps this short and warm."
        })
      },
      buildContext: async () => ({ personality: config.personality }),
      writeOutput: (text) => output.push(text),
      synthesizeFishAudio: async (_config, text) => ({
        ok: true,
        audioPath: text.includes("your love for warm jazz") ? "/tmp/track-3-intro.wav" : "/tmp/opening-intro.wav",
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
    expect(output.join("\n")).toContain("Mina's note:");
    expect(output.join("\n")).toContain("aligns with your love for warm jazz");
    expect(output.join("\n")).not.toContain("the user's love");
    expect(output.join("\n")).toContain("aligns with your love for warm jazz.\n\nNOW PLAYING\nNow playing:");
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
    const transitionController = new AbortController();
    const transitionSignal = transitionController.signal;
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
      synthesizeFishAudio: async () => {
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

    playbackState.djProgram?.preparations.set(2, {
      ready: false,
      promise: new Promise((resolve) => {
        transitionSignal.addEventListener("abort", () => {
          transitionCancelled = true;
          resolve(undefined);
        }, { once: true });
      }),
      cancel: () => transitionController.abort()
    });

    await runSessionTurn({
      input: "exit",
      config,
      playbackState,
      provider: new FakeProvider(),
      llm: fakeLlm()
    });

    expect(transitionSignal.aborted).toBe(true);
    expect(transitionCancelled).toBe(true);
  });

  it("uses a prepared closing voice on the final DJ-program track instead of a delayed post-station outro", async () => {
    const config = makeConfig();
    config.dj.displayName = "Mina";
    const playbackState: InteractivePlaybackState = {};
    const output: string[] = [];
    const playedFiles: string[] = [];
    const duckedStarts: Array<{ url: string; introFilePath: string }> = [];
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
          value: prompt.includes("Track 5")
            ? "Mina here. One last warm turn before the set lands softly."
            : prompt.includes("Track 3")
              ? "Track 3 intro is ready."
              : "Mina opens this softly."
        })
      },
      buildContext: async () => ({ personality: config.personality }),
      writeOutput: (text) => output.push(text),
      synthesizeFishAudio: async (_config, text) => ({
        ok: true,
        audioPath: text.includes("One last warm turn") ? "/tmp/final-closing.wav" : `/tmp/${text.length}.wav`,
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
          duckedStarts.push({ url, introFilePath });
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
          duckedStarts.push({ url, introFilePath });
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

    expect(duckedStarts.map((start) => start.introFilePath)).toContain("/tmp/final-closing.wav");
    expect(playedFiles).toEqual([]);
    expect(output.at(-1)).toBe("That station’s done. Press Enter to choose how to continue this vibe, or tell me where to take it next.");
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

  it("starts a replacement station when the user asks to build another station to change the vibe", async () => {
    const config = makeConfig();
    const playbackState: InteractivePlaybackState = {};
    const started: string[] = [];
    let stopCalls = 0;

    await runSessionTurn({
      input: "play something bright for Monday",
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
      input: "Build another station to change the vibe.",
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
    expect(result.response).toContain("Now playing: 1/5");
    expect(result.response).not.toBe("Understood. I’ll shift the mood from here.");
    expect(started).toHaveLength(2);
    expect(stopCalls).toBe(1);
    expect(playbackState.station?.request).toBe("Build another station to change the vibe.");
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

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, "");
}
