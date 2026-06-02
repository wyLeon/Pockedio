import inquirer from "inquirer";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { PockedioConfig } from "../config/schema.js";
import { loadConfig } from "../config/load.js";
import { formatCalendarStateForPrompt } from "../context/calendar.js";
import { buildContext, type PockedioContext } from "../context/contextBuilder.js";
import { runDailyContextHeartbeat, type ContextRefreshRunRecord } from "../context/heartbeat.js";
import type { DailyContextHeartbeatOptions } from "../context/heartbeat.js";
import { runMigrations } from "../db/migrations.js";
import { shouldUseSpokenDjAudio } from "../dj/voiceRules.js";
import { createLlmClient } from "../llm/openaiClient.js";
import type { LlmClient } from "../llm/llmClient.js";
import { MemoryStore } from "../memory/store.js";
import { playUrl as playAudioUrl, type PlaybackHandle, type PlayerResult } from "../player/afplay.js";
import { startDuckedUrlWithIntro } from "../player/defaultPlayer.js";
import { getPersonaForDate } from "../personas/personaStore.js";
import type { MusicProvider } from "../providers/musicProvider.js";
import { NetEaseProvider } from "../providers/netease.js";
import { generateStation } from "../station/stationGenerator.js";
import type { GeneratedStation } from "../station/stationTypes.js";
import { synthesizeDjAudio as synthesizeFishAudioDefault, type DjAudioOptions as FishAudioOptions } from "../tts/djAudio.js";
import type { FishAudioResult } from "../tts/fishAudio.js";
import {
  formatLocalDateTime,
  getScheduledDjTargetPlayTime,
  isEveningDjPrepareTime,
  isEveningDjTime,
  isMorningDjPrepareTime,
  isMorningDjTime,
  scheduledJobKey,
  scheduledPreparationJobKey,
  shouldPromptMoodCheck
} from "./jobs.js";

export type ScheduledDjKind = "morning" | "evening";
export type ScheduledDjPlaybackDecision = "play" | "later" | "skip";
export type ScheduledDjResult =
  | {
      ran: true;
      sessionId: string;
      text: string;
      djAudio: FishAudioResult;
      decision: ScheduledDjPlaybackDecision;
      playbackStarted: boolean;
      expiresAt: string;
      station?: GeneratedStation;
    }
  | { ran: false; reason: string };
export type ScheduledDjPreparationResult =
  | { ran: true; text: string; audioPath: string | null; targetPlayTime: string }
  | { ran: false; reason: string };

export type ScheduledDjInput = {
  kind: ScheduledDjKind;
  now?: Date;
  config?: PockedioConfig;
  context?: PockedioContext;
  provider?: MusicProvider;
  llm?: LlmClient;
  synthesizeFishAudio?: (config: PockedioConfig, text: string, options?: FishAudioOptions) => Promise<FishAudioResult>;
  playFile?: (filePath: string) => Promise<PlayerResult>;
  playUrl?: (url: string) => Promise<PlayerResult>;
  startDuckedIntroPlayback?: (url: string, introFilePath: string) => Promise<PlaybackHandle>;
  promptPlayback?: (message: string) => Promise<ScheduledDjPlaybackDecision>;
  writeOutput?: (text: string) => void;
};

export type ScheduledDjPreparationInput = {
  kind: ScheduledDjKind;
  now?: Date;
  config?: PockedioConfig;
  context?: PockedioContext;
  llm?: LlmClient;
  synthesizeFishAudio?: (config: PockedioConfig, text: string, options?: FishAudioOptions) => Promise<FishAudioResult>;
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
  promptTimeoutMs?: number;
  playUrl?: (url: string) => Promise<PlayerResult>;
  writeOutput?: (text: string) => void;
};

export type MoodCheckResult = {
  ran: true;
  mood: string;
  playbackStarted: boolean;
  station?: GeneratedStation;
};

const scheduledDjFishAudioTimeoutMs = 10 * 60_000;
const moodCheckScheduledGuardMinutes = 30;
const moodCheckPromptTimeoutMs = 60_000;

