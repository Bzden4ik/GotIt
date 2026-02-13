const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
require('dotenv').config();
const fettaParser = require('./parsers/fettaParser');
const db = require('./database/database');
const Scheduler = require('./scheduler');

const app = express();
const PORT = process.env.PORT || 3001;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';

// Middleware
app.use(cors());
app.use(express.json());

// Проверка подписи Telegram Login Widget
function verifyTelegramAuth(data) {
  if (!BOT_TOKEN) {
    console.warn('TELEGRAM_BOT_TOKEN не задан, проверка подписи пропущена');
    return true;
  }

  const { hash, ...rest } = data;
  if (!hash) return false;

  // Собираем строку для проверки: все поля (кроме hash) отсортированные, через \n
  const checkString = Object.keys(rest)
    .sort()
    .map(key => `${key}=${rest[key]}`)
    .join('\n');

  const secretKey = crypto.createHash('sha256').update(BOT_TOKEN).digest();
  const hmac = crypto.createHmac('sha256', secretKey).update(checkString).digest('hex');

  if (hmac !== hash) return false;

  // Проверяем что авторизация не устарела (не старше 24ч)
  const authDate = parseInt(data.auth_date, 10);
  if (Date.now() / 1000 - authDate > 86400) return false;

  return true;
}

// Тестовый эндпоинт
app.get('/api/test', (req, res) => {
  res.json({ 
    message: 'Backend работает!', 
    timestamp: new Date().toISOString() 
  });
});

// === Авторизация через Telegram ===
app.post('/api/auth/telegram', (req, res) => {
  const telegramData = req.body;

  if (!telegramData || !telegramData.id) {
    return res.status(400).json({ success: false, error: 'Нет данных Telegram' });
  }

  // Проверяем подпись
  if (!verifyTelegramAuth(telegramData)) {
    return res.status(401).json({ success: false, error: 'Неверная подпись Telegram' });
  }

  try {
    // Создаём или находим пользователя
    db.createUser(
      telegramData.id,
      telegramData.username || '',
      telegramData.first_name || ''
    );

    const user = db.getUserByTelegramId(telegramData.id);

    console.log(`Авторизован пользователь: ${user.username} (telegram_id: ${user.telegram_id})`);

    res.json({
      success: true,
      user: {
        id: user.id,
        telegramId: user.telegram_id,
        username: user.username,
        firstName: user.first_name
      }
    });
  } catch (error) {
    console.error('Ошибка авторизации:', error);
    res.status(500).json({ success: false, error: 'Ошибка авторизации' });
  }
});

// Эндпоинт для поиска стримера
app.get('/api/streamer/search', async (req, res) => {
  const { nickname } = req.query;
  
  if (!nickname) {
    return res.status(400).json({ error: 'Необходимо указать nickname' });
  }

  try {
    console.log(`Поиск стримера: ${nickname}`);
    const result = await fettaParser.getStreamerInfo(nickname);
    
    if (!result.success) {
      return res.status(404).json({ 
        success: false, 
        error: result.error 
      });
    }
    
    res.json({
      success: true,
      streamer: result.profile
    });
  } catch (error) {
    console.error('Ошибка при поиске стримера:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Ошибка при поиске стримера' 
    });
  }
});

// Добавить стримера в отслеживаемые
app.post('/api/tracked', async (req, res) => {
  const { nickname, userId } = req.body;
  
  if (!nickname) {
    return res.status(400).json({ error: 'Необходимо указать nickname' });
  }
  if (!userId) {
    return res.status(401).json({ error: 'Необходимо авторизоваться' });
  }

  try {
    // Получаем данные стримера с fetta.app
    const result = await fettaParser.getStreamerInfo(nickname);
    
    if (!result.success) {
      return res.status(404).json({ 
        success: false, 
        error: result.error 
      });
    }

    // Сохраняем стримера в БД
    const streamer = db.createOrUpdateStreamer({
      nickname: result.profile.nickname,
      name: result.profile.name,
      username: result.profile.username,
      avatar: result.profile.avatar,
      description: result.profile.description,
      fettaUrl: result.profile.fettaUrl
    });

    console.log(`Стример сохранён, ID: ${streamer.id}`);
    console.log(`Количество товаров в вишлисте: ${result.wishlist.length}`);

    // Сохраняем вишлист
    if (result.wishlist && result.wishlist.length > 0) {
      db.saveWishlistItems(streamer.id, result.wishlist);
      console.log(`Вишлист сохранён для стримера ${streamer.id}`);
    } else {
      console.log('Вишлист пуст, ничего не сохраняем');
    }

    // Добавляем в отслеживаемые
    db.addTrackedStreamer(userId, streamer.id);
    
    res.json({
      success: true,
      streamer: {
        ...streamer,
        itemsCount: result.wishlist.length
      }
    });
  } catch (error) {
    console.error('Ошибка при добавлении стримера:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Ошибка при добавлении стримера' 
    });
  }
});

// Получить список отслеживаемых стримеров
app.get('/api/tracked', async (req, res) => {
  const { userId } = req.query;

  if (!userId) {
    return res.status(401).json({ success: false, error: 'Необходимо авторизоваться' });
  }

  try {
    const streamers = db.getTrackedStreamers(userId);
    
    // Добавляем количество товаров для каждого стримера
    const streamersWithItems = streamers.map(streamer => {
      const items = db.getWishlistItems(streamer.id);
      return {
        ...streamer,
        itemsCount: items.length
      };
    });
    
    res.json({
      success: true,
      streamers: streamersWithItems
    });
  } catch (error) {
    console.error('Ошибка при получении отслеживаемых:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Ошибка при получении списка' 
    });
  }
});

// Удалить стримера из отслеживаемых
app.delete('/api/tracked/:streamerId', async (req, res) => {
  const { streamerId } = req.params;
  const { userId } = req.query;

  if (!userId) {
    return res.status(401).json({ success: false, error: 'Необходимо авторизоваться' });
  }

  try {
    db.removeTrackedStreamer(userId, parseInt(streamerId));
    
    res.json({
      success: true,
      message: 'Стример удален из отслеживаемых'
    });
  } catch (error) {
    console.error('Ошибка при удалении стримера:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Ошибка при удалении стримера' 
    });
  }
});

// Получить вишлист стримера по ID
app.get('/api/streamer/:id/wishlist', async (req, res) => {
  const { id } = req.params;

  try {
    const streamer = db.getStreamerById(parseInt(id));
    
    if (!streamer) {
      return res.status(404).json({ 
        success: false, 
        error: 'Стример не найден' 
      });
    }

    const items = db.getWishlistItems(streamer.id);
    
    res.json({
      success: true,
      items
    });
  } catch (error) {
    console.error('Ошибка при получении вишлиста:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Ошибка при получении вишлиста' 
    });
  }
});

// Запуск сервера
app.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
  
  // Запускаем планировщик проверки вишлистов
  const scheduler = new Scheduler(BOT_TOKEN);
  
  // По умолчанию: каждые 30 минут
  // Можно настроить через переменную окружения CHECK_INTERVAL
  const checkInterval = process.env.CHECK_INTERVAL || '*/30 * * * *';
  scheduler.start(checkInterval);
  
  console.log(`Планировщик настроен на: ${checkInterval}`);
});
