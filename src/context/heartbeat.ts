import { randomUUID } from "node:crypto";
import fs from "node:fs";
import type Database from "better-sqlite3";
import { loadConfig } from "../config/load.js";
import type { PockedioConfig } from "../config/schema.js";
import { withDatabase } from "../db/database.js";
import { runMigrations } from "../db/migrations.js";
import { refreshContextWithDiaryHistory, type RefreshContextResult } from "./refreshContext.js";

export type ContextRefreshRunStatus = "running" | "completed" | "failed" | "skipped";
export type ContextRefreshRunTrigger = "startup_heartbeat" | "manual";

export type ContextRefreshRunRecord = {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  status: ContextRefreshRunStatus;
  trigger: ContextRefreshRunTrigger;
  localDay: string;
  calendarEventsRead: number;
  agendaMemoriesUpdated: number;
  diaryLatestAvailable: boolean;
  diaryLatestFile: string | null;
  diaryFilesScanned: number;
  diarySummariesGenerated: number;
  diarySummariesReused: number;
  diaryMemoriesUpdated: number;
  error: string | null;
};

export type DailyContextHeartbeatOptions = {
  now?: Date;
  refresh?: (config: PockedioConfig) => Promise<RefreshContextResult>;
};

export function startDailyContextHeartbeat(config: PockedioConfig = loadConfig()): void {
  if (!config.memory.dailyHeartbeat) {
    return;
  }
  void runDailyContextHeartbeat(config).catch(() => undefined);
}

export async function runDailyContextHeartbeat(
  config: PockedioConfig = loadConfig(),
  options: DailyContextHeartbeatOptions = {}
): Promise<ContextRefreshRunRecord | null> {
  if (!config.memory.dailyHeartbeat) {
    return null;
  }
  if (!config.calendar.enabled && !config.diary.enabled) {
    return null;
  }

  runMigrations(config);
  const now = options.now ?? new Date();
  const localDay = formatLocalDay(now);
  const startedAt = now.toISOString();
  const claimed = withDatabase(config, (db) => claimHeartbeatRun(db, localDay, startedAt));
  if (!claimed) {
    return null;
  }

  try {
    const refresh = options.refresh ?? ((targetConfig) => refreshContextWithDiaryHistory(targetConfig, {
      diaryHistoryLimit: targetConfig.memory.heartbeatHistoryLimit
    }));
    const result = await refresh(config);
    return withDatabase(config, (db) => completeHeartbeatRun(db, claimed.id, result, new Date().toISOString()));
  } catch (error) {
    return withDatabase(config, (db) => failHeartbeatRun(db, claimed.id, error, new Date().toISOString()));
  }
}

export function getLatestContextRefreshRun(config: PockedioConfig): ContextRefreshRunRecord | null {
  if (!dbFileExists(config)) {
    return null;
  }
  try {
    return withDatabase(config, (db) => {
      if (!contextRefreshRunsTableExists(db)) {
        return null;
      }
      const row = db.prepare(`
        SELECT id, started_at as startedAt, finished_at as finishedAt, status, trigger, local_day as localDay,
          calendar_events_read as calendarEventsRead,
          agenda_memories_updated as agendaMemoriesUpdated,
          diary_latest_available as diaryLatestAvailable,
          diary_latest_file as diaryLatestFile,
          diary_files_scanned as diaryFilesScanned,
          diary_summaries_generated as diarySummariesGenerated,
          diary_summaries_reused as diarySummariesReused,
          diary_memories_updated as diaryMemoriesUpdated,
          error
        FROM context_refresh_runs
        ORDER BY started_at DESC, rowid DESC
        LIMIT 1
      `).get() as DbContextRefreshRun | undefined;
      return row ? mapContextRefreshRun(row) : null;
    });
  } catch {
    return null;
  }
}

