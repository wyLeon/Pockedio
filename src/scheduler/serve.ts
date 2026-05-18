import inquirer from "inquirer";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { PockedioConfig } from "../config/schema.js";
import { loadConfig } from "../config/load.js";
import { buildContext, type PockedioContext } from "../context/contextBuilder.js";
import { runMigrations } from "../db/migrations.js";
import { shouldUseSpokenDjAudio } from "../dj/voiceRules.js";
import { createLlmClient } from "../llm/openaiClient.js";
import type { LlmClient } from "../llm/llmClient.js";
import { MemoryStore } from "../memory/store.js";
import { playFile as playAudioFile, playUrl as playAudioUrl, type PlayerResult } from "../player/afplay.js";
import { getPersonaForDate } from "../personas/personaStore.js";
import type { MusicProvider } from "../providers/musicProvider.js";
import { NetEaseProvider } from "../providers/netease.js";
import { generateStation } from "../station/stationGenerator.js";
import type { GeneratedStation } from "../station/stationTypes.js";
import { synthesizeFishAudio as synthesizeFishAudioDefault, type FishAudioResult } from "../tts/fishAudio.js";
import { isEveningDjTime, isMorningDjTime, scheduledJobKey, shouldPromptMoodCheck } from "./jobs.js";

export type ScheduledDjKind = "morning" | "evening";
export type ScheduledDjResult =
  | { ran: true; sessionId: string; text: string; station: GeneratedStation; djAudio: FishAudioResult }
  | { ran: false; reason: string };

export type ScheduledDjInput = {
  kind: ScheduledDjKind;
  now?: Date;
  config?: PockedioConfig;
  context?: PockedioContext;
  provider?: MusicProvider;
  llm?: LlmClient;
  synthesizeFishAudio?: (config: PockedioConfig, text: string) => Promise<FishAudioResult>;
  playFile?: (filePath: string) => Promise<PlayerResult>;
  playUrl?: (url: string) => Promise<PlayerResult>;
  writeOutput?: (text: string) => void;
};

export type MoodCheckPromptResult = {
  mood: string;
  note?: string;
  confirmPlayback: boolean;
};

export type MoodCheckInput = {
  config?: PockedioConfig;
  provider?: MusicProvider;
  llm?: LlmClient;
  promptMood?: () => Promise<MoodCheckPromptResult>;
  playUrl?: (url: string) => Promise<PlayerResult>;
  writeOutput?: (text: string) => void;
};

export type MoodCheckResult = {
  ran: true;
  mood: string;
  playbackStarted: boolean;
  station?: GeneratedStation;
};

export async function runScheduledDjJob(input: ScheduledDjInput): Promise<ScheduledDjResult> {
  const config = input.config ?? loadConfig();
  const now = input.now ?? new Date();
  runMigrations(config);
  const context = input.context ?? await buildContext(config, { now });
  if (calendarLooksBusy(context.calendar.summary)) {
    return { ran: false, reason: "Calendar indicates an active meeting." };
  }

  const persona = getPersonaForDate(config, now);
  if (!persona) {
    return { ran: false, reason: "No weekday persona is scheduled." };
  }

  const llm = input.llm ?? createLlmClient(config);
  const provider = input.provider ?? new NetEaseProvider(config);
  const synthesize = input.synthesizeFishAudio ?? synthesizeFishAudioDefault;
  const playFile = input.playFile ?? ((filePath) => playAudioFile(filePath, 60_000));
  const playUrl = input.playUrl ?? ((url) => playAudioUrl(url));
  const writeOutput = input.writeOutput ?? (() => undefined);
  const store = new MemoryStore(config);
  const triggerType = input.kind === "morning" ? "scheduled_morning" : "scheduled_evening";
  const sessionId = store.createSession(triggerType, `${input.kind} scheduled DJ`);

  try {
    store.addContextSnapshot(sessionId, {
      calendarSummary: context.calendar.summary,
      weather: context.weather,
      diarySummary: context.diary?.summary,
      personality: context.personality
    });
    const text = await generateScheduledDjText({ kind: input.kind, llm, context, personaName: persona.persona.name });
    store.addMessage(sessionId, "pockedio", text);
    writeOutput(text);

    const djAudio = shouldUseSpokenDjAudio({
      triggerType,
      userExplicitlyRequestedDjAudio: false,
      now
    })
      ? await synthesize(config, text)
      : { ok: false as const, latencyMs: 0, error: "Voice rules disabled scheduled audio." };

    if (djAudio.ok) {
      const playback = await playFile(djAudio.audioPath);
      store.recordDjAudio(sessionId, input.kind, persona.id, text, djAudio.audioPath, playback.ok ? "played" : "failed");
    } else {
      store.recordDjAudio(sessionId, input.kind, persona.id, text, djAudio.audioPath ?? null, "text_fallback");
    }

    const station = await generateStation({
      request: scheduledStationRequest(input.kind, context),
      config,
      context,
      provider,
      llm
    });
    storeStation(sessionId, store, station);
    const firstPlayable = station.tracks.find((track) => track.playable.available);
    if (firstPlayable?.playable.available) {
      await playUrl(firstPlayable.playable.playableUrl);
    }

    return { ran: true, sessionId, text, station, djAudio };
  } finally {
    store.endSession(sessionId);
    store.close();
  }
}