export type ServeTickInput = {
  config: PockedioConfig;
  now: Date;
  completed: Set<string>;
  lastMoodPromptAt: Date | null;
  moodCheckTimeoutMs?: number;
  runScheduledDj?: (kind: ScheduledDjKind, now: Date, completed: Set<string>, config: PockedioConfig) => Promise<void>;
  prepareScheduledDj?: (kind: ScheduledDjKind, now: Date, completed: Set<string>, config: PockedioConfig) => Promise<void>;
  runMoodCheck?: () => Promise<MoodCheckResult>;
  runContextHeartbeat?: (
    config: PockedioConfig,
    options: DailyContextHeartbeatOptions
  ) => Promise<ContextRefreshRunRecord | null>;
};

export type ServeTickResult = {
  lastMoodPromptAt: Date | null;
};

export async function runScheduledDjJob(input: ScheduledDjInput): Promise<ScheduledDjResult> {
  const config = input.config ?? loadConfig();
  const now = input.now ?? new Date();
  const writeOutput = input.writeOutput ?? (() => undefined);
  runMigrations(config);
  if (!input.context) {
    writeOutput(`Reading ${input.kind} DJ context...`);
  }
  const context = input.context ?? await buildContext(config, {
      now,
      calendarWindow: "last7DaysTodayAndNext3Days",
      calendarSource: "scheduled",
      consolidateMemory: true
    });
  if (!input.context) {
    writeOutput("Context ready.");
  }
  if (calendarLooksBusy(context)) {
    return { ran: false, reason: "Calendar indicates an active meeting." };
  }

  const persona = getPersonaForDate(config, now);
  if (!persona) {
    return { ran: false, reason: "No weekday persona is scheduled." };
  }

  const llm = input.llm ?? createLlmClient(config);
  const provider = input.provider ?? new NetEaseProvider(config);
  const synthesize = input.synthesizeFishAudio ?? synthesizeFishAudioDefault;
  const playUrl = input.playUrl ?? ((url) => playAudioUrl(url));
  const startDuckedPlayback = input.startDuckedIntroPlayback ?? startDuckedUrlWithIntro;
  const promptPlayback = input.promptPlayback ?? promptScheduledDjPlayback;
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
    const targetPlayTime = formatLocalDateTime(getScheduledDjTargetPlayTime(input.kind, now, config));
    const defaultExpiresAt = getScheduledAudioCacheExpiresAt(input.kind, now, config);
    if (formatLocalDateTime(now) > defaultExpiresAt) {
      return { ran: false, reason: `Scheduled ${input.kind} DJ program expired at ${defaultExpiresAt}.` };
    }
    const prepared = getPreparedScheduledDj(config, input.kind, targetPlayTime, now);
    const expiresAt = prepared?.audioCacheExpiresAt ?? defaultExpiresAt;
    if (prepared) {
      writeOutput("Using prepared DJ program.");
    } else {
      writeOutput("Writing scheduled DJ program...");
    }
    const text = prepared?.text ?? await generateScheduledDjText({ kind: input.kind, llm, context, personaName: persona.persona.name });
    store.addMessage(sessionId, "pockedio", text);

    const djAudio = prepared?.audioPath
      ? { ok: true as const, audioPath: prepared.audioPath, latencyMs: 0 }
      : shouldUseSpokenDjAudio({
          triggerType,
          userExplicitlyRequestedDjAudio: false,
          now
        })
        ? await synthesizeScheduledDjAudio(config, text, writeOutput, synthesize)
        : { ok: false as const, latencyMs: 0, error: "Voice rules disabled scheduled audio." };

    const preparationId = prepared?.id ?? savePreparedScheduledDj(config, {
      kind: input.kind,
      targetPlayTime,
      audioCacheExpiresAt: expiresAt,
      personaId: persona.id,
      text,
      audioPath: djAudio.ok ? djAudio.audioPath : null,
      status: djAudio.ok ? "generated" : "text_fallback",
      contextSummary: context.calendar.summary
    });
    const readyMessage = formatScheduledDjReadyMessage(input.kind, expiresAt);
    writeOutput(readyMessage);
    const decision = await promptPlayback(readyMessage);

    if (decision === "skip") {
      deletePreparedScheduledDj(config, preparationId);
      return { ran: true, sessionId, text, djAudio, decision, playbackStarted: false, expiresAt };
    }

    if (decision === "later") {
      return { ran: true, sessionId, text, djAudio, decision, playbackStarted: false, expiresAt };
    }

    if (!djAudio.ok) {
      writeOutput(text);
      store.recordDjAudio(sessionId, input.kind, persona.id, text, djAudio.audioPath ?? null, "text_fallback", {
        cacheExpiresAt: expiresAt,
        latencyMs: djAudio.latencyMs
      });
      updatePreparedScheduledDjStatus(config, preparationId, "text_fallback");
    }

    writeOutput("Building scheduled station...");
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
      writeOutput(formatScheduledDjLineup(station, firstPlayable.position));
      writeOutput(formatScheduledNowPlaying(firstPlayable, station.tracks.length));
      if (djAudio.ok) {
        const handle = await startDuckedPlayback(firstPlayable.playable.playableUrl, djAudio.audioPath);
        store.recordDjAudio(sessionId, input.kind, persona.id, text, djAudio.audioPath, handle.introResult?.ok ? "played" : "failed", {
          cacheExpiresAt: expiresAt,
          latencyMs: djAudio.latencyMs
        });
        updatePreparedScheduledDjStatus(config, preparationId, handle.introResult?.ok ? "played" : "failed");
        handle.done.catch(() => undefined);
      } else {
        await playUrl(firstPlayable.playable.playableUrl);
      }
    }

    return { ran: true, sessionId, text, station, djAudio, decision, playbackStarted: Boolean(firstPlayable), expiresAt };
  } finally {
    store.endSession(sessionId);
    store.close();
  }
}

