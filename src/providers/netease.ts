import type { PockedioConfig } from "../config/schema.js";
import { readNetEaseCookie } from "../config/neteaseAuth.js";
import type { MusicProvider, MusicSearchQuery, MusicTrackCandidate, PlayableTrack } from "./musicProvider.js";

type FetchLike = typeof fetch;

type NetEaseArtist = {
  name?: unknown;
};

type NetEaseAlbum = {
  name?: unknown;
};

type NetEaseSong = {
  id?: unknown;
  name?: unknown;
  artists?: unknown;
  ar?: unknown;
  album?: unknown;
  al?: unknown;
};

type NetEaseSearchResponse = {
  result?: {
    songs?: NetEaseSong[];
  };
};

type NetEaseUrlItem = {
  id?: unknown;
  url?: unknown;
  type?: unknown;
  code?: unknown;
  time?: unknown;
  freeTrialInfo?: unknown;
};

type NetEaseUrlResponse = {
  data?: NetEaseUrlItem[];
};

export class NetEaseProvider implements MusicProvider {
  private readonly baseUrl: string;
  private readonly config: PockedioConfig;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(config: PockedioConfig, fetchImpl: FetchLike = fetch, timeoutMs = 10_000) {
    this.config = config;
    this.baseUrl = config.netease.baseUrl.replace(/\/$/, "");
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  async search(query: MusicSearchQuery, limit: number): Promise<MusicTrackCandidate[]> {
    const json = await this.getJson<NetEaseSearchResponse>(
      `/search?keywords=${encodeURIComponent(query.keyword)}&limit=${encodeURIComponent(String(limit))}`
    );
    const songs = Array.isArray(json.result?.songs) ? json.result.songs : [];
    return songs.flatMap((song) => {
      const id = valueToString(song.id);
      const title = valueToString(song.name);
      if (!id || !title) {
        return [];
      }

      return [{
        provider: "netease",
        providerTrackId: id,
        title,
        artists: normalizeArtists(song),
        album: normalizeAlbum(song)
      }];
    });
  }

  async getPlayableUrl(trackId: string): Promise<PlayableTrack> {
    const json = await this.getJson<NetEaseUrlResponse>(
      `/song/url/v1?id=${encodeURIComponent(trackId)}&level=${encodeURIComponent(this.config.netease.qualityLevel)}`
    );
    const item = Array.isArray(json.data) ? json.data[0] : undefined;
    const playableUrl = valueToString(item?.url);
    const code = valueToNumber(item?.code);
    const timeMs = valueToNumber(item?.time);

    if (!playableUrl) {
      return {
        available: false,
        provider: "netease",
        providerTrackId: trackId,
        reason: "NetEase returned no playable URL.",
        code
      };
    }

    if (isNetEasePreview(item, timeMs)) {
      return {
        available: false,
        provider: "netease",
        providerTrackId: trackId,
        reason: "NetEase returned a 30-second preview URL. Log in with an eligible account or choose another track.",
        code
      };
    }

    return {
      available: true,
      provider: "netease",
      providerTrackId: trackId,
      playableUrl,
      urlType: valueToString(item?.type)
    };
  }

  private async getJson<T>(path: string): Promise<T> {
    const url = this.withAccountParams(`${this.baseUrl}${path}`);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(url, { signal: controller.signal });
    } catch (error) {
      throw new Error(`NetEase request failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`NetEase request failed with HTTP ${response.status}.`);
    }

    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error("NetEase request returned invalid JSON.");
    }
  }

  private withAccountParams(rawUrl: string): string {
    const cookie = readNetEaseCookie(this.config);
    if (!cookie) {
      return rawUrl;
    }

    const url = new URL(rawUrl);
    url.searchParams.set("cookie", cookie);
    url.searchParams.set("os", "pc");
    return url.toString();
  }
}

function isNetEasePreview(item: NetEaseUrlItem | undefined, timeMs: number | null): boolean {
  return isRecord(item?.freeTrialInfo) || (timeMs !== null && timeMs > 0 && timeMs <= 45_000);
}

function normalizeArtists(song: NetEaseSong): string[] {
  const rawArtists = Array.isArray(song.artists) ? song.artists : Array.isArray(song.ar) ? song.ar : [];
  const artists = rawArtists
    .map((artist) => valueToString((artist as NetEaseArtist).name))
    .filter((name): name is string => Boolean(name));
  return artists.length > 0 ? artists : ["Unknown Artist"];
}

function normalizeAlbum(song: NetEaseSong): string | null {
  const album = isRecord(song.album) ? song.album : isRecord(song.al) ? song.al : undefined;
  return valueToString((album as NetEaseAlbum | undefined)?.name);
}

function valueToString(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  if (typeof value === "number") {
    return String(value);
  }
  return null;
}

function valueToNumber(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
