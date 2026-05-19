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
  action TEXT NOT NULL CHECK (action IN ('like', 'skip', 'ban', 'more_like_this', 'change_vibe', 'stop')),
  note TEXT,
  created_at TEXT NOT NULL
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

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_session_created ON messages(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_station_tracks_session_position ON station_tracks(session_id, position);
CREATE INDEX IF NOT EXISTS idx_memory_items_kind_created ON memory_items(kind, created_at);
CREATE INDEX IF NOT EXISTS idx_calendar_events_start ON calendar_events(start_time);
CREATE INDEX IF NOT EXISTS idx_diary_summaries_source ON diary_summaries(source_file, source_mtime);
CREATE INDEX IF NOT EXISTS idx_scheduled_dj_preparations_kind_target ON scheduled_dj_preparations(kind, target_play_time);
