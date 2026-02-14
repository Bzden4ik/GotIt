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
    // Проверяем существует ли уже
    const existing = await this.getUserByTelegramId(telegramId);
    if (existing) {
      return; // Пользователь уже есть, не делаем write
    }
    
    await this.db.execute({
      sql: `INSERT INTO users (telegram_id, username, first_name) VALUES (?, ?, ?)`,
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
    
    // Проверяем существующего стримера
    const existing = await this.getStreamerByNickname(nickname);
    
    if (existing) {
      // Проверяем нужно ли обновлять
      const needsUpdate = 
        existing.name !== name ||
        existing.username !== username ||
        existing.avatar !== avatar ||
        existing.description !== description ||
        existing.fetta_url !== fettaUrl;
      
      if (!needsUpdate) {
        console.log(`Стример ${nickname} не изменился, пропуск UPDATE`);
        return existing;
      }
      
      console.log(`Обновление данных стримера ${nickname}`);
      await this.db.execute({
        sql: `UPDATE streamers SET 
              name = ?, username = ?, avatar = ?, description = ?, 
              fetta_url = ?, updated_at = CURRENT_TIMESTAMP 
              WHERE nickname = ?`,
        args: [name, username, avatar, description, fettaUrl, nickname]
      });
    } else {
      console.log(`Создание нового стримера ${nickname}`);
      await this.db.execute({
        sql: `INSERT INTO streamers (nickname, name, username, avatar, description, fetta_url, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        args: [nickname, name, username, avatar, description, fettaUrl]
      });
    }
    
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

    // Проверяем уже отслеживается ли
    const isTracked = await this.isStreamerTracked(userId, streamerId);
    if (isTracked) {
      return; // Уже отслеживается, не делаем write
    }

    await this.db.execute({
      sql: 'INSERT INTO user_streamers (user_id, streamer_id) VALUES (?, ?)',
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
    // Получаем текущие товары из базы
    const existingItems = await this.getWishlistItems(streamerId);
    const existingHashes = new Map(existingItems.map(i => [i.item_hash, i]));
    
    // Генерируем хеши для новых товаров
    const newItemsMap = new Map();
    for (const item of items) {
      const hash = this.generateItemHash(item);
      newItemsMap.set(hash, item);
    }
    
    const stmts = [];
    
    // Удаляем товары, которых больше нет
    const toDelete = [];
    for (const [hash, item] of existingHashes) {
      if (!newItemsMap.has(hash)) {
        toDelete.push(item.id);
      }
    }
    
    if (toDelete.length > 0) {
      for (const id of toDelete) {
        stmts.push({
          sql: 'DELETE FROM wishlist_items WHERE id = ?',
          args: [id]
        });
      }
    }
    
    // Добавляем только новые товары
    const toAdd = [];
    for (const [hash, item] of newItemsMap) {
      if (!existingHashes.has(hash)) {
        toAdd.push({ hash, item });
      }
    }
    
    if (toAdd.length > 0) {
      for (const { hash, item } of toAdd) {
        stmts.push({
          sql: `INSERT INTO wishlist_items (streamer_id, image, price, name, product_url, item_hash)
                VALUES (?, ?, ?, ?, ?, ?)`,
          args: [streamerId, item.image, item.price, item.name, item.productUrl, hash]
        });
      }
    }
    
    // Выполняем только если есть изменения
    if (stmts.length > 0) {
      await this.db.batch(stmts, 'write');
      console.log(`  ✓ База обновлена: +${toAdd.length} новых, -${toDelete.length} удалённых (writes: ${stmts.length})`);
    } else {
      console.log(`  ✓ Изменений нет (writes: 0)`);
    }
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
    // DISTINCT по nickname (case-insensitive) чтобы избежать дублей
    const rs = await this.db.execute(
      `SELECT s.id, s.nickname, s.name, s.username, s.avatar, s.description, s.fetta_url, s.created_at, s.updated_at 
       FROM streamers s 
       JOIN user_streamers us ON s.id = us.streamer_id
       GROUP BY LOWER(s.nickname)
       ORDER BY s.id ASC`
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
    // Проверяем существует ли уже
    const existing = await this.getGroupByChatId(chatId);
    if (existing) {
      return existing; // Группа уже есть, не делаем write
    }
    
    await this.db.execute({
      sql: `INSERT INTO groups (chat_id, title, added_by_user_id) VALUES (?, ?, ?)`,
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
    // Проверяем уже связаны ли
    const rs = await this.db.execute({
      sql: 'SELECT 1 FROM user_groups WHERE user_id = ? AND group_id = ?',
      args: [userId, groupId]
    });
    
    if (rs.rows.length > 0) {
      return; // Уже связаны, не делаем write
    }
    
    await this.db.execute({
      sql: 'INSERT INTO user_groups (user_id, group_id) VALUES (?, ?)',
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
    // Проверяем текущие настройки
    const current = await this.getStreamerSettings(userId, streamerId);
    
    // Если ничего не изменилось - не делаем write
    if (current.notifications_enabled === settings.notifications_enabled &&
        current.notify_in_pm === settings.notify_in_pm) {
      return;
    }
    
    // Проверяем есть ли запись
    const rs = await this.db.execute({
      sql: 'SELECT 1 FROM user_streamer_settings WHERE user_id = ? AND streamer_id = ?',
      args: [userId, streamerId]
    });
    
    if (rs.rows.length > 0) {
      // UPDATE только если изменилось
      await this.db.execute({
        sql: `UPDATE user_streamer_settings SET 
              notifications_enabled = ?, notify_in_pm = ? 
              WHERE user_id = ? AND streamer_id = ?`,
        args: [settings.notifications_enabled, settings.notify_in_pm, userId, streamerId]
      });
    } else {
      // INSERT новой записи
      await this.db.execute({
        sql: `INSERT INTO user_streamer_settings (user_id, streamer_id, notifications_enabled, notify_in_pm)
              VALUES (?, ?, ?, ?)`,
        args: [userId, streamerId, settings.notifications_enabled, settings.notify_in_pm]
      });
    }
  }

  async getGroupStreamerSettings(groupId, streamerId) {
    const rs = await this.db.execute({
      sql: 'SELECT * FROM group_streamer_settings WHERE group_id = ? AND streamer_id = ?',
      args: [groupId, streamerId]
    });
    return rs.rows[0] || { enabled: 0 };
  }

  async updateGroupStreamerSettings(groupId, streamerId, enabled) {
    const enabledInt = enabled ? 1 : 0;
    
    // Проверяем текущие настройки
    const current = await this.getGroupStreamerSettings(groupId, streamerId);
    
    // Если ничего не изменилось - не делаем write
    if (current.enabled === enabledInt) {
      return;
    }
    
    // Проверяем есть ли запись
    const rs = await this.db.execute({
      sql: 'SELECT 1 FROM group_streamer_settings WHERE group_id = ? AND streamer_id = ?',
      args: [groupId, streamerId]
    });
    
    if (rs.rows.length > 0) {
      // UPDATE только если изменилось
      await this.db.execute({
        sql: 'UPDATE group_streamer_settings SET enabled = ? WHERE group_id = ? AND streamer_id = ?',
        args: [enabledInt, groupId, streamerId]
      });
    } else {
      // INSERT новой записи
      await this.db.execute({
        sql: 'INSERT INTO group_streamer_settings (group_id, streamer_id, enabled) VALUES (?, ?, ?)',
        args: [groupId, streamerId, enabledInt]
      });
    }
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
