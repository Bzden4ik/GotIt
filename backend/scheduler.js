const fettaParser = require('./parsers/fettaParser');
const db = require('./database/database');
const TelegramBot = require('./bot/telegramBot');

// Глобальная переменная для отслеживания запущенного планировщика
let globalSchedulerInstance = null;

class Scheduler {
  constructor(botToken) {
    // Проверяем что не создан другой экземпляр
    if (globalSchedulerInstance) {
      console.log('⚠ Планировщик уже создан, используем существующий экземпляр');
      return globalSchedulerInstance;
    }
    
    console.log('📅 Создание нового экземпляра планировщика');
    
    this.schedulerId = Math.random().toString(36).substring(7); // Уникальный ID
    this.bot = botToken ? new TelegramBot(botToken) : null;
    this.isRunning = false;
    this.isChecking = false; // НОВЫЙ флаг для предотвращения параллельных проверок
    this.intervalId = null;
    this.heartbeatId = null;
    this.hasLock = false;
    
    console.log(`📋 Планировщик ID: ${this.schedulerId}`);
    
    globalSchedulerInstance = this;
  }

  async start(intervalSeconds = 30) {
    if (this.isRunning) { 
      console.log('⚠ Планировщик уже запущен, пропускаем повторный запуск');
      return; 
    }
    
    console.log(`🚀 Запуск планировщика: каждые ${intervalSeconds} секунд, с 7:00 до 3:00 МСК (ночью)`);
    
    // Пытаемся захватить лок
    this.hasLock = await db.tryAcquireSchedulerLock(this.schedulerId);
    
    if (!this.hasLock) {
      console.log('⚠ Лок занят другим инстансом, планировщик не запущен');
      console.log('💡 Если это единственный инстанс, лок освободится через 60 сек');
      
      // Пробуем захватить лок каждые 30 секунд
      this.intervalId = setInterval(async () => {
        this.hasLock = await db.tryAcquireSchedulerLock(this.schedulerId);
        if (this.hasLock) {
          console.log('🔒 Лок захвачен! Запускаем проверки...');
          this.startChecks(intervalSeconds);
        }
      }, 30000);
      
      return;
    }
    
    console.log('🔒 Лок захвачен успешно');
    this.startChecks(intervalSeconds);
  }

  startChecks(intervalSeconds) {
    // Heartbeat каждые 20 секунд
    this.heartbeatId = setInterval(async () => {
      await db.updateSchedulerHeartbeat(this.schedulerId);
    }, 20000);
    
    // Основной цикл проверки
    this.intervalId = setInterval(async () => {
      if (this.isWithinWorkingHours()) {
        await this.checkAllStreamers();
      }
    }, intervalSeconds * 1000);
    
    this.isRunning = true;
    console.log('✅ Планировщик запущен успешно');
    
    // Первая проверка через 3 секунды
    setTimeout(() => {
      if (this.isWithinWorkingHours()) {
        console.log('Выполняется первая проверка стримеров...');
        this.checkAllStreamers();
      } else {
        console.log('Пропуск первой проверки - вне рабочего времени');
      }
    }, 10000);
  }

  async stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    
    if (this.heartbeatId) {
      clearInterval(this.heartbeatId);
      this.heartbeatId = null;
    }
    
    this.isRunning = false;
    
    // Освобождаем лок
    if (this.hasLock) {
      await db.releaseSchedulerLock(this.schedulerId);
      this.hasLock = false;
    }
    
