-- Portal APH / Cloudflare D1 — esquema inicial
-- Aplicar uma unica vez no banco portal-aph-db, antes de importar o JSON.
CREATE TABLE IF NOT EXISTS catalog_meta (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  revision INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT '',
  write_nonce TEXT NOT NULL DEFAULT ''
);
INSERT OR IGNORE INTO catalog_meta(id,revision,updated_at,write_nonce) VALUES(1,0,'','');

CREATE TABLE IF NOT EXISTS courses (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  cover_url TEXT NOT NULL DEFAULT '',
  published INTEGER NOT NULL DEFAULT 0 CHECK(published IN (0,1)),
  position INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_courses_position ON courses(position);
CREATE INDEX IF NOT EXISTS idx_courses_published ON courses(published,position);

CREATE TABLE IF NOT EXISTS modules (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  pdf_url TEXT NOT NULL DEFAULT '',
  published INTEGER NOT NULL DEFAULT 1 CHECK(published IN (0,1)),
  position INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_modules_course_position ON modules(course_id,position);

CREATE TABLE IF NOT EXISTS videos (
  module_id TEXT NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
  youtube_id TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  duration_seconds INTEGER NOT NULL DEFAULT 0 CHECK(duration_seconds BETWEEN 0 AND 172800),
  position INTEGER NOT NULL,
  PRIMARY KEY(module_id,youtube_id)
);
CREATE INDEX IF NOT EXISTS idx_videos_module_position ON videos(module_id,position);

CREATE TABLE IF NOT EXISTS admin_auth (
  id INTEGER PRIMARY KEY CHECK(id=1),
  salt TEXT NOT NULL,
  pass_hash TEXT NOT NULL,
  iterations INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_session_expires ON admin_sessions(expires_at);
CREATE TABLE IF NOT EXISTS login_attempts (
  client_key TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL DEFAULT 0,
  resets_at INTEGER NOT NULL
);

-- Usa um nonce de escrita para assegurar que o CAS de revisao teve sucesso.
-- Qualquer tentativa concorrente que falhar no UPDATE da revisao causa rollback do lote.
CREATE TABLE IF NOT EXISTS revision_guard (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  nonce TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS guard_insert BEFORE INSERT ON revision_guard
WHEN NEW.nonce <> (SELECT write_nonce FROM catalog_meta WHERE id=1)
BEGIN SELECT RAISE(ABORT, 'CATALOG_CONFLICT'); END;
CREATE TRIGGER IF NOT EXISTS guard_update BEFORE UPDATE ON revision_guard
WHEN NEW.nonce <> (SELECT write_nonce FROM catalog_meta WHERE id=1)
BEGIN SELECT RAISE(ABORT, 'CATALOG_CONFLICT'); END;
