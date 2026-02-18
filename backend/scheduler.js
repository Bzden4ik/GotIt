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
    this.baseDelays     = { 3: 3000,  2: 5000,  1: 15000 }; // базовая пауза после проверки

    // Очередь и состояние
    this.queue      = [];        // [{ streamer, addedAt }]
    this.queuedIds  = new Set();
    this.workerBusy = false;
    this.lastChecked = new Map(); // id -> timestamp постановки в очередь

    // Умный планировщик
    this.checkHistory = new Map(); // id -> [duration1, duration2, ...] последние 5
    this.currentStreamer = null;   // { streamer, startedAt } — что проверяется сейчас
    this.planLog = [];             // последние N записей плана для UI
    this.workerStartedAt = null;   // для watchdog

    console.log(`📋 Планировщик ID: ${this.schedulerId}`);
    globalSchedulerInstance = this;
  }

  // ─── Запуск ───────────────────────────────────────────────────────────────

  async start(intervalSeconds = 60) {
    if (this.isRunning) { console.log('⚠ Планировщик уже запущен'); return; }

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

    this.heartbeatId = setInterval(() => db.updateSchedulerHeartbeat(this.schedulerId), 20000);

    // Тик каждые 5с — добавляем в очередь стримеров у которых истёк интервал
    this.intervalId = setInterval(() => {
      if (this.isWithinWorkingHours()) this.enqueueDueStreamers();
    }, 5000);

    const normalSec = Math.round(this.checkIntervals[1] / 1000);
    console.log(`✅ Планировщик запущен | VIP=30с High=60с Normal=${normalSec}с | тик=5с`);

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
    // Watchdog: если текущий стример проверяется дольше 5 минут — принудительный сброс
    const WORKER_TIMEOUT = 5 * 60 * 1000;
    const watchdogTs = this.currentStreamer?.startedAt ?? this.workerStartedAt;
    if (this.workerBusy && watchdogTs && (Date.now() - watchdogTs) > WORKER_TIMEOUT) {
      const nick = this.currentStreamer?.streamer?.nickname ?? '?';
      console.warn(`⚠ Watchdog: стример ${nick} проверяется >5 мин, принудительный сброс`);
      this.workerBusy = false;
      this.currentStreamer = null;
      this.workerStartedAt = null;
    }
    let streamers;
    try { streamers = await db.getAllTrackedStreamers(); }
    catch (e) { console.error('Ошибка получения стримеров:', e.message); return; }
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
      if (this.queuedIds.has(streamer.id)) continue;
      // Не добавляем того, кто сейчас проверяется
      if (this.currentStreamer?.streamer.id === streamer.id) continue;

      const priority = streamer.priority || 1;
      const interval = this.checkIntervals[priority] || this.checkIntervals[1];
      const last = this.lastChecked.get(streamer.id) || 0;

      if (now - last >= interval) {
        this.lastChecked.set(streamer.id, now);
        this.enqueue(streamer);
        added++;
      }
    }

    if (added > 0) {
      console.log(`📥 В очередь: +${added} (всего: ${this.queue.length})`);
      this.runWorker();
    }
  }

  enqueue(streamer) {
    const priority = streamer.priority || 1;
    if (priority === 3) {
      this.queue.unshift(streamer);
    } else if (priority === 2) {
      const firstNormal = this.queue.findIndex(s => (s.priority || 1) === 1);
      if (firstNormal === -1) this.queue.push(streamer);
      else this.queue.splice(firstNormal, 0, streamer);
    } else {
      this.queue.push(streamer);
    }
    this.queuedIds.add(streamer.id);
  }

  // ─── Умный планировщик ────────────────────────────────────────────────────

  /** Среднее время проверки стримера (мс). Дефолт 25с */
  estimateDuration(streamerId) {
    const hist = this.checkHistory.get(streamerId);
    if (!hist || !hist.length) return 25000;
    return Math.round(hist.reduce((a, b) => a + b, 0) / hist.length);
  }

  /** Записать реальное время проверки */
  recordDuration(streamerId, durationMs) {
    const hist = this.checkHistory.get(streamerId) || [];
    hist.push(durationMs);
    if (hist.length > 5) hist.shift(); // храним последние 5
    this.checkHistory.set(streamerId, hist);
  }

  /**
   * Найти кандидата для вставки в паузу.
   * availableMs — сколько мс есть в паузе.
   * Возвращает { streamer, index } или null.
   */
  findGapCandidate(availableMs) {
    const BUFFER = 3000; // 3с буфер безопасности
    const needed = availableMs - BUFFER;
    if (needed < 5000) return null; // меньше 5с — не стоит пытаться

    // Ищем в очереди VIP или High который влезет по времени
    for (let i = 0; i < this.queue.length; i++) {
      const s = this.queue[i];
      const priority = s.priority || 1;
      if (priority === 1) continue; // Normal не вставляем
      const est = this.estimateDuration(s.id);
      if (est <= needed) {
        return { streamer: s, index: i };
      }
    }

    // Если в очереди нет подходящих — ищем среди "почти готовых" VIP/High
    // (lastChecked + interval - now <= availableMs)
    const now = Date.now();
    // Этот случай сложнее — пропустим его, очередь достаточно хороша
    return null;
  }

  /** Добавить запись в planLog (для UI) */
  addPlanLog(entry) {
    this.planLog.unshift({ ...entry, ts: Date.now() });
    if (this.planLog.length > 50) this.planLog.pop();
  }

  // ─── Воркер ───────────────────────────────────────────────────────────────

  async runWorker() {
    if (this.workerBusy) return;
    this.workerBusy = true;
    this.workerStartedAt = Date.now();

    try {
      while (this.queue.length > 0) {
        const streamer = this.queue.shift();
        this.queuedIds.delete(streamer.id);

        const startTime = Date.now();
        this.currentStreamer = { streamer, startedAt: startTime };
        this.workerStartedAt = startTime; // обновляем watchdog-таймер на каждый стример

        try {
          await this.checkStreamer(streamer);
        } catch (err) {
          console.error(`  ✗ Необработанная ошибка checkStreamer ${streamer.nickname}: ${err.message}`);
        }

        const duration = Date.now() - startTime;
        this.recordDuration(streamer.id, duration);
        this.currentStreamer = null;

        console.log(`  ⏱ Время проверки: ${Math.round(duration / 1000)}с`);

        if (this.queue.length === 0) break;

        try {
          const priority = streamer.priority || 1;
          const baseDelay = this.baseDelays[priority] || 15000;
          await this.smartDelay(baseDelay, duration);
        } catch (err) {
          console.error(`  ✗ Ошибка в smartDelay: ${err.message}`);
          await this.sleep(5000); // запасная пауза
        }
      }
    } catch (err) {
      console.error('✗ Критическая ошибка воркера:', err.message);
    } finally {
      this.currentStreamer = null;
      this.workerBusy = false;
      this.workerStartedAt = null;
      console.log('✓ Воркер завершил работу');
    }
  }

  /**
   * Умная пауза: если есть VIP/High который влезет — проверяем его
   * вместо ожидания. Иначе просто ждём baseDelay.
   */
  async smartDelay(baseDelay, lastCheckDuration) {
    // Проверяем: можно ли вставить кого-то в паузу
    const candidate = this.findGapCandidate(baseDelay);

    if (candidate) {
      // Есть кандидат — небольшая пауза, затем проверяем его
      const prePause = 3000; // 3с между проверками всегда
      const remaining = baseDelay - this.estimateDuration(candidate.streamer.id) - prePause;

      console.log(`  💡 Вставка в паузу: ${candidate.streamer.nickname} [P${candidate.streamer.priority}] (est. ${Math.round(this.estimateDuration(candidate.streamer.id)/1000)}с, остаток ~${Math.round(Math.max(0,remaining)/1000)}с)`);

      this.addPlanLog({
        type: 'gap_insert',
        nickname: candidate.streamer.nickname,
        priority: candidate.streamer.priority || 1,
        estimatedMs: this.estimateDuration(candidate.streamer.id),
        baseDelay
      });

      // Извлекаем кандидата из очереди
      this.queue.splice(candidate.index, 1);
      this.queuedIds.delete(candidate.streamer.id);

      await this.sleep(prePause);

      const gapStart = Date.now();
      this.currentStreamer = { streamer: candidate.streamer, startedAt: gapStart };
      this.workerStartedAt = gapStart; // обновляем watchdog-таймер
      await this.checkStreamer(candidate.streamer);
      const gapDuration = Date.now() - gapStart;
      this.recordDuration(candidate.streamer.id, gapDuration);
      this.currentStreamer = null;

      console.log(`  ⏱ Вставка завершена за ${Math.round(gapDuration/1000)}с`);

      // Ждём остаток паузы (минимум 3с)
      const postPause = Math.max(3000, remaining - gapDuration);
      if (postPause > 500) {
        console.log(`  ⏳ Остаток паузы: ${Math.round(postPause/1000)}с`);
        await this.sleep(postPause);
      }
    } else {
      console.log(`  ⏳ Пауза ${Math.round(baseDelay/1000)}с...`);
      await this.sleep(baseDelay);
    }
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

      console.log(`  API: ${currentItems.length} | БД: ${existingItems.length}`);

      // Защиты от ложных данных
      if (currentItems.length === 0 && existingItems.length > 10) {
        console.log(`  ⚠ 0 товаров при ${existingItems.length} в БД — пропускаем`);
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
          console.log(`  ⚠ Первая синхронизация — без уведомлений`);
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
      console.error(`  ✗ Группа ${group.title}: ${err.message}`);
    }
  }

  // ─── Утилиты ──────────────────────────────────────────────────────────────

  isWithinWorkingHours() {
    const h = new Date().getUTCHours();
    return h >= 4 || h < 1;
  }

  sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  getLastCheckedMap() {
    const out = {};
    for (const [id, ts] of this.lastChecked) out[id] = ts;
    return out;
  }

  getQueueStatus() {
    const historyOut = {};
    for (const [id, hist] of this.checkHistory) {
      historyOut[id] = {
        avg: Math.round(hist.reduce((a, b) => a + b, 0) / hist.length),
        samples: hist.length
      };
    }
    return {
      workerBusy: this.workerBusy,
      currentStreamer: this.currentStreamer ? {
        id: this.currentStreamer.streamer.id,
        nickname: this.currentStreamer.streamer.nickname,
        priority: this.currentStreamer.streamer.priority || 1,
        runningMs: Date.now() - this.currentStreamer.startedAt
      } : null,
      queue: this.queue.map(s => ({
        id: s.id,
        nickname: s.nickname,
        priority: s.priority || 1,
        estimatedMs: this.estimateDuration(s.id)
      })),
      history: historyOut,
      planLog: this.planLog.slice(0, 10)
    };
  }
}

module.exports = Scheduler;
