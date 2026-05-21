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
import { summarizeSession } from "../memory/sessionSummary.js";
import { buildFeedbackTasteSignals } from "../memory/tasteSignals.js";
import {
  playFile as playAudioFile,
  startUrlPlayback as startAfplayUrlPlayback,
} from "../player/afplay.js";
import {
  playUrl as playAudioUrl,
  startDuckedUrlWithIntro,
  startUrlPlayback as startAudioUrlPlayback,
  type PlaybackHandle,
  type PlayerResult,
  type ProcessStarter
} from "../player/defaultPlayer.js";
import type { MusicProvider, MusicTrackCandidate, PlayableTrack } from "../providers/musicProvider.js";
import { NetEaseProvider } from "../providers/netease.js";
import { generateStation } from "../station/stationGenerator.js";
import type { GeneratedStation, StationTrack } from "../station/stationTypes.js";
import { updateTasteProfile } from "../taste/profile.js";
import { synthesizeFishAudio as synthesizeFishAudioDefault, type FishAudioOptions, type FishAudioResult } from "../tts/fishAudio.js";
import { parseDeterministicIntent, parseIntent, type SessionIntent } from "./intent.js";

type OutputWriter = (text: string) => void;
type StatusDone = () => void;
type StatusWriter = (text: string) => StatusDone;
type StartUrlPlayback = (url: string) => Promise<PlaybackHandle>;
type StartDuckedIntroPlayback = (url: string, introFilePath: string) => Promise<PlaybackHandle>;
type NowProvider = () => Date;
type SynthesizeFishAudio = (config: PockedioConfig, text: string, options?: FishAudioOptions) => Promise<FishAudioResult>;

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
  cancel: () => void;
};

type DjProgramPlaybackState = {
  sessionId: string;
  requestText: string;
  station: GeneratedStation;
  llm: LlmClient;
  synthesize: SynthesizeFishAudio;
  playFile?: (filePath: string) => Promise<PlayerResult>;
  preparations: Map<number, DjIntroPreparation | PreparedDjIntro>;
  quietTrackIndexes: Set<number>;
  spokenTrackIndexes: Set<number>;
};

type PendingDjProgramState = {
  sessionId: string;
  requestText: string;
  station: GeneratedStation;
  storedTracks: StoredPlaybackTrack[];
  intro: GeneratedDjProgramIntro;
  llm: LlmClient;
  synthesize: SynthesizeFishAudio;
  playFile?: (filePath: string) => Promise<PlayerResult>;
};

export type InteractivePlaybackState = {
  sessionId?: string;
  station?: GeneratedStation;
  storedTracks?: StoredPlaybackTrack[];
  pendingStationRequest?: string;
  pendingStationOriginalRequest?: string;
  pendingSingleTrackSelection?: PendingSingleTrackSelection;
  pendingDjProgram?: PendingDjProgramState;
  currentIndex?: number;
  currentTrackId?: string;
  currentStartedAt?: Date;
  activePlayback?: PlaybackHandle;
  activePlaybackPaused?: boolean;
  lastIntroPlaybackResult?: PlayerResult;
  djProgram?: DjProgramPlaybackState;
  startUrlPlayback?: StartUrlPlayback;
  startDuckedIntroPlayback?: StartDuckedIntroPlayback;
  writeOutput?: OutputWriter;
  isHandlingTurn?: boolean;
  queuedPlaybackOutputs?: string[];
};

export type SessionTurnInput = {
  input: string;
  signal?: AbortSignal;
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
  synthesizeFishAudio?: SynthesizeFishAudio;
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
  if (starter || fetchImpl) {
    return (url) => startAfplayUrlPlayback(url, undefined, starter, fetchImpl);
  }
  return (url) => startAudioUrlPlayback(url);
}

export function formatInteractiveStartupGuide(displayName = "Pockedio", setupNote = ""): string {
  const lines = [
    `${displayName} is listening.`,
    "What are we tuning for?",
    "",
    "Try:",
    "  I'm exhausted and want something calm.",
    "  play something for deep work",
    "  what's playing?",
    "",
    "When I suggest a station:",
    "  press Enter to play it",
    "  type dj for a spoken DJ version",
    "",
    "Controls:",
    "  next",
    "  previous",
    "  stop",
    "  show queue",
    "  Ctrl+C exits, or cancels while processing",
    "",
    "Setup:",
    "  pockedio setup"
  ];
  if (setupNote) {
    lines.push("", setupNote);
  }
  return lines.join("\n");
}

export function formatStartupSetupNote(config: PockedioConfig): string {
  if (hasTasteSignals(config.paths.taste)) {
    return "";
  }

  return [
    "Setup note:",
    "  Taste is not imported yet.",
    "  Run pockedio setup when you want to improve personalization."
  ].join("\n");
}