export async function runMoodCheckOnce(input: MoodCheckInput = {}): Promise<MoodCheckResult> {
  const config = input.config ?? loadConfig();
  runMigrations(config);
  const promptMood = input.promptMood ?? promptMoodCheck;
  const result = await promptMood();
  recordMoodCheck(config, result.mood, result.note);
  const writeOutput = input.writeOutput ?? (() => undefined);
  writeOutput(`Mood noted: ${result.mood}.`);

  if (!result.confirmPlayback) {
    return { ran: true, mood: result.mood, playbackStarted: false };
  }

  const provider = input.provider ?? new NetEaseProvider(config);
  const llm = input.llm ?? createLlmClient(config);
  const playUrl = input.playUrl ?? ((url) => playAudioUrl(url));
  const station = await generateStation({
    request: `suggest music for feeling ${result.mood}${result.note ? `: ${result.note}` : ""}`,
    config,
    provider,
    llm
  });
  const firstPlayable = station.tracks.find((track) => track.playable.available);
  if (firstPlayable?.playable.available) {
    await playUrl(firstPlayable.playable.playableUrl);
  }

  return { ran: true, mood: result.mood, playbackStarted: Boolean(firstPlayable), station };
}

export async function runServe(options: { runOnce?: string; config?: PockedioConfig } = {}): Promise<void> {
  const config = options.config ?? loadConfig();
  if (options.runOnce === "morning" || options.runOnce === "evening") {
    const result = await runScheduledDjJob({ kind: options.runOnce, config, writeOutput: (text) => console.log(text) });
    if (!result.ran) {
      console.log(result.reason);
    }
    return;
  }
  if (options.runOnce === "mood-check") {
    await runMoodCheckOnce({ config, writeOutput: (text) => console.log(text) });
    return;
  }

  const completed = new Set<string>();
  let lastMoodPromptAt: Date | null = null;
  while (true) {
    const now = new Date();
    if (isMorningDjTime(now)) {
      await runJobOnce("morning", now, completed, config);
    }
    if (isEveningDjTime(now)) {
      await runJobOnce("evening", now, completed, config);
    }
    if (shouldPromptMoodCheck(lastMoodPromptAt, now)) {
      await runMoodCheckOnce({ config, writeOutput: (text) => console.log(text) });
      lastMoodPromptAt = now;
    }
    await sleep(30_000);
  }
}

async function runJobOnce(kind: ScheduledDjKind, now: Date, completed: Set<string>, config: PockedioConfig): Promise<void> {
  const key = scheduledJobKey(kind, now);
  if (completed.has(key)) {
    return;
  }
  completed.add(key);
  const result = await runScheduledDjJob({ kind, now, config, writeOutput: (text) => console.log(text) });
  if (!result.ran) {
    console.log(result.reason);
  }
}

async function generateScheduledDjText(input: {
  kind: ScheduledDjKind;
  llm: LlmClient;
  context: PockedioContext;
  personaName: string;
}): Promise<string> {
  const scene = input.kind === "morning"
    ? "weekday 8:45 AM Morning DJ"
    : "weekday 5:00 PM Evening DJ";
  const emphasis = input.kind === "morning"
    ? "set up the first useful listening arc of the day"
    : "frame remaining agenda, decompression, commute, continued focus, or transition";
  const result = await input.llm.generateText([
    `Write concise English copy for ${scene}.`,
    `Persona: ${input.personaName}.`,
    `Goal: ${emphasis}.`,
    `Calendar: ${input.context.calendar.summary}`,
    `Weather: ${input.context.weather?.summary ?? "not available"}`,
    `Diary summary: ${input.context.diary?.summary ?? "not available"}`,
    `Personality: ${JSON.stringify(input.context.personality)}`
  ].join("\n"));
  if (result.ok) {
    return result.value;
  }
  return input.kind === "morning"
    ? "Good morning. I have a focused first hour ready."
    : "Good evening. I have a clean transition set ready.";
}

function scheduledStationRequest(kind: ScheduledDjKind, context: PockedioContext): string {
  return kind === "morning"
    ? `morning focus station for ${context.timeOfDay}`
    : "evening transition station for decompression or continued focus";
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

function recordMoodCheck(config: PockedioConfig, mood: string, note?: string): void {
  const database = new Database(config.paths.database);
  try {
    database.prepare(`
      INSERT INTO mood_checks (id, selected_mood, note, created_at)
      VALUES (?, ?, ?, ?)
    `).run(randomUUID(), mood, note ?? null, new Date().toISOString());
  } finally {
    database.close();
  }
}

async function promptMoodCheck(): Promise<MoodCheckPromptResult> {
  const answers = await inquirer.prompt<{
    mood: string;
    note?: string;
    confirmPlayback: boolean;
  }>([
    {
      type: "list",
      name: "mood",
      message: "How are you arriving right now?",
      choices: ["focused", "scattered", "tired", "restless", "calm", "heavy", "free text"]
    },
    {
      type: "input",
      name: "note",
      message: "Mood note",
      when: (answers) => answers.mood === "free text"
    },
    {
      type: "confirm",
      name: "confirmPlayback",
      message: "Start a matching station?",
      default: false
    }
  ]);
  return {
    mood: answers.mood === "free text" ? answers.note || "free text" : answers.mood,
    note: answers.note,
    confirmPlayback: answers.confirmPlayback
  };
}

function calendarLooksBusy(summary: string): boolean {
  return /\b(active meeting|meeting is active|in a meeting|busy now|currently in)\b/i.test(summary);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
