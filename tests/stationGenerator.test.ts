import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/load.js";
import { createLlmClient } from "../src/llm/openaiClient.js";
import type { MusicProvider, MusicSearchQuery, MusicTrackCandidate, PlayableTrack } from "../src/providers/musicProvider.js";
import { generateStation, type StationLlmClient } from "../src/station/stationGenerator.js";

function makeConfig() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "pockedio-station-test-"));
  const config = loadConfig({ POCKEDIO_HOME: home });
  fs.writeFileSync(config.paths.taste, [
    "# Pockedio Taste",
    "",
    "## High-Confidence Artists",
    "",
    "- Ryuichi Sakamoto",
    "- Miles Davis",
    "",
    "## Situational Playlists",
    "",
    "- late night piano",
    "- deep focus jazz",
    ""
  ].join("\n"));
  return config;
}

class FakeProvider implements MusicProvider {
  readonly searches: MusicSearchQuery[] = [];

  async search(query: MusicSearchQuery, _limit: number): Promise<MusicTrackCandidate[]> {
    this.searches.push(query);
    return [{
      provider: "netease",
      providerTrackId: `id-${this.searches.length}`,
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
      playableUrl: `https://example.com/${trackId}.mp3`,
      urlType: "mp3"
    };
  }
}

describe("generateStation", () => {
  it("returns five planned tracks from deterministic fallback when LLM is unavailable", async () => {
    const provider = new FakeProvider();
    const config = makeConfig();
    const llm = createLlmClient(config, {});

    const station = await generateStation({
      request: "play late night piano",
      config,
      provider,
      llm
    });

    expect(station.tracks).toHaveLength(5);
    expect(station.source).toBe("fallback");
    expect(provider.searches).toHaveLength(5);
    expect(station.tracks.every((track) => track.playable.available)).toBe(true);
  });

  it("uses LLM JSON plans when available", async () => {
    const provider = new FakeProvider();
    const llm: StationLlmClient = {
      generateJson: async () => ({
        ok: true,
        value: {
          tracks: [
            { title: "A", artist: "Artist A", rationale: "first" },
            { title: "B", artist: "Artist B", rationale: "second" },
            { title: "C", artist: "Artist C", rationale: "third" },
            { title: "D", artist: "Artist D", rationale: "fourth" },
            { title: "E", artist: "Artist E", rationale: "fifth" }
          ]
        }
      }),
      generateText: async () => ({ ok: false, errorCode: "llm_unavailable", error: "unused" })
    };

    const station = await generateStation({
      request: "build a calm focus station",
      config: makeConfig(),
      provider,
      llm
    });

    expect(station.source).toBe("llm");
    expect(provider.searches.map((query) => query.keyword)).toEqual([
      "A Artist A",
      "B Artist B",
      "C Artist C",
      "D Artist D",
      "E Artist E"
    ]);
  });

  it("keeps unavailable provider results in the station instead of throwing", async () => {
    const provider = new FakeProvider();
    provider.getPlayableUrl = async (trackId: string) => ({
      available: false,
      provider: "netease",
      providerTrackId: trackId,
      reason: "NetEase returned no playable URL.",
      code: 404
    });
    const llm: StationLlmClient = {
      generateJson: async () => ({ ok: false, errorCode: "llm_unavailable", error: "missing key" }),
      generateText: async () => ({ ok: false, errorCode: "llm_unavailable", error: "missing key" })
    };

    const station = await generateStation({
      request: "play ambient reset",
      config: makeConfig(),
      provider,
      llm
    });

    expect(station.tracks).toHaveLength(5);
    expect(station.tracks.every((track) => track.playable.available === false)).toBe(true);
  });
});
