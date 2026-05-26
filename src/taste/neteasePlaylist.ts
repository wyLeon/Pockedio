import type { PockedioConfig } from "../config/schema.js";
import type { TasteImportRow } from "./csv.js";
import { importTasteRows, type TasteImportResult } from "./importTaste.js";

type FetchLike = typeof fetch;

type NetEasePlaylistTrackResponse = {
  playlist?: {
    name?: unknown;
  };
  songs?: NetEaseSong[];
};

type NetEaseSong = {
  id?: unknown;
  name?: unknown;
  ar?: unknown;
  artists?: unknown;
  al?: unknown;
  album?: unknown;
};

type NetEaseNamedValue = {
  name?: unknown;
};

export function extractNetEasePlaylistId(input: string): string {
  const trimmed = input.trim();
  if (/^\d+$/.test(trimmed)) {
    return trimmed;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed.replace("#/", ""));
  } catch {
    throw new Error("Paste a NetEase playlist link or playlist ID.");
  }

  if (!parsed.pathname.includes("playlist")) {
    throw new Error("Paste a NetEase playlist link or playlist ID. Profile links are not needed for taste setup.");
  }

  const id = parsed.searchParams.get("id");
  if (!id || !/^\d+$/.test(id)) {
    throw new Error("NetEase playlist link is missing a numeric playlist id.");
  }
  return id;
}

export async function importTasteFromNetEasePlaylist(
  input: string,
  config: PockedioConfig,
  fetchImpl: FetchLike = fetch
): Promise<TasteImportResult> {
  const playlistId = extractNetEasePlaylistId(input);
  const baseUrl = config.netease.baseUrl.replace(/\/$/, "");
  const url = `${baseUrl}/playlist/track/all?id=${encodeURIComponent(playlistId)}&limit=1000&offset=0`;
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`NetEase playlist import failed with HTTP ${response.status}.`);
  }

  const json = await response.json() as NetEasePlaylistTrackResponse;
  const rows = normalizeNetEasePlaylistRows(json, playlistId);
  if (rows.length === 0) {
    throw new Error("NetEase playlist did not return importable tracks.");
  }
  return importTasteRows(rows, `netease:playlist:${playlistId}`, config);
}

export function normalizeNetEasePlaylistRows(response: NetEasePlaylistTrackResponse, playlistId: string): TasteImportRow[] {
  const playlist = valueToString(response.playlist?.name) ?? `NetEase playlist ${playlistId}`;
  const songs = Array.isArray(response.songs) ? response.songs : [];
  const rows = songs.flatMap((song) => {
    const title = valueToString(song.name);
    if (!title) {
      return [];
    }

    return [{
      title,
      artist: normalizeArtists(song).join(", "),
      album: normalizeAlbum(song) ?? "",
      source: "netease",
      playlist,
      liked_at: "",
      providerTrackId: valueToString(song.id) ?? undefined
    }];
  });
  return dedupeNetEasePlaylistRows(rows);
}

function dedupeNetEasePlaylistRows(rows: TasteImportRow[]): TasteImportRow[] {
  const seen = new Set<string>();
  const deduped: TasteImportRow[] = [];
  for (const row of rows) {
    const key = [
      row.title,
      row.artist,
      row.album,
      row.playlist
    ].map((value) => value.trim().toLowerCase()).join("\u0000");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(row);
  }
  return deduped;
}

function normalizeArtists(song: NetEaseSong): string[] {
  const rawArtists = Array.isArray(song.ar) ? song.ar : Array.isArray(song.artists) ? song.artists : [];
  const artists = rawArtists
    .map((artist) => valueToString((artist as NetEaseNamedValue).name))
    .filter((name): name is string => Boolean(name));
  return artists.length > 0 ? artists : ["Unknown Artist"];
}

function normalizeAlbum(song: NetEaseSong): string | null {
  const album = isRecord(song.al) ? song.al : isRecord(song.album) ? song.album : undefined;
  return valueToString((album as NetEaseNamedValue | undefined)?.name);
}

function valueToString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (typeof value === "number") {
    return String(value);
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
