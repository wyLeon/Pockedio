import readline from "node:readline/promises";
import { stdin as defaultInput, stdout as defaultOutput } from "node:process";
import fs from "node:fs";
import { loadConfig } from "../config/load.js";
import type { PockedioConfig } from "../config/schema.js";
import { buildContext, type PockedioContext } from "../context/contextBuilder.js";
import { runMigrations } from "../db/migrations.js";
import {
  formatDirectPlaybackConfirmation,
  formatDjAudioFallbackText,
  formatFeedbackConfirmation,
  formatStationIntro
} from "../dj/productVoice.js";
import { shouldUseSpokenDjAudio } from "../dj/voiceRules.js";
import { createLlmClient } from "../llm/openaiClient.js";
import type { LlmClient } from "../llm/llmClient.js";
import { MemoryStore, type FeedbackAction } from "../memory/store.js";
import {
  playFile as playAudioFile,
  playUrl as playAudioUrl,
  startDuckedUrlWithIntro,
  startUrlPlayback as startAudioUrlPlayback,
  type PlaybackHandle,
  type PlayerResult,
  type ProcessStarter
} from "../player/afplay.js";
import type { MusicProvider, MusicTrackCandidate, PlayableTrack } from "../providers/musicProvider.js";
import { NetEaseProvider } from "../providers/netease.js";
import { generateStation } from "../station/stationGenerator.js";
import type { GeneratedStation, StationTrack } from "../station/stationTypes.js";
import { synthesizeFishAudio as synthesizeFishAudioDefault, type FishAudioResult } from "../tts/fishAudio.js";
import { parseDeterministicIntent, parseIntent, type SessionIntent } from "./intent.js";

type OutputWriter = (text: string) => void;
type StatusDone = () => void;
type StatusWriter = (text: string) => StatusDone;
type StartUrlPlayback = (url: string) => Promise<PlaybackHandle>;
type StartDuckedIntroPlayback = (url: string, introFilePath: string) => Promise<PlaybackHandle>;
type NowProvider = () => Date;

type StoredPlaybackTrack = {
  dbId: string;
  track: StationTrack;
};

type PendingSingleTrackCandidate = {
  track: StationTrack;
};

type PendingSingleTrackSelection = {
  originalRequest: string;
  candidates: PendingSingleTrackCandidate[];
};

type PreparedDjIntro = GeneratedDjProgramIntro & {
  ready: true;
};

type DjIntroPreparation = {
  ready: false;
  promise: Promise<PreparedDjIntro | undefined>;
  intro?: PreparedDjIntro;
};

type DjProgramPlaybackState = {
  sessionId: string;
  requestText: string;
  station: GeneratedStation;
  llm: LlmClient;
  synthesize: (config: PockedioConfig, text: string) => Promise<FishAudioResult>;
  preparations: Map<number, DjIntroPreparation | PreparedDjIntro>;
};

export type InteractivePlaybackState = {
  station?: GeneratedStation;
  storedTracks?: StoredPlaybackTrack[];
  pendingStationRequest?: string;
  pendingStationOriginalRequest?: string;
  pendingSingleTrackSelection?: PendingSingleTrackSelection;
  currentIndex?: number;
  currentTrackId?: string;
  currentStartedAt?: Date;
  activePlayback?: PlaybackHandle;
  lastIntroPlaybackResult?: PlayerResult;
  djProgram?: DjProgramPlaybackState;
  startUrlPlayback?: StartUrlPlayback;
  startDuckedIntroPlayback?: StartDuckedIntroPlayback;
  writeOutput?: OutputWriter;
};

export type SessionTurnInput = {
  input: string;
  config?: PockedioConfig;
  sessionId?: string;
  endSession?: boolean;
  provider?: MusicProvider;
  llm?: LlmClient;
  buildContext?: (config: PockedioConfig) => Promise<Partial<PockedioContext>>;
  writeOutput?: OutputWriter;
  writeStatus?: StatusWriter;
  playUrl?: (url: string) => Promise<PlayerResult>;
  startUrlPlayback?: StartUrlPlayback;
  playbackState?: InteractivePlaybackState;
  now?: NowProvider;
  playFile?: (filePath: string) => Promise<PlayerResult>;
  startDuckedIntroPlayback?: StartDuckedIntroPlayback;
  synthesizeFishAudio?: (config: PockedioConfig, text: string) => Promise<FishAudioResult>;
};

export type SessionTurnResult = {
  sessionId: string;
  intent: SessionIntent;
  response: string;
  shouldExit: boolean;
  station?: GeneratedStation;
  djAudio?: FishAudioResult;
};

export function createDefaultInteractiveStartUrlPlayback(
  starter?: ProcessStarter,
  fetchImpl?: typeof fetch
): StartUrlPlayback {
  return (url) => startAudioUrlPlayback(url, undefined, starter, fetchImpl);
}

export function formatInteractiveStartupGuide(displayName = "Pockedio"): string {
  return [
    `${displayName} is listening.`,
    "What are we tuning for?",
    "",
    "Try:",
    "  I'm exhausted and want something calm.",
    "  play something for deep work",
    "  what's playing?",
    "",
    "Controls:",
    "  next",
    "  stop",
    "  show queue",
    "",
    "Spoken DJ:",
    "  after a station suggestion, type dj",
    "",
    "Setup:",
    "  pockedio setup"
  ].join("\n");
}

