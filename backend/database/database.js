const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

class DatabaseService {
  constructor() {
    const dbPath = process.env.DATABASE_URL || path.join(__dirname, '../data/gotit.db');
    
    // Создаём директорию, если её нет
    const dbDir = path.dirname(dbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
    
    this.db = new Database(dbPath);
    this.init();
  }

  init() {
    // Таблица пользователей
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        telegram_id INTEGER UNIQUE NOT NULL,
        username TEXT,
        first_name TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Создаём дефолтного пользователя для разработки
    const defaultUser = this.db.prepare('SELECT * FROM users WHERE id = 1').get();
    if (!defaultUser) {
      this.db.prepare(`
        INSERT INTO users (id, telegram_id, username, first_name)
        VALUES (1, 0, 'default', 'Default User')
      `).run();
    }

    // Таблица стримеров
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS streamers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nickname TEXT UNIQUE NOT NULL,
        name TEXT,
        username TEXT,
        avatar TEXT,
        description TEXT,
        fetta_url TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Таблица отслеживаемых стримеров
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS user_streamers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        streamer_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (streamer_id) REFERENCES streamers(id) ON DELETE CASCADE,
        UNIQUE(user_id, streamer_id)
      )
    `);

    // Таблица товаров
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS wishlist_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        streamer_id INTEGER NOT NULL,
        image TEXT,
        price TEXT,
        name TEXT,
        product_url TEXT,
        item_hash TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (streamer_id) REFERENCES streamers(id) ON DELETE CASCADE
      )
    `);

    // Индексы для производительности
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_user_streamers_user ON user_streamers(user_id);
      CREATE INDEX IF NOT EXISTS idx_user_streamers_streamer ON user_streamers(streamer_id);
      CREATE INDEX IF NOT EXISTS idx_wishlist_streamer ON wishlist_items(streamer_id);
    `);
  }

  // Пользователи
  createUser(telegramId, username, firstName) {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO users (telegram_id, username, first_name)
      VALUES (?, ?, ?)
    `);
    return stmt.run(telegramId, username, firstName);
  }

  getUserByTelegramId(telegramId) {
    const stmt = this.db.prepare('SELECT * FROM users WHERE telegram_id = ?');
    return stmt.get(telegramId);
  }

  // Стримеры
  createOrUpdateStreamer(streamerData) {
    const { nickname, name, username, avatar, description, fettaUrl } = streamerData;
    
    const stmt = this.db.prepare(`
      INSERT INTO streamers (nickname, name, username, avatar, description, fetta_url, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(nickname) DO UPDATE SET
        name = excluded.name,
        username = excluded.username,
        avatar = excluded.avatar,
        description = excluded.description,
        fetta_url = excluded.fetta_url,
        updated_at = CURRENT_TIMESTAMP
    `);
    
    const result = stmt.run(nickname, name, username, avatar, description, fettaUrl);
    return this.getStreamerByNickname(nickname);
  }

  getStreamerByNickname(nickname) {
    const stmt = this.db.prepare('SELECT * FROM streamers WHERE nickname = ?');
    return stmt.get(nickname);
  }

  getStreamerById(id) {
    const stmt = this.db.prepare('SELECT * FROM streamers WHERE id = ?');
    return stmt.get(id);
  }

  // Отслеживание стримеров
  addTrackedStreamer(userId, streamerId) {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO user_streamers (user_id, streamer_id)
      VALUES (?, ?)
    `);
    return stmt.run(userId, streamerId);
  }

  removeTrackedStreamer(userId, streamerId) {
    const stmt = this.db.prepare(`
      DELETE FROM user_streamers
      WHERE user_id = ? AND streamer_id = ?
    `);
    return stmt.run(userId, streamerId);
  }

  getTrackedStreamers(userId) {
    const stmt = this.db.prepare(`
      SELECT s.*, us.created_at as tracked_at
      FROM streamers s
      JOIN user_streamers us ON s.id = us.streamer_id
      WHERE us.user_id = ?
      ORDER BY us.created_at DESC
    `);
    return stmt.all(userId);
  }

  isStreamerTracked(userId, streamerId) {
    const stmt = this.db.prepare(`
      SELECT 1 FROM user_streamers
      WHERE user_id = ? AND streamer_id = ?
    `);
    return stmt.get(userId, streamerId) !== undefined;
  }

  // Вишлист товары
  saveWishlistItems(streamerId, items) {
    // Удаляем старые товары
    const deleteStmt = this.db.prepare('DELETE FROM wishlist_items WHERE streamer_id = ?');
    deleteStmt.run(streamerId);

    // Добавляем новые
    const insertStmt = this.db.prepare(`
      INSERT INTO wishlist_items (streamer_id, image, price, name, product_url, item_hash)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const insert = this.db.transaction((items) => {
      for (const item of items) {
        const hash = this.generateItemHash(item);
        insertStmt.run(streamerId, item.image, item.price, item.name, item.productUrl, hash);
      }
    });

    insert(items);
  }

  getWishlistItems(streamerId) {
    const stmt = this.db.prepare(`
      SELECT * FROM wishlist_items
      WHERE streamer_id = ?
      ORDER BY created_at DESC
    `);
    return stmt.all(streamerId);
  }

  getNewWishlistItems(streamerId, items) {
    const currentItems = this.getWishlistItems(streamerId);
    const currentHashes = new Set(currentItems.map(item => item.item_hash));
    
    return items.filter(item => {
      const hash = this.generateItemHash(item);
      return !currentHashes.has(hash);
    });
  }

  generateItemHash(item) {
    const str = `${item.name || ''}_${item.price || ''}_${item.image || ''}`;
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString();
  }

  close() {
    this.db.close();
  }
}

module.exports = new DatabaseService();
