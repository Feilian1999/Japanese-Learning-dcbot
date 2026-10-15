-- 每次 /add 都記一筆，用來統計單字出現次數
CREATE TABLE entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  word TEXT NOT NULL,
  reading TEXT,
  meaning TEXT,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_entries_guild_word ON entries (guild_id, word);
