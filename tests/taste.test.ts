import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/load.js";
import { withDatabase } from "../src/db/database.js";
import { parseTasteCsv } from "../src/taste/csv.js";
import { importTaste, importTasteInput } from "../src/taste/importTaste.js";
import { extractNetEasePlaylistId, importTasteFromNetEasePlaylist, normalizeNetEasePlaylistRows } from "../src/taste/neteasePlaylist.js";
import { updateTasteProfile } from "../src/taste/profile.js";
import { generatedTasteProfileEnd, generatedTasteProfileStart, upsertGeneratedTasteProfileSection } from "../src/taste/tasteMarkdown.js";
import { runMigrations } from "../src/db/migrations.js";
import { MemoryStore } from "../src/memory/store.js";

const tempDirs: string[] = [];

function makeConfig() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "pockedio-taste-test-"));
  tempDirs.push(home);
  return loadConfig({ POCKEDIO_HOME: home });
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("taste import", () => {
  it("imports the normalized fixture with 3 tracks", () => {
    const config = makeConfig();
    const result = importTaste("tests/fixtures/taste-normalized.csv", config);

    expect(result.trackCount).toBe(3);
    expect(result.artists).toEqual(["Brian Eno", "Miles Davis", "Ryuichi Sakamoto"]);
    expect(result.playlists).toEqual(["ambient reset", "deep focus jazz", "late night piano"]);
  });

  it("fails when a required column is missing", () => {
    const invalidCsv = [
      "title,artist,album,source,playlist",
      "Blue in Green,Miles Davis,Kind of Blue,spotify,deep focus jazz"
    ].join("\n");

    expect(() => parseTasteCsv(invalidCsv)).toThrow("liked_at");
  });

  it("writes taste.md with artists, playlists, and imported tracks", () => {
    const config = makeConfig();
    const result = importTaste("tests/fixtures/taste-normalized.csv", config);
    const markdown = fs.readFileSync(result.tastePath, "utf8");

    expect(markdown).toContain("# Pockedio Taste");
    expect(markdown).toContain("## High-Confidence Artists");
    expect(markdown).toContain("- Ryuichi Sakamoto");
    expect(markdown).toContain("- deep focus jazz");
    expect(markdown).toContain("## Imported Tracks");
    expect(markdown).toContain("- Blue in Green - Miles Davis");
  });

  it("writes a taste_imports row", () => {
    const config = makeConfig();
    importTaste("tests/fixtures/taste-normalized.csv", config);

    const row = withDatabase(config, (db) => db.prepare(`
      SELECT source_file as sourceFile, track_count as trackCount
      FROM taste_imports
    `).get()) as { sourceFile: string; trackCount: number };

    expect(row.sourceFile).toBe("tests/fixtures/taste-normalized.csv");
    expect(row.trackCount).toBe(3);
  });

  it("merges additional imports without losing previous playlist signals or user notes", async () => {
    const config = makeConfig();
    importTaste("tests/fixtures/taste-normalized.csv", config);
    fs.appendFileSync(config.paths.taste, "\nUser note: keep rainy night piano.\n");

    const result = await importTasteInput("https://music.163.com/#/playlist?id=123456", config, async () => {
      return new Response(JSON.stringify({
        playlist: { name: "Sunday R&B" },
        songs: [
          {
            name: "Love Is A Verb",
            ar: [{ name: "John Mayer" }],
            al: { name: "Born and Raised" }
          }
        ]
      }), { status: 200 });
    });

    expect(result).toMatchObject({
      trackCount: 1,
      playlists: ["Sunday R&B"],
      profileStatus: "updated"
    });
  });

  it("automatically writes a generated taste profile after import", () => {
    const config = makeConfig();
    const result = importTaste("tests/fixtures/taste-normalized.csv", config);
    const markdown = fs.readFileSync(result.tastePath, "utf8");
    const snapshot = withDatabase(config, (db) => new MemoryStore(db).getLatestTasteProfileSnapshot());

    expect(result.profileStatus).toBe("updated");
    expect(markdown).toContain(generatedTasteProfileStart);
    expect(markdown).toContain("### Imported Library Anchors");
    expect(markdown).toContain("- Imported tracks: 3");
    expect(markdown).toContain("Artists: Brian Eno, Miles Davis, Ryuichi Sakamoto");
    expect(snapshot?.summary).toContain("Imported Library Anchors");
  });

  it("keeps previous imported tracks and notes after a second playlist import", async () => {
    const config = makeConfig();
    importTaste("tests/fixtures/taste-normalized.csv", config);
    fs.appendFileSync(config.paths.taste, "\nUser note: keep rainy night piano.\n");

    await importTasteInput("https://music.163.com/#/playlist?id=123456", config, async () => {
      return new Response(JSON.stringify({
        playlist: { name: "Sunday R&B" },
        songs: [
          {
            name: "Love Is A Verb",
            ar: [{ name: "John Mayer" }],
            al: { name: "Born and Raised" }
          }
        ]
      }), { status: 200 });
    });

    const markdown = fs.readFileSync(config.paths.taste, "utf8");
    expect(markdown).toContain("User note: keep rainy night piano.");
    expect(markdown).toContain("- Blue in Green - Miles Davis");
    expect(markdown).toContain("- Love Is A Verb - John Mayer");
    expect(markdown).toContain("- late night piano");
    expect(markdown).toContain("- Sunday R&B");

    const imports = withDatabase(config, (db) => db.prepare(`
      SELECT source_file as sourceFile, track_count as trackCount
      FROM taste_imports
      ORDER BY imported_at
    `).all()) as Array<{ sourceFile: string; trackCount: number }>;
    expect(imports).toEqual([
      { sourceFile: "tests/fixtures/taste-normalized.csv", trackCount: 3 },
      { sourceFile: "netease:playlist:123456", trackCount: 1 }
    ]);
  });

  it("extracts NetEase playlist IDs from pasted links", () => {
    expect(extractNetEasePlaylistId("https://music.163.com/#/playlist?id=123456")).toBe("123456");
    expect(extractNetEasePlaylistId("https://music.163.com/playlist?id=987654&userid=1")).toBe("987654");
    expect(extractNetEasePlaylistId("123456")).toBe("123456");
    expect(() => extractNetEasePlaylistId("https://music.163.com/#/user/home?id=123456")).toThrow("playlist");
  });

  it("imports a pasted NetEase playlist into taste.md", async () => {
    const config = makeConfig();
    const requestedUrls: string[] = [];
    const result = await importTasteFromNetEasePlaylist("https://music.163.com/#/playlist?id=123456", config, async (url) => {
      requestedUrls.push(String(url));
      return new Response(JSON.stringify({
        playlist: { name: "Late Night Piano" },
        songs: [
          {
            name: "Merry Christmas Mr. Lawrence",
            ar: [{ name: "Ryuichi Sakamoto" }],
            al: { name: "Merry Christmas Mr. Lawrence" }
          },
          {
            name: "An Ending (Ascent)",
            artists: [{ name: "Brian Eno" }],
            album: { name: "Apollo" }
          }
        ]
      }), { status: 200 });
    });

    expect(requestedUrls[0]).toBe("http://127.0.0.1:3000/playlist/track/all?id=123456&limit=1000&offset=0");
    expect(result.trackCount).toBe(2);
    expect(result.playlists).toEqual(["Late Night Piano"]);
    expect(result.artists).toEqual(["Brian Eno", "Ryuichi Sakamoto"]);

    const markdown = fs.readFileSync(result.tastePath, "utf8");
    expect(markdown).toContain("- Late Night Piano");
    expect(markdown).toContain("- Ryuichi Sakamoto");
    expect(markdown).toContain("- Merry Christmas Mr. Lawrence - Ryuichi Sakamoto");
    expect(markdown).toContain("- An Ending (Ascent) - Brian Eno");

    const row = withDatabase(config, (db) => db.prepare(`
      SELECT source_file as sourceFile, track_count as trackCount
      FROM taste_imports
    `).get()) as { sourceFile: string; trackCount: number };
    expect(row).toEqual({
      sourceFile: "netease:playlist:123456",
      trackCount: 2
    });
  });

  it("removes exact repeated songs from one NetEase playlist import", () => {
    const rows = normalizeNetEasePlaylistRows({
      playlist: { name: "Repeated Set" },
      songs: [
        {
          name: "Mercury",
          ar: [{ name: "VaVa" }],
          al: { name: "Album A" }
        },
        {
          name: "Mercury",
          ar: [{ name: "VaVa" }],
          al: { name: "Album A" }
        },
        {
          name: "Mercury",
          ar: [{ name: "VaVa" }],
          al: { name: "Live Version" }
        }
      ]
    }, "123456");

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.album)).toEqual(["Album A", "Live Version"]);
  });

  it("imports either a local taste CSV or a NetEase playlist link from one input helper", async () => {
    const config = makeConfig();
    const fileResult = await importTasteInput("tests/fixtures/taste-normalized.csv", config);

    expect(fileResult.trackCount).toBe(3);
    expect(fileResult.source).toBe("file");

    const playlistResult = await importTasteInput("https://music.163.com/#/playlist?id=999", config, async () => {
      return new Response(JSON.stringify({
        playlist: { name: "Morning Air" },
        songs: [{ name: "First Light", ar: [{ name: "Yiruma" }], al: { name: "Piano" } }]
      }), { status: 200 });
    });

    expect(playlistResult.trackCount).toBe(1);
    expect(playlistResult.source).toBe("netease_playlist");
    expect(playlistResult.playlists).toEqual(["Morning Air"]);
  });

  it("preserves user taste.md notes while replacing the generated profile block", () => {
    const original = [
      "# Pockedio Taste",
      "",
      "User note: keep this line.",
      "",
      generatedTasteProfileStart,
      "old generated text",
      generatedTasteProfileEnd
    ].join("\n");

    const updated = upsertGeneratedTasteProfileSection(original, "## Generated Taste Profile\n\n- new signal");

    expect(updated).toContain("User note: keep this line.");
    expect(updated).not.toContain("old generated text");
    expect(updated).toContain("- new signal");
  });

  it("updates generated taste profile from local feedback signals", () => {
    const config = makeConfig();
    runMigrations(config);
    fs.writeFileSync(config.paths.taste, "# Pockedio Taste\n\nUser note: do not overwrite me.\n");
    withDatabase(config, (db) => {
      const store = new MemoryStore(db);
      const sessionId = store.createSession("conversation", "play soft jazz");
      const trackId = store.addStationTrack(sessionId, {
        position: 1,
        title: "Blue in Green",
        artist: "Miles Davis",
        provider: "netease",
        providerTrackId: "blue",
        playbackStatus: "playing"
      });
      const feedbackId = store.addFeedback(sessionId, trackId, "favorite", "favorite this");
      store.addTasteSignal({
        sourceFeedbackId: feedbackId,
        trackId,
        signalType: "favorite",
        targetType: "track",
        targetValue: "Blue in Green - Miles Davis",
        weight: 5,
        context: { stationRequest: "play soft jazz" }
      });
    });

    const result = updateTasteProfile(config);
    const markdown = fs.readFileSync(config.paths.taste, "utf8");

    expect(result.signalCount).toBe(1);
    expect(markdown).toContain("User note: do not overwrite me.");
    expect(markdown).toContain(generatedTasteProfileStart);
    expect(markdown).toContain("Generated from imported taste and local listening feedback.");
    expect(markdown).toContain("track: Blue in Green - Miles Davis");
    const snapshot = withDatabase(config, (db) => new MemoryStore(db).getLatestTasteProfileSnapshot());
    expect(snapshot?.summary).toContain("Blue in Green");
  });
});
