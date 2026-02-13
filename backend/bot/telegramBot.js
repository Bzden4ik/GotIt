const axios = require('axios');

class TelegramBot {
  constructor(token) {
    this.token = token;
    this.apiUrl = `https://api.telegram.org/bot${token}`;
  }

  /**
   * Отправить сообщение пользователю
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
   * Отправить уведомление о новых товарах
   */
  async sendNewItemsNotification(chatId, streamerName, streamerUrl, items) {
    const itemsCount = items.length;
    const itemsText = itemsCount === 1 ? 'товар' : itemsCount < 5 ? 'товара' : 'товаров';

    let message = `🎁 <b>У стримера ${streamerName} появились новые товары!</b>\n\n`;
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
