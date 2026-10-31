CREATE TABLE IF NOT EXISTS users (username TEXT PRIMARY KEY, name TEXT, email TEXT, photo TEXT, pass_hash TEXT, salt TEXT, created_at INTEGER, last_login INTEGER, fails INTEGER DEFAULT 0, locked_until INTEGER DEFAULT 0, reset_code TEXT, reset_expires INTEGER);
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, username TEXT, expires INTEGER);
CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, username TEXT, type TEXT, status TEXT, created_at INTEGER, updated_at INTEGER, name TEXT, contact_email TEXT, gender TEXT, lang TEXT, input TEXT, student_note TEXT, advisor_note TEXT, work TEXT, final TEXT, brand TEXT, approved_at INTEGER, sent_at INTEGER, sent_to TEXT, reminders INTEGER DEFAULT 0, last_reminder_at INTEGER, log TEXT);
CREATE INDEX IF NOT EXISTS req_user ON requests(username);
CREATE INDEX IF NOT EXISTS req_status ON requests(status);
CREATE TABLE IF NOT EXISTS templates (id TEXT PRIMARY KEY, label TEXT, description TEXT, lang TEXT, brand TEXT, fields TEXT, active INTEGER DEFAULT 1, created_at INTEGER, source TEXT);
CREATE TABLE IF NOT EXISTS brands (id TEXT PRIMARY KEY, data TEXT, updated_at INTEGER);
