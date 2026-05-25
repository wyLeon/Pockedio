import fs from "node:fs";
import { createLlmClient } from "../llm/openaiClient.js";
import type { LlmClient } from "../llm/llmClient.js";
import type { PockedioConfig } from "../config/schema.js";
import { formatCalendarStateForPrompt } from "../context/calendar.js";
import type { PockedioContext } from "../context/contextBuilder.js";
import type { MusicProvider, MusicTrackCandidate, PlayableTrack } from "../providers/musicProvider.js";
import { NetEaseProvider } from "../providers/netease.js";
import { generatedTasteProfileEnd, generatedTasteProfileStart } from "../taste/tasteMarkdown.js";
import type { GeneratedStation, PlannedStationTrack, StationTrack } from "./stationTypes.js";

export type StationLlmClient = LlmClient;

export type GenerateStationInput = {
  request: string;
  config: PockedioConfig;
  context?: Partial<PockedioContext>;
  avoidTracks?: StationTrackIdentity[];
  provider?: MusicProvider;
  llm?: StationLlmClient;
  signal?: AbortSignal;
};

export type StationTrackIdentity = {
  title: string;
  artist: string;
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
  throwIfAborted(input.signal);
  const artistRequest = parseArtistStationRequest(input.request);
  if (artistRequest) {
    const artistTracks = await resolveArtistStation(artistRequest.artist, provider, input.signal);
    return {
      request: input.request,
      source: "fallback",
      tracks: artistTracks
    };
  }
  const tasteSummary = readTasteSummary(input.config.paths.taste, input.context?.tasteProfile?.summary);
  const plan = await planTracks(input, llm, tasteSummary);
  throwIfAborted(input.signal);
  const plannedTracks = applyTasteSignalConstraints(plan.tracks, input, tasteSummary);
  const avoidKeys = buildAvoidTrackKeys(input.avoidTracks ?? [], input.request);
  const usedKeys = new Set<string>();
  const tracks: StationTrack[] = [];
  for (const [index, track] of plannedTracks.entries()) {
    const resolved = await resolveTrack(track, index + 1, provider, input.request, avoidKeys, usedKeys, input.signal);
    tracks.push(resolved);
    usedKeys.add(normalizeSongKey(resolved.title, resolved.artist));
  }

  return {
    request: input.request,
    source: plan.source,
    tracks
  };
}

async function resolveArtistStation(artist: string, provider: MusicProvider, signal?: AbortSignal): Promise<StationTrack[]> {
  try {
    throwIfAborted(signal);
    const candidates = await provider.search({ keyword: artist }, 25);
    throwIfAborted(signal);
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
      throwIfAborted(signal);
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
  const llmResult = await llm.generateJson<StationJsonResponse>(prompt, stationSchema, { signal: input.signal });
  if (llmResult.ok) {
    const parsed = parseStationTracks(llmResult.value);
    if (parsed.length >= 5) {
      return { source: "llm", tracks: parsed.slice(0, 5) };
    }
  }

  return { source: "fallback", tracks: fallbackTracksWithTasteSignals(input.request, tasteSummary, input.context?.tasteSignals ?? []) };
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
    `Generated taste profile: ${input.context?.tasteProfile?.summary ?? "No generated taste profile yet."}`,
    `Relevant DJ memories: ${formatMemorySummariesForPrompt(context?.memorySummaries ?? [])}`,
    `Avoid guidance from memory: ${formatMemoryAvoidGuidanceForPrompt(context?.memorySummaries ?? [])}`,
    formatStationLocalTimeContext(context),
    `Calendar summary: ${context?.calendar?.summary ?? "not available"}`,
    `Calendar listening hint: ${context?.calendar?.listeningHint ?? "not available"}`,
    formatCalendarStateForPrompt(context?.calendar?.state),
    `Weather summary: ${context?.weather?.summary ?? "not available"}`,
    `Weather listening hint: ${context?.weather?.listeningHint ?? "not available"}`,
    `Diary summary: ${context?.diary?.summary ?? "not available"}`,
    `Diary listening hint: ${context?.diary?.listeningHint ?? "not available"}`,
    `Personality profile: ${JSON.stringify(context?.personality ?? input.config.personality)}`,
    `Recent feedback/session summary: ${JSON.stringify(context?.recentSessions ?? [])}`,
    `Taste feedback signals: ${formatTasteSignalsForPrompt(context?.tasteSignals ?? [])}`,
    `Recently played tracks to avoid unless explicitly requested: ${formatAvoidTracksForPrompt(input.avoidTracks ?? [])}`,
    "Return only JSON."
  ].join("\n");
}

function formatStationLocalTimeContext(context: GenerateStationInput["context"]): string {
  if (!context?.timeOfDay && !context?.now) {
    return "Local time context: not available. Do not invent a specific daypart unless the user states one.";
  }
  const parts = [
    context.timeOfDay ? `device-local daypart=${context.timeOfDay}` : "",
    context.now ? `timestamp=${context.now}` : ""
  ].filter(Boolean).join(", ");
  return `Local time context: ${parts}. Treat the device-local daypart as authoritative; do not choose or describe tracks as morning, evening, or night if it conflicts.`;
}

