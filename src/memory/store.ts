import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { openDatabase } from "../db/database.js";
import type { PockedioConfig } from "../config/schema.js";

export type SessionTriggerType = "conversation" | "scheduled_morning" | "scheduled_evening" | "mood_check" | "explicit_dj_audio";
export type MessageRole = "user" | "pockedio" | "system";
export type PlaybackStatus = "planned" | "playing" | "played" | "skipped" | "unavailable" | "failed";
export type FeedbackAction = "like" | "skip" | "ban" | "more_like_this" | "change_vibe" | "less_like_this" | "favorite" | "save_vibe" | "stop";
export type MemoryKind = "agenda" | "diary" | "taste" | "feedback" | "summary" | "personality";
export type DjAudioKind = "morning" | "evening" | "explicit";
export type DjAudioStatus = "generated" | "played" | "failed" | "text_fallback";
export type CalendarEventSource = "setup" | "interactive" | "scheduled";
export type TasteSignalType = "positive_seed" | "negative_seed" | "ban" | "favorite" | "vibe_preset";
export type TasteSignalTargetType = "track" | "artist" | "station_request" | "vibe";

export type DjAudioCacheMetadata = {
  cacheExpiresAt?: string | null;
  voiceModel?: string | null;
  latencyMs?: number | null;
  fileSizeBytes?: number | null;
};

export type StationTrackInput = {
  position: number;
  title: string;
  artist: string;
  album?: string | null;
  provider: string;
  providerTrackId?: string | null;
  playableUrl?: string | null;
  playbackStatus?: PlaybackStatus;
  failureReason?: string | null;
};

export type ContextSnapshotInput = {
  calendarSummary?: string | null;
  weather?: unknown;
  diarySummary?: string | null;
  personality?: unknown;
};

export type CalendarEventInput = {
  calendarName: string;
  title: string;
  startTime: string;
  endTime: string;
  isAllDay: boolean;
  source: CalendarEventSource;
  readAt?: string;
};

export type DiarySummaryInput = {
  sourceFile: string;
  sourceMtime: string;
  summary: string;
  generatedAt?: string;
};

export type DiarySummaryRecord = Required<DiarySummaryInput>;

export type RecentSessionSummary = {
  id: string;
  startedAt: string;
  triggerType: SessionTriggerType;
  triggerText: string;
};

export type RecentPlayedTrack = {
  title: string;
  artist: string;
};

export type MessageRecord = {
  role: MessageRole;
  content: string;
  createdAt: string;
};

export type MemorySummaryRecord = {
  id: string;
  kind?: MemoryKind;
  sourceSessionId: string | null;
  content: string;
  metadata: unknown;
  createdAt: string;
};

export type TasteSignalInput = {
  sourceFeedbackId?: string | null;
  trackId?: string | null;
  signalType: TasteSignalType;
  targetType: TasteSignalTargetType;
  targetValue: string;
  weight: number;
  context?: unknown;
};

export type TasteSignalRecord = {
  id: string;
  sourceFeedbackId: string | null;
  trackId: string | null;
  signalType: TasteSignalType;
  targetType: TasteSignalTargetType;
  targetValue: string;
  weight: number;
  context: unknown;
  createdAt: string;
};

export type TasteProfileSnapshotRecord = {
  id: string;
  summary: string;
  metadata: unknown;
  createdAt: string;
};

export type FavoriteTrackCandidate = {
  title: string;
  artist: string;
  targetValue: string;
  weight: number;
  context: unknown;
  createdAt: string;
};

export class MemoryStore {
  private readonly db: Database.Database;
  private readonly ownsConnection: boolean;

  constructor(configOrDb: PockedioConfig | Database.Database) {
    if (isDatabase(configOrDb)) {
      this.db = configOrDb;
      this.ownsConnection = false;
    } else {
      this.db = openDatabase(configOrDb);
      this.ownsConnection = true;
    }
  }

  close(): void {
    if (this.ownsConnection) {
      this.db.close();
    }
  }

