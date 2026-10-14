-- Rate-limit keys hold no IP address (functions/_lib/core.js ipKey): HMAC-SHA256 of the
-- IP with a random salt per UTC day. One row per day; the first request of a new day
-- deletes the days before, so once a day is over its keys can't be linked to an address.
CREATE TABLE IF NOT EXISTS salts (
  day INTEGER PRIMARY KEY, -- floor(ms / 86400000), UTC
  salt TEXT NOT NULL       -- 32 random bytes, hex
);

-- Keys stored with a raw IP before this (14 Oct 2026): only counts in hour-long windows.
DELETE FROM rate WHERE key LIKE 'signin:ip:%' OR key LIKE 'notify:ip:%';