function formatTasteSignalsForPrompt(signals: PockedioContext["tasteSignals"]): string {
  if (signals.length === 0) {
    return "No feedback-derived taste signals yet.";
  }
  return signals.slice(0, 12).map((signal) => [
    signal.signalType,
    signal.targetType,
    signal.targetValue,
    `weight ${signal.weight}`
  ].join(": ")).join(" | ");
}

function formatAvoidTracksForPrompt(tracks: StationTrackIdentity[]): string {
  if (tracks.length === 0) {
    return "No recent track exclusions.";
  }
  return tracks
    .slice(0, 25)
    .map((track) => `${track.title} - ${track.artist}`)
    .join(" | ");
}

function buildAvoidTrackKeys(tracks: StationTrackIdentity[], request = ""): Set<string> {
  return new Set(tracks
    .filter((track) => !isExplicitlyRequestedTrack(track, request))
    .map((track) => normalizeSongKey(track.title, track.artist)));
}

function isExplicitlyRequestedTrack(track: StationTrackIdentity, request: string): boolean {
  const normalizedRequest = normalizeComparableText(request);
  if (!normalizedRequest) {
    return false;
  }
  const title = normalizeComparableText(track.title);
  const artist = normalizeComparableText(track.artist);
  const label = normalizeComparableText(`${track.title} ${track.artist}`);
  return normalizedRequest.includes(label)
    || (title.length >= 4 && normalizedRequest.includes(title) && artist.length >= 4 && normalizedRequest.includes(artist));
}

function formatMemorySummariesForPrompt(summaries: PockedioContext["memorySummaries"]): string {
  if (summaries.length === 0) {
    return "No relevant DJ memories yet.";
  }
  return summaries.slice(0, 5).map((summary) => summary.content.replace(/\s+/g, " ").trim()).join(" | ");
}

function formatMemoryAvoidGuidanceForPrompt(summaries: PockedioContext["memorySummaries"]): string {
  const avoidTags = summaries
    .flatMap((summary) => metadataStringArray(summary.metadata, "avoidTags"))
    .filter(Boolean);
  if (avoidTags.length === 0) {
    return "No memory-derived avoid guidance.";
  }
  return [...new Set(avoidTags)].slice(0, 8).join(", ");
}