export async function runSessionTurn(input: SessionTurnInput): Promise<SessionTurnResult> {
  const config = input.config ?? loadConfig();
  runMigrations(config);

  const provider = input.provider ?? new NetEaseProvider(config);
  const llm = input.llm ?? createLlmClient(config);
  const store = new MemoryStore(config);
  const writeOutput = input.writeOutput ?? (() => undefined);
  const playUrl = input.playUrl ?? ((url) => playAudioUrl(url));
  const startUrlPlayback = input.startUrlPlayback ?? createDefaultInteractiveStartUrlPlayback();
  const startDuckedIntroPlayback = input.startDuckedIntroPlayback ?? ((url, introFilePath) => startDuckedUrlWithIntro(url, introFilePath));
  const playFile = input.playFile ?? ((filePath) => playAudioFile(filePath, 60_000));
  const synthesize = input.synthesizeFishAudio ?? synthesizeFishAudioDefault;
  const writeStatus = input.writeStatus ?? (() => () => undefined);
  const now = input.now ?? (() => new Date());
  const userText = normalizeSessionInput(input.input);
  const sessionId = input.sessionId ?? store.createSession("conversation", userText);
  const shouldEndSession = input.endSession ?? !input.sessionId;
  if (input.playbackState) {
    input.playbackState.startUrlPlayback = input.startUrlPlayback
      ?? input.playbackState.startUrlPlayback
      ?? startUrlPlayback;
    input.playbackState.writeOutput = writeOutput;
    input.playbackState.startDuckedIntroPlayback = input.startDuckedIntroPlayback
      ?? input.playbackState.startDuckedIntroPlayback
      ?? startDuckedIntroPlayback;
  }

  try {
    store.addMessage(sessionId, "user", userText);
    const pendingSingleTrackCandidate = getPendingSingleTrackCandidate(input.playbackState, userText);
    let intent = pendingSingleTrackCandidate
        ? { type: "single_track_selection" as const, confidence: "high" as const }
      : input.playbackState?.pendingStationRequest && isPendingStationDjProgramRequest(userText)
        ? { type: "pending_station_dj_program" as const, confidence: "high" as const }
      : input.playbackState?.pendingStationRequest && isPendingStationConfirmation(input.input)
        ? { type: "pending_station_confirmation" as const, confidence: "high" as const }
      : input.playbackState?.pendingStationRequest && isPendingStationDecline(userText)
        ? { type: "pending_station_decline" as const, confidence: "high" as const }
        : await resolveIntent(userText, llm, writeStatus);
    if (input.playbackState?.currentTrackId && isCurrentTrackQuestion(userText) && isStationStartingIntent(intent.type)) {
      intent = { type: "conversation", confidence: "high" };
    }
    if (isMusicKnowledgeQuestion(userText) && !hasExplicitPlaybackCommand(userText) && (isStationStartingIntent(intent.type) || intent.type === "single_track_playback")) {
      intent = { type: "conversation", confidence: "high" };
    }

    if (input.playbackState?.currentTrackId && isCurrentTrackQuestion(userText)) {
      const response = formatCurrentTrackQuestionResponse(input.playbackState);
      store.addMessage(sessionId, "pockedio", response);
      writeOutput(response);
      return { sessionId, intent: { type: "conversation", confidence: "high" }, response, shouldExit: false };
    }

    if (intent.type === "single_track_selection" && pendingSingleTrackCandidate) {
      input.playbackState!.pendingSingleTrackSelection = undefined;
      input.playbackState!.pendingStationRequest = undefined;
      input.playbackState!.pendingStationOriginalRequest = undefined;
      const playback = await handleSingleTrackStart({
        config,
        sessionId,
        store,
        track: pendingSingleTrackCandidate.track,
        writeStatus,
        playUrl,
        startUrlPlayback,
        playbackState: input.playbackState,
        now
      });
      store.addMessage(sessionId, "pockedio", playback.response);
      writeOutput(playback.response);
      return { sessionId, intent, response: playback.response, shouldExit: false };
    }

    if (intent.type === "pending_station_decline") {
      if (input.playbackState) {
        input.playbackState.pendingStationRequest = undefined;
        input.playbackState.pendingStationOriginalRequest = undefined;
      }
      const response = "No problem. We can keep talking, or you can point me toward a different mood.";
      store.addMessage(sessionId, "pockedio", response);
      writeOutput(response);
      return { sessionId, intent, response, shouldExit: false };
    }

    if (intent.type === "pause") {
      if (input.playbackState?.activePlayback) {
        stopActivePlayback(input.playbackState, store);
      }
      const response = "Paused. Resume is not available yet; ask for the next track or a new station when you are ready.";
      store.addMessage(sessionId, "pockedio", response);
      writeOutput(response);
      return { sessionId, intent, response, shouldExit: false };
    }

    if (intent.type === "stop") {
      if (input.playbackState?.activePlayback) {
        input.playbackState.activePlayback.stop();
        if (input.playbackState.currentTrackId) {
          store.updateTrackPlayback(input.playbackState.currentTrackId, "skipped");
        }
        input.playbackState.activePlayback = undefined;
      }
      const response = "Stopping cleanly.";
      store.addMessage(sessionId, "pockedio", response);
      writeOutput(response);
      return { sessionId, intent, response, shouldExit: true };
    }

    if (isFeedbackIntent(intent.type)) {
      const action = feedbackActionForIntent(intent.type);
      store.addFeedback(sessionId, input.playbackState?.currentTrackId ?? null, action, userText);
      const response = intent.type === "feedback_skip" && input.playbackState?.station
        ? await advancePlayback(input.playbackState, config, store, input.playbackState.startUrlPlayback ?? startUrlPlayback)
        : formatFeedbackConfirmation(action);
      store.addMessage(sessionId, "pockedio", response);
      writeOutput(response);
      return { sessionId, intent, response, shouldExit: false };
    }

    if (isMidStationDjModeRequest(userText, input.playbackState)) {
      const response = formatMidStationDjModeResponse(config);
      store.addMessage(sessionId, "pockedio", response);
      writeOutput(response);
      return { sessionId, intent: { type: "conversation", confidence: "high" }, response, shouldExit: false };
    }

    if (intent.type === "playback_status") {
      const response = formatPlaybackStatus(input.playbackState, now());
      store.addMessage(sessionId, "pockedio", response);
      writeOutput(response);
      return { sessionId, intent, response, shouldExit: false };
    }

    if (intent.type === "identity_capability") {
      const response = await withStatus(writeStatus, "Thinking...", () => generateIdentityCapabilityResponse({ config, llm, userText }));
      store.addMessage(sessionId, "pockedio", response);
      writeOutput(response);
      return { sessionId, intent, response, shouldExit: false };
    }

    if (intent.type === "explicit_dj_audio_request") {
      const response = await withStatus(writeStatus, "Preparing DJ voice...", () => generateDjAudioResponse({ config, sessionId, store, llm, userText, synthesize, playFile }));
      store.addMessage(sessionId, "pockedio", response.text);
      writeOutput(response.text);
      return { sessionId, intent, response: response.text, shouldExit: false, djAudio: response.djAudio };
    }

    if (intent.type === "pending_station_confirmation" && input.playbackState?.pendingStationRequest) {
      const pendingRequest = input.playbackState.pendingStationRequest;
      input.playbackState.pendingStationRequest = undefined;
      input.playbackState.pendingStationOriginalRequest = undefined;
      const playback = await handlePlaybackRequest({
        config,
        sessionId,
        store,
        provider,
        llm,
        requestText: pendingRequest,
        intentType: "playback_request",
        buildContext: input.buildContext,
        writeStatus,
        playUrl,
        startUrlPlayback,
        playbackState: input.playbackState,
        now
      });
      store.addMessage(sessionId, "pockedio", playback.response);
      writeOutput(playback.response);
      return { sessionId, intent, response: playback.response, shouldExit: false, station: playback.station };
    }

    if (intent.type === "pending_station_dj_program" && input.playbackState?.pendingStationRequest) {
      const pendingRequest = input.playbackState.pendingStationRequest;
      input.playbackState.pendingStationRequest = undefined;
      input.playbackState.pendingStationOriginalRequest = undefined;
      const playback = await handlePlaybackRequest({
        config,
        sessionId,
        store,
        provider,
        llm,
        requestText: pendingRequest,
        intentType: "playback_request",
        buildContext: input.buildContext,
        writeStatus,
        playUrl,
        startUrlPlayback,
        playbackState: input.playbackState,
        now,
        djProgramIntro: true,
        synthesize,
        playFile,
        startDuckedIntroPlayback
      });
      store.addMessage(sessionId, "pockedio", playback.response);
      writeOutput(playback.response);
      return { sessionId, intent, response: playback.response, shouldExit: false, station: playback.station };
    }

    if (input.playbackState?.pendingStationRequest && shouldHandlePendingStationFollowup(intent, userText)) {
      const response = await withStatus(writeStatus, "Thinking...", () => handlePendingStationFollowup({
        config,
        llm,
        userText,
        playbackState: input.playbackState!
      }));
      store.addMessage(sessionId, "pockedio", response);
      writeOutput(response);
      return {
        sessionId,
        intent: { type: "pending_station_refinement", confidence: "high" },
        response,
        shouldExit: false
      };
    }

    if (intent.type === "music_recommendation") {
      const context = await withStatus(writeStatus, "Reading your context...", () => (input.buildContext ?? buildContext)(config));
      store.addContextSnapshot(sessionId, {
        calendarSummary: context.calendar?.summary,
        weather: context.weather,
        diarySummary: context.diary?.summary,
        personality: context.personality ?? config.personality
      });
      const response = await generateMusicRecommendationResponse({ config, llm, userText, playbackState: input.playbackState, context });
      if (input.playbackState) {
        input.playbackState.pendingStationRequest = userText;
        input.playbackState.pendingStationOriginalRequest = userText;
      }
      store.addMessage(sessionId, "pockedio", response);
      writeOutput(response);
      return { sessionId, intent, response, shouldExit: false };
    }

    if (intent.type === "single_track_playback") {
      if (input.playbackState) {
        input.playbackState.pendingStationRequest = undefined;
        input.playbackState.pendingStationOriginalRequest = undefined;
      }
      const playback = await handleSingleTrackRequest({
        config,
        sessionId,
        store,
        provider,
        requestText: userText,
        writeStatus,
        playUrl,
        startUrlPlayback,
        playbackState: input.playbackState,
        now
      });
      store.addMessage(sessionId, "pockedio", playback.response);
      writeOutput(playback.response);
      return { sessionId, intent, response: playback.response, shouldExit: false };
    }

    if (intent.type === "playback_request" || intent.type === "direct_playback_request") {
      if (input.playbackState) {
        input.playbackState.pendingStationRequest = undefined;
        input.playbackState.pendingStationOriginalRequest = undefined;
      }
      const playback = await handlePlaybackRequest({
        config,
        sessionId,
        store,
        provider,
        llm,
        requestText: userText,
        intentType: intent.type,
        buildContext: input.buildContext,
        writeStatus,
        playUrl,
        startUrlPlayback,
        playbackState: input.playbackState,
        now,
        synthesize,
        playFile,
        startDuckedIntroPlayback
      });
      store.addMessage(sessionId, "pockedio", playback.response);
      writeOutput(playback.response);

      if (shouldUseSpokenDjAudio({ triggerType: "normal_playback", userExplicitlyRequestedDjAudio: false })) {
        await synthesize(config, playback.response);
      }

      return { sessionId, intent, response: playback.response, shouldExit: false, station: playback.station };
    }

    const response = await generateConversationResponse({ config, llm, userText, playbackState: input.playbackState });
    store.addMessage(sessionId, "pockedio", response);
    writeOutput(response);
    return { sessionId, intent, response, shouldExit: false };
  } finally {
    if (shouldEndSession) {
      store.endSession(sessionId);
    }
    store.close();
  }
}

function normalizeSessionInput(input: string): string {
  return input.trim().replace(/^>\s*/, "").trim();
}