    console.log('✓ Планировщик остановлен');
  }

  isWithinWorkingHours() {
    const now = new Date();
    const utcHours = now.getUTCHours();
    // МСК = UTC+3
    // 7:00 МСК = 4:00 UTC
    // 3:00 МСК = 0:00 UTC (следующего дня)
    // Работаем: 4:00-23:59 UTC и 0:00-0:59 UTC (то есть 7:00-3:00 МСК)
    return utcHours >= 4 || utcHours < 1;
  }

  async checkAllStreamers() {
    // ЗАЩИТА: Если уже выполняется проверка - пропускаем
    if (this.isChecking) {
      console.log('⚠ Проверка уже выполняется, пропускаем...');
      return;
    }
    
    this.isChecking = true; // Устанавливаем флаг
    
    try {
      console.log('\n=== Начало проверки стримеров ===');
      console.log(`Время: ${new Date().toLocaleString('ru-RU')}`);
      console.log(`Планировщик ID: ${this.schedulerId || 'legacy'}`);
      
      const streamers = await db.getAllTrackedStreamers();
      if (streamers.length === 0) { 
        console.log('Нет отслеживаемых стримеров'); 
        return; 
      }
      
      // Убираем дубли по nickname (case-insensitive)
      const uniqueStreamers = [];
      const seenNicknames = new Set();
      
      for (const streamer of streamers) {
        const nicknameLower = streamer.nickname.toLowerCase();
        if (!seenNicknames.has(nicknameLower)) {
          seenNicknames.add(nicknameLower);
          uniqueStreamers.push(streamer);
        } else {
          console.log(`⚠ Пропущен дубль: ${streamer.nickname} (id: ${streamer.id})`);
        }
      }
      
      console.log(`Найдено стримеров: ${streamers.length}, уникальных: ${uniqueStreamers.length}`);
      
      for (const streamer of uniqueStreamers) {
        await this.checkStreamer(streamer);
        
        // КРИТИЧНО: Длинная задержка между стримерами (10-15 секунд)
        if (uniqueStreamers.indexOf(streamer) < uniqueStreamers.length - 1) {
          const delay = 10000 + Math.random() * 5000; // 10-15 секунд
          console.log(`  ⏳ Пауза ${Math.round(delay/1000)}с перед следующим стримером...`);
          await this.sleep(delay); // ВАЖНО: await обязательно!
        }
      }
      console.log('=== Проверка завершена ===\n');
    } catch (error) {
      console.error('Ошибка при проверке стримеров:', error);
    } finally {
      this.isChecking = false; // Снимаем флаг ВСЕГДА
    }
  }

  async checkStreamer(streamer) {
    try {
      console.log(`\nПроверка стримера: ${streamer.nickname}`);
      
      let result = null;
      let retryCount = 0;
      const maxRetries = 2;
      
      // Retry логика для 429 ошибки
      while (retryCount <= maxRetries) {
        try {
          result = await fettaParser.getStreamerInfo(streamer.nickname);
          break; // Успешно получили данные
        } catch (error) {
          if (error.message && error.message.includes('429')) {
            retryCount++;
            if (retryCount <= maxRetries) {
              const waitTime = retryCount * 5; // 5, 10 секунд
              console.log(`  ⚠ Rate limit (429), ожидание ${waitTime} сек (попытка ${retryCount}/${maxRetries})`);
              await this.sleep(waitTime * 1000);
            } else {
              console.log(`  ✗ Превышен лимит попыток, пропускаем стримера`);
              return;
            }
          } else {
            throw error; // Другая ошибка - прокидываем дальше
          }
        }
      }
      
      if (!result || !result.success || !result.wishlist) {
        console.log(`  ⚠ Не удалось получить вишлист для ${streamer.nickname}`);
        return;
      }
      
      const currentItems = result.wishlist;
      console.log(`  Получено товаров из API: ${currentItems.length}`);

      // Проверяем что есть в базе
      const existingItems = await db.getWishlistItems(streamer.id);
      console.log(`  В базе сохранено товаров: ${existingItems.length}`);

      // ЗАЩИТА 1: API вернул 0 товаров, но в базе есть
      if (currentItems.length === 0 && existingItems.length > 0) {
        console.log(`  ⚠ API вернул 0 товаров, но в базе ${existingItems.length}`);
        console.log(`  Это явно rate limit или ошибка API - НЕ сохраняем!`);
        return;
      }

      // ЗАЩИТА 2: API вернул подозрительно мало товаров
      if (existingItems.length > 10 && currentItems.length < 5 && currentItems.length > 0) {
        console.log(`  ⚠ API вернул всего ${currentItems.length} товаров, но в базе ${existingItems.length}`);
        console.log(`  Подозрение на rate limit - НЕ сохраняем!`);
        return;
      }

      // ЗАЩИТА 3: Резкое уменьшение количества (>30%)
      if (existingItems.length > 10 && currentItems.length > 0) {
        const decrease = ((existingItems.length - currentItems.length) / existingItems.length) * 100;
        if (decrease > 30) {
          console.log(`  ⚠ Товаров уменьшилось на ${Math.round(decrease)}% (${existingItems.length} → ${currentItems.length})`);
          console.log(`  Подозрение на неполную загрузку - НЕ сохраняем!`);
          return;
        }
      }

      const newItems = await db.getNewWishlistItems(streamer.id, currentItems);
      console.log(`  Определено новых товаров: ${newItems.length}`);

      if (newItems.length > 0) {
        console.log(`  🎁 Найдено новых товаров: ${newItems.length}`);
        newItems.forEach((item, i) => {
          console.log(`    ${i + 1}. ${item.name?.substring(0, 60)} - ${item.price}`);
        });
        
        // Защита: если база была пустая и товаров много - это первая синхронизация после миграции
        if (existingItems.length === 0 && currentItems.length > 2) {
          console.log(`  ⚠ База пустая, но товаров много (${currentItems.length}), пропускаем уведомления`);
          console.log(`  Вероятно это первая синхронизация после миграции или деплоя`);
        } else {
          // Получаем подписчиков стримера
          const followers = await db.getStreamerFollowers(streamer.id);
          console.log(`  Отправка уведомлений для ${followers.length} пользователей`);
          
          // Отправляем в личку пользователям
          for (const follower of followers) {
            await this.sendNotificationToUser(follower, streamer, newItems);
          }

          // Отправляем в группы
          const groups = await db.getGroupsForStreamerNotifications(streamer.id);
          console.log(`  Отправка в ${groups.length} групп`);
          for (const group of groups) {
            await this.sendNotificationToGroup(group, streamer, newItems);
          }
          
          console.log(`  ✓ Уведомления отправлены`);
        }
      } else {
        console.log(`  ✓ Новых товаров нет`);
      }

      await db.saveWishlistItems(streamer.id, currentItems);
    } catch (error) {
      console.error(`  ✗ Ошибка при проверке ${streamer.nickname}:`, error.message);
    }
  }

  async sendNotificationToUser(user, streamer, newItems) {
    if (!this.bot) { console.log('  ⚠ Бот не настроен'); return; }
    if (!user.telegram_id) { console.log(`  ⚠ Нет telegram_id у ${user.username}`); return; }
    
    try {
      // Проверяем настройки пользователя
      const settings = await db.getStreamerSettings(user.id, streamer.id);
      
      if (!settings.notifications_enabled) {
        console.log(`  ⊘ Уведомления отключены для @${user.username}`);
        return;
      }

      if (!settings.notify_in_pm) {
        console.log(`  ⊘ ЛС отключены для @${user.username}`);
        return;
      }

      await this.bot.sendNewItemsNotification(
        user.telegram_id,
        streamer.name || streamer.nickname,
        streamer.fetta_url,
        newItems,
        true // isSenpai = true для личных сообщений
      );
      console.log(`  ✓ Уведомление отправлено: @${user.username}`);
    } catch (error) {
      console.error(`  ✗ Ошибка уведомления @${user.username}:`, error.message);
    }
  }

  async sendNotificationToGroup(group, streamer, newItems) {
    if (!this.bot) return;
    
    try {
      await this.bot.sendNewItemsNotification(
        group.chat_id,
        streamer.name || streamer.nickname,
        streamer.fetta_url,
        newItems,
        false // isSenpai = false для групп
      );
      console.log(`  ✓ Уведомление отправлено в группу: ${group.title}`);
    } catch (error) {
      console.error(`  ✗ Ошибка уведомления в группу ${group.title}:`, error.message);
    }
  }

  sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
}

module.exports = Scheduler;
