import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/load.js";
import { playFile, playUrl, type ProcessRunner } from "../src/player/afplay.js";
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
});

describe("afplay adapter", () => {
  it("plays URLs through the process runner", async () => {
    const runner: ProcessRunner = async (command, args) => ({
      ok: true,
      target: args[0],
      exitCode: command === "afplay" ? 0 : 1,
      signal: null
    });

    await expect(playUrl("https://example.com/song.mp3", undefined, runner)).resolves.toEqual({
      ok: true,
      target: "https://example.com/song.mp3",
      exitCode: 0,
      signal: null
    });
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
});
