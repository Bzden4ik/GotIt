/**
 * Скрипт для тестирования планировщика
 * 
 * Запускает одну проверку всех отслеживаемых стримеров
 * 
 * Использование:
 * node test-scheduler.js
 */

require('dotenv').config();
const Scheduler = require('./scheduler');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

if (!BOT_TOKEN) {
  console.warn('⚠️  TELEGRAM_BOT_TOKEN не найден, уведомления не будут отправлены');
}

async function testScheduler() {
  console.log('⏰ Тестирование планировщика...\n');
  
  const scheduler = new Scheduler(BOT_TOKEN);
  
  try {
    console.log('Запуск проверки всех стримеров...\n');
    await scheduler.checkAllStreamers();
    console.log('\n✅ Проверка завершена');
    
  } catch (error) {
    console.error('❌ Ошибка:', error.message);
    process.exit(1);
  }
}

testScheduler();
