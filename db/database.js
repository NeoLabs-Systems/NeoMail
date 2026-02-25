'use strict';

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', 'data', 'mailneo.db');

const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL');


db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    username    TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    email       TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    password    TEXT    NOT NULL,
    created_at  INTEGER DEFAULT (unixepoch()),
    last_login  INTEGER
  );

  CREATE TABLE IF NOT EXISTS accounts (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label             TEXT    NOT NULL DEFAULT 'My Account',
    email             TEXT    NOT NULL,
    imap_host         TEXT    NOT NULL,
    imap_port         INTEGER NOT NULL DEFAULT 993,
    imap_secure       INTEGER NOT NULL DEFAULT 1,
    smtp_host         TEXT    NOT NULL,
    smtp_port         INTEGER NOT NULL DEFAULT 587,
    smtp_secure       INTEGER NOT NULL DEFAULT 0,
    encrypted_pass    TEXT    NOT NULL,
    is_default        INTEGER NOT NULL DEFAULT 0,
    last_synced       INTEGER,
    created_at        INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS emails (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id      INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    message_id      TEXT    NOT NULL,
    uid             INTEGER,
    folder          TEXT    NOT NULL DEFAULT 'INBOX',
    subject         TEXT,
    from_name       TEXT,
    from_email      TEXT    NOT NULL,
    to_addresses    TEXT,
    cc_addresses    TEXT,
    date            INTEGER,
    body_text       TEXT,
    body_html       TEXT,
    raw_headers     TEXT,
    is_read         INTEGER NOT NULL DEFAULT 0,
    is_starred      INTEGER NOT NULL DEFAULT 0,
    is_archived     INTEGER NOT NULL DEFAULT 0,
    is_trash        INTEGER NOT NULL DEFAULT 0,
    is_sent         INTEGER NOT NULL DEFAULT 0,
    awaiting_reply  INTEGER NOT NULL DEFAULT 0,
    ai_label        TEXT,
    ai_summary      TEXT,
    ai_label_done   INTEGER NOT NULL DEFAULT 0,
    unsubscribe_url TEXT,
    created_at      INTEGER DEFAULT (unixepoch()),
    UNIQUE(account_id, message_id)
  );

  CREATE TABLE IF NOT EXISTS email_attachments (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    email_id    INTEGER NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
    filename    TEXT    NOT NULL,
    content_type TEXT,
    size        INTEGER,
    data        BLOB
  );

  CREATE TABLE IF NOT EXISTS labels (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        TEXT    NOT NULL,
    color       TEXT    NOT NULL DEFAULT '#6366f1',
    is_system   INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER DEFAULT (unixepoch()),
    UNIQUE(user_id, name)
  );

  CREATE TABLE IF NOT EXISTS email_labels (
    email_id    INTEGER NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
    label_id    INTEGER NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
    PRIMARY KEY (email_id, label_id)
  );

  CREATE TABLE IF NOT EXISTS cursor_rules (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       TEXT    NOT NULL,
    rule_text   TEXT    NOT NULL,
    is_active   INTEGER NOT NULL DEFAULT 1,
    priority    INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id  INTEGER REFERENCES accounts(id) ON DELETE CASCADE,
    type        TEXT    NOT NULL,
    payload     TEXT,
    seen        INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS app_settings (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key         TEXT    NOT NULL,
    value       TEXT,
    UNIQUE(user_id, key)
  );

  -- Indexes for fast lookups
  CREATE INDEX IF NOT EXISTS idx_emails_account     ON emails(account_id);
  CREATE INDEX IF NOT EXISTS idx_emails_folder      ON emails(account_id, folder);
  CREATE INDEX IF NOT EXISTS idx_emails_read        ON emails(account_id, is_read);
  CREATE INDEX IF NOT EXISTS idx_emails_starred     ON emails(account_id, is_starred);
  CREATE INDEX IF NOT EXISTS idx_emails_awaiting    ON emails(account_id, awaiting_reply);
  CREATE INDEX IF NOT EXISTS idx_emails_date        ON emails(account_id, date DESC);
  CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, seen);

  CREATE TABLE IF NOT EXISTS drafts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id  INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
    to_addr     TEXT,
    cc_addr     TEXT,
    bcc_addr    TEXT,
    subject     TEXT,
    body_html   TEXT,
    body_text   TEXT,
    in_reply_to TEXT,
    updated_at  INTEGER DEFAULT (unixepoch())
  );