function hasTasteSignals(tastePath: string): boolean {
  if (!fs.existsSync(tastePath)) {
    return false;
  }
  const content = fs.readFileSync(tastePath, "utf8");
  return /^- .+/m.test(content);
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
  const signal = input.signal;
  const userText = normalizeSessionInput(input.input);
  const sessionId = input.sessionId ?? store.createSession("conversation", userText);
  const shouldEndSession = input.endSession ?? !input.sessionId;
  if (input.playbackState) {
    input.playbackState.sessionId = sessionId;
    input.playbackState.startUrlPlayback = input.startUrlPlayback
      ?? input.playbackState.startUrlPlayback
      ?? startUrlPlayback;
    input.playbackState.writeOutput = input.writeOutput
      ?? input.playbackState.writeOutput
      ?? writeOutput;
    input.playbackState.startDuckedIntroPlayback = input.startDuckedIntroPlayback
      ?? input.playbackState.startDuckedIntroPlayback
      ?? startDuckedIntroPlayback;
    input.playbackState.queuedPlaybackOutputs ??= [];
  }

  const wasHandlingTurn = input.playbackState?.isHandlingTurn ?? false;
  if (input.playbackState) {
    input.playbackState.isHandlingTurn = true;
  }

  try {
    throwIfAborted(signal);
    store.addMessage(sessionId, "user", userText);
    if (input.playbackState?.pendingDjProgram && isPendingStationConfirmation(input.input)) {
      const playback = await startPreparedDjProgram({
        config,
        store,
        playbackState: input.playbackState,
        startUrlPlayback,
        startDuckedIntroPlayback,
        now,
        writeStatus
      });
      store.addMessage(sessionId, "pockedio", playback.response);
      writeOutput(playback.response);
      return {
        sessionId,
        intent: { type: "pending_station_confirmation", confidence: "high" },
        response: playback.response,
        shouldExit: false,
        station: playback.station
      };
    }
    if (input.playbackState?.pendingDjProgram && isPendingStationDecline(userText)) {
      input.playbackState.pendingDjProgram = undefined;
      const response = "No problem. I’ll leave that DJ program parked and keep listening.";
      store.addMessage(sessionId, "pockedio", response);
      writeOutput(response);
      return { sessionId, intent: { type: "pending_station_decline", confidence: "high" }, response, shouldExit: false };
    }
    if (input.playbackState?.pendingDjProgram && userText) {
      const pendingRequest = input.playbackState.pendingDjProgram.requestText;
      input.playbackState.pendingDjProgram = undefined;
      input.playbackState.pendingStationRequest = pendingRequest;
      input.playbackState.pendingStationOriginalRequest = pendingRequest;
      const response = await withStatus(writeStatus, "Thinking...", () => handlePendingStationFollowup({
        config,
        llm,
        userText,
        playbackState: input.playbackState!,
        signal
      }), signal);
      store.addMessage(sessionId, "pockedio", response);
      writeOutput(response);
      return {
        sessionId,
        intent: { type: "pending_station_refinement", confidence: "high" },
        response,
        shouldExit: false
      };
    }
    if (!userText && !input.playbackState?.pendingStationRequest) {
      const response = formatEmptyInputResponse(input.playbackState);
      store.addMessage(sessionId, "pockedio", response);
      writeOutput(response);
      return { sessionId, intent: { type: "conversation", confidence: "high" }, response, shouldExit: false };
    }
    const pendingSingleTrackCandidate = getPendingSingleTrackCandidate(input.playbackState, userText);
    let intent = pendingSingleTrackCandidate
        ? { type: "single_track_selection" as const, confidence: "high" as const }
      : input.playbackState?.pendingStationRequest && isPendingStationDjProgramRequest(userText)
        ? { type: "pending_station_dj_program" as const, confidence: "high" as const }
      : input.playbackState?.pendingStationRequest && isPendingStationConfirmation(input.input)
        ? { type: "pending_station_confirmation" as const, confidence: "high" as const }
      : input.playbackState?.pendingStationRequest && isPendingStationDecline(userText)
        ? { type: "pending_station_decline" as const, confidence: "high" as const }
        : await resolveIntent(userText, llm, writeStatus, signal);
    if (((input.playbackState?.currentTrackId && isCurrentTrackQuestion(userText)) || isMusicKnowledgeQuestion(userText))
      && !hasExplicitPlaybackCommand(userText)
      && !isProtectedOperationalIntent(intent.type)) {
      intent = { type: "conversation", confidence: "high" };
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
        now,
        signal
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
      let response: string;
      if (!input.playbackState?.activePlayback) {
        response = "Nothing is playing right now.";
      } else if (!input.playbackState.activePlayback.pause) {
        stopActivePlayback(input.playbackState, store);
        response = "Pause is not available with this player, so I stopped playback instead. Install mpv for pause/resume, or type next to continue.";
      } else {
        const paused = await input.playbackState.activePlayback.pause();
        if (paused) {
          input.playbackState.activePlaybackPaused = true;
          response = "Paused.";
        } else {
          stopActivePlayback(input.playbackState, store);
          response = "I could not pause with this player, so I stopped playback instead. Install mpv for pause/resume, or type next to continue.";
        }
      }
      store.addMessage(sessionId, "pockedio", response);
      writeOutput(response);
      return { sessionId, intent, response, shouldExit: false };
    }

    if (intent.type === "resume") {
      if (input.playbackState?.activePlaybackPaused && input.playbackState.activePlayback?.resume) {
        const resumed = await input.playbackState.activePlayback.resume();
        if (resumed) {
          input.playbackState.activePlaybackPaused = false;
          const response = "Resumed.";
          store.addMessage(sessionId, "pockedio", response);
          writeOutput(response);
          return { sessionId, intent, response, shouldExit: false };
        }
      }
      const response = "Nothing resumable is paused right now. Install mpv for pause/resume support with streaming playback.";
      store.addMessage(sessionId, "pockedio", response);
      writeOutput(response);
      return { sessionId, intent, response, shouldExit: false };
    }

    if (intent.type === "previous") {
      const response = await retreatPlayback(input.playbackState, config, store, input.playbackState?.startUrlPlayback ?? startUrlPlayback);
      store.addMessage(sessionId, "pockedio", response);
      writeOutput(response);
      return { sessionId, intent, response, shouldExit: false };
    }

    if (intent.type === "session_exit") {
      cancelDjProgramPreparations(input.playbackState);
      if (input.playbackState?.activePlayback) {
        input.playbackState.activePlayback.stop();
        if (input.playbackState.currentTrackId) {
          store.updateTrackPlayback(input.playbackState.currentTrackId, "skipped");
        }
        input.playbackState.activePlayback = undefined;
        input.playbackState.activePlaybackPaused = false;
      }
      const response = "Session closed.";
      store.addMessage(sessionId, "pockedio", response);
      writeOutput(response);
      return { sessionId, intent, response, shouldExit: true };
    }

    if (intent.type === "stop") {
      let response = "Nothing is playing right now.";
      cancelDjProgramPreparations(input.playbackState);
      if (input.playbackState?.activePlayback) {
        input.playbackState.activePlayback.stop();
        if (input.playbackState.currentTrackId) {
          store.updateTrackPlayback(input.playbackState.currentTrackId, "skipped");
        }
        input.playbackState.activePlayback = undefined;
        input.playbackState.activePlaybackPaused = false;
        response = "Stopped playback.";
      }
      store.addMessage(sessionId, "pockedio", response);
      writeOutput(response);
      return { sessionId, intent, response, shouldExit: false };
    }

    if (isFeedbackIntent(intent.type)) {
      const action = feedbackActionForIntent(intent.type);
      const currentTrack = getCurrentPlaybackTrack(input.playbackState);
      const currentTrackId = input.playbackState?.currentTrackId ?? null;
      store.recordFeedbackWithTasteSignals(
        sessionId,
        currentTrackId,
        action,
        userText,
        buildFeedbackTasteSignals({
          action,
          trackId: currentTrackId,
          track: currentTrack,
          context: {
            stationRequest: input.playbackState?.station?.request,
            note: userText
          }
        })
      );
      const response = isQueueReshapeFeedback(action) && input.playbackState?.station && currentTrack
        ? await withStatus(writeStatus, "Reshaping queue...", () => reshapeRemainingQueueForFeedback({
            config,
            sessionId,
            store,
            provider,
            llm,
            action,
            playbackState: input.playbackState!,
            currentTrack,
            signal
          }), signal)
        : intent.type === "feedback_skip" && input.playbackState?.station
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
      const response = await withStatus(writeStatus, "Thinking...", () => generateIdentityCapabilityResponse({ config, llm, userText, signal }), signal);
      store.addMessage(sessionId, "pockedio", response);
      writeOutput(response);
      return { sessionId, intent, response, shouldExit: false };
    }

    if (intent.type === "explicit_dj_audio_request") {
      const response = formatStandaloneDjAudioDisabledResponse(config);
      store.addMessage(sessionId, "pockedio", response);
      writeOutput(response);
      return { sessionId, intent, response, shouldExit: false };
    }

    if (intent.type === "taste_profile_update") {
      const result = await withStatus(writeStatus, "Updating taste profile...", () => Promise.resolve(updateTasteProfile(config)), signal);
      const response = [
        "Updated your taste profile.",
        `Signals reviewed: ${result.signalCount}`,
        `taste.md: ${result.tastePath}`
      ].join("\n");
      store.addMessage(sessionId, "pockedio", response);
      writeOutput(response);
      return { sessionId, intent, response, shouldExit: false };
    }

    if (intent.type === "session_memory_update") {
      const result = summarizeSession(store, sessionId);
      const response = result.summaryId
        ? [
            "Updated session memory.",
            `Messages reviewed: ${result.messageCount}`
          ].join("\n")
        : "I do not have a durable session memory to summarize yet.";
      store.addMessage(sessionId, "pockedio", response);
      writeOutput(response);
      return { sessionId, intent, response, shouldExit: false };
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
        now,
        signal
      });
      store.addMessage(sessionId, "pockedio", playback.response);
      writeOutput(playback.response);
      return { sessionId, intent, response: playback.response, shouldExit: false, station: playback.station };
    }

    if (intent.type === "pending_station_dj_program" && input.playbackState?.pendingStationRequest) {
      const pendingRequest = input.playbackState.pendingStationRequest;
      input.playbackState.pendingStationRequest = undefined;
      input.playbackState.pendingStationOriginalRequest = undefined;
      cancelDjProgramPreparations(input.playbackState);
      stopActivePlayback(input.playbackState, store);
      const prepared = await prepareDjProgramRequest({
        config,
        sessionId,
        store,
        provider,
        llm,
        requestText: pendingRequest,
        buildContext: input.buildContext,
        writeStatus,
        playbackState: input.playbackState,
        synthesize,
        playFile,
        signal
      });
      store.addMessage(sessionId, "pockedio", prepared.response);
      writeOutput(prepared.response);
      return { sessionId, intent, response: prepared.response, shouldExit: false, station: prepared.station };
    }

    if (input.playbackState?.pendingStationRequest && shouldHandlePendingStationFollowup(intent, userText)) {
      const response = await withStatus(writeStatus, "Thinking...", () => handlePendingStationFollowup({
        config,
        llm,
        userText,
        playbackState: input.playbackState!,
        signal
      }), signal);
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
      const context = await withStatus(writeStatus, "Reading your context...", () => (input.buildContext ?? buildContext)(config), signal);
      store.addContextSnapshot(sessionId, {
        calendarSummary: context.calendar?.summary,
        weather: context.weather,
        diarySummary: context.diary?.summary,
        personality: context.personality ?? config.personality
      });
      throwIfAborted(signal);
      const response = await withStatus(writeStatus, "Preparing recommendation...", () => generateMusicRecommendationResponse({
        config,
        llm,
        userText,
        playbackState: input.playbackState,
        context,
        signal
      }), signal);
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
      const explicitDjProgram = isExplicitDjProgramPlaybackRequest(userText);
      if (input.playbackState) {
        input.playbackState.pendingStationRequest = undefined;
        input.playbackState.pendingStationOriginalRequest = undefined;
        input.playbackState.pendingDjProgram = undefined;
        if (explicitDjProgram) {
          cancelDjProgramPreparations(input.playbackState);
          stopActivePlayback(input.playbackState, store);
        }
      }
      if (explicitDjProgram && input.playbackState) {
        const prepared = await prepareDjProgramRequest({
          config,
          sessionId,
          store,
          provider,
          llm,
          requestText: userText,
          buildContext: input.buildContext,
          writeStatus,
          playbackState: input.playbackState,
          synthesize,
          playFile,
          signal
        });
        store.addMessage(sessionId, "pockedio", prepared.response);
        writeOutput(prepared.response);
        return { sessionId, intent, response: prepared.response, shouldExit: false, station: prepared.station };
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
        djProgramIntro: explicitDjProgram,
        synthesize,
        playFile,
        startDuckedIntroPlayback,
        signal
      });
      store.addMessage(sessionId, "pockedio", playback.response);
      writeOutput(playback.response);

      if (shouldUseSpokenDjAudio({ triggerType: "normal_playback", userExplicitlyRequestedDjAudio: false })) {
        await synthesize(config, playback.response);
      }

      return { sessionId, intent, response: playback.response, shouldExit: false, station: playback.station };
    }

    const conversationContext = isContextualCalendarConversation(userText)
      ? await withStatus(writeStatus, "Reading your context...", () => (input.buildContext ?? buildContext)(config), signal)
      : undefined;
    if (conversationContext) {
      store.addContextSnapshot(sessionId, {
        calendarSummary: conversationContext.calendar?.summary,
        weather: conversationContext.weather,
        diarySummary: conversationContext.diary?.summary,
        personality: conversationContext.personality ?? config.personality
      });
    }
    const response = await withStatus(writeStatus, "Thinking...", () => generateConversationResponse({
      config,
      llm,
      userText,
      playbackState: input.playbackState,
      context: conversationContext,
      signal
    }), signal);
    store.addMessage(sessionId, "pockedio", response);
    writeOutput(response);
    return { sessionId, intent, response, shouldExit: false };
  } finally {
    if (input.playbackState) {
      input.playbackState.isHandlingTurn = wasHandlingTurn;
      if (!wasHandlingTurn) {
        flushQueuedPlaybackOutputs(input.playbackState);
      }
    }
    if (shouldEndSession) {
      summarizeSession(store, sessionId);
      store.endSession(sessionId);
    }
    store.close();
  }
}