function claimHeartbeatRun(db: Database.Database, localDay: string, startedAt: string): ContextRefreshRunRecord | null {
  const existing = db.prepare(`
    SELECT id, started_at as startedAt, finished_at as finishedAt, status, trigger, local_day as localDay,
      calendar_events_read as calendarEventsRead,
      agenda_memories_updated as agendaMemoriesUpdated,
      diary_latest_available as diaryLatestAvailable,
      diary_latest_file as diaryLatestFile,
      diary_files_scanned as diaryFilesScanned,
      diary_summaries_generated as diarySummariesGenerated,
      diary_summaries_reused as diarySummariesReused,
      diary_memories_updated as diaryMemoriesUpdated,
      error
    FROM context_refresh_runs
    WHERE trigger = 'startup_heartbeat' AND local_day = ? AND status IN ('running', 'completed', 'failed')
    ORDER BY started_at DESC, rowid DESC
    LIMIT 1
  `).get(localDay) as DbContextRefreshRun | undefined;
  if (existing) {
    return null;
  }

  const id = randomUUID();
  db.prepare(`
    INSERT INTO context_refresh_runs (id, started_at, status, trigger, local_day)
    VALUES (?, ?, 'running', 'startup_heartbeat', ?)
  `).run(id, startedAt, localDay);
  return {
    id,
    startedAt,
    finishedAt: null,
    status: "running",
    trigger: "startup_heartbeat",
    localDay,
    calendarEventsRead: 0,
    agendaMemoriesUpdated: 0,
    diaryLatestAvailable: false,
    diaryLatestFile: null,
    diaryFilesScanned: 0,
    diarySummariesGenerated: 0,
    diarySummariesReused: 0,
    diaryMemoriesUpdated: 0,
    error: null
  };
}

function completeHeartbeatRun(
  db: Database.Database,
  id: string,
  result: RefreshContextResult,
  finishedAt: string
): ContextRefreshRunRecord {
  db.prepare(`
    UPDATE context_refresh_runs
    SET finished_at = ?,
      status = 'completed',
      calendar_events_read = ?,
      agenda_memories_updated = ?,
      diary_latest_available = ?,
      diary_latest_file = ?,
      diary_files_scanned = ?,
      diary_summaries_generated = ?,
      diary_summaries_reused = ?,
      diary_memories_updated = ?,
      error = NULL
    WHERE id = ?
  `).run(
    finishedAt,
    result.calendar.eventsRead,
    result.calendar.memoriesUpdated,
    result.diary.available ? 1 : 0,
    result.diary.latestFile ?? null,
    result.diaryHistory?.filesScanned ?? 0,
    result.diaryHistory?.summariesGenerated ?? 0,
    result.diaryHistory?.summariesReused ?? 0,
    result.diary.memoriesUpdated + (result.diaryHistory?.memoriesUpdated ?? 0),
    id
  );
  return getContextRefreshRunById(db, id)!;
}

function failHeartbeatRun(db: Database.Database, id: string, error: unknown, finishedAt: string): ContextRefreshRunRecord {
  db.prepare(`
    UPDATE context_refresh_runs
    SET finished_at = ?, status = 'failed', error = ?
    WHERE id = ?
  `).run(finishedAt, error instanceof Error ? error.message : String(error), id);
  return getContextRefreshRunById(db, id)!;
}

function getContextRefreshRunById(db: Database.Database, id: string): ContextRefreshRunRecord | null {
  const row = db.prepare(`
    SELECT id, started_at as startedAt, finished_at as finishedAt, status, trigger, local_day as localDay,
      calendar_events_read as calendarEventsRead,
      agenda_memories_updated as agendaMemoriesUpdated,
      diary_latest_available as diaryLatestAvailable,
      diary_latest_file as diaryLatestFile,
      diary_files_scanned as diaryFilesScanned,
      diary_summaries_generated as diarySummariesGenerated,
      diary_summaries_reused as diarySummariesReused,
      diary_memories_updated as diaryMemoriesUpdated,
      error
    FROM context_refresh_runs
    WHERE id = ?
    LIMIT 1
  `).get(id) as DbContextRefreshRun | undefined;
  return row ? mapContextRefreshRun(row) : null;
}

type DbContextRefreshRun = Omit<ContextRefreshRunRecord, "diaryLatestAvailable"> & {
  diaryLatestAvailable: number;
};

function mapContextRefreshRun(row: DbContextRefreshRun): ContextRefreshRunRecord {
  return {
    ...row,
    diaryLatestAvailable: Boolean(row.diaryLatestAvailable)
  };
}

function formatLocalDay(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function contextRefreshRunsTableExists(db: Database.Database): boolean {
  const row = db.prepare(`
    SELECT 1 as present
    FROM sqlite_master
    WHERE type = 'table' AND name = 'context_refresh_runs'
    LIMIT 1
  `).get() as { present: number } | undefined;
  return Boolean(row);
}

function dbFileExists(config: PockedioConfig): boolean {
  return fs.existsSync(config.paths.database);
}
