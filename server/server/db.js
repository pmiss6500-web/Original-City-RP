// ============================================================
// Database layer - SQLite (file-based, no external server needed)
// Stores: user accounts (hashed passwords) + player game data
// ============================================================
const Database = require("better-sqlite3");
const path = require("path");

const db = new Database(path.join(__dirname, "game.db"));
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    username TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS players (
    username TEXT PRIMARY KEY,
    character TEXT DEFAULT 'red',
    x REAL DEFAULT 400,
    y REAL DEFAULT 300,
    money INTEGER DEFAULT 500,
    inventory TEXT DEFAULT '[]',
    FOREIGN KEY(username) REFERENCES users(username)
  );
`);

module.exports = {
  // --- Accounts ---
  createUser(username, passwordHash) {
    db.prepare("INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)")
      .run(username, passwordHash, Date.now());
    db.prepare("INSERT INTO players (username) VALUES (?)").run(username);
  },
  getUser(username) {
    return db.prepare("SELECT * FROM users WHERE username = ?").get(username);
  },

  // --- Player data ---
  getPlayer(username) {
    return db.prepare("SELECT * FROM players WHERE username = ?").get(username);
  },
  savePlayerPosition(username, x, y) {
    db.prepare("UPDATE players SET x = ?, y = ? WHERE username = ?").run(x, y, username);
  },
  setCharacter(username, character) {
    db.prepare("UPDATE players SET character = ? WHERE username = ?").run(character, username);
  },
  addMoney(username, amount) {
    db.prepare("UPDATE players SET money = money + ? WHERE username = ?").run(amount, username);
    return db.prepare("SELECT money FROM players WHERE username = ?").get(username).money;
  },
  getInventory(username) {
    const row = db.prepare("SELECT inventory FROM players WHERE username = ?").get(username);
    return JSON.parse(row.inventory);
  },
  addItem(username, item) {
    const inv = module.exports.getInventory(username);
    inv.push(item);
    db.prepare("UPDATE players SET inventory = ? WHERE username = ?").run(JSON.stringify(inv), username);
    return inv;
  },
};