function normalizeSessionInput(input: string): string {
  return input.trim().replace(/^>\s*/, "").trim();
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new TurnCancelledError();
  }
}

class TurnCancelledError extends Error {
  constructor() {
    super("Turn cancelled.");
    this.name = "AbortError";
  }
}

function isCancellationError(error: unknown): boolean {
  return error instanceof TurnCancelledError
    || (error instanceof Error && (error.name === "AbortError" || /aborted|cancelled|canceled/i.test(error.message)));
}

function recordCancelledTurn(config: PockedioConfig, sessionId: string): void {
  const store = new MemoryStore(config);
  try {
    store.addMessage(sessionId, "pockedio", "Cancelled before response.");
  } finally {
    store.close();
  }
}

function formatEmptyInputResponse(playbackState: InteractivePlaybackState | undefined): string {
  return playbackState?.currentTrackId
    ? "I’m still here. Tell me what you want to hear next, or type show queue."
    : "I’m here. Tell me what you want to hear.";
}

async function resolveIntent(userText: string, llm: LlmClient, writeStatus: StatusWriter, signal?: AbortSignal): Promise<SessionIntent> {
  const deterministic = parseDeterministicIntent(userText);
  if (deterministic.confidence === "high" && isInstantLocalIntent(deterministic.type)) {
    return deterministic;
  }
  return withStatus(writeStatus, "Thinking...", () => parseIntent(userText, llm, { signal }), signal);
}

function isInstantLocalIntent(type: SessionIntent["type"]): boolean {
  return type === "stop"
    || type === "session_exit"
    || type === "pause"
    || type === "resume"
    || type === "previous"
    || type === "playback_status"
    || type === "feedback_like"
    || type === "feedback_skip"
    || type === "feedback_ban"
    || type === "feedback_more_like_this"
    || type === "feedback_change_vibe"
    || type === "single_track_playback"
    || type === "single_track_selection";
}

async function withStatus<T>(writeStatus: StatusWriter, text: string, action: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  throwIfAborted(signal);
  const done = writeStatus(text);
  try {
    const result = await raceWithAbort(action(), signal);
    throwIfAborted(signal);
    return result;
  } finally {
    done();
  }
}

function raceWithAbort<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) {
    return promise;
  }
  if (signal.aborted) {
    return Promise.reject(new TurnCancelledError());
  }
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort);
      reject(new TurnCancelledError());
    };
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      }
    );
  });
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
    const displayText = `${text}  Ctrl+C to cancel`;
    let index = 0;
    const render = () => {
      output.write(`\r${frames[index % frames.length]} ${displayText}`);
      index += 1;
    };
    render();
    const timer = setInterval(render, 80);
    return () => {
      clearInterval(timer);
      output.write(`\r${" ".repeat(displayText.length + 4)}\r`);
    };
  };
}

function createTurnScopedStatusWriter(baseWriter: StatusWriter, initialText?: string): { writeStatus: StatusWriter; finish: () => void } {
  let current: { text: string; done: StatusDone } | undefined = initialText
    ? { text: initialText, done: baseWriter(initialText) }
    : undefined;

  const finishCurrent = () => {
    if (!current) {
      return;
    }
    const done = current.done;
    current = undefined;
    done();
  };

  return {
    writeStatus: (text) => {
      if (current?.text === text) {
        return () => undefined;
      }

      finishCurrent();
      const entry = { text, done: baseWriter(text) };
      current = entry;
      return () => {
        if (current !== entry) {
          return;
        }
        current = undefined;
        entry.done();
      };
    },
    finish: finishCurrent
  };
}