async function resolveIntent(userText: string, llm: LlmClient, writeStatus: StatusWriter): Promise<SessionIntent> {
  const deterministic = parseDeterministicIntent(userText);
  if (deterministic.confidence === "high" && isInstantLocalIntent(deterministic.type)) {
    return deterministic;
  }
  return withStatus(writeStatus, "Thinking...", () => parseIntent(userText, llm));
}

function isInstantLocalIntent(type: SessionIntent["type"]): boolean {
  return type === "stop"
    || type === "pause"
    || type === "playback_status"
    || type === "feedback_like"
    || type === "feedback_skip"
    || type === "feedback_ban"
    || type === "feedback_more_like_this"
    || type === "feedback_change_vibe"
    || type === "single_track_playback"
    || type === "single_track_selection";
}

async function withStatus<T>(writeStatus: StatusWriter, text: string, action: () => Promise<T>): Promise<T> {
  const done = writeStatus(text);
  try {
    return await action();
  } finally {
    done();
  }
}

function createInteractiveStatusWriter(output: typeof defaultOutput): StatusWriter {
  if (!output.isTTY) {
    return (text) => {
      output.write(`${text}\n`);
      return () => undefined;
    };
  }

  const frames = ["|", "/", "-", "\\"];
  return (text) => {
    let index = 0;
    const render = () => {
      output.write(`\r${frames[index % frames.length]} ${text}`);
      index += 1;
    };
    render();
    const timer = setInterval(render, 80);
    return () => {
      clearInterval(timer);
      output.write(`\r${" ".repeat(text.length + 4)}\r`);
    };
  };
}

async function handleSingleTrackRequest(input: {
  config: PockedioConfig;
  sessionId: string;
  store: MemoryStore;
  provider: MusicProvider;
  requestText: string;
  writeStatus: StatusWriter;
  playUrl: (url: string) => Promise<PlayerResult>;
  startUrlPlayback: StartUrlPlayback;
  playbackState?: InteractivePlaybackState;
  now: NowProvider;
}): Promise<{ response: string }> {
  const parsed = parseSingleTrackRequest(input.requestText);
  if (!parsed) {
    return { response: "I can play a specific song if you give me the title, or title and artist." };
  }

  const candidates = await withStatus(input.writeStatus, "Searching NetEase...", () => resolveSingleTrackCandidates({
    provider: input.provider,
    keyword: parsed.keyword,
    title: parsed.title,
    artist: parsed.artist
  }));
  if (candidates.length === 0) {
    return { response: `I couldn’t find a playable match for "${parsed.keyword}".` };
  }

  if (!parsed.artist && input.playbackState && candidates.length > 1) {
    input.playbackState.pendingSingleTrackSelection = {
      originalRequest: input.requestText,
      candidates: candidates.slice(0, 3).map((track) => ({ track }))
    };
    return { response: formatSingleTrackChoices(input.playbackState.pendingSingleTrackSelection) };
  }

  if (input.playbackState) {
    input.playbackState.pendingSingleTrackSelection = undefined;
  }

  return handleSingleTrackStart({
    config: input.config,
    sessionId: input.sessionId,
    store: input.store,
    track: candidates[0],
    writeStatus: input.writeStatus,
    playUrl: input.playUrl,
    startUrlPlayback: input.startUrlPlayback,
    playbackState: input.playbackState,
    now: input.now
  });
}

async function handleSingleTrackStart(input: {
  config: PockedioConfig;
  sessionId: string;
  store: MemoryStore;
  track: StationTrack;
  writeStatus: StatusWriter;
  playUrl: (url: string) => Promise<PlayerResult>;
  startUrlPlayback: StartUrlPlayback;
  playbackState?: InteractivePlaybackState;
  now: NowProvider;
}): Promise<{ response: string }> {
  const storedTrack = storeSingleTrack(input.sessionId, input.store, input.track, input.playbackState === undefined);
  let playbackFailure: string | undefined;
  let nowPlaying = "";

  if (input.playbackState) {
    input.playbackState.station = undefined;
    input.playbackState.djProgram = undefined;
    input.playbackState.storedTracks = [storedTrack];
    stopActivePlayback(input.playbackState, input.store);
    nowPlaying = await withStatus(input.writeStatus, "Starting playback...", () => startTrackAt(input.playbackState!, input.config, input.store, 0, input.startUrlPlayback, input.now));
  } else if (input.track.playable.available) {
    const playableUrl = input.track.playable.playableUrl;
    const playback = await withStatus(input.writeStatus, "Starting playback...", () => input.playUrl(playableUrl));
    if (!playback.ok) {
      playbackFailure = playback.error ?? "Playback failed.";
    } else {
      nowPlaying = formatTrackStartSurface(input.track, input.config, input.now(), input.now(), [{ dbId: "", track: input.track }], 0);
    }
  }

  return {
    response: [
      nowPlaying,
      playbackFailure ? `Playback detail: ${playbackFailure}` : ""
    ].filter(Boolean).join("\n")
  };
}

async function resolveSingleTrackCandidates(input: {
  provider: MusicProvider;
  keyword: string;
  title?: string;
  artist?: string;
}): Promise<StationTrack[]> {
  const candidates = await input.provider.search({ keyword: input.keyword }, 5);
  const resolved: StationTrack[] = [];
  for (const candidate of candidates) {
    const playable = await input.provider.getPlayableUrl(candidate.providerTrackId);
    if (!playable.available) {
      continue;
    }
    resolved.push(singleTrackFromCandidate(candidate, playable, input.title, input.artist));
    if (resolved.length >= 3) {
      break;
    }
  }
  return resolved;
}

function parseSingleTrackRequest(text: string): { keyword: string; title?: string; artist?: string } | null {
  const match = text.trim().match(/^(?:please\s+)?(?:play|put on|queue|start)\s+(.+)$/i)
    ?? text.trim().match(/^(?:please\s+)?(?:i\s+)?(?:want|wanna|would like|need)\s+to\s+(?:listen to|listen|hear|play)\s+(.+)$/i)
    ?? text.trim().match(/^(?:please\s+)?(?:listen to|hear)\s+(.+)$/i);
  if (!match) {
    return null;
  }

  const raw = match[1].replace(/[.!?]+$/g, "").trim();
  const titleArtist = raw.match(/^(.+?)\s+by\s+(.+)$/i);
  if (titleArtist) {
    const title = titleArtist[1].trim();
    const artist = titleArtist[2].trim();
    return { keyword: `${title} ${artist}`.trim(), title, artist };
  }

  return { keyword: raw, title: raw };
}

function singleTrackFromCandidate(
  candidate: MusicTrackCandidate,
  playable: PlayableTrack,
  requestedTitle?: string,
  requestedArtist?: string
): StationTrack {
  return {
    position: 1,
    title: candidate.title,
    artist: candidate.artists.join(", "),
    album: candidate.album,
    rationale: requestedArtist
      ? `you asked for ${requestedTitle ?? candidate.title} by ${requestedArtist}`
      : "you asked for this specific song",
    provider: candidate.provider,
    providerTrackId: candidate.providerTrackId,
    playable
  };
}

function storeSingleTrack(sessionId: string, store: MemoryStore, track: StationTrack, markAsPlaying: boolean): StoredPlaybackTrack {
  const dbId = store.addStationTrack(sessionId, {
    position: 1,
    title: track.title,
    artist: track.artist,
    album: track.album,
    provider: track.provider,
    providerTrackId: track.providerTrackId,
    playableUrl: track.playable.available ? track.playable.playableUrl : null,
    playbackStatus: markAsPlaying ? "playing" : "planned",
    failureReason: null
  });
  return { dbId, track };
}

function formatSingleTrackChoices(selection: PendingSingleTrackSelection): string {
  return [
    "I found a few close matches:",
    ...selection.candidates.map((candidate, index) => `${index + 1}. ${candidate.track.title} - ${candidate.track.artist}`),
    "",
    "Which one?"
  ].join("\n");
}

function getPendingSingleTrackCandidate(
  playbackState: InteractivePlaybackState | undefined,
  text: string
): PendingSingleTrackCandidate | undefined {
  const selection = playbackState?.pendingSingleTrackSelection;
  const match = text.trim().match(/^([1-3])$/);
  if (!selection || !match) {
    return undefined;
  }
  return selection.candidates[Number(match[1]) - 1];
}