export async function prepareScheduledDjJob(input: ScheduledDjPreparationInput): Promise<ScheduledDjPreparationResult> {
  const config = input.config ?? loadConfig();
  const now = input.now ?? new Date();
  const writeOutput = input.writeOutput ?? (() => undefined);
  runMigrations(config);
  if (!input.context) {
    writeOutput(`Reading ${input.kind} DJ context...`);
  }
  const context = input.context ?? await buildContext(config, {
    now,
    calendarWindow: "last7DaysTodayAndNext3Days",
    calendarSource: "scheduled",
    consolidateMemory: true
  });
  if (!input.context) {
    writeOutput("Context ready.");
  }
  if (calendarLooksBusy(context)) {
    return { ran: false, reason: "Calendar indicates an active meeting." };
  }

  const persona = getPersonaForDate(config, now);
  if (!persona) {
    return { ran: false, reason: "No weekday persona is scheduled." };
  }

  const llm = input.llm ?? createLlmClient(config);
  const synthesize = input.synthesizeFishAudio ?? synthesizeFishAudioDefault;
  const targetPlayTime = formatLocalDateTime(getScheduledDjTargetPlayTime(input.kind, now, config));

  writeOutput("Writing scheduled DJ program...");
  const text = await generateScheduledDjText({ kind: input.kind, llm, context, personaName: persona.persona.name });
  const djAudio = shouldUseSpokenDjAudio({
    triggerType: input.kind === "morning" ? "scheduled_morning" : "scheduled_evening",
    userExplicitlyRequestedDjAudio: false,
    now: getScheduledDjTargetPlayTime(input.kind, now, config)
  })
    ? await synthesizeScheduledDjAudio(config, text, writeOutput, synthesize)
    : { ok: false as const, latencyMs: 0, error: "Voice rules disabled scheduled audio." };

  const audioCacheExpiresAt = getScheduledAudioCacheExpiresAt(input.kind, now, config);
  savePreparedScheduledDj(config, {
    kind: input.kind,
    targetPlayTime,
    audioCacheExpiresAt,
    personaId: persona.id,
    text,
    audioPath: djAudio.ok ? djAudio.audioPath : null,
    status: djAudio.ok ? "generated" : "text_fallback",
    contextSummary: context.calendar.summary
  });
  writeOutput(formatScheduledDjPreparedMessage(input.kind, targetPlayTime, audioCacheExpiresAt));

  return {
    ran: true,
    text,
    audioPath: djAudio.ok ? djAudio.audioPath : null,
    targetPlayTime
  };
}

