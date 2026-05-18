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

export async function generateStation(input: GenerateStationInput): Promise<GeneratedStation> {
  const provider = input.provider ?? new NetEaseProvider(input.config);
  const llm = input.llm ?? createLlmClient(input.config);
  const tasteSummary = readTasteSummary(input.config.paths.taste);
  const plan = await planTracks(input, llm, tasteSummary);
  const tracks = await Promise.all(plan.tracks.map((track, index) => resolveTrack(track, index + 1, provider)));

  return {
    request: input.request,
    source: plan.source,
    tracks
  };
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
    "Create exactly five NetEase-searchable track plans for Pockedio.",
    "Default output language is English.",
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
      rationale: stringValue(track.rationale) ?? "Fits the requested station."
    }];
  });
}

function fallbackTracks(request: string, tasteSummary: string): PlannedStationTrack[] {
  const base = fallbackSearchQueries(request, tasteSummary);
  return Array.from({ length: 5 }, (_, index) => ({
    title: base[index % base.length],
    artist: "NetEase search",
    rationale: fallbackRationale(request, tasteSummary)
  }));
}

function fallbackRationale(request: string, tasteSummary: string): string {
  return `Deterministic fallback for "${request}" using local taste signals${tasteSummary ? "." : " when LLM is unavailable."}`;
}

async function resolveTrack(track: PlannedStationTrack, position: number, provider: MusicProvider): Promise<StationTrack> {
  const keyword = track.artist === "NetEase search" ? track.title : `${track.title} ${track.artist}`.trim();
  try {
    const candidates = await provider.search({ keyword }, 1);
    const candidate = candidates[0];
    if (!candidate) {
      return unavailableStationTrack(track, position, "No provider search result.");
    }
    const playable = await provider.getPlayableUrl(candidate.providerTrackId);
    return stationTrackFromCandidate(track, position, candidate, playable);
  } catch (error) {
    return unavailableStationTrack(track, position, error instanceof Error ? error.message : String(error));
  }
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
