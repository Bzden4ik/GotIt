const axios = require('axios');
const db = require('../database/database');

class TelegramBot {
  constructor(token) {
    this.token = token;
    this.apiUrl = `https://api.telegram.org/bot${token}`;
  }

  /**
   * Отправить сообщение пользователю или в группу
   */
  async sendMessage(chatId, text, options = {}) {
    try {
      const response = await axios.post(`${this.apiUrl}/sendMessage`, {
        chat_id: chatId,
        text: text,
        parse_mode: options.parse_mode || 'HTML',
        disable_web_page_preview: options.disable_web_page_preview || false,
        ...options
      });
      return response.data;
    } catch (error) {
      console.error(`Ошибка отправки сообщения в Telegram (${chatId}):`, error.message);
      if (error.response) {
        console.error('Детали ошибки:', error.response.data);
      }
      throw error;
    }
  }

  /**
   * Отправить приветствие при команде /start
   */
  async sendWelcomeMessage(chatId) {
    const message = `Привет, Сэмпай! 💜

Я твоя помощница GotIt! Буду следить за вишлистами твоих любимых стримеров на Fetta и сразу же сообщу тебе, когда они добавят что-то новенькое! 🎁

<b>Что я умею:</b>
✨ Отслеживаю вишлисты стримеров
📬 Мгновенно уведомляю о новых товарах
⚙️ Позволяю настроить, о ком получать уведомления
👥 Могу писать в группы (просто добавь меня туда!)

<b>Как начать:</b>
1. Зайди на сайт: https://bzden4ik.github.io/GotIt
2. Авторизуйся через Telegram
3. Добавь стримеров для отслеживания
4. Готово! Я буду писать тебе о каждом обновлении 💌

Если хочешь, чтобы я писала в группу - просто добавь меня туда, и я пойму! 😊`;

    return await this.sendMessage(chatId, message, {
      parse_mode: 'HTML',
      disable_web_page_preview: true
    });
  }

  /**
   * Отправить уведомление о новых товарах
   */
  async sendNewItemsNotification(chatId, streamerName, streamerUrl, items, isSenpai = true) {
    const itemsCount = items.length;
    const itemsText = itemsCount === 1 ? 'товар' : itemsCount < 5 ? 'товара' : 'товаров';

    const greeting = isSenpai ? 'Сэмпай! ' : '';
    let message = `${greeting}🎁 <b>У стримера ${streamerName} появились новые товары!</b>\n\n`;
    message += `📦 Добавлено ${itemsCount} ${itemsText}:\n\n`;

    // Добавляем список товаров (максимум 5 для краткости)
    const itemsToShow = items.slice(0, 5);
    itemsToShow.forEach((item, index) => {
      message += `${index + 1}. ${item.name || 'Без названия'}\n`;
      if (item.price) {
        message += `   💰 ${item.price}\n`;
      }
      message += '\n';
    });

    if (items.length > 5) {
      message += `... и ещё ${items.length - 5} товаров\n\n`;
    }

    message += `🔗 <a href="${streamerUrl}">Смотреть все на Fetta</a>`;

    return await this.sendMessage(chatId, message, {
      parse_mode: 'HTML',
      disable_web_page_preview: true
    });
  }

  /**
   * Обработка команды /start
   */
  async handleStartCommand(message) {
    const chatId = message.chat.id;
    const userId = message.from.id;
    const username = message.from.username || '';
    const firstName = message.from.first_name || '';

    // Создаём пользователя если его нет
    await db.createUser(userId, username, firstName);

    await this.sendWelcomeMessage(chatId);
  }

  /**
   * Обработка добавления бота в группу
   */
  async handleGroupJoin(update) {
    const myChatMember = update.my_chat_member;
    if (!myChatMember) return;

    const newStatus = myChatMember.new_chat_member.status;
    const chat = myChatMember.chat;
    const from = myChatMember.from;

    // Бота добавили в группу
    if (newStatus === 'member' || newStatus === 'administrator') {
      console.log(`Бот добавлен в группу: ${chat.title} (${chat.id}) пользователем ${from.first_name}`);

      // Создаём пользователя если его нет
      await db.createUser(from.id, from.username || '', from.first_name || '');
      const user = await db.getUserByTelegramId(from.id);

      // Создаём группу
      const group = await db.createGroup(chat.id, chat.title, user.id);

      // Связываем пользователя с группой
      await db.linkUserToGroup(user.id, group.id);

      // Отправляем приветствие в группу
      const message = `Привет! 💜

Меня добавил${from.first_name ? ' ' + from.first_name : 'и'}, и теперь я могу писать сюда уведомления о новых товарах в вишлистах стримеров!

Чтобы настроить, о каких стримерах я буду писать в эту группу - зайди на сайт и выбери нужные настройки 😊

🔗 https://bzden4ik.github.io/GotIt`;

      await this.sendMessage(chat.id, message, {
        parse_mode: 'HTML',
        disable_web_page_preview: true
      });
    }
  }

  /**
   * Обработка входящих обновлений
   */
  async handleUpdate(update) {
    try {
      // Команда /start
      if (update.message && update.message.text && update.message.text.startsWith('/start')) {
        await this.handleStartCommand(update.message);
        return;
      }

      // Добавление бота в группу
      if (update.my_chat_member) {
        await this.handleGroupJoin(update);
        return;
      }
    } catch (error) {
      console.error('Ошибка обработки обновления:', error);
    }
  }

  /**
   * Установить webhook
   */
  async setWebhook(url) {
    try {
      const response = await axios.post(`${this.apiUrl}/setWebhook`, {
        url: url
      });
      console.log('Webhook установлен:', response.data);
      return response.data;
    } catch (error) {
      console.error('Ошибка установки webhook:', error.message);
      throw error;
    }
  }

  /**
   * Проверить, что бот работает
   */
  async getMe() {
    try {
      const response = await axios.get(`${this.apiUrl}/getMe`);
      return response.data;
    } catch (error) {
      console.error('Ошибка проверки бота:', error.message);
      throw error;
    }
  }
}

module.exports = TelegramBot;