export async function runMoodCheckOnce(input: MoodCheckInput = {}): Promise<MoodCheckResult> {
  const config = input.config ?? loadConfig();
  runMigrations(config);
  const promptMood = input.promptMood ?? (() => promptMoodCheck(input.promptTimeoutMs ?? moodCheckPromptTimeoutMs));
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
    const tick = await runServeTick({ config, now, completed, lastMoodPromptAt });
    lastMoodPromptAt = tick.lastMoodPromptAt;
    await sleep(30_000);
  }
}

export async function runServeTick(input: ServeTickInput): Promise<ServeTickResult> {
  const runContextHeartbeat = input.runContextHeartbeat ?? runDailyContextHeartbeat;
  void runContextHeartbeat(input.config, { now: input.now }).catch(() => undefined);
  const runScheduled = input.runScheduledDj ?? runJobOnce;
  const prepareScheduled = input.prepareScheduledDj ?? prepareJobOnce;
  if (isMorningDjPrepareTime(input.now, input.config)) {
    await prepareScheduled("morning", input.now, input.completed, input.config);
  }
  if (isEveningDjPrepareTime(input.now, input.config)) {
    await prepareScheduled("evening", input.now, input.completed, input.config);
  }
  if (isMorningDjTime(input.now, input.config)) {
    await runScheduled("morning", input.now, input.completed, input.config);
  }
  if (isEveningDjTime(input.now, input.config)) {
    await runScheduled("evening", input.now, input.completed, input.config);
  }
  if (
    shouldPromptMoodCheck(input.lastMoodPromptAt, input.now)
    && !hasScheduledDjSoon(input.now, input.config, moodCheckScheduledGuardMinutes)
  ) {
    const timeoutMs = input.moodCheckTimeoutMs ?? moodCheckPromptTimeoutMs;
    const runMood = input.runMoodCheck ?? (() => runMoodCheckOnce({
      config: input.config,
      promptTimeoutMs: timeoutMs,
      writeOutput: (text) => console.log(text)
    }));
    await runMoodCheckWithTimeout(runMood, timeoutMs);
    return { lastMoodPromptAt: input.now };
  }
  return { lastMoodPromptAt: input.lastMoodPromptAt };
}