`);

for (const migration of [
  `ALTER TABLE emails ADD COLUMN is_spam        INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE emails ADD COLUMN thread_key     TEXT`,
  `ALTER TABLE emails ADD COLUMN snoozed_until  INTEGER`,
  `CREATE INDEX IF NOT EXISTS idx_emails_thread    ON emails(account_id, thread_key)`,
  `CREATE INDEX IF NOT EXISTS idx_emails_snoozed   ON emails(snoozed_until)`,
  `CREATE TABLE IF NOT EXISTS scheduled_emails (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id  INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    send_at     INTEGER NOT NULL,
    to_addr     TEXT NOT NULL,
    cc_addr     TEXT,
    bcc_addr    TEXT,
    subject     TEXT NOT NULL,
    body_html   TEXT,
    body_text   TEXT,
    in_reply_to TEXT,
    created_at  INTEGER DEFAULT (unixepoch())
  )`,
  `CREATE INDEX IF NOT EXISTS idx_scheduled_send_at ON scheduled_emails(send_at)`,
]) {
  try { db.exec(migration); } catch (_) { /* column/index already exists */ }
}


db.exec(`
  CREATE VIRTUAL TABLE IF NOT EXISTS email_fts
  USING fts5(
    subject, from_name, from_email, body_text,
    content='emails', content_rowid='id',
    tokenize='porter unicode61'
  );

  CREATE TRIGGER IF NOT EXISTS email_fts_ai
  AFTER INSERT ON emails BEGIN
    INSERT INTO email_fts(rowid, subject, from_name, from_email, body_text)
    VALUES (new.id, new.subject, new.from_name, new.from_email, new.body_text);
  END;

  CREATE TRIGGER IF NOT EXISTS email_fts_ad
  AFTER DELETE ON emails BEGIN
    INSERT INTO email_fts(email_fts, rowid, subject, from_name, from_email, body_text)
    VALUES ('delete', old.id, old.subject, old.from_name, old.from_email, old.body_text);
  END;

  CREATE TRIGGER IF NOT EXISTS email_fts_au
  AFTER UPDATE ON emails BEGIN
    INSERT INTO email_fts(email_fts, rowid, subject, from_name, from_email, body_text)
    VALUES ('delete', old.id, old.subject, old.from_name, old.from_email, old.body_text);
    INSERT INTO email_fts(rowid, subject, from_name, from_email, body_text)
    VALUES (new.id, new.subject, new.from_name, new.from_email, new.body_text);
  END;
`);

try {
  const indexed = db.prepare('SELECT count(*) AS c FROM email_fts').get().c;
  const total   = db.prepare('SELECT count(*) AS c FROM emails').get().c;
  if (total > 0 && indexed < total) {
    db.exec(`INSERT INTO email_fts(email_fts) VALUES ('rebuild')`);
  }
} catch (_) {}

// ── MCP / OAuth migrations ──────────────────────────────────────────────────
for (const migration of [
  `CREATE TABLE IF NOT EXISTS mcp_tokens (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash  TEXT    NOT NULL UNIQUE,
    name        TEXT    NOT NULL DEFAULT 'My Token',
    scopes      TEXT    NOT NULL DEFAULT 'email:read',
    last_used   INTEGER,
    expires_at  INTEGER,
    revoked     INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER DEFAULT (unixepoch())
  )`,
  `CREATE INDEX IF NOT EXISTS idx_mcp_tokens_hash ON mcp_tokens(token_hash)`,
  // Track which OAuth client (if any) issued a token – PATs leave this NULL
  `ALTER TABLE mcp_tokens ADD COLUMN client_id TEXT`,
  `CREATE TABLE IF NOT EXISTS oauth_clients (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id     TEXT    NOT NULL UNIQUE,
    client_name   TEXT    NOT NULL,
    redirect_uris TEXT    NOT NULL,
    created_at    INTEGER DEFAULT (unixepoch())
  )`,
  `CREATE TABLE IF NOT EXISTS oauth_codes (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    code            TEXT    NOT NULL UNIQUE,
    client_id       TEXT    NOT NULL,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    redirect_uri    TEXT    NOT NULL,
    scopes          TEXT    NOT NULL,
    code_challenge  TEXT    NOT NULL,
    expires_at      INTEGER NOT NULL,
    used            INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS idx_oauth_codes_code ON oauth_codes(code)`,
]) {
  try { db.exec(migration); } catch (_) { /* already exists */ }
}

function insertDefaultLabels(userId) {
  const defaults = [
    { name: 'Work',       color: '#3b82f6', is_system: 0 },
    { name: 'Personal',   color: '#22c55e', is_system: 0 },
    { name: 'Finance',    color: '#f59e0b', is_system: 0 },
    { name: 'Newsletter', color: '#8b5cf6', is_system: 0 },
    { name: 'Travel',     color: '#06b6d4', is_system: 0 },
    { name: 'Spam',       color: '#ef4444', is_system: 1 },
  ];
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO labels (user_id, name, color, is_system) VALUES (?, ?, ?, ?)`
  );
  for (const l of defaults) stmt.run(userId, l.name, l.color, l.is_system);
}

module.exports = { db, insertDefaultLabels };
