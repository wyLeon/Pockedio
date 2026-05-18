import readline from "node:readline/promises";
import { stdin as defaultInput, stdout as defaultOutput } from "node:process";
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
import { playFile as playAudioFile, playUrl as playAudioUrl, type PlayerResult } from "../player/afplay.js";
import type { MusicProvider } from "../providers/musicProvider.js";
import { NetEaseProvider } from "../providers/netease.js";
import { generateStation } from "../station/stationGenerator.js";
import type { GeneratedStation, StationTrack } from "../station/stationTypes.js";
import { synthesizeFishAudio as synthesizeFishAudioDefault, type FishAudioResult } from "../tts/fishAudio.js";
import { parseIntent, type SessionIntent } from "./intent.js";

type OutputWriter = (text: string) => void;

export type SessionTurnInput = {
  input: string;
  config?: PockedioConfig;
  sessionId?: string;
  endSession?: boolean;
  provider?: MusicProvider;
  llm?: LlmClient;
  buildContext?: (config: PockedioConfig) => Promise<Partial<PockedioContext>>;
  writeOutput?: OutputWriter;
  playUrl?: (url: string) => Promise<PlayerResult>;
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

export async function runSessionTurn(input: SessionTurnInput): Promise<SessionTurnResult> {
  const config = input.config ?? loadConfig();
  runMigrations(config);

  const provider = input.provider ?? new NetEaseProvider(config);
  const llm = input.llm ?? createLlmClient(config);
  const store = new MemoryStore(config);
  const writeOutput = input.writeOutput ?? (() => undefined);
  const playUrl = input.playUrl ?? ((url) => playAudioUrl(url, 30_000));
  const playFile = input.playFile ?? ((filePath) => playAudioFile(filePath, 60_000));
  const synthesize = input.synthesizeFishAudio ?? synthesizeFishAudioDefault;
  const userText = input.input.trim();
  const sessionId = input.sessionId ?? store.createSession("conversation", userText);
  const shouldEndSession = input.endSession ?? !input.sessionId;

  try {
    store.addMessage(sessionId, "user", userText);
    const intent = await parseIntent(userText, llm);

    if (intent.type === "stop") {
      const response = "Stopping cleanly.";
      store.addMessage(sessionId, "pockedio", response);
      writeOutput(response);
      return { sessionId, intent, response, shouldExit: true };
    }

    if (isFeedbackIntent(intent.type)) {
      const action = feedbackActionForIntent(intent.type);
      store.addFeedback(sessionId, null, action, userText);
      const response = formatFeedbackConfirmation(action);
      store.addMessage(sessionId, "pockedio", response);
      writeOutput(response);
      return { sessionId, intent, response, shouldExit: false };
    }

    if (intent.type === "explicit_dj_audio_request") {
      const response = await generateDjAudioResponse({ config, sessionId, store, llm, userText, synthesize, playFile });
      store.addMessage(sessionId, "pockedio", response.text);
      writeOutput(response.text);
      return { sessionId, intent, response: response.text, shouldExit: false, djAudio: response.djAudio };
    }

    if (intent.type === "playback_request" || intent.type === "direct_playback_request") {
      const context = await (input.buildContext ?? buildContext)(config);
      store.addContextSnapshot(sessionId, {
        calendarSummary: context.calendar?.summary,
        weather: context.weather,
        diarySummary: context.diary?.summary,
        personality: context.personality ?? config.personality
      });
      const station = await generateStation({ request: userText, config, context, provider, llm });
      storeStation(sessionId, store, station);
      const firstPlayable = station.tracks.find((track) => track.playable.available);
      let playbackFailure: string | undefined;
      if (firstPlayable?.playable.available) {
        const playback = await playUrl(firstPlayable.playable.playableUrl);
        if (!playback.ok) {
          playbackFailure = playback.error ?? "Playback failed.";
        }
      }

      const response = [
        intent.type === "direct_playback_request" ? formatDirectPlaybackConfirmation(station) : formatStationIntro(station),
        formatUnavailableTrackFallbackForResponse(station.tracks),
        playbackFailure ? `Playback detail: ${playbackFailure}` : ""
      ].filter(Boolean).join("\n");

      store.addMessage(sessionId, "pockedio", response);
      writeOutput(response);

      if (shouldUseSpokenDjAudio({ triggerType: "normal_playback", userExplicitlyRequestedDjAudio: false })) {
        await synthesize(config, response);
      }

      return { sessionId, intent, response, shouldExit: false, station };
    }

    const response = "Tell me what you want to hear, or ask for a station.";
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

export async function runInteractiveSession(config: PockedioConfig = loadConfig()): Promise<void> {
  const rl = readline.createInterface({ input: defaultInput, output: defaultOutput });
  rl.on("SIGINT", () => {
    rl.close();
  });
  runMigrations(config);
  const store = new MemoryStore(config);
  const sessionId = store.createSession("conversation", "interactive session");
  store.close();
  try {
    console.log("Pockedio is listening.");
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
        writeOutput: (text) => console.log(text)
      });
      if (result.shouldExit) {
        break;
      }
    }
  } finally {
    const endStore = new MemoryStore(config);
    try {
      endStore.endSession(sessionId);
    } finally {
      endStore.close();
    }
    rl.close();
  }
}

function storeStation(sessionId: string, store: MemoryStore, station: GeneratedStation): void {
  for (const track of station.tracks) {
    store.addStationTrack(sessionId, {
      position: track.position,
      title: track.title,
      artist: track.artist,
      album: track.album,
      provider: track.provider,
      providerTrackId: track.providerTrackId,
      playableUrl: track.playable.available ? track.playable.playableUrl : null,
      playbackStatus: track.playable.available ? (track.position === 1 ? "playing" : "planned") : "unavailable",
      failureReason: track.playable.available ? null : track.playable.reason
    });
  }
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
    input.store.recordDjAudio(input.sessionId, "explicit", null, text, djAudio.audioPath ?? null, "text_fallback");
    return { text: formatDjAudioFallbackText(text, djAudio.error), djAudio };
  }

  const playback = await input.playFile(djAudio.audioPath);
  input.store.recordDjAudio(input.sessionId, "explicit", null, text, djAudio.audioPath, playback.ok ? "played" : "failed");
  return { text, djAudio };
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
