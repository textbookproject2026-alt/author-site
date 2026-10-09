-- Who is on each book, and how they sign in (batch 2b). The registry stays the
-- public record (display names and member ids, synced in the background); this is
-- what access follows, at once. Every token (sign-in link, invitation, session,
-- assertion) is stored only as its SHA-256.

-- A person. email is how they sign in (lower-cased); null for a member moved over
-- from GitHub who hasn't confirmed one yet. github is their GitHub login while it is
-- still linked (the migration path, and @mentions on reader suggestions).
CREATE TABLE members (
  id TEXT PRIMARY KEY,                 -- 10 lower-case hex digits; "m-<id>" in the registry and git
  display_name TEXT NOT NULL,          -- as the book's credits print it
  email TEXT UNIQUE,
  github TEXT UNIQUE COLLATE NOCASE,
  notify INTEGER NOT NULL DEFAULT 1,   -- emails about reader suggestions
  created_at INTEGER NOT NULL
);

CREATE TABLE book_members (
  book TEXT NOT NULL,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  added_by TEXT,                       -- member id, or null (moved over from the registry)
  added_at INTEGER NOT NULL,
  PRIMARY KEY (book, member_id)
);
CREATE INDEX book_members_member ON book_members(member_id);

-- An emailed link that, once opened, lets someone in:
--   invite  join `book` as a new or existing member, at `email` (seven days)
--   claim   confirm `email` for an existing member who has none (seven days):
--           another member filled it in, or the member gave it after a GitHub sign-in
--   signin  sign in as `member_id` (fifteen minutes)
-- Single use: used_at is set in the same statement that checks it.
CREATE TABLE links (
  token_hash TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('invite', 'claim', 'signin')),
  book TEXT,
  email TEXT,
  name TEXT,
  member_id TEXT REFERENCES members(id) ON DELETE CASCADE,
  created_by TEXT,                     -- the member who sent it (invite, claim)
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
CREATE INDEX links_book ON links(book, kind);
CREATE INDEX links_member ON links(member_id);

-- A signed-in browser: an HttpOnly cookie holds the token. 30 days.
CREATE TABLE sessions (
  id_hash TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_member ON sessions(member_id);

-- One request to the suggest-edit function for a member: written by the proxy,
-- bound to that request (method, endpoint, query, body hash, book), read back by the
-- function once within a minute (used_at), then never again.
CREATE TABLE assertions (
  id_hash TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  book TEXT NOT NULL,                  -- '' only for the list of the member's books
  binding_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
CREATE INDEX assertions_expiry ON assertions(expires_at);

-- "Brandon added Caroline · 9 Oct": changes to a book's people, and each publish.
CREATE TABLE audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book TEXT NOT NULL,
  at INTEGER NOT NULL,
  actor_name TEXT NOT NULL,
  action TEXT NOT NULL,                -- invited | joined | removed | email-requested | email-confirmed | published
  subject_name TEXT NOT NULL
);
CREATE INDEX audit_book ON audit(book, at);

-- Rate limits: uses of a key (an address's hash, an IP, a book) per window.
CREATE TABLE rate (
  key TEXT NOT NULL,
  window INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (key, window)
);

-- Reader-suggestion emails sent: at most one per item per member.
CREATE TABLE notified (
  book TEXT NOT NULL,
  number INTEGER NOT NULL,
  member_id TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (book, number, member_id)
);
