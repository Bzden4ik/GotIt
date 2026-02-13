const cron = require('node-cron');
const fettaParser = require('./parsers/fettaParser');
const db = require('./database/database');
const TelegramBot = require('./bot/telegramBot');

class Scheduler {
  constructor(botToken) {
    this.bot = botToken ? new TelegramBot(botToken) : null;
    this.isRunning = false;
  }

  /**
   * Запустить планировщик
   */
  start(cronExpression = '*/30 * * * *') {
    if (this.isRunning) {
      console.log('Планировщик уже запущен');
      return;
    }

    console.log(`Запуск планировщика с расписанием: ${cronExpression}`);
    
    // Запускаем задачу по расписанию
    this.task = cron.schedule(cronExpression, async () => {
      await this.checkAllStreamers();
    });

    this.isRunning = true;
    console.log('✓ Планировщик запущен');

    // Запускаем первую проверку через 10 секунд после старта
    setTimeout(() => {
      console.log('Выполняется первая проверка стримеров...');
      this.checkAllStreamers();
    }, 10000);
  }

  /**
   * Остановить планировщик
   */
  stop() {
    if (this.task) {
      this.task.stop();
      this.isRunning = false;
      console.log('✓ Планировщик остановлен');
    }
  }

  /**
   * Проверить всех отслеживаемых стримеров
   */
  async checkAllStreamers() {
    console.log('\n=== Начало проверки стримеров ===');
    console.log(`Время: ${new Date().toLocaleString('ru-RU')}`);
    
    try {
      // Получаем всех уникальных стримеров, которых кто-то отслеживает
      const streamers = db.getAllTrackedStreamers();
      
      if (streamers.length === 0) {
        console.log('Нет отслеживаемых стримеров');
        return;
      }

      console.log(`Найдено стримеров для проверки: ${streamers.length}`);

      for (const streamer of streamers) {
        await this.checkStreamer(streamer);
        // Небольшая пауза между запросами, чтобы не нагружать сервер
        await this.sleep(2000);
      }

      console.log('=== Проверка завершена ===\n');
    } catch (error) {
      console.error('Ошибка при проверке стримеров:', error);
    }
  }

  /**
   * Проверить одного стримера
   */
  async checkStreamer(streamer) {
    try {
      console.log(`\nПроверка стримера: ${streamer.nickname}`);
      
      // Получаем текущий вишлист с fetta.app
      const result = await fettaParser.getStreamerInfo(streamer.nickname);
      
      if (!result.success || !result.wishlist) {
        console.log(`  ⚠ Не удалось получить вишлист для ${streamer.nickname}`);
        return;
      }

      const currentItems = result.wishlist;
      console.log(`  Текущее количество товаров: ${currentItems.length}`);

      // Определяем новые товары
      const newItems = db.getNewWishlistItems(streamer.id, currentItems);
      
      if (newItems.length > 0) {
        console.log(`  🎁 Найдено новых товаров: ${newItems.length}`);
        
        // Получаем всех пользователей, отслеживающих этого стримера
        const followers = db.getStreamerFollowers(streamer.id);
        console.log(`  Отправка уведомлений для ${followers.length} пользователей`);
        
        // Отправляем уведомления
        for (const follower of followers) {
          await this.sendNotification(follower, streamer, newItems);
        }
      } else {
        console.log(`  ✓ Новых товаров нет`);
      }

      // Обновляем вишлист в базе
      db.saveWishlistItems(streamer.id, currentItems);
      console.log(`  ✓ Вишлист обновлён в базе`);

    } catch (error) {
      console.error(`  ✗ Ошибка при проверке ${streamer.nickname}:`, error.message);
    }
  }

  /**
   * Отправить уведомление пользователю
   */
  async sendNotification(user, streamer, newItems) {
    if (!this.bot) {
      console.log(`  ⚠ Бот не настроен, уведомление не отправлено`);
      return;
    }

    if (!user.telegram_id) {
      console.log(`  ⚠ У пользователя ${user.username} нет telegram_id`);
      return;
    }

    try {
      await this.bot.sendNewItemsNotification(
        user.telegram_id,
        streamer.name || streamer.nickname,
        streamer.fetta_url,
        newItems
      );
      console.log(`  ✓ Уведомление отправлено: @${user.username}`);
    } catch (error) {
      console.error(`  ✗ Ошибка отправки уведомления @${user.username}:`, error.message);
    }
  }

  /**
   * Пауза
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = Scheduler;
