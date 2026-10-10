-- Sign-in hardening (batch 2c, Part B): new-browser alerts and "Where you're signed in".

-- A browser a member has signed in on: a long-lived HttpOnly cookie
-- (__Host-tb_device) holds a random token, stored here only as its SHA-256. A
-- sign-in from a browser not listed here emails the member, unless they have none
-- listed yet (their first sign-in after this change, or ever).
CREATE TABLE devices (
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  device_hash TEXT NOT NULL,
  label TEXT NOT NULL,                 -- "Chrome on macOS", from the user agent; never the user agent itself
  first_seen INTEGER NOT NULL,
  PRIMARY KEY (member_id, device_hash)
);

-- What "Where you're signed in" shows for each session: a public handle (never the
-- token or its hash), the browser and system, and when it was last used.
ALTER TABLE sessions ADD COLUMN sid TEXT;
ALTER TABLE sessions ADD COLUMN label TEXT;
ALTER TABLE sessions ADD COLUMN last_active INTEGER;
UPDATE sessions SET sid = lower(hex(randomblob(8))), last_active = created_at;
CREATE UNIQUE INDEX sessions_sid ON sessions(sid);

-- Links gain a fourth kind: revoke, the new-browser alert's "This wasn't me" (seven
-- days, single use): it signs every session of `member_id` out, and forgets the
-- browser it was about (`device_hash`), so a sign-in from it alerts again. SQLite
-- can't change a CHECK, so the table is rebuilt with its rows.
CREATE TABLE links_new (
  token_hash TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('invite', 'claim', 'signin', 'revoke')),
  book TEXT,
  email TEXT,
  name TEXT,
  member_id TEXT REFERENCES members(id) ON DELETE CASCADE,
  created_by TEXT,
  mailed INTEGER NOT NULL DEFAULT 1,
  device_hash TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
INSERT INTO links_new (token_hash, kind, book, email, name, member_id, created_by, mailed, created_at, expires_at, used_at)
  SELECT token_hash, kind, book, email, name, member_id, created_by, mailed, created_at, expires_at, used_at FROM links;
DROP TABLE links;
ALTER TABLE links_new RENAME TO links;
CREATE INDEX links_book ON links(book, kind);
CREATE INDEX links_member ON links(member_id);
