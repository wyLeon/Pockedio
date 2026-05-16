import fs from "node:fs";

const file = process.argv[2] || "spikes/fixtures/taste-normalized.csv";
const text = fs.readFileSync(file, "utf8").trim();
const [headerLine, ...lines] = text.split(/\r?\n/);
const headers = headerLine.split(",");
const required = ["title", "artist", "album", "source", "playlist", "liked_at"];

for (const key of required) {
  if (!headers.includes(key)) {
    throw new Error(`Missing required column: ${key}`);
  }
}

const rows = lines.map((line) => {
  const values = line.split(",");
  return Object.fromEntries(headers.map((header, index) => [header, values[index] || ""]));
});

const artists = [...new Set(rows.map((row) => row.artist))];
const sources = [...new Set(rows.map((row) => row.source))];
const playlists = [...new Set(rows.map((row) => row.playlist))];

console.log(JSON.stringify({
  ok: true,
  file,
  trackCount: rows.length,
  artists,
  sources,
  playlists,
  tasteDraft: `Early signal: ${artists.join(", ")} across ${playlists.join(", ")}.`,
}, null, 2));
