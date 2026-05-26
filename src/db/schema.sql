CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('conversation', 'scheduled_morning', 'scheduled_evening', 'mood_check', 'explicit_dj_audio')),
  trigger_text TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'pockedio', 'system')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS station_tracks (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 1),
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  album TEXT,
  provider TEXT NOT NULL,
  provider_track_id TEXT,
  playable_url TEXT,
  playback_status TEXT NOT NULL CHECK (playback_status IN ('planned', 'playing', 'played', 'skipped', 'unavailable', 'failed')),
  failure_reason TEXT
);

CREATE TABLE IF NOT EXISTS feedback (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  track_id TEXT REFERENCES station_tracks(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK (action IN ('like', 'skip', 'ban', 'more_like_this', 'change_vibe', 'less_like_this', 'favorite', 'save_vibe', 'stop')),
  note TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS taste_signals (
  id TEXT PRIMARY KEY,
  source_feedback_id TEXT REFERENCES feedback(id) ON DELETE SET NULL,
  track_id TEXT REFERENCES station_tracks(id) ON DELETE SET NULL,
  signal_type TEXT NOT NULL CHECK (signal_type IN ('positive_seed', 'negative_seed', 'ban', 'favorite', 'vibe_preset')),
  target_type TEXT NOT NULL CHECK (target_type IN ('track', 'artist', 'station_request', 'vibe')),
  target_value TEXT NOT NULL,
  weight REAL NOT NULL,
  context_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS taste_profile_snapshots (
  id TEXT PRIMARY KEY,
  summary TEXT NOT NULL,
  metadata_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS taste_items (
  dedupe_key TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  album TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  playlist TEXT NOT NULL DEFAULT '',
  import_source TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT '',
  provider_track_id TEXT,
  search_text TEXT NOT NULL,
  first_imported_at TEXT NOT NULL,
  last_imported_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memory_items (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('agenda', 'diary', 'taste', 'feedback', 'summary', 'personality')),
  source_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  metadata_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mood_checks (
  id TEXT PRIMARY KEY,
  selected_mood TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS context_snapshots (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  calendar_summary TEXT,
  weather_json TEXT,
  diary_summary TEXT,
  personality_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS calendar_events (
  id TEXT PRIMARY KEY,
  calendar_name TEXT NOT NULL,
  title TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  is_all_day INTEGER NOT NULL CHECK (is_all_day IN (0, 1)),
  source TEXT NOT NULL CHECK (source IN ('setup', 'interactive', 'scheduled')),
  read_at TEXT NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS diary_summaries (
  id TEXT PRIMARY KEY,
  source_file TEXT NOT NULL,
  source_mtime TEXT NOT NULL,
  summary TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  UNIQUE(source_file, source_mtime)
);

CREATE TABLE IF NOT EXISTS dj_audio (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('morning', 'evening', 'explicit')),
  persona_id TEXT,
  text TEXT NOT NULL,
  audio_path TEXT,
  audio_cache_expires_at TEXT,
  voice_model TEXT,
  latency_ms INTEGER,
  file_size_bytes INTEGER,
  status TEXT NOT NULL CHECK (status IN ('generated', 'played', 'failed', 'text_fallback')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scheduled_dj_preparations (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('morning', 'evening')),
  target_play_time TEXT NOT NULL,
  prepared_at TEXT NOT NULL,
  persona_id TEXT,
  text TEXT NOT NULL,
  audio_path TEXT,
  audio_cache_expires_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('generated', 'played', 'failed', 'text_fallback')),
  context_summary TEXT
);

CREATE TABLE IF NOT EXISTS taste_imports (
  id TEXT PRIMARY KEY,
  source_file TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  track_count INTEGER NOT NULL CHECK (track_count >= 0),
  summary TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS context_refresh_runs (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'skipped')),
  trigger TEXT NOT NULL CHECK (trigger IN ('startup_heartbeat', 'manual')),
  local_day TEXT NOT NULL,
  calendar_events_read INTEGER NOT NULL DEFAULT 0,
  agenda_memories_updated INTEGER NOT NULL DEFAULT 0,
  diary_latest_available INTEGER NOT NULL DEFAULT 0 CHECK (diary_latest_available IN (0, 1)),
  diary_latest_file TEXT,
  diary_files_scanned INTEGER NOT NULL DEFAULT 0,
  diary_summaries_generated INTEGER NOT NULL DEFAULT 0,
  diary_summaries_reused INTEGER NOT NULL DEFAULT 0,
  diary_memories_updated INTEGER NOT NULL DEFAULT 0,
  error TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_session_created ON messages(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_station_tracks_session_position ON station_tracks(session_id, position);
CREATE INDEX IF NOT EXISTS idx_taste_signals_type_created ON taste_signals(signal_type, created_at);
CREATE INDEX IF NOT EXISTS idx_taste_signals_target ON taste_signals(target_type, target_value);
CREATE INDEX IF NOT EXISTS idx_taste_profile_snapshots_created ON taste_profile_snapshots(created_at);
CREATE INDEX IF NOT EXISTS idx_taste_items_search ON taste_items(search_text);
CREATE INDEX IF NOT EXISTS idx_taste_items_artist ON taste_items(artist);
CREATE INDEX IF NOT EXISTS idx_taste_items_playlist ON taste_items(playlist);
CREATE INDEX IF NOT EXISTS idx_memory_items_kind_created ON memory_items(kind, created_at);
CREATE INDEX IF NOT EXISTS idx_calendar_events_start ON calendar_events(start_time);
CREATE INDEX IF NOT EXISTS idx_diary_summaries_source ON diary_summaries(source_file, source_mtime);
CREATE INDEX IF NOT EXISTS idx_scheduled_dj_preparations_kind_target ON scheduled_dj_preparations(kind, target_play_time);
CREATE INDEX IF NOT EXISTS idx_context_refresh_runs_trigger_day ON context_refresh_runs(trigger, local_day, started_at);