export function formatInitialInteractiveTurnStatus(input: string, playbackState?: InteractivePlaybackState): string | undefined {
  const userText = normalizeSessionInput(input);
  if (!userText) {
    if (playbackState?.pendingDjProgram) {
      return "Starting DJ program...";
    }
    if (playbackState?.pendingStationRequest) {
      return "Starting station...";
    }
    return undefined;
  }

  if (playbackState?.pendingDjProgram && isPendingStationConfirmation(input)) {
    return "Starting DJ program...";
  }
  if (playbackState?.pendingStationRequest && isPendingStationConfirmation(input)) {
    return "Starting station...";
  }
  if (playbackState?.pendingStationRequest && isPendingStationDjProgramRequest(userText)) {
    return "Preparing DJ program...";
  }

  return "Thinking...";
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
  signal?: AbortSignal;
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
    now: input.now,
    signal: input.signal
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
  signal?: AbortSignal;
}): Promise<{ response: string }> {
  const storedTrack = storeSingleTrack(input.sessionId, input.store, input.track, input.playbackState === undefined);
  let playbackFailure: string | undefined;
  let nowPlaying = "";

  if (input.playbackState) {
    input.playbackState.station = undefined;
    input.playbackState.djProgram = undefined;
    input.playbackState.storedTracks = [storedTrack];
    cancelDjProgramPreparations(input.playbackState);
    stopActivePlayback(input.playbackState, input.store);
    nowPlaying = await withStatus(input.writeStatus, "Starting playback...", () => startTrackAt(input.playbackState!, input.config, input.store, 0, input.startUrlPlayback, input.now), input.signal);
  } else if (input.track.playable.available) {
    const playableUrl = input.track.playable.playableUrl;
    const playback = await withStatus(input.writeStatus, "Starting playback...", () => input.playUrl(playableUrl), input.signal);
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
  synthesize?: SynthesizeFishAudio;
  playFile?: (filePath: string) => Promise<PlayerResult>;
  startDuckedIntroPlayback?: StartDuckedIntroPlayback;
  signal?: AbortSignal;
}): Promise<{ response: string; station: GeneratedStation }> {
  const context = await withStatus(input.writeStatus, "Reading your context...", () => (input.buildContext ?? buildContext)(input.config), input.signal);
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
    llm: input.llm,
    signal: input.signal
  }), input.signal);
  const storedTracks = storeStation(input.sessionId, input.store, station, input.playbackState === undefined);
  const firstPlayable = station.tracks.find((track) => track.playable.available);
  let playbackFailure: string | undefined;
  let nowPlaying = "";
  let djProgramIntro = "";
  let djProgramIntroAudio: GeneratedDjProgramIntro | undefined;
  let stationIntro = input.intentType === "direct_playback_request"
    ? formatDirectPlaybackConfirmation(station)
    : await withStatus(input.writeStatus, "Preparing station intro...", () => generateStationIntroResponse({
      config: input.config,
      llm: input.llm,
      userText: input.requestText,
      station,
      context,
      signal: input.signal
    }), input.signal);
  if (input.djProgramIntro) {
    stationIntro = "";
  }
  if (input.djProgramIntro && input.synthesize && input.playFile) {
    const intro = await withStatus(input.writeStatus, "Preparing DJ voice...", () => generateStationDjProgramIntro({
      config: input.config,
      sessionId: input.sessionId,
      store: input.store,
      llm: input.llm,
      station,
      requestText: input.requestText,
      synthesize: input.synthesize!,
      playFile: input.startDuckedIntroPlayback ? undefined : input.playFile!,
      signal: input.signal
    }), input.signal);
    djProgramIntroAudio = intro;
    djProgramIntro = intro.audioPath && input.startDuckedIntroPlayback ? "" : intro.text;
  }
  if (input.playbackState) {
    cancelDjProgramPreparations(input.playbackState);
    input.playbackState.station = station;
    input.playbackState.storedTracks = storedTracks;
    input.playbackState.djProgram = input.djProgramIntro && input.synthesize
      ? {
          sessionId: input.sessionId,
          requestText: input.requestText,
	          station,
	          llm: input.llm,
	          synthesize: input.synthesize,
	          playFile: input.playFile,
	          preparations: new Map(),
	          quietTrackIndexes: new Set(),
	          spokenTrackIndexes: new Set()
	        }
	      : undefined;
    stopActivePlayback(input.playbackState, input.store);
    nowPlaying = await withStatus(input.writeStatus, "Starting playback...", () => startTrackAt(input.playbackState!, input.config, input.store, 0, input.startUrlPlayback, input.now, {
      intro: djProgramIntroAudio,
      startDuckedIntroPlayback: input.startDuckedIntroPlayback
    }), input.signal);
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
    const playback = await withStatus(input.writeStatus, "Starting playback...", () => input.playUrl(playableUrl), input.signal);
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

async function prepareDjProgramRequest(input: {
  config: PockedioConfig;
  sessionId: string;
  store: MemoryStore;
  provider: MusicProvider;
  llm: LlmClient;
  requestText: string;
  buildContext?: (config: PockedioConfig) => Promise<Partial<PockedioContext>>;
  writeStatus: StatusWriter;
  playbackState: InteractivePlaybackState;
  synthesize: SynthesizeFishAudio;
  playFile?: (filePath: string) => Promise<PlayerResult>;
  signal?: AbortSignal;
}): Promise<{ response: string; station: GeneratedStation }> {
  const context = await withStatus(input.writeStatus, "Reading your context...", () => (input.buildContext ?? buildContext)(input.config), input.signal);
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
    llm: input.llm,
    signal: input.signal
  }), input.signal);
  const storedTracks = storeStation(input.sessionId, input.store, station, false);
  const firstPlayable = station.tracks.find((track) => track.playable.available);
  if (!firstPlayable) {
    input.playbackState.pendingDjProgram = undefined;
    return {
      station,
      response: [
        formatUnavailableTrackFallbackForResponse(station.tracks),
        "Tell me a different direction and I’ll try again."
      ].filter(Boolean).join("\n")
    };
  }

  const intro = await withStatus(input.writeStatus, "Preparing DJ voice...", () => generateStationDjProgramIntro({
    config: input.config,
    sessionId: input.sessionId,
    store: input.store,
    llm: input.llm,
    station,
    requestText: input.requestText,
    synthesize: input.synthesize,
    signal: input.signal
  }), input.signal);
  input.playbackState.pendingDjProgram = {
    sessionId: input.sessionId,
    requestText: input.requestText,
    station,
    storedTracks,
    intro,
    llm: input.llm,
    synthesize: input.synthesize,
    playFile: input.playFile
  };
  input.playbackState.station = undefined;
  input.playbackState.storedTracks = undefined;
  input.playbackState.djProgram = undefined;

  return { station, response: formatPreparedDjProgramReadyResponse() };
}

async function startPreparedDjProgram(input: {
  config: PockedioConfig;
  store: MemoryStore;
  playbackState: InteractivePlaybackState;
  startUrlPlayback: StartUrlPlayback;
  startDuckedIntroPlayback: StartDuckedIntroPlayback;
  now: NowProvider;
  writeStatus: StatusWriter;
}): Promise<{ response: string; station: GeneratedStation }> {
  const pending = input.playbackState.pendingDjProgram;
  if (!pending) {
    const response = "No DJ program is waiting right now.";
    return {
      response,
      station: input.playbackState.station ?? { request: "", source: "fallback", tracks: [] }
    };
  }
  input.playbackState.pendingDjProgram = undefined;
  input.playbackState.pendingStationRequest = undefined;
  input.playbackState.pendingStationOriginalRequest = undefined;
  input.playbackState.station = pending.station;
  input.playbackState.storedTracks = pending.storedTracks;
  input.playbackState.djProgram = createDjProgramPlaybackState(pending);
  stopActivePlayback(input.playbackState, input.store);

  let response = await withStatus(input.writeStatus, "Starting playback...", () => startTrackAt(
    input.playbackState,
    input.config,
    input.store,
    0,
    input.startUrlPlayback,
    input.now,
    {
      intro: pending.intro,
      startDuckedIntroPlayback: input.startDuckedIntroPlayback
    }
  ));
  if (pending.intro.audioPath && input.playbackState.lastIntroPlaybackResult && !input.playbackState.lastIntroPlaybackResult.ok) {
    response = [
      response,
      `Playback detail: ${input.playbackState.lastIntroPlaybackResult.error ?? "DJ intro playback failed."}`
    ].join("\n");
  }
  return { response, station: pending.station };
}

function createDjProgramPlaybackState(pending: PendingDjProgramState): DjProgramPlaybackState {
  return {
    sessionId: pending.sessionId,
    requestText: pending.requestText,
    station: pending.station,
    llm: pending.llm,
    synthesize: pending.synthesize,
    playFile: pending.playFile,
    preparations: new Map(),
    quietTrackIndexes: new Set(),
    spokenTrackIndexes: new Set()
  };
}

function formatPreparedDjProgramReadyResponse(): string {
  return [
    "DJ program is ready.",
    "",
    "Press Enter to start it, or tell me how to adjust it."
  ].join("\n");
}

