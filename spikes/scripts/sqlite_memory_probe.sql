PRAGMA foreign_keys = ON;

DROP TABLE IF EXISTS messages;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS memory_items;

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  trigger_type TEXT NOT NULL,
  trigger_text TEXT NOT NULL
);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  role TEXT NOT NULL CHECK (role IN ('user', 'pockedio', 'system')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE memory_items (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('agenda', 'diary', 'taste', 'feedback', 'summary')),
  source_session_id TEXT REFERENCES sessions(id),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);

INSERT INTO sessions VALUES (
  'session_001',
  '2026-05-17T09:00:00+08:00',
  'conversation',
  'I feel scattered. Play it directly.'
);

INSERT INTO messages VALUES
  ('msg_001', 'session_001', 'user', 'I feel scattered. Play it directly.', '2026-05-17T09:00:01+08:00'),
  ('msg_002', 'session_001', 'pockedio', 'Copy that. Clean lines, no detour. Starting a five-track set.', '2026-05-17T09:00:04+08:00');

INSERT INTO memory_items VALUES (
  'mem_001',
  'summary',
  'session_001',
  'User wanted direct playback and no extended discussion.',
  '2026-05-17T09:01:00+08:00'
);

SELECT 'sessions', count(*) FROM sessions;
SELECT 'messages', count(*) FROM messages;
SELECT 'memory_items', count(*) FROM memory_items;
SELECT role || ': ' || content FROM messages ORDER BY created_at;