async function handlePlaybackRequest(input: {
  config: PockedioConfig;
  sessionId: string;
  store: MemoryStore;
  provider: MusicProvider;
  llm: LlmClient;
  requestText: string;
  intentType: "playback_request" | "direct_playback_request";
  buildContext?: (config: PockedioConfig) => Promise<Partial<PockedioContext>>;
  writeStatus: StatusWriter;
  playUrl: (url: string) => Promise<PlayerResult>;
  startUrlPlayback: StartUrlPlayback;
  playbackState?: InteractivePlaybackState;
  now: NowProvider;
  djProgramIntro?: boolean;
  synthesize?: (config: PockedioConfig, text: string) => Promise<FishAudioResult>;
  playFile?: (filePath: string) => Promise<PlayerResult>;
  startDuckedIntroPlayback?: StartDuckedIntroPlayback;
}): Promise<{ response: string; station: GeneratedStation }> {
  const context = await withStatus(input.writeStatus, "Reading your context...", () => (input.buildContext ?? buildContext)(input.config));
  input.store.addContextSnapshot(input.sessionId, {
    calendarSummary: context.calendar?.summary,
    weather: context.weather,
    diarySummary: context.diary?.summary,
    personality: context.personality ?? input.config.personality
  });
  const station = await withStatus(input.writeStatus, "Building a station...", () => generateStation({
    request: input.requestText,
    config: input.config,
    context,
    provider: input.provider,
    llm: input.llm
  }));
  const storedTracks = storeStation(input.sessionId, input.store, station, input.playbackState === undefined);
  const firstPlayable = station.tracks.find((track) => track.playable.available);
  let playbackFailure: string | undefined;
  let nowPlaying = "";
  let djProgramIntro = "";
  let djProgramIntroAudio: GeneratedDjProgramIntro | undefined;
  let stationIntro = input.intentType === "direct_playback_request"
    ? formatDirectPlaybackConfirmation(station)
    : await generateStationIntroResponse({ config: input.config, llm: input.llm, userText: input.requestText, station, context });
  if (input.djProgramIntro && input.synthesize && input.playFile) {
    const intro = await withStatus(input.writeStatus, "Preparing DJ voice...", () => generateStationDjProgramIntro({
      config: input.config,
      sessionId: input.sessionId,
      store: input.store,
      llm: input.llm,
      station,
      requestText: input.requestText,
      synthesize: input.synthesize!,
      playFile: input.startDuckedIntroPlayback ? undefined : input.playFile!
    }));
    djProgramIntroAudio = intro;
    djProgramIntro = intro.audioPath && input.startDuckedIntroPlayback ? "" : intro.text;
  }
  if (input.playbackState) {
    input.playbackState.station = station;
    input.playbackState.storedTracks = storedTracks;
    input.playbackState.djProgram = input.djProgramIntro && input.synthesize
      ? {
          sessionId: input.sessionId,
          requestText: input.requestText,
          station,
          llm: input.llm,
          synthesize: input.synthesize,
          preparations: new Map()
        }
      : undefined;
    stopActivePlayback(input.playbackState, input.store);
    nowPlaying = await withStatus(input.writeStatus, "Starting playback...", () => startTrackAt(input.playbackState!, input.config, input.store, 0, input.startUrlPlayback, input.now, {
      intro: djProgramIntroAudio,
      startDuckedIntroPlayback: input.startDuckedIntroPlayback
    }));
    if (djProgramIntroAudio?.audioPath && input.playbackState.lastIntroPlaybackResult && !input.playbackState.lastIntroPlaybackResult.ok) {
      const introPlayback = input.playbackState.lastIntroPlaybackResult;
      if (introPlayback && !introPlayback.ok) {
        djProgramIntro = [
          djProgramIntro,
          `Playback detail: ${introPlayback.error ?? "DJ intro playback failed."}`
        ].join("\n");
      }
    }
  } else if (firstPlayable?.playable.available) {
    const playableUrl = firstPlayable.playable.playableUrl;
    const playback = await withStatus(input.writeStatus, "Starting playback...", () => input.playUrl(playableUrl));
    if (!playback.ok) {
      playbackFailure = playback.error ?? "Playback failed.";
    } else {
      nowPlaying = formatTrackStartSurface(firstPlayable, input.config, input.now(), input.now(), storedTracks, firstPlayable.position - 1);
    }
  } else if (input.intentType === "direct_playback_request") {
    stationIntro = formatUnavailableTrackFallbackForResponse(station.tracks);
  }

  const response = [
    djProgramIntro,
    stationIntro,
    input.playbackState ? "" : formatQueue(station),
    nowPlaying,
    formatUnavailableTrackFallbackForResponse(station.tracks),
    playbackFailure ? `Playback detail: ${playbackFailure}` : ""
  ].filter(Boolean).join("\n");

  return { response, station };
}

async function generateStationIntroResponse(input: {
  config: PockedioConfig;
  llm: LlmClient;
  userText: string;
  station: GeneratedStation;
  context: Partial<PockedioContext>;
}): Promise<string> {
  const totalTracks = input.station.tracks.length;
  const playableTracks = input.station.tracks.filter((track) => track.playable.available).length;
  const prompt = [
    `You are ${input.config.dj.displayName}, Pockedio's personal DJ.`,
    "Write a warm, concise station introduction for a CLI music session.",
    "Acknowledge the user's mood or request in human language before mentioning the station.",
    "Keep it to 2-3 sentences.",
    formatLanguageInstruction(input.config),
    "Do not say playback failed. Do not list the queue.",
    "Do not claim a different track count than the station facts below.",
    `User request: ${input.userText}`,
    `DJ style: ${input.config.dj.style}`,
    `DJ language: ${input.config.dj.language}`,
    `Station size: ${totalTracks} tracks total`,
    `Playable tracks: ${playableTracks}`,
    `Weather summary: ${input.context.weather?.summary ?? "not available"}`,
    `Diary summary: ${input.context.diary?.summary ?? "not available"}`
  ].join("\n");
  const result = await input.llm.generateText(prompt);
  if (isUsableGeneratedText(input.config, result)) {
    return result.value.trim();
  }

  return formatWarmStationIntro(input.station, input.userText);
}

function formatWarmStationIntro(station: GeneratedStation, userText: string): string {
  const playableCount = station.tracks.filter((track) => track.playable.available).length;
  if (/\b(exhausted|tired|grumpy|rough|stressed|sad|anxious|relax|relaxation|low mood)\b/i.test(userText)) {
    return `I hear the mood in that request, so I am keeping this station gentle and low-pressure. ${formatStationIntro(station)}`
      .replace("I built", "I made");
  }
  return formatStationIntro(station).replace("I built", "I made");
}

async function generateMusicRecommendationResponse(input: {
  config: PockedioConfig;
  llm: LlmClient;
  userText: string;
  playbackState?: InteractivePlaybackState;
  context?: Partial<PockedioContext>;
}): Promise<string> {
  const prompt = [
    `You are ${input.config.dj.displayName}, Pockedio's concise personal DJ.`,
    "The user is asking what they should listen to, but has not asked you to start playback.",
    "Recommend one clear listening direction in 2-4 sentences, tuned to their mood or context.",
    "End by asking whether they want you to build or play that station.",
    formatLanguageInstruction(input.config),
    "Do not claim playback has started.",
    `Weather summary: ${input.context?.weather?.summary ?? "not available"}`,
    `Diary summary: ${input.context?.diary?.summary ?? "not available"}`,
    formatConversationPlaybackContext(input.playbackState),
    `User: ${input.userText}`
  ].join("\n");
  const result = await input.llm.generateText(prompt);
  if (isUsableGeneratedText(input.config, result)) {
    return appendPendingStationChoicePrompt(result.value.trim());
  }

  return appendPendingStationChoicePrompt([
    "I can still help with the music, though my deeper conversation layer is offline right now.",
    "",
    "Want me to search directly from your request and build a five-track station?"
  ].join("\n"));
}

function isPendingStationConfirmation(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed === "") {
    return true;
  }
  return /^(yes|yeah|yep|sure|ok|okay)(\b|[,.! ]|$)/i.test(trimmed)
    || /\b(go ahead|play it|play that|start it|start the station|play the station)\b/i.test(trimmed);
}

