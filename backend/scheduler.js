const fettaParser = require('./parsers/fettaParser');
const db = require('./database/database');
const TelegramBot = require('./bot/telegramBot');

class Scheduler {
  constructor(botToken) {
    this.bot = botToken ? new TelegramBot(botToken) : null;
    this.isRunning = false;
    this.intervalId = null;
    this.lastNotifications = new Map(); // streamerId -> timestamp
    this.notificationCooldown = 60 * 1000; // 1 минута между уведомлениями для одного стримера
  }

  start(intervalSeconds = 5) {
    if (this.isRunning) { console.log('Планировщик уже запущен'); return; }
    console.log(`Запуск планировщика: каждые ${intervalSeconds} секунд, с 7:00 до 23:00 МСК`);
    
    this.intervalId = setInterval(async () => {
      if (this.isWithinWorkingHours()) {
        await this.checkAllStreamers();
      }
    }, intervalSeconds * 1000);
    
    this.isRunning = true;
    console.log('✓ Планировщик запущен');
    setTimeout(() => {
      if (this.isWithinWorkingHours()) {
        console.log('Выполняется первая проверка стримеров...');
        this.checkAllStreamers();
      } else {
        console.log('Пропуск первой проверки - вне рабочего времени');
      }
    }, 10000);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      this.isRunning = false;
      console.log('✓ Планировщик остановлен');
    }
  }

  isWithinWorkingHours() {
    const now = new Date();
    const utcHours = now.getUTCHours();
    // МСК = UTC+3, поэтому 7:00-23:00 МСК = 4:00-20:00 UTC
    return utcHours >= 4 && utcHours < 20;
  }

  async checkAllStreamers() {
    console.log('\n=== Начало проверки стримеров ===');
    console.log(`Время: ${new Date().toLocaleString('ru-RU')}`);
    try {
      const streamers = await db.getAllTrackedStreamers();
      if (streamers.length === 0) { console.log('Нет отслеживаемых стримеров'); return; }
      
      // Убираем дубли по nickname
      const uniqueStreamers = [];
      const seenNicknames = new Set();
      
      for (const streamer of streamers) {
        if (!seenNicknames.has(streamer.nickname)) {
          seenNicknames.add(streamer.nickname);
          uniqueStreamers.push(streamer);
        } else {
          console.log(`⚠ Пропущен дубль: ${streamer.nickname} (id: ${streamer.id})`);
        }
      }
      
      console.log(`Найдено стримеров: ${streamers.length}, уникальных: ${uniqueStreamers.length}`);
      
      for (const streamer of uniqueStreamers) {
        await this.checkStreamer(streamer);
        await this.sleep(3000); // Увеличил с 2 до 3 секунд
      }
      console.log('=== Проверка завершена ===\n');
    } catch (error) {
      console.error('Ошибка при проверке стримеров:', error);
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

      const newItems = await db.getNewWishlistItems(streamer.id, currentItems);
      console.log(`  Определено новых товаров: ${newItems.length}`);

      if (newItems.length > 0) {
        console.log(`  🎁 Найдено новых товаров: ${newItems.length}`);
        newItems.forEach((item, i) => {
          console.log(`    ${i + 1}. ${item.name?.substring(0, 60)} - ${item.price}`);
        });
        
        // Проверяем кулдаун - не отправляли ли мы уведомление недавно
        const lastNotification = this.lastNotifications.get(streamer.id);
        const now = Date.now();
        
        if (lastNotification && (now - lastNotification) < this.notificationCooldown) {
          const remainingSeconds = Math.ceil((this.notificationCooldown - (now - lastNotification)) / 1000);
          console.log(`  ⏳ Кулдаун активен, пропускаем уведомления (${remainingSeconds} сек)`);
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
          
          // Запоминаем время отправки
          this.lastNotifications.set(streamer.id, now);
          console.log(`  ✓ Уведомления отправлены, кулдаун на 1 минуту`);
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
