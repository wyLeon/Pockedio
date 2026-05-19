import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/load.js";
import { playFile, playUrl, startDuckedUrlWithIntro, startUrlPlayback, type PlaybackHandle, type ProcessRunner, type ProcessStarter } from "../src/player/afplay.js";
import { NetEaseProvider } from "../src/providers/netease.js";

function makeConfig() {
  return loadConfig({ POCKEDIO_HOME: "/tmp/pockedio-provider-test" });
}

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { "content-type": "application/json" }
  });
}

describe("NetEaseProvider", () => {
  it("normalizes search results", async () => {
    const provider = new NetEaseProvider(makeConfig(), async () => jsonResponse({
      result: {
        songs: [
          {
            id: 437715323,
            name: "Merry Christmas Mr. Lawrence",
            artists: [{ name: "坂本龍一" }],
            album: { name: "Merry Christmas Mr. Lawrence" }
          }
        ]
      }
    }));

    await expect(provider.search({ keyword: "坂本龙一" }, 5)).resolves.toEqual([
      {
        provider: "netease",
        providerTrackId: "437715323",
        title: "Merry Christmas Mr. Lawrence",
        artists: ["坂本龍一"],
        album: "Merry Christmas Mr. Lawrence"
      }
    ]);
  });

  it("returns an empty list when no songs are found", async () => {
    const provider = new NetEaseProvider(makeConfig(), async () => jsonResponse({ result: { songs: [] } }));

    await expect(provider.search({ keyword: "missing" }, 5)).resolves.toEqual([]);
  });

  it("returns a playable URL", async () => {
    const provider = new NetEaseProvider(makeConfig(), async () => jsonResponse({
      data: [{ id: 1, url: "https://example.com/song.mp3", type: "mp3", code: 200 }]
    }));

    await expect(provider.getPlayableUrl("1")).resolves.toEqual({
      available: true,
      provider: "netease",
      providerTrackId: "1",
      playableUrl: "https://example.com/song.mp3",
      urlType: "mp3"
    });
  });

  it("returns unavailable when URL is missing", async () => {
    const provider = new NetEaseProvider(makeConfig(), async () => jsonResponse({
      data: [{ id: 1, url: null, code: 404 }]
    }));

    await expect(provider.getPlayableUrl("1")).resolves.toEqual({
      available: false,
      provider: "netease",
      providerTrackId: "1",
      reason: "NetEase returned no playable URL.",
      code: 404
    });
  });

  it("rejects NetEase free-trial preview URLs as unavailable", async () => {
    const provider = new NetEaseProvider(makeConfig(), async () => jsonResponse({
      data: [{
        id: 1,
        url: "https://example.com/preview.mp3",
        type: "mp3",
        code: 200,
        time: 30040,
        freeTrialInfo: { start: 0, end: 30 }
      }]
    }));

    await expect(provider.getPlayableUrl("1")).resolves.toEqual({
      available: false,
      provider: "netease",
      providerTrackId: "1",
      reason: "NetEase returned a 30-second preview URL. Log in with an eligible account or choose another track.",
      code: 200
    });
  });
});

describe("afplay adapter", () => {
  it("downloads remote URLs before playing through afplay", async () => {
    const playedTargets: string[] = [];
    const runner: ProcessRunner = async (command, args) => ({
      ok: true,
      target: args[0],
      exitCode: command === "afplay" && !args[0].startsWith("https://") ? 0 : 1,
      signal: null
    });
    const fetchImpl: typeof fetch = async () => new Response("audio-bytes", {
      status: 200,
      headers: { "content-type": "audio/mpeg" }
    });

    const result = await playUrl("https://example.com/song.mp3", undefined, runner, fetchImpl);
    playedTargets.push(result.target);

    expect(result).toMatchObject({
      ok: true,
      exitCode: 0,
      signal: null
    });
    expect(playedTargets[0]).toMatch(/pockedio-playback-.*\.mp3$/);
    expect(fs.existsSync(playedTargets[0])).toBe(true);
  });

  it("wraps non-zero file playback exits", async () => {
    const runner: ProcessRunner = async (_command, args) => ({
      ok: false,
      target: args[0],
      exitCode: 2,
      signal: null,
      error: "unsupported file"
    });

    await expect(playFile("/tmp/missing.wav", 500, runner)).resolves.toEqual({
      ok: false,
      target: "/tmp/missing.wav",
      exitCode: 2,
      signal: null,
      error: "unsupported file"
    });
  });

  it("returns a stoppable playback handle for remote URLs", async () => {
    let stopped = false;
    const starter: ProcessStarter = (_command, args): PlaybackHandle => ({
      target: args[0],
      done: Promise.resolve({ ok: true, target: args[0], exitCode: 0, signal: null }),
      stop: () => {
        stopped = true;
      }
    });
    const fetchImpl: typeof fetch = async () => new Response("audio-bytes", {
      status: 200,
      headers: { "content-type": "audio/mpeg" }
    });

    const handle = await startUrlPlayback("https://example.com/song.mp3", undefined, starter, fetchImpl);
    handle.stop();

    expect(handle.target).toMatch(/pockedio-playback-.*\.mp3$/);
    expect(stopped).toBe(true);
  });

  it("starts music quietly under a DJ intro before handing off to full playback", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const stopped: string[] = [];
    const starter: ProcessStarter = (command, args): PlaybackHandle => {
      calls.push({ command, args });
      return {
        target: args.at(-1) ?? "",
        done: Promise.resolve({ ok: true, target: args.at(-1) ?? "", exitCode: 0, signal: null }),
        stop: () => {
          stopped.push(args.at(-1) ?? "");
        }
      };
    };
    const runner: ProcessRunner = async (command, args) => {
      calls.push({ command, args });
      return { ok: true, target: args.at(-1) ?? "", exitCode: 0, signal: null };
    };
    const fetchImpl: typeof fetch = async () => new Response("audio-bytes", {
      status: 200,
      headers: { "content-type": "audio/mpeg" }
    });

    const handle = await startDuckedUrlWithIntro("https://example.com/song.mp3", "/tmp/intro.wav", {
      starter,
      runner,
      fetchImpl
    });

    expect(calls.map((call) => call.args)).toEqual([
      ["-v", "0.18", expect.stringMatching(/pockedio-playback-.*\.mp3$/)],
      ["/tmp/intro.wav"],
      [expect.stringMatching(/pockedio-playback-.*\.mp3$/)]
    ]);
    expect(stopped[0]).toMatch(/pockedio-playback-.*\.mp3$/);
    expect(handle.target).toMatch(/pockedio-playback-.*\.mp3$/);
    expect(handle.introResult).toMatchObject({ ok: true, target: "/tmp/intro.wav" });
  });
});