async function generateStationIntroResponse(input: {
  config: PockedioConfig;
  llm: LlmClient;
  userText: string;
  station: GeneratedStation;
  context: Partial<PockedioContext>;
  signal?: AbortSignal;
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
    `Calendar summary: ${input.context.calendar?.summary ?? "not available"}`,
    `Calendar listening hint: ${input.context.calendar?.listeningHint ?? "not available"}`,
    `Weather summary: ${input.context.weather?.summary ?? "not available"}`,
    `Weather listening hint: ${input.context.weather?.listeningHint ?? "not available"}`,
    `Diary summary: ${input.context.diary?.summary ?? "not available"}`,
    `Diary listening hint: ${input.context.diary?.listeningHint ?? "not available"}`
  ].join("\n");
  const result = await input.llm.generateText(prompt, { signal: input.signal });
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
  signal?: AbortSignal;
}): Promise<string> {
  const prompt = [
    `You are ${input.config.dj.displayName}, Pockedio's concise personal DJ.`,
    "The user is asking what they should listen to, but has not asked you to start playback.",
    "Recommend one clear listening direction in 2-4 sentences, tuned to their mood or context.",
    "End by asking whether they want you to build or play that station.",
    formatLanguageInstruction(input.config),
    "Do not claim playback has started.",
    `Calendar summary: ${input.context?.calendar?.summary ?? "not available"}`,
    `Calendar listening hint: ${input.context?.calendar?.listeningHint ?? "not available"}`,
    `Weather summary: ${input.context?.weather?.summary ?? "not available"}`,
    `Weather listening hint: ${input.context?.weather?.listeningHint ?? "not available"}`,
    `Diary summary: ${input.context?.diary?.summary ?? "not available"}`,
    `Diary listening hint: ${input.context?.diary?.listeningHint ?? "not available"}`,
    formatConversationPlaybackContext(input.playbackState),
    `User: ${input.userText}`
  ].join("\n");
  const result = await input.llm.generateText(prompt, { signal: input.signal });
  if (isUsableGeneratedText(input.config, result)) {
    return appendPendingStationChoicePrompt(result.value.trim());
  }

  return appendPendingStationChoicePrompt([
    "I could not get a polished recommendation reply this turn, but I can still help with the music.",
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

function isExplicitDjProgramPlaybackRequest(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return /\b(dj program|dj version|radio show|radio version|spoken version)\b/.test(normalized)
    && /\b(play|start|create|make|build|give me|put on|queue)\b/.test(normalized);
}

function isMidStationDjModeRequest(text: string, playbackState: InteractivePlaybackState | undefined): boolean {
  const normalized = text.trim().toLowerCase();
  return Boolean(playbackState?.currentTrackId)
    && !playbackState?.pendingStationRequest
    && !hasExplicitPlaybackCommand(text)
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
    || /\b(background|backgroun|story|history|meaning|origin|influence|influences)\b.*\b(song|track|album|artist|band|composer|singer|musician|producer)\b/.test(normalized)
    || /\b(song|track|album|artist|band|composer|singer|musician|producer)\b.*\b(background|backgroun|story|history|meaning|origin|influence|influences)\b/.test(normalized);
}

function isStationStartingIntent(type: SessionIntent["type"]): boolean {
  return type === "playback_request"
    || type === "direct_playback_request"
    || type === "single_track_playback"
    || type === "music_recommendation";
}

function isProtectedOperationalIntent(type: SessionIntent["type"]): boolean {
  return type === "stop"
    || type === "pause"
    || type === "resume"
    || type === "previous"
    || type === "playback_status"
    || type === "feedback_like"
    || type === "feedback_skip"
    || type === "feedback_ban"
    || type === "feedback_more_like_this"
    || type === "feedback_change_vibe"
    || type === "explicit_dj_audio_request"
    || type === "session_memory_update"
    || type === "pending_station_confirmation"
    || type === "pending_station_dj_program"
    || type === "pending_station_decline"
    || type === "single_track_selection";
}

function shouldHandlePendingStationFollowup(intent: SessionIntent, userText: string): boolean {
  if (!userText.trim()) {
    return false;
  }
  if (intent.type === "stop"
    || intent.type === "session_exit"
    || intent.type === "pause"
    || intent.type === "resume"
    || intent.type === "playback_status"
    || intent.type === "identity_capability"
    || intent.type === "explicit_dj_audio_request"
    || intent.type === "session_memory_update"
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
  signal?: AbortSignal;
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
  const result = await input.llm.generateText(prompt, { signal: input.signal });
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
  signal?: AbortSignal;
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
  const result = await input.llm.generateText(prompt, { signal: input.signal });
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
  return !isMostlyCjkText(text);
}

function shouldUseEnglishOutput(config: PockedioConfig | undefined): boolean {
  const language = config?.dj.language.trim().toLowerCase() ?? "english";
  return language === "en" || language.startsWith("english");
}

function isMostlyCjkText(text: string): boolean {
  const cjkCount = (text.match(/[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af]/g) ?? []).length;
  if (cjkCount === 0) {
    return false;
  }
  const latinCount = (text.match(/[a-z]/gi) ?? []).length;
  return cjkCount > latinCount;
}

async function generateIdentityCapabilityResponse(input: {
  config: PockedioConfig;
  llm: LlmClient;
  userText: string;
  signal?: AbortSignal;
}): Promise<string> {
  const displayName = input.config.dj.displayName;
  const prompt = [
    `You are ${displayName}, Pockedio's concise personal DJ in a terminal.`,
    "Answer the user's identity or capability question directly.",
    "Use the selected DJ name for identity questions.",
    "Mention real capabilities only: conversation, recommendations and stations, playback controls, queue/status, useful taste memory, and spoken DJ station/program mode.",
    "Mention memory carefully as useful taste signals, not remembering everything.",
    "Do not say you are an AI language model.",
    "Do not mention therapy disclaimers unless the user asks for mental-health support.",
    "Do not start playback.",
    "Do not end with the fixed startup phrase 'What are we tuning for?'",
    "Keep it to 1-3 concise sentences.",
    formatLanguageInstruction(input.config),
    `User: ${input.userText}`
  ].join("\n");
  const result = await input.llm.generateText(prompt, { signal: input.signal });
  if (isUsableGeneratedText(input.config, result) && isValidIdentityCapabilityResponse(result.value, displayName)) {
    return result.value.trim();
  }

  return formatIdentityCapabilityFallback(displayName);
}

function isValidIdentityCapabilityResponse(response: string, displayName: string): boolean {
  const normalized = response.toLowerCase();
  const normalizedName = displayName.toLowerCase();
  if (!normalized.includes(normalizedName)) {
    return false;
  }
  return !/\b(i am|i'm|im)\s+pockedio\b/.test(normalized);
}

function formatIdentityCapabilityFallback(displayName: string): string {
  return [
    `${displayName} is here.`,
    "I can still build stations, play music, control playback, show the queue, and make spoken DJ station versions if voice is configured.",
    "Deeper conversation and personal context may be limited until the LLM is available."
  ].join(" ");
}

async function generateConversationResponse(input: {
  config?: PockedioConfig;
  llm: LlmClient;
  userText: string;
  playbackState?: InteractivePlaybackState;
  context?: Partial<PockedioContext>;
  signal?: AbortSignal;
}): Promise<string> {
  if (!input.userText) {
    return "Tell me what you want to hear, or share what this music is bringing up.";
  }

  const prompt = formatConversationPrompt(input.userText, input.playbackState, input.config, input.context);
  const result = await input.llm.generateText(prompt, { signal: input.signal });
  if (isUsableGeneratedText(input.config, result)) {
    return result.value.trim();
  }

  return formatConversationFallback(input.userText, input.playbackState, input.config);
}

function formatConversationPrompt(
  userText: string,
  playbackState: InteractivePlaybackState | undefined,
  config?: PockedioConfig,
  context?: Partial<PockedioContext>
): string {
  const displayName = config?.dj.displayName ?? "Pockedio";
  return [
    `You are ${displayName}, Pockedio's concise personal DJ in a text conversation.`,
    "The user may be sharing a personal memory, listening insight, mood, taste signal, or a question about the current music.",
    "Reply like a radio DJ who is listening carefully: acknowledge the user, connect it to music when useful, and stay brief.",
    "Normal conversation is the default. Do not turn a question into playback unless the user explicitly asks you to play, start, queue, skip, pause, resume, or stop.",
    "For current-track questions, resolve references like 'the singer', 'this artist', 'this song', and 'this track' from the Current playback facts below.",
    "For artist or song background questions, answer from the current metadata and your general music knowledge. If you are not sure, say what is known from the listed metadata instead of inventing details.",
    config ? formatLanguageInstruction(config) : "Reply in English by default, even if the user writes in another language. Preserve song titles and artist names as written.",
    "Do not act as a therapist, diagnose the user, or give life advice.",
    "Do not claim spoken audio was generated. Do not change playback or promise queue edits unless the user explicitly asked for playback control.",
    formatConversationTasteContext(config, userText),
    formatConversationCalendarContext(context),
    formatConversationPlaybackContext(playbackState),
    `User: ${userText}`
  ].filter(Boolean).join("\n");
}

function formatConversationTasteContext(config: PockedioConfig | undefined, userText: string): string {
  if (!config || !isTasteInsightQuestion(userText) || !fs.existsSync(config.paths.taste)) {
    return "";
  }

  const taste = fs.readFileSync(config.paths.taste, "utf8").trim();
  if (!taste || !hasTasteSignals(config.paths.taste)) {
    return "Taste context: no imported taste signals yet.";
  }

  return [
    "Taste context:",
    taste.split(/\r?\n/).slice(0, 120).join("\n")
  ].join("\n");
}

function formatConversationCalendarContext(context: Partial<PockedioContext> | undefined): string {
  if (!context?.calendar) {
    return "";
  }
  return [
    `Calendar summary: ${context.calendar.summary}`,
    `Calendar listening hint: ${context.calendar.listeningHint}`
  ].join("\n");
}

function isContextualCalendarConversation(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return /\b(today|this morning|this afternoon|tonight|my day|my schedule|calendar|meeting|meetings|focus block|work block|get through|afternoon|evening|morning)\b/.test(normalized)
    && /\b(how|what|help|suggest|fit|fits|should|listen|music|feel|look|plan|through)\b/.test(normalized);
}

function isTasteInsightQuestion(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return /\b(what|how|describe|summarize|tell me|do you know|what's|what is)\b/.test(normalized)
    && /\b(my taste|my music taste|taste for music|music taste|listening taste|what i like|what do i like)\b/.test(normalized);
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
    current.album ? `Album: ${current.album}` : "",
    `Why it was selected: ${current.rationale}`,
    "Queue:",
    ...storedTracks.map((entry, index) => {
      const marker = index === currentIndex ? ">" : " ";
      return `${marker} ${entry.track.position}. ${entry.track.title} - ${entry.track.artist}`;
    })
  ].filter(Boolean).join("\n");
}

function formatConversationFallback(userText: string, playbackState: InteractivePlaybackState | undefined, config?: PockedioConfig): string {
  const displayName = config?.dj.displayName ?? "Pockedio";
  if (isCapabilityQuestion(userText)) {
    return [
      `${displayName} is here.`,
      "I can still build stations, play music, control playback, show the queue, and make spoken DJ station versions if voice is configured.",
      "Deeper conversation and personal context may be limited until the LLM is available."
    ].join(" ");
  }

  const current = playbackState?.currentIndex === undefined
    ? undefined
    : playbackState.storedTracks?.[playbackState.currentIndex]?.track;
  if (current) {
    if (isCurrentTrackQuestion(userText)) {
      return `${current.artist} is the listed artist for ${current.title}. I do not have verified credits beyond the current playback metadata right now.`;
    }
    if (isMusicKnowledgeQuestion(userText)) {
      return `I can ground this in what is playing: ${current.title} is listed under ${current.artist}. I do not have verified background details beyond the current playback metadata right now.`;
    }
    return `I hear that. I will keep ${current.title} - ${current.artist} in that personal context and let the set stay music-first.`;
  }
  if (isUnsupportedExternalAction(userText)) {
    return "I can't hand this off to another music app yet. I can keep playing here, skip, pause, show the queue, or build a new station.";
  }
  if (isAmbiguousMusicAdjustment(userText)) {
    return "Do you want me to shape a station in that direction, or just talk through the mood first?";
  }
  if (isMusicKnowledgeQuestion(userText) || isCurrentTrackQuestion(userText)) {
    return "I do not have a current track to ground that in right now. Tell me a song or artist, or start a station and I can talk about what is playing.";
  }
  if (isPersonalMoodStatement(userText)) {
    return "That sounds heavy. I can stay with the conversation, or shape something gentle if you want music for it.";
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

function isUnsupportedExternalAction(userText: string): boolean {
  const text = userText.toLowerCase();
  return /\b(spotify|apple music|youtube music)\b/.test(text)
    || /\b(crossfade|handoff|hand off|export|sync)\b.*\b(app|spotify|apple music|youtube music)\b/.test(text);
}

function isAmbiguousMusicAdjustment(userText: string): boolean {
  const text = userText.toLowerCase().trim();
  return /\b(something|maybe|more|less|a bit|little)\b/.test(text)
    && /\b(softer|harder|brighter|darker|warmer|colder|slower|faster|calmer|deeper|lighter|heavier)\b/.test(text)
    && !hasExplicitPlaybackCommand(text);
}

function isPersonalMoodStatement(userText: string): boolean {
  const text = userText.toLowerCase();
  return /\b(i'?m|i am|feel|feeling)\b.*\b(tired|exhausted|drained|stressed|grumpy|sad|anxious|overwhelmed|low)\b/.test(text);
}

export async function runInteractiveSession(config: PockedioConfig = loadConfig()): Promise<void> {
  const rl = readline.createInterface({ input: defaultInput, output: defaultOutput });
  let activeTurnController: AbortController | undefined;
  let exiting = false;
  let suppressIdleInterruptUntil = 0;
  const handleInterrupt = () => {
    if (activeTurnController) {
      if (!activeTurnController.signal.aborted) {
        suppressIdleInterruptUntil = Date.now() + 750;
        activeTurnController.abort();
      }
      return;
    }
    if (Date.now() < suppressIdleInterruptUntil) {
      return;
    }
    exiting = true;
    rl.close();
  };
  rl.on("SIGINT", () => {
    handleInterrupt();
  });
  process.on("SIGINT", handleInterrupt);
  runMigrations(config);
  const store = new MemoryStore(config);
  const sessionId = store.createSession("conversation", "interactive session");
  store.close();
  const playbackState: InteractivePlaybackState = {};
  const statusWriter = createInteractiveStatusWriter(defaultOutput);
  try {
    console.log(formatInteractiveStartupGuide(config.dj.displayName, formatStartupSetupNote(config)));
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
      const controller = new AbortController();
      activeTurnController = controller;
      const turnStatus = createTurnScopedStatusWriter(statusWriter, formatInitialInteractiveTurnStatus(line, playbackState));
      let result: SessionTurnResult;
      try {
        result = await runSessionTurn({
          input: line,
          signal: controller.signal,
          config,
          sessionId,
          endSession: false,
          playbackState,
          writeOutput: (text) => console.log(text),
          writeStatus: turnStatus.writeStatus
        });
      } catch (error) {
        if (isCancellationError(error)) {
          recordCancelledTurn(config, sessionId);
          console.log("Cancelled.");
          continue;
        }
        throw error;
      } finally {
        turnStatus.finish();
        activeTurnController = undefined;
      }
      if (result.shouldExit) {
        break;
      }
    }
  } finally {
    process.off("SIGINT", handleInterrupt);
    if (exiting) {
      defaultOutput.write("\n");
    }
    playbackState.activePlayback?.stop();
    const endStore = new MemoryStore(config);
    try {
      summarizeSession(endStore, sessionId);
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

async function reshapeRemainingQueueForFeedback(input: {
  config: PockedioConfig;
  sessionId: string;
  store: MemoryStore;
  provider: MusicProvider;
  llm: LlmClient;
  action: FeedbackAction;
  playbackState: InteractivePlaybackState;
  currentTrack: StationTrack;
  signal?: AbortSignal;
}): Promise<string> {
  const currentIndex = input.playbackState.currentIndex;
  const storedTracks = input.playbackState.storedTracks ?? [];
  const station = input.playbackState.station;
  if (currentIndex === undefined || !station || storedTracks.length <= currentIndex + 1) {
    return formatFeedbackConfirmation(input.action);
  }

  const request = buildFeedbackReshapeRequest(station.request, input.currentTrack, input.action);
  const context: Partial<PockedioContext> = {
    personality: input.config.personality,
    tasteSignals: input.store.getTasteSignals(30)
  };
  const reshaped = await generateStation({
    request,
    config: input.config,
    context,
    provider: input.provider,
    llm: input.llm,
    signal: input.signal
  });

  const remainingCount = storedTracks.length - currentIndex - 1;
  const currentKey = normalizeTrackQueueKey(input.currentTrack);
  const replacementTracks = reshaped.tracks
    .filter((track) => normalizeTrackQueueKey(track) !== currentKey)
    .slice(0, remainingCount)
    .map((track, index) => ({
      ...track,
      position: currentIndex + index + 2
    }));

  if (replacementTracks.length === 0) {
    return formatFeedbackConfirmation(input.action);
  }

  for (const old of storedTracks.slice(currentIndex + 1)) {
    input.store.updateTrackPlayback(old.dbId, "skipped");
  }

  const replacementStoredTracks = replacementTracks.map((track) => ({
    dbId: input.store.addStationTrack(input.sessionId, {
      position: track.position,
      title: track.title,
      artist: track.artist,
      album: track.album,
      provider: track.provider,
      providerTrackId: track.providerTrackId,
      playableUrl: track.playable.available ? track.playable.playableUrl : null,
      playbackStatus: track.playable.available ? "planned" : "unavailable",
      failureReason: track.playable.available ? null : track.playable.reason
    }),
    track
  }));

  input.playbackState.storedTracks = [
    ...storedTracks.slice(0, currentIndex + 1),
    ...replacementStoredTracks
  ];
  input.playbackState.station = {
    ...station,
    tracks: input.playbackState.storedTracks.map((entry) => entry.track)
  };
  cancelDjProgramPreparations(input.playbackState);

  return [
    formatFeedbackConfirmation(input.action),
    `I reshaped the rest of the queue around ${input.currentTrack.title} - ${input.currentTrack.artist}.`,
    formatUpNext(input.playbackState.storedTracks, currentIndex)
  ].join("\n");
}

function isQueueReshapeFeedback(action: FeedbackAction): boolean {
  return action === "more_like_this" || action === "less_like_this";
}

function buildFeedbackReshapeRequest(baseRequest: string, currentTrack: StationTrack, action: FeedbackAction): string {
  const direction = action === "more_like_this"
    ? `more like the current track ${currentTrack.title} - ${currentTrack.artist}`
    : `less like the current track ${currentTrack.title} - ${currentTrack.artist}, without banning it`;
  return `${baseRequest}. Feedback for remaining queue: ${direction}.`;
}

function normalizeTrackQueueKey(track: Pick<StationTrack, "title" | "artist">): string {
  return `${track.title} - ${track.artist}`.trim().toLowerCase();
}

function formatStandaloneDjAudioDisabledResponse(config: PockedioConfig): string {
  return [
    "DJ voice belongs to a station, not a loose clip.",
    `Tell ${config.dj.displayName} what kind of set you want; when I suggest it, type "dj" for a spoken DJ version.`
  ].join(" ");
}

async function generateStationDjProgramIntro(input: {
  config: PockedioConfig;
  sessionId: string;
  store: MemoryStore;
  llm: LlmClient;
  station: GeneratedStation;
  requestText: string;
  synthesize: SynthesizeFishAudio;
  playFile?: (filePath: string) => Promise<PlayerResult>;
  signal?: AbortSignal;
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
  ].join("\n"), { signal: input.signal });
  const text = isUsableGeneratedText(input.config, textResult)
    ? textResult.value.trim()
    : `${input.config.dj.displayName} here. I’ll open this as a short DJ program and ease you into the first track with the station already shaped around your request.`;
  const djAudio = shouldUseSpokenDjAudio({
    triggerType: "conversation",
    userExplicitlyRequestedDjAudio: true
  })
    ? await input.synthesize(input.config, text, { signal: input.signal })
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
    case "feedback_less_like_this":
      return "less_like_this";
    case "feedback_favorite":
      return "favorite";
    case "feedback_save_vibe":
      return "save_vibe";
    default:
      return "stop";
  }
}

function getCurrentPlaybackTrack(playbackState: InteractivePlaybackState | undefined): StationTrack | undefined {
  const currentIndex = playbackState?.currentIndex;
  if (currentIndex === undefined) {
    return undefined;
  }
  return playbackState?.storedTracks?.[currentIndex]?.track;
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
  playbackState.activePlaybackPaused = undefined;
  playbackState.currentIndex = undefined;
  playbackState.currentTrackId = undefined;
  playbackState.currentStartedAt = undefined;
}

function cancelDjProgramPreparations(playbackState: InteractivePlaybackState | undefined): void {
  const preparations = playbackState?.djProgram?.preparations;
  if (!preparations) {
    return;
  }
  for (const preparation of preparations.values()) {
    if (!preparation.ready) {
      preparation.cancel();
    }
  }
  preparations.clear();
}

async function advancePlayback(
  playbackState: InteractivePlaybackState,
  config: PockedioConfig,
  store: MemoryStore,
  startUrlPlayback: StartUrlPlayback
): Promise<string> {
  playbackState.activePlayback?.stop();
  playbackState.activePlaybackPaused = undefined;
  if (playbackState.currentTrackId) {
    store.updateTrackPlayback(playbackState.currentTrackId, "skipped");
  }
  const nextIndex = (playbackState.currentIndex ?? -1) + 1;
  const preparedIntro = getPreparedDjIntro(playbackState, nextIndex);
  const response = await startTrackAt(playbackState, config, store, nextIndex, startUrlPlayback, () => new Date(), {
    intro: preparedIntro,
    startDuckedIntroPlayback: playbackState.startDuckedIntroPlayback
  });
  return [
    formatDjIntroStillPreparingNotice(playbackState, config, nextIndex, preparedIntro),
    response
  ].filter(Boolean).join("\n");
}

async function retreatPlayback(
  playbackState: InteractivePlaybackState | undefined,
  config: PockedioConfig,
  store: MemoryStore,
  startUrlPlayback: StartUrlPlayback
): Promise<string> {
  if (!playbackState?.station || playbackState.currentIndex === undefined) {
    return "No previous track is available right now.";
  }

  const previousIndex = findPreviousPlayableIndex(playbackState, playbackState.currentIndex);
  if (previousIndex === undefined) {
    return "No previous track is available right now.";
  }

  playbackState.activePlayback?.stop();
  playbackState.activePlaybackPaused = undefined;
  if (playbackState.currentTrackId) {
    store.updateTrackPlayback(playbackState.currentTrackId, "skipped");
  }
  const preparedIntro = getPreparedDjIntro(playbackState, previousIndex);
  return startTrackAt(playbackState, config, store, previousIndex, startUrlPlayback, () => new Date(), {
    intro: preparedIntro,
    startDuckedIntroPlayback: playbackState.startDuckedIntroPlayback
  });
}

function findPreviousPlayableIndex(playbackState: InteractivePlaybackState, currentIndex: number): number | undefined {
  const storedTracks = playbackState.storedTracks ?? [];
  for (let index = currentIndex - 1; index >= 0; index -= 1) {
    if (storedTracks[index]?.track.playable.available) {
      return index;
    }
  }
  return undefined;
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

  let handle: PlaybackHandle;
  try {
    handle = options.intro?.audioPath && options.startDuckedIntroPlayback
      ? await options.startDuckedIntroPlayback(entry.track.playable.playableUrl, options.intro.audioPath)
      : await startUrlPlayback(entry.track.playable.playableUrl);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    store.updateTrackPlayback(entry.dbId, "failed", reason);
    playbackState.currentIndex = nextIndex;
    playbackState.currentTrackId = undefined;
    playbackState.currentStartedAt = undefined;
    playbackState.activePlayback = undefined;
    playbackState.activePlaybackPaused = undefined;
    return formatTrackStartFailure(entry.track, reason);
  }
  playbackState.lastIntroPlaybackResult = handle.introResult;
  if (options.intro?.audioPath) {
    recordDjProgramIntroPlayback(store, playbackState.djProgram?.sessionId, options.intro, handle.introResult);
  }
  playbackState.currentIndex = nextIndex;
  playbackState.currentTrackId = entry.dbId;
  playbackState.currentStartedAt = now();
  playbackState.activePlayback = handle;
  playbackState.activePlaybackPaused = false;
  if (options.intro?.rawText) {
    playbackState.djProgram?.spokenTrackIndexes.add(nextIndex);
  }
  prepareNextDjIntro(playbackState, config, nextIndex + 1);
  handle.done.then((result) => {
    if (playbackState.activePlayback !== handle) {
      return;
    }
    if (!result.ok) {
      void handleActivePlaybackFailure(playbackState, config, entry, result, nextIndex + 1, startUrlPlayback);
      return;
    }
    void autoAdvancePlayback(playbackState, config, entry.dbId, nextIndex + 1, startUrlPlayback);
  }).catch(() => undefined);
  store.updateTrackPlayback(entry.dbId, "playing");
  return [
    options.intro?.rawText ? formatDjTranscript(config, options.intro.rawText) : "",
    formatTrackStartSurface(entry.track, config, playbackState.currentStartedAt, now(), storedTracks, nextIndex)
  ].filter(Boolean).join("\n\n");
}

function formatPlaybackProcessFailure(track: StationTrack, result: PlayerResult): string {
  const detail = result.error
    ?? (result.signal ? `Process ended with signal ${result.signal}.` : `Process exited with code ${result.exitCode ?? "null"}.`);
  return [
    `Playback stopped unexpectedly for ${track.title} - ${track.artist}.`,
    `Playback detail: ${detail}`,
    "Trying the next track."
  ].join("\n");
}

function formatTrackStartFailure(track: StationTrack, reason: string): string {
  return [
    `I could not start ${track.title} - ${track.artist}.`,
    `Playback detail: ${reason}`,
    "Type next to try the following track, or ask for a new station."
  ].join("\n");
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

async function handleActivePlaybackFailure(
  playbackState: InteractivePlaybackState,
  config: PockedioConfig,
  failedEntry: StoredPlaybackTrack,
  result: PlayerResult,
  startIndex: number,
  startUrlPlayback: StartUrlPlayback
): Promise<void> {
  const store = new MemoryStore(config);
  try {
    const reason = result.error
      ?? (result.signal ? `Process ended with signal ${result.signal}.` : `Process exited with code ${result.exitCode ?? "null"}.`);
    store.updateTrackPlayback(failedEntry.dbId, "failed", reason);
    const failureNotice = formatPlaybackProcessFailure(failedEntry.track, result);
    const preparedIntro = getPreparedDjIntro(playbackState, startIndex);
    const nextResponse = await startTrackAt(playbackState, config, store, startIndex, startUrlPlayback, () => new Date(), {
      intro: preparedIntro,
      startDuckedIntroPlayback: playbackState.startDuckedIntroPlayback
    });
    const response = [failureNotice, nextResponse].filter(Boolean).join("\n\n");
    storePlaybackOutputMessage(store, playbackState, response);
    emitPlaybackOutput(playbackState, response);
  } finally {
    store.close();
  }
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
      storePlaybackOutputMessage(store, playbackState, response);
      emitPlaybackOutput(playbackState, response);
    } else if (playbackState.station) {
      playbackState.pendingStationRequest = playbackState.station.request;
      playbackState.pendingStationOriginalRequest = playbackState.station.request;
      const completeResponse = await formatStationCompleteResponse(playbackState, config, store);
      storePlaybackOutputMessage(store, playbackState, completeResponse);
      emitPlaybackOutput(playbackState, completeResponse);
    }
  } finally {
    store.close();
  }
}

function storePlaybackOutputMessage(store: MemoryStore, playbackState: InteractivePlaybackState, output: string): void {
  if (!playbackState.sessionId || !output.trim()) {
    return;
  }
  store.addMessage(playbackState.sessionId, "pockedio", output);
}

function emitPlaybackOutput(playbackState: InteractivePlaybackState, output: string): void {
  if (!output.trim()) {
    return;
  }
  if (playbackState.isHandlingTurn) {
    playbackState.queuedPlaybackOutputs ??= [];
    playbackState.queuedPlaybackOutputs.push(output);
    return;
  }
  playbackState.writeOutput?.(output);
}

function flushQueuedPlaybackOutputs(playbackState: InteractivePlaybackState): void {
  const outputs = playbackState.queuedPlaybackOutputs ?? [];
  if (outputs.length === 0) {
    return;
  }
  playbackState.queuedPlaybackOutputs = [];
  for (const output of outputs) {
    playbackState.writeOutput?.(output);
  }
}

async function formatStationCompleteResponse(
  playbackState: InteractivePlaybackState,
  config: PockedioConfig,
  store: MemoryStore
): Promise<string> {
  const base = "That station’s done. Press Enter to continue this vibe, or tell me where to take it next.";
  const outro = await generateStationDjProgramOutro(playbackState, config, store);
  return [
    outro,
    base
  ].filter(Boolean).join("\n\n");
}

function prepareNextDjIntro(playbackState: InteractivePlaybackState, config: PockedioConfig, nextIndex: number): void {
  const program = playbackState.djProgram;
  const tracks = playbackState.storedTracks ?? [];
  const entry = tracks[nextIndex];
  if (!program || !entry?.track.playable.available || program.preparations.has(nextIndex)) {
    return;
  }

  const cue = shouldPrepareDjIntro(playbackState, config, nextIndex);
  if (!cue.speak) {
    program.quietTrackIndexes.add(nextIndex);
    return;
  }

  const previous = nextIndex > 0 ? tracks[nextIndex - 1]?.track : undefined;
  const controller = new AbortController();
  const preparation: DjIntroPreparation = {
    ready: false,
    cancel: () => controller.abort(),
    promise: generateTrackDjProgramIntro({
      config,
      llm: program.llm,
      station: program.station,
      requestText: program.requestText,
      track: entry.track,
      previousTrack: previous,
      cueReason: cue.reason,
      synthesize: program.synthesize,
      signal: controller.signal
    }).then((intro) => {
      if (controller.signal.aborted || !intro?.audioPath) {
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

type DjCueDecision = {
  speak: boolean;
  reason: "program_pacing" | "mood_shift" | "closing_setup" | "quiet_continuation";
};

function shouldPrepareDjIntro(playbackState: InteractivePlaybackState, config: PockedioConfig, nextIndex: number): DjCueDecision {
  const program = playbackState.djProgram;
  const tracks = playbackState.storedTracks ?? [];
  const next = tracks[nextIndex]?.track;
  if (!program || !next?.playable.available || nextIndex <= 0) {
    return { speak: false, reason: "quiet_continuation" };
  }

  const maxTransitionVoices = getMaxTransitionVoices(config);
  const spokenTransitions = [...program.spokenTrackIndexes].filter((index) => index > 0).length;
  if (spokenTransitions >= maxTransitionVoices) {
    return { speak: false, reason: "quiet_continuation" };
  }

  if (nextIndex === 1) {
    return { speak: false, reason: "quiet_continuation" };
  }

  const lastSpokenIndex = Math.max(0, ...program.spokenTrackIndexes);
  const tracksSinceLastVoice = nextIndex - lastSpokenIndex;
  if (tracksSinceLastVoice < 2) {
    return { speak: false, reason: "quiet_continuation" };
  }

  const isFinalTrack = nextIndex === tracks.length - 1;
  if (isFinalTrack && maxTransitionVoices >= 2) {
    return { speak: true, reason: "closing_setup" };
  }

  const midpointIndex = Math.floor(tracks.length / 2);
  const previous = tracks[nextIndex - 1]?.track;
  if (nextIndex >= midpointIndex) {
    return {
      speak: true,
      reason: previous && hasMeaningfulDjCueShift(previous, next) ? "mood_shift" : "program_pacing"
    };
  }

  return { speak: false, reason: "quiet_continuation" };
}

function getMaxTransitionVoices(config: PockedioConfig): number {
  switch (config.dj.programLength) {
    case "short":
      return 0;
    case "extended":
      return 2;
    default:
      return 1;
  }
}

function hasMeaningfulDjCueShift(current: StationTrack, next: StationTrack): boolean {
  if (current.artist !== next.artist) {
    return true;
  }
  const currentWords = extractCueWords(current.rationale);
  const nextWords = extractCueWords(next.rationale);
  if (currentWords.size === 0 || nextWords.size === 0) {
    return false;
  }
  const shared = [...currentWords].filter((word) => nextWords.has(word)).length;
  return shared === 0;
}

function extractCueWords(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .match(/\b(r&b|soul|jazz|rock|pop|folk|electronic|downtempo|ambient|acoustic|piano|smooth|soft|mellow|warm|bright|driving|rhythmic|intimate|dreamy|nostalgic|energetic|calm|quiet|dance|groove|classic|modern)\b/g) ?? [];
  return new Set(words);
}

function formatDjIntroStillPreparingNotice(
  playbackState: InteractivePlaybackState,
  config: PockedioConfig,
  trackIndex: number,
  preparedIntro: PreparedDjIntro | undefined
): string {
  const preparation = playbackState.djProgram?.preparations.get(trackIndex);
  if (!preparation || preparedIntro || !playbackState.storedTracks?.[trackIndex]?.track.playable.available) {
    return "";
  }
  return `${config.dj.displayName} is still preparing the next voice break, so I’ll keep the music moving.`;
}

async function generateStationDjProgramOutro(
  playbackState: InteractivePlaybackState,
  config: PockedioConfig,
  store: MemoryStore
): Promise<string> {
  const program = playbackState.djProgram;
  if (!program?.playFile) {
    return "";
  }

  const textResult = await program.llm.generateText([
    `You are ${config.dj.displayName}, Pockedio's spoken DJ.`,
    "Write a short closing voice break for this completed DJ program.",
    "Keep it under 45 words.",
    formatLanguageInstruction(config),
    "Sound like the set has just ended. Do not start a new station.",
    "Invite the listener to continue the vibe or redirect it.",
    `User request: ${program.requestText}`,
    "Station tracks:",
    ...program.station.tracks.map((track) => `${track.position}. ${track.title} - ${track.artist}`)
  ].join("\n"));
  const text = isUsableGeneratedText(config, textResult)
    ? textResult.value.trim()
    : `${config.dj.displayName} here. That set has landed. We can keep this feeling going, or you can point me somewhere new.`;
  const djAudio = await program.synthesize(config, text);
  if (!djAudio.ok) {
    store.recordDjAudio(program.sessionId, "explicit", null, text, djAudio.audioPath ?? null, "text_fallback", {
      cacheExpiresAt: getExplicitDjAudioCacheExpiresAt(),
      latencyMs: djAudio.latencyMs
    });
    return formatDjAudioFallbackText(text, djAudio.error);
  }

  const playback = await program.playFile(djAudio.audioPath);
  store.recordDjAudio(program.sessionId, "explicit", null, text, djAudio.audioPath, playback.ok ? "played" : "failed", {
    cacheExpiresAt: getExplicitDjAudioCacheExpiresAt(),
    latencyMs: djAudio.latencyMs,
    fileSizeBytes: getFileSize(djAudio.audioPath)
  });

  return [
    formatDjTranscriptLabel(config),
    text,
    playback.ok ? "" : `Playback detail: ${playback.error ?? "DJ outro playback failed."}`
  ].filter(Boolean).join("\n");
}

async function generateTrackDjProgramIntro(input: {
  config: PockedioConfig;
  llm: LlmClient;
  station: GeneratedStation;
  requestText: string;
  track: StationTrack;
  previousTrack?: StationTrack;
  cueReason: DjCueDecision["reason"];
  synthesize: SynthesizeFishAudio;
  signal?: AbortSignal;
}): Promise<GeneratedDjProgramIntro | undefined> {
  const textResult = await input.llm.generateText([
    `You are ${input.config.dj.displayName}, Pockedio's spoken DJ.`,
    `Write a warm transition intro for Track ${input.track.position}: ${input.track.title} - ${input.track.artist}.`,
    "Keep it under 45 words.",
    formatLanguageInstruction(input.config),
    "Mention why this next track belongs here.",
    "Do not recap the full queue.",
    `Cue reason: ${input.cueReason}`,
    `User request: ${input.requestText}`,
    input.previousTrack ? `Previous track: ${input.previousTrack.title} - ${input.previousTrack.artist}` : "",
    `Next track rationale: ${input.track.rationale}`
  ].filter(Boolean).join("\n"));
  const text = isUsableGeneratedText(input.config, textResult)
    ? textResult.value.trim()
    : `${input.config.dj.displayName} here. Track ${input.track.position} keeps the set moving with ${input.track.title} by ${input.track.artist}.`;
  const djAudio = await input.synthesize(input.config, text, { signal: input.signal });
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
  if (storedTracks.length === 0 || currentIndex === undefined || !playbackState.currentTrackId) {
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
