const fettaParser = require('./parsers/fettaParser');
const db = require('./database/database');
const TelegramBot = require('./bot/telegramBot');

class Scheduler {
  constructor(botToken) {
    this.bot = botToken ? new TelegramBot(botToken) : null;
    this.isRunning = false;
    this.intervalId = null;
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
      console.log(`Найдено стримеров для проверки: ${streamers.length}`);
      for (const streamer of streamers) {
        await this.checkStreamer(streamer);
        await this.sleep(2000);
      }
      console.log('=== Проверка завершена ===\n');
    } catch (error) {
      console.error('Ошибка при проверке стримеров:', error);
    }
  }

  async checkStreamer(streamer) {
    try {
      console.log(`\nПроверка стримера: ${streamer.nickname}`);
      const result = await fettaParser.getStreamerInfo(streamer.nickname);
      if (!result.success || !result.wishlist) {
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
        console.log(`  🎁 Новые товары:`);
        newItems.forEach((item, i) => {
          const hash = db.generateItemHash(item);
          console.log(`    ${i + 1}. ${item.name?.substring(0, 50) || 'Без названия'} (hash: ${hash})`);
        });
        
        // Защита от спама: если слишком много новых товаров одновременно - возможно база была очищена
        if (newItems.length > 15) {
          console.log(`  ⚠ Слишком много новых товаров (${newItems.length}), пропускаем уведомления`);
          console.log(`  Вероятно это после очистки базы или первый запуск`);
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
        }
      } else {
        console.log(`  ✓ Новых товаров нет`);
      }

      await db.saveWishlistItems(streamer.id, currentItems);
      console.log(`  ✓ Вишлист обновлён в базе (${currentItems.length} товаров)`);
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
