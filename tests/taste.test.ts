import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/load.js";
import { withDatabase } from "../src/db/database.js";
import { parseTasteCsv } from "../src/taste/csv.js";
import { importTaste } from "../src/taste/importTaste.js";

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
});