  createSession(triggerType: SessionTriggerType, triggerText: string): string {
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO sessions (id, started_at, trigger_type, trigger_text)
      VALUES (?, ?, ?, ?)
    `).run(id, nowIso(), triggerType, triggerText);
    return id;
  }

  endSession(sessionId: string): void {
    this.db.prepare("UPDATE sessions SET ended_at = ? WHERE id = ?").run(nowIso(), sessionId);
  }

  addMessage(sessionId: string, role: MessageRole, content: string): string {
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO messages (id, session_id, role, content, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, sessionId, role, content, nowIso());
    return id;
  }

  getSessionMessages(sessionId: string): MessageRecord[] {
    return this.db.prepare(`
      SELECT role, content, created_at as createdAt
      FROM messages
      WHERE session_id = ?
      ORDER BY created_at ASC, rowid ASC
    `).all(sessionId) as MessageRecord[];
  }

  addStationTrack(sessionId: string, track: StationTrackInput): string {
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO station_tracks (
        id, session_id, position, title, artist, album, provider, provider_track_id,
        playable_url, playback_status, failure_reason
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      sessionId,
      track.position,
      track.title,
      track.artist,
      track.album ?? null,
      track.provider,
      track.providerTrackId ?? null,
      track.playableUrl ?? null,
      track.playbackStatus ?? "planned",
      track.failureReason ?? null
    );
    return id;
  }

  updateTrackPlayback(trackId: string, status: PlaybackStatus, failureReason?: string): void {
    this.db.prepare(`
      UPDATE station_tracks
      SET playback_status = ?, failure_reason = ?
      WHERE id = ?
    `).run(status, failureReason ?? null, trackId);
  }

  getRecentPlayedTracks(limit: number): RecentPlayedTrack[] {
    return this.db.prepare(`
      SELECT st.title, st.artist
      FROM station_tracks st
      INNER JOIN sessions s ON s.id = st.session_id
      WHERE st.playback_status IN ('played', 'playing', 'skipped')
      ORDER BY s.started_at DESC, st.position DESC, st.rowid DESC
      LIMIT ?
    `).all(limit) as RecentPlayedTrack[];
  }

  addFeedback(sessionId: string, trackId: string | null, action: FeedbackAction, note?: string): string {
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO feedback (id, session_id, track_id, action, note, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, sessionId, trackId, action, note ?? null, nowIso());
    return id;
  }

  addTasteSignal(signal: TasteSignalInput): string {
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO taste_signals (
        id, source_feedback_id, track_id, signal_type, target_type, target_value, weight, context_json, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      signal.sourceFeedbackId ?? null,
      signal.trackId ?? null,
      signal.signalType,
      signal.targetType,
      signal.targetValue,
      signal.weight,
      signal.context === undefined ? null : JSON.stringify(signal.context),
      nowIso()
    );
    return id;
  }

  addTasteSignals(signals: TasteSignalInput[]): string[] {
    return signals.map((signal) => this.addTasteSignal(signal));
  }

  recordFeedbackWithTasteSignals(
    sessionId: string,
    trackId: string | null,
    action: FeedbackAction,
    note: string | undefined,
    signals: Omit<TasteSignalInput, "sourceFeedbackId">[]
  ): string {
    const feedbackId = this.addFeedback(sessionId, trackId, action, note);
    this.addTasteSignals(signals.map((signal) => ({
      ...signal,
      sourceFeedbackId: feedbackId,
      trackId: signal.trackId ?? trackId
    })));
    return feedbackId;
  }

  getTasteSignals(limit: number): TasteSignalRecord[] {
    const rows = this.db.prepare(`
      SELECT id, source_feedback_id as sourceFeedbackId, track_id as trackId,
        signal_type as signalType, target_type as targetType, target_value as targetValue,
        weight, context_json as contextJson, created_at as createdAt
      FROM taste_signals
      ORDER BY created_at DESC
      LIMIT ?
    `).all(limit) as Array<Omit<TasteSignalRecord, "context"> & { contextJson: string | null }>;
    return rows.map(({ contextJson, ...row }) => ({
      ...row,
      context: parseJson(contextJson)
    }));
  }

  getTasteSignalCount(): number {
    const row = this.db.prepare("SELECT COUNT(*) as count FROM taste_signals").get() as { count: number };
    return row.count;
  }

  getFavoriteTrackCandidates(limit: number): FavoriteTrackCandidate[] {
    const rows = this.db.prepare(`
      SELECT target_value as targetValue, weight, context_json as contextJson, created_at as createdAt
      FROM taste_signals
      WHERE signal_type = 'favorite' AND target_type = 'track'
      ORDER BY weight DESC, created_at DESC, rowid DESC
      LIMIT ?
    `).all(limit) as Array<{ targetValue: string; weight: number; contextJson: string | null; createdAt: string }>;

    const seen = new Set<string>();
    return rows.flatMap((row) => {
      const parsed = parseFavoriteTrackTarget(row.targetValue);
      if (!parsed) {
        return [];
      }
      const dedupeKey = normalizeFavoriteTrackTarget(row.targetValue);
      if (seen.has(dedupeKey)) {
        return [];
      }
      seen.add(dedupeKey);
      return [{
        ...parsed,
        targetValue: row.targetValue,
        weight: row.weight,
        context: parseJson(row.contextJson),
        createdAt: row.createdAt
      }];
    });
  }

  hasFavoriteTrackTarget(targetValue: string): boolean {
    const row = this.db.prepare(`
      SELECT 1
      FROM taste_signals
      WHERE signal_type = 'favorite' AND target_type = 'track' AND target_value = ?
      LIMIT 1
    `).get(targetValue) as { 1: number } | undefined;
    return row !== undefined;
  }

  addTasteProfileSnapshot(summary: string, metadata?: unknown): string {
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO taste_profile_snapshots (id, summary, metadata_json, created_at)
      VALUES (?, ?, ?, ?)
    `).run(id, summary, metadata === undefined ? null : JSON.stringify(metadata), nowIso());
    return id;
  }

  getLatestTasteProfileSnapshot(): TasteProfileSnapshotRecord | null {
    const row = this.db.prepare(`
      SELECT id, summary, metadata_json as metadataJson, created_at as createdAt
      FROM taste_profile_snapshots
      ORDER BY created_at DESC
      LIMIT 1
    `).get() as { id: string; summary: string; metadataJson: string | null; createdAt: string } | undefined;
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      summary: row.summary,
      metadata: parseJson(row.metadataJson),
      createdAt: row.createdAt
    };
  }

  addMemoryItem(kind: MemoryKind, content: string, metadata?: unknown, sourceSessionId?: string): string {
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO memory_items (id, kind, source_session_id, content, metadata_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, kind, sourceSessionId ?? null, content, metadata === undefined ? null : JSON.stringify(metadata), nowIso());
    return id;
  }

  addSessionSummary(sessionId: string, content: string, metadata?: unknown): string {
    return this.addMemoryItem("summary", content, metadata, sessionId);
  }

  replaceMemoryItemBySourceKey(kind: MemoryKind, sourceKey: string, content: string, metadata?: Record<string, unknown>): string {
    this.db.prepare(`
      DELETE FROM memory_items
      WHERE kind = ? AND json_extract(metadata_json, '$.sourceKey') = ?
    `).run(kind, sourceKey);
    return this.addMemoryItem(kind, content, { ...(metadata ?? {}), sourceKey });
  }

  getRecentMemorySummaries(limit: number): MemorySummaryRecord[] {
    const rows = this.db.prepare(`
      SELECT id, source_session_id as sourceSessionId, content, metadata_json as metadataJson, created_at as createdAt
      FROM memory_items
      WHERE kind = 'summary'
      ORDER BY created_at DESC, rowid DESC
      LIMIT ?
    `).all(limit) as Array<Omit<MemorySummaryRecord, "metadata"> & { metadataJson: string | null }>;
    return rows.map(({ metadataJson, ...row }) => ({
      ...row,
      metadata: parseJson(metadataJson)
    }));
  }

  getRecentMemoryItems(kinds: MemoryKind[], limit: number): MemorySummaryRecord[] {
    if (kinds.length === 0) {
      return [];
    }
    const placeholders = kinds.map(() => "?").join(", ");
    const rows = this.db.prepare(`
      SELECT id, kind, source_session_id as sourceSessionId, content, metadata_json as metadataJson, created_at as createdAt
      FROM memory_items
      WHERE kind IN (${placeholders})
      ORDER BY created_at DESC, rowid DESC
      LIMIT ?
    `).all(...kinds, limit) as Array<Omit<MemorySummaryRecord, "metadata"> & { metadataJson: string | null }>;
    return rows.map(({ metadataJson, ...row }) => ({
      ...row,
      metadata: parseJson(metadataJson)
    }));
  }

  getRankedSessionMemories(query: string | undefined, limit: number): MemorySummaryRecord[] {
    const memories = this.getRecentMemoryItems(["summary"], Math.max(limit * 8, 20));
    if (!query?.trim()) {
      return memories.slice(0, limit);
    }
    return memories
      .map((memory, index) => ({
        memory,
        score: scoreSessionMemory(memory, query) - index * 0.001
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((item) => item.memory);
  }

  addContextSnapshot(sessionId: string, context: ContextSnapshotInput): string {
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO context_snapshots (
        id, session_id, calendar_summary, weather_json, diary_summary, personality_json, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      sessionId,
      context.calendarSummary ?? null,
      context.weather === undefined ? null : JSON.stringify(context.weather),
      context.diarySummary ?? null,
      context.personality === undefined ? null : JSON.stringify(context.personality),
      nowIso()
    );
    return id;
  }

  upsertCalendarEvents(events: CalendarEventInput[]): number {
    if (events.length === 0) {
      return 0;
    }

    const statement = this.db.prepare(`
      INSERT INTO calendar_events (
        id, calendar_name, title, start_time, end_time, is_all_day, source, read_at, dedupe_key
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(dedupe_key) DO UPDATE SET
        calendar_name = excluded.calendar_name,
        title = excluded.title,
        start_time = excluded.start_time,
        end_time = excluded.end_time,
        is_all_day = excluded.is_all_day,
        source = excluded.source,
        read_at = excluded.read_at
    `);

    const write = this.db.transaction((rows: CalendarEventInput[]) => {
      let written = 0;
      for (const event of rows) {
        statement.run(
          randomUUID(),
          event.calendarName,
          event.title,
          event.startTime,
          event.endTime,
          event.isAllDay ? 1 : 0,
          event.source,
          event.readAt ?? nowIso(),
          calendarDedupeKey(event)
        );
        written += 1;
      }
      return written;
    });

    return write(events);
  }

  upsertDiarySummary(input: DiarySummaryInput): void {
    this.db.prepare(`
      INSERT INTO diary_summaries (id, source_file, source_mtime, summary, generated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(source_file, source_mtime) DO UPDATE SET
        summary = excluded.summary,
        generated_at = excluded.generated_at
    `).run(
      randomUUID(),
      input.sourceFile,
      input.sourceMtime,
      input.summary,
      input.generatedAt ?? nowIso()
    );
  }

  getDiarySummary(sourceFile: string, sourceMtime: string): DiarySummaryRecord | null {
    const row = this.db.prepare(`
      SELECT source_file as sourceFile, source_mtime as sourceMtime, summary, generated_at as generatedAt
      FROM diary_summaries
      WHERE source_file = ? AND source_mtime = ?
      LIMIT 1
    `).get(sourceFile, sourceMtime) as DiarySummaryRecord | undefined;
    return row ?? null;
  }

  recordDjAudio(
    sessionId: string | null,
    kind: DjAudioKind,
    personaId: string | null,
    text: string,
    audioPath: string | null,
    status: DjAudioStatus,
    cache?: DjAudioCacheMetadata
  ): string {
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO dj_audio (
        id, session_id, kind, persona_id, text, audio_path, audio_cache_expires_at,
        voice_model, latency_ms, file_size_bytes, status, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      sessionId,
      kind,
      personaId,
      text,
      audioPath,
      cache?.cacheExpiresAt ?? null,
      cache?.voiceModel ?? null,
      cache?.latencyMs ?? null,
      cache?.fileSizeBytes ?? null,
      status,
      nowIso()
    );
    return id;
  }

  getRecentSessionSummaries(limit: number): RecentSessionSummary[] {
    return this.db.prepare(`
      SELECT id, started_at as startedAt, trigger_type as triggerType, trigger_text as triggerText
      FROM sessions
      ORDER BY started_at DESC
      LIMIT ?
    `).all(limit) as RecentSessionSummary[];
  }

  cleanupExpiredDjAudioCache(now: Date = new Date()): { rowsCleared: number; filesDeleted: number } {
    const rows = this.db.prepare(`
      SELECT id, audio_path as audioPath
      FROM dj_audio
      WHERE audio_path IS NOT NULL
        AND audio_cache_expires_at IS NOT NULL
        AND audio_cache_expires_at <= ?
    `).all(now.toISOString()) as Array<{ id: string; audioPath: string }>;

    let filesDeleted = 0;
    for (const row of rows) {
      try {
        fs.unlinkSync(row.audioPath);
        filesDeleted += 1;
      } catch (error) {
        if (!isMissingFileError(error)) {
          throw error;
        }
      }
      this.db.prepare("UPDATE dj_audio SET audio_path = NULL WHERE id = ?").run(row.id);
    }

    return { rowsCleared: rows.length, filesDeleted };
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function parseFavoriteTrackTarget(value: string): { title: string; artist: string } | null {
  const separator = value.lastIndexOf(" - ");
  if (separator <= 0 || separator >= value.length - 3) {
    return null;
  }
  const title = value.slice(0, separator).trim();
  const artist = value.slice(separator + 3).trim();
  if (!title || !artist) {
    return null;
  }
  return { title, artist };
}

function normalizeFavoriteTrackTarget(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function parseJson(value: string | null): unknown {
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function scoreSessionMemory(memory: MemorySummaryRecord, query: string): number {
  const queryTerms = tokenize(query);
  const metadataText = flattenMetadataText(memory.metadata);
  const memoryTerms = tokenize(`${memory.content} ${metadataText}`);
  let score = 0;
  for (const term of queryTerms) {
    if (memoryTerms.includes(term)) {
      score += 3;
    }
  }
  if (/\b(read|reading|book|diary|journal)\b/i.test(query) && /\b(read|reading|book|diary|journal)\b/i.test(`${memory.content} ${metadataText}`)) {
    score += 6;
  }
  if (/\b(focus|work|meeting|deep)\b/i.test(query) && /\b(focus|work|meeting|deep)\b/i.test(`${memory.content} ${metadataText}`)) {
    score += 5;
  }
  if (/\b(night|evening|late)\b/i.test(query) && /\b(night|evening|late)\b/i.test(`${memory.content} ${metadataText}`)) {
    score += 4;
  }
  return score;
}

function tokenize(value: string): string[] {
  return value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

function flattenMetadataText(metadata: unknown): string {
  if (!metadata || typeof metadata !== "object") {
    return "";
  }
  return Object.values(metadata as Record<string, unknown>)
    .flatMap((value) => Array.isArray(value) ? value : [value])
    .filter((value): value is string => typeof value === "string")
    .join(" ");
}

function calendarDedupeKey(event: CalendarEventInput): string {
  return [
    event.calendarName.trim(),
    event.title.trim(),
    event.startTime.trim(),
    event.endTime.trim()
  ].join(" | ");
}

function isDatabase(value: PockedioConfig | Database.Database): value is Database.Database {
  return typeof (value as Database.Database).prepare === "function";
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
