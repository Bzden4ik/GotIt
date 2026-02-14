const axios = require('axios');
const db = require('../database/database');
const AIAssistant = require('./aiAssistant');

class TelegramBot {
  constructor(token) {
    this.token = token;
    this.apiUrl = `https://api.telegram.org/bot${token}`;
    this.ai = new AIAssistant();
    
    // Очищаем старые лимиты каждый день
    setInterval(() => this.ai.cleanOldLimits(), 24 * 60 * 60 * 1000);
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
        reply_markup: options.reply_markup,
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
   * Ответить на callback query
   */
  async answerCallbackQuery(callbackQueryId, text = '', showAlert = false) {
    try {
      await axios.post(`${this.apiUrl}/answerCallbackQuery`, {
        callback_query_id: callbackQueryId,
        text: text,
        show_alert: showAlert
      });
    } catch (error) {
      console.error('Ошибка ответа на callback:', error.message);
    }
  }

  /**
   * Редактировать сообщение
   */
  async editMessageText(chatId, messageId, text, options = {}) {
    try {
      await axios.post(`${this.apiUrl}/editMessageText`, {
        chat_id: chatId,
        message_id: messageId,
        text: text,
        parse_mode: options.parse_mode || 'HTML',
        reply_markup: options.reply_markup,
        ...options
      });
    } catch (error) {
      console.error('Ошибка редактирования сообщения:', error.message);
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

<b>Команды:</b>
/settings - Настроить уведомления
/groups - Настроить группы (если добавила меня в группы)`;

    return await this.sendMessage(chatId, message, {
      parse_mode: 'HTML',
      disable_web_page_preview: true
    });
  }

  /**
   * Показать меню настроек
   */
  async sendSettingsMenu(chatId, telegramId, messageId = null) {
    const user = await db.getUserByTelegramId(telegramId);
    if (!user) {
      const text = 'Сначала авторизуйся на сайте через Telegram!';
      if (messageId) {
        return await this.editMessageText(chatId, messageId, text);
      }
      return await this.sendMessage(chatId, text);
    }

    const streamers = await db.getTrackedStreamers(user.id);
    if (streamers.length === 0) {
      const text = 'У тебя пока нет отслеживаемых стримеров. Добавь их на сайте!';
      if (messageId) {
        return await this.editMessageText(chatId, messageId, text);
      }
      return await this.sendMessage(chatId, text);
    }

    const buttons = [];
    for (const streamer of streamers) {
      const settings = await db.getStreamerSettings(user.id, streamer.id);
      const icon = settings.notifications_enabled ? '🔔' : '🔕';
      buttons.push([{
        text: `${icon} ${streamer.name || streamer.nickname}`,
        callback_data: `toggle_notif_${streamer.id}`
      }]);
    }

    const message = `⚙️ <b>Настройки уведомлений</b>

Выбери стримера, чтобы включить/выключить уведомления:

🔔 - уведомления включены
🔕 - уведомления выключены`;

    if (messageId) {
      return await this.editMessageText(chatId, messageId, message, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: buttons }
      });
    }

    return await this.sendMessage(chatId, message, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: buttons
      }
    });
  }

  /**
   * Показать меню групп
   */
  async sendGroupsMenu(chatId, telegramId, messageId = null) {
    const user = await db.getUserByTelegramId(telegramId);
    if (!user) {
      const text = 'Сначала авторизуйся на сайте через Telegram!';
      if (messageId) {
        return await this.editMessageText(chatId, messageId, text);
      }
      return await this.sendMessage(chatId, text);
    }

    const groups = await db.getUserGroups(user.id);
    if (groups.length === 0) {
      const text = 'Я пока не добавлена ни в одну твою группу. Добавь меня в группу, чтобы настроить уведомления!';
      if (messageId) {
        return await this.editMessageText(chatId, messageId, text);
      }
      return await this.sendMessage(chatId, text);
    }

    const buttons = groups.map(group => [{
      text: `👥 ${group.title}`,
      callback_data: `group_${group.id}`
    }]);

    const message = `👥 <b>Мои группы</b>

Выбери группу, чтобы настроить уведомления:`;

    if (messageId) {
      return await this.editMessageText(chatId, messageId, message, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: buttons }
      });
    }

    return await this.sendMessage(chatId, message, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: buttons
      }
    });
  }

  /**
   * Показать стримеров для группы
   */
  async sendGroupStreamersMenu(chatId, telegramId, groupId, messageId = null) {
    const user = await db.getUserByTelegramId(telegramId);
    if (!user) return;

    // groupId это ID из базы, не chat_id
    const groups = await db.getUserGroups(user.id);
    const group = groups.find(g => g.id === groupId);
    if (!group) return;

    const streamers = await db.getTrackedStreamers(user.id);
    if (streamers.length === 0) {
      const text = 'У тебя нет отслеживаемых стримеров.';
      if (messageId) {
        return await this.editMessageText(chatId, messageId, text);
      }
      return await this.sendMessage(chatId, text);
    }

    const buttons = [];
    for (const streamer of streamers) {
      const settings = await db.getGroupStreamerSettings(group.id, streamer.id);
      const icon = settings.enabled ? '✅' : '❌';
      buttons.push([{
        text: `${icon} ${streamer.name || streamer.nickname}`,
        callback_data: `grp_${group.id}_str_${streamer.id}`
      }]);
    }

    buttons.push([{
      text: '« Назад',
      callback_data: 'back_to_groups'
    }]);

    const message = `⚙️ <b>Настройки для группы: ${group.title}</b>

Выбери стримеров, о которых я буду писать в эту группу:

✅ - уведомления включены
❌ - уведомления выключены`;

    if (messageId) {
      return await this.editMessageText(chatId, messageId, message, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: buttons }
      });
    }

    return await this.sendMessage(chatId, message, {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: buttons }
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

    await db.createUser(userId, username, firstName);
    await this.sendWelcomeMessage(chatId);
  }

  /**
   * Обработка команды /settings
   */
  async handleSettingsCommand(message) {
    const chatId = message.chat.id;
    const telegramId = message.from.id;
    await this.sendSettingsMenu(chatId, telegramId);
  }

  /**
   * Обработка команды /groups
   */
  async handleGroupsCommand(message) {
    const chatId = message.chat.id;
    const telegramId = message.from.id;
    await this.sendGroupsMenu(chatId, telegramId);
  }

  /**
   * Обработка callback кнопок
   */
  async handleCallback(callbackQuery) {
    const data = callbackQuery.data;
    const chatId = callbackQuery.message.chat.id;
    const messageId = callbackQuery.message.message_id;
    const telegramId = callbackQuery.from.id;

    const user = await db.getUserByTelegramId(telegramId);
    if (!user) {
      return await this.answerCallbackQuery(callbackQuery.id, 'Сначала авторизуйся на сайте!', true);
    }

    // Переключение уведомлений стримера
    if (data.startsWith('toggle_notif_')) {
      const streamerId = parseInt(data.replace('toggle_notif_', ''));
      const settings = await db.getStreamerSettings(user.id, streamerId);
      const newState = settings.notifications_enabled ? 0 : 1;

      await db.updateStreamerSettings(user.id, streamerId, {
        notifications_enabled: newState,
        notify_in_pm: settings.notify_in_pm
      });

      await this.answerCallbackQuery(callbackQuery.id, newState ? '🔔 Включено' : '🔕 Выключено');
      await this.sendSettingsMenu(chatId, telegramId, messageId);
      return;
    }

    // Выбор группы
    if (data.startsWith('group_')) {
      const groupId = parseInt(data.replace('group_', ''));
      await this.sendGroupStreamersMenu(chatId, telegramId, groupId, messageId);
      await this.answerCallbackQuery(callbackQuery.id);
      return;
    }

    // Переключение стримера в группе
    if (data.startsWith('grp_')) {
      const parts = data.split('_');
      const groupId = parseInt(parts[1]);
      const streamerId = parseInt(parts[3]);

      const settings = await db.getGroupStreamerSettings(groupId, streamerId);
      const newState = settings.enabled ? 0 : 1;

      await db.updateGroupStreamerSettings(groupId, streamerId, newState);
      await this.answerCallbackQuery(callbackQuery.id, newState ? '✅ Включено' : '❌ Выключено');
      await this.sendGroupStreamersMenu(chatId, telegramId, groupId, messageId);
      return;
    }

    // Назад к группам
    if (data === 'back_to_groups') {
      await this.sendGroupsMenu(chatId, telegramId, messageId);
      await this.answerCallbackQuery(callbackQuery.id);
      return;
    }
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

    if (newStatus === 'member' || newStatus === 'administrator') {
      console.log(`Бот добавлен в группу: ${chat.title} (${chat.id}) пользователем ${from.first_name}`);

      await db.createUser(from.id, from.username || '', from.first_name || '');
      const user = await db.getUserByTelegramId(from.id);

      const group = await db.createGroup(chat.id, chat.title, user.id);
      await db.linkUserToGroup(user.id, group.id);

      const message = `Привет! 💜

Меня добавил${from.first_name ? ' ' + from.first_name : 'и'}, и теперь я могу писать сюда уведомления о новых товарах в вишлистах стримеров!

Чтобы настроить, о каких стримерах я буду писать сюда, напиши мне в личку команду:
/groups

Или нажми на моё имя → "Отправить сообщение" → /groups 😊`;

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
      // Команды
      if (update.message && update.message.text) {
        const text = update.message.text;
        
        if (text.startsWith('/start')) {
          await this.handleStartCommand(update.message);
          return;
        }
        if (text.startsWith('/settings')) {
          await this.handleSettingsCommand(update.message);
          return;
        }
        if (text.startsWith('/groups')) {
          await this.handleGroupsCommand(update.message);
          return;
        }
        
        // Обычные сообщения - отправляем в AI
        if (!text.startsWith('/')) {
          await this.handleAIMessage(update.message);
          return;
        }
      }

      // Callback кнопки
      if (update.callback_query) {
        await this.handleCallback(update.callback_query);
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
   * Обработка AI сообщений
   */
  async handleAIMessage(message) {
    const chatId = message.chat.id;
    const userId = message.from.id;
    const text = message.text;

    // В группах не отвечаем (только команды)
    if (message.chat.type !== 'private') {
      return;
    }

    try {
      // Показываем что печатаем
      await axios.post(`${this.apiUrl}/sendChatAction`, {
        chat_id: chatId,
        action: 'typing'
      });

      // Получаем контекст пользователя из базы
      const user = await db.getUserByTelegramId(userId);
      let userContext = null;

      if (user) {
        const streamers = await db.getTrackedStreamers(user.id);
        
        // Загружаем вишлисты для каждого стримера
        const streamersWithWishlist = await Promise.all(
          streamers.map(async (streamer) => {
            const wishlist = await db.getWishlistItems(streamer.id);
            return {
              ...streamer,
              wishlist: wishlist.map(item => ({
                name: item.name,
                price: item.price,
                image: item.image
              }))
            };
          })
        );

        userContext = {
          streamers: streamersWithWishlist
        };
      }

      const response = await this.ai.getResponse(text, userId, userContext);

      if (!response) {
        await this.sendMessage(chatId, 'Сэмпай, у меня технические проблемы 😔 Попробуй команды: /start, /settings, /groups');
        return;
      }

      if (response.limitExceeded) {
        await this.sendMessage(chatId, response.text);
        return;
      }

      // Добавляем информацию об оставшихся сообщениях (только если меньше 5)
      let messageText = response.text;
      if (response.remaining <= 5 && response.remaining > 0) {
        messageText += `\n\n<i>(AI сообщений осталось сегодня: ${response.remaining})</i>`;
      }

      await this.sendMessage(chatId, messageText, { parse_mode: 'HTML' });
    } catch (error) {
      console.error('Ошибка AI обработки:', error);
      await this.sendMessage(chatId, 'Извини, Сэмпай, что-то пошло не так 😔');
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
