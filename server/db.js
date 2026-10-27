const path = require('path');
const Database = require('better-sqlite3');

const db = new Database(path.join(__dirname, '..', 'data.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS personas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    persona TEXT NOT NULL,
    avatar TEXT NOT NULL DEFAULT '🙂',
    mood INTEGER NOT NULL DEFAULT 50,
    memory_summary TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    persona_id INTEGER NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_messages_persona_id ON messages (persona_id, id);
`);

const SUMMARY_THRESHOLD = 40; // messages kept verbatim (per persona) before older ones get folded into memory_summary
const KEEP_RECENT = 20; // how many recent messages stay verbatim after a summary fold

function listPersonas() {
  return db.prepare('SELECT * FROM personas ORDER BY created_at ASC').all();
}

function getPersona(id) {
  return db.prepare('SELECT * FROM personas WHERE id = ?').get(id);
}

function createPersona({ name, persona, avatar }) {
  const { lastInsertRowid } = db
    .prepare('INSERT INTO personas (name, persona, avatar) VALUES (?, ?, ?)')
    .run(name, persona, avatar || '🙂');
  return getPersona(lastInsertRowid);
}

function updatePersona(id, { name, persona, avatar }) {
  const existing = getPersona(id);
  if (!existing) return null;
  db.prepare(
    "UPDATE personas SET name = ?, persona = ?, avatar = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(
    name ?? existing.name,
    persona ?? existing.persona,
    avatar ?? existing.avatar,
    id
  );
  return getPersona(id);
}

function deletePersona(id) {
  const existing = getPersona(id);
  if (!existing) return false;
  const tx = db.transaction((personaId) => {
    db.prepare('DELETE FROM messages WHERE persona_id = ?').run(personaId);
    db.prepare('DELETE FROM personas WHERE id = ?').run(personaId);
  });
  tx(id);
  return true;
}

function adjustMood(personaId, delta) {
  const persona = getPersona(personaId);
  if (!persona) return;
  const next = Math.max(0, Math.min(100, persona.mood + delta));
  db.prepare('UPDATE personas SET mood = ? WHERE id = ?').run(next, personaId);
  return next;
}

function setMemorySummary(personaId, summary) {
  db.prepare('UPDATE personas SET memory_summary = ? WHERE id = ?').run(summary, personaId);
}

function addMessage(personaId, role, content) {
  db.prepare('INSERT INTO messages (persona_id, role, content) VALUES (?, ?, ?)').run(
    personaId,
    role,
    content
  );
}

function getRecentMessages(personaId, limit = KEEP_RECENT) {
  const rows = db
    .prepare('SELECT role, content FROM messages WHERE persona_id = ? ORDER BY id DESC LIMIT ?')
    .all(personaId, limit);
  return rows.reverse();
}

function getAllMessages(personaId) {
  return db
    .prepare('SELECT role, content, created_at FROM messages WHERE persona_id = ? ORDER BY id ASC')
    .all(personaId);
}

function countMessages(personaId) {
  return db
    .prepare('SELECT COUNT(*) AS n FROM messages WHERE persona_id = ?')
    .get(personaId).n;
}

function getOldestUnsummarized(personaId, limit = Infinity) {
  // messages beyond the most recent KEEP_RECENT for this persona, oldest first
  const total = countMessages(personaId);
  const cutoff = Math.min(total - KEEP_RECENT, limit);
  if (cutoff <= 0) return [];
  return db
    .prepare('SELECT id, role, content FROM messages WHERE persona_id = ? ORDER BY id ASC LIMIT ?')
    .all(personaId, cutoff);
}

function deleteMessagesById(ids) {
  if (!ids.length) return;
  const stmt = db.prepare('DELETE FROM messages WHERE id = ?');
  const tx = db.transaction((idList) => idList.forEach((id) => stmt.run(id)));
  tx(ids);
}

module.exports = {
  listPersonas,
  getPersona,
  createPersona,
  updatePersona,
  deletePersona,
  adjustMood,
  setMemorySummary,
  addMessage,
  getRecentMessages,
  getAllMessages,
  countMessages,
  getOldestUnsummarized,
  deleteMessagesById,
  SUMMARY_THRESHOLD,
  KEEP_RECENT,
};
