const cron = require('node-cron');
const fettaParser = require('./parsers/fettaParser');
const db = require('./database/database');
const TelegramBot = require('./bot/telegramBot');

class Scheduler {
  constructor(botToken) {
    this.bot = botToken ? new TelegramBot(botToken) : null;
    this.isRunning = false;
  }

  start(cronExpression = '*/30 * * * *') {
    if (this.isRunning) { console.log('Планировщик уже запущен'); return; }
    console.log(`Запуск планировщика с расписанием: ${cronExpression}`);
    this.task = cron.schedule(cronExpression, async () => {
      await this.checkAllStreamers();
    });
    this.isRunning = true;
    console.log('✓ Планировщик запущен');
    setTimeout(() => {
      console.log('Выполняется первая проверка стримеров...');
      this.checkAllStreamers();
    }, 10000);
  }

  stop() {
    if (this.task) { this.task.stop(); this.isRunning = false; console.log('✓ Планировщик остановлен'); }
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

      const newItems = await db.getNewWishlistItems(streamer.id, currentItems);

      if (newItems.length > 0) {
        console.log(`  🎁 Найдено новых товаров: ${newItems.length}`);
        const followers = await db.getStreamerFollowers(streamer.id);
        console.log(`  Отправка уведомлений для ${followers.length} пользователей`);
        for (const follower of followers) {
          await this.sendNotification(follower, streamer, newItems);
        }
      } else {
        console.log(`  ✓ Новых товаров нет`);
      }

      await db.saveWishlistItems(streamer.id, currentItems);
      console.log(`  ✓ Вишлист обновлён в базе`);
    } catch (error) {
      console.error(`  ✗ Ошибка при проверке ${streamer.nickname}:`, error.message);
    }
  }

  async sendNotification(user, streamer, newItems) {
    if (!this.bot) { console.log('  ⚠ Бот не настроен'); return; }
    if (!user.telegram_id) { console.log(`  ⚠ Нет telegram_id у ${user.username}`); return; }
    try {
      await this.bot.sendNewItemsNotification(user.telegram_id, streamer.name || streamer.nickname, streamer.fetta_url, newItems);
      console.log(`  ✓ Уведомление отправлено: @${user.username}`);
    } catch (error) {
      console.error(`  ✗ Ошибка уведомления @${user.username}:`, error.message);
    }
  }

  sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
}

module.exports = Scheduler;
