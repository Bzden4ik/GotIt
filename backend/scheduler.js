const fettaParser = require('./parsers/fettaParser');
const db = require('./database/database');
const TelegramBot = require('./bot/telegramBot');

let globalSchedulerInstance = null;

class Scheduler {
  constructor(botToken) {
    if (globalSchedulerInstance) {
      console.log('⚠ Планировщик уже создан, используем существующий экземпляр');
      return globalSchedulerInstance;
    }

    console.log('📅 Создание нового экземпляра планировщика');

    this.schedulerId = Math.random().toString(36).substring(7);
    this.bot = botToken ? new TelegramBot(botToken) : null;
    this.isRunning = false;
    this.intervalId = null;
    this.heartbeatId = null;
    this.hasLock = false;

    // Priority-based intervals
    const normalInterval = (parseInt(process.env.CHECK_INTERVAL) || 60) * 1000;
    this.checkIntervals = { 3: 30000, 2: 60000, 1: normalInterval };
    this.streamerDelays  = { 3: 3000,  2: 5000,  1: null }; // null = 10-15с рандом

    // Priority queue: массив { streamer, addedAt }
    // Воркер берёт по одному — нет параллельных запросов к fetta.app
    this.queue = [];
    this.queuedIds = new Set();   // чтобы не добавлять одного стримера дважды
    this.workerBusy = false;
    this.lastChecked = new Map(); // streamerId -> timestamp последней проверки

    console.log(`📋 Планировщик ID: ${this.schedulerId}`);
    globalSchedulerInstance = this;
  }

  // ─── Запуск ───────────────────────────────────────────────────────────────

  async start(intervalSeconds = 60) {
    if (this.isRunning) {
      console.log('⚠ Планировщик уже запущен');
      return;
    }

    this.hasLock = await db.tryAcquireSchedulerLock(this.schedulerId);
    if (!this.hasLock) {
      console.log('⚠ Лок занят другим инстансом');
      this.retryIntervalId = setInterval(async () => {
        if (this.isRunning) return;
        this.hasLock = await db.tryAcquireSchedulerLock(this.schedulerId);
        if (this.hasLock) {
          clearInterval(this.retryIntervalId);
          this.retryIntervalId = null;
          this.startChecks();
        }
      }, 30000);
      return;
    }

    console.log('🔒 Лок захвачен');
    this.startChecks();
  }

  startChecks() {
    if (this.isRunning) return;
    this.isRunning = true;

    // Heartbeat
    this.heartbeatId = setInterval(() => db.updateSchedulerHeartbeat(this.schedulerId), 20000);

    // Тик каждые 5с: добавляем в очередь стримеров, у которых истёк интервал
    this.intervalId = setInterval(() => {
      if (this.isWithinWorkingHours()) this.enqueueDueStreamers();
    }, 5000);

    const normalSec = Math.round((this.checkIntervals[1]) / 1000);
    console.log(`✅ Планировщик запущен | VIP=30с High=60с Normal=${normalSec}с | тик=5с`);

    // Первый запуск через 10с
    setTimeout(() => {
      if (this.isWithinWorkingHours()) this.enqueueDueStreamers();
    }, 10000);
  }

  async stop() {
    clearInterval(this.intervalId);
    clearInterval(this.heartbeatId);
    clearInterval(this.retryIntervalId);
    this.intervalId = this.heartbeatId = this.retryIntervalId = null;
    this.isRunning = false;
    if (this.hasLock) {
      await db.releaseSchedulerLock(this.schedulerId);
      this.hasLock = false;
    }
    console.log('✓ Планировщик остановлен');
  }

  // ─── Очередь ──────────────────────────────────────────────────────────────

  async enqueueDueStreamers() {
    let streamers;
    try {
      streamers = await db.getAllTrackedStreamers();
    } catch (e) {
      console.error('Ошибка получения стримеров:', e.message);
      return;
    }

    if (!streamers.length) return;

    // Дедупликация по nickname
    const seen = new Set();
    const unique = [];
    for (const s of streamers) {
      const key = s.nickname.toLowerCase();
      if (!seen.has(key)) { seen.add(key); unique.push(s); }
    }

    const now = Date.now();
    let added = 0;

    for (const streamer of unique) {
      if (this.queuedIds.has(streamer.id)) continue; // уже в очереди

      const priority = streamer.priority || 1;
      const interval = this.checkIntervals[priority] || this.checkIntervals[1];
      const last = this.lastChecked.get(streamer.id) || 0;

      if (now - last >= interval) {
        this.lastChecked.set(streamer.id, now); // помечаем сразу при постановке в очередь
        this.enqueue(streamer);
        added++;
      }
    }

    if (added > 0) {
      console.log(`📥 Добавлено в очередь: ${added} стримеров (в очереди всего: ${this.queue.length})`);
      this.runWorker();
    }
  }

  enqueue(streamer) {
    // Вставляем по приоритету: VIP в начало, Normal в конец
    const priority = streamer.priority || 1;
    if (priority === 3) {
      // VIP — в самое начало
      this.queue.unshift(streamer);
    } else if (priority === 2) {
      // High — перед Normal, но после VIP
      const firstNormal = this.queue.findIndex(s => (s.priority || 1) === 1);
      if (firstNormal === -1) this.queue.push(streamer);
      else this.queue.splice(firstNormal, 0, streamer);
    } else {
      this.queue.push(streamer);
    }
    this.queuedIds.add(streamer.id);
  }

