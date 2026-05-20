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

  it("uses descriptive music search queries for conversational fallback requests", async () => {
    const provider = new FakeProvider();
    const config = makeConfig();
    const llm = createLlmClient(config, {});

    await generateStation({
      request: "I want some Chinese traditional style pure music to help me meditation.",
      config,
      provider,
      llm
    });

    expect(provider.searches).toHaveLength(5);
    expect(provider.searches[0].keyword).toBe("Chinese traditional pure music meditation");
    expect(provider.searches.map((query) => query.keyword).join("\n")).not.toContain("Ryuichi Sakamoto");
    expect(provider.searches.map((query) => query.keyword).join("\n")).not.toContain("Miles Davis");
  });

  it("prefers quiet playable candidates over noisy top search results for meditation", async () => {
    const provider = new FakeProvider();
    provider.search = async (query: MusicSearchQuery, limit: number): Promise<MusicTrackCandidate[]> => {
      provider.searches.push(query);
      expect(limit).toBeGreaterThanOrEqual(5);
      return [
        {
          provider: "netease",
          providerTrackId: "noisy",
          title: "Chinese New Year",
          artists: ["AS-LHY"],
          album: "Festival"
        },
        {
          provider: "netease",
          providerTrackId: "calm",
          title: "古琴冥想",
          artists: ["Calm Artist"],
          album: "纯音乐"
        }
      ];
    };
    const config = makeConfig();
    const llm = createLlmClient(config, {});

    const station = await generateStation({
      request: "I want some Chinese traditional style pure music to help me meditation.",
      config,
      provider,
      llm
    });

    expect(station.tracks[0]).toMatchObject({
      title: "古琴冥想",
      artist: "Calm Artist",
      providerTrackId: "calm"
    });
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

  it("keeps provider promotion out of station planning prompts and rationales", async () => {
    const provider = new FakeProvider();
    let observedPrompt = "";
    const llm: StationLlmClient = {
      generateJson: async (prompt) => {
        observedPrompt = prompt;
        return {
          ok: true,
          value: {
            tracks: [
              { title: "A", artist: "Artist A", rationale: "网易云资源丰富，所以适合这个请求。" },
              { title: "B", artist: "Artist B", rationale: "网易云可搜到，平台资源方便。" },
              { title: "C", artist: "Artist C", rationale: "calm texture for the morning" },
              { title: "D", artist: "Artist D", rationale: "gentle pace" },
              { title: "E", artist: "Artist E", rationale: "soft landing" }
            ]
          }
        };
      },
      generateText: async () => ({ ok: false, errorCode: "llm_unavailable", error: "unused" })
    };

    const station = await generateStation({
      request: "give me something calm",
      config: makeConfig(),
      provider,
      llm
    });

    expect(observedPrompt).not.toContain("NetEase-searchable");
    expect(observedPrompt).toContain("Do not mention the music provider");
    expect(station.tracks[0].rationale).toBe("Fits the requested station.");
    expect(station.tracks[1].rationale).toBe("Fits the requested station.");
  });

  it("keeps generated rationales in English by default", async () => {
    const provider = new FakeProvider();
    const llm: StationLlmClient = {
      generateJson: async () => ({
        ok: true,
        value: {
          tracks: [
            { title: "A", artist: "Artist A", rationale: "这首歌适合放松。" },
            { title: "B", artist: "Artist B", rationale: "soft focus texture" },
            { title: "C", artist: "Artist C", rationale: "calm texture" },
            { title: "D", artist: "Artist D", rationale: "gentle pace" },
            { title: "E", artist: "Artist E", rationale: "soft landing" }
          ]
        }
      }),
      generateText: async () => ({ ok: false, errorCode: "llm_unavailable", error: "unused" })
    };

    const station = await generateStation({
      request: "我今天很累",
      config: makeConfig(),
      provider,
      llm
    });

    expect(station.tracks[0].rationale).toBe("Fits the requested station.");
    expect(station.tracks[1].rationale).toBe("soft focus texture");
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