function metadataStringArray(metadata: unknown, key: string): string[] {
  if (!metadata || typeof metadata !== "object") {
    return [];
  }
  const value = (metadata as Record<string, unknown>)[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
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

function applyTasteSignalConstraints(
  tracks: PlannedStationTrack[],
  input: GenerateStationInput,
  tasteSummary: string
): PlannedStationTrack[] {
  const signals = input.context?.tasteSignals ?? [];
  const bannedArtists = new Set(signals
    .filter((signal) => signal.signalType === "ban" && signal.targetType === "artist")
    .map((signal) => normalizeComparableText(signal.targetValue)));
  const bannedTracks = new Set(signals
    .filter((signal) => signal.signalType === "ban" && signal.targetType === "track")
    .map((signal) => normalizeComparableText(signal.targetValue)));
  const filtered = tracks.filter((track) => {
    const artist = normalizeComparableText(track.artist);
    const trackLabel = normalizeComparableText(`${track.title} - ${track.artist}`);
    return !bannedArtists.has(artist) && !bannedTracks.has(trackLabel);
  });

  if (filtered.length >= 5) {
    return filtered.slice(0, 5);
  }

  const fallback = fallbackTracksWithTasteSignals(input.request, tasteSummary, signals)
    .filter((track) => !bannedArtists.has(normalizeComparableText(track.artist)))
    .filter((track) => !bannedTracks.has(normalizeComparableText(`${track.title} - ${track.artist}`)));
  const seen = new Set(filtered.map((track) => normalizeSongKey(track.title, track.artist)));
  for (const track of fallback) {
    const key = normalizeSongKey(track.title, track.artist);
    if (seen.has(key)) {
      continue;
    }
    filtered.push(track);
    seen.add(key);
    if (filtered.length >= 5) {
      break;
    }
  }

  return filtered.slice(0, 5);
}

function fallbackTracksWithTasteSignals(
  request: string,
  tasteSummary: string,
  signals: NonNullable<PockedioContext["tasteSignals"]>
): PlannedStationTrack[] {
  const positiveSeeds = signals
    .filter((signal) => signal.weight > 0 && (signal.signalType === "positive_seed" || signal.signalType === "favorite" || signal.signalType === "vibe_preset"))
    .filter((signal) => signal.targetType === "track" || signal.targetType === "artist" || signal.targetType === "vibe")
    .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))
    .map((signal) => signal.targetValue)
    .slice(0, 3);
  if (positiveSeeds.length === 0) {
    return fallbackTracks(request, tasteSummary);
  }
  const base = fallbackSearchQueries(request, tasteSummary);
  const queries = [...positiveSeeds.map((seed) => `${normalizeRequestForSearch(request)} ${seed}`.trim()), ...base];
  return queries.slice(0, 5).map((query) => ({
    title: query,
    artist: providerSearchArtist,
    rationale: `Uses recent taste feedback while staying with "${request}".`
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
  request: string,
  avoidKeys: Set<string>,
  usedKeys: Set<string>,
  signal?: AbortSignal
): Promise<StationTrack> {
  const keyword = track.artist === providerSearchArtist ? track.title : `${track.title} ${track.artist}`.trim();
  try {
    throwIfAborted(signal);
    const candidates = await provider.search({ keyword }, shouldUseStrictQuietScoring(request) || avoidKeys.size > 0 || usedKeys.size > 0 ? 10 : 1);
    throwIfAborted(signal);
    if (candidates.length === 0) {
      return unavailableStationTrack(track, position, "No provider search result.");
    }
    const resolved = await resolveBestPlayableCandidate(track, position, candidates, provider, request, avoidKeys, usedKeys, signal);
    if (resolved) {
      return resolved;
    }
    const firstCandidate = candidates[0];
    const playable = await provider.getPlayableUrl(firstCandidate.providerTrackId);
    throwIfAborted(signal);
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
  request: string,
  avoidKeys: Set<string>,
  usedKeys: Set<string>,
  signal?: AbortSignal
): Promise<StationTrack | null> {
  if (!shouldUseStrictQuietScoring(request)) {
    let repeatedFallback: { candidate: MusicTrackCandidate; playable: PlayableTrack } | null = null;
    for (const candidate of candidates) {
      throwIfAborted(signal);
      const playable = await provider.getPlayableUrl(candidate.providerTrackId);
      throwIfAborted(signal);
      const key = normalizeSongKey(candidate.title, candidate.artists.join(", "));
      if (!playable.available) {
        continue;
      }
      if (avoidKeys.has(key) || usedKeys.has(key)) {
        repeatedFallback ??= { candidate, playable };
        continue;
      }
      return stationTrackFromCandidate(planned, position, candidate, playable);
    }
    return repeatedFallback ? stationTrackFromCandidate(planned, position, repeatedFallback.candidate, repeatedFallback.playable) : null;
  }

  let best: { candidate: MusicTrackCandidate; playable: PlayableTrack; score: number } | null = null;
  let repeatedFallback: { candidate: MusicTrackCandidate; playable: PlayableTrack; score: number } | null = null;
  for (const candidate of candidates) {
    throwIfAborted(signal);
    const playable = await provider.getPlayableUrl(candidate.providerTrackId);
    throwIfAborted(signal);
    if (!playable.available) {
      continue;
    }
    const score = scoreCandidateForRequest(candidate, request);
    const key = normalizeSongKey(candidate.title, candidate.artists.join(", "));
    if (avoidKeys.has(key) || usedKeys.has(key)) {
      if (!repeatedFallback || score > repeatedFallback.score) {
        repeatedFallback = { candidate, playable, score };
      }
      continue;
    }
    if (!best || score > best.score) {
      best = { candidate, playable, score };
    }
  }

  if (best) {
    return stationTrackFromCandidate(planned, position, best.candidate, best.playable);
  }
  return repeatedFallback ? stationTrackFromCandidate(planned, position, repeatedFallback.candidate, repeatedFallback.playable) : null;
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

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    const error = new Error("Station generation was cancelled.");
    error.name = "AbortError";
    throw error;
  }
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

function readTasteSummary(tastePath: string, generatedTasteProfile?: string): string {
  if (generatedTasteProfile?.trim()) {
    return generatedTasteProfile.trim();
  }
  if (!fs.existsSync(tastePath)) {
    return "No taste.md signals yet.";
  }
  const markdown = fs.readFileSync(tastePath, "utf8");
  const generated = extractGeneratedTasteProfile(markdown);
  if (generated) {
    return generated;
  }
  return markdown.split(/\r?\n/).slice(0, 80).join("\n");
}

function extractGeneratedTasteProfile(markdown: string): string | null {
  const pattern = new RegExp(`${escapeRegExp(generatedTasteProfileStart)}\\s*([\\s\\S]*?)\\s*${escapeRegExp(generatedTasteProfileEnd)}`);
  return markdown.match(pattern)?.[1]?.trim() || null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractTasteSeeds(tasteSummary: string): string[] {
  const seeds = tasteSummary
    .split(/\r?\n/)
    .map((line) => line.match(/^- (.+)$/)?.[1]?.trim())
    .filter((value): value is string => {
      if (!value || value === "No signals yet.") {
        return false;
      }
      return !value.startsWith("Imported tracks:") && !value.startsWith("Sources:");
    })
    .flatMap((value) => {
      const match = value.match(/^(?:Artists|Playlists|Track anchors):\s*(.+)$/);
      return match ? match[1].split(",").map((seed) => seed.trim()).filter(Boolean) : [value];
    });
  return [...new Set(seeds)].slice(0, 5);
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
