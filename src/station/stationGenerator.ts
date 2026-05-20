import fs from "node:fs";
import { createLlmClient } from "../llm/openaiClient.js";
import type { LlmClient } from "../llm/llmClient.js";
import type { PockedioConfig } from "../config/schema.js";
import type { PockedioContext } from "../context/contextBuilder.js";
import type { MusicProvider, MusicTrackCandidate, PlayableTrack } from "../providers/musicProvider.js";
import { NetEaseProvider } from "../providers/netease.js";
import type { GeneratedStation, PlannedStationTrack, StationTrack } from "./stationTypes.js";

export type StationLlmClient = LlmClient;

export type GenerateStationInput = {
  request: string;
  config: PockedioConfig;
  context?: Partial<PockedioContext>;
  provider?: MusicProvider;
  llm?: StationLlmClient;
};

type StationJsonResponse = {
  tracks?: unknown;
};

type StationJsonTrack = {
  title?: unknown;
  artist?: unknown;
  rationale?: unknown;
};

type TrackPlan = {
  source: GeneratedStation["source"];
  tracks: PlannedStationTrack[];
};

const stationSchema = "{ tracks: [{ title: string, artist: string, rationale: string }] }";
const providerSearchArtist = "__provider_search__";

export async function generateStation(input: GenerateStationInput): Promise<GeneratedStation> {
  const provider = input.provider ?? new NetEaseProvider(input.config);
  const llm = input.llm ?? createLlmClient(input.config);
  const artistRequest = parseArtistStationRequest(input.request);
  if (artistRequest) {
    const artistTracks = await resolveArtistStation(artistRequest.artist, provider);
    return {
      request: input.request,
      source: "fallback",
      tracks: artistTracks
    };
  }
  const tasteSummary = readTasteSummary(input.config.paths.taste);
  const plan = await planTracks(input, llm, tasteSummary);
  const tracks = await Promise.all(plan.tracks.map((track, index) => resolveTrack(track, index + 1, provider, input.request)));

  return {
    request: input.request,
    source: plan.source,
    tracks
  };
}

async function resolveArtistStation(artist: string, provider: MusicProvider): Promise<StationTrack[]> {
  try {
    const candidates = await provider.search({ keyword: artist }, 25);
    const tracks: StationTrack[] = [];
    const seen = new Set<string>();

    for (const candidate of candidates) {
      if (!candidateMatchesArtist(candidate, artist)) {
        continue;
      }

      const key = normalizeSongKey(candidate.title, candidate.artists.join(", "));
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);

      const playable = await provider.getPlayableUrl(candidate.providerTrackId);
      if (!playable.available) {
        continue;
      }

      tracks.push(stationTrackFromCandidate({
        title: candidate.title,
        artist: candidate.artists.join(", "),
        rationale: `selected from ${artist}'s catalog`
      }, tracks.length + 1, candidate, playable));
      if (tracks.length >= 5) {
        break;
      }
    }

    return tracks.length > 0
      ? tracks
      : [unavailableStationTrack({
          title: artist,
          artist,
          rationale: `selected from ${artist}'s catalog`
        }, 1, `No matching playable tracks found for ${artist}.`)];
  } catch (error) {
    return [unavailableStationTrack({
      title: artist,
      artist,
      rationale: `selected from ${artist}'s catalog`
    }, 1, error instanceof Error ? error.message : String(error))];
  }
}

function parseArtistStationRequest(request: string): { artist: string } | null {
  const text = request.trim().replace(/[.!?。！？]+$/g, "");
  const match = text.match(/^(?:please\s+)?(?:play|put on|queue|start)\s+(?:some\s+)?(?:songs|tracks|music)\s+(?:from|by)\s+(.+)$/i)
    ?? text.match(/^(?:please\s+)?(?:i\s+)?(?:want|wanna|would like|need)\s+to\s+(?:listen to|listen|hear|play)\s+(?:some\s+)?(?:songs|tracks|music)\s+(?:from|by)\s+(.+)$/i)
    ?? text.match(/^(?:播放|放点|来点|我想听|想听)(.+?)(?:的)?(?:歌|歌曲|音乐)$/);
  const artist = match?.[1]?.trim();
  return artist ? { artist } : null;
}

function candidateMatchesArtist(candidate: MusicTrackCandidate, requestedArtist: string): boolean {
  const requested = normalizeComparableText(requestedArtist);
  return candidate.artists.some((artist) => normalizeComparableText(artist) === requested);
}

function normalizeSongKey(title: string, artist: string): string {
  return `${normalizeComparableText(title)}::${normalizeComparableText(artist)}`;
}