  // ─── Воркер ───────────────────────────────────────────────────────────────

  async runWorker() {
    if (this.workerBusy) return; // воркер уже работает
    this.workerBusy = true;

    while (this.queue.length > 0) {
      const streamer = this.queue.shift();
      this.queuedIds.delete(streamer.id);

      await this.checkStreamer(streamer);
      // lastChecked уже выставлен при enqueue — не перезаписываем

      // Пауза после проверки зависит от приоритета ПРОВЕРЕННОГО стримера
      if (this.queue.length > 0) {
        const priority = streamer.priority || 1;
        const rawDelay = this.streamerDelays[priority];
        const delay = rawDelay !== null ? rawDelay : 10000 + Math.random() * 5000;
        console.log(`  ⏳ Пауза ${Math.round(delay / 1000)}с...`);
        await this.sleep(delay);
      }
    }

    this.workerBusy = false;
  }

  // ─── Проверка стримера ────────────────────────────────────────────────────

  async checkStreamer(streamer) {
    try {
      console.log(`\n▶ Проверка: ${streamer.nickname} [P${streamer.priority || 1}]`);

      let result = null;
      for (let attempt = 0; attempt <= 2; attempt++) {
        try {
          result = await fettaParser.getStreamerInfo(streamer.nickname);
          break;
        } catch (err) {
          if (err.message?.includes('429') && attempt < 2) {
            const wait = (attempt + 1) * 10;
            console.log(`  ⚠ Rate limit, ждём ${wait}с (попытка ${attempt + 1}/2)`);
            await this.sleep(wait * 1000);
          } else throw err;
        }
      }

      if (!result?.success || !result.wishlist) {
        console.log(`  ⚠ Не удалось получить вишлист`);
        return;
      }

      const currentItems = result.wishlist;
      const existingItems = await db.getWishlistItems(streamer.id);

      console.log(`  API: ${currentItems.length} товаров | БД: ${existingItems.length} товаров`);

      // Защиты от ложных данных
      if (currentItems.length === 0 && existingItems.length > 10) {
        console.log(`  ⚠ 0 товаров при ${existingItems.length} в БД — пропускаем (неполная загрузка?)`);
        return;
      }
      if (existingItems.length > 10 && currentItems.length > 0 && currentItems.length < 5) {
        console.log(`  ⚠ Подозрительно мало товаров — пропускаем`);
        return;
      }
      if (existingItems.length > 10 && currentItems.length > 0) {
        const drop = (existingItems.length - currentItems.length) / existingItems.length;
        if (drop > 0.3) {
          console.log(`  ⚠ Товаров упало на ${Math.round(drop * 100)}% — пропускаем`);
          return;
        }
      }

      const newItems = await db.getNewWishlistItems(streamer.id, currentItems);
      console.log(`  Новых: ${newItems.length}`);

      if (newItems.length > 0) {
        if (existingItems.length === 0 && currentItems.length > 2) {
          console.log(`  ⚠ База пустая, первая синхронизация — без уведомлений`);
        } else {
          const followers = await db.getStreamerFollowers(streamer.id);
          for (const f of followers) await this.sendNotificationToUser(f, streamer, newItems);
          const groups = await db.getGroupsForStreamerNotifications(streamer.id);
          for (const g of groups) await this.sendNotificationToGroup(g, streamer, newItems);
          console.log(`  ✓ Уведомлено: ${followers.length} польз. + ${groups.length} групп`);
        }
      }

      await db.saveWishlistItems(streamer.id, currentItems);
    } catch (err) {
      console.error(`  ✗ Ошибка ${streamer.nickname}: ${err.message}`);
    }
  }

  // ─── Уведомления ─────────────────────────────────────────────────────────

  async sendNotificationToUser(user, streamer, newItems) {
    if (!this.bot || !user.telegram_id) return;
    try {
      const settings = await db.getStreamerSettings(user.id, streamer.id);
      if (!settings.notifications_enabled || !settings.notify_in_pm) return;
      await this.bot.sendNewItemsNotification(
        user.telegram_id, streamer.name || streamer.nickname,
        streamer.fetta_url, newItems, true
      );
    } catch (err) {
      console.error(`  ✗ Уведомление @${user.username}: ${err.message}`);
    }
  }

  async sendNotificationToGroup(group, streamer, newItems) {
    if (!this.bot) return;
    try {
      await this.bot.sendNewItemsNotification(
        group.chat_id, streamer.name || streamer.nickname,
        streamer.fetta_url, newItems, false
      );
    } catch (err) {
      console.error(`  ✗ Уведомление группа ${group.title}: ${err.message}`);
    }
  }

  // ─── Утилиты ──────────────────────────────────────────────────────────────

  isWithinWorkingHours() {
    const h = new Date().getUTCHours();
    return h >= 4 || h < 1; // 7:00–3:00 МСК
  }

  sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  getLastCheckedMap() {
    const out = {};
    for (const [id, ts] of this.lastChecked) out[id] = ts;
    return out;
  }

  getQueueStatus() {
    return {
      queueLength: this.queue.length,
      workerBusy: this.workerBusy,
      queued: this.queue.map(s => ({ id: s.id, nickname: s.nickname, priority: s.priority || 1 }))
    };
  }
}

module.exports = Scheduler;
