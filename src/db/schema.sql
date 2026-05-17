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

CREATE TABLE IF NOT EXISTS dj_audio (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('morning', 'evening', 'explicit')),
  persona_id TEXT,
  text TEXT NOT NULL,
  audio_path TEXT,
  status TEXT NOT NULL CHECK (status IN ('generated', 'played', 'failed', 'text_fallback')),
  created_at TEXT NOT NULL
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