async function runMoodCheckWithTimeout(runMood: () => Promise<MoodCheckResult>, timeoutMs: number): Promise<void> {
  if (timeoutMs <= 0) {
    await runMood();
    return;
  }
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      runMood(),
      new Promise<"timeout">((resolve) => {
        timeout = setTimeout(() => resolve("timeout"), timeoutMs);
      })
    ]);
  } catch (error) {
    if (!isAbortPromptError(error)) {
      throw error;
    }
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
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

async function prepareJobOnce(kind: ScheduledDjKind, now: Date, completed: Set<string>, config: PockedioConfig): Promise<void> {
  const key = scheduledPreparationJobKey(kind, now);
  if (completed.has(key)) {
    return;
  }
  completed.add(key);
  const result = await prepareScheduledDjJob({ kind, now, config, writeOutput: (text) => console.log(text) });
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
    "This is a spoken opening, not the full program transcript.",
    "Keep it under 70 words.",
    `Local scheduled moment: ${formatScheduledMomentForPrompt(new Date(input.context.now))}. Use this exact weekday/time if you mention it.`,
    `Persona: ${input.personaName}.`,
    `Goal: ${emphasis}.`,
    "Mention the moment and ease into the first track.",
    "Do not list every track.",
    "Do not tell the user to press play, click play, or start playback; the CLI controls playback outside this spoken script.",
    `Calendar: ${input.context.calendar.summary}`,
    `Calendar listening hint: ${input.context.calendar.listeningHint}`,
    formatCalendarStateForPrompt(input.context.calendar.state),
    `Weather: ${input.context.weather?.summary ?? "not available"}`,
    `Weather listening hint: ${input.context.weather?.listeningHint ?? "not available"}`,
    `Diary summary: ${input.context.diary?.summary ?? "not available"}`,
    `Diary listening hint: ${input.context.diary?.listeningHint ?? "not available"}`,
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
    ? [
        "scheduled morning DJ program",
        "exactly five tracks",
        "first useful listening arc of the day",
        "focus, energy, weather, calendar pressure, diary state, and user taste",
        `time context: ${context.timeOfDay}`
      ].join("; ")
    : [
        "scheduled evening DJ program",
        "exactly five tracks",
        "transition out of the workday",
        "decompression, commute, remaining focus, weather, calendar residue, diary state, and user taste",
        `time context: ${context.timeOfDay}`
      ].join("; ");
}

function formatScheduledDjReadyMessage(kind: ScheduledDjKind, expiresAt: string): string {
  const label = kind === "morning" ? "Morning" : "Evening";
  return [
    `${label} DJ program is ready.`,
    "",
    "Press Enter to play now, type \"later\" to keep it, or type \"skip\" to dismiss.",
    `Available for 6 hours, until ${formatScheduledExpiryForUser(expiresAt)}.`
  ].join("\n");
}

function formatScheduledDjPreparedMessage(kind: ScheduledDjKind, targetPlayTime: string, expiresAt: string): string {
  const label = kind === "morning" ? "Morning" : "Evening";
  return `${label} DJ program prepared for ${targetPlayTime}. Available for 6 hours, until ${formatScheduledExpiryForUser(expiresAt)}.`;
}

function formatScheduledExpiryForUser(expiresAt: string): string {
  const expiry = new Date(expiresAt);
  const now = new Date();
  const time = `${pad(expiry.getHours())}:${pad(expiry.getMinutes())}`;
  if (expiry.toDateString() === now.toDateString()) {
    return `${time} today`;
  }
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (expiry.toDateString() === tomorrow.toDateString()) {
    return `${time} tomorrow`;
  }
  return `${time} on ${expiry.getFullYear()}-${pad(expiry.getMonth() + 1)}-${pad(expiry.getDate())}`;
}

function formatScheduledDjLineup(station: GeneratedStation, currentPosition: number): string {
  return [
    "DJ program lineup:",
    ...station.tracks.map((track) => {
      const marker = track.position === currentPosition ? ">" : " ";
      const suffix = track.playable.available ? "" : " (unavailable)";
      return `${marker} ${track.position}. ${track.title} - ${track.artist}${suffix}`;
    })
  ].join("\n");
}

function formatScheduledNowPlaying(track: GeneratedStation["tracks"][number], totalTracks: number): string {
  return `Now playing: ${track.position}/${totalTracks}  ${track.title} - ${track.artist}`;
}

function formatScheduledMomentForPrompt(date: Date): string {
  const weekday = new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(date);
  return `${weekday} ${formatLocalDateTime(date)}`;
}

async function synthesizeScheduledDjAudio(
  config: PockedioConfig,
  text: string,
  writeOutput: (text: string) => void,
  synthesize: (config: PockedioConfig, text: string, options?: FishAudioOptions) => Promise<FishAudioResult>
): Promise<FishAudioResult> {
  writeOutput("Preparing scheduled DJ voice...");
  const result = await synthesize(config, text, { timeoutMs: scheduledDjFishAudioTimeoutMs });
  writeOutput(result.ok ? "Scheduled DJ voice ready." : "Scheduled DJ voice unavailable; text fallback is ready.");
  return result;
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

type PreparedScheduledDj = {
  id: string;
  text: string;
  audioPath: string | null;
  audioCacheExpiresAt: string | null;
};

type PreparedScheduledDjInput = {
  kind: ScheduledDjKind;
  targetPlayTime: string;
  audioCacheExpiresAt: string;
  personaId: string;
  text: string;
  audioPath: string | null;
  status: "generated" | "played" | "failed" | "text_fallback";
  contextSummary: string;
};

function savePreparedScheduledDj(config: PockedioConfig, input: PreparedScheduledDjInput): string {
  const database = new Database(config.paths.database);
  const id = randomUUID();
  try {
    database.prepare(`
      INSERT INTO scheduled_dj_preparations (
        id, kind, target_play_time, prepared_at, persona_id, text, audio_path, audio_cache_expires_at, status, context_summary
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.kind,
      input.targetPlayTime,
      new Date().toISOString(),
      input.personaId,
      input.text,
      input.audioPath,
      input.audioCacheExpiresAt,
      input.status,
      input.contextSummary
    );
    return id;
  } finally {
    database.close();
  }
}

function getPreparedScheduledDj(
  config: PockedioConfig,
  kind: ScheduledDjKind,
  targetPlayTime: string,
  now: Date
): PreparedScheduledDj | null {
  const database = new Database(config.paths.database, { readonly: true });
  try {
    const row = database.prepare(`
      SELECT id, text, audio_path as audioPath, audio_cache_expires_at as audioCacheExpiresAt
      FROM scheduled_dj_preparations
      WHERE kind = ? AND target_play_time = ? AND status IN ('generated', 'text_fallback')
        AND (audio_cache_expires_at IS NULL OR audio_cache_expires_at > ?)
      ORDER BY prepared_at DESC
      LIMIT 1
    `).get(kind, targetPlayTime, formatLocalDateTime(now)) as PreparedScheduledDj | undefined;
    return row ?? null;
  } finally {
    database.close();
  }
}

function getScheduledAudioCacheExpiresAt(kind: ScheduledDjKind, date: Date, config: PockedioConfig): string {
  const target = getScheduledDjTargetPlayTime(kind, date, config);
  return formatLocalDateTime(new Date(target.getTime() + 6 * 60 * 60 * 1000));
}

function updatePreparedScheduledDjStatus(
  config: PockedioConfig,
  id: string,
  status: PreparedScheduledDjInput["status"]
): void {
  const database = new Database(config.paths.database);
  try {
    database.prepare("UPDATE scheduled_dj_preparations SET status = ? WHERE id = ?").run(status, id);
  } finally {
    database.close();
  }
}

function deletePreparedScheduledDj(config: PockedioConfig, id: string): void {
  const database = new Database(config.paths.database);
  try {
    database.prepare("DELETE FROM scheduled_dj_preparations WHERE id = ?").run(id);
  } finally {
    database.close();
  }
}

async function promptMoodCheck(timeoutMs: number): Promise<MoodCheckPromptResult> {
  const prompt = timeoutMs > 0
    ? inquirer.createPromptModule({ signal: AbortSignal.timeout(timeoutMs) })
    : inquirer.prompt;
  const answers = await prompt<{
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

async function promptScheduledDjPlayback(message: string): Promise<ScheduledDjPlaybackDecision> {
  void message;
  if (!process.stdin.isTTY) {
    return "later";
  }
  const answer = await inquirer.prompt<{ decision: string }>([{
    type: "input",
    name: "decision",
    message: "Scheduled DJ",
    default: ""
  }]);
  const normalized = answer.decision.trim().toLowerCase();
  if (normalized === "" || normalized === "play" || normalized === "yes" || normalized === "y") {
    return "play";
  }
  if (normalized === "skip" || normalized === "dismiss") {
    return "skip";
  }
  return "later";
}

function calendarLooksBusy(context: PockedioContext): boolean {
  return (context.calendar.available && context.calendar.state?.nowStatus === "in_event")
    || /\b(active meeting|meeting is active|in a meeting|busy now|currently in)\b/i.test(context.calendar.summary);
}

function isAbortPromptError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortPromptError";
}

function hasScheduledDjSoon(now: Date, config: PockedioConfig, windowMinutes: number): boolean {
  return (["morning", "evening"] as const).some((kind) => {
    const schedule = config.dj.schedule[kind];
    if (!schedule.enabled) {
      return false;
    }
    const target = getScheduledDjTargetPlayTime(kind, now, config);
    const prepareAt = new Date(target.getTime() - schedule.prepareMinutesBefore * 60_000);
    return isDateWithinFutureWindow(prepareAt, now, windowMinutes) || isDateWithinFutureWindow(target, now, windowMinutes);
  });
}

function isDateWithinFutureWindow(candidate: Date, now: Date, windowMinutes: number): boolean {
  const diffMs = candidate.getTime() - now.getTime();
  return diffMs >= 0 && diffMs <= windowMinutes * 60_000;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}
