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

  it("uses musical seeds from a generated taste profile for deterministic fallback", async () => {
    const provider = new FakeProvider();
    const config = makeConfig();
    fs.writeFileSync(config.paths.taste, [
      "# Pockedio Taste",
      "",
      "<!-- POCKEDIO:BEGIN GENERATED TASTE PROFILE -->",
      "## Generated Taste Profile",
      "",
      "### Imported Library Anchors",
      "- Imported tracks: 589",
      "- Artists: Keren Ann, Norah Jones",
      "- Sources: netease",
      "<!-- POCKEDIO:END GENERATED TASTE PROFILE -->",
      ""
    ].join("\n"));
    const llm = createLlmClient(config, {});

    await generateStation({
      request: "play late night piano",
      config,
      provider,
      llm
    });

    const queries = provider.searches.map((query) => query.keyword).join("\n");
    expect(queries).toContain("Keren Ann");
    expect(queries).not.toContain("Imported tracks");
    expect(queries).not.toContain("Sources:");
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

  it("passes feedback-derived taste signals into station planning", async () => {
    const provider = new FakeProvider();
    let observedPrompt = "";
    const llm: StationLlmClient = {
      generateJson: async (prompt) => {
        observedPrompt = prompt;
        return {
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
        };
      },
      generateText: async () => ({ ok: false, errorCode: "llm_unavailable", error: "unused" })
    };

    await generateStation({
      request: "build a calm focus station",
      config: makeConfig(),
      provider,
      llm,
      context: {
        now: "2026-05-24T06:05:00.000Z",
        timeOfDay: "afternoon",
        tasteProfile: {
          id: "profile-1",
          summary: "Generated profile says late-night piano is durable.",
          metadata: { signalCount: 3 },
          createdAt: "2026-05-21T00:00:00.000Z"
        },
        tasteSignals: [{
          id: "signal-1",
          sourceFeedbackId: "feedback-1",
          trackId: "track-1",
          signalType: "positive_seed",
          targetType: "track",
          targetValue: "Blue in Green - Miles Davis",
          weight: 3,
          context: { stationRequest: "play soft jazz" },
          createdAt: "2026-05-21T00:00:00.000Z"
        }],
        memorySummaries: [{
          id: "summary-1",
          sourceSessionId: "session-1",
          content: "Session memory summary:\n- Listening/taste signals: User likes patient winter piano.",
          metadata: { messageCount: 6 },
          createdAt: "2026-05-21T00:00:00.000Z"
        }]
      }
    });

    expect(observedPrompt).toContain("Taste feedback signals:");
    expect(observedPrompt).toContain("positive_seed: track: Blue in Green - Miles Davis: weight 3");
    expect(observedPrompt).toContain("Generated profile says late-night piano is durable.");
    expect(observedPrompt).toContain("Relevant DJ memories:");
    expect(observedPrompt).toContain("User likes patient winter piano.");
    expect(observedPrompt).toContain("Avoid guidance from memory:");
    expect(observedPrompt).toContain("Local time context: device-local daypart=afternoon");
    expect(observedPrompt).toContain("Treat the device-local daypart as authoritative");
    expect(observedPrompt).toContain("Calendar listening hint:");
    expect(observedPrompt).toContain("Diary listening hint:");
  });

  it("uses the generated taste profile block instead of raw top-of-file taste rows", async () => {
    const config = makeConfig();
    fs.writeFileSync(config.paths.taste, [
      "# Pockedio Taste",
      "",
      "## Imported Tracks",
      "",
      "- Top Raw Track - Should Not Drive Prompt",
      "",
      "<!-- POCKEDIO:BEGIN GENERATED TASTE PROFILE -->",
      "## Generated Taste Profile",
      "",
      "### Imported Library Anchors",
      "- Artists: Keren Ann, Norah Jones",
      "<!-- POCKEDIO:END GENERATED TASTE PROFILE -->",
      ""
    ].join("\n"));
    const provider = new FakeProvider();
    let observedPrompt = "";
    const llm: StationLlmClient = {
      generateJson: async (prompt) => {
        observedPrompt = prompt;
        return {
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
        };
      },
      generateText: async () => ({ ok: false, errorCode: "llm_unavailable", error: "unused" })
    };

    await generateStation({
      request: "play gentle jazz",
      config,
      provider,
      llm
    });

    expect(observedPrompt).toContain("Artists: Keren Ann, Norah Jones");
    expect(observedPrompt).not.toContain("Top Raw Track");
  });

  it("uses feedback signals in fallback searches and filters banned artists", async () => {
    const provider = new FakeProvider();
    const llm: StationLlmClient = {
      generateJson: async () => ({
        ok: true,
        value: {
          tracks: [
            { title: "Blocked A", artist: "Blocked Artist", rationale: "blocked" },
            { title: "Blocked B", artist: "Blocked Artist", rationale: "blocked" },
            { title: "Safe C", artist: "Safe Artist", rationale: "safe" },
            { title: "Safe D", artist: "Safe Artist", rationale: "safe" },
            { title: "Safe E", artist: "Safe Artist", rationale: "safe" }
          ]
        }
      }),
      generateText: async () => ({ ok: false, errorCode: "llm_unavailable", error: "unused" })
    };

    const station = await generateStation({
      request: "play soft focus",
      config: makeConfig(),
      provider,
      llm,
      context: {
        tasteSignals: [
          {
            id: "signal-1",
            sourceFeedbackId: "feedback-1",
            trackId: "track-1",
            signalType: "ban",
            targetType: "artist",
            targetValue: "Blocked Artist",
            weight: -999,
            context: null,
            createdAt: "2026-05-21T00:00:00.000Z"
          },
          {
            id: "signal-2",
            sourceFeedbackId: "feedback-2",
            trackId: "track-2",
            signalType: "favorite",
            targetType: "track",
            targetValue: "Blue in Green - Miles Davis",
            weight: 5,
            context: null,
            createdAt: "2026-05-21T00:00:00.000Z"
          }
        ]
      }
    });

    expect(station.tracks.map((track) => track.artist).join("\n")).not.toContain("Blocked Artist");
    expect(provider.searches.map((query) => query.keyword).join("\n")).toContain("Blue in Green - Miles Davis");
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

  it("builds artist-only requests from matching unique provider results", async () => {
    const provider = new FakeProvider();
    provider.search = async (query: MusicSearchQuery, limit: number): Promise<MusicTrackCandidate[]> => {
      provider.searches.push(query);
      expect(query.keyword).toBe("Sufjan Stevens");
      expect(limit).toBeGreaterThanOrEqual(20);
      return [
        { provider: "netease", providerTrackId: "a", title: "Chicago", artists: ["Sufjan Stevens"], album: "Illinois" },
        { provider: "netease", providerTrackId: "a-dup", title: "Chicago", artists: ["Sufjan Stevens"], album: "Illinois" },
        { provider: "netease", providerTrackId: "b", title: "Should Have Known Better", artists: ["Sufjan Stevens"], album: "Carrie & Lowell" },
        { provider: "netease", providerTrackId: "other", title: "Mystery of Love", artists: ["Other Artist"], album: "Cover" },
        { provider: "netease", providerTrackId: "c", title: "Fourth of July", artists: ["Sufjan Stevens"], album: "Carrie & Lowell" }
      ];
    };
    const llm: StationLlmClient = {
      generateJson: async () => ({ ok: false, errorCode: "llm_unavailable", error: "unused" }),
      generateText: async () => ({ ok: false, errorCode: "llm_unavailable", error: "unused" })
    };

    const station = await generateStation({
      request: "play songs by Sufjan Stevens",
      config: makeConfig(),
      provider,
      llm
    });

    expect(station.tracks.map((track) => `${track.title} - ${track.artist}`)).toEqual([
      "Chicago - Sufjan Stevens",
      "Should Have Known Better - Sufjan Stevens",
      "Fourth of July - Sufjan Stevens"
    ]);
  });

  it("dedupes Wang OK artist stations and filters unrelated search results", async () => {
    const provider = new FakeProvider();
    provider.search = async (query: MusicSearchQuery, limit: number): Promise<MusicTrackCandidate[]> => {
      provider.searches.push(query);
      expect(query.keyword).toBe("Wang OK");
      expect(limit).toBeGreaterThanOrEqual(20);
      return [
        { provider: "netease", providerTrackId: "before-spring", title: "Before spring ends", artists: ["Wang OK", "Duke Lee"], album: "Single" },
        { provider: "netease", providerTrackId: "before-spring-dup", title: "Before spring ends", artists: ["Wang OK", "Duke Lee"], album: "Single" },
        { provider: "netease", providerTrackId: "evening-wind", title: "晚风", artists: ["Copy", "BT07"], album: "Single" },
        { provider: "netease", providerTrackId: "light-chaser", title: "追光者", artists: ["汪苏泷"], album: "Single" },
        { provider: "netease", providerTrackId: "rainy-day", title: "雨天", artists: ["孙燕姿"], album: "Single" },
        { provider: "netease", providerTrackId: "another-wang-ok", title: "Another Wang OK Song", artists: ["Wang OK"], album: "Single" }
      ];
    };
    const llm: StationLlmClient = {
      generateJson: async () => ({ ok: false, errorCode: "llm_unavailable", error: "unused" }),
      generateText: async () => ({ ok: false, errorCode: "llm_unavailable", error: "unused" })
    };

    const station = await generateStation({
      request: "play songs by Wang OK",
      config: makeConfig(),
      provider,
      llm
    });

    expect(station.tracks.map((track) => `${track.title} - ${track.artist}`)).toEqual([
      "Before spring ends - Wang OK, Duke Lee",
      "Another Wang OK Song - Wang OK"
    ]);
  });
});
