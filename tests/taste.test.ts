import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/load.js";
import { withDatabase } from "../src/db/database.js";
import { parseTasteCsv } from "../src/taste/csv.js";
import { importTaste } from "../src/taste/importTaste.js";
import { extractNetEasePlaylistId, importTasteFromNetEasePlaylist } from "../src/taste/neteasePlaylist.js";

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

  it("writes taste.md with artists and playlists", () => {
    const config = makeConfig();
    const result = importTaste("tests/fixtures/taste-normalized.csv", config);
    const markdown = fs.readFileSync(result.tastePath, "utf8");

    expect(markdown).toContain("# Pockedio Taste");
    expect(markdown).toContain("## High-Confidence Artists");
    expect(markdown).toContain("- Ryuichi Sakamoto");
    expect(markdown).toContain("- deep focus jazz");
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

    const row = withDatabase(config, (db) => db.prepare(`
      SELECT source_file as sourceFile, track_count as trackCount
      FROM taste_imports
    `).get()) as { sourceFile: string; trackCount: number };
    expect(row).toEqual({
      sourceFile: "netease:playlist:123456",
      trackCount: 2
    });
  });
});