function normalizeComparableText(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

async function planTracks(
  input: GenerateStationInput,
  llm: StationLlmClient,
  tasteSummary: string
): Promise<TrackPlan> {
  const prompt = buildStationPrompt(input, tasteSummary);
  const llmResult = await llm.generateJson<StationJsonResponse>(prompt, stationSchema);
  if (llmResult.ok) {
    const parsed = parseStationTracks(llmResult.value);
    if (parsed.length >= 5) {
      return { source: "llm", tracks: parsed.slice(0, 5) };
    }
  }

  return { source: "fallback", tracks: fallbackTracks(input.request, tasteSummary) };
}

function buildStationPrompt(input: GenerateStationInput, tasteSummary: string): string {
  const context = input.context;
  return [
    "Create exactly five track plans for Pockedio.",
    "Default output language is English.",
    "Choose real, findable songs with real artists.",
    "Do not mention the music provider, searchability, catalog size, availability, resources, or platform convenience in rationales.",
    "Rationales should explain musical fit, mood, user taste, context, or station arc only.",
    `User request: ${input.request}`,
    `Taste summary: ${tasteSummary}`,
    `Time context: ${context?.timeOfDay ?? "unknown"} ${context?.now ?? ""}`.trim(),
    `Calendar summary: ${context?.calendar?.summary ?? "not available"}`,
    `Weather summary: ${context?.weather?.summary ?? "not available"}`,
    `Diary summary: ${context?.diary?.summary ?? "not available"}`,
    `Personality profile: ${JSON.stringify(context?.personality ?? input.config.personality)}`,
    `Recent feedback/session summary: ${JSON.stringify(context?.recentSessions ?? [])}`,
    "Return only JSON."
  ].join("\n");
}

function parseStationTracks(value: StationJsonResponse): PlannedStationTrack[] {
  if (!Array.isArray(value.tracks)) {
    return [];
  }

  return value.tracks.flatMap((item) => {
    const track = item as StationJsonTrack;
    const title = stringValue(track.title);
    const artist = stringValue(track.artist);
    if (!title || !artist) {
      return [];
    }
    return [{
      title,
      artist,
      rationale: cleanTrackRationale(stringValue(track.rationale))
    }];
  });
}

function cleanTrackRationale(rationale: string | null | undefined): string {
  const cleaned = rationale?.replace(/\s+/g, " ").trim();
  if (!cleaned || containsProviderPromotion(cleaned) || containsCjkText(cleaned)) {
    return "Fits the requested station.";
  }
  return cleaned;
}

function containsProviderPromotion(text: string): boolean {
  return /网易云(资源丰富|可搜到|曲库|平台|音乐库|资源)|NetEase|music provider|provider catalog|searchable|catalog size|availability|available on|can be found/i.test(text);
}

function containsCjkText(text: string): boolean {
  return /[\u3400-\u9fff]/.test(text);
}

function fallbackTracks(request: string, tasteSummary: string): PlannedStationTrack[] {
  const base = fallbackSearchQueries(request, tasteSummary);
  return Array.from({ length: 5 }, (_, index) => ({
    title: base[index % base.length],
    artist: providerSearchArtist,
    rationale: fallbackRationale(request, tasteSummary)
  }));
}

function fallbackRationale(request: string, tasteSummary: string): string {
  if (containsCjkText(request)) {
    return `Deterministic fallback using local taste signals${tasteSummary ? "." : " when LLM is unavailable."}`;
  }
  return `Deterministic fallback for "${request}" using local taste signals${tasteSummary ? "." : " when LLM is unavailable."}`;
}

async function resolveTrack(
  track: PlannedStationTrack,
  position: number,
  provider: MusicProvider,
  request: string
): Promise<StationTrack> {
  const keyword = track.artist === providerSearchArtist ? track.title : `${track.title} ${track.artist}`.trim();
  try {
    const candidates = await provider.search({ keyword }, shouldUseStrictQuietScoring(request) ? 10 : 1);
    if (candidates.length === 0) {
      return unavailableStationTrack(track, position, "No provider search result.");
    }
    const resolved = await resolveBestPlayableCandidate(track, position, candidates, provider, request);
    if (resolved) {
      return resolved;
    }
    const firstCandidate = candidates[0];
    const playable = await provider.getPlayableUrl(firstCandidate.providerTrackId);
    return stationTrackFromCandidate(track, position, firstCandidate, playable);
  } catch (error) {
    return unavailableStationTrack(track, position, error instanceof Error ? error.message : String(error));
  }
}

async function resolveBestPlayableCandidate(
  planned: PlannedStationTrack,
  position: number,
  candidates: MusicTrackCandidate[],
  provider: MusicProvider,
  request: string
): Promise<StationTrack | null> {
  if (!shouldUseStrictQuietScoring(request)) {
    const candidate = candidates[0];
    const playable = await provider.getPlayableUrl(candidate.providerTrackId);
    return stationTrackFromCandidate(planned, position, candidate, playable);
  }

  let best: { candidate: MusicTrackCandidate; playable: PlayableTrack; score: number } | null = null;
  for (const candidate of candidates) {
    const playable = await provider.getPlayableUrl(candidate.providerTrackId);
    if (!playable.available) {
      continue;
    }
    const score = scoreCandidateForRequest(candidate, request);
    if (!best || score > best.score) {
      best = { candidate, playable, score };
    }
  }

  return best ? stationTrackFromCandidate(planned, position, best.candidate, best.playable) : null;
}

function shouldUseStrictQuietScoring(request: string): boolean {
  return /\b(meditation|meditate|calm|sleep|relax|deep work|focus|pure music|instrumental)\b/i.test(request);
}

function scoreCandidateForRequest(candidate: MusicTrackCandidate, request: string): number {
  const text = [
    candidate.title,
    candidate.artists.join(" "),
    candidate.album ?? ""
  ].join(" ").toLowerCase();
  let score = 0;

  for (const term of ["古琴", "古筝", "纯音乐", "冥想", "禅", "meditation", "healing", "instrumental", "ambient", "calm", "relax"]) {
    if (text.includes(term.toLowerCase())) {
      score += 4;
    }
  }
  for (const term of ["new year", "春节", "festival", "dj", "remix", "dance", "party", "edm", "live", "club"]) {
    if (text.includes(term.toLowerCase())) {
      score -= 6;
    }
  }
  if (/\b(chinese|traditional|guqin|guzheng|erhu)\b/i.test(request) && /古琴|古筝|古风|chinese|guqin|guzheng|erhu/.test(text)) {
    score += 3;
  }
  return score;
}

function stationTrackFromCandidate(
  planned: PlannedStationTrack,
  position: number,
  candidate: MusicTrackCandidate,
  playable: PlayableTrack
): StationTrack {
  return {
    position,
    title: candidate.title,
    artist: candidate.artists.join(", "),
    album: candidate.album,
    rationale: planned.rationale,
    provider: candidate.provider,
    providerTrackId: candidate.providerTrackId,
    playable
  };
}

function unavailableStationTrack(planned: PlannedStationTrack, position: number, reason: string): StationTrack {
  return {
    position,
    title: planned.title,
    artist: planned.artist,
    rationale: planned.rationale,
    provider: "netease",
    providerTrackId: null,
    playable: {
      available: false,
      provider: "netease",
      providerTrackId: "",
      reason
    }
  };
}

function readTasteSummary(tastePath: string): string {
  if (!fs.existsSync(tastePath)) {
    return "No taste.md signals yet.";
  }
  return fs.readFileSync(tastePath, "utf8").split(/\r?\n/).slice(0, 80).join("\n");
}

function extractTasteSeeds(tasteSummary: string): string[] {
  return tasteSummary
    .split(/\r?\n/)
    .map((line) => line.match(/^- (.+)$/)?.[1]?.trim())
    .filter((value): value is string => Boolean(value) && value !== "No signals yet.")
    .slice(0, 5);
}

function fallbackSearchQueries(request: string, tasteSummary: string): string[] {
  const normalized = normalizeRequestForSearch(request);
  if (/\b(chinese|traditional|guqin|guzheng|erhu|meditation)\b/i.test(request)) {
    return [
      "Chinese traditional pure music meditation",
      "古风 纯音乐 冥想",
      "古琴 纯音乐",
      "古筝 轻音乐",
      "Chinese guqin meditation music"
    ];
  }

  const seeds = extractTasteSeeds(tasteSummary);
  const base = normalized.length > 0 ? normalized : "calm focus music";
  return [
    base,
    `${base} instrumental`,
    `${base} calm`,
    `${base} focus`,
    seeds[0] ? `${base} ${seeds[0]}` : `${base} ambient`
  ];
}

function normalizeRequestForSearch(request: string): string {
  return request
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((word) => ![
      "i",
      "want",
      "need",
      "would",
      "like",
      "some",
      "to",
      "help",
      "me",
      "for",
      "please",
      "play",
      "listen",
      "hear",
      "style"
    ].includes(word.toLowerCase()))
    .join(" ")
    .trim();
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