function isPendingStationDecline(text: string): boolean {
  return /\b(no|nope|not now|don'?t|do not|skip it|leave it|not yet)\b/i.test(text);
}

function isPendingStationDjProgramRequest(text: string): boolean {
  const trimmed = text.trim().toLowerCase();
  return trimmed === "dj"
    || trimmed === "dj mode"
    || /\b(dj program|dj version|radio show|radio version|spoken version|play it as a dj|make it a dj)\b/.test(trimmed);
}

function isMidStationDjModeRequest(text: string, playbackState: InteractivePlaybackState | undefined): boolean {
  const normalized = text.trim().toLowerCase();
  return Boolean(playbackState?.currentTrackId)
    && !playbackState?.pendingStationRequest
    && (normalized === "dj" || normalized === "dj mode" || /\b(dj program|dj version|radio version|spoken version)\b/.test(normalized));
}

function formatMidStationDjModeResponse(config: PockedioConfig): string {
  return [
    "DJ mode is a before-playback choice.",
    `Let this station finish, or stop and ask ${config.dj.displayName} for a new DJ version.`
  ].join(" ");
}

function isCurrentTrackQuestion(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return /\b(who\s+(is|was|sings|sang)|who'?s)\b.*\b(singer|artist|performer|vocalist|composer|songwriter|producer)\b/.test(normalized)
    || /\b(singer|artist|performer|vocalist|composer|songwriter|producer)\b.*\b(who|what|which)\b/.test(normalized)
    || /\b(tell me|what do you know)\b.*\b(this song|this track|current song|current track)\b/.test(normalized);
}

function isMusicKnowledgeQuestion(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return /^(tell me about|can you tell me about|what do you know about|give me background on|what'?s the story behind|who is|who was)\b/.test(normalized)
    || /\b(background|story|history|meaning|origin|influence|influences)\b.*\b(song|track|album|artist|band|composer|singer|musician|producer)\b/.test(normalized);
}

function formatCurrentTrackQuestionResponse(playbackState: InteractivePlaybackState): string {
  const current = getCurrentPlaybackTrack(playbackState);
  if (!current) {
    return "Nothing is playing right now.";
  }
  return [
    `The current track is ${current.title} - ${current.artist}.`,
    `The listed artist is ${current.artist}.`
  ].join(" ");
}

function getCurrentPlaybackTrack(playbackState: InteractivePlaybackState): StationTrack | undefined {
  const currentIndex = playbackState.currentIndex;
  return currentIndex === undefined ? undefined : playbackState.storedTracks?.[currentIndex]?.track;
}

function isStationStartingIntent(type: SessionIntent["type"]): boolean {
  return type === "playback_request"
    || type === "direct_playback_request"
    || type === "single_track_playback"
    || type === "music_recommendation";
}

function shouldHandlePendingStationFollowup(intent: SessionIntent, userText: string): boolean {
  if (!userText.trim()) {
    return false;
  }
  if (intent.type === "stop"
    || intent.type === "pause"
    || intent.type === "playback_status"
    || intent.type === "identity_capability"
    || intent.type === "explicit_dj_audio_request"
    || intent.type === "single_track_playback"
    || intent.type === "single_track_selection"
    || intent.type === "pending_station_confirmation"
    || intent.type === "pending_station_dj_program"
    || intent.type === "pending_station_decline") {
    return false;
  }
  if ((intent.type === "playback_request" || intent.type === "direct_playback_request") && hasExplicitPlaybackCommand(userText)) {
    return false;
  }
  return true;
}

function hasExplicitPlaybackCommand(text: string): boolean {
  return /\b(play|put on|start|queue|just play|play it directly|start playback)\b/i.test(text);
}

async function handlePendingStationFollowup(input: {
  config: PockedioConfig;
  llm: LlmClient;
  userText: string;
  playbackState: InteractivePlaybackState;
}): Promise<string> {
  if (isPendingStationQuestion(input.userText)) {
    return answerPendingStationQuestion(input);
  }

  const previous = input.playbackState.pendingStationRequest ?? input.userText;
  const refined = mergePendingStationRequest(previous, input.userText);
  input.playbackState.pendingStationRequest = refined;
  input.playbackState.pendingStationOriginalRequest ??= previous;

  const prompt = [
    `You are ${input.config.dj.displayName}, Pockedio's concise personal DJ.`,
    "The user is refining a pending station before playback starts.",
    "Acknowledge the refinement in one short sentence.",
    "Then ask whether to play this version.",
    formatLanguageInstruction(input.config),
    "Do not claim playback started. Do not show a queue.",
    `Previous pending station: ${previous}`,
    `User refinement: ${input.userText}`
  ].join("\n");
  const result = await input.llm.generateText(prompt);
  if (isUsableGeneratedText(input.config, result)) {
    return appendPendingStationChoicePrompt(result.value.trim());
  }

  return appendPendingStationChoicePrompt(`Got it. I’ll shape it around: ${input.userText.trim()}.\n\nPlay this version?`);
}

function isPendingStationQuestion(text: string): boolean {
  return /\?$/.test(text.trim())
    || /^(what|why|how|which|would|could|can you explain|tell me)/i.test(text.trim());
}

async function answerPendingStationQuestion(input: {
  config: PockedioConfig;
  llm: LlmClient;
  userText: string;
  playbackState: InteractivePlaybackState;
}): Promise<string> {
  const pending = input.playbackState.pendingStationRequest ?? "";
  const prompt = [
    `You are ${input.config.dj.displayName}, Pockedio's concise personal DJ.`,
    "The user asked a question before confirming a pending station.",
    "Answer briefly and keep the pending station alive.",
    "End with a natural confirmation question, but do not use the fixed startup phrase.",
    formatLanguageInstruction(input.config),
    "Do not start playback. Do not show a queue.",
    `Pending station: ${pending}`,
    `User question: ${input.userText}`
  ].join("\n");
  const result = await input.llm.generateText(prompt);
  if (isUsableGeneratedText(input.config, result)) {
    return appendPendingStationChoicePrompt(result.value.trim());
  }

  return appendPendingStationChoicePrompt("I’d keep it close to the direction we just discussed, then adjust once the first track lands.\n\nPlay this version?");
}

function mergePendingStationRequest(previous: string, refinement: string): string {
  return `${previous}\nRefinement: ${refinement.trim()}`;
}

function appendPendingStationChoicePrompt(text: string): string {
  if (/press enter|type "dj"|type dj/i.test(text)) {
    return text;
  }
  return [
    text,
    "",
    "Press Enter to play it, type \"dj\" for a spoken DJ version, or tell me how to adjust it."
  ].join("\n");
}

function formatLanguageInstruction(config: PockedioConfig): string {
  return shouldUseEnglishOutput(config)
    ? "Reply in English, even if the user writes in another language. Preserve song titles and artist names as written."
    : `Reply in ${config.dj.language}. Preserve song titles and artist names as written.`;
}

function isUsableGeneratedText(config: PockedioConfig | undefined, result: { ok: true; value: string } | { ok: false }): result is { ok: true; value: string } {
  return result.ok && result.value.trim().length > 0 && isAllowedOutputLanguage(config, result.value);
}

function isAllowedOutputLanguage(config: PockedioConfig | undefined, text: string): boolean {
  if (!shouldUseEnglishOutput(config)) {
    return true;
  }
  return !containsCjkText(text);
}

function shouldUseEnglishOutput(config: PockedioConfig | undefined): boolean {
  const language = config?.dj.language.trim().toLowerCase() ?? "english";
  return language === "en" || language.startsWith("english");
}

function containsCjkText(text: string): boolean {
  return /[\u3400-\u9fff]/.test(text);
}

async function generateIdentityCapabilityResponse(input: {
  config: PockedioConfig;
  llm: LlmClient;
  userText: string;
}): Promise<string> {
  const displayName = input.config.dj.displayName;
  const prompt = [
    `You are ${displayName}, Pockedio's concise personal DJ in a terminal.`,
    "Answer the user's identity or capability question directly.",
    "Use the selected DJ name for identity questions.",
    "Mention real capabilities only: conversation, recommendations and stations, playback controls, queue/status, useful taste memory, and explicit spoken DJ audio.",
    "Mention memory carefully as useful taste signals, not remembering everything.",
    "Do not say you are an AI language model.",
    "Do not mention therapy disclaimers unless the user asks for mental-health support.",
    "Do not start playback.",
    "Do not end with the fixed startup phrase 'What are we tuning for?'",
    "Keep it to 1-3 concise sentences.",
    formatLanguageInstruction(input.config),
    `User: ${input.userText}`
  ].join("\n");
  const result = await input.llm.generateText(prompt);
  if (isUsableGeneratedText(input.config, result)) {
    return result.value.trim();
  }

  return [
    `${displayName} is here.`,
    "I can still build stations, play music, control playback, show the queue, and make spoken DJ audio if voice is configured.",
    "Deeper conversation and personal context may be limited until the LLM is available."
  ].join(" ");
}

async function generateConversationResponse(input: {
  config?: PockedioConfig;
  llm: LlmClient;
  userText: string;
  playbackState?: InteractivePlaybackState;
}): Promise<string> {
  if (!input.userText) {
    return "Tell me what you want to hear, or share what this music is bringing up.";
  }

  const prompt = formatConversationPrompt(input.userText, input.playbackState, input.config);
  const result = await input.llm.generateText(prompt);
  if (isUsableGeneratedText(input.config, result)) {
    return result.value.trim();
  }

  return formatConversationFallback(input.userText, input.playbackState, input.config);
}

function formatConversationPrompt(userText: string, playbackState: InteractivePlaybackState | undefined, config?: PockedioConfig): string {
  const displayName = config?.dj.displayName ?? "Pockedio";
  return [
    `You are ${displayName}, Pockedio's concise personal DJ in a text conversation.`,
    "The user may be sharing a personal memory, listening insight, mood, taste signal, or a question about the current music.",
    "Reply like a radio DJ who is listening carefully: acknowledge the user, connect it to music when useful, and stay brief.",
    config ? formatLanguageInstruction(config) : "Reply in English by default, even if the user writes in another language. Preserve song titles and artist names as written.",
    "Do not act as a therapist, diagnose the user, or give life advice.",
    "Do not claim spoken audio was generated. Do not change playback or promise queue edits unless the user explicitly asked for playback control.",
    formatConversationPlaybackContext(playbackState),
    `User: ${userText}`
  ].filter(Boolean).join("\n");
}

function formatConversationPlaybackContext(playbackState: InteractivePlaybackState | undefined): string {
  const storedTracks = playbackState?.storedTracks ?? [];
  const currentIndex = playbackState?.currentIndex;
  const current = currentIndex === undefined ? undefined : storedTracks[currentIndex]?.track;
  if (!current) {
    return "Current playback: none.";
  }

  return [
    `Current track: ${current.title} - ${current.artist}`,
    "Queue:",
    ...storedTracks.map((entry, index) => {
      const marker = index === currentIndex ? ">" : " ";
      return `${marker} ${entry.track.position}. ${entry.track.title} - ${entry.track.artist}`;
    })
  ].join("\n");
}

function formatConversationFallback(userText: string, playbackState: InteractivePlaybackState | undefined, config?: PockedioConfig): string {
  const displayName = config?.dj.displayName ?? "Pockedio";
  if (isCapabilityQuestion(userText)) {
    return [
      `${displayName} is here.`,
      "I can still build stations, play music, control playback, show the queue, and make spoken DJ audio if voice is configured.",
      "Deeper conversation and personal context may be limited until the LLM is available."
    ].join(" ");
  }

  const current = playbackState?.currentIndex === undefined
    ? undefined
    : playbackState.storedTracks?.[playbackState.currentIndex]?.track;
  if (current) {
    return `I hear that. I will keep ${current.title} - ${current.artist} in that personal context and let the set stay music-first.`;
  }
  if (isListeningPreferenceStatement(userText)) {
    return "I hear that. I will treat it as part of your listening taste, especially when you ask for a station later.";
  }
  return "I hear you. I can keep talking about the music, help shape a station, or respond to what this listening moment brings up.";
}

function isCapabilityQuestion(userText: string): boolean {
  const text = userText.toLowerCase();
  return /\b(who are you|who is talking|who'?s talking|what are you|what can you do|help|how do you work|what do you do|are you a real dj)\b/.test(text);
}

function isListeningPreferenceStatement(userText: string): boolean {
  const text = userText.toLowerCase();
  return /\b(i like|i love|i prefer|i realized|reminds me|this reminds|my taste|for reading|for focus|helps me|distracts me|too bright|too sharp|too busy|spacious|instrumental|vocals?)\b/.test(text);
}

export async function runInteractiveSession(config: PockedioConfig = loadConfig()): Promise<void> {
  const rl = readline.createInterface({ input: defaultInput, output: defaultOutput });
  rl.on("SIGINT", () => {
    rl.close();
  });
  runMigrations(config);
  const store = new MemoryStore(config);
  const sessionId = store.createSession("conversation", "interactive session");
  store.close();
  const playbackState: InteractivePlaybackState = {};
  const statusWriter = createInteractiveStatusWriter(defaultOutput);
  try {
    console.log(formatInteractiveStartupGuide(config.dj.displayName));
    while (true) {
      let line: string;
      try {
        line = await rl.question("> ");
      } catch (error) {
        if (error instanceof Error && error.message === "readline was closed") {
          break;
        }
        throw error;
      }
      const result = await runSessionTurn({
        input: line,
        config,
        sessionId,
        endSession: false,
        playbackState,
        writeOutput: (text) => console.log(text),
        writeStatus: statusWriter
      });
      if (result.shouldExit) {
        break;
      }
    }
  } finally {
    playbackState.activePlayback?.stop();
    const endStore = new MemoryStore(config);
    try {
      endStore.endSession(sessionId);
    } finally {
      endStore.close();
    }
    rl.close();
  }
}

function storeStation(
  sessionId: string,
  store: MemoryStore,
  station: GeneratedStation,
  markFirstPlayableAsPlaying: boolean
): StoredPlaybackTrack[] {
  const storedTracks: StoredPlaybackTrack[] = [];
  for (const track of station.tracks) {
    const dbId = store.addStationTrack(sessionId, {
      position: track.position,
      title: track.title,
      artist: track.artist,
      album: track.album,
      provider: track.provider,
      providerTrackId: track.providerTrackId,
      playableUrl: track.playable.available ? track.playable.playableUrl : null,
      playbackStatus: track.playable.available && markFirstPlayableAsPlaying && track.position === 1 ? "playing" : track.playable.available ? "planned" : "unavailable",
      failureReason: track.playable.available ? null : track.playable.reason
    });
    storedTracks.push({ dbId, track });
  }
  return storedTracks;
}

async function generateDjAudioResponse(input: {
  config: PockedioConfig;
  sessionId: string;
  store: MemoryStore;
  llm: LlmClient;
  userText: string;
  synthesize: (config: PockedioConfig, text: string) => Promise<FishAudioResult>;
  playFile: (filePath: string) => Promise<PlayerResult>;
}): Promise<{ text: string; djAudio: FishAudioResult }> {
  const textResult = await input.llm.generateText([
    "Write a concise spoken DJ segment.",
    formatLanguageInstruction(input.config),
    `User request: ${input.userText}`
  ].join("\n"));
  const text = isUsableGeneratedText(input.config, textResult) ? textResult.value : "I will keep this set focused and direct.";
  const shouldSpeak = shouldUseSpokenDjAudio({
    triggerType: "conversation",
    userExplicitlyRequestedDjAudio: true
  });
  const djAudio = shouldSpeak
    ? await input.synthesize(input.config, text)
    : { ok: false as const, latencyMs: 0, error: "Voice rules disabled DJ audio." };

  if (!djAudio.ok) {
    input.store.recordDjAudio(input.sessionId, "explicit", null, text, djAudio.audioPath ?? null, "text_fallback", {
      cacheExpiresAt: getExplicitDjAudioCacheExpiresAt(),
      latencyMs: djAudio.latencyMs
    });
    return { text: formatDjAudioFallbackText(text, djAudio.error), djAudio };
  }

  const playback = await input.playFile(djAudio.audioPath);
  input.store.recordDjAudio(input.sessionId, "explicit", null, text, djAudio.audioPath, playback.ok ? "played" : "failed", {
    cacheExpiresAt: getExplicitDjAudioCacheExpiresAt(),
    latencyMs: djAudio.latencyMs,
    fileSizeBytes: getFileSize(djAudio.audioPath)
  });
  return { text, djAudio };
}

async function generateStationDjProgramIntro(input: {
  config: PockedioConfig;
  sessionId: string;
  store: MemoryStore;
  llm: LlmClient;
  station: GeneratedStation;
  requestText: string;
  synthesize: (config: PockedioConfig, text: string) => Promise<FishAudioResult>;
  playFile?: (filePath: string) => Promise<PlayerResult>;
}): Promise<GeneratedDjProgramIntro> {
  const textResult = await input.llm.generateText([
    `You are ${input.config.dj.displayName}, Pockedio's spoken DJ.`,
    "Write a warm, concise opening for a five-track DJ program.",
    "Sound human and specific, but keep it under 70 words.",
    formatLanguageInstruction(input.config),
    "Mention the station direction and ease the listener into the first track.",
    "Do not list every track.",
    `User request: ${input.requestText}`,
    "Station tracks:",
    ...input.station.tracks.map((track) => `${track.position}. ${track.title} - ${track.artist}: ${track.rationale}`)
  ].join("\n"));
  const text = isUsableGeneratedText(input.config, textResult)
    ? textResult.value.trim()
    : `${input.config.dj.displayName} here. I’ll open this as a short DJ program and ease you into the first track with the station already shaped around your request.`;
  const djAudio = shouldUseSpokenDjAudio({
    triggerType: "conversation",
    userExplicitlyRequestedDjAudio: true
  })
    ? await input.synthesize(input.config, text)
    : { ok: false as const, latencyMs: 0, error: "Voice rules disabled DJ audio." };

  if (!djAudio.ok) {
    input.store.recordDjAudio(input.sessionId, "explicit", null, text, djAudio.audioPath ?? null, "text_fallback", {
      cacheExpiresAt: getExplicitDjAudioCacheExpiresAt(),
      latencyMs: djAudio.latencyMs
    });
    return { text: formatDjAudioFallbackText(text, djAudio.error), rawText: text };
  }

  if (!input.playFile) {
    return {
      text: [
        formatDjTranscriptLabel(input.config),
        text
      ].join("\n"),
      rawText: text,
      audioPath: djAudio.audioPath,
      latencyMs: djAudio.latencyMs,
      fileSizeBytes: getFileSize(djAudio.audioPath)
    };
  }

  const playback = await input.playFile(djAudio.audioPath);
  input.store.recordDjAudio(input.sessionId, "explicit", null, text, djAudio.audioPath, playback.ok ? "played" : "failed", {
    cacheExpiresAt: getExplicitDjAudioCacheExpiresAt(),
    latencyMs: djAudio.latencyMs,
    fileSizeBytes: getFileSize(djAudio.audioPath)
  });

  return {
    text: [
      formatDjTranscriptLabel(input.config),
      text,
      playback.ok ? "" : `Playback detail: ${playback.error ?? "DJ intro playback failed."}`
    ].filter(Boolean).join("\n"),
    rawText: text,
    audioPath: playback.ok ? undefined : djAudio.audioPath,
    latencyMs: djAudio.latencyMs,
    fileSizeBytes: getFileSize(djAudio.audioPath)
  };
}

type GeneratedDjProgramIntro = {
  text: string;
  rawText: string;
  audioPath?: string;
  latencyMs?: number;
  fileSizeBytes?: number | null;
};

function getExplicitDjAudioCacheExpiresAt(): string {
  return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
}

function getFileSize(filePath: string): number | null {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return null;
  }
}

function isFeedbackIntent(type: SessionIntent["type"]): boolean {
  return type.startsWith("feedback_");
}

function feedbackActionForIntent(type: SessionIntent["type"]): FeedbackAction {
  switch (type) {
    case "feedback_like":
      return "like";
    case "feedback_skip":
      return "skip";
    case "feedback_ban":
      return "ban";
    case "feedback_more_like_this":
      return "more_like_this";
    case "feedback_change_vibe":
      return "change_vibe";
    default:
      return "stop";
  }
}

function formatUnavailableTrackFallbackForResponse(tracks: StationTrack[]): string {
  return tracks.some((track) => !track.playable.available)
    ? `${tracks.filter((track) => !track.playable.available).length} unavailable track(s) kept in the station.`
    : "";
}

function stopActivePlayback(playbackState: InteractivePlaybackState, store: MemoryStore): void {
  if (!playbackState.activePlayback) {
    return;
  }
  playbackState.activePlayback.stop();
  if (playbackState.currentTrackId) {
    store.updateTrackPlayback(playbackState.currentTrackId, "skipped");
  }
  playbackState.activePlayback = undefined;
  playbackState.currentIndex = undefined;
  playbackState.currentTrackId = undefined;
  playbackState.currentStartedAt = undefined;
}

async function advancePlayback(
  playbackState: InteractivePlaybackState,
  config: PockedioConfig,
  store: MemoryStore,
  startUrlPlayback: StartUrlPlayback
): Promise<string> {
  playbackState.activePlayback?.stop();
  if (playbackState.currentTrackId) {
    store.updateTrackPlayback(playbackState.currentTrackId, "skipped");
  }
  const nextIndex = (playbackState.currentIndex ?? -1) + 1;
  return startTrackAt(playbackState, config, store, nextIndex, startUrlPlayback, () => new Date(), {
    intro: getPreparedDjIntro(playbackState, nextIndex),
    startDuckedIntroPlayback: playbackState.startDuckedIntroPlayback
  });
}

async function startTrackAt(
  playbackState: InteractivePlaybackState,
  config: PockedioConfig,
  store: MemoryStore,
  startIndex: number,
  startUrlPlayback: StartUrlPlayback,
  now: NowProvider,
  options: {
    intro?: GeneratedDjProgramIntro;
    startDuckedIntroPlayback?: StartDuckedIntroPlayback;
  } = {}
): Promise<string> {
  const storedTracks = playbackState.storedTracks ?? [];
  const nextIndex = storedTracks.findIndex((entry, index) => index >= startIndex && entry.track.playable.available);
  if (nextIndex === -1) {
    playbackState.currentIndex = undefined;
    playbackState.currentTrackId = undefined;
    playbackState.currentStartedAt = undefined;
    playbackState.activePlayback = undefined;
    return "No playable tracks remain.";
  }

  const entry = storedTracks[nextIndex];
  if (!entry.track.playable.available) {
    return "No playable tracks remain.";
  }

  const handle = options.intro?.audioPath && options.startDuckedIntroPlayback
    ? await options.startDuckedIntroPlayback(entry.track.playable.playableUrl, options.intro.audioPath)
    : await startUrlPlayback(entry.track.playable.playableUrl);
  playbackState.lastIntroPlaybackResult = handle.introResult;
  if (options.intro?.audioPath) {
    recordDjProgramIntroPlayback(store, playbackState.djProgram?.sessionId, options.intro, handle.introResult);
  }
  playbackState.currentIndex = nextIndex;
  playbackState.currentTrackId = entry.dbId;
  playbackState.currentStartedAt = now();
  playbackState.activePlayback = handle;
  prepareNextDjIntro(playbackState, config, nextIndex + 1);
  handle.done.then((result) => {
    if (playbackState.activePlayback !== handle || !result.ok) {
      return;
    }
    void autoAdvancePlayback(playbackState, config, entry.dbId, nextIndex + 1, startUrlPlayback);
  }).catch(() => undefined);
  store.updateTrackPlayback(entry.dbId, "playing");
  return [
    options.intro?.rawText ? formatDjTranscript(config, options.intro.rawText) : "",
    formatTrackStartSurface(entry.track, config, playbackState.currentStartedAt, now(), storedTracks, nextIndex)
  ].filter(Boolean).join("\n");
}

function formatDjTranscript(config: PockedioConfig, text: string): string {
  return [
    formatDjTranscriptLabel(config),
    text.trim()
  ].filter(Boolean).join("\n");
}

function formatDjTranscriptLabel(config: PockedioConfig): string {
  return `${config.dj.displayName}:`;
}

async function autoAdvancePlayback(
  playbackState: InteractivePlaybackState,
  config: PockedioConfig,
  completedTrackId: string,
  startIndex: number,
  startUrlPlayback: StartUrlPlayback
): Promise<void> {
  const store = new MemoryStore(config);
  try {
    store.updateTrackPlayback(completedTrackId, "played");
    const preparedIntro = getPreparedDjIntro(playbackState, startIndex);
    const response = await startTrackAt(playbackState, config, store, startIndex, startUrlPlayback, () => new Date(), {
      intro: preparedIntro,
      startDuckedIntroPlayback: playbackState.startDuckedIntroPlayback
    });
    if (response !== "No playable tracks remain.") {
      playbackState.writeOutput?.(response);
    } else if (playbackState.station) {
      playbackState.pendingStationRequest = playbackState.station.request;
      playbackState.pendingStationOriginalRequest = playbackState.station.request;
      playbackState.writeOutput?.(formatStationCompleteResponse());
    }
  } finally {
    store.close();
  }
}

function formatStationCompleteResponse(): string {
  return "That station’s done. Press Enter to continue this vibe, or tell me where to take it next.";
}

function prepareNextDjIntro(playbackState: InteractivePlaybackState, config: PockedioConfig, nextIndex: number): void {
  const program = playbackState.djProgram;
  const tracks = playbackState.storedTracks ?? [];
  const entry = tracks[nextIndex];
  if (!program || !entry?.track.playable.available || program.preparations.has(nextIndex)) {
    return;
  }

  const previous = nextIndex > 0 ? tracks[nextIndex - 1]?.track : undefined;
  const preparation: DjIntroPreparation = {
    ready: false,
    promise: generateTrackDjProgramIntro({
      config,
      llm: program.llm,
      station: program.station,
      requestText: program.requestText,
      track: entry.track,
      previousTrack: previous,
      synthesize: program.synthesize
    }).then((intro) => {
      if (!intro?.audioPath) {
        return undefined;
      }
      const readyIntro: PreparedDjIntro = { ...intro, ready: true };
      preparation.intro = readyIntro;
      program.preparations.set(nextIndex, readyIntro);
      return readyIntro;
    }).catch(() => undefined)
  };
  program.preparations.set(nextIndex, preparation);
}

function getPreparedDjIntro(playbackState: InteractivePlaybackState, trackIndex: number): PreparedDjIntro | undefined {
  const preparation = playbackState.djProgram?.preparations.get(trackIndex);
  if (!preparation) {
    return undefined;
  }
  return preparation.ready ? preparation : preparation.intro;
}

async function generateTrackDjProgramIntro(input: {
  config: PockedioConfig;
  llm: LlmClient;
  station: GeneratedStation;
  requestText: string;
  track: StationTrack;
  previousTrack?: StationTrack;
  synthesize: (config: PockedioConfig, text: string) => Promise<FishAudioResult>;
}): Promise<GeneratedDjProgramIntro | undefined> {
  const textResult = await input.llm.generateText([
    `You are ${input.config.dj.displayName}, Pockedio's spoken DJ.`,
    `Write a warm transition intro for Track ${input.track.position}: ${input.track.title} - ${input.track.artist}.`,
    "Keep it under 45 words.",
    formatLanguageInstruction(input.config),
    "Mention why this next track belongs here.",
    "Do not recap the full queue.",
    `User request: ${input.requestText}`,
    input.previousTrack ? `Previous track: ${input.previousTrack.title} - ${input.previousTrack.artist}` : "",
    `Next track rationale: ${input.track.rationale}`
  ].filter(Boolean).join("\n"));
  const text = isUsableGeneratedText(input.config, textResult)
    ? textResult.value.trim()
    : `${input.config.dj.displayName} here. Track ${input.track.position} keeps the set moving with ${input.track.title} by ${input.track.artist}.`;
  const djAudio = await input.synthesize(input.config, text);
  if (!djAudio.ok) {
    return { text: formatDjAudioFallbackText(text, djAudio.error), rawText: text };
  }
  return {
    text: [
      formatDjTranscriptLabel(input.config),
      text
    ].join("\n"),
    rawText: text,
    audioPath: djAudio.audioPath,
    latencyMs: djAudio.latencyMs,
    fileSizeBytes: getFileSize(djAudio.audioPath)
  };
}

function recordDjProgramIntroPlayback(
  store: MemoryStore,
  sessionId: string | undefined,
  intro: GeneratedDjProgramIntro,
  playback: PlayerResult | undefined
): void {
  if (!sessionId || !intro.audioPath) {
    return;
  }
  store.recordDjAudio(sessionId, "explicit", null, intro.rawText, intro.audioPath, playback?.ok ? "played" : "failed", {
    cacheExpiresAt: getExplicitDjAudioCacheExpiresAt(),
    latencyMs: intro.latencyMs,
    fileSizeBytes: intro.fileSizeBytes
  });
}

function formatQueue(station: GeneratedStation): string {
  return [
    "Queue:",
    ...station.tracks.map((track) => {
      const suffix = track.playable.available ? "" : " (unavailable)";
      return `${track.position}. ${track.title} - ${track.artist}${suffix}`;
    })
  ].join("\n");
}

function formatPlaybackStatus(playbackState: InteractivePlaybackState | undefined, now: Date): string {
  if (!playbackState) {
    return "No station is playing.";
  }
  const storedTracks = playbackState.storedTracks ?? [];
  const currentIndex = playbackState.currentIndex;
  if (storedTracks.length === 0 || currentIndex === undefined) {
    return "No station is playing.";
  }

  const current = storedTracks[currentIndex]?.track;
  if (!current) {
    return "No station is playing.";
  }

  return [
    formatNowPlayingLine(current, playbackState.currentStartedAt, now, true),
    "Queue:",
    ...storedTracks.map((entry, index) => {
      const marker = index === currentIndex ? ">" : " ";
      return `${marker} ${entry.track.position}. ${entry.track.title} - ${entry.track.artist}`;
    })
  ].join("\n");
}

function formatTrackStartSurface(
  track: StationTrack,
  config: PockedioConfig,
  startedAt: Date | undefined,
  now: Date,
  queue: StoredPlaybackTrack[] = [{ dbId: "", track }],
  currentIndex = Math.max(0, track.position - 1)
): string {
  return [
    formatTrackStartNowPlayingLine(track, startedAt, now, queue.length),
    "",
    `${config.dj.displayName}'s note:`,
    formatDjTrackNote(track),
    formatUpNext(queue, currentIndex),
    formatCurrentQueueSnapshot(queue, currentIndex)
  ].filter(Boolean).join("\n");
}

function formatTrackStartNowPlayingLine(track: StationTrack, startedAt: Date | undefined, now: Date, totalTracks: number): string {
  const positionPrefix = totalTracks > 1 ? `${track.position}/${totalTracks}  ` : "";
  return `Now playing: ${positionPrefix}${track.title} - ${track.artist}\n${formatElapsedBar(startedAt, now, getTrackDurationMs(track))}`;
}

function formatUpNext(queue: StoredPlaybackTrack[], currentIndex: number): string {
  const upcoming = queue
    .slice(currentIndex + 1)
    .filter((entry) => entry.track.playable.available)
    .slice(0, 2);
  if (upcoming.length === 0) {
    return "";
  }
  return [
    "",
    "Up next:",
    ...upcoming.map((entry) => `  ${entry.track.position}. ${entry.track.title} - ${entry.track.artist}`)
  ].join("\n");
}

function formatCurrentQueueSnapshot(queue: StoredPlaybackTrack[], currentIndex: number): string {
  if (queue.length <= 1) {
    return "";
  }
  return [
    "",
    "Queue:",
    ...queue.map((entry, index) => {
      const marker = index === currentIndex ? ">" : " ";
      const suffix = entry.track.playable.available ? "" : " (unavailable)";
      return `${marker} ${entry.track.position}. ${entry.track.title} - ${entry.track.artist}${suffix}`;
    })
  ].join("\n");
}

function formatDjTrackNote(track: StationTrack): string {
  const rationale = track.rationale.trim();
  if (/^you asked for\b/i.test(rationale)) {
    return "Playing this one directly. If you want, I can keep the station door open after it lands.";
  }
  if (rationale) {
    return formatRationaleNote(track, normalizeTrackRationale(rationale));
  }
  return formatRationaleNote(track, "it fits the station’s direction and keeps the set moving naturally");
}

function formatRationaleNote(track: StationTrack, rationale: string): string {
  const templates = [
    `This opens the set with ${rationale}.`,
    `${track.title} keeps the mood moving: ${rationale}.`,
    `I’m bringing this in for its place in the arc: ${rationale}.`,
    `This one should land well here; ${rationale}.`,
    `A good next step for the set: ${rationale}.`
  ];
  return templates[(track.position - 1) % templates.length];
}

function normalizeTrackRationale(rationale: string): string {
  const cleaned = rationale.replace(/\s+/g, " ").trim();
  return `${cleaned.charAt(0).toLowerCase()}${cleaned.slice(1)}`;
}

function formatNowPlayingLine(track: StationTrack, startedAt: Date | undefined, now: Date, includePosition = false): string {
  const title = includePosition ? `${track.position}. ${track.title}` : track.title;
  return `Now playing: ${title} - ${track.artist}\n${formatElapsedBar(startedAt, now, getTrackDurationMs(track))}`;
}

function formatElapsed(startedAt: Date | undefined, now: Date): string {
  if (!startedAt) {
    return "00:00";
  }
  const seconds = Math.max(0, Math.floor((now.getTime() - startedAt.getTime()) / 1_000));
  return formatClockTime(seconds);
}

function formatClockTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes.toString().padStart(2, "0")}:${remainingSeconds.toString().padStart(2, "0")}`;
}

function formatElapsedBar(startedAt: Date | undefined, now: Date, durationMs: number | null = null): string {
  const seconds = startedAt ? Math.max(0, Math.floor((now.getTime() - startedAt.getTime()) / 1_000)) : 0;
  if (durationMs !== null && Number.isFinite(durationMs) && durationMs > 0) {
    const totalSeconds = Math.max(1, Math.floor(durationMs / 1_000));
    const clampedSeconds = Math.min(seconds, totalSeconds);
    const filled = Math.min(19, Math.floor((clampedSeconds / totalSeconds) * 20));
    return `[${"=".repeat(filled)}>${".".repeat(19 - filled)}] ${formatClockTime(clampedSeconds)} / ${formatClockTime(totalSeconds)}`;
  }

  const filled = Math.min(19, Math.floor(seconds / 30));
  return `[${"=".repeat(filled)}>${".".repeat(19 - filled)}] ${formatElapsed(startedAt, now)} elapsed`;
}

function getTrackDurationMs(track: StationTrack): number | null {
  if (!track.playable.available) {
    return null;
  }
  const durationMs = track.playable.durationMs;
  return typeof durationMs === "number" && Number.isFinite(durationMs) && durationMs > 0 ? durationMs : null;
}
