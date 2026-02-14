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
      `CREATE TABLE IF NOT EXISTS groups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id INTEGER UNIQUE NOT NULL,
        title TEXT,
        added_by_user_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (added_by_user_id) REFERENCES users(id) ON DELETE SET NULL
      )`,
      `CREATE TABLE IF NOT EXISTS user_streamer_settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        streamer_id INTEGER NOT NULL,
        notifications_enabled INTEGER DEFAULT 1,
        notify_in_pm INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (streamer_id) REFERENCES streamers(id) ON DELETE CASCADE,
        UNIQUE(user_id, streamer_id)
      )`,
      `CREATE TABLE IF NOT EXISTS group_streamer_settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        group_id INTEGER NOT NULL,
        streamer_id INTEGER NOT NULL,
        enabled INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
        FOREIGN KEY (streamer_id) REFERENCES streamers(id) ON DELETE CASCADE,
        UNIQUE(group_id, streamer_id)
      )`,
      `CREATE TABLE IF NOT EXISTS user_groups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        group_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
        UNIQUE(user_id, group_id)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_user_streamers_user ON user_streamers(user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_user_streamers_streamer ON user_streamers(streamer_id)`,
      `CREATE INDEX IF NOT EXISTS idx_wishlist_streamer ON wishlist_items(streamer_id)`,
      `CREATE INDEX IF NOT EXISTS idx_user_groups_user ON user_groups(user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_user_groups_group ON user_groups(group_id)`
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

  // ── Группы ──

  async createGroup(chatId, title, addedByUserId) {
    await this.db.execute({
      sql: `INSERT OR IGNORE INTO groups (chat_id, title, added_by_user_id) VALUES (?, ?, ?)`,
      args: [chatId, title, addedByUserId]
    });
    return this.getGroupByChatId(chatId);
  }

  async getGroupByChatId(chatId) {
    const rs = await this.db.execute({
      sql: 'SELECT * FROM groups WHERE chat_id = ?',
      args: [chatId]
    });
    return rs.rows[0] || null;
  }

  async linkUserToGroup(userId, groupId) {
    await this.db.execute({
      sql: 'INSERT OR IGNORE INTO user_groups (user_id, group_id) VALUES (?, ?)',
      args: [userId, groupId]
    });
  }

  async getUserGroups(userId) {
    const rs = await this.db.execute({
      sql: `SELECT g.* FROM groups g
            JOIN user_groups ug ON g.id = ug.group_id
            WHERE ug.user_id = ?`,
      args: [userId]
    });
    return rs.rows;
  }

  // ── Настройки уведомлений ──

  async getStreamerSettings(userId, streamerId) {
    const rs = await this.db.execute({
      sql: 'SELECT * FROM user_streamer_settings WHERE user_id = ? AND streamer_id = ?',
      args: [userId, streamerId]
    });
    return rs.rows[0] || { notifications_enabled: 1, notify_in_pm: 1 };
  }

  async updateStreamerSettings(userId, streamerId, settings) {
    await this.db.execute({
      sql: `INSERT INTO user_streamer_settings (user_id, streamer_id, notifications_enabled, notify_in_pm)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(user_id, streamer_id) DO UPDATE SET
              notifications_enabled = excluded.notifications_enabled,
              notify_in_pm = excluded.notify_in_pm`,
      args: [userId, streamerId, settings.notifications_enabled, settings.notify_in_pm]
    });
  }

  async getGroupStreamerSettings(groupId, streamerId) {
    const rs = await this.db.execute({
      sql: 'SELECT * FROM group_streamer_settings WHERE group_id = ? AND streamer_id = ?',
      args: [groupId, streamerId]
    });
    return rs.rows[0] || { enabled: 0 };
  }

  async updateGroupStreamerSettings(groupId, streamerId, enabled) {
    await this.db.execute({
      sql: `INSERT INTO group_streamer_settings (group_id, streamer_id, enabled)
            VALUES (?, ?, ?)
            ON CONFLICT(group_id, streamer_id) DO UPDATE SET enabled = excluded.enabled`,
      args: [groupId, streamerId, enabled ? 1 : 0]
    });
  }

  async getGroupsForStreamerNotifications(streamerId) {
    const rs = await this.db.execute({
      sql: `SELECT g.* FROM groups g
            JOIN group_streamer_settings gss ON g.id = gss.group_id
            WHERE gss.streamer_id = ? AND gss.enabled = 1`,
      args: [streamerId]
    });
    return rs.rows;
  }
}

// Singleton
const instance = new DatabaseService();
module.exports = instance;
