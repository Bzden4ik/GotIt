/**
 * Скрипт для тестирования Telegram бота
 * 
 * Использование:
 * node test-bot.js <telegram_id>
 * 
 * Пример:
 * node test-bot.js 123456789
 */

require('dotenv').config();
const TelegramBot = require('./bot/telegramBot');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

if (!BOT_TOKEN) {
  console.error('❌ TELEGRAM_BOT_TOKEN не найден в .env файле');
  process.exit(1);
}

const chatId = process.argv[2];

if (!chatId) {
  console.error('❌ Укажите telegram_id получателя');
  console.log('Использование: node test-bot.js <telegram_id>');
  process.exit(1);
}

async function testBot() {
  console.log('🤖 Тестирование Telegram бота...\n');
  
  const bot = new TelegramBot(BOT_TOKEN);
  
  try {
    // Проверяем, что бот работает
    console.log('1. Проверка бота...');
    const botInfo = await bot.getMe();
    console.log(`✅ Бот найден: @${botInfo.result.username}`);
    console.log(`   Имя: ${botInfo.result.first_name}\n`);
    
    // Отправляем тестовое сообщение
    console.log(`2. Отправка тестового сообщения в chat_id: ${chatId}...`);
    await bot.sendMessage(chatId, '✅ Тестовое сообщение от GotIt бота!');
    console.log('✅ Сообщение отправлено\n');
    
    // Отправляем тестовое уведомление о товарах
    console.log('3. Отправка тестового уведомления о товарах...');
    const testItems = [
      {
        name: 'Тестовый товар 1',
        price: '1 000 ₽'
      },
      {
        name: 'Тестовый товар 2',
        price: '2 500 ₽'
      },
      {
        name: 'Тестовый товар 3',
        price: '5 000 ₽'
      }
    ];
    
    await bot.sendNewItemsNotification(
      chatId,
      'Тестовый Стример',
      'https://fetta.app/u/test',
      testItems
    );
    console.log('✅ Уведомление отправлено\n');
    
    console.log('🎉 Все тесты пройдены успешно!');
    
  } catch (error) {
    console.error('❌ Ошибка:', error.message);
    if (error.response && error.response.data) {
      console.error('Детали:', JSON.stringify(error.response.data, null, 2));
    }
    process.exit(1);
  }
}

testBot();
