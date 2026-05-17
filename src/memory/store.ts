import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { openDatabase } from "../db/database.js";
import type { PockedioConfig } from "../config/schema.js";

export type SessionTriggerType = "conversation" | "scheduled_morning" | "scheduled_evening" | "mood_check" | "explicit_dj_audio";
export type MessageRole = "user" | "pockedio" | "system";
export type PlaybackStatus = "planned" | "playing" | "played" | "skipped" | "unavailable" | "failed";
export type FeedbackAction = "like" | "skip" | "ban" | "more_like_this" | "change_vibe" | "stop";
export type MemoryKind = "agenda" | "diary" | "taste" | "feedback" | "summary" | "personality";
export type DjAudioKind = "morning" | "evening" | "explicit";
export type DjAudioStatus = "generated" | "played" | "failed" | "text_fallback";

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

export type RecentSessionSummary = {
  id: string;
  startedAt: string;
  triggerType: SessionTriggerType;
  triggerText: string;
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

  addFeedback(sessionId: string, trackId: string | null, action: FeedbackAction, note?: string): string {
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO feedback (id, session_id, track_id, action, note, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, sessionId, trackId, action, note ?? null, nowIso());
    return id;
  }

  addMemoryItem(kind: MemoryKind, content: string, metadata?: unknown, sourceSessionId?: string): string {
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO memory_items (id, kind, source_session_id, content, metadata_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, kind, sourceSessionId ?? null, content, metadata === undefined ? null : JSON.stringify(metadata), nowIso());
    return id;
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

  recordDjAudio(
    sessionId: string | null,
    kind: DjAudioKind,
    personaId: string | null,
    text: string,
    audioPath: string | null,
    status: DjAudioStatus
  ): string {
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO dj_audio (id, session_id, kind, persona_id, text, audio_path, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, sessionId, kind, personaId, text, audioPath, status, nowIso());
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
}

function nowIso(): string {
  return new Date().toISOString();
}

function isDatabase(value: PockedioConfig | Database.Database): value is Database.Database {
  return typeof (value as Database.Database).prepare === "function";
}
