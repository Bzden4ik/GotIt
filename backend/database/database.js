const { createClient } = require('@libsql/client');

class DatabaseService {
  constructor() {
    const url = process.env.TURSO_DATABASE_URL;
    const authToken = process.env.TURSO_AUTH_TOKEN;

    if (!url || !authToken) {
      throw new Error('TURSO_DATABASE_URL и TURSO_AUTH_TOKEN должны быть заданы');
    }

    this.db = createClient({ url, authToken });
    console.log('📂 Подключение к Turso...');
  }

  async init() {
    await this.db.batch([
      `CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        telegram_id INTEGER UNIQUE NOT NULL,
        username TEXT,
        first_name TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS streamers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nickname TEXT UNIQUE NOT NULL,
        name TEXT,
        username TEXT,
        avatar TEXT,
        description TEXT,
        fetta_url TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS user_streamers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        streamer_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (streamer_id) REFERENCES streamers(id) ON DELETE CASCADE,
        UNIQUE(user_id, streamer_id)
      )`,
      `CREATE TABLE IF NOT EXISTS wishlist_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        streamer_id INTEGER NOT NULL,
        image TEXT,
        price TEXT,
        name TEXT,
        product_url TEXT,
        item_hash TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (streamer_id) REFERENCES streamers(id) ON DELETE CASCADE
      )`,
      `CREATE INDEX IF NOT EXISTS idx_user_streamers_user ON user_streamers(user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_user_streamers_streamer ON user_streamers(streamer_id)`,
      `CREATE INDEX IF NOT EXISTS idx_wishlist_streamer ON wishlist_items(streamer_id)`
    ], 'write');

    console.log('✅ База данных инициализирована');
  }

  // ── Пользователи ──

  async createUser(telegramId, username, firstName) {
    await this.db.execute({
      sql: `INSERT OR IGNORE INTO users (telegram_id, username, first_name) VALUES (?, ?, ?)`,
      args: [telegramId, username, firstName]
    });
  }

  async getUserByTelegramId(telegramId) {
    const rs = await this.db.execute({
      sql: 'SELECT * FROM users WHERE telegram_id = ?',
      args: [telegramId]
    });
    return rs.rows[0] || null;
  }

  async getUserById(userId) {
    const rs = await this.db.execute({
      sql: 'SELECT * FROM users WHERE id = ?',
      args: [userId]
    });
    return rs.rows[0] || null;
  }

  // ── Стримеры ──

  async createOrUpdateStreamer(data) {
    const { nickname, name, username, avatar, description, fettaUrl } = data;
    await this.db.execute({
      sql: `INSERT INTO streamers (nickname, name, username, avatar, description, fetta_url, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(nickname) DO UPDATE SET
              name = excluded.name, username = excluded.username,
              avatar = excluded.avatar, description = excluded.description,
              fetta_url = excluded.fetta_url, updated_at = CURRENT_TIMESTAMP`,
      args: [nickname, name, username, avatar, description, fettaUrl]
    });
    return this.getStreamerByNickname(nickname);
  }

  async getStreamerByNickname(nickname) {
    const rs = await this.db.execute({
      sql: 'SELECT * FROM streamers WHERE nickname = ?',
      args: [nickname]
    });
    return rs.rows[0] || null;
  }

  async getStreamerById(id) {
    const rs = await this.db.execute({
      sql: 'SELECT * FROM streamers WHERE id = ?',
      args: [id]
    });
    return rs.rows[0] || null;
  }

  // ── Отслеживание ──

  async addTrackedStreamer(userId, streamerId) {
    const user = await this.getUserById(userId);
    if (!user) throw new Error(`Пользователь с ID ${userId} не найден в базе данных`);

    const streamer = await this.getStreamerById(streamerId);
    if (!streamer) throw new Error(`Стример с ID ${streamerId} не найден в базе данных`);

    await this.db.execute({
      sql: 'INSERT OR IGNORE INTO user_streamers (user_id, streamer_id) VALUES (?, ?)',
      args: [userId, streamerId]
    });
  }

  async removeTrackedStreamer(userId, streamerId) {
    await this.db.execute({
      sql: 'DELETE FROM user_streamers WHERE user_id = ? AND streamer_id = ?',
      args: [userId, streamerId]
    });
  }

  async getTrackedStreamers(userId) {
    const rs = await this.db.execute({
      sql: `SELECT s.*, us.created_at as tracked_at
            FROM streamers s
            JOIN user_streamers us ON s.id = us.streamer_id
            WHERE us.user_id = ?
            ORDER BY us.created_at DESC`,
      args: [userId]
    });
    return rs.rows;
  }

  async isStreamerTracked(userId, streamerId) {
    const rs = await this.db.execute({
      sql: 'SELECT 1 FROM user_streamers WHERE user_id = ? AND streamer_id = ?',
      args: [userId, streamerId]
    });
    return rs.rows.length > 0;
  }

  // ── Вишлист ──

  async saveWishlistItems(streamerId, items) {
    const stmts = [
      { sql: 'DELETE FROM wishlist_items WHERE streamer_id = ?', args: [streamerId] }
    ];
    for (const item of items) {
      const hash = this.generateItemHash(item);
      stmts.push({
        sql: `INSERT INTO wishlist_items (streamer_id, image, price, name, product_url, item_hash)
              VALUES (?, ?, ?, ?, ?, ?)`,
        args: [streamerId, item.image, item.price, item.name, item.productUrl, hash]
      });
    }
    await this.db.batch(stmts, 'write');
  }

  async getWishlistItems(streamerId) {
    const rs = await this.db.execute({
      sql: 'SELECT * FROM wishlist_items WHERE streamer_id = ? ORDER BY created_at DESC',
      args: [streamerId]
    });
    return rs.rows;
  }

  async getNewWishlistItems(streamerId, items) {
    const current = await this.getWishlistItems(streamerId);
    const hashes = new Set(current.map(i => i.item_hash));
    return items.filter(item => !hashes.has(this.generateItemHash(item)));
  }

  generateItemHash(item) {
    const str = `${item.name || ''}_${item.price || ''}_${item.image || ''}`;
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + c;
      hash = hash & hash;
    }
    return hash.toString();
  }

  // ── Планировщик ──

  async getAllTrackedStreamers() {
    const rs = await this.db.execute(
      'SELECT DISTINCT s.* FROM streamers s JOIN user_streamers us ON s.id = us.streamer_id'
    );
    return rs.rows;
  }

  async getStreamerFollowers(streamerId) {
    const rs = await this.db.execute({
      sql: `SELECT u.* FROM users u
            JOIN user_streamers us ON u.id = us.user_id
            WHERE us.streamer_id = ?`,
      args: [streamerId]
    });
    return rs.rows;
  }
}

// Singleton
const instance = new DatabaseService();
module.exports = instance;
