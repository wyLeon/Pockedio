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
  startUrlPlayback as startAudioUrlPlayback,
  type PlaybackHandle,
  type PlayerResult,
  type ProcessStarter
} from "../player/afplay.js";
import type { MusicProvider } from "../providers/musicProvider.js";
import { NetEaseProvider } from "../providers/netease.js";
import { generateStation } from "../station/stationGenerator.js";
import type { GeneratedStation, StationTrack } from "../station/stationTypes.js";
import { synthesizeFishAudio as synthesizeFishAudioDefault, type FishAudioResult } from "../tts/fishAudio.js";
import { parseDeterministicIntent, parseIntent, type SessionIntent } from "./intent.js";

type OutputWriter = (text: string) => void;
type StatusDone = () => void;
type StatusWriter = (text: string) => StatusDone;
type StartUrlPlayback = (url: string) => Promise<PlaybackHandle>;
type NowProvider = () => Date;

type StoredPlaybackTrack = {
  dbId: string;
  track: StationTrack;
};

export type InteractivePlaybackState = {
  station?: GeneratedStation;
  storedTracks?: StoredPlaybackTrack[];
  pendingStationRequest?: string;
  pendingStationOriginalRequest?: string;
  currentIndex?: number;
  currentTrackId?: string;
  currentStartedAt?: Date;
  activePlayback?: PlaybackHandle;
  startUrlPlayback?: StartUrlPlayback;
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
    "  make me a short DJ intro",
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
  const playFile = input.playFile ?? ((filePath) => playAudioFile(filePath, 60_000));
  const synthesize = input.synthesizeFishAudio ?? synthesizeFishAudioDefault;
  const writeStatus = input.writeStatus ?? (() => () => undefined);
  const now = input.now ?? (() => new Date());
  const userText = input.input.trim();
  const sessionId = input.sessionId ?? store.createSession("conversation", userText);
  const shouldEndSession = input.endSession ?? !input.sessionId;
  if (input.playbackState && input.startUrlPlayback) {
    input.playbackState.startUrlPlayback = input.startUrlPlayback;
  }
  if (input.playbackState) {
    input.playbackState.writeOutput = writeOutput;
  }

  try {
    store.addMessage(sessionId, "user", userText);
    const intent = input.playbackState?.pendingStationRequest && isPendingStationConfirmation(input.input)
      ? { type: "pending_station_confirmation" as const, confidence: "high" as const }
      : input.playbackState?.pendingStationRequest && isPendingStationDecline(userText)
        ? { type: "pending_station_decline" as const, confidence: "high" as const }
        : await resolveIntent(userText, llm, writeStatus);

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
        now
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

async function resolveIntent(userText: string, llm: LlmClient, writeStatus: StatusWriter): Promise<SessionIntent> {
  const deterministic = parseDeterministicIntent(userText);
  if (deterministic.confidence === "high" && isInstantLocalIntent(deterministic.type)) {
    return deterministic;
  }
  return withStatus(writeStatus, "Thinking...", () => parseIntent(userText, llm));
}

function isInstantLocalIntent(type: SessionIntent["type"]): boolean {
  return type === "stop"
    || type === "playback_status"
    || type === "feedback_like"
    || type === "feedback_skip"
    || type === "feedback_ban"
    || type === "feedback_more_like_this"
    || type === "feedback_change_vibe";
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
  let stationIntro = input.intentType === "direct_playback_request"
    ? formatDirectPlaybackConfirmation(station)
    : await generateStationIntroResponse({ config: input.config, llm: input.llm, userText: input.requestText, station, context });
  if (input.playbackState) {
    input.playbackState.station = station;
    input.playbackState.storedTracks = storedTracks;
    nowPlaying = await withStatus(input.writeStatus, "Starting playback...", () => startTrackAt(input.playbackState!, input.config, input.store, 0, input.startUrlPlayback, input.now));
  } else if (firstPlayable?.playable.available) {
    const playableUrl = firstPlayable.playable.playableUrl;
    const playback = await withStatus(input.writeStatus, "Starting playback...", () => input.playUrl(playableUrl));
    if (!playback.ok) {
      playbackFailure = playback.error ?? "Playback failed.";
    }
  } else if (input.intentType === "direct_playback_request") {
    stationIntro = formatUnavailableTrackFallbackForResponse(station.tracks);
  }

  const response = [
    stationIntro,
    formatQueue(station),
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
  const prompt = [
    `You are ${input.config.dj.displayName}, Pockedio's personal DJ.`,
    "Write a warm, concise station introduction for a CLI music session.",
    "Acknowledge the user's mood or request in human language before mentioning the station.",
    "Keep it to 2-3 sentences.",
    "Do not say playback failed. Do not list the queue.",
    `User request: ${input.userText}`,
    `DJ style: ${input.config.dj.style}`,
    `DJ language: ${input.config.dj.language}`,
    `Playable tracks: ${input.station.tracks.filter((track) => track.playable.available).length}`,
    `Weather summary: ${input.context.weather?.summary ?? "not available"}`,
    `Diary summary: ${input.context.diary?.summary ?? "not available"}`
  ].join("\n");
  const result = await input.llm.generateText(prompt);
  if (result.ok && result.value.trim()) {
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
    "Do not claim playback has started.",
    `Weather summary: ${input.context?.weather?.summary ?? "not available"}`,
    `Diary summary: ${input.context?.diary?.summary ?? "not available"}`,
    formatConversationPlaybackContext(input.playbackState),
    `User: ${input.userText}`
  ].join("\n");
  const result = await input.llm.generateText(prompt);
  if (result.ok && result.value.trim()) {
    return result.value.trim();
  }

  return [
    "I can still help with the music, though my deeper conversation layer is offline right now.",
    "",
    "Want me to search directly from your request and build a five-track station?"
  ].join("\n");
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

function shouldHandlePendingStationFollowup(intent: SessionIntent, userText: string): boolean {
  if (!userText.trim()) {
    return false;
  }
  if (intent.type === "stop"
    || intent.type === "playback_status"
    || intent.type === "identity_capability"
    || intent.type === "explicit_dj_audio_request"
    || intent.type === "pending_station_confirmation"
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
    "Do not claim playback started. Do not show a queue.",
    `Previous pending station: ${previous}`,
    `User refinement: ${input.userText}`
  ].join("\n");
  const result = await input.llm.generateText(prompt);
  if (result.ok && result.value.trim()) {
    return result.value.trim();
  }

  return `Got it. I’ll shape it around: ${input.userText.trim()}.\n\nPlay this version?`;
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
    "Do not start playback. Do not show a queue.",
    `Pending station: ${pending}`,
    `User question: ${input.userText}`
  ].join("\n");
  const result = await input.llm.generateText(prompt);
  if (result.ok && result.value.trim()) {
    return result.value.trim();
  }

  return "I’d keep it close to the direction we just discussed, then adjust once the first track lands.\n\nPlay this version?";
}

function mergePendingStationRequest(previous: string, refinement: string): string {
  return `${previous}\nRefinement: ${refinement.trim()}`;
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
    `User: ${input.userText}`
  ].join("\n");
  const result = await input.llm.generateText(prompt);
  if (result.ok && result.value.trim()) {
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
  if (result.ok && result.value.trim()) {
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
    "Write a concise spoken DJ segment in English.",
    `User request: ${input.userText}`
  ].join("\n"));
  const text = textResult.ok ? textResult.value : "I will keep this set focused and direct.";
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
  return startTrackAt(playbackState, config, store, (playbackState.currentIndex ?? -1) + 1, startUrlPlayback, () => new Date());
}

async function startTrackAt(
  playbackState: InteractivePlaybackState,
  config: PockedioConfig,
  store: MemoryStore,
  startIndex: number,
  startUrlPlayback: StartUrlPlayback,
  now: NowProvider
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

  const handle = await startUrlPlayback(entry.track.playable.playableUrl);
  playbackState.currentIndex = nextIndex;
  playbackState.currentTrackId = entry.dbId;
  playbackState.currentStartedAt = now();
  playbackState.activePlayback = handle;
  handle.done.then((result) => {
    if (playbackState.activePlayback !== handle || !result.ok) {
      return;
    }
    void autoAdvancePlayback(playbackState, config, entry.dbId, nextIndex + 1, startUrlPlayback);
  }).catch(() => undefined);
  store.updateTrackPlayback(entry.dbId, "playing");
  return formatNowPlayingLine(entry.track, playbackState.currentStartedAt, now());
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
    const response = await startTrackAt(playbackState, config, store, startIndex, startUrlPlayback, () => new Date());
    if (response !== "No playable tracks remain.") {
      playbackState.writeOutput?.(response);
    }
  } finally {
    store.close();
  }
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

function formatNowPlayingLine(track: StationTrack, startedAt: Date | undefined, now: Date, includePosition = false): string {
  const title = includePosition ? `${track.position}. ${track.title}` : track.title;
  return `Now playing: ${title} - ${track.artist}\n${formatElapsedBar(startedAt, now)}`;
}

function formatElapsed(startedAt: Date | undefined, now: Date): string {
  if (!startedAt) {
    return "00:00";
  }
  const seconds = Math.max(0, Math.floor((now.getTime() - startedAt.getTime()) / 1_000));
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes.toString().padStart(2, "0")}:${remainingSeconds.toString().padStart(2, "0")}`;
}

function formatElapsedBar(startedAt: Date | undefined, now: Date): string {
  const seconds = startedAt ? Math.max(0, Math.floor((now.getTime() - startedAt.getTime()) / 1_000)) : 0;
  const filled = Math.min(19, Math.floor(seconds / 30));
  return `[${"=".repeat(filled)}>${".".repeat(19 - filled)}] ${formatElapsed(startedAt, now)} elapsed`;
}
