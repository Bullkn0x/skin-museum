-- The shooting range's leaderboard. Safe to run more than once.

-- One row per Twitch account: who they are (public details only) and their best round.
CREATE TABLE IF NOT EXISTS scores (
  user_id   TEXT PRIMARY KEY,   -- Twitch's number for the account; it stays the same when the name changes
  login     TEXT NOT NULL,      -- the name in their channel address
  name      TEXT NOT NULL,      -- the name as they write it
  avatar    TEXT NOT NULL,      -- address of their profile picture
  score     INTEGER NOT NULL,
  kills     INTEGER NOT NULL,
  headshots INTEGER NOT NULL,
  far       INTEGER NOT NULL,   -- long-range kills
  shots     INTEGER NOT NULL,
  hits      INTEGER NOT NULL,
  weapon    TEXT NOT NULL,
  at        INTEGER NOT NULL    -- when the best round was saved, in milliseconds
);

-- The board is always read best first, and the earlier of two equal scores comes first.
CREATE INDEX IF NOT EXISTS scores_by_score ON scores (score DESC, at ASC);

-- Rounds that have already been handed in, so the same round cannot be saved twice.
-- Rows older than a day are cleared out as new ones arrive.
CREATE TABLE IF NOT EXISTS used_tickets (
  id TEXT PRIMARY KEY,
  at INTEGER NOT NULL
);

-- The sub wall: the channel's subscribers and bits board. See "Sub wall" in README.md.

-- The channel's connection to Twitch. At most one row, written when the owner opens /connect.
CREATE TABLE IF NOT EXISTS sub_grant (
  id             INTEGER PRIMARY KEY CHECK (id = 1),
  broadcaster_id TEXT NOT NULL,      -- Twitch's number for the channel
  refresh_token  TEXT NOT NULL,      -- what Twitch takes in exchange for a short-lived pass; private, only ever sent to Twitch
  refused_at     INTEGER,            -- when Twitch stopped accepting it, in milliseconds; empty while the connection works
  at             INTEGER NOT NULL    -- when the token was last written, in milliseconds
);

-- Who is on the wall right now: one row per subscriber. Someone who stops subscribing is deleted.
CREATE TABLE IF NOT EXISTS sub_wall (
  user_id    TEXT PRIMARY KEY,       -- Twitch's number for the account
  tier       INTEGER NOT NULL,       -- 1, 2 or 3
  name       TEXT NOT NULL,          -- the name as they write it
  first_seen INTEGER NOT NULL        -- when this service first saw them at this tier, in milliseconds
);

-- What /subs answers with: the finished list as one piece of JSON, and when it was made.
CREATE TABLE IF NOT EXISTS sub_snapshot (
  id   INTEGER PRIMARY KEY CHECK (id = 1),
  body TEXT NOT NULL,
  at   INTEGER NOT NULL
);
